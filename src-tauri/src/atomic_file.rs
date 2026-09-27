//! 整份换掉应用自己的一个小文件（设置 `app.json`、提醒记录 `notices.json`）。
//!
//! **先写同目录下的临时文件、落盘，再改名换上去。**在原处截断重写的话，写到一半进程
//! 没了（被杀、崩溃、断电），留下的是半份或者空的 —— 读的一方只能当它坏了：设置全部
//! 回到出厂值，提醒整个列表没了。改名换上去这一步是原子的，读到的要么是完整的旧的，
//! 要么是完整的新的。
//!
//! 临时文件和目标**在同一个目录**：`rename` 跨文件系统会失败。名字里带进程号和一个
//! 序号：同时写同一个文件的两处各用各的临时文件，不会写进对方的那一份里。

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// 把 `path` 整份换成 `bytes`，所在的目录不在就建出来。**失败时原来的文件原样留着**，
/// 临时文件也收拾掉
pub fn write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = match path.parent() {
        Some(d) if !d.as_os_str().is_empty() => d,
        _ => Path::new("."),
    };
    std::fs::create_dir_all(dir)?;
    let tmp = beside(path, dir);
    let r = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        // 先落盘再换上去：不然断电之后，换上去的可能是一个内容还没写进磁盘的文件
        f.sync_all()?;
        drop(f);
        // Windows 上目标已经在也照换（`MoveFileExW` 带 `MOVEFILE_REPLACE_EXISTING`）
        std::fs::rename(&tmp, path)
    })();
    if r.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    r
}

/// `dir` 里给 `path` 用的临时文件：`.<文件名>.<进程号>.<序号>.tmp`
fn beside(path: &Path, dir: &Path) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    dir.join(format!(
        ".{name}.{}.{}.tmp",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "tw-atomic-{}-{name}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn the_new_content_replaces_the_old_and_nothing_else_is_left_behind() {
        let dir = tmp("replace");
        let file = dir.join("app.json");
        // 目录不在就建出来
        write(&file, b"{\"a\":1}").unwrap();
        write(&file, b"{\"b\":2}").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"{\"b\":2}");
        assert_eq!(names(&dir), ["app.json"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// 换不上去（这里是目标位置上有一个目录）：报错，临时文件不留下
    #[test]
    fn a_failed_replace_leaves_no_temp_file_behind() {
        let dir = tmp("failed");
        std::fs::create_dir_all(dir.join("notices.json")).unwrap();
        assert!(write(&dir.join("notices.json"), b"[]").is_err());
        assert_eq!(names(&dir), ["notices.json"]);
        assert!(dir.join("notices.json").is_dir());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// 换上去的是一个新文件，不是在原处重写：**在那之前打开它的，读到的还是完整的
    /// 上一份**。在原处截断重写的话，它读到的是新的、半份的，或者空的
    #[cfg(unix)]
    #[test]
    fn a_reader_that_opened_the_old_file_still_reads_all_of_it() {
        use std::io::Read;
        let dir = tmp("reader");
        let file = dir.join("notices.json");
        write(&file, b"[\"old\"]").unwrap();
        let mut before = std::fs::File::open(&file).unwrap();
        write(&file, b"[\"new\",\"longer\"]").unwrap();
        let mut text = String::new();
        before.read_to_string(&mut text).unwrap();
        assert_eq!(text, "[\"old\"]");
        assert_eq!(std::fs::read(&file).unwrap(), b"[\"new\",\"longer\"]");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
