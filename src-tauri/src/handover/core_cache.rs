//! Linux AppImage：core 从数据目录里的按版本缓存运行（方案 5.3、R7）。
//!
//! AppImage 跑起来时，包里的文件在一个挂载点下，**挂载随主进程退出而卸载**。交接时旧 Lite
//! 先退出、旧 core 还要接着把手上的请求做完 —— 它要是从挂载点里跑的，可执行文件就在它脚下
//! 消失了（已经映射进内存的部分还在，没读进来的页再要就是总线错误）。所以起 core 之前把包里
//! 的 `twcore` 复制到 `<数据目录>/core-cache/<版本>/twcore`，从那里运行。
//!
//! 只留当前和上一个版本：上一个正是交接时还在排空的那一个。哪个是「上一个」看目录的修改
//! 时间 —— 每次用到一个版本都碰一下它的目录（[`stage`]），最近碰过的就是最近在用的。
//!
//! 复制不成（盘满、数据目录挂在 `noexec` 上）就照旧从挂载点运行：网关照常起来，只是这一份
//! 交接时旧 core 没有退路，和今天一样。
//!
//! 逻辑本身不分平台（测试在哪都跑）；只有 Linux AppImage 真的用它
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::path::{Path, PathBuf};

/// 数据目录下缓存放在哪
pub const CACHE_DIR: &str = "core-cache";

/// 把 `src`（挂载点里的 `twcore`）放进缓存里 `version` 那一格，返回该从哪里运行。
///
/// 那一格里已经有、而且和 `src` 一样大的，不再复制（版本号相同的两次构建不会是两个
/// 文件 —— 发出去的每一版号都不同）。**写到临时文件再改名**：中途断电不会留下半个
/// 可执行文件被当成完整的
pub fn stage(src: &Path, data: &Path, version: &str) -> std::io::Result<PathBuf> {
    let file = src
        .file_name()
        .ok_or_else(|| std::io::Error::other("the core has no file name"))?;
    let cache = data.join(CACHE_DIR);
    let slot = cache.join(version);
    let target = slot.join(file);
    std::fs::create_dir_all(&slot)?;
    if !executable_here(&slot) {
        return Err(std::io::Error::other(
            "the data directory does not allow running programs (noexec)",
        ));
    }
    let want = std::fs::metadata(src)?.len();
    let have = std::fs::metadata(&target).map(|m| m.len()).ok();
    if have != Some(want) {
        let tmp = slot.join(format!(".{}.partial", file.to_string_lossy()));
        // `copy` 连权限一起带过去：包里的 twcore 本来就是可执行的
        std::fs::copy(src, &tmp)?;
        // **可写地打开**：Windows 上刷盘（FlushFileBuffers）要写权限，只读打开会被拒
        std::fs::OpenOptions::new()
            .write(true)
            .open(&tmp)?
            .sync_all()?;
        std::fs::rename(&tmp, &target)?;
    }
    touch(&slot);
    prune(&cache, version);
    Ok(target)
}

/// 碰一下目录：把它的修改时间拨到现在。**用一个记号文件**：改目录里的东西就是改目录
fn touch(slot: &Path) {
    let mark = slot.join(".used");
    let _ = std::fs::remove_file(&mark);
    let _ = std::fs::write(&mark, b"");
}

/// 只留 `current` 和除它之外最近用过的那一格。删不掉的跳过
fn prune(cache: &Path, current: &str) {
    let Ok(entries) = std::fs::read_dir(cache) else {
        return;
    };
    let mut others: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter(|e| e.file_name() != current)
        .map(|e| {
            let at = e
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            (at, e.path())
        })
        .collect();
    // 最近用过的在前，留下第一个
    others.sort_by_key(|a| std::cmp::Reverse(a.0));
    for (_, dir) in others.into_iter().skip(1) {
        if let Err(e) = std::fs::remove_dir_all(&dir) {
            tracing::info!("旧的 core 缓存 {} 没删掉：{e}", dir.display());
        }
    }
}

/// 这个目录所在的文件系统允许运行程序吗（不是 `noexec` 挂载的）。问不出来就当允许
#[cfg(target_os = "linux")]
fn executable_here(dir: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(c) = std::ffi::CString::new(dir.as_os_str().as_bytes()) else {
        return true;
    };
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: 路径以 NUL 结尾，结构体由调用方提供，只读
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return true;
    }
    (st.f_flag & libc::ST_NOEXEC) == 0
}

#[cfg(not(target_os = "linux"))]
fn executable_here(_dir: &Path) -> bool {
    true
}

/// 包里的 core 换成缓存里的那一份；放不进去就还用包里的
#[cfg(target_os = "linux")]
pub fn from_cache(inside: PathBuf, version: &str) -> PathBuf {
    match stage(&inside, &crate::data_dir(), version) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("core 放不进数据目录里的缓存，从挂载点运行：{e}");
            inside
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core_in(dir: &Path, bytes: &[u8]) -> PathBuf {
        let p = dir.join("twcore");
        std::fs::write(&p, bytes).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        p
    }

    fn slots(data: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(data.join(CACHE_DIR))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn the_core_runs_from_a_copy_in_the_data_directory() {
        let mount = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let src = core_in(mount.path(), b"core 1");
        let at = stage(&src, data.path(), "2026.10.29").unwrap();
        assert_eq!(
            at,
            data.path()
                .join(CACHE_DIR)
                .join("2026.10.29")
                .join("twcore")
        );
        assert_eq!(std::fs::read(&at).unwrap(), b"core 1");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&at).unwrap().permissions().mode();
            assert_eq!(mode & 0o111, 0o111, "复制出来的要能运行");
        }
        // 挂载点卸载之后，缓存里那一份还在
        drop(mount);
        assert!(at.exists());
    }

    /// 已经放好的不再复制；大小对不上的（上次复制到一半）重来
    #[test]
    fn an_existing_copy_is_kept_and_a_broken_one_replaced() {
        let mount = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let src = core_in(mount.path(), b"core 1");
        let at = stage(&src, data.path(), "v1").unwrap();
        let before = std::fs::metadata(&at).unwrap().modified().unwrap();
        assert_eq!(stage(&src, data.path(), "v1").unwrap(), at);
        assert_eq!(std::fs::metadata(&at).unwrap().modified().unwrap(), before);
        std::fs::write(&at, b"core").unwrap();
        stage(&src, data.path(), "v1").unwrap();
        assert_eq!(std::fs::read(&at).unwrap(), b"core 1");
    }

    /// 只留当前和上一个（最近用过的）
    #[test]
    fn only_the_current_and_the_previous_version_are_kept() {
        let mount = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let src = core_in(mount.path(), b"core");
        for v in ["v1", "v2", "v3"] {
            stage(&src, data.path(), v).unwrap();
            // 修改时间的精度：让三格分得出先后
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(slots(data.path()), ["v2", "v3"]);
        // 回到 v2（比如换回旧版）：v3 成了上一个
        stage(&src, data.path(), "v2").unwrap();
        assert_eq!(slots(data.path()), ["v2", "v3"]);
    }
}
