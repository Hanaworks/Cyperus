// 库入口。
//
// Tauri 2 的推荐结构：main.rs 只调用 lib.rs 的 run()，
// 真正的初始化写在 lib.rs，这样移动端入口（mobile_entry_point）也能复用。
//
// 受限文档读取、父目录监听、链接与阅读状态持久化。

mod commands;
mod desktop;
mod diagnostics;
mod documents;
mod encoding;
mod error;
mod folders;
mod instance;
mod links;
mod m0;
mod watcher;
mod workspace;

use error::{guard, AppError};

use serde::Serialize;
use tauri::Manager;

// 诊断面板所需的环境信息（docs/design/07-ipc-contract.md §3.1 的 EnvInfo）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvInfo {
    pub app_version: String,
    pub tauri_version: String,
    pub rust_version: String,
    pub os: String,
    pub os_version: String,
    pub webview_version: String,
    pub locale: String,
    pub build_revision: String,
    pub build_time: String,
}

// 立即返回环境信息。T09 里没有真正的 WebView 版本探测，
// 先用运行时 API 能拿到的部分，其余在 T38 补齐。
#[tauri::command]
async fn get_env_info(app: tauri::AppHandle) -> Result<EnvInfo, AppError> {
    guard(|| {
        let app_version = app.package_info().version.to_string();
        Ok(EnvInfo {
            app_version,
            tauri_version: tauri::VERSION.to_string(),
            rust_version: option_env!("RUSTC_VERSION")
                .unwrap_or("unknown")
                .to_string(),
            os: std::env::consts::OS.to_string(),
            os_version: os_version(),
            webview_version: webview_version(),
            locale: locale(),
            build_revision: option_env!("BUILD_REVISION").unwrap_or("unknown").into(),
            build_time: option_env!("BUILD_TIME").unwrap_or("unknown").into(),
        })
    })
}

// 启动时命令行传入的文件路径。
// T09 只返回参数，不打开文档；打开逻辑在 T35。
#[tauri::command]
async fn get_startup_paths(
    state: tauri::State<'_, instance::Incoming>,
) -> Result<Vec<String>, AppError> {
    guard(|| Ok(state.ready()))
}

fn startup_paths_from(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .filter(|a| !a.starts_with('-'))
        .filter(|a| {
            let lower = a.to_ascii_lowercase();
            lower.ends_with(".md")
                || lower.ends_with(".markdown")
                || lower.ends_with(".mdown")
                || lower.ends_with(".mkd")
        })
        .collect()
}

fn os_version() -> String {
    // 不引入 sysinfo（它是基准测试依赖，放在 dev 工具里更合适）。
    // Windows 上读环境变量足够用于诊断面板。
    if cfg!(windows) {
        std::env::var("OS").unwrap_or_else(|_| "Windows".to_string())
    } else {
        std::env::consts::OS.to_string()
    }
}

fn locale() -> String {
    std::env::var("LANG")
        .or_else(|_| std::env::var("LC_ALL"))
        .unwrap_or_else(|_| "zh-CN".to_string())
}

