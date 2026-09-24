//! 诊断包：由 core 攒内容，这一侧写到磁盘上。

use tw_api::ep;

use crate::{
    AppState, data_dir,
    error::{Out, text},
};

/// 攒一份诊断包，写到磁盘上，把路径交回去。
///
/// **写文件是这一侧的事，不是 core 的。**core 只负责把内容攒出来 ——
/// 「往哪儿写」是个桌面概念，而它在无头运行时根本不存在。
#[tauri::command]
pub async fn save_diagnostics(state: tauri::State<'_, AppState>) -> Out<String> {
    let text = state
        .control
        .call::<ep::Diagnostics>(&[], &())
        .await
        .map_err(text)?;
    let dir = data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| {
        tr!(
            format!("无法创建目录 {}：{e}", dir.display()),
            format!("The directory {} could not be created: {e}", dir.display())
        )
    })?;
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 文件名界面上看得见（「已生成：…」），所以也跟着语言走
    let path = dir.join(tr!(
        format!("诊断包-{at}.md"),
        format!("diagnostics-{at}.md")
    ));
    write_private(&path, text.as_bytes()).map_err(|e| {
        tr!(
            format!("无法写入文件 {}：{e}", path.display()),
            format!("The file {} could not be written: {e}", path.display())
        )
    })?;
    Ok(path.display().to_string())
}

/// 建的时候就是 `0600`。
///
/// 诊断包里是脱敏过的，但它仍然描述了这台机器上有哪些上游、哪些客户端 ——
/// 同机器上的其他用户没有理由读到。**不是写完再 `chmod`**：那中间有一个按
/// umask 谁都能读的窗口。同一秒里点两次会撞上同一个名字，先删掉再建，否则
/// `mode` 对已经存在的文件不生效（core 写控制面凭据是同一个做法）。
pub(crate) fn write_private(path: &std::path::Path, contents: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let _ = std::fs::remove_file(path);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)?.write_all(contents)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 诊断包从建出来那一刻就只有属主能读；同一秒再写一次也照样是 0600、内容是新的
    #[test]
    fn the_diagnostics_file_is_private_from_the_start_and_can_be_rewritten() {
        let dir = std::env::temp_dir().join(format!("tw-diag-{}", crate::token::generate()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("diagnostics-1.md");
        write_private(&path, b"first").unwrap();
        write_private(&path, b"second").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
