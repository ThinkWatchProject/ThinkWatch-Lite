//! 绿色版：Windows 上解压即用的 zip。
//!
//! 和安装版的区别只在三处：数据放在 exe 旁边的 `data\`（安装版在
//! `%APPDATA%\ThinkWatch`）、自更新换的是这个文件夹里的文件（不跑安装程序）、
//! twcore 只认同目录那一份。怎么认出自己是绿色版见 [`is_portable`]。

use std::path::PathBuf;

/// 启动最早的一步：绿色版把数据目录定在 exe 旁边的 `data\`，并确认能写。
///
/// 写不进时弹系统对话框，然后退出进程。不是绿色版什么都不做。
/// **必须在任何线程起来之前调用**：它要改进程的环境变量（`THINKWATCH_HOME`）。
pub fn prepare() {}

/// 这一份是不是绿色版。
pub fn is_portable() -> bool {
    false
}

/// 绿色版的 WebView2 数据目录（`data\webview`）。不是绿色版时是 `None`，窗口用框架的默认位置。
pub fn webview_data_dir() -> Option<PathBuf> {
    None
}