fn webview_version() -> String {
    // wry::webview_version() -> Result<String>（由 tauri 重导出为 tauri::webview_version）。
    // 返回的是版本号字符串，不是结构体。
    // 用 match 而非 unwrap：诊断信息不该让命令失败。
    match tauri::webview_version() {
        Ok(v) => v,
        Err(_) => "unknown".to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let args: Vec<String> = std::env::args().skip(1).collect();
    let initialize = || -> Result<_, AppError> {
        let m0_state = m0::M0State::from_args(&root, args.iter().cloned())?;
        let profile = desktop::Profile::from_args(&root, &args)?;
        if m0_state.config().is_some() && profile.config().is_some() {
            return Err(AppError::PathForbidden(
                "不能同时使用 M0 和 M1 隔离配置".into(),
            ));
        }
        Ok((m0_state, profile))
    };
    let (m0_state, profile) = match initialize() {
        Ok(states) => states,
        Err(error) => {
            show_native_dialog("启动参数无效", &error.to_string());
            return;
        }
    };
    let mut context = tauri::generate_context!();
    let webview_directory = match profile.webview_directory() {
        Ok(path) => path,
        Err(error) => {
            show_native_dialog("隔离配置无效", &error.to_string());
            return;
        }
    };
    if webview_directory.is_some() {
        if let Some(window) = context
            .config_mut()
            .app
            .windows
            .iter_mut()
            .find(|w| w.label == "main")
        {
            window.create = false;
        }
    }
    let key = profile
        .config()
        .map(|c| c.profile_path)
        .or_else(|| m0_state.config().map(|c| c.report_path))
        .unwrap_or_else(|| "normal".into());
    let paths = instance::paths_from(&args, &std::env::current_dir().unwrap_or_default());
    let incoming = instance::Incoming::new(paths.clone());
    let delivery = incoming.clone();
    match instance::start(&key, &paths, move |paths| delivery.deliver(paths)) {
        Ok(false) => return,
        Ok(true) => (),
        Err(error) => {
            show_native_dialog("无法连接主窗口", &error.to_string());
            return;
        }
    }
    let m0_enabled = m0_state.config().is_some();
    let result = tauri::Builder::default()
        .manage(commands::DocumentState::default())
        .manage(commands::FolderState::default())
        .manage(commands::WorkspaceState::default())
        .manage(m0_state)
        .manage(profile)
        .manage(incoming)
        .setup(move |app| {
            let log_path = if let Some(path) = app.state::<desktop::Profile>().file("errors.log")? {
                path
            } else if let Some(path) = app.state::<m0::M0State>().workspace_path()? {
                path.with_extension("errors.log")
            } else {
                app.path().app_config_dir()?.join("errors.log")
            };
            diagnostics::initialize(log_path);
            if let Some(directory) = &webview_directory {
                let config = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|w| w.label == "main")
                    .ok_or("main window config missing")?;
                tauri::WebviewWindowBuilder::from_config(app, config)?
                    .data_directory(directory.clone())
                    .build()?;
            }
            app.state::<commands::DocumentState>()
                .start_watcher(app.handle().clone())?;
            // 主窗口由 tauri.conf.json 的 app.windows 声明式创建。
            // 这里只做存在性断言，避免配置被误删后静默起空进程。
            let window = app.get_webview_window("main");
            if window.is_none() {
                eprintln!("错误：主窗口 main 未创建，请检查 tauri.conf.json 的 app.windows");
            }
            if m0_enabled {
                if let Some(window) = &window {
                    window.set_size(tauri::LogicalSize::new(1440.0, 900.0))?;
                }
            }
            if let Some(window) = &window {
                let profile = app.state::<desktop::Profile>();
                let m0 = app.state::<m0::M0State>();
                let path = if let Some(path) = profile.file("window.json")? {
                    path
                } else if let Some(path) = m0.workspace_path()? {
                    path.with_extension("window.json")
                } else {
                    app.path().app_config_dir()?.join("window.json")
                };
                // Corrupt state and write errors are non-fatal; capture/restore uses
                // available monitor work areas before attaching event persistence.
                app.manage(desktop::DesktopState::attach(window, path)?);
            }
            app.state::<instance::Incoming>()
                .attach(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_env_info,
            get_startup_paths,
            commands::open_document,
            commands::read_document,
            commands::read_document_meta,
            commands::close_document,
            commands::resolve_assets,
            commands::resolve_link,
            commands::open_url,
            commands::open_path_with_system,
            commands::reveal_document,
            commands::load_workspace_state,
            commands::save_workspace_state,
            commands::select_document,
            commands::select_files,
            commands::select_folder,
            commands::open_folder,
            commands::list_directory,
            commands::close_folder,
            commands::get_m0_config,
            commands::write_m0_report,
            desktop::get_m1_config,
            desktop::write_m1_report,
            desktop::get_desktop_state,
            desktop::m1_set_window_state,
        ])
        .run(context);

    if let Err(e) = result {
        report_fatal(&e);
        std::process::exit(1);
    }
}

// 致命错误兜底。
//
// 关键约束（docs/design/06-security.md §9 / NFR-011）：
// 若 WebView2 缺失导致窗口无法创建，提示**不能**放在 Vue 页面里 ——
// 那时 WebView 根本不存在。因此这里用原生 stderr + Windows MessageBoxW。
fn report_fatal(err: &tauri::Error) {
    diagnostics::record("startup", "E_INTERNAL");
    let msg = err.to_string();
    let is_webview_issue = msg.to_lowercase().contains("webview")
        || msg.to_lowercase().contains("webview2")
        || msg.to_lowercase().contains("edge");

    eprintln!("启动失败: {msg}");

    if is_webview_issue {
        eprintln!("提示：缺少 Microsoft Edge WebView2 Runtime。");
        eprintln!("安装地址: https://go.microsoft.com/fwlink/p/?LinkId=2124703");
        show_native_dialog(
            "缺少 Microsoft Edge WebView2 Runtime",
            "本应用需要 Microsoft Edge WebView2 Runtime 才能显示界面。\n\n\
             请安装后重新启动：\n\
             https://go.microsoft.com/fwlink/p/?LinkId=2124703",
        );
    } else {
        show_native_dialog("Cyperus 启动失败", &msg);
    }
}

// Windows 原生消息框。非 Windows 平台退化为 stderr（已打印过）。
// Windows 原生消息框。
//
// 用 MessageBoxW 而不是引入 windows-sys / rfd：
// MessageBoxW 在 user32.dll 里，kernel32/user32 由链接器默认导入，
// 只需一条 extern "system" 声明，零额外依赖。
//
// 关键点：`use std::os::windows::ffi::OsStrExt` 必须在**这个函数内部**，
// 否则非 Windows 构建会因为找不到该模块而失败。
#[cfg(windows)]
fn show_native_dialog(title: &str, body: &str) {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            hwnd: *mut core::ffi::c_void,
            text: *const u16,
            caption: *const u16,
            utype: u32,
        ) -> i32;
    }

    let to_wide = |s: &str| -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    };

    let title_w = to_wide(title);
    let body_w = to_wide(body);

    // MB_OK(0x0) | MB_ICONERROR(0x10) | MB_TOPMOST(0x40000)
    // MB_TOPMOST 很重要：启动失败时窗口可能还没获得焦点，
    // 不加的话弹窗可能被其他窗口盖住，用户看不到。
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            body_w.as_ptr(),
            title_w.as_ptr(),
            0x10 | 0x40000,
        );
    }
}

