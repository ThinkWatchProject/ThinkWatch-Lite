//! 菜单栏：常驻的那一小块，和点开的那份菜单。
//!
//! 这类工具用户九成时间不开主窗口，所以这一小块和它的菜单才是每天真正被看到的
//! 界面。**一天要点很多次**，所以打开必须零延迟、不多占内存：macOS 上是原生的
//! `NSMenu`（见 [`macos`]），不是一个网页弹窗。
//!
//! 分三层：[`model`] 定显示什么（纯函数，全测）；[`macos`] 照着画；这里负责收数、
//! 把模型交过去、处理点了之后的事。

pub mod model;

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(not(target_os = "macos"))]
mod tray;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use tw_api::ep;

use tauri::Manager;

pub use model::Style;
use model::{Action, Gateway, Snapshot};

use crate::{AppState, notices, supervisor::CoreState};

/// 攒多久再收一次数。一串请求只换来一次重收，而不是一条一次；也给存储层留出
/// 把这一条落库、算出费用的时间
const SETTLE: std::time::Duration = std::time::Duration::from_secs(3);

/// 菜单开着时隔多久走一次秒数和倒计时。**只在开着时走**，关上就停
const TICK: std::time::Duration = std::time::Duration::from_secs(1);

/// 设置里选的那一档。**改了立刻生效**：不重启，也不等下一次收数
static STYLE: AtomicU8 = AtomicU8::new(0);
/// 菜单开着吗（delegate 报的）
static OPEN: AtomicBool = AtomicBool::new(false);

/// 设置里存的是哪一档。**这是「存了什么」，不是「画成什么」** —— 后者见
/// [`drawn_style`]。
pub fn style() -> Style {
    match STYLE.load(Ordering::Relaxed) {
        1 => Style::Icon,
        2 => Style::Numbers,
        _ => Style::Full,
    }
}

/// 实际画出来的那一档。
///
/// **macOS 才有三档可选。**别处的通知区只认一张正方形图标（100% DPI 下
/// 16×16），两行数字塞不进去 —— 那几行在右键菜单里给，所以无论存的是什么，
/// 画出来的都是图标。
///
/// 和 [`style`] 分开，因为它们回答的是两个问题：设置页问「存了什么」，
/// 渲染问「画得出什么」。把它们合成一个，那条「存进去什么就读回什么」的
/// 测试就会在别的平台上挂 —— 而它挂得有道理，是这里本来就不该混。
fn drawn_style() -> Style {
    #[cfg(target_os = "macos")]
    {
        style()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Style::Icon
    }
}

pub fn set_style(style: Style) {
    STYLE.store(
        match style {
            Style::Full => 0,
            Style::Icon => 1,
            Style::Numbers => 2,
        },
        Ordering::Relaxed,
    );
}

/// 通知总线的一个投递端：**列表一变就叫醒菜单栏**。菜单里的提醒一节和主界面的
/// 铃铛读的是同一份
pub struct Wake(pub Arc<tokio::sync::Notify>);

impl notices::Sink for Wake {
    fn show(&self, _notice: &notices::Notice) {}
    fn listed(&self, _all: &[notices::Notice]) {
        self.0.notify_one();
    }
}

/// 挂到菜单栏上，开始收数。**在守护之前调**：core 还没起来的那几秒里，菜单栏上
/// 就已经有东西了 —— 开机自启时尤其重要
pub fn install(app: &tauri::AppHandle) -> anyhow::Result<()> {
    set_style(crate::prefs::load(&crate::data_dir()).menubar);
    #[cfg(target_os = "macos")]
    {
        let mtm = objc2::MainThreadMarker::new()
            .ok_or_else(|| anyhow::anyhow!("菜单栏要在主线程上建"))?;
        let (a, b) = (app.clone(), app.clone());
        macos::install(
            mtm,
            move |action| handle(&a, action),
            move |open| {
                OPEN.store(open, Ordering::Relaxed);
                if open && let Some(st) = b.try_state::<AppState>() {
                    st.menubar_now.notify_one();
                }
            },
        );
        // 第一帧：还没收到任何数，但菜单栏上不能是空的
        let (bar, rows) = model::build(&Snapshot::default(), drawn_style());
        macos::apply(mtm, &bar, &rows);
    }
    #[cfg(not(target_os = "macos"))]
    tray::install(app)?;

    let h = app.clone();
    tauri::async_runtime::spawn(async move { run(h).await });
    Ok(())
}

