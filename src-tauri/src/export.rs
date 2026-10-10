//! 导出文件：弹系统的「存储」对话框，把网页拼好的内容写到用户选的地方。
//!
//! 第一个用它的是安全日志的导出（JSON / CSV）。内容在网页里拼：命中的细节、表头的
//! 语言都在那一侧，这里只管「存到哪儿」和写盘。
//!
//! **对话框和写文件都在这一侧，网页没有这两样权限。**存储对话框来自 dialog 插件，
//! 但只从 Rust 调（`DialogExt`）：`capabilities/` 里没有给网页任何 `dialog:` 权限，插件
//! 自己的命令网页调不动；也没有装 fs 插件。网页能做的只有这一条命令 —— 交出一段文字和一个
//! 默认文件名，写到哪儿由用户在系统对话框里选，网页决定不了路径。
//!
//! 写盘走 `atomic_file::write`：先写同目录的临时文件再换上去，覆盖已有的文件时写到一半
//! 失败，原来的那份原样留着。

use std::path::Path;

use tauri_plugin_dialog::DialogExt;

use crate::error::Out;

/// 按默认文件名的扩展名给对话框一个类型过滤（`安全日志-….csv` → `CSV`, `csv`）。
/// 没有扩展名就不过滤
fn filter_of(name: &str) -> Option<(String, String)> {
    let ext = Path::new(name).extension()?.to_str()?.to_ascii_lowercase();
    if ext.is_empty() {
        return None;
    }
    Some((ext.to_ascii_uppercase(), ext))
}

/// 弹「存储」对话框，默认文件名是 `name`，把 `contents` 写到用户选的地方。返回写到的路径；
/// 用户取消了是 `None`。
///
/// 对话框挂在发起导出的那个窗口上（macOS 上是从窗口顶上滑下来的那种）。等用户选的这一会儿
/// 不占着运行时的线程：插件在主线程上弹框，选好了从回调里交回来。
#[tauri::command]
pub async fn save_export(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    name: String,
    contents: String,
) -> Out<Option<String>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file().set_file_name(&name).set_parent(&window);
    if let Some((label, ext)) = filter_of(&name) {
        dialog = dialog.add_filter(label, &[ext.as_str()]);
    }
    dialog.save_file(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = rx.await.map_err(|_| {
        tr!(
            "无法打开存储对话框。",
            "The save dialog could not be opened."
        )
    })?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| {
        tr!(
            format!("无法使用所选的位置：{e}"),
            format!("The chosen location cannot be used: {e}")
        )
    })?;
    crate::atomic_file::write(&path, contents.as_bytes()).map_err(|e| {
        tr!(
            format!("无法写入文件 {}：{e}", path.display()),
            format!("The file {} could not be written: {e}", path.display())
        )
    })?;
    Ok(Some(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 对话框的类型过滤跟着默认文件名的扩展名走；中文文件名照样认，没有扩展名就不过滤
    #[test]
    fn the_save_dialog_filters_by_the_default_names_extension() {
        assert_eq!(
            filter_of("安全日志-2026-10-10-1642.csv"),
            Some(("CSV".into(), "csv".into()))
        );
        assert_eq!(
            filter_of("security-log-2026-10-10-1642.JSON"),
            Some(("JSON".into(), "json".into()))
        );
        assert_eq!(filter_of("security-log"), None);
        assert_eq!(filter_of("security-log."), None);
    }
}
