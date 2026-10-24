//! Windows 安装版：把运行中的 `twcore.exe` 让出来给安装程序（方案 5.3）。
//!
//! 安装程序要覆盖 `twcore.exe`，而交接时旧 core 还要接着跑完手上的请求 —— 以前的做法是先
//! 停掉它。**NTFS 允许给运行中的可执行文件改名**：调安装程序之前把它改成
//! `twcore.old-<pid>.exe`，它照常跑到排空退出，安装程序在腾出来的名字上写新版本。改出来
//! 的文件下次启动时清掉（[`sweep`]），删不掉（那个 core 还在排空）就留到下一次。
//!
//! 绿色版不走这里：它换文件本来就是改名替换（`portable::swap_in`）。
//!
//! 判断和改名本身不分平台（测试在哪都跑）；只有 Windows 安装版真的用它
#![cfg_attr(not(windows), allow(dead_code))]

use std::path::{Path, PathBuf};

use crate::gateway::CORE_EXE;

/// 改名之后叫什么：`twcore.old-<pid>.exe`。**带 pid**：上一个还在排空时又更新了一次，两个
/// 旧的不会撞名
pub fn retired_name(pid: u32) -> String {
    format!("twcore.old-{pid}.exe")
}

/// 这是不是改名改出来的那种文件。**只认这一种形状**：安装目录是我们的，但别的 `.exe`
/// 不是这里改出来的，不碰
pub fn is_retired(name: &str) -> bool {
    name.strip_prefix("twcore.old-")
        .and_then(|r| r.strip_suffix(".exe"))
        .is_some_and(|pid| !pid.is_empty() && pid.bytes().all(|b| b.is_ascii_digit()))
}

/// 把 `dir` 里运行中的 `twcore.exe` 改名让出来，返回改成的路径
pub fn retire(dir: &Path, pid: u32) -> std::io::Result<PathBuf> {
    let to = dir.join(retired_name(pid));
    std::fs::rename(dir.join(CORE_EXE), &to)?;
    Ok(to)
}

/// 安装没成：改回去。那个 core 还在跑，改名照样可以
pub fn restore(dir: &Path, retired: &Path) -> std::io::Result<()> {
    std::fs::rename(retired, dir.join(CORE_EXE))
}

/// 删掉 `dir` 里上次改出来的文件。删不掉的跳过（那个 core 还在排空），返回删掉了几个
pub fn sweep(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|e| e.file_name().to_str().is_some_and(is_retired))
        .filter(|e| match std::fs::remove_file(e.path()) {
            Ok(()) => true,
            Err(err) => {
                tracing::info!("上次更新改名留下的 {:?} 这次没删掉：{err}", e.file_name());
                false
            }
        })
        .count()
}

/// 启动时在后台清一次。只在 Windows 安装版上做：别处不会有这种文件
#[cfg(windows)]
pub fn sweep_in_background() {
    if crate::update::kind() != crate::update::Install::Standalone {
        return;
    }
    let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(Path::to_path_buf))
    else {
        return;
    };
    std::thread::spawn(move || {
        let n = sweep(&dir);
        if n > 0 {
            tracing::info!("清掉了 {n} 个上次更新改名留下的 core");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_names_we_make_are_recognised() {
        assert_eq!(retired_name(4242), "twcore.old-4242.exe");
        assert!(is_retired(&retired_name(4242)));
        for other in [
            "twcore.exe",
            "twcore.old-.exe",
            "twcore.old-12a.exe",
            "twcore.old-12.exe.bak",
            "twcore.exe.old",
            "ThinkWatch Lite.exe",
            "xtwcore.old-12.exe",
        ] {
            assert!(!is_retired(other), "{other}");
        }
    }

    #[test]
    fn the_core_is_renamed_aside_and_back() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join(CORE_EXE), b"MZ old").unwrap();
        let aside = retire(d.path(), 77).unwrap();
        assert_eq!(aside, d.path().join("twcore.old-77.exe"));
        assert!(!d.path().join(CORE_EXE).exists());
        // 安装程序在腾出来的名字上写新的
        std::fs::write(d.path().join(CORE_EXE), b"MZ new").unwrap();
        std::fs::remove_file(d.path().join(CORE_EXE)).unwrap();
        // 没装成：改回去
        restore(d.path(), &aside).unwrap();
        assert_eq!(std::fs::read(d.path().join(CORE_EXE)).unwrap(), b"MZ old");
    }

    /// 没有 `twcore.exe` 可让（被删了、目录不对）：报错，调用方退回现行流程
    #[test]
    fn retiring_a_missing_core_fails() {
        let d = tempfile::tempdir().unwrap();
        assert!(retire(d.path(), 1).is_err());
    }

    /// 清理只删改名改出来的，别的文件都不碰
    #[test]
    fn sweeping_removes_only_retired_cores() {
        let d = tempfile::tempdir().unwrap();
        for f in [
            "twcore.old-1.exe",
            "twcore.old-2.exe",
            "twcore.exe",
            "uninstall.exe",
            "twcore.exe.old",
        ] {
            std::fs::write(d.path().join(f), b"x").unwrap();
        }
        assert_eq!(sweep(d.path()), 2);
        let mut left: Vec<String> = std::fs::read_dir(d.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, ["twcore.exe", "twcore.exe.old", "uninstall.exe"]);
        assert_eq!(sweep(&d.path().join("nope")), 0);
    }
}