/// 收数、画、等下一个理由。**被事件叫醒，不是定时醒**：空闲时一次都不醒
async fn run(app: tauri::AppHandle) {
    let Some(st) = app.try_state::<AppState>() else {
        return;
    };
    let (wake, now) = (st.menubar.clone(), st.menubar_now.clone());
    let mut core_rx = st.supervisor.watch();
    let mut credits = Credits::default();
    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let open = || OPEN.load(Ordering::Relaxed);
    loop {
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        let mut snap = collect(&app, &state, &mut credits).await;
        present(&snap);
        let reset = next_reset_in(&snap).map(|d| tokio::time::Instant::now() + d);
        let mut due = None;
        // 菜单开着时每秒走一次：秒数、倒计时现算，在跑的和速率问 core 一次（很轻），
        // 汇总和额度不问
        while let Woke::Tick =
            wait(&wake, &now, &mut core_rx, reset, &mut tick, open, &mut due).await
        {
            refresh_live(&state, &mut snap).await;
            present(&snap);
        }
    }
}

/// [`wait`] 为什么回来了
#[derive(Debug, PartialEq, Eq)]
enum Woke {
    /// 整个重收
    Collect,
    /// 菜单开着，走一秒
    Tick,
}

/// 等到该重收的时候。有事件就攒 [`SETTLE`] 再收；`now`（菜单打开、换了样式或语言）、
/// core 换了状态、额度到了重置时刻（那份额度作废），立刻收。菜单开着时每秒回来
/// 一次 [`Woke::Tick`]，**攒着的那几秒也走** —— 不然请求一个接一个落地时，开着的
/// 菜单里秒数会一卡几秒。`due` 是攒到什么时候，由调用方带着跨过这几次 tick
async fn wait(
    wake: &tokio::sync::Notify,
    now: &tokio::sync::Notify,
    core_rx: &mut tokio::sync::watch::Receiver<CoreState>,
    reset: Option<tokio::time::Instant>,
    tick: &mut tokio::time::Interval,
    open: impl Fn() -> bool,
    due: &mut Option<tokio::time::Instant>,
) -> Woke {
    loop {
        let settle = *due;
        tokio::select! {
            _ = wake.notified(), if settle.is_none() => {
                *due = Some(tokio::time::Instant::now() + SETTLE);
            }
            _ = sleep_until(settle), if settle.is_some() => return Woke::Collect,
            _ = now.notified() => return Woke::Collect,
            _ = core_rx.changed() => return Woke::Collect,
            _ = sleep_until(reset), if reset.is_some() => return Woke::Collect,
            _ = tick.tick(), if open() => return Woke::Tick,
        }
    }
}

/// `select!` 里关掉的分支也会建出 future，所以 `None` 也得给个时刻
fn sleep_until(at: Option<tokio::time::Instant>) -> tokio::time::Sleep {
    tokio::time::sleep_until(at.unwrap_or_else(tokio::time::Instant::now))
}

/// 把快照交给画的那一层
fn present(snap: &Snapshot) {
    let (bar, rows) = model::build(snap, drawn_style());
    #[cfg(target_os = "macos")]
    macos::on_main(move |mtm| macos::apply(mtm, &bar, &rows));
    #[cfg(not(target_os = "macos"))]
    tray::apply(&bar, &rows);
}

/// 只更新随时间走的那几样：现在几点、谁在跑、速率。**问 core 要**（`/live`）：
/// 在跑的和最近的生成速率是 core 的事件总线数的，这边不再自己听事件去数。
/// 问不到时留着上一次的
async fn refresh_live(state: &AppState, snap: &mut Snapshot) {
    snap.now_ms = notices::now_ms();
    if snap.gateway != Gateway::Running {
        return;
    }
    if let Ok(live) = state.control.call::<ep::Live>(&[], &()).await {
        apply_live(snap, live);
    }
}

fn apply_live(snap: &mut Snapshot, live: tw_api::LiveView) {
    snap.live = live
        .running
        .into_iter()
        .map(|r| model::Live {
            id: r.id,
            app: r.client_hint,
            key: r.client,
            model: r.model,
            started_ms: r.at_ms,
        })
        .collect();
    snap.rate = live.tokens_per_sec;
}

