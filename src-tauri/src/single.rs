//! 同一时间只运行一个实例，谁运行就听谁的。
//!
//! 安装版和绿色版用的是同一把锁（单实例插件按应用标识起名），所以它们也互斥。
//! 插件只会把第二个进程的参数转交给第一个、然后让第二个退出；这里补上插件
//! 不做的那部分：开的是另一个位置的程序时说明情况，并且可以切换过去。
//!
//! # 切换怎么走
//!
//! 1. 新开的这一个（[`precheck`]，Tauri 起来之前）看见锁被占着、占着它的程序在别的位置，
//!    问一句；选了切换，就置位运行中那一个建的命名事件（[`handoff_name`]）。
//! 2. 运行中的那一个（[`listen`]）收到事件：等手上的请求结束（最多三分钟，和装更新时同一套）、
//!    停掉 core、退出，全程不超过 [`STEP_ASIDE_LIMIT`]。退出时插件放开那把锁。
//! 3. 新开的这一个一直等到锁被放开（[`WAIT_LIMIT`]），**关掉自己手里的锁句柄**，接着
//!    正常启动 —— 插件随后建锁时看到的是一把没人用的新锁。
//!
//! 运行中的那一个以管理员身份运行时，这一边打不开它的锁、也置不了它的事件：说明之后
//! 退出，不让两个实例同时跑起来（插件自己在这种情况下认不出它）。
//!
//! 锁和窗口的名字以 `tauri-plugin-single-instance` 2.4.5 的 `platform_impl/windows.rs`
//! 为准：锁 `<标识>-sim`、接收转交的窗口类 `<标识>-sic`、窗口名 `<标识>-siw`
//! （没开 `semver` 特性，名字里不带版本号）。插件升级时要核对一遍。
//!
//! 判断要不要问的那一步是纯函数（[`verdict`]），哪个平台都测；剩下的只有 Windows 有。

// 名字、文案、判断在每个平台都编译，测试因此在哪都跑；真正调它们的只有 Windows
#![cfg_attr(not(windows), allow(dead_code))]

use crate::winreg::{IDENTIFIER, SCHEME, same_path};

/// 等运行中的程序退出，最多等多久。它那边等请求结束最多三分钟
/// （`updater::DRAIN_LIMIT`），再加上停 core 的几秒
pub(crate) const WAIT_LIMIT: std::time::Duration = std::time::Duration::from_secs(200);

/// 运行中的那一个让位，从收到请求到退出最多花多久：比请求的那一边等的 [`WAIT_LIMIT`]
/// 短，它等得到
pub(crate) const STEP_ASIDE_LIMIT: std::time::Duration = std::time::Duration::from_secs(190);

/// 让位时留给停 core 的时间：`stop_and_wait` 请它退、等它、强杀、再等，都在这里面
pub(crate) const STOP_BUDGET: std::time::Duration = std::time::Duration::from_secs(10);

/// 单实例插件建的锁
pub(crate) fn mutex_name() -> String {
    format!("{IDENTIFIER}-sim")
}

/// 单实例插件接收转交的那个隐藏窗口：类名、窗口名
pub(crate) fn window_names() -> (String, String) {
    (format!("{IDENTIFIER}-sic"), format!("{IDENTIFIER}-siw"))
}

/// 「请退出、让给我」的命名事件，由运行中的那一个建。**会话内可见**（`Local\`），和插件
/// 那把锁在同一个范围：别的登录用户的实例不归这里管
pub(crate) fn handoff_name() -> String {
    format!(r"Local\{IDENTIFIER}-handoff")
}

/// 锁被占着的时候怎么办
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Verdict {
    /// 交给插件：它把参数转给运行中的那个、把它的窗口叫到前面，本进程退出
    Forward,
    /// 运行中的程序在另一个位置（这里是它的路径）：说明情况，问要不要切换
    Ask(String),
}

