//! 系统卸载程序调用的无界面清理：`--uninstall-cleanup`（可带 `--delete-data`）。
//!
//! 和应用内「卸载」走同一套步骤（见 `uninstall`）：还原接管过的客户端（含 WSL 里的）、
//! 删掉指向这个 exe 的注册项、按要求删除数据目录。不起窗口，做完就退出，退出码说明
//! 结果：每一步都做成了是 0，否则是 1。
//!
//! 调用方是安装版的卸载程序（`src-tauri/windows/hooks.nsh`）：它先关掉正在运行的应用，
//! 再带着这个参数运行同一个 exe、等它退出，然后才删文件。所以这里**不碰单实例的锁**
//! （在 `single::precheck` 之前）、不要 WebView2。
//!
//! **它清理的是运行它的那个用户。**卸载程序以管理员身份运行；标准账户输入管理员的
//! 密码卸载时，跑在管理员账户下，清理的是管理员的配置 —— 这种情况应先在应用内卸载
//! （README 里写了）。

use std::time::Duration;

use crate::uninstall::{self, Retry};
use crate::wire::UninstallStep;

/// 命令行里要的那一次清理
#[derive(Debug, PartialEq, Eq)]
struct Request {
    /// `--delete-data`：卸载程序里「同时删除数据」那个勾选框勾上了
    delete_data: bool,
}

const FLAG: &str = "--uninstall-cleanup";
const DELETE_DATA: &str = "--delete-data";

/// 卸载程序删数据目录时等 core 放手：它靠 `--parent` 守望两秒看一次父进程，应用被关掉
/// 之后最晚两三秒就走；留出余量，又不能让卸载程序一直卡着
const DROP_RETRY: Retry = Retry {
    tries: 20,
    pause: Duration::from_millis(500),
};

/// 等 core 退出最多等多久，见 [`wait_for_core`]
const CORE_EXIT: Duration = Duration::from_secs(10);

fn parse<S: AsRef<str>>(args: impl IntoIterator<Item = S>) -> Option<Request> {
    let args: Vec<S> = args.into_iter().collect();
    let has = |flag: &str| args.iter().skip(1).any(|a| a.as_ref() == flag);
    has(FLAG).then(|| Request {
        delete_data: has(DELETE_DATA),
    })
}

/// 命令行里有 `--uninstall-cleanup` 就执行清理并退出进程；没有就什么都不做。
pub fn dispatch() {
    let Some(req) = parse(std::env::args()) else {
        return;
    };
    let log = run(&req);
    for s in &log {
        if s.ok {
            tracing::info!("{}", s.text);
        } else {
            tracing::warn!("{}", s.text);
        }
    }
    std::process::exit(exit_code(&log));
}

fn run(req: &Request) -> Vec<UninstallStep> {
    let backups = tw_adopt::foreign::backup_root();
    let (mut log, restored_all) = uninstall::restore_steps(uninstall::restore_everywhere(&backups));
    let exe = std::env::current_exe();
    match &exe {
        Ok(exe) => log.extend(crate::winreg::release_all(exe)),
        Err(e) => log.push(UninstallStep::failed(tr!(
            format!("未能确定程序位置，注册项未清理（{e}）"),
            format!(
                "The program location could not be determined, so its registry entries were left in place ({e})"
            )
        ))),
    }
    // 卸载程序接着要删 twcore.exe，数据目录也要等它放手：不等它走，那个文件删不掉、
    // 留在安装目录里。等不到也接着做，删不掉的那一步会说
    if let Ok(exe) = &exe
        && let Some(dir) = exe.parent()
    {
        wait_for_core(&dir.join(crate::gateway::CORE_EXE), CORE_EXIT);
    }
    if req.delete_data {
        log.push(uninstall::drop_data(
            &crate::data_dir(),
            true,
            restored_all,
            None,
            DROP_RETRY,
        ));
    }
    log
}

/// 每一步都做成了是 0，否则是 1
fn exit_code(log: &[UninstallStep]) -> i32 {
    if log.iter().all(|s| s.ok) { 0 } else { 1 }
}

/// 等这一份的 core（`core` 这个文件跑起来的进程）退出，至多等 `limit`。不是 Windows、
/// 或者它没在跑，立刻回来。返回它是不是已经不在了
#[cfg(windows)]
fn wait_for_core(core: &std::path::Path, limit: Duration) -> bool {
    imp::wait_gone(core, limit)
}

#[cfg(not(windows))]
fn wait_for_core(core: &std::path::Path, limit: Duration) -> bool {
    let _ = (core, limit);
    true
}