/// 最近的一个额度重置时刻还有多久
fn next_reset_in(snap: &Snapshot) -> Option<std::time::Duration> {
    snap.quotas
        .iter()
        .flat_map(|q| q.windows.iter())
        .filter_map(|w| w.resets_at_ms)
        .filter(|at| *at > snap.now_ms)
        .min()
        .map(|at| std::time::Duration::from_millis(at - snap.now_ms))
}

/// 额度用完之后问到的重置卡张数。**每次用完只问一次**：问的是 ChatGPT 的后端
#[derive(Default)]
struct Credits {
    /// 上游 → (问的时候那个窗口的重置时刻, 张数)
    seen: std::collections::HashMap<String, (Option<u64>, Option<i64>)>,
}

async fn collect(app: &tauri::AppHandle, state: &AppState, credits: &mut Credits) -> Snapshot {
    let now_ms = notices::now_ms();
    let gateway = match state.supervisor.state() {
        _ if state.core_missing.is_some() => Gateway::Failed,
        CoreState::Running { .. } => Gateway::Running,
        CoreState::Starting | CoreState::Restarting { .. } => Gateway::Starting,
        CoreState::SafeMode => Gateway::SafeMode,
        CoreState::Failed { .. } => Gateway::Failed,
        CoreState::Stopped => Gateway::Stopped,
    };
    let notices = app.try_state::<Arc<notices::Notices>>();
    let mut snap = Snapshot {
        notices_on: notices
            .as_ref()
            .is_some_and(|n| n.mode() != notices::Mode::Off),
        notices: notices.map(|n| unread(&n.list())).unwrap_or_default(),
        update: crate::updater::pending_update(app),
        now_ms,
        gateway,
        ..Default::default()
    };
    if snap.gateway != Gateway::Running {
        return snap;
    }
    let c = &state.control;
    let today = tw_api::Window::default();
    let (status, quota, summary, overview, history, live) = tokio::join!(
        c.status(),
        c.call::<ep::Quota>(&[], &()),
        c.call::<ep::Summary>(&[], &today),
        c.call::<ep::Overview>(&[], &()),
        c.call::<ep::ConfigHistory>(&[], &()),
        c.call::<ep::Live>(&[], &())
    );
    if let Ok(l) = live {
        apply_live(&mut snap, l);
    }
    if let Ok(s) = status {
        snap.addr = s.gateway_addr;
        snap.listen_error = s.listen_error.map(|e| crate::core_text::text(&e));
    }
    if let Ok(s) = summary {
        snap.today = Some(model::Today {
            requests: s.requests,
            failed: s.failed,
            tokens: s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens,
            cost_micros: s.cost_micros_exact + s.cost_micros_estimated,
        });
    }
    let accounts: Vec<String> = overview
        .as_ref()
        .map(|o| {
            o.providers
                .iter()
                .filter(|p| p.protocol == Some(tw_api::Protocol::Chatgpt))
                .map(|p| p.name.clone())
                .collect()
        })
        .unwrap_or_default();
    if let Ok(o) = overview {
        snap.groups = o
            .groups
            .into_iter()
            // 只有手动选择的组能在菜单里切 —— 别的策略是自动决定的
            .filter(|g| g.kind == "select")
            .map(|g| model::Group {
                name: g.name,
                members: g.providers,
                selected: g.selected,
            })
            .collect();
    }
    if let Ok(h) = history {
        // 历史里包括现在跑着的这一版：「上一版」是倒数第二条
        snap.undo_at_ms = h.iter().rev().nth(1).map(|v| v.at_ms);
    }
    for q in quota.unwrap_or_default() {
        let windows: Vec<model::Window> = q
            .windows
            .iter()
            .map(|w| model::Window {
                window: w.window.clone(),
                used_percent: w.used_percent,
                resets_at_ms: w.resets_at_ms,
                status: w.status.clone(),
            })
            .collect();
        let used_up = windows.iter().find(|w| {
            w.resets_at_ms.is_none_or(|at| at > now_ms)
                && (w.status.as_deref() == Some("rejected") || w.used_percent >= 100.0)
        });
        let reset_credits = match used_up {
            Some(w) if accounts.contains(&q.provider) => {
                let known = credits.seen.get(&q.provider);
                match known {
                    Some((at, n)) if *at == w.resets_at_ms => *n,
                    _ => {
                        let n = c
                            .call::<ep::ChatgptUsage>(&[&q.provider], &())
                            .await
                            .ok()
                            .and_then(|u| u.reset_credits);
                        credits.seen.insert(q.provider.clone(), (w.resets_at_ms, n));
                        n
                    }
                }
            }
            _ => None,
        };
        snap.quotas.push(model::Quota {
            provider: q.provider,
            windows,
            reset_credits,
        });
    }
    snap
}

