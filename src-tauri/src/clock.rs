//! 钟跳了：系统睡醒，时钟被改过，时区换了。
//!
//! **定时器量的不是墙上的钟。**tokio 的定时器（也就是 std 的 `Instant`）在 macOS 上走
//! `CLOCK_UPTIME_RAW`、在 Linux 上走 `CLOCK_MONOTONIC`，**系统睡着时都不走**；网页里的
//! `setTimeout` 也一样。一个定在零点的定时器，合上盖子睡过了零点，醒来还要再等睡前剩下的
//! 那一段才响 —— 这期间菜单栏上的「今日」一直是昨天的数。改了时钟、换了时区，那一刻本身
//! 就挪了，按原来算好的时长等下去也对不上。Windows 上那只钟睡着也走（QueryPerformanceCounter），
//! 可醒来之后要等运行时下一次被叫醒，才发现已经过了点。
//!
//! 所以瞄着钟面上某一刻的几处（菜单栏的「今日」和额度重置、流量页的「今天」、密钥页的
//! 这一小时）都在这里听一声，重新瞄一次：
//!
//! - **macOS**：系统醒了（`NSWorkspaceDidWakeNotification`）、时钟被改了
//!   （`NSSystemClockDidChangeNotification`）、时区换了（`NSSystemTimeZoneDidChangeNotification`）；
//! - **Linux**：logind 的 `PrepareForSleep(false)`，系统醒了。改时钟、换时区没有各个发行版
//!   都有的信号，不听 —— 少见，下一个请求落地时就对上了；
//! - **Windows**：`PBT_APMRESUMEAUTOMATIC`，系统醒了。
//!
//! 听到一声，菜单栏立刻重收一次（`menubar_now`），界面收到一条 `local-event`
//! （`clock_changed`）。**只叫醒，不带新的时刻**：各处按此刻的钟和日历自己重算。

use tauri::{Emitter, Manager};

