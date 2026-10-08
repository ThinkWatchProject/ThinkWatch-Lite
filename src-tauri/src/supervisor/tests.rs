use super::*;

/// 控制面一问就答应
fn always_ready() -> Probe {
    probe(|| async { true })
}

fn sup() -> Supervisor {
    Supervisor::new(
        PathBuf::from("/nonexistent/twcore"),
        Some(PathBuf::from("/tmp/c.yaml")),
        always_ready(),
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    )
}

/// 程序运行不了：**停在「无法启动」、带着原因**，不是停在「正在启动」。以前停在
/// 后者，界面上一直说「请稍候」，而这件事等多久都不会好。
#[tokio::test]
async fn a_binary_that_cannot_run_leaves_the_reason_in_the_state() {
    let s = sup();
    assert!(s.run_once(false).await.is_err());
    match s.state() {
        CoreState::Failed { reason } => {
            assert!(reason.contains("/nonexistent/twcore"), "{reason}");
            assert!(!reason.contains("os error"), "{reason}");
        }
        other => panic!("该是无法启动，实际 {other:?}"),
    }
}

#[test]
fn why_a_program_cannot_run_is_said_without_os_error_codes() {
    use crate::i18n::{Lang, with_lang};
    let said = |e: std::io::Error| with_lang(Lang::Zh, || why_not(&e));
    assert_eq!(
        said(std::io::ErrorKind::PermissionDenied.into()),
        "没有执行权限"
    );
    assert_eq!(said(std::io::ErrorKind::NotFound.into()), "文件不存在");
    assert_eq!(
        said(std::io::Error::from_raw_os_error(libc::ENOEXEC)),
        "不是这台电脑能运行的程序"
    );
    let other = said(std::io::Error::from_raw_os_error(libc::EIO));
    assert!(!other.contains("os error"), "{other}");
}

#[test]
fn the_command_always_carries_our_pid() {
    // 「让用户认为他俩就是一个程序」的落点：UI 没了 core 跟着退。
    let args = sup().command_args(false);
    let i = args
        .iter()
        .position(|a| a == "--parent")
        .expect("必须带 --parent");
    assert_eq!(args[i + 1], std::process::id().to_string());
}

#[test]
fn safe_mode_is_expressed_on_the_command_line() {
    assert!(!sup().command_args(false).contains(&"--safe".to_string()));
    assert!(sup().command_args(true).contains(&"--safe".to_string()));
}

#[test]
fn an_explicit_config_path_is_passed_through() {
    let args = sup().command_args(false);
    let i = args.iter().position(|a| a == "--config").unwrap();
    assert_eq!(args[i + 1], "/tmp/c.yaml");
}

#[test]
fn without_a_config_we_let_core_pick_the_default() {
    // 不要在这里重复一遍默认路径 —— 两处各写一遍就是两处会漂移。
    let s = Supervisor::new(
        PathBuf::from("/x"),
        None,
        always_ready(),
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    );
    assert!(!s.command_args(false).contains(&"--config".to_string()));
}

#[tokio::test]
async fn a_binary_that_does_not_exist_fails_loudly_rather_than_looping() {
    // 路径配错时要立刻报错，而不是安静地重试到进安全模式 —— 那会把
    // 一个「装错了」的问题伪装成「core 一直在崩」。
    let s = sup();
    assert!(s.run_once(false).await.is_err());
}

#[tokio::test]
async fn restarting_something_that_is_not_running_says_so() {
    // 不该静默成功 —— 那会让「配置改了但没生效」多一种成因。
    let s = sup();
    assert!(s.request_restart().await.is_err());
}

#[tokio::test]
async fn state_starts_stopped() {
    assert_eq!(sup().state(), CoreState::Stopped);
}

/// 一个指向不存在之处的控制面。
///
/// 这些测试从不真的起 core，所以连不上正是对的 —— 请它退出那一步在
/// unix 上走信号、根本不碰它，在 Windows 上会失败一次然后落到强杀，
/// 而强杀才是这些测试要看的那一步。
fn test_address() -> tw_api::control::Address {
    tw_api::control::Address::in_dir(std::path::Path::new("/tw-no-such-dir-xyz"))
}