/// 未读的提醒，要紧的在前，同样要紧的新的在前
fn unread(list: &[notices::Notice]) -> Vec<model::NoticeLine> {
    let mut out: Vec<(model::NoticeLine, u64)> = list
        .iter()
        .filter(|n| !n.read)
        .map(|n| {
            (
                model::NoticeLine {
                    key: n.key.clone(),
                    level: match n.level {
                        notices::Level::Info => model::Level::Info,
                        notices::Level::Warning => model::Level::Warning,
                        notices::Level::Critical => model::Level::Critical,
                    },
                    title: n.title.clone(),
                    body: n.body.clone(),
                },
                n.at_ms,
            )
        })
        .collect();
    out.sort_by(|a, b| b.0.level.cmp(&a.0.level).then(b.1.cmp(&a.1)));
    out.into_iter().map(|(n, _)| n).collect()
}

/// 点了之后做什么。**在主线程上调**（菜单的回调）；要等 core 的活扔到后台去
fn handle(app: &tauri::AppHandle, action: Action) {
    let app = app.clone();
    match action {
        Action::OpenMain => open_main(&app),
        Action::Open(view) => notices::open_view(&app, view.to_string()),
        Action::Settings => notices::open_view(&app, "settings".to_string()),
        Action::OpenRequest(id) => notices::open_view(&app, format!("requests:{id}")),
        // 和点系统通知走同一条路：落到能处理它的那一页，并标为已读
        Action::OpenNotice(key) => notices::open_from_notification(&app, &key),
        // 窗口可能是为这一下新建的，事件会错过：和落页一样存下来，界面挂上之后自己取
        Action::AllNotices => notices::open_view(&app, "notices".to_string()),
        Action::InstallUpdate => crate::updater::show_pending_update(&app),
        Action::Quit => quit(&app),
        other => {
            tauri::async_runtime::spawn(async move { background(&app, other).await });
        }
    }
}

fn open_main(app: &tauri::AppHandle) {
    if let Err(e) = crate::window::show_main_window(app) {
        tracing::error!("开窗口失败：{e}");
    }
}

async fn background(app: &tauri::AppHandle, action: Action) {
    let Some(st) = app.try_state::<AppState>() else {
        return;
    };
    let result: Result<(), String> = match action {
        Action::CopyAddress => copy_address(app, &st).await,
        Action::CopyKey => copy_default_key(app, &st).await,
        Action::Undo => undo(app, &st).await,
        Action::SelectGroup { group, provider } => st
            .control
            .select_group(&group, &provider)
            .await
            .map_err(|e| format!("{e:#}")),
        Action::RestartGateway => crate::gateway::restart_gateway(app)
            .await
            .map_err(|e| e.to_string()),
        Action::CheckUpdates => {
            check_updates(app).await;
            Ok(())
        }
        _ => Ok(()),
    };
    if let Err(e) = result {
        tracing::warn!("菜单里的操作没做成：{e}");
        say(app, tr!("操作未完成", "The Action Did Not Complete"), &e);
    }
    st.menubar.notify_one();
}

async fn copy_address(app: &tauri::AppHandle, st: &AppState) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let clients = st
        .control
        .call::<ep::Clients>(&[], &())
        .await
        .map_err(|e| format!("{e:#}"))?;
    app.clipboard()
        .write_text(clients.gateway_base)
        .map_err(|e| e.to_string())
}

/// **明文不经过界面**：和密钥页的「复制」同一条路，在 Rust 这边直接写剪贴板
async fn copy_default_key(app: &tauri::AppHandle, st: &AppState) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let keys = st
        .control
        .call::<ep::Keys>(&[], &())
        .await
        .map_err(|e| format!("{e:#}"))?;
    let name = keys
        .iter()
        .find(|k| k.default)
        .or_else(|| keys.first())
        .map(|k| k.name.clone())
        .ok_or_else(|| tr!("尚无网关密钥。", "There is no gateway key yet.").to_string())?;
    let v = st
        .control
        .call::<ep::KeyValue>(&[&name], &())
        .await
        .map_err(|e| format!("{e:#}"))?;
    app.clipboard().write_text(v.key).map_err(|e| e.to_string())
}