#[cfg(windows)]
mod imp {
    use std::path::Path;
    use std::time::{Duration, Instant};

    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE, WAIT_TIMEOUT};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
        QueryFullProcessImageNameW, WaitForSingleObject,
    };

    /// 进程表里文件名对得上的几个，再按完整路径挑出跑的是 `core` 这个文件的：另一份
    /// ThinkWatch Lite 的 core（绿色版、安装版各一份）同名，不等它
    pub fn wait_gone(core: &Path, limit: Duration) -> bool {
        let Some(name) = core.file_name().map(|n| n.to_string_lossy().to_lowercase()) else {
            return true;
        };
        let want = core.to_string_lossy().to_lowercase();
        let deadline = Instant::now() + limit;
        let mut gone = true;
        for pid in pids_named(&name) {
            // SAFETY: 只要等待和查路径两种权限；拿不到（进程已经没了）就是不用等
            let h = unsafe {
                OpenProcess(
                    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                    0,
                    pid,
                )
            };
            if h.is_null() {
                continue;
            }
            if image_of(h).is_some_and(|p| p.to_lowercase() == want) {
                let left = deadline.saturating_duration_since(Instant::now());
                let ms = u32::try_from(left.as_millis()).unwrap_or(u32::MAX);
                // SAFETY: `h` 是上面打开的、带 SYNCHRONIZE 的进程句柄
                if unsafe { WaitForSingleObject(h, ms) } == WAIT_TIMEOUT {
                    gone = false;
                }
            }
            // SAFETY: 关的是自己打开的句柄，只关一次
            unsafe { CloseHandle(h) };
        }
        gone
    }

    fn pids_named(name: &str) -> Vec<u32> {
        let mut out = Vec::new();
        // SAFETY: 拍一张进程表的快照；失败返回 INVALID_HANDLE_VALUE
        let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snap == INVALID_HANDLE_VALUE {
            return out;
        }
        // SAFETY: PROCESSENTRY32W 是纯数据，全零是合法的初值；dwSize 按文档先填好
        let mut e: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        // SAFETY: `snap` 是有效的快照句柄，`e` 的 dwSize 已填
        let mut more = unsafe { Process32FirstW(snap, &mut e) } != 0;
        while more {
            let len = e
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(e.szExeFile.len());
            if String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase() == name {
                out.push(e.th32ProcessID);
            }
            // SAFETY: 同上
            more = unsafe { Process32NextW(snap, &mut e) } != 0;
        }
        // SAFETY: 关的是上面拍的快照，只关一次
        unsafe { CloseHandle(snap) };
        out
    }

    fn image_of(h: windows_sys::Win32::Foundation::HANDLE) -> Option<String> {
        let mut buf = vec![0u16; 32 * 1024];
        let mut len = buf.len() as u32;
        // SAFETY: `buf` 有 `len` 个 u16 那么大，函数写入后把 `len` 改成实际长度
        let ok = unsafe {
            QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len)
        };
        (ok != 0).then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// 一个正在跑的进程：按完整路径认得出来，等不到它退出就报还在；它退出之后
        /// 立刻回来。同名、别的位置的不等
        #[test]
        fn a_running_copy_is_waited_for_by_its_full_path() {
            // 一个跑几秒就自己退出的程序，换个名字放到临时目录里跑：系统的 ping 就行
            let ping = std::path::Path::new(&std::env::var("SystemRoot").unwrap())
                .join("System32")
                .join("PING.EXE");
            let d = tempfile::tempdir().unwrap();
            let copy = d.path().join("twcore-test.exe");
            std::fs::copy(&ping, &copy).unwrap();
            let mut child = std::process::Command::new(&copy)
                .args(["-n", "4", "127.0.0.1"])
                .stdout(std::process::Stdio::null())
                .spawn()
                .unwrap();
            let elsewhere = d.path().join("other").join("twcore-test.exe");
            assert!(
                wait_gone(&elsewhere, Duration::from_secs(1)),
                "别的位置的同名程序不等"
            );
            assert!(!wait_gone(&copy, Duration::from_millis(300)), "还在跑");
            assert!(wait_gone(&copy, Duration::from_secs(20)), "退出之后就回来");
            child.wait().unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_cleanup_flag_starts_a_cleanup() {
        assert_eq!(parse(["thinkwatch-lite.exe"]), None);
        // 第一个是程序自己：路径里碰巧有这几个字不算
        assert_eq!(parse(["--uninstall-cleanup"]), None);
        assert_eq!(parse(["x.exe", "--autostart"]), None);
        assert_eq!(parse(["x.exe", "--delete-data"]), None, "光有删数据不算");
        assert_eq!(
            parse(["x.exe", "--uninstall-cleanup"]),
            Some(Request { delete_data: false })
        );
        assert_eq!(
            parse(["x.exe", "--uninstall-cleanup", "--delete-data"]),
            Some(Request { delete_data: true })
        );
        assert_eq!(
            parse(["x.exe", "--delete-data", "--uninstall-cleanup"]),
            Some(Request { delete_data: true })
        );
    }

    #[test]
    fn any_step_that_did_not_work_makes_the_exit_code_one() {
        assert_eq!(exit_code(&[]), 0);
        assert_eq!(
            exit_code(&[UninstallStep::done("a"), UninstallStep::done("b")]),
            0
        );
        assert_eq!(
            exit_code(&[UninstallStep::done("a"), UninstallStep::failed("b")]),
            1
        );
    }
}
