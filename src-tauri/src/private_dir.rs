//! 建数据目录，**只给自己看**。
//!
//! 和 core 的 `tw_config::private_dir` 是同一个做法（那边建数据目录用它；这里
//! 不为这一个函数去依赖整个 tw-config）：unix 上 `mkdir` 那一刻就是 `0700`，Windows
//! 上带一份受保护的 DACL（只有当前用户和 SYSTEM），里面新建的文件跟着继承。
//! **已经存在的目录不去动** —— 用户自己放宽过的，是他的决定。
//!
//! 应用这边要它，是因为远程连接的密钥落在这个目录里（见 `connection::secrets`），
//! 而用户可能在 core 第一次起来、建出目录之前就先添加了一条远程连接。

use std::path::Path;

/// 建出数据目录。已经在了就什么都不做。
pub fn create(dir: &Path) -> std::io::Result<()> {
    if dir.exists() {
        return Ok(());
    }
    // 上级按常规建。**密钥在叶子目录里**，而叶子目录上一个受保护的 DACL
    // 已经挡住了读它内容的人 —— 上级宽松只是让人知道有这么个目录。
    if let Some(parent) = dir.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)?;
    }
    imp::create_private(dir)
}

#[cfg(not(windows))]
mod imp {
    use std::path::Path;

    /// unix：建成 `0700`。`mode` 是在 `mkdir(2)` 那一刻给的，没有先宽后收的窗口。
    pub fn create_private(dir: &Path) -> std::io::Result<()> {
        use std::os::unix::fs::DirBuilderExt;
        match std::fs::DirBuilder::new().mode(0o700).create(dir) {
            // 查过不在、建的时候却在了：别的进程抢先一步，和 `create_dir_all` 一样不算错
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && dir.is_dir() => Ok(()),
            r => r,
        }
    }
}

#[cfg(windows)]
mod imp {
    use std::path::Path;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, LocalFree};
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{
        GetTokenInformation, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser,
    };
    use windows_sys::Win32::Storage::FileSystem::CreateDirectoryW;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    pub fn create_private(dir: &Path) -> std::io::Result<()> {
        let sid = current_user_sid()?;
        // `D:P` —— 一份**受保护的** DACL：不继承父目录那些条目，否则
        // `D:\` 上那条给 `Users` 的就跟着进来了，而那正是要挡的东西。
        // `OICI` 让里面新建的文件和子目录跟着继承这两条。
        // `FA` 完全控制：当前用户，以及 SYSTEM（`SY`，不给它的话备份、
        // 索引这类系统服务会在这个目录上报错）。
        let sddl = format!("D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)");
        with_security_attributes(&sddl, |sa| {
            let path = wide(dir);
            // SAFETY: 路径是以 NUL 结尾的 UTF-16，`sa` 在这次调用期间有效。
            let ok = unsafe { CreateDirectoryW(path.as_ptr(), sa) };
            if ok == 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        })
    }

    fn wide(p: &Path) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        p.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// 当前用户的 SID，写成 `S-1-5-21-…` 那种字符串。
    ///
    /// **问令牌要，不写死任何东西。**SDDL 里有 `CO`（Creator Owner）这类
    /// 简写，但它们是给可继承条目当占位符用的，放在对象自己的 DACL 上
    /// 不代表「建它的那个人」。
    fn current_user_sid() -> std::io::Result<String> {
        struct Token(HANDLE);
        impl Drop for Token {
            fn drop(&mut self) {
                // SAFETY: 拿到过的句柄，只关一次
                unsafe { CloseHandle(self.0) };
            }
        }

        let mut raw: HANDLE = std::ptr::null_mut();
        // SAFETY: 出参是本地变量
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw) } == 0 {
            return Err(std::io::Error::last_os_error());
        }
        let token = Token(raw);

        // 先问要多大，再按那个大小要一次
        let mut len: u32 = 0;
        // SAFETY: 传空缓冲区只为问尺寸；失败是预期的（ERROR_INSUFFICIENT_BUFFER）
        unsafe { GetTokenInformation(token.0, TokenUser, std::ptr::null_mut(), 0, &mut len) };
        if len == 0 {
            return Err(std::io::Error::last_os_error());
        }
        // `TOKEN_USER` 后面跟着 SID 的字节，所以缓冲区要按它对齐 ——
        // `Vec<u8>` 只保证 1 字节对齐，而我们要把它当成那个结构体读。
        let words = (len as usize).div_ceil(std::mem::size_of::<u64>());
        let mut buf = vec![0u64; words.max(1)];
        // SAFETY: 缓冲区至少 `len` 字节，且对齐得下 TOKEN_USER
        let ok = unsafe {
            GetTokenInformation(
                token.0,
                TokenUser,
                buf.as_mut_ptr() as *mut std::ffi::c_void,
                len,
                &mut len,
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error());
        }

        // SAFETY: 调用成功，缓冲区开头是一个 TOKEN_USER
        let sid = unsafe { (*(buf.as_ptr() as *const TOKEN_USER)).User.Sid };
        let mut s: *mut u16 = std::ptr::null_mut();
        // SAFETY: `sid` 指向刚拿到的那份数据，出参是本地变量
        if unsafe { ConvertSidToStringSidW(sid, &mut s) } == 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: 转换成功，`s` 是一段以 NUL 结尾的 UTF-16，由 LocalFree 释放
        let out = unsafe {
            let mut n = 0usize;
            while *s.add(n) != 0 {
                n += 1;
            }
            let out = String::from_utf16_lossy(std::slice::from_raw_parts(s, n));
            LocalFree(s as *mut std::ffi::c_void);
            out
        };
        Ok(out)
    }

    /// 把一段 SDDL 变成 `SECURITY_ATTRIBUTES`，用完释放。
    fn with_security_attributes<T>(
        sddl: &str,
        f: impl FnOnce(*const SECURITY_ATTRIBUTES) -> std::io::Result<T>,
    ) -> std::io::Result<T> {
        let text: Vec<u16> = sddl.encode_utf16().chain(std::iter::once(0)).collect();
        let mut sd: *mut std::ffi::c_void = std::ptr::null_mut();
        // SAFETY: `text` 是以 NUL 结尾的 UTF-16；出参是本地变量
        let ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                text.as_ptr(),
                SDDL_REVISION_1,
                &mut sd,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error());
        }
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: sd,
            bInheritHandle: 0,
        };
        let r = f(&sa);
        // SAFETY: `sd` 由上面那次转换分配，只释放一次
        unsafe { LocalFree(sd) };
        r
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("tw-private-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn it_creates_the_directory_and_its_parents() {
        let dir = tmp("parents").join("a/b/data");
        create(&dir).unwrap();
        assert!(dir.is_dir());
    }

    /// 已经在了就不动它
    #[test]
    fn creating_one_that_is_already_there_is_not_an_error() {
        let dir = tmp("again");
        create(&dir).unwrap();
        std::fs::write(dir.join("x"), "1").unwrap();
        create(&dir).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("x")).unwrap(), "1");
    }

    #[cfg(unix)]
    #[test]
    fn a_new_directory_is_private_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tmp("mode").join("data");
        create(&dir).unwrap();
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700, "{mode:o}");
    }
}