/// 开始听。启动时调一次，菜单栏挂上之后。**听不上不挡什么**：少的只是睡醒之后当场对上，
/// 定时器晚一点照样会响
pub fn watch(app: &tauri::AppHandle) {
    let app = app.clone();
    let heard = move || jumped(&app);
    #[cfg(target_os = "macos")]
    macos::watch(heard);
    #[cfg(target_os = "linux")]
    linux::watch(heard);
    #[cfg(windows)]
    if let Err(e) = windows::watch(heard) {
        tracing::debug!("没注册上系统睡醒的通知：{e}");
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    let _ = heard;
}

/// 听到一声之后。**在系统的线程上调**（macOS 上是发通知的那条，Linux 上是听总线的那条，
/// Windows 上是电源管理的回调），所以只做两件跨线程也没问题的事
fn jumped(app: &tauri::AppHandle) {
    tracing::debug!("钟跳了：重新瞄钟点");
    if let Some(st) = app.try_state::<crate::AppState>() {
        st.menubar_now.notify_one();
    }
    let _ = app.emit(
        "local-event",
        crate::wire::LocalEvent::ClockChanged {
            at_ms: crate::notices::now_ms(),
        },
    );
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2_app_kit::{NSWorkspace, NSWorkspaceDidWakeNotification};
    use objc2_foundation::{
        NSNotification, NSNotificationCenter, NSSystemClockDidChangeNotification,
        NSSystemTimeZoneDidChangeNotification,
    };

    pub fn watch(heard: impl Fn() + Send + Sync + 'static) {
        let block = RcBlock::new(move |_: NonNull<NSNotification>| heard());
        // **醒来的那一条在 NSWorkspace 自己的通知中心里**，不在默认的那个里
        let workspace = NSWorkspace::sharedWorkspace().notificationCenter();
        let default = NSNotificationCenter::defaultCenter();
        // SAFETY: 三个名字都是系统导出的常量。不限定发送者，也不指定队列：块在发通知的那条
        // 线程上跑，所以它得能跨线程 —— 它只调 `heard`，而 `heard` 是 `Send + Sync` 的
        unsafe {
            for (center, name) in [
                (&workspace, NSWorkspaceDidWakeNotification),
                (&default, NSSystemClockDidChangeNotification),
                (&default, NSSystemTimeZoneDidChangeNotification),
            ] {
                // 听到进程结束。返回的令牌不留：通知中心自己持有它，只有注销时才用得上
                let _ = center.addObserverForName_object_queue_usingBlock(
                    Some(name),
                    None,
                    None,
                    &block,
                );
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use std::sync::Arc;
        use std::sync::atomic::{AtomicUsize, Ordering};

        use objc2_app_kit::{NSWorkspace, NSWorkspaceDidWakeNotification};
        use objc2_foundation::{
            NSNotificationCenter, NSNotificationName, NSSystemClockDidChangeNotification,
            NSSystemTimeZoneDidChangeNotification,
        };

        /// 三件事各在它自己的通知中心里发一次，各听到一声。**醒来那一条挂错了中心**（挂到
        /// 默认的那个上），真睡醒时一声都听不到，这里就会少一声
        #[test]
        fn each_jump_is_heard_on_its_own_center() {
            let heard = Arc::new(AtomicUsize::new(0));
            let count = heard.clone();
            super::watch(move || {
                count.fetch_add(1, Ordering::SeqCst);
            });
            let post = |center: &NSNotificationCenter, name: &NSNotificationName| {
                // SAFETY: 不带发送者，也不带附加信息
                unsafe { center.postNotificationName_object(name, None) };
            };
            let workspace = NSWorkspace::sharedWorkspace().notificationCenter();
            let default = NSNotificationCenter::defaultCenter();
            // SAFETY: 读系统导出的常量
            let (wake, clock, zone) = unsafe {
                (
                    NSWorkspaceDidWakeNotification,
                    NSSystemClockDidChangeNotification,
                    NSSystemTimeZoneDidChangeNotification,
                )
            };
            // 没指定队列的观察者在发通知的这条线程上当场调完
            post(&workspace, wake);
            assert_eq!(heard.load(Ordering::SeqCst), 1, "睡醒");
            post(&default, clock);
            assert_eq!(heard.load(Ordering::SeqCst), 2, "改时钟");
            post(&default, zone);
            assert_eq!(heard.load(Ordering::SeqCst), 3, "换时区");
            // 醒来那一条发到默认的中心上不算：系统不在那里发它
            post(&default, wake);
            assert_eq!(heard.load(Ordering::SeqCst), 3);
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::sync::mpsc;

    /// logind 在系统总线上的名字。测试里换成会话总线上一个假的
    const LOGIND: &str = "org.freedesktop.login1";
    pub(super) const PATH: &str = "/org/freedesktop/login1";

    /// 在一条自己的线程上一直听 logind。**和 `theme` 听 portal 同一个做法**：zbus 的阻塞接口
    /// 加一条普通线程。连不上系统总线（容器里、没有 systemd 的发行版）就安静地不听
    pub fn watch(heard: impl Fn() + Send + 'static) {
        let spawned = std::thread::Builder::new()
            .name("clock-logind".into())
            .spawn(move || {
                let (ready, _) = mpsc::channel();
                let listened = zbus::blocking::Connection::system()
                    .and_then(|conn| listen(&conn, LOGIND, &ready, heard));
                if let Err(e) = listened {
                    tracing::debug!("没听上 logind 的睡眠信号：{e}");
                }
            });
        if let Err(e) = spawned {
            tracing::debug!("听 logind 的线程没起来：{e}");
        }
    }

    /// 一直听到连接断开。**`PrepareForSleep` 睡前、醒后各发一次**，参数是「这就要睡了」：
    /// 只认醒后（`false`）那一次。订阅上了交一声给 `ready`
    pub(super) fn listen(
        conn: &zbus::blocking::Connection,
        logind: &str,
        ready: &mpsc::Sender<()>,
        heard: impl Fn(),
    ) -> zbus::Result<()> {
        let proxy = zbus::blocking::Proxy::new(
            conn,
            logind.to_string(),
            PATH,
            "org.freedesktop.login1.Manager",
        )?;
        let signals = proxy.receive_signal("PrepareForSleep")?;
        let _ = ready.send(());
        for msg in signals {
            if let Ok(false) = msg.body().deserialize::<bool>() {
                heard();
            }
        }
        Ok(())
    }
}

#[cfg(windows)]
mod windows {
    use std::ffi::c_void;
    use std::sync::OnceLock;

    use windows_sys::Win32::System::Power::{
        DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, PowerRegisterSuspendResumeNotification,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DEVICE_NOTIFY_CALLBACK, PBT_APMRESUMEAUTOMATIC,
    };

    /// 系统调的那个函数是 `extern "system"` 的，带不了闭包：要调的放在这里
    static HEARD: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

    pub fn watch(heard: impl Fn() + Send + Sync + 'static) -> std::io::Result<()> {
        if HEARD.set(Box::new(heard)).is_err() {
            // 已经在听了
            return Ok(());
        }
        // 听到进程结束：交出去的参数不收回
        let params = Box::leak(Box::new(DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: Some(on_power),
            Context: std::ptr::null_mut(),
        }));
        let mut registration: *mut c_void = std::ptr::null_mut();
        // SAFETY: `params` 泄漏了，一直活着；`registration` 是本地变量，只用来接出参
        let rc = unsafe {
            PowerRegisterSuspendResumeNotification(
                DEVICE_NOTIFY_CALLBACK,
                std::ptr::from_mut(params).cast(),
                &mut registration,
            )
        };
        if rc == 0 {
            Ok(())
        } else {
            Err(std::io::Error::from_raw_os_error(rc as i32))
        }
    }

    /// 电源管理在它自己的线程上调这里。**醒来一定有 `PBT_APMRESUMEAUTOMATIC`**；用户动了
    /// 一下才有的 `PBT_APMRESUMESUSPEND` 跟在它后面，是同一次醒来，不再算一声
    unsafe extern "system" fn on_power(
        _context: *const c_void,
        kind: u32,
        _setting: *const c_void,
    ) -> u32 {
        if kind == PBT_APMRESUMEAUTOMATIC
            && let Some(heard) = HEARD.get()
        {
            heard();
        }
        0
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use std::sync::mpsc;
    use std::time::Duration;

    use zbus::object_server::SignalEmitter;

    /// 对着一个假的 logind 真走一遍 D-Bus：要睡了不算，醒了算一声。
    ///
    /// 要会话总线：CI 里整个 `cargo test` 套在 `dbus-run-session` 里。假的用一个自己的名字，
    /// 真 logind 在系统总线上，撞不上
    #[test]
    fn waking_up_is_heard_and_going_to_sleep_is_not() {
        struct Fake;
        #[zbus::interface(name = "org.freedesktop.login1.Manager")]
        impl Fake {
            #[zbus(signal)]
            async fn prepare_for_sleep(
                emitter: &SignalEmitter<'_>,
                start: bool,
            ) -> zbus::Result<()>;
        }

        let name = format!("app.thinkwatch.test.Logind{}", std::process::id());
        let conn = zbus::blocking::connection::Builder::session()
            .and_then(|b| b.name(name.as_str()))
            .and_then(|b| b.serve_at(super::linux::PATH, Fake))
            .and_then(|b| b.build())
            .expect("no session bus; run the tests under dbus-run-session");

        let (ready_tx, ready_rx) = mpsc::channel();
        let (tx, rx) = mpsc::channel();
        let logind = name.clone();
        std::thread::spawn(move || {
            let listener = zbus::blocking::Connection::session().unwrap();
            let _ = super::linux::listen(&listener, &logind, &ready_tx, || {
                let _ = tx.send(());
            });
        });
        let wait = Duration::from_secs(5);
        ready_rx.recv_timeout(wait).expect("never subscribed");

        let iface = conn
            .object_server()
            .interface::<_, Fake>(super::linux::PATH)
            .unwrap();
        let emit = |start: bool| {
            zbus::block_on(Fake::prepare_for_sleep(iface.signal_emitter(), start)).unwrap();
        };
        emit(true);
        emit(false);
        rx.recv_timeout(wait).expect("waking up was not heard");
        assert!(
            rx.recv_timeout(Duration::from_millis(200)).is_err(),
            "going to sleep was taken as waking up"
        );
    }
}