/// 锁被占着时，要不要问一句。
///
/// - 带着 `thinkwatch://` 链接或开机标记的：**不问**。链接是浏览器、通知拉起来的，要交给
///   运行中的那一个处理；开机拉起来的不该在登录时弹框。
/// - 运行中的程序就是这一个（同一个路径），或者查不出它在哪：不问，插件把它的窗口叫到前面。
/// - 在别的位置：问。
///
/// `args` 不含程序名；两个路径不碰磁盘地比（见 `winreg::same_path`），要展开的由调用方先展开
pub(crate) fn verdict<S: AsRef<str>>(
    args: &[S],
    running: Option<&str>,
    current: Option<&str>,
) -> Verdict {
    let link = args.iter().any(|a| {
        a.as_ref()
            .split_once("://")
            .is_some_and(|(scheme, _)| scheme.eq_ignore_ascii_case(SCHEME))
    });
    if link || crate::autostart::launched_by_autostart(args) {
        return Verdict::Forward;
    }
    match (running, current) {
        (Some(running), Some(current)) if !same_path(running, current) => {
            Verdict::Ask(running.to_string())
        }
        _ => Verdict::Forward,
    }
}

/// 对话框的标题
const TITLE: &str = "ThinkWatch Lite";

/// 这几个对话框共用的主句
pub(crate) fn running_text() -> &'static str {
    tr!(
        "ThinkWatch Lite 已在运行",
        "ThinkWatch Lite is already running"
    )
}

/// 运行中的程序在别处时问的那一句：主句、正文、两个按钮（第一个是切换）
pub(crate) fn ask_text(running: &str) -> (&'static str, String, [&'static str; 2]) {
    (
        running_text(),
        tr!(
            format!("运行中的程序位于：{running}。同一时间只能运行一个 ThinkWatch Lite。"),
            format!(
                "The running program is at {running}. Only one ThinkWatch Lite can run at a time."
            )
        ),
        [
            tr!(
                "停止运行中的程序并启动此程序",
                "Stop the running program and start this one"
            ),
            tr!("取消", "Cancel"),
        ],
    )
}

/// 等运行中的程序退出时的主句
pub(crate) fn waiting_text() -> &'static str {
    tr!(
        "正在等待进行中的请求完成…",
        "Waiting for requests in progress to finish…"
    )
}

/// 运行中的程序是不支持切换的旧版本（没建那个事件）
pub(crate) fn unsupported_text() -> &'static str {
    tr!(
        "运行中的程序不支持切换，请先退出该程序。",
        "The running program does not support switching. Quit it first."
    )
}

/// 运行中的那一个权限更高（以管理员身份运行）：这里打不开它的锁、置不了它的事件
pub(crate) fn elevated_text() -> &'static str {
    tr!(
        "运行中的程序以管理员身份运行，无法从此处停止。请先退出该程序。",
        "The running program runs as administrator and cannot be stopped from here. Quit it first."
    )
}

/// 等到上限它还没退
pub(crate) fn timeout_text() -> &'static str {
    tr!(
        "运行中的程序未能退出。",
        "The running program did not quit."
    )
}

/// 程序真正启动之前调用。已经有一个实例在运行时，按情况静默转交、提示后退出，
/// 或者等运行中的那个退出后接着启动。没有在运行的实例、或者不是 Windows，什么都不做。
pub fn precheck() {
    #[cfg(windows)]
    imp::precheck();
}

/// 运行中的实例这一侧：等「切换」的请求，收到后等进行中的请求结束、停掉 core、退出。
/// 不是 Windows 什么都不做。
pub fn listen(app: &tauri::AppHandle) {
    #[cfg(windows)]
    imp::listen(app);
    #[cfg(not(windows))]
    let _ = app;
}

