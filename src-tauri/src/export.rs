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
//!
//! 配置包（`.twconfig`，导出、备份的另存）是二进制：core 交来的是 Base64，网页原样交过来，
//! 这里解开再写（`base64: true`）。**读也在这一侧**（[`open_import`]、拖进窗口的文件
//! [`dropped`]）：网页拿到的只是读出来的内容，不能指定读哪个路径。

use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use tauri_plugin_dialog::DialogExt;

use crate::error::{CmdError, Out};
use crate::wire::{DroppedFile, PickedFile};

/// 配置包的扩展名
pub const PACK_EXT: &str = "twconfig";

/// 读进来的配置包最大多少（和 core 的上限一样）
pub const MAX_PACK: u64 = 16 * 1024 * 1024;

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
///
/// `base64`：`contents` 是 Base64，解开之后写（配置包）。不给是一段文字，原样写
#[tauri::command]
pub async fn save_export(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    name: String,
    contents: String,
    base64: Option<bool>,
) -> Out<Option<String>> {
    let bytes = if base64.unwrap_or(false) {
        B64.decode(contents.trim())
            .map_err(|e| CmdError::plain(format!("The file contents are not valid Base64: {e}")))?
    } else {
        contents.into_bytes()
    };
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
    crate::atomic_file::write(&path, &bytes).map_err(|e| {
        tr!(
            format!("无法写入文件 {}：{e}", path.display()),
            format!("The file {} could not be written: {e}", path.display())
        )
    })?;
    Ok(Some(path.display().to_string()))
}

/// 读一个配置包：扩展名是 `.twconfig`、是普通文件、不超过 [`MAX_PACK`]。**内容不在这里解析**：
/// 是不是配置包、要不要口令由 core 的导入预览说
pub fn read_pack(path: &Path) -> Result<PickedFile, String> {
    let shown = path.display();
    let meta = std::fs::metadata(path).map_err(|e| {
        tr!(
            format!("无法读取 {shown}：{e}"),
            format!("{shown} could not be read: {e}")
        )
    })?;
    if !meta.is_file() {
        return Err(tr!(
            format!("{shown} 不是文件。"),
            format!("{shown} is not a file.")
        ));
    }
    if meta.len() > MAX_PACK {
        return Err(tr!(
            format!("{shown} 超过 16 MiB，不是配置包。"),
            format!("{shown} is larger than 16 MiB and is not a config pack.")
        ));
    }
    let bytes = std::fs::read(path).map_err(|e| {
        tr!(
            format!("无法读取 {shown}：{e}"),
            format!("{shown} could not be read: {e}")
        )
    })?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(PickedFile {
        name,
        data_b64: B64.encode(bytes),
    })
}

/// 是不是配置包的扩展名（不分大小写）
pub fn is_pack(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(PACK_EXT))
}

/// 弹「打开」对话框，只列配置包，读出所选的那一个。用户取消了是 `None`
#[tauri::command]
pub async fn open_import(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Out<Option<PickedFile>> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_parent(&window)
        .add_filter(
            tr!("ThinkWatch 配置包", "ThinkWatch config pack"),
            &[PACK_EXT],
        )
        .pick_file(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx.await.map_err(|_| {
        tr!(
            "无法打开「打开」对话框。",
            "The open dialog could not be opened."
        )
    })?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| {
        tr!(
            format!("无法使用所选的文件：{e}"),
            format!("The chosen file cannot be used: {e}")
        )
    })?;
    tokio::task::spawn_blocking(move || read_pack(&path))
        .await
        .map_err(|e| CmdError::plain(e.to_string()))?
        .map(Some)
        .map_err(CmdError::plain)
}

/// Tauri 事件：拖着配置包进出主窗口（`true` 进来、`false` 离开或放下了），界面据此画放下的提示
pub const DRAG_EVENT: &str = "import-drag";
/// Tauri 事件：拖进主窗口放下的配置包（[`DroppedFile`]）
pub const DROP_EVENT: &str = "import-file";

/// 拖进来的东西里第一个配置包。别的文件不理
fn first_pack(paths: &[PathBuf]) -> Option<&PathBuf> {
    paths.iter().find(|p| is_pack(p))
}

/// 主窗口上的拖放（`lib.rs` 的窗口事件）。**只认配置包**：拖进来的不是它就当没看见；放下时由这
/// 一侧读文件，网页拿到的是内容，不是路径
pub fn dropped(window: &tauri::Window, event: &tauri::DragDropEvent) {
    use tauri::Emitter;
    match event {
        tauri::DragDropEvent::Enter { paths, .. } => {
            if first_pack(paths).is_some() {
                let _ = window.emit(DRAG_EVENT, true);
            }
        }
        tauri::DragDropEvent::Leave => {
            let _ = window.emit(DRAG_EVENT, false);
        }
        tauri::DragDropEvent::Drop { paths, .. } => {
            let _ = window.emit(DRAG_EVENT, false);
            let Some(path) = first_pack(paths).cloned() else {
                return;
            };
            let window = window.clone();
            tauri::async_runtime::spawn(async move {
                let read = tokio::task::spawn_blocking(move || read_pack(&path)).await;
                let out = match read {
                    Ok(Ok(file)) => DroppedFile::File { file },
                    Ok(Err(text)) => DroppedFile::Failed {
                        error: CmdError::plain(text).into_msg(),
                    },
                    Err(e) => DroppedFile::Failed {
                        error: CmdError::plain(e.to_string()).into_msg(),
                    },
                };
                let _ = window.emit(DROP_EVENT, out);
            });
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 只认 `.twconfig`，不分大小写；别的扩展名、没有扩展名的不当配置包
    #[test]
    fn only_twconfig_files_count_as_packs() {
        assert!(is_pack(Path::new("/x/ThinkWatch-2026-10-18.twconfig")));
        assert!(is_pack(Path::new("备份.TWConfig")));
        assert!(!is_pack(Path::new("config.yaml")));
        assert!(!is_pack(Path::new("twconfig")));
        let paths = vec![
            PathBuf::from("/a/readme.md"),
            PathBuf::from("/a/b.twconfig"),
        ];
        assert_eq!(first_pack(&paths), Some(&PathBuf::from("/a/b.twconfig")));
    }

    /// 读出来的是原样的字节（Base64），文件名不带目录；目录、太大的文件读不了
    #[test]
    fn a_pack_is_read_as_base64_and_limits_are_kept() {
        let dir = std::env::temp_dir().join(format!("tw-export-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.twconfig");
        std::fs::write(&file, [0u8, 1, 2, 255]).unwrap();
        let got = read_pack(&file).unwrap();
        assert_eq!(got.name, "a.twconfig");
        assert_eq!(B64.decode(got.data_b64).unwrap(), vec![0u8, 1, 2, 255]);
        assert!(read_pack(&dir).is_err());
        let big = dir.join("big.twconfig");
        let f = std::fs::File::create(&big).unwrap();
        f.set_len(MAX_PACK + 1).unwrap();
        assert!(read_pack(&big).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

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
