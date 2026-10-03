//! 当前用户名下（HKCU）的几项注册：`thinkwatch://` 链接、系统通知的应用登记、开机自启。
//!
//! **谁运行就听谁的。**安装版和绿色版同一时间只会有一个在运行，所以每次启动都把
//! 这几项改成指向正在运行的这个 exe；清理时只删指向自己的那几项。

use std::path::Path;

/// 启动时调用：链接、开机自启（开着的话）、通知登记都改成指向正在运行的这个 exe。
/// 不是 Windows 什么都不做。
pub fn claim(app: &tauri::AppHandle) {
    let _ = app;
}

/// 清理：删掉指向 `exe` 的注册项（链接、开机自启、这一份的通知登记），每一项一行结果。
pub fn release_all(exe: &Path) -> Vec<crate::wire::UninstallStep> {
    let _ = exe;
    Vec::new()
}
