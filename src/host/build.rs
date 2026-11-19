// 构建脚本。
//
// 除了 tauri_build::build()，还做一件小事：
// 把编译期的 rustc 版本通过环境变量注入，供 lib.rs 的 get_env_info 使用。
//
// 为什么需要：`option_env!("RUSTC_VERSION")` 只有在编译期该变量存在时才展开，
// 否则恒为 None，诊断面板会显示 unknown。rustup 的 `RUSTUP_TOOLCHAIN`
// 只给名字不给版本号，所以这里直接问 rustc。
//
// 注意：build.rs 的 println! 只有在 "cargo:" 前缀下才会被 cargo 解析；
// 注入环境变量必须用 cargo:rustc-env。

use std::process::Command;

fn main() {
    inject_rustc_version();
    inject_build_identity();
    tauri_build::build();
}

fn inject_build_identity() {
    let revision = Command::new("git")
        .args(["rev-parse", "--short=12", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .unwrap_or_else(|| "source-snapshot".into());
    let dirty = Command::new("git")
        .args(["status", "--porcelain"])
        .output()
        .map(|output| !output.stdout.is_empty())
        .unwrap_or(true);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    println!(
        "cargo:rustc-env=BUILD_REVISION={revision}{}",
        if dirty { "-dirty" } else { "" }
    );
    println!("cargo:rustc-env=BUILD_TIME={stamp}");
    println!("cargo:rerun-if-changed=src");
}

fn inject_rustc_version() {
    // 允许外部覆盖（例如 CI 想固定显示时）
    if std::env::var_os("RUSTC_VERSION").is_some() {
        return;
    }

    let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());

    // 失败不 panic：诊断信息缺失不应阻断构建。
    if let Ok(out) = Command::new(&rustc).arg("--version").output() {
        if out.status.success() {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !version.is_empty() {
                println!("cargo:rustc-env=RUSTC_VERSION={version}");
            }
        }
    }

    // rustc 版本不会随源码变化，但为了配置切换时能刷新，还是声明依赖。
    println!("cargo:rerun-if-env-changed=RUSTC_VERSION");
}