#[cfg(not(windows))]
fn show_native_dialog(_title: &str, _body: &str) {
    // 非 Windows 平台已通过 eprintln 输出，暂无原生弹窗。
    // Linux/macOS 的依赖缺失引导在 M2 做（见 docs/design/11-build-and-release.md §7）。
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_paths_exclude_options_including_m0_report() {
        let args = [
            "a.md",
            "A.MD",
            "b.markdown",
            "c.mdown",
            "d.mkd",
            "e.txt",
            "f.png",
            "g",
            "--m0-report=D:/benchmarks/probe.md",
            "--hidden.md",
        ];
        assert_eq!(
            startup_paths_from(args.map(str::to_owned)),
            ["a.md", "A.MD", "b.markdown", "c.mdown", "d.mkd"]
        );
    }

    // EnvInfo 的 JSON 形状必须与前端 EnvInfo 一致（camelCase）。
    #[test]
    fn env_info_serializes_camel_case() {
        let info = EnvInfo {
            app_version: "0.1.0".into(),
            tauri_version: "2.12.5".into(),
            rust_version: "1.99.1".into(),
            os: "windows".into(),
            os_version: "Windows".into(),
            webview_version: "WebView2".into(),
            locale: "zh-CN".into(),
            build_revision: "test".into(),
            build_time: "0".into(),
        };
        let v = serde_json::to_value(&info).unwrap();
        for key in [
            "appVersion",
            "tauriVersion",
            "rustVersion",
            "os",
            "osVersion",
            "webviewVersion",
            "locale",
        ] {
            assert!(v.get(key).is_some(), "缺少字段 {key}");
        }
    }
}
