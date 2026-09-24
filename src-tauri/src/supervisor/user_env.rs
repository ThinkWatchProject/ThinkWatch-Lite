//! 用户配的环境变量：core 每次起之前现取一份，补进它的环境。
//!
//! 上游的密钥、请求头里可以写 `${变量名}`，core 用**它自己进程的**环境展开。
//! 而 core 的环境是从桌面应用继承来的，桌面应用的又是从谁拉起它继承来的：
//!
//! - **macOS**：从访达、程序坞、登录项打开时，环境来自 launchd，只有 `HOME`、
//!   `PATH` 那几个。写在 `~/.zshrc` 里的 `export OPENAI_API_KEY=…` 它看不见
//!   —— 而那几乎是所有人配环境变量的地方。所以去问用户的登录 shell：以交互式
//!   登录 shell 跑一次 `env -0`，`.zprofile`、`.zshrc` 都会被读到。
//! - **Linux**：同一个问题，同一个办法。桌面会话最多读过 `~/.profile`，
//!   `~/.bashrc`、fish 的 `config.fish` 里的 `export` / `set -x` 从应用菜单
//!   打开的程序看不见。
//! - **Windows**：环境来自注册表，但**是应用启动那一刻的**。应用开着时在系统
//!   设置里改了变量，它和它拉起的 core 都还拿着旧值。所以每次现读注册表。
//!
//! **每次起 core 都重新取**，不是应用启动时取一次：core 崩了被重新拉起、或者
//! 被重启时，拿到的是那一刻的值，而不是应用打开那天的。
//!
//! 这个文件只用 `std`、`tokio`、`libc` 和 `windows-sys`，不引 `crate::` —— Windows 那一支
//! 要能摘进临时 crate 交叉编译。

/// 取一份，过滤好了，直接交给 `Command::envs`。取不到就是空的：那时 core 仍然
/// 继承应用自己的环境，和以前一样。
pub async fn load() -> Vec<(String, String)> {
    read().await.into_iter().filter(|(k, _)| keep(k)).collect()
}

/// 这个变量能不能从用户环境带给 core。
///
/// 带过去的变量**会盖掉应用自己的同名变量**：改过的值要能生效。所以会改变
/// core 行为、而不只是给 `${…}` 取值的那些一律不带，保持应用自己的：
///
/// - 自己人：`THINKWATCH_HOME` 决定数据目录，从 shell 带一个不同的过去，core 和
///   界面就各看各的数据了；`TW_*` 是 core 自己的开关。
/// - 代理：「系统代理」这一档会读 `HTTPS_PROXY` 这些。终端里为了别的工具设的
///   代理，不该悄悄改掉网关的出站路径。
/// - `PATH`：Windows 上系统和用户各有一份、要拼起来才对，单拿一份会更糟。
/// - `RUST_*`（日志、回溯）、`DYLD_*` / `LD_*`（动态库注入）。
/// - shell 自己的簿记：`PWD`、`OLDPWD`、`SHLVL`、`_`。
///
/// 比较不分大小写：Windows 的变量名本来就不分，而代理变量小写的也算数。
fn keep(name: &str) -> bool {
    const EXACT: &[&str] = &[
        "PATH",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "PWD",
        "OLDPWD",
        "SHLVL",
        "_",
    ];
    const PREFIX: &[&str] = &["THINKWATCH_", "TW_", "RUST_", "DYLD_", "LD_"];
    let upper = name.to_ascii_uppercase();
    !name.is_empty()
        && !EXACT.contains(&upper.as_str())
        && !PREFIX.iter().any(|p| upper.starts_with(p))
}

#[cfg(unix)]
async fn read() -> Vec<(String, String)> {
    shell::read().await
}

#[cfg(windows)]
async fn read() -> Vec<(String, String)> {
    registry::read()
}

/// 夹住 `env -0` 输出的记号。交互式 shell 启动时可能自己打印东西（欢迎语、
/// 插件的提示），只认两个记号之间的那段。
#[cfg_attr(windows, allow(dead_code))]
const MARK: &str = "__THINKWATCH_ENV_7f3c__";

/// 从 `记号 + env -0 + 记号` 里拆出变量。值里可以有换行，所以用 `-0`。
#[cfg_attr(windows, allow(dead_code))]
fn parse_env0(out: &[u8]) -> Vec<(String, String)> {
    let text = String::from_utf8_lossy(out);
    let Some(start) = text.find(MARK) else {
        return Vec::new();
    };
    let rest = &text[start + MARK.len()..];
    let Some(end) = rest.find(MARK) else {
        return Vec::new();
    };
    rest[..end]
        .split('\0')
        .filter_map(|entry| {
            let (k, v) = entry.split_once('=')?;
            Some((k.to_string(), v.to_string()))
        })
        .collect()
}

