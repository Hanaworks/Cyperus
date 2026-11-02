// 桌面入口。
//
// 保持极简：只调用库的 run()。
// 这样做的好处是移动端构建可以复用 lib.rs 的初始化逻辑（Tauri 2 官方推荐结构）。
//
// 不在这里捕获错误：错误兜底（含 WebView2 缺失的原生提示）在 lib.rs 的 run() 里，
// 集中一处避免两套处理逻辑分叉。

// Windows release 构建不弹出控制台窗口。
// debug 构建保留控制台，便于看 eprintln 诊断输出。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    md_preview_lib::run()
}
