//! core 的守护。
//!
//! 用户眼里 UI 和 core 是**同一个程序**：UI 起它、
//! UI 关它、它自己不注册开机自启。所以「core 挂了」不是一个用户该处理
//! 的事件，而是这一层要悄悄修好的事。

use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tokio::sync::{Mutex, watch};

pub mod health;
pub mod policy;
pub mod user_env;

pub use health::{HealthTracker, Verdict};
pub use policy::{Decision, RestartPolicy};

/// 跑多久算「这次起来是健康的」。短于这个时间就死，说明是启动就崩，
/// 不该重置退避阶梯。
const HEALTHY_AFTER: Duration = Duration::from_secs(30);

/// 进程起来之后，控制面多久还不答应就算这次没起来：换掉它，按一次失败算。
const READY_WITHIN: Duration = Duration::from_secs(15);

/// 问一次控制面答不答应。
///
/// **守护不认识控制面**，由外面给（lib.rs 里是一次带超时的 `/status`）。这样
/// 测试可以换成一个假的，不用真起一个会说 HTTP 的 core。
pub type Probe = Arc<dyn Fn() -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>;

/// 把一个返回 future 的闭包包成 [`Probe`]。
pub fn probe<F, Fut>(f: F) -> Probe
where
    F: Fn() -> Fut + Send + Sync + 'static,
    Fut: Future<Output = bool> + Send + 'static,
{
    Arc::new(move || -> Pin<Box<dyn Future<Output = bool> + Send>> { Box::pin(f()) })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreState {
    /// 进程在起，或者起来了但控制面还没答应。**这两段对界面是同一件事**：
    /// 都还不能取数
    Starting,
    /// 控制面答应了。界面见到它就可以开始取数
    Running {
        pid: u32,
    },
    Restarting {
        attempt: usize,
        in_ms: u64,
    },
    /// 只起控制面。用户还能改配置、回滚、还原接管 —— 那正是这时候最
    /// 需要的能力。
    ///
    /// **只起控制面的那个 core 跑着的整段时间都是它**，控制面答应了也不变成
    /// `Running`：那时网关并不转发，报「运行中」的话界面、菜单栏都说一切正常，
    /// 「网关未在转发」那条提醒也被撤掉。`pid` 是那个 core，它起来之前是 `None`
    SafeMode {
        pid: Option<u32>,
    },
    /// UI 主动停的，不再重启
    Stopped,
    /// 安全模式里的 core 也退出了：起不来的原因不在配置的某一行（那种情况 core 顶着一份
    /// 临时配置照样起控制面），而在别处 —— 另一个 core 占着、配置坏到连 YAML 都读不了。
    ///
    /// **原因是 core 自己最后说的话**（它的 stderr）。以前这里报的是 `Stopped`，界面上
    /// 只有一句「已停止」，原因只在日志里。守护停下，等用户点「重新启动」
    Exited {
        reason: String,
    },
    /// 拉不起来：程序运行不了（找不到、没有执行权限、不是这台机器能跑的）。
    ///
    /// **这不是「core 在崩」**，重启循环掩盖不了它，所以守护停下来等用户点重试。
    /// 原因要带着：界面上只写「正在启动」的话，用户会一直等下去
    Failed {
        reason: String,
    },
}

/// 程序运行不了的原因，说成一句话。
///
/// **不带「(os error 13)」**：那是给写代码的人看的，启动画面上要的是「没有执行
/// 权限」这种能照着去做的话。
fn why_not(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::NotFound => tr!("文件不存在", "the file does not exist").into(),
        std::io::ErrorKind::PermissionDenied => {
            tr!("没有执行权限", "it is not allowed to run").into()
        }
        _ if e.raw_os_error() == Some(libc::ENOEXEC) => tr!(
            "不是这台电脑能运行的程序",
            "it is not a program this computer can run"
        )
        .into(),
        _ => {
            let text = e.to_string();
            match text.find(" (os error ") {
                Some(i) => text[..i].to_string(),
                None => text,
            }
        }
    }
}

/// core 的 stderr：读到的每一行照写到我们自己的 stderr，最后几行留着。
struct Tail {
    lines: Arc<std::sync::Mutex<std::collections::VecDeque<String>>>,
    reader: tokio::task::JoinHandle<()>,
}