#[cfg(unix)]
mod shell {
    use std::process::Stdio;
    use std::time::Duration;

    /// 最多等这么久。交互式 shell 的配置慢的要一两秒；卡住的（比如在等一个
    /// 永远不会来的输入）不能拖住 core 起来。
    const WITHIN: Duration = Duration::from_secs(5);

    pub async fn read() -> Vec<(String, String)> {
        let shell = login_shell();
        let script = format!(
            "printf %s {m}; /usr/bin/env -0; printf %s {m}",
            m = super::MARK
        );
        let run = tokio::process::Command::new(&shell)
            // -l 读 .zprofile / .profile，-i 读 .zshrc / .bashrc
            .args(["-l", "-i", "-c", &script])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .output();
        match tokio::time::timeout(WITHIN, run).await {
            Ok(Ok(out)) => super::parse_env0(&out.stdout),
            Ok(Err(e)) => {
                tracing::warn!(%shell, "could not run the login shell to read its environment: {e}");
                Vec::new()
            }
            Err(_) => {
                tracing::warn!(%shell, "the login shell took too long to report its environment");
                Vec::new()
            }
        }
    }

    /// 用哪个 shell：`$SHELL`，没有就问账户数据库（`/etc/passwd`、LDAP 之类，
    /// `getpwuid` 替我们查），再没有才按平台猜。
    ///
    /// **不能一律猜 zsh。**那是 macOS 的默认；Linux 上多数人用 bash，有的
    /// 发行版根本没装 zsh —— 猜错了就是起不来，一个变量都拿不到。
    fn login_shell() -> String {
        std::env::var("SHELL")
            .ok()
            .filter(|s| s.starts_with('/'))
            .or_else(from_passwd)
            .unwrap_or_else(|| {
                if cfg!(target_os = "macos") {
                    "/bin/zsh".into()
                } else {
                    "/bin/sh".into()
                }
            })
    }

    /// 这个用户在账户数据库里登记的登录 shell。
    pub(super) fn from_passwd() -> Option<String> {
        // `getpwuid_r` 而不是 `getpwuid`：后者返回一块全进程共用的静态内存，
        // 别的线程同时查一次就把它改掉了
        let mut pw: libc::passwd = unsafe { std::mem::zeroed() };
        let mut out: *mut libc::passwd = std::ptr::null_mut();
        let mut buf = vec![0 as libc::c_char; 4096];
        // SAFETY: 缓冲区和给出的长度一致；成功时 `pw` 里的指针都指进 `buf`，
        // 下面在 `buf` 还活着的时候就把字符串拷了出来。
        let rc = unsafe {
            libc::getpwuid_r(
                libc::getuid(),
                &mut pw,
                buf.as_mut_ptr(),
                buf.len(),
                &mut out,
            )
        };
        if rc != 0 || out.is_null() || pw.pw_shell.is_null() {
            return None;
        }
        // SAFETY: 同上，`pw_shell` 指进 `buf`，以 NUL 结尾
        let shell = unsafe { std::ffi::CStr::from_ptr(pw.pw_shell) }
            .to_string_lossy()
            .into_owned();
        shell.starts_with('/').then_some(shell)
    }
}