/// 撤销上一次配置修改：回到历史里的上一版。**撤完说一声撤到了哪一版**
async fn undo(app: &tauri::AppHandle, st: &AppState) -> Result<(), String> {
    let hist = st
        .control
        .call::<ep::ConfigHistory>(&[], &())
        .await
        .map_err(|e| format!("{e:#}"))?;
    let Some(prev) = hist.iter().rev().nth(1).cloned() else {
        return Ok(());
    };
    st.control
        .call::<ep::ConfigRollback>(
            &[],
            &tw_api::RollbackRequest {
                version: prev.version.clone(),
            },
        )
        .await
        .map_err(|e| format!("{e:#}"))?;
    if let Some(n) = app.try_state::<Arc<notices::Notices>>() {
        let (_, _, _, h, m) = model::local(prev.at_ms);
        n.announce(
            "undo",
            tr!("已撤销上一次配置修改", "Last Configuration Change Undone"),
            &tr!(
                format!("已恢复 {h:02}:{m:02} 的配置。"),
                format!("The configuration from {h:02}:{m:02} is back in effect.")
            ),
        );
    }
    tracing::info!(version = %prev.version, "从菜单撤销了上一次配置修改");
    Ok(())
}

/// 检查更新。查到了就拉起更新窗口；没查到要说一声 —— 用户点了，就该看到结果
async fn check_updates(app: &tauri::AppHandle) {
    match crate::updater::find_update(app).await {
        Ok(Some(found)) => crate::updater::present_update(app, found),
        Ok(None) => say(
            app,
            tr!("已是最新版本", "ThinkWatch Lite Is Up to Date"),
            &tr!(
                format!(
                    "ThinkWatch Lite {} 是最新版本。",
                    app.package_info().version
                ),
                format!(
                    "ThinkWatch Lite {} is the latest version.",
                    app.package_info().version
                )
            ),
        ),
        Err(e) => say(app, tr!("无法检查更新", "Updates Could Not Be Checked"), &e),
    }
}

/// 退出前问一句。**原生的对话框**，不再拉起主窗口；有请求在跑时说清会中断几个。
///
/// 几个是问 core 的（`/live`，和菜单里「进行中」同一份）。**只等一秒**：core 卡住
/// 的时候退出正是用户要做的事，不能让这一问把退出也卡住 —— 问不到就按没有算。
fn quit(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let in_flight = match app.try_state::<AppState>() {
            Some(st) if matches!(st.supervisor.state(), CoreState::Running { .. }) => {
                tokio::time::timeout(
                    std::time::Duration::from_secs(1),
                    st.control.call::<ep::Live>(&[], &()),
                )
                .await
                .ok()
                .and_then(Result::ok)
                .map_or(0, |l| l.running.len())
            }
            _ => 0,
        };
        #[cfg(target_os = "macos")]
        macos::on_main(move |mtm| {
            if macos::confirm_quit(mtm, in_flight) {
                app.exit(0);
            }
        });
        #[cfg(not(target_os = "macos"))]
        {
            let _ = in_flight;
            app.exit(0);
        }
    });
}