/// 等「迟早该发生的事」最多等多久：core 起来、停下、守护循环收尾。
///
/// **这是活性的上限，不是快慢的要求**：只为了出错时报错而不是挂住。平时几毫秒
/// 的事，机器满载时慢上几秒不算错；「根本不会发生」的错，等多久都抓得到。
/// 和被测代码自己的超时比快慢的断言（「没等到超时那一档」）比的是传进去的那个
/// 超时，不是它
const PATIENCE: Duration = Duration::from_secs(30);

/// 假 core 认的第一个参数：带着它就当场退出，什么都不做（见 [`warmed`]）。守护
/// 起它时第一个参数是 `serve`
const WARM: &str = "warm";

/// 刚写出来的假 core 先空跑一次，再交给测试。
///
/// **新写出来的可执行文件，第一次运行要等系统先看过它。**macOS 上这类文件带着
/// `com.apple.provenance`，第一次 exec 时子进程在跑到第一行之前停住：闲的时候
/// 零点几秒，几个会话同时在编的时候实测停过 49 秒；同一个文件第二次运行不到
/// 一毫秒。以前这一段算在测试「core 起来没有」的那五秒里，机器一忙，看
/// 「起过几次」的两条（`a_core_that_is_still_starting_…`、
/// `a_core_waiting_out_its_backoff_…`）就超时。慢的是系统、不是守护：放在
/// 计时之前，不设上限。
///
/// 刚写完就运行在 Linux 上可能碰上「文本文件忙」，和守护自己一样等一下再试
/// （见 `run_once`）
fn warmed(bin: PathBuf) -> PathBuf {
    let t0 = Instant::now();
    loop {
        let ran = std::process::Command::new(&bin)
            .arg(WARM)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        match ran {
            Ok(status) => {
                assert!(status.success(), "假 core 空跑失败：{status}");
                return bin;
            }
            Err(e)
                if e.kind() == std::io::ErrorKind::ExecutableFileBusy
                    && t0.elapsed() < PATIENCE =>
            {
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(e) => panic!("假 core 起不来：{e}"),
        }
    }
}

/// 放假 core 的目录，测试结束（过了、没过）就删掉。
///
/// **拿着它的变量要比守护活得久**：守护起的假 core 就在这里面，计数的那种每起一次
/// 还往里写一行。所以每条测试在守护之前声明它（在守护之后析构）；测试走到结尾时
/// 守护循环都已经跑完、假 core 都已经退出。测试没过、提前 panic 时它先被删掉，但
/// 单线程的运行时不会再往下跑守护循环，不会再起一个、把目录写回来
fn fake_core_dir(name: &str) -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix(&format!("tw-sup-{name}-"))
        .tempdir()
        .unwrap()
}

/// 一个不管参数、一直跑到被杀掉的「core」（除了 [`WARM`]）。返回它所在的目录
/// （见 [`fake_core_dir`]）和它自己。
///
/// **两个平台各写一份。**shebang 和执行位是 unix 的东西；Windows 上
/// 写一个 `.cmd`，`std::process::Command` 认得它。
fn long_runner(name: &str) -> (tempfile::TempDir, PathBuf) {
    let tmp = fake_core_dir(name);
    let dir = tmp.path();
    #[cfg(unix)]
    let bin = {
        let bin = dir.join("fake-core");
        let script = format!("#!/bin/sh\n[ \"$1\" = {WARM} ] && exit 0\nexec sleep 30\n");
        std::fs::write(&bin, script).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin
    };
    #[cfg(windows)]
    let bin = {
        let bin = dir.join("fake-core.cmd");
        // `timeout` 要一个控制台，测试进程里没有；`ping` 不要。
        let script = format!("@if \"%~1\"==\"{WARM}\" exit /b 0\r\n@ping -n 30 127.0.0.1 >nul\r\n");
        std::fs::write(&bin, script).unwrap();
        bin
    };
    (tmp, warmed(bin))
}

async fn until_running(s: &Supervisor) -> u32 {
    let mut rx = s.watch();
    loop {
        if let CoreState::Running { pid } = *rx.borrow_and_update() {
            return pid;
        }
        tokio::time::timeout(PATIENCE, rx.changed())
            .await
            .expect("core 迟迟没起来")
            .unwrap();
    }
}