/// 留多少行。`Error:` 连同 `Caused by:` 下面那几层，十几行足够
const TAIL_LINES: usize = 40;

fn tail_of(stderr: tokio::process::ChildStderr) -> Tail {
    use tokio::io::AsyncBufReadExt;
    let lines = Arc::new(std::sync::Mutex::new(std::collections::VecDeque::new()));
    let keep = lines.clone();
    let reader = tokio::spawn(async move {
        let mut r = tokio::io::BufReader::new(stderr).lines();
        while let Ok(Some(line)) = r.next_line().await {
            eprintln!("{line}");
            if let Ok(mut l) = keep.lock() {
                if l.len() == TAIL_LINES {
                    l.pop_front();
                }
                l.push_back(line);
            }
        }
    });
    Tail { lines, reader }
}

impl Tail {
    /// 进程退出之后它说的最后那件事。管道在进程退出时关上，读的那一头随即读完；
    /// **最多等一会儿**，读不完也不能把守护循环挂住
    async fn reason(self) -> Option<String> {
        let _ = tokio::time::timeout(Duration::from_millis(500), self.reader).await;
        let lines: Vec<String> = self.lines.lock().ok()?.iter().cloned().collect();
        last_error(&lines)
    }
}

/// 从 core 的 stderr 里取出它最后报的那个错。
///
/// twcore 的 `main` 返回错误时，Rust 打的是 `Error: 那句话`，带着上下文的再跟一段
/// `Caused by:` 和编了号的几层。**整段连起来**：外层说在做什么（「loading …/config.yaml」），
/// 里层说为什么。没有 `Error:` 的（被信号杀掉、崩溃）取最后几行非空的
pub(crate) fn last_error(lines: &[String]) -> Option<String> {
    let start = lines.iter().rposition(|l| l.starts_with("Error: "));
    let Some(start) = start else {
        let tail: Vec<&str> = lines
            .iter()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect();
        let from = tail.len().saturating_sub(3);
        return (!tail.is_empty()).then(|| tail[from..].join("\n"));
    };
    let mut parts = Vec::new();
    for (i, l) in lines[start..].iter().enumerate() {
        let l = if i == 0 {
            &l["Error: ".len()..]
        } else {
            l.as_str()
        };
        let l = l.trim();
        if l.is_empty() || l == "Caused by:" {
            continue;
        }
        // 「0: 」「1: 」这种层号
        let l = match l.split_once(": ") {
            Some((n, rest)) if n.chars().all(|c| c.is_ascii_digit()) => rest,
            _ => l,
        };
        parts.push(l.to_string());
    }
    (!parts.is_empty()).then(|| parts.join("\n"))
}

/// 一次 core 退出之后，守护循环下一步做什么。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Next {
    /// 再起一个
    Again,
    /// 连续失败太多，改用安全模式起
    SafeMode,
    /// 不再起了：安全模式里的 core 也退出了，或者它是按要求停掉的（退出应用、装更新、
    /// 切到远程）
    Stop,
}

pub struct Supervisor {
    binary: PathBuf,
    config: Option<PathBuf>,
    ready: Probe,
    /// 请 core 退出要用到它。**Windows 上没有 SIGTERM**，那条路只能走控制面。
    control: crate::control::ControlClient,
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
    /// 按要求停的（退出应用、装更新、切到远程）。**和 `intentional` 相反：退了就不再起。**
    ///
    /// 两者分开是因为对 `wait()` 来说它们还是长得一模一样 —— 而一个应该
    /// 立刻重起，一个应该一个都不再起。
    ///
    /// **用 watch 而不是一个布尔**：守护循环在等控制面答应、在退避里睡着的时候都要被它
    /// 叫醒。只是一个标志的话，那两段里没人看它 —— 以前切到远程时，一个还在启动的 core
    /// 照样起来、照样占着网关端口，一个在退避里的睡醒了照样被拉起来
    stopping: watch::Sender<bool>,
    /// 起 core 之前补上用户配的环境变量。见 [`user_env`]。
    ///
    /// 测试里不开：那要真去跑一次用户的登录 shell。
    user_env: bool,
}

