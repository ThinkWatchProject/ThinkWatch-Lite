//! core 的守护。
//!
//! 用户眼里 UI 和 core 是**同一个程序**（DESIGN.md §2.2.1）：UI 起它、
//! UI 关它、它自己不注册开机自启。所以「core 挂了」不是一个用户该处理
//! 的事件，而是这一层要悄悄修好的事。

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tokio::sync::Mutex;

pub mod policy;

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

pub struct Supervisor {
    binary: PathBuf,
    config: Option<PathBuf>,
    policy: Mutex<RestartPolicy>,
    state: Arc<Mutex<CoreState>>,
    /// 这次退出是我们自己要求的吗。
    ///
    /// **主动重启不该算进退避阶梯** —— 改一次配置就重启一次，配五次就
    /// 进安全模式，那是荒唐的。这个标志把「它崩了」和「我们让它退的」
    /// 分开，而这两件事在 `wait()` 眼里长得一模一样。
    intentional: Arc<AtomicBool>,
}

impl Supervisor {
    pub fn new(binary: PathBuf, config: Option<PathBuf>) -> Self {
        Self {
            binary,
            config,
            policy: Mutex::new(RestartPolicy::new()),
            state: Arc::new(Mutex::new(CoreState::Stopped)),
            intentional: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn state_handle(&self) -> Arc<Mutex<CoreState>> {
        self.state.clone()
    }

    /// 让 core 重起一次（改完配置之后用）。
    ///
    /// 做法是标记意图然后杀掉它，让守护循环自己把它拉起来 —— 而不是在
    /// 这里再写一遍启动逻辑。两处启动逻辑就是两处会漂移。
    pub async fn request_restart(&self) -> anyhow::Result<()> {
        let pid = match &*self.state.lock().await {
            CoreState::Running { pid } => *pid,
            other => anyhow::bail!("core 现在是 {other:?}，没在跑，不用重启"),
        };
        self.intentional.store(true, Ordering::SeqCst);
        // SIGTERM 而不是 SIGKILL：给它机会把 socket 和 lock 文件清掉。
        #[cfg(unix)]
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        Ok(())
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
    ///
    /// 返回 false 表示别再循环了（进了安全模式或被主动停掉）。
    pub async fn run_once(&self, safe: bool) -> anyhow::Result<bool> {
        *self.state.lock().await = CoreState::Starting;
        let args = self.command_args(safe);
        let started = Instant::now();

        let mut child = tokio::process::Command::new(&self.binary)
            .args(&args)
            // core 的日志走它自己的 stderr；UI 侧只需要知道它活着。
            .kill_on_drop(true)
            .spawn()?;

        if let Some(pid) = child.id() {
            *self.state.lock().await = CoreState::Running { pid };
            tracing::info!(pid, safe, "core 已启动");
        }

        // 信号一：子进程退出事件。**最快最准**，但只覆盖我们自己 spawn
        // 的那个 —— 所以另外两个信号（socket 断开、心跳）不是冗余。
        let status = child.wait().await?;
        let ran_for = started.elapsed();
        tracing::warn!(?status, ?ran_for, "core 退出");

        if safe {
            // 安全模式下的 core 退出了，说明用户主动停的或者更严重的问题。
            *self.state.lock().await = CoreState::Stopped;
            return Ok(false);
        }

        if self.intentional.swap(false, Ordering::SeqCst) {
            // 我们自己要求的退出。立刻重起，不计入失败。
            tracing::info!("按要求重启 core");
            *self.state.lock().await = CoreState::Restarting {
                attempt: 0,
                in_ms: 0,
            };
            return Ok(true);
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
                *self.state.lock().await = CoreState::Restarting {
                    attempt: failures,
                    in_ms: d.as_millis() as u64,
                };
                if !d.is_zero() {
                    tokio::time::sleep(d).await;
                }
                Ok(true)
            }
            Decision::SafeMode => {
                *self.state.lock().await = CoreState::SafeMode;
                tracing::error!(failures, "连续失败太多，进安全模式");
                Ok(false)
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
        assert_eq!(*sup().state_handle().lock().await, CoreState::Stopped);
    }
}
