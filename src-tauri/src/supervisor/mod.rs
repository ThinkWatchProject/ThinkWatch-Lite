//! core 的守护。
//!
//! 用户眼里 UI 和 core 是**同一个程序**：UI 起它、
//! UI 关它、它自己不注册开机自启。所以「core 挂了」不是一个用户该处理
//! 的事件，而是这一层要悄悄修好的事。

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tokio::sync::{Mutex, watch};

pub mod health;
pub mod policy;

pub use health::{HealthTracker, Verdict};
pub use policy::{Decision, RestartPolicy, should_interrupt};

/// 跑多久算「这次起来是健康的」。短于这个时间就死，说明是启动就崩，
/// 不该重置退避阶梯。
const HEALTHY_AFTER: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreState {
    Starting,
    Running {
        pid: u32,
    },
    Restarting {
        attempt: usize,
        in_ms: u64,
    },
    /// 只起控制面。用户还能改配置、回滚、还原接管 —— 那正是这时候最
    /// 需要的能力。
    SafeMode,
    /// UI 主动停的，不再重启
    Stopped,
}

/// 一次 core 退出之后，守护循环下一步做什么。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Next {
    /// 再起一个
    Again,
    /// 连续失败太多，改用安全模式起
    SafeMode,
    /// 不再起了：安全模式里的 core 也退出了，或者它是为了退出应用而被停掉的
    Stop,
}

pub struct Supervisor {
    binary: PathBuf,
    config: Option<PathBuf>,
    policy: Mutex<RestartPolicy>,
    /// 当前状态。**用 watch 而不是 Mutex，是为了能被订阅** —— 界面
    /// 需要的是「变了就告诉我」，而拿一个 Mutex 只能反复去问。
    state: watch::Sender<CoreState>,
    /// 这次退出是我们自己要求的吗。
    ///
    /// **主动重启不该算进退避阶梯** —— 改一次配置就重启一次，配五次就
    /// 进安全模式，那是荒唐的。这个标志把「它崩了」和「我们让它退的」
    /// 分开，而这两件事在 `wait()` 眼里长得一模一样。
    intentional: Arc<AtomicBool>,
    /// 为了退出应用而停的。**和 `intentional` 相反：退了就不再起。**
    ///
    /// 两者分开是因为对 `wait()` 来说它们还是长得一模一样 —— 而一个应该
    /// 立刻重起，一个应该一个都不再起。
    stopping: AtomicBool,
}

impl Supervisor {
    pub fn new(binary: PathBuf, config: Option<PathBuf>) -> Self {
        Self {
            binary,
            config,
            policy: Mutex::new(RestartPolicy::new()),
            state: watch::channel(CoreState::Stopped).0,
            intentional: Arc::new(AtomicBool::new(false)),
            stopping: AtomicBool::new(false),
        }
    }

    /// 现在是什么状态。
    pub fn state(&self) -> CoreState {
        self.state.borrow().clone()
    }

    /// 订阅状态变化。
    ///
    /// **每一次转换都推出去。**「core 起来没、是不是在重启、有没有进
    /// 安全模式」这三个答案一天变不了几次，而界面原来是每两秒问一遍的。
    pub fn watch(&self) -> watch::Receiver<CoreState> {
        self.state.subscribe()
    }

    /// 换一个状态。**`send_replace` 不在乎有没有订阅者** —— 没人听的
    /// 时候状态照样要更新，那是真相本身，不是一条通知。
    fn set(&self, next: CoreState) {
        self.state.send_replace(next);
    }

    /// core 活着但不响应了，把它换掉。
    ///
    /// **和 `request_restart` 的区别在于计不计入退避**：这是一次失败，
    /// 如果 core 反复卡死，最终应该进安全模式。改配置那种重启不是。
    pub async fn report_wedged(&self) -> anyhow::Result<()> {
        let pid = match self.state() {
            CoreState::Running { pid } => pid,
            other => anyhow::bail!("core 现在是 {other:?}，不用管"),
        };
        tracing::error!(pid, "core 活着但不响应，换掉它");
        // 卡死的进程可能连信号处理器都跑不了，所以先 TERM 后 KILL。
        // 只发 TERM 的话，一个真的死锁住的进程会一直留着。
        #[cfg(unix)]
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        // 还在的话强杀。这里不检查它死没死 —— kill 一个已经没了的 pid
        // 是无害的，而多做一次检查会引入一个 TOCTOU 窗口。
        #[cfg(unix)]
        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
        Ok(())
    }