/// 强杀之后再给它这么久把状态翻过来。**不是在等它死** —— 那一下已经发出去了
/// —— 是在等守护循环收到子进程的退出。
const KILL_GRACE: Duration = Duration::from_secs(3);

/// 请它退出时，控制面最多等这么久。
///
/// **必须有。**握手还过得去、请求却没人答的 core，会让「请它退出」一直挂着 —— 而要
/// 请它退的几处（心跳换掉卡死的 core、装更新、退出应用）正赶上它不正常的时候，挂住
/// 的是那一处自己：心跳循环从此不再探，更新停在「正在重启」。等不到就当没请动，走
/// 下一档
const ASK_WITHIN: Duration = Duration::from_secs(3);

/// 等到有人要它停。**先看当下**（`wait_for` 就是这样），要求可能早就到了
async fn until_stopped(rx: &mut watch::Receiver<bool>) {
    // 拿到的那个借用当场放掉：它握着 watch 的读锁
    let _ = rx.wait_for(|s| *s).await;
}

/// 还没报「运行中」就被要求停：按句柄直接杀掉。
///
/// 还没答应控制面的 core 手上没有请求，温和那一档（控制面）也多半还叫不应；而它是
/// 守护循环手里的子进程，按句柄杀，不会杀到别人。一直不答应时换掉它也是这么做的
async fn stop_starting(
    child: &mut tokio::process::Child,
) -> std::io::Result<std::process::ExitStatus> {
    tracing::info!("core 还在启动就被要求停下，直接停掉");
    let _ = child.start_kill();
    child.wait().await
}

impl Supervisor {
    pub fn new(
        binary: PathBuf,
        config: Option<PathBuf>,
        ready: Probe,
        at: tw_api::control::Address,
        // 控制面的钥匙在哪份配置里。**这一侧只读**：core 起来时生成、补上
        key_file: PathBuf,
    ) -> Self {
        Self {
            binary,
            config,
            ready,
            control: crate::control::ControlClient::new(at, key_file),
            policy: Mutex::new(RestartPolicy::new()),
            state: watch::channel(CoreState::Stopped).0,
            intentional: Arc::new(AtomicBool::new(false)),
            stopping: watch::channel(false).0,
            user_env: false,
        }
    }