#[cfg(windows)]
mod imp {
    use std::time::{Duration, Instant};

    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, ERROR_FILE_NOT_FOUND, GetLastError,
        HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0,
    };
    use windows_sys::Win32::System::Threading::{
        CreateEventW, EVENT_MODIFY_STATE, INFINITE, OpenEventW, OpenMutexW, OpenProcess,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
        ReleaseMutex, ResetEvent, SYNCHRONIZATION_SYNCHRONIZE, SetEvent, WaitForSingleObject,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowThreadProcessId};

    use super::*;
    use crate::dialog;
    use crate::winreg::plain_path;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 一个内核对象的句柄，离开作用域就关掉
    pub(super) struct Handle(HANDLE);

    // SAFETY: 内核对象的句柄是进程范围的，哪个线程用、哪个线程关都行
    unsafe impl Send for Handle {}

    impl Handle {
        fn new(h: HANDLE) -> Option<Self> {
            (!h.is_null()).then_some(Self(h))
        }
    }

    impl Drop for Handle {
        fn drop(&mut self) {
            // SAFETY: 这个句柄是这里独有的，只关这一次
            unsafe { CloseHandle(self.0) };
        }
    }

    pub fn precheck() {
        let lock = match open_mutex(&mutex_name()) {
            Ok(lock) => lock,
            // 锁不在：没有在运行的实例
            Err(ERROR_FILE_NOT_FOUND) => return,
            // **锁在，但打不开**：运行中的那一个权限更高（以管理员身份运行），它建的锁
            // 不让这里碰。插件自己这时也认不出它：`CreateMutexW` 失败、报的不是「已经存在」，
            // 插件就当自己是第一个接着启动（它的参数也转不过去 —— 低权限的进程发给高权限
            // 窗口的消息会被系统拦下）。放过去就是两个实例抢同一个端口
            Err(ERROR_ACCESS_DENIED) => {
                tell(elevated_text());
                std::process::exit(1);
            }
            Err(e) => {
                tracing::warn!(code = e, "打不开单实例的锁，交给插件判断");
                return;
            }
        };
        let args: Vec<String> = std::env::args_os()
            .skip(1)
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let running = running_exe().map(|p| canonical(&p));
        let current = std::env::current_exe()
            .ok()
            .map(|p| canonical(&p.to_string_lossy()));
        let Verdict::Ask(running) = verdict(&args, running.as_deref(), current.as_deref()) else {
            return;
        };
        let (instruction, content, buttons) = ask_text(&running);
        if dialog::show(TITLE, instruction, &content, &buttons) != Some(0) {
            // 取消、关掉对话框：照插件的老样子，运行中的那个到前面来，这一个退出
            return;
        }
        if let Err(code) = signal(&handoff_name(), Duration::from_secs(2)) {
            // 对话框开着的时候，运行中的那一个可能已经自己退出了（事件跟着它没了）：
            // 锁放开了，就照常启动
            if wait_released(lock, Duration::ZERO) {
                tracing::info!("运行中的程序已经退出，照常启动");
                return;
            }
            tell(if code == ERROR_ACCESS_DENIED {
                elevated_text()
            } else {
                unsupported_text()
            });
            std::process::exit(1);
        }
        tracing::info!(%running, "已请运行中的程序退出，等它放开单实例的锁");
        let released = dialog::wait(TITLE, waiting_text(), "", move || {
            wait_released(lock, WAIT_LIMIT)
        });
        if !released {
            tell(timeout_text());
            std::process::exit(1);
        }
        tracing::info!("运行中的程序已退出，接着启动");
    }

    /// 说一句话，只有一个「确定」
    fn tell(content: &str) {
        dialog::show(TITLE, running_text(), content, &[tr!("确定", "OK")]);
    }

    /// 打开一把已经在的命名锁（只要能等它的权限）。打不开时是系统给的错误码：不在是
    /// `ERROR_FILE_NOT_FOUND`，在但没有权限是 `ERROR_ACCESS_DENIED`
    pub(super) fn open_mutex(name: &str) -> Result<Handle, u32> {
        let name = wide(name);
        // SAFETY: 名字以 0 结尾
        let raw = unsafe { OpenMutexW(SYNCHRONIZATION_SYNCHRONIZE, 0, name.as_ptr()) };
        // SAFETY: 紧跟在上一个调用之后，中间没有别的系统调用
        Handle::new(raw).ok_or_else(|| unsafe { GetLastError() })
    }

    /// 等这把锁被放开，至多 `limit`（零就是只看一眼）。放开了是 `true`。
    ///
    /// 等到了，这个线程就**拿到了**这把锁：先还回去，再关句柄 —— 两样都在返回之前做完，
    /// 而且在等它的同一个线程上（锁属于线程）。不然插件随后 `CreateMutexW` 时这把锁还在、
    /// 还被这里占着，它会以为另有一个实例在跑。对方没放就退出了（崩溃、被强杀）是
    /// `WAIT_ABANDONED`，也算放开了
    pub(super) fn wait_released(lock: Handle, limit: Duration) -> bool {
        let ms = u32::try_from(limit.as_millis()).unwrap_or(u32::MAX - 1);
        // SAFETY: 句柄有效，有 SYNCHRONIZE 权限
        let r = unsafe { WaitForSingleObject(lock.0, ms) };
        let released = r == WAIT_OBJECT_0 || r == WAIT_ABANDONED;
        if released {
            // SAFETY: 这个线程刚等到它，是它的主人
            unsafe { ReleaseMutex(lock.0) };
        }
        drop(lock);
        released
    }

    /// 置位运行中那一个建的事件。打不开时是系统给的错误码：
    ///
    /// - `ERROR_FILE_NOT_FOUND`：没有这个事件。它刚启动、还没建好的话等一小会儿再试
    ///   （`patience`）；一直没有，那是不支持切换的旧版本（或者它已经退出了）。
    /// - `ERROR_ACCESS_DENIED`：事件在，但它是以管理员身份运行的那一个建的，这里没有
    ///   权限置位。不再等
    pub(super) fn signal(name: &str, patience: Duration) -> Result<(), u32> {
        let name = wide(name);
        let deadline = Instant::now() + patience;
        loop {
            // SAFETY: 名字以 0 结尾
            let raw = unsafe { OpenEventW(EVENT_MODIFY_STATE, 0, name.as_ptr()) };
            // SAFETY: 紧跟在上一个调用之后
            let code = unsafe { GetLastError() };
            if let Some(event) = Handle::new(raw) {
                // SAFETY: 句柄有效，有 EVENT_MODIFY_STATE 权限
                if unsafe { SetEvent(event.0) } != 0 {
                    return Ok(());
                }
                // SAFETY: 紧跟在上一个调用之后
                return Err(unsafe { GetLastError() });
            }
            if code != ERROR_FILE_NOT_FOUND || Instant::now() >= deadline {
                return Err(code);
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    /// 运行中的那个实例的 exe：插件那个隐藏窗口 → 进程号 → 进程的映像路径
    fn running_exe() -> Option<String> {
        let (class, window) = window_names();
        let (class, window) = (wide(&class), wide(&window));
        // SAFETY: 两个名字都以 0 结尾
        let hwnd = unsafe { FindWindowW(class.as_ptr(), window.as_ptr()) };
        if hwnd.is_null() {
            return None;
        }
        let mut pid = 0;
        // SAFETY: 窗口句柄来自上面；`pid` 是一个可写的 u32
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        (pid != 0).then(|| process_image(pid)).flatten()
    }

    /// 一个进程的 exe 路径。**只要最低一档的查询权限**：以管理员身份运行的那一个也查得到
    pub(super) fn process_image(pid: u32) -> Option<String> {
        // SAFETY: 只是打开一个进程句柄；失败是空句柄
        let process =
            Handle::new(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) })?;
        let mut buf = vec![0u16; 32 * 1024];
        let mut len = buf.len() as u32;
        // SAFETY: 缓冲区和它的长度（以字符计）对得上
        let ok = unsafe {
            QueryFullProcessImageNameW(process.0, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len)
        };
        (ok != 0).then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }

    /// 比路径之前先展开（短文件名、链接、`subst`）；展开不了就用原样
    fn canonical(p: &str) -> String {
        std::fs::canonicalize(p)
            .map(|c| plain_path(&c.to_string_lossy()))
            .unwrap_or_else(|_| p.to_string())
    }

    pub fn listen(app: &tauri::AppHandle) {
        let Some(event) = create_handoff_event(&handoff_name()) else {
            tracing::warn!("建不了切换用的事件，另一个位置的程序将无法切换过来");
            return;
        };
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("handoff".into())
            .spawn(move || {
                // SAFETY: 句柄有效
                if unsafe { WaitForSingleObject(event.0, INFINITE) } != WAIT_OBJECT_0 {
                    return;
                }
                // **事件留着，直到进程退出**：这时又有一个新开的来请求，它打得开、置得上，
                // 然后和第一个一样等锁，而不是被告知「不支持切换」
                std::mem::forget(event);
                tracing::info!("另一个位置的程序请求切换：等进行中的请求结束后退出");
                tauri::async_runtime::spawn(step_aside(app));
            });
        if let Err(e) = spawned {
            tracing::warn!("起不了等切换的线程：{e}");
        }
    }

    /// 建切换用的事件：自动复位、一开始没置位。
    ///
    /// **已经有了就先复位。**上一个实例让位时把事件留到了它退出（见 `listen`），这期间
    /// 又有人置位过的话，它就一直是置位的；新起来的这一个要是接着用，一启动就会以为有人
    /// 请它让位
    pub(super) fn create_handoff_event(name: &str) -> Option<Handle> {
        let name = wide(name);
        // SAFETY: 名字以 0 结尾；安全属性用默认的
        let raw = unsafe { CreateEventW(std::ptr::null(), 0, 0, name.as_ptr()) };
        // SAFETY: 紧跟在上一个调用之后
        let existed = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        let event = Handle::new(raw)?;
        if existed {
            // SAFETY: 句柄有效，建的时候拿到的是全部权限
            unsafe { ResetEvent(event.0) };
        }
        Some(event)
    }

    /// 让位：记成用户自己退出的 → 等手上的请求结束（最多三分钟，和装更新时同一套）→
    /// 停掉 core、等它真的走 → 退出。**整个过程有一个总时限**（[`STEP_ASIDE_LIMIT`]），
    /// 比请求的那一边等的短：到点了不管走到哪一步都退出。
    ///
    /// **core 要在退出之前停干净**：插件在退出的那一刻放开锁，新的那一个马上起来拉它自己的
    /// core，旧的还占着网关的端口就会撞上
    async fn step_aside(app: tauri::AppHandle) {
        use tauri::Manager;
        // 用户在另一个程序里选了「停止运行中的程序」：和菜单里点「退出」一样，退出时
        // 删掉 `.last-exit`，之后再打开这一份不当成更新之后的重开
        crate::updater::quitting_by_user();
        let sup = app
            .try_state::<crate::AppState>()
            .map(|st| st.supervisor.clone());
        if let Some(sup) = sup {
            let deadline = tokio::time::Instant::now() + STEP_ASIDE_LIMIT;
            // 停 core 的时间留出来：等请求最多等到总时限前 `STOP_BUDGET`
            let quiet = tokio::time::timeout_at(
                deadline - STOP_BUDGET,
                crate::updater::wait_for_quiet(sup.control(), |_| {}),
            )
            .await;
            if quiet.is_err() {
                // **到点了照样走**：请求切换的那一个还开着等待的对话框，它等的就是这里
                // 退出；它最多等 `WAIT_LIMIT`，过了就报「未能退出」，两边都落空
                tracing::warn!("让位：请求没在时限内结束，照样退出");
            }
            if tokio::time::timeout_at(deadline, sup.stop_and_wait(Duration::from_secs(5)))
                .await
                .is_err()
            {
                tracing::warn!("让位：core 没在时限内停下，照样退出（它的 --parent 守望会跟着走）");
            }
        }
        app.exit(0);
    }

    /// 锁、事件、进程路径这几样只能在真的 Windows 上测。名字带上进程号，不和这台机器上
    /// 正在跑的 ThinkWatch Lite 撞
    #[cfg(test)]
    mod tests {
        use windows_sys::Win32::Foundation::WAIT_TIMEOUT;
        use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
        use windows_sys::Win32::System::Threading::CreateMutexW;

        use super::*;

        fn unique(what: &str) -> String {
            format!(r"Local\thinkwatch-test-{}-{what}", std::process::id())
        }

        /// 带着一份安全描述符（SDDL）建对象。`D:P` 是一份空的受保护 DACL：谁都打不开它，
        /// 建它的这一个句柄除外 —— 和管理员身份的实例建的锁、事件在这里的样子一样
        fn with_sddl<T>(sddl: &str, f: impl FnOnce(*const SECURITY_ATTRIBUTES) -> T) -> T {
            crate::private_dir::with_security_attributes(sddl, |sa| Ok(f(sa))).unwrap()
        }

        /// 建一把锁并占着它，像插件那样
        fn create_owned(name: &str) -> (Handle, bool) {
            let w = wide(name);
            // SAFETY: 名字以 0 结尾
            let h = unsafe { CreateMutexW(std::ptr::null(), 1, w.as_ptr()) };
            // SAFETY: 紧跟在上一个调用之后
            let existed = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
            (Handle::new(h).unwrap(), existed)
        }

        /// 对方放开之后这里等得到；**等完之后锁已经没人拿着**：再建一把是新的
        #[test]
        fn waiting_ends_when_the_owner_lets_go_and_leaves_no_trace() {
            let name = unique("release");
            let (ready_tx, ready_rx) = std::sync::mpsc::channel();
            let owner = std::thread::spawn({
                let name = name.clone();
                move || {
                    let (h, existed) = create_owned(&name);
                    assert!(!existed);
                    ready_tx.send(()).unwrap();
                    std::thread::sleep(Duration::from_millis(300));
                    // SAFETY: 这个线程是它的主人
                    unsafe { ReleaseMutex(h.0) };
                    drop(h);
                }
            });
            ready_rx.recv().unwrap();
            let lock = open_mutex(&name).expect("锁在");
            assert!(wait_released(lock, Duration::from_secs(10)));
            owner.join().unwrap();
            assert_eq!(
                open_mutex(&name).err(),
                Some(ERROR_FILE_NOT_FOUND),
                "等完之后不该还有句柄留着它"
            );
            let (_h, existed) = create_owned(&name);
            assert!(!existed, "插件随后建锁时应当是一把新锁");
        }

        /// 对方没放就走了（崩溃、强杀）也算放开
        #[test]
        fn an_abandoned_lock_counts_as_released() {
            let name = unique("abandon");
            let (ready_tx, ready_rx) = std::sync::mpsc::channel();
            let (go_tx, go_rx) = std::sync::mpsc::channel::<()>();
            let owner = std::thread::spawn({
                let name = name.clone();
                move || {
                    let (h, _) = create_owned(&name);
                    ready_tx.send(()).unwrap();
                    go_rx.recv().unwrap();
                    // 不放就关句柄、线程结束：锁成了无主的
                    drop(h);
                }
            });
            ready_rx.recv().unwrap();
            let lock = open_mutex(&name).expect("锁在");
            go_tx.send(()).unwrap();
            assert!(wait_released(lock, Duration::from_secs(10)));
            owner.join().unwrap();
            let (_h, existed) = create_owned(&name);
            assert!(!existed);
        }

        #[test]
        fn waiting_gives_up_at_the_limit() {
            let name = unique("timeout");
            let (_h, _) = create_owned(&name);
            // 主人是另一个线程才等不到（同一个线程可以重入）
            let lock = std::thread::spawn({
                let name = name.clone();
                move || {
                    let lock = open_mutex(&name).unwrap();
                    wait_released(lock, Duration::from_millis(100))
                }
            });
            assert!(!lock.join().unwrap());
        }

        /// 只看一眼（问过之后打不开事件时）：还被占着是 `false`，已经放开了是 `true`
        #[test]
        fn a_glance_tells_a_held_lock_from_one_let_go() {
            let name = unique("glance");
            let (ready_tx, ready_rx) = std::sync::mpsc::channel();
            let (go_tx, go_rx) = std::sync::mpsc::channel::<()>();
            let owner = std::thread::spawn({
                let name = name.clone();
                move || {
                    let (h, _) = create_owned(&name);
                    ready_tx.send(()).unwrap();
                    go_rx.recv().unwrap();
                    // SAFETY: 这个线程是它的主人
                    unsafe { ReleaseMutex(h.0) };
                }
            });
            ready_rx.recv().unwrap();
            assert!(!wait_released(open_mutex(&name).unwrap(), Duration::ZERO));
            let lock = open_mutex(&name).unwrap();
            go_tx.send(()).unwrap();
            owner.join().unwrap();
            assert!(wait_released(lock, Duration::ZERO));
        }

        /// 管理员身份的实例建的锁（这里用一份谁都不让进的 DACL 代替）：打开时报的是没有
        /// 权限，不是不在 —— `precheck` 靠这个区分「没在运行」和「在运行但够不着」
        #[test]
        fn a_lock_without_access_is_told_apart_from_no_lock() {
            let name = unique("denied-lock");
            let w = wide(&name);
            let _h = with_sddl("D:P", |sa| {
                // SAFETY: 名字以 0 结尾，`sa` 在调用期间有效
                Handle::new(unsafe { CreateMutexW(sa, 1, w.as_ptr()) }).unwrap()
            });
            assert_eq!(open_mutex(&name).err(), Some(ERROR_ACCESS_DENIED));
            assert_eq!(
                open_mutex(&unique("no-lock")).err(),
                Some(ERROR_FILE_NOT_FOUND)
            );
        }

        /// 运行中的那一边建了事件，这一边置得上；没建（旧版本）报不在；没有权限（管理员
        /// 身份的实例建的）当场报没有权限，不干等
        #[test]
        fn the_handoff_reaches_the_listener_or_says_why_not() {
            let name = unique("handoff");
            assert_eq!(
                signal(&name, Duration::from_millis(200)),
                Err(ERROR_FILE_NOT_FOUND)
            );

            let event = create_handoff_event(&name).unwrap();
            assert_eq!(signal(&name, Duration::from_millis(200)), Ok(()));
            // SAFETY: 句柄有效
            assert_eq!(unsafe { WaitForSingleObject(event.0, 1000) }, WAIT_OBJECT_0);

            let denied = unique("denied-event");
            let w = wide(&denied);
            let _e = with_sddl("D:P", |sa| {
                // SAFETY: 名字以 0 结尾，`sa` 在调用期间有效
                Handle::new(unsafe { CreateEventW(sa, 0, 0, w.as_ptr()) }).unwrap()
            });
            let started = Instant::now();
            assert_eq!(
                signal(&denied, Duration::from_secs(5)),
                Err(ERROR_ACCESS_DENIED)
            );
            assert!(started.elapsed() < Duration::from_secs(2));
        }

        /// 上一个实例留下的、已经置位的事件：新的这一个建的时候复位，不会一启动就让位
        #[test]
        fn a_stale_signal_is_cleared_when_the_event_is_created_again() {
            let name = unique("stale");
            let old = create_handoff_event(&name).unwrap();
            // SAFETY: 句柄有效
            assert_ne!(unsafe { SetEvent(old.0) }, 0);
            let fresh = create_handoff_event(&name).unwrap();
            // SAFETY: 句柄有效
            assert_eq!(unsafe { WaitForSingleObject(fresh.0, 0) }, WAIT_TIMEOUT);
            assert_eq!(signal(&name, Duration::ZERO), Ok(()));
            // SAFETY: 句柄有效
            assert_eq!(unsafe { WaitForSingleObject(fresh.0, 0) }, WAIT_OBJECT_0);
            drop(old);
        }

        #[test]
        fn the_image_path_of_a_process_is_its_exe() {
            let me = process_image(std::process::id()).unwrap();
            let exe = std::env::current_exe().unwrap();
            assert!(same_path(
                &canonical(&me),
                &canonical(&exe.to_string_lossy())
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HERE: &str = r"C:\Program Files\ThinkWatch Lite\thinkwatch-lite.exe";
    const THERE: &str = r"D:\Tools\ThinkWatch Lite\thinkwatch-lite.exe";

    #[test]
    fn another_location_is_asked_about() {
        assert_eq!(
            verdict::<&str>(&[], Some(THERE), Some(HERE)),
            Verdict::Ask(THERE.to_string())
        );
    }

    /// 同一个程序再点一次：插件把窗口叫到前面，不问
    #[test]
    fn the_same_program_is_forwarded() {
        assert_eq!(
            verdict::<&str>(&[], Some(HERE), Some(HERE)),
            Verdict::Forward
        );
        assert_eq!(
            verdict::<&str>(&[], Some(&HERE.to_uppercase()), Some(HERE)),
            Verdict::Forward
        );
        assert_eq!(
            verdict::<&str>(&[], Some(&format!(r"\\?\{HERE}")), Some(HERE)),
            Verdict::Forward
        );
    }

    /// 查不出运行中的在哪（窗口没找到、进程打不开），或者连自己在哪都不知道：不问
    #[test]
    fn unknown_locations_are_forwarded() {
        assert_eq!(verdict::<&str>(&[], None, Some(HERE)), Verdict::Forward);
        assert_eq!(verdict::<&str>(&[], Some(THERE), None), Verdict::Forward);
    }

    /// 链接和开机自启从来不问，哪怕程序在别处
    #[test]
    fn links_and_login_launches_are_never_asked_about() {
        for args in [
            vec!["thinkwatch://notice/core"],
            vec!["ThinkWatch://import?url=x"],
            vec!["--autostart"],
        ] {
            assert_eq!(
                verdict(&args[..], Some(THERE), Some(HERE)),
                Verdict::Forward,
                "{args:?}"
            );
        }
        // 别的链接、别的参数照常问
        assert_eq!(
            verdict(
                &["https://example.com", "--hidden"],
                Some(THERE),
                Some(HERE)
            ),
            Verdict::Ask(THERE.to_string())
        );
    }

    /// 让位的一方要在请求的一方放弃之前走完；等请求之外还要留出停 core 的时间
    #[test]
    fn the_running_side_finishes_before_the_requester_gives_up() {
        assert!(STEP_ASIDE_LIMIT < WAIT_LIMIT);
        assert!(STOP_BUDGET < STEP_ASIDE_LIMIT);
        assert!(STEP_ASIDE_LIMIT - STOP_BUDGET >= crate::updater::DRAIN_LIMIT);
    }

    #[test]
    fn names_follow_the_plugin() {
        assert_eq!(mutex_name(), "app.thinkwatch.lite-sim");
        assert_eq!(
            window_names(),
            (
                "app.thinkwatch.lite-sic".to_string(),
                "app.thinkwatch.lite-siw".to_string()
            )
        );
        assert_eq!(handoff_name(), r"Local\app.thinkwatch.lite-handoff");
    }

    /// 文案照定稿，中英两套
    #[test]
    fn the_dialog_text_is_written_out_in_both_languages() {
        use crate::i18n::{Lang, with_lang};
        let (instruction, content, buttons) = with_lang(Lang::Zh, || ask_text(THERE));
        assert_eq!(instruction, "ThinkWatch Lite 已在运行");
        assert_eq!(
            content,
            format!("运行中的程序位于：{THERE}。同一时间只能运行一个 ThinkWatch Lite。")
        );
        assert_eq!(buttons, ["停止运行中的程序并启动此程序", "取消"]);
        let (instruction, content, buttons) = with_lang(Lang::En, || ask_text(THERE));
        assert_eq!(instruction, "ThinkWatch Lite is already running");
        assert_eq!(
            content,
            format!(
                "The running program is at {THERE}. Only one ThinkWatch Lite can run at a time."
            )
        );
        assert_eq!(
            buttons,
            ["Stop the running program and start this one", "Cancel"]
        );
        assert_eq!(
            with_lang(Lang::Zh, waiting_text),
            "正在等待进行中的请求完成…"
        );
        assert_eq!(
            with_lang(Lang::Zh, unsupported_text),
            "运行中的程序不支持切换，请先退出该程序。"
        );
        assert_eq!(with_lang(Lang::Zh, timeout_text), "运行中的程序未能退出。");
        assert_eq!(
            with_lang(Lang::Zh, elevated_text),
            "运行中的程序以管理员身份运行，无法从此处停止。请先退出该程序。"
        );
        assert_eq!(
            with_lang(Lang::En, elevated_text),
            "The running program runs as administrator and cannot be stopped from here. Quit it first."
        );
    }
}