/// 这一条是 `stop_and_wait` 存在的理由：为了重启应用而停的 core，**守护
/// 循环不能把它当成一次崩溃**。当成崩溃的话，要么立刻再起一个去抢锁，
/// 要么进安全模式、把主窗口弹到正在重启的应用上。
#[tokio::test]
async fn a_core_stopped_for_exit_is_not_restarted() {
    let (_dir, bin) = long_runner("stop");
    let s = Arc::new(Supervisor::new(
        bin,
        None,
        always_ready(),
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    ));
    let looped = {
        let s = s.clone();
        tokio::spawn(async move { s.run_once(false).await.unwrap() })
    };
    until_running(&s).await;

    let t0 = Instant::now();
    s.stop_and_wait(Duration::from_secs(5)).await;
    // **温和那一档该管用，不用等到强杀** —— 但这句话只在 unix 上成立：
    // 这里的假 core 是个脚本，没有控制面，所以温和那一档只能落到信号上，
    // 而 Windows 没有信号。真的 core 在两个平台上都答应 `POST /shutdown`，
    // 那条路由 tests/control_plane.rs 去证明。
    #[cfg(unix)]
    assert!(
        t0.elapsed() < Duration::from_secs(5),
        "SIGTERM 就该让它退出，不用等到强杀"
    );
    #[cfg(not(unix))]
    let _ = t0;
    // 两个平台都要成立的是这一条：它确实停了，而且没被再拉起来。
    assert_eq!(s.state(), CoreState::Stopped);
    assert_eq!(looped.await.unwrap(), Next::Stop, "停下之后不再起");
}

/// **安全模式里的 core 答应了控制面，也还是安全模式。**报成「运行中」的话，界面、
/// 菜单栏都说网关好好的，「网关未在转发」那条提醒也被撤掉 —— 而这时网关根本不
/// 转发。停它、在安全模式里点「重新启动」，都要够得着这个 core
#[tokio::test]
async fn a_safe_mode_core_stays_in_safe_mode_until_restarted() {
    let (_dir, bin) = long_runner("safe");
    let s = Arc::new(Supervisor::new(
        bin,
        None,
        always_ready(),
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    ));
    let looped = {
        let s = s.clone();
        tokio::spawn(async move { s.run_once(true).await.unwrap() })
    };
    let mut rx = s.watch();
    let mut began = false;
    loop {
        match *rx.borrow_and_update() {
            CoreState::SafeMode { pid: Some(_) } => break,
            CoreState::SafeMode { pid: None } => began = true,
            // 那个任务还没跑到第一行
            CoreState::Stopped if !began => {}
            ref other => panic!("安全模式里不该出现 {other:?}"),
        }
        tokio::time::timeout(PATIENCE, rx.changed())
            .await
            .expect("迟迟没起来")
            .unwrap();
    }

    #[cfg(unix)]
    {
        // 点「重新启动」：这个 core 退出，守护按正常模式再起（温和那一档在这里只能
        // 走信号，Windows 上没有，所以只在 unix 上看）
        s.request_restart().await.unwrap();
        assert_eq!(looped.await.unwrap(), Next::Again);
    }
    #[cfg(not(unix))]
    {
        s.stop_and_wait(Duration::from_secs(5)).await;
        assert_eq!(looped.await.unwrap(), Next::Stop);
    }
}

/// 没在跑就当场返回，**一点都不等**。
///
/// 用暂停的时钟量：它只在运行时无事可做、等着计时器的时候才往前跳，等了那个超时
/// 就量出整整五秒，一点没等就是零。以前看墙上时钟、限一百毫秒，机器满载时线程
/// 被晾上一会儿就会误报
#[tokio::test(start_paused = true)]
async fn stopping_what_is_not_running_returns_at_once() {
    let s = sup();
    let t0 = tokio::time::Instant::now();
    s.stop_and_wait(Duration::from_secs(5)).await;
    assert_eq!(t0.elapsed(), Duration::ZERO);
}