#[cfg(windows)]
mod registry {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW;
    use windows_sys::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, REG_EXPAND_SZ, REG_SZ, RegCloseKey,
        RegEnumValueW, RegOpenKeyExW,
    };

    /// 系统的在前，用户的在后：同名时用户的盖掉系统的，和 Windows 自己拼环境
    /// 一样（`Path` 例外，但它本来就不带过去）。
    pub fn read() -> Vec<(String, String)> {
        let mut vars = values(
            HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
        );
        vars.extend(values(HKEY_CURRENT_USER, "Environment"));
        vars
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn values(root: HKEY, sub: &str) -> Vec<(String, String)> {
        let sub = wide(sub);
        let mut key: HKEY = std::ptr::null_mut();
        // SAFETY: `sub` 以 NUL 结尾；成功时 `key` 是一个要自己关的句柄。
        if unsafe { RegOpenKeyExW(root, sub.as_ptr(), 0, KEY_READ, &mut key) } != ERROR_SUCCESS {
            return Vec::new();
        }
        let mut out = Vec::new();
        let mut name = vec![0u16; 16_384];
        let mut data = vec![0u8; 64 * 1024];
        for index in 0.. {
            let mut name_len = name.len() as u32;
            let mut data_len = data.len() as u32;
            let mut kind = 0u32;
            // SAFETY: 两个长度一开始都是各自缓冲区的大小，函数不会写超过它。
            let rc = unsafe {
                RegEnumValueW(
                    key,
                    index,
                    name.as_mut_ptr(),
                    &mut name_len,
                    std::ptr::null(),
                    &mut kind,
                    data.as_mut_ptr(),
                    &mut data_len,
                )
            };
            if rc != ERROR_SUCCESS {
                // 枚举完了（ERROR_NO_MORE_ITEMS），或者某个值大得离谱：到此为止
                break;
            }
            if kind != REG_SZ && kind != REG_EXPAND_SZ {
                continue;
            }
            let units: Vec<u16> = data[..data_len as usize]
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| u16::from_le_bytes(*b))
                .take_while(|&u| u != 0)
                .collect();
            let mut value = String::from_utf16_lossy(&units);
            if kind == REG_EXPAND_SZ {
                value = expand(&value);
            }
            out.push((String::from_utf16_lossy(&name[..name_len as usize]), value));
        }
        // SAFETY: `key` 是上面打开成功的那个句柄，只关这一次。
        unsafe { RegCloseKey(key) };
        out
    }

    /// `%USERPROFILE%\bin` 这种。展开用的是应用自己的环境 —— 被引用的多是
    /// `USERPROFILE`、`SystemRoot` 这类不会变的。
    fn expand(s: &str) -> String {
        let src = wide(s);
        let mut buf = vec![0u16; 32 * 1024];
        // SAFETY: `src` 以 NUL 结尾；`buf.len()` 是缓冲区的大小。
        let n =
            unsafe { ExpandEnvironmentStringsW(src.as_ptr(), buf.as_mut_ptr(), buf.len() as u32) };
        if n == 0 || n as usize > buf.len() {
            return s.to_string();
        }
        // n 含结尾的 NUL
        String::from_utf16_lossy(&buf[..n as usize - 1])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_what_sits_between_the_marks_counts() {
        let out = format!(
            "Welcome back!\n{MARK}OPENAI_API_KEY=sk-1\0MULTI=a\nb\0EMPTY=\0{MARK}prompt noise"
        );
        assert_eq!(
            parse_env0(out.as_bytes()),
            vec![
                ("OPENAI_API_KEY".into(), "sk-1".into()),
                ("MULTI".into(), "a\nb".into()),
                ("EMPTY".into(), "".into()),
            ]
        );
    }

    #[test]
    fn a_value_may_contain_equals_signs() {
        let out = format!("{MARK}TOKEN=a=b==\0{MARK}");
        assert_eq!(
            parse_env0(out.as_bytes()),
            vec![("TOKEN".into(), "a=b==".into())]
        );
    }

    #[test]
    fn without_both_marks_nothing_is_trusted() {
        assert!(parse_env0(b"OPENAI_API_KEY=sk-1\0").is_empty());
        assert!(parse_env0(format!("{MARK}OPENAI_API_KEY=sk-1\0").as_bytes()).is_empty());
    }

    #[test]
    fn variables_that_change_how_core_behaves_stay_the_apps_own() {
        for name in [
            "PATH",
            "Path",
            "https_proxy",
            "HTTPS_PROXY",
            "no_proxy",
            "THINKWATCH_HOME",
            "TW_LOG",
            "RUST_LOG",
            "DYLD_INSERT_LIBRARIES",
            "SHLVL",
            "_",
            "",
        ] {
            assert!(!keep(name), "{name} should not be carried over");
        }
        for name in ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "HOME", "MY_ORG"] {
            assert!(keep(name), "{name} should be carried over");
        }
    }

    /// 真跑一次登录 shell。**记号之间真的拿到了东西**，而不是超时或者被
    /// shell 的启动输出搅乱之后返回空的 —— 那样 `load` 也不会报错，只是悄悄没用。
    #[cfg(unix)]
    #[tokio::test]
    async fn the_login_shell_reports_its_environment() {
        let vars = shell::read().await;
        assert!(
            vars.iter().any(|(k, v)| k == "HOME" && !v.is_empty()),
            "{vars:?}"
        );
    }

    /// 账户数据库里这个用户有一个登录 shell，而且是绝对路径 —— CI 和开发机
    /// 上都是。查不到的话 `$SHELL` 不在时就只能靠猜。
    #[cfg(unix)]
    #[test]
    fn the_account_database_names_a_login_shell() {
        let shell = shell::from_passwd().expect("getpwuid_r found no shell");
        assert!(shell.starts_with('/'), "{shell}");
    }
}