    /// 每次起 core 都补上用户配的环境变量。
    pub fn with_user_env(mut self) -> Self {
        self.user_env = true;
        self
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

    /// 请这个 pid 退出。**温和的那一档。**
    ///
    /// **两个平台都先走控制面**（`POST /shutdown`）。它比信号多一样：有应答，
    /// 所以这里知道对方收到了，而不是发完去猜。
    ///
    /// 更要紧的是 Windows 上它是**唯一**的温和办法 —— 那里没有 SIGTERM。
    /// 让 macOS 也走同一条，那条路才会被日常使用，而不是只在另一个平台上
    /// 偶尔跑一次。
    ///
    /// 控制面不应答时（core 卡死了、或者还没起好），unix 还有信号这条退路；
    /// Windows 上就只能交给调用方那一步强杀了。
    ///
    /// 请到了返回 true：控制面应了，或者信号送出去了。**Windows 上控制面不应就是没请到**：
    /// 那里没有信号这条退路，core 照旧跑着，调用方要知道
    async fn ask_to_exit(&self, pid: u32) -> bool {
        match tokio::time::timeout(ASK_WITHIN, self.control.shutdown()).await {
            Ok(Ok(())) => return true,
            Ok(Err(e)) => tracing::debug!("控制面请不动 core：{e:#}"),
            Err(_) => tracing::debug!(?ASK_WITHIN, "控制面没有回话"),
        }
        #[cfg(unix)]
        {
            // SAFETY: kill 只是往一个 pid 上送信号；送给一个已经没了的 pid
            // 是无害的。SIGTERM 而不是 SIGKILL —— 给它机会把 socket 和 lock
            // 文件清掉，而下一个 core 要的正是那把锁。
            unsafe { libc::kill(pid as i32, libc::SIGTERM) == 0 }
        }
        #[cfg(not(unix))]
        {
            let _ = pid;
            false
        }
    }

    /// 强杀这个 pid。**不温和的那一档**，只在温和那一档等不到时用。
    fn kill_now(&self, pid: u32) {
        #[cfg(unix)]
        {
            // SAFETY: 同上。不先检查它死没死 —— 那会引入一个 TOCTOU 窗口，
            // 而 kill 一个已经没了的 pid 本来就是无害的。
            unsafe { libc::kill(pid as i32, libc::SIGKILL) };
        }
        #[cfg(windows)]
        {
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::Threading::{
                OpenProcess, PROCESS_TERMINATE, TerminateProcess,
            };
            // SAFETY: 开一个只为了终止它的句柄，用完就关。打不开（它已经
            // 没了、或者不归我们管）就什么都不做 —— 和 unix 那边 kill 一个
            // 不存在的 pid 是同一种无害。
            unsafe {
                let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
                if !h.is_null() {
                    TerminateProcess(h, 1);
                    CloseHandle(h);
                }
            }
        }
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
        // 先请后杀。一个卡死的进程可能连信号处理器都跑不了，也可能连控制面
        // 都不应答了 —— 只用温和那一档的话，它会一直留着。
        self.ask_to_exit(pid).await;
        // **等它走，走了就不杀。**以前是干等三秒、再按这个 pid 强杀：它听了请求早就退了
        // 的话，守护循环已经在起下一个，这个号可能已经给了系统里别的进程。`wait_gone`
        // 看的是守护循环报的状态：还是「运行中、这个 pid」，就是它手里那个子进程还没
        // 退出、没被收走（收走之后它紧接着就换状态），这个号还是那个 core 的
        if !self.wait_gone(pid, Duration::from_secs(3)).await {
            self.kill_now(pid);
        }
        Ok(())
    }

    /// 让 core 重起一次（改完配置之后用）。
    ///
    /// 做法是标记意图然后杀掉它，让守护循环自己把它拉起来 —— 而不是在
    /// 这里再写一遍启动逻辑。两处启动逻辑就是两处会漂移。
    ///
    /// 安全模式下也走这里：那个只起控制面的 core 退出之后，守护循环按正常模式再起
    pub async fn request_restart(&self) -> anyhow::Result<()> {
        let pid = match self.state() {
            CoreState::Running { pid } | CoreState::SafeMode { pid: Some(pid) } => pid,
            CoreState::Starting
            | CoreState::Restarting { .. }
            | CoreState::SafeMode { pid: None } => {
                anyhow::bail!(tr!(
                    "core 正在启动，请稍后再试",
                    "Core is starting; try again in a moment"
                ))
            }
            CoreState::Stopped | CoreState::Exited { .. } | CoreState::Failed { .. } => {
                anyhow::bail!(tr!(
                    "core 未运行，无法重启",
                    "Core is not running and cannot be restarted"
                ))
            }
        };
        self.intentional.store(true, Ordering::SeqCst);
        // 下一个 core 要的用户环境现在就开始读，和这一个收尾叠在一起（见 `user_env::read_ahead`）
        if self.user_env {
            tokio::spawn(user_env::read_ahead());
        }
        // 温和那一档就够：它自己退干净，守护循环看见就把它拉回来。
        if !self.ask_to_exit(pid).await {
            // **没请动就把记号收回来。**Windows 上控制面不应时再没有别的温和办法，core
            // 照旧跑着；记号留着的话，它下一次真的崩溃会被当成这次重启 —— 不计入退避、
            // 连着崩也进不了安全模式、也不提醒。「重新启动」也不该静默成功
            self.intentional.store(false, Ordering::SeqCst);
            anyhow::bail!(tr!(
                "core 没有响应，未能重启",
                "Core did not respond and was not restarted"
            ));
        }
        Ok(())
    }

    /// 停掉 core、守护不再拉它，**并且等它真的退出**。
    ///
    /// 应用重启（装完更新）之前要用它。只是自己退出、让 core 靠 `--parent`
    /// 发现父进程没了再跟着退是不够的：它要一秒左右才发现，而新起来的应用
    /// 这时已经在拉新的 core —— 锁还在旧的手里，新的连起几次都失败，网关
    /// 多停一秒，日志里多出几段「已经有一个 twcore 在跑」。这是实测出来的。
    /// 切到远程之后停本机的 core 也是它。
    ///
    /// **不管此刻走到哪一步都算数。**以前只认「运行中」，别的时候直接返回：还在启动的、
    /// 在退避里等着重起的 core 照样被拉起来 —— 切到远程之后本机的网关还占着那个端口，
    /// Windows 上安装程序还撞上一个在跑的 twcore.exe。现在记号先立起来，守护循环在起
    /// 之前、等控制面答应的时候、退避睡着的时候都听着它；这里等到「已停止」（或者
    /// 「无法启动」），至多 `timeout`。
    ///
    /// 在跑的，超时还没退就强杀。**已经停着就什么都不做。**
    pub async fn stop_and_wait(&self, timeout: Duration) {
        self.stopping.send_replace(true);
        let mut rx = self.watch();
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            // 先取出来再看：`borrow` 握着读锁，不能带过下面的 await
            let now = rx.borrow_and_update().clone();
            match now {
                CoreState::Stopped | CoreState::Exited { .. } | CoreState::Failed { .. } => return,
                CoreState::Running { pid } | CoreState::SafeMode { pid: Some(pid) } => {
                    return self.stop_running(pid, timeout).await;
                }
                // 启动中、退避里、安全模式的 core 还没答应：守护循环自己看得见那个记号，
                // 等它停下来。停下之前先报了答应（记号到的那一刻它正好答应了），就走上面
                // 那一支
                _ => {}
            }
            match tokio::time::timeout_at(deadline, rx.changed()).await {
                Ok(Ok(())) => {}
                Ok(Err(_)) => return,
                Err(_) => {
                    tracing::error!(?timeout, state = ?self.state(), "要停的 core 没按时停下");
                    return;
                }
            }
        }
    }