/// **控制面答应之前是「启动中」，不是「运行中」。**界面见到「运行中」就去
/// 取数，而那时 socket 还没建好，拿回来的是一句「连不上」
#[tokio::test]
async fn a_core_is_starting_until_its_control_plane_answers() {
    let asked = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let third_time = {
        let asked = asked.clone();
        probe(move || {
            let n = asked.fetch_add(1, Ordering::SeqCst);
            async move { n >= 3 }
        })
    };
    let (_dir, bin) = long_runner("ready");
    let s = Arc::new(Supervisor::new(
        bin,
        None,
        third_time,
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    ));
    let mut rx = s.watch();
    let looped = {
        let s = s.clone();
        tokio::spawn(async move { s.run_once(false).await })
    };
    let mut seen = Vec::new();
    loop {
        tokio::time::timeout(PATIENCE, rx.changed())
            .await
            .expect("迟迟没有就绪")
            .unwrap();
        let now = rx.borrow_and_update().clone();
        if let CoreState::Running { .. } = now {
            break;
        }
        seen.push(now);
    }
    assert_eq!(seen, vec![CoreState::Starting]);
    assert!(asked.load(Ordering::SeqCst) >= 4, "问过几次才答应的");
    s.stop_and_wait(Duration::from_secs(5)).await;
    looped.await.unwrap().unwrap();
}

/// 进程在、控制面一直不答应：**不能永远停在「启动中」**。按一次失败算，
/// 换掉它再起 —— 和启动就崩一个待遇，连着几次就进安全模式
#[tokio::test(start_paused = true)]
async fn a_core_that_never_answers_is_replaced() {
    let (_dir, bin) = long_runner("never");
    let s = Supervisor::new(
        bin,
        None,
        probe(|| async { false }),
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    );
    let next = s.run_once(false).await.unwrap();
    assert_eq!(next, Next::Again);
    assert!(
        matches!(s.state(), CoreState::Restarting { attempt: 1, .. }),
        "{:?}",
        s.state()
    );
}

/// 停过一次、又接回来之后，core 再死就是崩溃，**不是「按要求停止」**。
///
/// Windows 上更新没装成（UAC 点了「否」）走的就是这条：为了装更新停了
/// core，没装成又接回来。记号要是留着，从那以后网关崩了不会再起。
#[tokio::test]
async fn after_resuming_a_crash_is_a_crash_again() {
    let (_dir, bin) = long_runner("resume");
    let s = Arc::new(Supervisor::new(
        bin,
        None,
        always_ready(),
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    ));
    let first = {
        let s = s.clone();
        tokio::spawn(async move { s.run_once(false).await.unwrap() })
    };
    until_running(&s).await;
    s.stop_and_wait(Duration::from_secs(5)).await;
    assert_eq!(first.await.unwrap(), Next::Stop);

    s.resume();
    let second = {
        let s = s.clone();
        tokio::spawn(async move { s.run_once(false).await.unwrap() })
    };
    let pid = until_running(&s).await;
    s.kill_now(pid);
    assert_ne!(
        second.await.unwrap(),
        Next::Stop,
        "接回来之后的崩溃被当成了按要求停止"
    );
}

/// 对照组：改配置那种重启照旧立刻再起 —— 两个标志没有串。
///
/// **只在 unix 上跑**：这个假 core 没有控制面，请它退只能靠信号。Windows 上没有信号
/// 这条退路，重启本来就请不动（见 `a_restart_that_could_not_be_asked_for_leaves_no_mark`）
/// —— 以前那里「请」了个空也照样说成了，这一条是等假 core 自己跑完三十秒才过的
#[cfg(unix)]
#[tokio::test]
async fn a_requested_restart_still_comes_back() {
    let (_dir, bin) = long_runner("restart");
    let s = Arc::new(Supervisor::new(
        bin,
        None,
        always_ready(),
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    ));
    let looped = {
        let s = s.clone();
        tokio::spawn(async move { s.run_once(false).await.unwrap() })
    };
    until_running(&s).await;
    s.request_restart().await.unwrap();
    assert_eq!(looped.await.unwrap(), Next::Again);
}