    /// 让 core 重起一次（改完配置之后用）。
    ///
    /// 做法是标记意图然后杀掉它，让守护循环自己把它拉起来 —— 而不是在
    /// 这里再写一遍启动逻辑。两处启动逻辑就是两处会漂移。
    pub async fn request_restart(&self) -> anyhow::Result<()> {
        let pid = match self.state() {
            CoreState::Running { pid } => pid,
            CoreState::Starting | CoreState::Restarting { .. } => {
                anyhow::bail!("core 正在启动，请稍后再试")
            }
            CoreState::SafeMode | CoreState::Stopped => anyhow::bail!("core 未运行，无法重启"),
        };
        self.intentional.store(true, Ordering::SeqCst);
        // SIGTERM 而不是 SIGKILL：给它机会把 socket 和 lock 文件清掉。
        #[cfg(unix)]
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        Ok(())
    }

    /// 为了退出应用而停掉 core，**并且等它真的退出**。
    ///
    /// 应用重启（装完更新）之前要用它。只是自己退出、让 core 靠 `--parent`
    /// 发现父进程没了再跟着退是不够的：它要一秒左右才发现，而新起来的应用
    /// 这时已经在拉新的 core —— 锁还在旧的手里，新的连起几次都失败，网关
    /// 多停一秒，日志里多出几段「已经有一个 twcore 在跑」。这是实测出来的。
    ///
    /// 超时还没退就强杀。**不在跑就什么都不做。**
    pub async fn stop_and_wait(&self, timeout: Duration) {
        let CoreState::Running { pid } = self.state() else {
            return;
        };
        self.stopping.store(true, Ordering::SeqCst);
        let mut rx = self.watch();
        // SIGTERM 而不是 SIGKILL：给它机会把 socket 和 lock 文件清掉 ——
        // 下一个 core 要的正是那把锁。
        #[cfg(unix)]
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        let gone = async {
            while matches!(*rx.borrow_and_update(), CoreState::Running { pid: p } if p == pid) {
                if rx.changed().await.is_err() {
                    break;
                }
            }
        };
        if tokio::time::timeout(timeout, gone).await.is_err() {
            tracing::warn!(pid, ?timeout, "core 没按时退出，强杀");
            #[cfg(unix)]
            unsafe {
                libc::kill(pid as i32, libc::SIGKILL);
            }
        }
    }

    /// 拼命令行。
    ///
    /// `--parent` 是「一个程序」这条原则的落点：**UI 没了 core 跟着退**。
    /// 没有它，用户强退 UI 之后会留下一个还在监听 8788 的孤儿进程，
    /// 下次启动就撞端口 —— 而错误信息会指向一个他根本不知道存在的东西。
    pub fn command_args(&self, safe: bool) -> Vec<String> {
        let mut args = vec!["serve".to_string()];
        if let Some(c) = &self.config {
            args.push("--config".to_string());
            args.push(c.display().to_string());
        }
        args.push("--parent".to_string());
        args.push(std::process::id().to_string());
        if safe {
            args.push("--safe".to_string());
        }
        args
    }

    pub fn binary(&self) -> &PathBuf {
        &self.binary
    }