    /// 停掉答应了控制面的这一个（运行中，或者安全模式里的）：先请，等不到再强杀。
    async fn stop_running(&self, pid: u32, timeout: Duration) {
        self.ask_to_exit(pid).await;
        if self.wait_gone(pid, timeout).await {
            return;
        }
        tracing::warn!(pid, ?timeout, "core 没按时退出，强杀");
        self.kill_now(pid);
        // **强杀之后还要再等一次。**这个函数的名字里有「等它真的退出」，而
        // 强杀只是把那一下发出去了 —— 守护循环还要收到子进程的退出、把状态
        // 翻过来，才算真的没了。
        //
        // 以前这里发完就返回。unix 上看不出来：温和那一档从来都管用，这条路
        // 走不到。Windows 上控制面连不上时它就是常规路径，而不等的后果正是
        // 这个函数存在要防的那件事 —— 紧接着起的下一个 core 撞上还没释放的锁。
        if !self.wait_gone(pid, KILL_GRACE).await {
            tracing::error!(pid, "强杀之后它还在");
        }
    }

    /// 撤回 `stop_and_wait` 留下的「按要求停止」，连同没来得及用上的「按要求重启」。
    ///
    /// 每次接起守护循环之前调。那两个记号只对停掉的那一个 core 有意义；带进
    /// 下一轮的话，之后的崩溃全都会被当成按要求停止，不重启、不进安全模式。
    /// 重启请求撞上停止时（点了「重新启动」、紧接着切到远程），守护循环先认停止，
    /// 重启的记号就留了下来：新一轮里第一次真崩溃会被当成按要求重启。
    pub fn resume(&self) {
        self.stopping.send_replace(false);
        self.intentional.store(false, Ordering::SeqCst);
    }

    /// 按要求停下：报「已停止」，守护循环不再起它。
    fn stopped(&self) -> Next {
        self.set(CoreState::Stopped);
        Next::Stop
    }