/// 一句话的提示
fn say(app: &tauri::AppHandle, title: &str, body: &str) {
    #[cfg(target_os = "macos")]
    {
        let (title, body) = (title.to_string(), body.to_string());
        let _ = app;
        macos::on_main(move |mtm| macos::inform(mtm, &title, &body));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, title, body);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notice(key: &str, level: notices::Level, at_ms: u64, read: bool) -> notices::Notice {
        notices::Notice {
            key: key.into(),
            level,
            title: key.into(),
            body: String::new(),
            view: None,
            first_at_ms: at_ms,
            at_ms,
            count: 1,
            notified: false,
            read,
        }
    }

    #[test]
    fn the_menu_lists_unread_notices_most_urgent_first() {
        let list = [
            notice("old-warning", notices::Level::Warning, 1, false),
            notice("info", notices::Level::Info, 9, false),
            notice("critical", notices::Level::Critical, 2, false),
            notice("new-warning", notices::Level::Warning, 5, false),
            notice("seen", notices::Level::Critical, 10, true),
        ];
        let keys: Vec<String> = unread(&list).into_iter().map(|n| n.key).collect();
        assert_eq!(keys, ["critical", "new-warning", "old-warning", "info"]);
    }

    fn setup() -> (
        tokio::sync::Notify,
        tokio::sync::Notify,
        tokio::sync::watch::Sender<CoreState>,
        tokio::time::Interval,
    ) {
        let mut tick = tokio::time::interval(TICK);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let (tx, _) = tokio::sync::watch::channel(CoreState::Starting);
        (
            tokio::sync::Notify::new(),
            tokio::sync::Notify::new(),
            tx,
            tick,
        )
    }

    /// 一直等到该整个重收，数中途走了几秒。和 `run` 里的循环同一个走法
    async fn until_collect(
        wake: &tokio::sync::Notify,
        now: &tokio::sync::Notify,
        rx: &mut tokio::sync::watch::Receiver<CoreState>,
        reset: Option<tokio::time::Instant>,
        tick: &mut tokio::time::Interval,
        open: bool,
    ) -> usize {
        let mut due = None;
        let mut ticks = 0;
        while wait(wake, now, rx, reset, tick, || open, &mut due).await == Woke::Tick {
            ticks += 1;
        }
        ticks
    }

    #[tokio::test(start_paused = true)]
    async fn an_open_menu_keeps_ticking_while_a_wake_settles() {
        let (wake, now, tx, mut tick) = setup();
        let mut rx = tx.subscribe();
        let start = tokio::time::Instant::now();
        wake.notify_one();
        let ticks = until_collect(&wake, &now, &mut rx, None, &mut tick, true).await;
        // **走一秒不会把攒着的那三秒重新算起**
        assert_eq!(start.elapsed(), SETTLE);
        // 0、1、2 秒各走一次；第 3 秒和收数同时到，谁先都行
        assert!(ticks >= 3, "只走了 {ticks} 次");
    }

    #[tokio::test(start_paused = true)]
    async fn a_closed_menu_sleeps_until_the_quota_resets() {
        let (wake, now, tx, mut tick) = setup();
        let mut rx = tx.subscribe();
        let start = tokio::time::Instant::now();
        let reset = Some(start + std::time::Duration::from_secs(600));
        let ticks = until_collect(&wake, &now, &mut rx, reset, &mut tick, false).await;
        assert_eq!(start.elapsed(), std::time::Duration::from_secs(600));
        assert_eq!(ticks, 0);
    }

    #[tokio::test(start_paused = true)]
    async fn opening_the_menu_or_a_core_change_collects_at_once() {
        let (wake, now, tx, mut tick) = setup();
        let mut rx = tx.subscribe();
        let start = tokio::time::Instant::now();
        // 攒着的时候菜单被打开：不等攒够
        wake.notify_one();
        now.notify_one();
        until_collect(&wake, &now, &mut rx, None, &mut tick, false).await;
        assert_eq!(start.elapsed(), std::time::Duration::ZERO);
        tx.send_replace(CoreState::Stopped);
        until_collect(&wake, &now, &mut rx, None, &mut tick, false).await;
        assert_eq!(start.elapsed(), std::time::Duration::ZERO);
    }

    /// core 给的在跑的请求照原样进菜单：谁、哪个模型、什么时候开始的，还有速率
    #[test]
    fn the_live_numbers_come_from_core_as_they_are() {
        let mut snap = Snapshot::default();
        apply_live(
            &mut snap,
            tw_api::LiveView {
                running: vec![tw_api::RunningView {
                    id: 7,
                    client: "default".into(),
                    client_hint: Some("codex".into()),
                    model: "gpt-5".into(),
                    provider: "openai".into(),
                    at_ms: 1_000,
                }],
                tokens_per_sec: Some(52),
            },
        );
        assert_eq!(
            snap.live,
            vec![model::Live {
                id: 7,
                app: Some("codex".into()),
                key: "default".into(),
                model: "gpt-5".into(),
                started_ms: 1_000,
            }]
        );
        assert_eq!(snap.rate, Some(52));
        // 下一次一个都不在跑、这一分钟也没有跑完的：都清掉，不留上一次的
        apply_live(&mut snap, tw_api::LiveView::default());
        assert!(snap.live.is_empty());
        assert_eq!(snap.rate, None);
    }

    #[test]
    fn the_style_survives_a_round_trip() {
        for s in [Style::Full, Style::Icon, Style::Numbers] {
            set_style(s);
            assert_eq!(style(), s);
        }
        set_style(Style::Full);
    }
}
