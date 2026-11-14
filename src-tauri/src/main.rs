// 生产构建下不弹控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 菜单栏子进程只跑 AppKit，必须在 Tauri、数据目录和 core 初始化之前分流。
    #[cfg(target_os = "macos")]
    if thinkwatch_lite_lib::menubar::helper::run_if_requested() {
        return;
    }
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("TWLITE_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
    thinkwatch_lite_lib::run()
}
