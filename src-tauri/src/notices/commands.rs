//! 提醒页的命令：列表、已读、提醒方式之外的那几样。

use std::sync::Arc;

use crate::error::Out;
use crate::notices;

/// 现在挂着的通知。**关窗期间发生的事也在里面** —— 判定在 Rust 侧，界面来取
#[tauri::command]
pub fn notices_list(notices: tauri::State<'_, Arc<notices::Notices>>) -> Vec<notices::Notice> {
    notices.list()
}

/// 用户看过了一条。**它还留在列表里**，只是铃铛不再数它
#[tauri::command]
pub async fn mark_notice_read(
    notices: tauri::State<'_, Arc<notices::Notices>>,
    key: String,
) -> Out<()> {
    off_main(&notices, move |n| n.mark_read(&key)).await
}

/// 全部看过了
#[tauri::command]
pub async fn mark_all_notices_read(notices: tauri::State<'_, Arc<notices::Notices>>) -> Out<()> {
    off_main(&notices, |n| n.mark_all_read()).await
}

/// 清空提醒列表
#[tauri::command]
pub async fn clear_notices(notices: tauri::State<'_, Arc<notices::Notices>>) -> Out<()> {
    off_main(&notices, |n| n.clear_all()).await
}

/// 改了列表就要落盘（`notices.json` 整份换上去之前先落盘，macOS 上一次好几毫秒）：
/// **放在阻塞线程上**。同步命令跑在主线程上，那几毫秒里整个界面都不动
async fn off_main(
    notices: &Arc<notices::Notices>,
    f: impl FnOnce(&notices::Notices) + Send + 'static,
) -> Out<()> {
    let n = notices.clone();
    crate::clients::blocking(move || f(&n)).await
}

/// 点通知新建的窗口挂上之后，来取要落的那一页
#[tauri::command]
pub fn take_pending_view() -> Option<String> {
    notices::take_pending_view()
}