/// 假 core 起来之后做什么
#[derive(Clone, Copy)]
enum Acts {
    /// 一直跑到被杀掉
    Stays,
    /// 一直跑，请它退出也不理（unix 上不理 SIGTERM；Windows 上本来就只能强杀）
    IgnoresTheAsk,
    /// 当场退出：启动就崩
    Crashes,
}

/// 一个每起一次就往 `starts` 那个文件里记一行的「core」（unix 上记的是它的 pid）。
/// 返回它所在的目录（见 [`fake_core_dir`]）、程序和那个文件。空跑（[`warmed`]）不记
fn counting_core(name: &str, acts: Acts) -> (tempfile::TempDir, PathBuf, PathBuf) {
    let tmp = fake_core_dir(name);
    let dir = tmp.path();
    let starts = dir.join("starts");
    #[cfg(unix)]
    let bin = {
        let bin = dir.join("fake-core");
        let then = match acts {
            Acts::Stays => "exec sleep 30",
            // 忽略掉的信号在 exec 之后还是忽略的
            Acts::IgnoresTheAsk => "trap '' TERM\nexec sleep 30",
            Acts::Crashes => "exit 1",
        };
        let script = format!(
            "#!/bin/sh\n[ \"$1\" = {WARM} ] && exit 0\necho $$ >> '{}'\n{then}\n",
            starts.display()
        );
        std::fs::write(&bin, script).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin
    };
    #[cfg(windows)]
    let bin = {
        let bin = dir.join("fake-core.cmd");
        let then = match acts {
            Acts::Stays | Acts::IgnoresTheAsk => "@ping -n 30 127.0.0.1 >nul",
            Acts::Crashes => "@exit /b 1",
        };
        let script = format!(
            "@if \"%~1\"==\"{WARM}\" exit /b 0\r\n@echo x>> \"{}\"\r\n{then}\r\n",
            starts.display()
        );
        std::fs::write(&bin, script).unwrap();
        bin
    };
    (tmp, warmed(bin), starts)
}

/// **安全模式里的 core 也退出了，界面拿到的是它最后说的那句话**，不是一句「已停止」
#[tokio::test]
async fn a_safe_mode_core_that_exits_reports_what_it_said() {
    let tmp = fake_core_dir("exits");
    let dir = tmp.path();
    #[cfg(unix)]
    let bin = {
        let bin = dir.join("fake-core");
        let script = format!(
            "#!/bin/sh\n[ \"$1\" = {WARM} ] && exit 0\necho 'Error: loading /x/config.yaml' >&2\necho '' >&2\necho 'Caused by:' >&2\necho '    已有 twcore 实例正在运行（pid 7）。' >&2\nexit 1\n"
        );
        std::fs::write(&bin, script).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin
    };
    #[cfg(windows)]
    let bin = {
        let bin = dir.join("fake-core.cmd");
        let script = format!(
            "@if \"%~1\"==\"{WARM}\" exit /b 0\r\n@echo Error: loading /x/config.yaml 1>&2\r\n@echo Caused by: 1>&2\r\n@echo     another twcore is running 1>&2\r\n@exit /b 1\r\n"
        );
        std::fs::write(&bin, script).unwrap();
        bin
    };
    let s = Supervisor::new(
        warmed(bin),
        None,
        always_ready(),
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    );
    assert_eq!(s.run_once(true).await.unwrap(), Next::Stop);
    let CoreState::Exited { reason } = s.state() else {
        panic!("该报 Exited，实际是 {:?}", s.state());
    };
    assert!(reason.starts_with("loading /x/config.yaml\n"), "{reason}");
    #[cfg(unix)]
    assert!(
        reason.ends_with("已有 twcore 实例正在运行（pid 7）。"),
        "{reason}"
    );
}