    /// 等到它不再是这个 pid。等到了返回 true，超时返回 false。
    ///
    /// **先看当下再等变化**：状态可能在订阅之前就已经翻过去了。
    async fn wait_gone(&self, pid: u32, timeout: Duration) -> bool {
        let mut rx = self.watch();
        let gone = async {
            while matches!(
                *rx.borrow_and_update(),
                CoreState::Running { pid: p } | CoreState::SafeMode { pid: Some(p) } if p == pid
            ) {
                if rx.changed().await.is_err() {
                    break;
                }
            }
        };
        tokio::time::timeout(timeout, gone).await.is_ok()
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

    /// 本机 core 的控制面客户端。**永远指着本机**，切到远程也不跟着走：等本机手上的
    /// 请求结束、再停掉它，问的都是本机这一个
    pub fn control(&self) -> &crate::control::ControlClient {
        &self.control
    }

    pub fn binary(&self) -> &PathBuf {
        &self.binary
    }

    /// 等控制面答应，最多 [`READY_WITHIN`]。答应了是 true。
    ///
    /// 先密后疏：通常一两百毫秒就好了，那时候隔半秒才问一次，启动画面就平白
    /// 多停半秒。
    async fn until_ready(&self) -> bool {
        // tokio 的时钟：测试里暂停时钟就能跑过这 15 秒
        let deadline = tokio::time::Instant::now() + READY_WITHIN;
        let mut gap = Duration::from_millis(25);
        loop {
            if (self.ready)().await {
                return true;
            }
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(gap).await;
            gap = (gap * 2).min(Duration::from_millis(400));
        }
    }

    /// 一次「起、看着、它死了、决定下一步」的完整循环。
    pub async fn run_once(&self, safe: bool) -> anyhow::Result<Next> {
        // **起之前先看一眼。**要停的请求可能正落在两轮之间（按要求重启、进安全模式的
        // 那一下），不看的话刚被要求停下的又被拉起来
        let mut stop = self.stopping.subscribe();
        if *stop.borrow_and_update() {
            return Ok(self.stopped());
        }
        self.set(if safe {
            CoreState::SafeMode { pid: None }
        } else {
            CoreState::Starting
        });
        let args = self.command_args(safe);
        let started = Instant::now();

        let mut cmd = tokio::process::Command::new(&self.binary);
        if self.user_env {
            // 读用户的环境要跑一次登录 shell，最多五秒。这段里被要求停，就不起了 ——
            // 不是起一个再杀掉
            tokio::select! {
                env = user_env::load() => {
                    cmd.envs(env);
                }
                _ = until_stopped(&mut stop) => return Ok(self.stopped()),
            }
        }
        // **不交凭据。**控制面的钥匙在 config.yaml 里，由 core 自己生成、补上；
        // 这一侧连接时从同一个文件读（见 `crate::control`）
        cmd.args(&args)
            // **stderr 接过来**：退出时 core 最后说的那几句（`Error: …`）就是起不来的原因，
            // 安全模式里的 core 也退出时要拿它给界面看（`Exited`）。读到的每一行照样写到
            // 我们自己的 stderr，开发时在终端里看到的和以前一样
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        // **不给它开控制台窗口。**twcore 是个命令行程序，Windows 上起一个控制台
        // 子系统的程序、父进程自己又没有控制台时，系统会给它新开一个 —— 用户
        // 就会看见一个标着 twcore.exe 路径、滚着日志的黑窗口，关掉它网关就没了。
        // 真机上装好第一次打开就是这样。
        #[cfg(windows)]
        cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        let mut spawned = cmd.spawn();
        // **「文本文件忙」等一下再试。**刚写完的可执行文件，只要还有别的进程
        // 握着它的写句柄，exec 就会拒绝（ETXTBSY）。别的线程恰好在这时 fork，
        // 子进程在 exec 之前会短暂继承一份这样的句柄 —— 不是这个文件真的
        // 坏了，过一瞬间就好。cargo 自己跑构建脚本时也是这样重试的。Linux 的
        // CI 上并行跑的测试撞到过：写完假 core 立刻起它
        for _ in 0..5 {
            match &spawned {
                Err(e) if e.kind() == std::io::ErrorKind::ExecutableFileBusy => {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    spawned = cmd.spawn();
                }
                _ => break,
            }
        }
        let (mut child, last_words) = match spawned {
            Ok(mut c) => {
                let t = c.stderr.take().map(tail_of);
                (c, t)
            }
            Err(e) => {
                let path = self.binary.display();
                let why = why_not(&e);
                self.set(CoreState::Failed {
                    reason: tr!(
                        format!("无法运行 {path}：{why}"),
                        format!("{path} could not be run: {why}")
                    ),
                });
                return Err(e.into());
            }
        };

        // **进程起来了还不算起好。**控制面的 socket 要再过一会儿才建好，这之前
        // 报「运行中」的话，界面一见到就去取数，拿回来的是一句「连不上」。
        // 所以控制面答应之前一直是「启动中」；等的这段时间里它要是退出了，
        // 照崩溃算。
        //
        // **等的时候也听着「要停」**：等它答应最长要十五秒，而要它停的那一方（切到远程、
        // 装更新、退出）在等它退。
        enum Waited {
            Exited(std::io::Result<std::process::ExitStatus>),
            Ready(bool),
            Stop,
        }
        let waited = tokio::select! {
            status = child.wait() => Waited::Exited(status),
            ready = self.until_ready() => Waited::Ready(ready),
            _ = until_stopped(&mut stop) => Waited::Stop,
        };
        // 信号一：子进程退出事件。**最快最准**，但只覆盖我们自己 spawn
        // 的那个 —— 所以另外两个信号（socket 断开、心跳）不是冗余。
        let status = match waited {
            Waited::Exited(status) => status?,
            // 答应的那一刻「要停」也到了：不报「运行中」，和下面一样停掉
            Waited::Ready(true) if *self.stopping.borrow() => stop_starting(&mut child).await?,
            Waited::Ready(ready) => {
                match (ready, child.id()) {
                    (true, Some(pid)) => {
                        self.set(if safe {
                            CoreState::SafeMode { pid: Some(pid) }
                        } else {
                            CoreState::Running { pid }
                        });
                        tracing::info!(pid, safe, elapsed = ?started.elapsed(), "core 已就绪");
                    }
                    (true, None) => {}
                    (false, _) => {
                        tracing::error!(?READY_WITHIN, "core 的控制面一直没有答应，换掉它");
                        let _ = child.start_kill();
                    }
                }
                child.wait().await?
            }
            Waited::Stop => stop_starting(&mut child).await?,
        };
        let ran_for = started.elapsed();

        // **先看是不是按要求停的。**这一条必须排在最前面：落到下面任何
        // 一个分支里，它都会被当成一次崩溃 —— 要么立刻再起一个去抢那把锁，
        // 要么攒够次数进安全模式、把主窗口弹出来。
        if *self.stopping.borrow() {
            tracing::info!(?status, "core 已按要求停止");
            return Ok(self.stopped());
        }
        tracing::warn!(?status, ?ran_for, "core 退出");

        // **排在安全模式那一条前面**：在安全模式里点「重新启动」，要的是按正常模式
        // 再起一次（守护循环见到 `Again` 就离开安全模式）。排在后面的话，那一下只把
        // core 停了，要重启的记号还留着，之后第一次真崩溃会被当成按要求重启
        if self.intentional.swap(false, Ordering::SeqCst) {
            // 我们自己要求的退出。立刻重起，不计入失败。
            tracing::info!("按要求重启 core");
            self.set(CoreState::Restarting {
                attempt: 0,
                in_ms: 0,
            });
            return Ok(Next::Again);
        }

        if safe {
            // 安全模式下的 core 也退出了：配置哪一行错了的话它会顶着临时配置起来，走到这里
            // 是更根本的问题。**把它最后说的话交给界面**，说不出什么才报「已停止」
            let reason = match last_words {
                Some(t) => t.reason().await,
                None => None,
            };
            self.set(match reason {
                Some(reason) => CoreState::Exited { reason },
                None => CoreState::Stopped,
            });
            return Ok(Next::Stop);
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
                    // 下一个要的用户环境趁退避的这几秒读
                    if self.user_env {
                        tokio::spawn(user_env::read_ahead());
                    }
                    // 退避最长睡八秒。这中间被要求停，就不必睡完、更不该再起一个
                    tokio::select! {
                        _ = tokio::time::sleep(d) => {}
                        _ = until_stopped(&mut stop) => return Ok(self.stopped()),
                    }
                }
                Ok(Next::Again)
            }
            Decision::SafeMode => {
                self.set(CoreState::SafeMode { pid: None });
                tracing::error!(failures, "连续失败太多，进安全模式");
                Ok(Next::SafeMode)
            }
        }
    }
}

#[cfg(test)]
mod tests;
