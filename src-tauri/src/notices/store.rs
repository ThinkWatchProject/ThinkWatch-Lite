//! 开着的通知落盘。
//!
//! **为了两件事**：关窗期间发生的事，下次开窗要还在；core 或者应用重启之后，
//! 同一件事不要再说一遍（core 进程里的「已经报过」集合重启就清空了）。
//!
//! 读不出来就当作空的 —— 一份坏掉的通知记录不该挡住应用启动。

use std::path::Path;

use super::Notice;

pub fn load(file: &Path) -> Vec<Notice> {
    let Ok(text) = std::fs::read_to_string(file) else {
        return Vec::new();
    };
    serde_json::from_str(&text).unwrap_or_else(|e| {
        tracing::debug!("通知记录读不出来，按空的算：{e}");
        Vec::new()
    })
}

pub fn save(file: &Path, all: &[Notice]) {
    let Ok(text) = serde_json::to_string(all) else {
        return;
    };
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // 写不进去只是下次重启少一份记录，不值得打断任何事
    if let Err(e) = std::fs::write(file, text) {
        tracing::debug!("通知记录写不进去：{e}");
    }
}
