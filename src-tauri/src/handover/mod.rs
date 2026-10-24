//! 升级不断线：桌面端这一侧的几件事。
//!
//! 换版本时**不再停掉网关再起**：旧 Lite 装好更新之后请本机的 core 等接替者（arm，
//! `POST /handover/arm`），然后立刻重启自己；新 Lite 照常起新 core，新 core 发现数据目录
//! 被一个等接替者的旧 core 占着，就从它手里接过监听和状态，旧 core 做完手上的请求再走。
//! 网关端口从头到尾都开着，在跑的流也不被截断。交接本身是 core 的事（见 tw-handover），
//! 这里只管：
//!
//! - 什么时候 arm、arm 不上时退回「等请求结束、停掉、重启」（[`arm`]，调用方在 `updater`）；
//! - 已 arm 的这一次退出不停 core（[`armed`]，退出回调看它）；
//! - 等不到接替者时 core 怎么把桌面端重新打开（[`relaunch_for`]）；
//! - 运行中的 core 的可执行文件在替换应用之后仍然在（Windows 改名 [`retire`]、Linux
//!   AppImage 的按版本缓存 [`core_cache`]）；
//! - `brew upgrade` 退出应用时认出它来（[`brew`]），以及 Homebrew 没退出应用就换掉了它时
//!   自己重启（[`bundle_watch`]）。
//!
//! **界面上不提交接。**这是正常运转的事，用户不需要知道（只有新 core 的配置读不进来、网关
//! 暂按旧配置运行的那一种在安全模式页上说一句）。

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::control::ControlClient;

pub mod brew;
#[cfg(target_os = "macos")]
pub mod bundle_watch;
pub mod core_cache;
pub mod retire;

/// 这一次退出已经请 core 等接替者了。
///
/// **退出回调看它决定停不停 core**（见 `lib.rs` 的 `RunEvent::Exit`），退出记录里也记上
/// 它（`updater::record_exit`）：重新打开时据此照退出时的样子恢复窗口。
static ARMED: AtomicBool = AtomicBool::new(false);

/// 这一次退出已经 arm 了吗
pub(crate) fn armed() -> bool {
    ARMED.load(Ordering::SeqCst)
}

/// arm 上了记一笔；替换没成、把 core 接回来之后撤掉
pub(crate) fn set_armed(on: bool) {
    ARMED.store(on, Ordering::SeqCst);
}

/// 请 core 等接替者，最多等多久。**arm 本身很快**（core 只是脱离父进程、开一个端点），
/// 等不到多半是 core 卡住了：那就当 arm 不上，退回现行流程
const ARM_WITHIN: Duration = Duration::from_secs(5);

/// 请本机的 core 等接替者。成了返回交接连接的版本号。
///
/// **任何一种不成都只是退回现行流程**，调用方不区分原因：core 太旧（协议 52 之前没有这个
/// 端点，答的是 404；连 `Status` 都解不出来）、登录进行中（`control.handover.busy`）、安全
/// 模式（`control.handover.safe_mode`）、core 没在跑、[`ARM_WITHIN`] 内没回话。原因进日志
///
/// `relaunch` 是等不到接替者时 core 重新打开桌面端的方式（见 [`relaunch_for`]）；同一个
/// 桌面端接着起新 core 的（「重新启动网关」）不需要它
pub(crate) async fn arm(
    control: &ControlClient,
    relaunch: Option<tw_api::Relaunch>,
) -> Result<u32, String> {
    let req = tw_api::HandoverArm {
        wait_secs: None,
        relaunch,
    };
    match tokio::time::timeout(
        ARM_WITHIN,
        control.call::<tw_api::ep::HandoverArm>(&[], &req),
    )
    .await
    {
        Ok(Ok(armed)) => {
            tracing::info!(version = armed.version, "core 已在等接替者");
            Ok(armed.version)
        }
        Ok(Err(e)) => Err(format!("{e:#}")),
        Err(_) => Err(format!("core {ARM_WITHIN:?} 内没回话")),
    }
}

/// arm 的结果出来之后：成了就什么都不用等，返回 `true`；不成就照以前的做法（方案 F2），
/// 先等手上的请求结束（`wait`）、再停掉 core（`stop`），返回 `false`。
///
/// **两步都只在退回时才跑**：future 不被 await 就什么都不做
pub(crate) async fn or_fall_back(
    armed: &Result<u32, String>,
    wait: impl std::future::Future<Output = ()>,
    stop: impl std::future::Future<Output = ()>,
) -> bool {
    match armed {
        Ok(_) => true,
        Err(e) => {
            tracing::info!("core 没能等接替者，退回等请求结束再重启：{e}");
            wait.await;
            stop.await;
            false
        }
    }
}

