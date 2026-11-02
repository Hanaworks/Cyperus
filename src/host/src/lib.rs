// 库入口。
//
// Tauri 2 的推荐结构：main.rs 只调用 lib.rs 的 run()，
// 真正的初始化写在 lib.rs，这样移动端入口（mobile_entry_point）也能复用。
//
// 本次（T09）只建立最小可运行骨架：
// - 注册状态、命令、事件（后续 T17+ 补齐）
// - 错误兜底：WebView2 缺失时给出原生提示，而不是静默退出
// 渲染管线、文件监听、文档注册表在 T17–T27 接入。

mod error;

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
            rust_version: option_env!("RUSTC_VERSION").unwrap_or("unknown").to_string(),
            os: std::env::consts::OS.to_string(),
            os_version: os_version(),
            webview_version: webview_version(),
            locale: locale(),
        })
    })
}

// 启动时命令行传入的文件路径。
// T09 只返回参数，不打开文档；打开逻辑在 T35。
#[tauri::command]
async fn get_startup_paths() -> Result<Vec<String>, AppError> {
    guard(|| Ok(startup_paths()))
}

fn startup_paths() -> Vec<String> {
    std::env::args()
        .skip(1)
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
    let result = tauri::Builder::default()
        .setup(|app| {
            // 主窗口由 tauri.conf.json 的 app.windows 声明式创建。
            // 这里只做存在性断言，避免配置被误删后静默起空进程。
            let window = app.get_webview_window("main");
            if window.is_none() {
                eprintln!("错误：主窗口 main 未创建，请检查 tauri.conf.json 的 app.windows");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_env_info, get_startup_paths])
        .run(tauri::generate_context!());

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
        show_native_dialog("Markdown 预览启动失败", &msg);
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

    // startup_paths 必须只挑 Markdown 扩展名，且跳过以 - 开头的参数。
    // 注意：这里不直接测 startup_paths()，因为它读真实 argv。
    // 改为验证扩展名判定逻辑的等价实现。
    #[test]
    fn markdown_extension_filter() {
        let is_md = |a: &str| {
            let lower = a.to_ascii_lowercase();
            lower.ends_with(".md")
                || lower.ends_with(".markdown")
                || lower.ends_with(".mdown")
                || lower.ends_with(".mkd")
        };
        assert!(is_md("a.md"));
        assert!(is_md("A.MD"));
        assert!(is_md("b.markdown"));
        assert!(is_md("c.mdown"));
        assert!(is_md("d.mkd"));
        assert!(!is_md("e.txt"));
        assert!(!is_md("f.png"));
        assert!(!is_md("g"));
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