#[test]
fn the_last_error_is_the_whole_chain_without_numbers() {
    let lines: Vec<String> = [
        "some earlier noise",
        "Error: loading /x/config.yaml",
        "",
        "Caused by:",
        "    0: schema error (line 3): bad",
        "    1: deeper",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    assert_eq!(
        last_error(&lines).as_deref(),
        Some("loading /x/config.yaml\nschema error (line 3): bad\ndeeper")
    );
    // 没有 `Error:`（被信号杀掉、崩溃）就取最后几行
    let crash: Vec<String> = ["a", "", "thread 'main' panicked at x", "boom"]
        .into_iter()
        .map(String::from)
        .collect();
    assert_eq!(
        last_error(&crash).as_deref(),
        Some("a\nthread 'main' panicked at x\nboom")
    );
    assert_eq!(last_error(&[]), None);
}

/// 起过几次
fn starts(file: &std::path::Path) -> usize {
    std::fs::read_to_string(file).map_or(0, |s| s.lines().count())
}

/// 等到起过 `times` 次。只能看文件，所以隔一会儿看一眼
async fn until_started(file: &std::path::Path, times: usize) {
    let started = async {
        while starts(file) < times {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    };
    tokio::time::timeout(PATIENCE, started)
        .await
        .expect("core 迟迟没起来");
}

/// **还在启动的 core 也停得下来。**以前只认「运行中」：切到远程的那一刻本机的 core
/// 要是还没答应控制面，它照样起来、照样占着网关端口。停下之后照样接得回来
#[tokio::test]
async fn a_core_that_is_still_starting_is_stopped_and_can_start_again() {
    let answer = Arc::new(AtomicBool::new(false));
    let ready = {
        let answer = answer.clone();
        probe(move || {
            let yes = answer.load(Ordering::SeqCst);
            async move { yes }
        })
    };
    let (_dir, bin, started) = counting_core("starting", Acts::Stays);
    let s = Arc::new(Supervisor::new(
        bin,
        None,
        ready,
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    ));
    let looped = {
        let s = s.clone();
        tokio::spawn(async move { s.run_once(false).await.unwrap() })
    };
    // 进程起来了，控制面还没答应
    until_started(&started, 1).await;
    assert_eq!(s.state(), CoreState::Starting);

    // 停还在启动的 core 不走控制面（按句柄直接杀），两个平台上都不该等到超时
    let t0 = Instant::now();
    s.stop_and_wait(PATIENCE).await;
    assert_eq!(s.state(), CoreState::Stopped, "还在启动的 core 没被停下");
    assert!(t0.elapsed() < PATIENCE, "等到超时才停下");
    let next = tokio::time::timeout(PATIENCE, looped)
        .await
        .expect("守护循环没有停下")
        .unwrap();
    assert_eq!(next, Next::Stop);
    #[cfg(unix)]
    {
        let pid: i32 = std::fs::read_to_string(&started)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        // SAFETY: 信号 0 只问这个 pid 还在不在，什么都不送
        let alive = unsafe { libc::kill(pid, 0) } == 0;
        assert!(!alive, "进程还在跑");
    }

    // 接回来：记号撤掉，照常起到「运行中」
    s.resume();
    answer.store(true, Ordering::SeqCst);
    let again = {
        let s = s.clone();
        tokio::spawn(async move { s.run_once(false).await.unwrap() })
    };
    until_running(&s).await;
    until_started(&started, 2).await;
    s.stop_and_wait(Duration::from_secs(5)).await;
    assert_eq!(again.await.unwrap(), Next::Stop);
}

/// **在退避里等着重起的 core 也停得下来**：不会睡醒了再起一个
#[tokio::test]
async fn a_core_waiting_out_its_backoff_is_not_started_again() {
    let (_dir, bin, started) = counting_core("backoff", Acts::Crashes);
    let s = Arc::new(Supervisor::new(
        bin,
        None,
        probe(|| async { false }),
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    ));
    // 和 `gateway::supervise` 一样，一轮接一轮地跑
    let looped = {
        let s = s.clone();
        tokio::spawn(async move {
            loop {
                match s.run_once(false).await.unwrap() {
                    Next::Again => continue,
                    other => return other,
                }
            }
        })
    };
    // 第一次崩溃立刻重起，第二次之后要等一秒
    let mut rx = s.watch();
    let backing_off =
        rx.wait_for(|st| matches!(st, CoreState::Restarting { in_ms, .. } if *in_ms > 0));
    let _ = tokio::time::timeout(PATIENCE, backing_off)
        .await
        .expect("迟迟没进退避")
        .unwrap();

    s.stop_and_wait(Duration::from_secs(5)).await;
    assert_eq!(s.state(), CoreState::Stopped, "退避里的 core 没被停下");
    let next = tokio::time::timeout(PATIENCE, looped)
        .await
        .expect("守护循环没有停下")
        .unwrap();
    assert_eq!(next, Next::Stop);
    assert_eq!(starts(&started), 2, "睡醒之后又起了一个");
}

/// 要停的请求落在两轮之间（比如按要求重启的那一下）：**下一轮不起**
#[tokio::test]
async fn a_stop_between_two_rounds_keeps_the_next_one_from_starting() {
    let (_dir, bin, started) = counting_core("between", Acts::Stays);
    let s = Supervisor::new(
        bin,
        None,
        always_ready(),
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    );
    // 此刻没有在跑的：只是把记号立起来
    s.stop_and_wait(Duration::from_secs(5)).await;
    let next = tokio::time::timeout(PATIENCE, s.run_once(false))
        .await
        .expect("要停的时候又起了一个")
        .unwrap();
    assert_eq!(next, Next::Stop);
    assert_eq!(s.state(), CoreState::Stopped);
    assert_eq!(starts(&started), 0);
}

/// 卡死的 core 听了请求自己退了：**等到它走就收手**，不再干等三秒、再按那个 pid 强杀 ——
/// 那时守护循环已经在起下一个，这个号可能已经是系统里别的进程的了。
///
/// 只在 unix 上：这里的假 core 没有控制面，温和那一档只能走信号
#[cfg(unix)]
#[tokio::test]
async fn a_wedged_core_that_leaves_when_asked_is_not_killed_afterwards() {
    let (_dir, bin) = long_runner("wedged-leaves");
    let s = Arc::new(Supervisor::new(
        bin,
        None,
        always_ready(),
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    ));
    let looped = {
        let s = s.clone();
        tokio::spawn(async move { s.run_once(false).await.unwrap() })
    };
    until_running(&s).await;

    let t0 = Instant::now();
    s.report_wedged().await.unwrap();
    assert!(
        t0.elapsed() < Duration::from_secs(2),
        "它走了还等了 {:?} 才回来",
        t0.elapsed()
    );
    // 照一次失败算，守护循环接着起下一个
    assert_eq!(looped.await.unwrap(), Next::Again);
    assert!(
        matches!(s.state(), CoreState::Restarting { attempt: 1, .. }),
        "{:?}",
        s.state()
    );
}

/// 请它退出也不走的，**照样强杀、换掉**：收手只收在它自己走了的时候
#[tokio::test]
async fn a_wedged_core_that_ignores_the_ask_is_still_killed() {
    let (_dir, bin, _) = counting_core("wedged-stays", Acts::IgnoresTheAsk);
    let s = Arc::new(Supervisor::new(
        bin,
        None,
        always_ready(),
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    ));
    let looped = {
        let s = s.clone();
        tokio::spawn(async move { s.run_once(false).await.unwrap() })
    };
    until_running(&s).await;
    s.report_wedged().await.unwrap();
    let next = tokio::time::timeout(PATIENCE, looped)
        .await
        .expect("强杀之后它还在")
        .unwrap();
    assert_eq!(next, Next::Again);
}

/// 一个一定不存在的 pid：比 Linux 的 `pid_max` 上限（2^22）和 macOS 的（99999）都大，
/// 又还是正数 —— 转成 `i32` 是负数的话，`kill` 会送给一整个进程组
const NO_SUCH_PID: u32 = i32::MAX as u32;

/// **没请动的重启不留记号，也不说成了。**Windows 上控制面不应时 core 照旧跑着，重启
/// 没有发生；记号留着的话，它下一次真的崩溃会被当成这次重启：不计入退避，连着崩
/// 也进不了安全模式
#[tokio::test]
async fn a_restart_that_could_not_be_asked_for_leaves_no_mark() {
    let (_dir, bin, _) = counting_core("restart-unasked", Acts::Crashes);
    let s = Supervisor::new(
        bin,
        None,
        probe(|| async { false }),
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    );
    // 请不到它：控制面不在，这个 pid 上也没有进程收信号（两个平台上都是没请动）
    s.set(CoreState::Running { pid: NO_SUCH_PID });
    assert!(s.request_restart().await.is_err(), "没重启成却说成了");

    // 之后 core 真的崩了：照一次失败算，不是「按要求重启」
    assert_eq!(s.run_once(false).await.unwrap(), Next::Again);
    assert!(
        matches!(s.state(), CoreState::Restarting { attempt: 1, .. }),
        "{:?}",
        s.state()
    );
}

/// 重启的请求撞上停止（点了「重新启动」、紧接着切到远程）：守护循环先认停止。
/// 那个重启的记号**不能带进下一轮**，不然接回来之后第一次真崩溃会被当成按要求重启
#[tokio::test]
async fn a_restart_cut_short_by_a_stop_does_not_carry_into_the_next_round() {
    let (_dir, bin) = long_runner("restart-then-stop");
    let s = Arc::new(Supervisor::new(
        bin,
        None,
        always_ready(),
        test_address(),
        PathBuf::from("/tw-no-such-dir-xyz/config.yaml"),
    ));
    let first = {
        let s = s.clone();
        tokio::spawn(async move { s.run_once(false).await.unwrap() })
    };
    until_running(&s).await;
    // 两个请求都在守护循环看见 core 退出之前立下（测试跑在单线程的运行时上，
    // `join!` 先把两边各推到等待处）。Windows 上重启本来就请不动，不看它的结果
    let (_, restarted) = tokio::join!(s.stop_and_wait(Duration::from_secs(5)), s.request_restart());
    let _ = restarted;
    assert_eq!(first.await.unwrap(), Next::Stop);

    s.resume();
    let second = {
        let s = s.clone();
        tokio::spawn(async move { s.run_once(false).await.unwrap() })
    };
    let pid = until_running(&s).await;
    s.kill_now(pid);
    assert_eq!(second.await.unwrap(), Next::Again);
    assert!(
        matches!(s.state(), CoreState::Restarting { attempt: 1, .. }),
        "接回来之后的崩溃被当成了按要求重启：{:?}",
        s.state()
    );
}

/// 一个握了手就一声不吭的控制面。走回环端口：两个平台都认这一种传输。第一项是放
/// 配置和端口文件的目录（见 [`fake_core_dir`]），拿着它到测试结束
async fn silent_control_plane(
    name: &str,
) -> (tempfile::TempDir, tw_api::control::Address, PathBuf) {
    let tmp = fake_core_dir(name);
    let dir = tmp.path();
    let key = "ab".repeat(32);
    let config = dir.join("config.yaml");
    std::fs::write(
        &config,
        format!("listen:\n  control:\n    key: \"{key}\"\n"),
    )
    .unwrap();
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port_file = dir.join("control.port");
    std::fs::write(&port_file, l.local_addr().unwrap().port().to_string()).unwrap();
    tokio::spawn(async move {
        let key = tw_link::ControlKey::parse(&key).unwrap();
        let acceptor = tw_link::Acceptor::new(move || Some(key.clone()), "9.9.9");
        let mut held = Vec::new();
        while let Ok((s, _)) = l.accept().await {
            // 握手，然后拿着这条连接，请求来了也不答
            if let Ok(accepted) = acceptor.accept(s).await {
                held.push(accepted);
            }
        }
    });
    (
        tmp,
        tw_api::control::Address::Loopback { port_file },
        config,
    )
}

/// 控制面握了手却一直不答：**请它退出这一步不能跟着挂住**。心跳换掉卡死的 core、
/// 装更新、退出应用都要先走这一步
#[tokio::test]
async fn asking_a_core_whose_control_plane_never_answers_gives_up() {
    let (_dir, at, config) = silent_control_plane("silent").await;
    let s = Supervisor::new(PathBuf::from("/x"), None, always_ready(), at, config);
    let asked = tokio::time::timeout(Duration::from_secs(10), s.ask_to_exit(NO_SUCH_PID))
        .await
        .expect("请它退出挂住了");
    assert!(!asked, "控制面没答、信号也没处送，却说请到了");
}