/// 等不到接替者时，core 怎么把桌面端重新打开（方案 F1：新 Lite 没起来）。
///
/// - macOS：按 bundle id（`open -b`）。打开的是磁盘上现在的那一份：换好了是新版，Homebrew
///   升级失败回滚了就是旧版 —— 两种都能接手；
/// - Linux AppImage：`$APPIMAGE` 那个文件，**不是挂载点里的可执行文件**：挂载点随这个
///   进程退出而卸载，那个路径之后就不在了；
/// - Windows（安装版、绿色版）和别的：自己这个可执行文件。重启之后的路径不变（安装程序
///   覆盖原处，绿色版换的是同一个文件名）。
///
/// 答不出来就不给：core 不重新打开，只是等满之后排空退出
pub(crate) fn relaunch_for(app: &tauri::AppHandle) -> Option<tw_api::Relaunch> {
    #[cfg(target_os = "macos")]
    {
        Some(tw_api::Relaunch::BundleId {
            id: app.config().identifier.clone(),
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        #[cfg(target_os = "linux")]
        let path = crate::update::mounted_appimage(
            tauri::utils::platform::bundle_type(),
            std::env::var_os("APPIMAGE").as_deref(),
        )
        .or_else(|| std::env::current_exe().ok());
        #[cfg(not(target_os = "linux"))]
        let path = std::env::current_exe().ok();
        path.map(|p| tw_api::Relaunch::Exe {
            path: p.display().to_string(),
            args: Vec::new(),
        })
    }
}

/// 退出回调里：这次退出是 `brew upgrade` 发起的，就 arm（不停 core）。见 [`brew`]。
///
/// 跑在主线程的事件循环上（`RunEvent::Exit`），不在运行时里 —— 和 `stop_core_on_exit`
/// 一样用 `block_on` 等这一下；万一在运行时里就不等（`block_on` 会 panic），当普通退出。
/// arm 不上也当普通退出：调用方接着停 core，和今天一样
pub(crate) fn arm_on_quit(app: &tauri::AppHandle) {
    if armed() || !brew::quit_was_upgrade() {
        return;
    }
    let Some(st) = tauri::Manager::try_state::<crate::AppState>(app) else {
        return;
    };
    if tokio::runtime::Handle::try_current().is_ok() {
        return;
    }
    let control = st.supervisor.control().clone();
    let relaunch = relaunch_for(app);
    let armed = tauri::async_runtime::block_on(async move { arm(&control, relaunch).await });
    match armed {
        Ok(_) => {
            tracing::info!("Homebrew 升级退出应用：core 留着等新版接手");
            set_armed(true);
        }
        Err(e) => tracing::info!("Homebrew 升级退出应用，core 没能 arm，照常停下（{e}）"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::AtomicUsize;

    /// 本机没有 core 在跑（连着远程、core 停着、没装好）：arm 不上，**马上**说不上，不挂住
    #[tokio::test]
    async fn arming_without_a_core_fails_at_once() {
        let dir = tempfile::tempdir().unwrap();
        let control = ControlClient::new(
            tw_api::control::Address::in_dir(dir.path()),
            dir.path().join("config.yaml"),
        );
        let got = tokio::time::timeout(Duration::from_secs(10), arm(&control, None))
            .await
            .expect("arm 挂住了");
        assert!(got.is_err());
    }

    /// 退回的那一支：先等请求结束、再停 core；arm 上了的两步都不跑
    #[tokio::test]
    async fn falling_back_waits_then_stops_and_arming_does_neither() {
        let order = Arc::new(std::sync::Mutex::new(Vec::new()));
        let step = |name: &'static str| {
            let order = order.clone();
            async move { order.lock().unwrap().push(name) }
        };
        assert!(!or_fall_back(&Err("refused".into()), step("wait"), step("stop")).await);
        assert_eq!(*order.lock().unwrap(), ["wait", "stop"]);

        let ran = Arc::new(AtomicUsize::new(0));
        let count = || {
            let ran = ran.clone();
            async move {
                ran.fetch_add(1, Ordering::SeqCst);
            }
        };
        assert!(or_fall_back(&Ok(1), count(), count()).await);
        assert_eq!(ran.load(Ordering::SeqCst), 0);
    }
}