    /// 一次「起、看着、它死了、决定下一步」的完整循环。
    pub async fn run_once(&self, safe: bool) -> anyhow::Result<Next> {
        self.set(CoreState::Starting);
        let args = self.command_args(safe);
        let started = Instant::now();

        let mut child = tokio::process::Command::new(&self.binary)
            .args(&args)
            // core 的日志走它自己的 stderr；UI 侧只需要知道它活着。
            .kill_on_drop(true)
            .spawn()?;

        if let Some(pid) = child.id() {
            self.set(CoreState::Running { pid });
            tracing::info!(pid, safe, "core 已启动");
        }

        // 信号一：子进程退出事件。**最快最准**，但只覆盖我们自己 spawn
        // 的那个 —— 所以另外两个信号（socket 断开、心跳）不是冗余。
        let status = child.wait().await?;
        let ran_for = started.elapsed();

        // **先看是不是为了退出而停的。**这一条必须排在最前面：落到下面任何
        // 一个分支里，它都会被当成一次崩溃 —— 要么立刻再起一个去抢那把锁，
        // 要么攒够次数进安全模式、把主窗口弹出来。
        if self.stopping.load(Ordering::SeqCst) {
            tracing::info!(?status, "core 已按要求停止");
            self.set(CoreState::Stopped);
            return Ok(Next::Stop);
        }
        tracing::warn!(?status, ?ran_for, "core 退出");

        if safe {
            // 安全模式下的 core 退出了，说明用户主动停的或者更严重的问题。
            self.set(CoreState::Stopped);
            return Ok(Next::Stop);
        }

        if self.intentional.swap(false, Ordering::SeqCst) {
            // 我们自己要求的退出。立刻重起，不计入失败。
            tracing::info!("按要求重启 core");
            self.set(CoreState::Restarting {
                attempt: 0,
                in_ms: 0,
            });
            return Ok(Next::Again);
        }

        let mut policy = self.policy.lock().await;
        if ran_for >= HEALTHY_AFTER {
            // 跑够久才重置阶梯。启动就崩的循环不该被误判成「恢复了」。
            policy.on_healthy();
        }
        let decision = policy.on_exit(Instant::now());
        let failures = policy.recent_failures();
        drop(policy);

        match decision {
            Decision::RestartAfter(d) => {
                self.set(CoreState::Restarting {
                    attempt: failures,
                    in_ms: d.as_millis() as u64,
                });
                if !d.is_zero() {
                    tokio::time::sleep(d).await;
                }
                Ok(Next::Again)
            }
            Decision::SafeMode => {
                self.set(CoreState::SafeMode);
                tracing::error!(failures, "连续失败太多，进安全模式");
                Ok(Next::SafeMode)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sup() -> Supervisor {
        Supervisor::new(
            PathBuf::from("/nonexistent/twcore"),
            Some(PathBuf::from("/tmp/c.yaml")),
        )
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
        let s = Supervisor::new(PathBuf::from("/x"), None);
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

    /// 一个不管参数、一直跑到被信号杀掉的「core」。
    fn long_runner(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tw-sup-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("fake-core");
        std::fs::write(&bin, "#!/bin/sh\nexec sleep 30\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    async fn until_running(s: &Supervisor) -> u32 {
        let mut rx = s.watch();
        loop {
            if let CoreState::Running { pid } = *rx.borrow_and_update() {
                return pid;
            }
            tokio::time::timeout(Duration::from_secs(5), rx.changed())
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
        let s = Arc::new(Supervisor::new(long_runner("stop"), None));
        let looped = {
            let s = s.clone();
            tokio::spawn(async move { s.run_once(false).await.unwrap() })
        };
        until_running(&s).await;

        let t0 = Instant::now();
        s.stop_and_wait(Duration::from_secs(5)).await;
        assert!(
            t0.elapsed() < Duration::from_secs(5),
            "SIGTERM 就该让它退出，不用等到强杀"
        );
        assert_eq!(s.state(), CoreState::Stopped);
        assert_eq!(looped.await.unwrap(), Next::Stop, "停下之后不再起");
    }

    #[tokio::test]
    async fn stopping_what_is_not_running_returns_at_once() {
        let s = sup();
        let t0 = Instant::now();
        s.stop_and_wait(Duration::from_secs(5)).await;
        assert!(t0.elapsed() < Duration::from_millis(100));
    }

    /// 对照组：改配置那种重启照旧立刻再起 —— 两个标志没有串。
    #[tokio::test]
    async fn a_requested_restart_still_comes_back() {
        let s = Arc::new(Supervisor::new(long_runner("restart"), None));
        let looped = {
            let s = s.clone();
            tokio::spawn(async move { s.run_once(false).await.unwrap() })
        };
        until_running(&s).await;
        s.request_restart().await.unwrap();
        assert_eq!(looped.await.unwrap(), Next::Again);
    }
}
