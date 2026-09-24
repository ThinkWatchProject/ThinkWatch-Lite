//! 提醒页的命令：列表、已读、提醒方式之外的那几样。

use std::sync::Arc;

use crate::notices;

/// 现在挂着的通知。**关窗期间发生的事也在里面** —— 判定在 Rust 侧，界面来取
#[tauri::command]
pub fn notices_list(notices: tauri::State<'_, Arc<notices::Notices>>) -> Vec<notices::Notice> {
    notices.list()
}

/// 用户看过了一条。**它还留在列表里**，只是铃铛不再数它
#[tauri::command]
pub fn mark_notice_read(notices: tauri::State<'_, Arc<notices::Notices>>, key: String) {
    notices.mark_read(&key);
}

/// 全部看过了
#[tauri::command]
pub fn mark_all_notices_read(notices: tauri::State<'_, Arc<notices::Notices>>) {
    notices.mark_all_read();
}

/// 清空提醒列表
#[tauri::command]
pub fn clear_notices(notices: tauri::State<'_, Arc<notices::Notices>>) {
    notices.clear_all();
}

/// 点通知新建的窗口挂上之后，来取要落的那一页
#[tauri::command]
pub fn take_pending_view() -> Option<String> {
    notices::take_pending_view()
}
