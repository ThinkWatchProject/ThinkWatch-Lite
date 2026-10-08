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

use crate::{AppState, error::CmdError, notices, supervisor::CoreState};

/// 攒多久再收一次数。一串请求只换来一次重收，而不是一条一次；也给存储层留出
/// 把这一条落库、算出费用的时间
const SETTLE: std::time::Duration = std::time::Duration::from_secs(3);

/// 菜单开着时隔多久走一次秒数和倒计时。**只在开着时走**，关上就停
const TICK: std::time::Duration = std::time::Duration::from_secs(1);

/// 问 core 的一句最多等多久。**core 接了连接却不回话**（卡在存储层上、远程那台半死不活）
/// 时，菜单栏不能跟着停在这一问上：收数是一轮一轮来的，这一问不回，后面就再也不刷新了。
/// 比心跳的 3 秒宽一点：汇总要查库，连远程时每一问还要重新连上、握手
const ASK: std::time::Duration = std::time::Duration::from_secs(5);

/// 问额度重置卡最多等多久。这一问 core 要转去问 ChatGPT 的后端，它自己给那边 15 秒，
/// token 过期时还要换一个再问一遍：不在它答上来之前先放弃 —— 每次用完只问一次
const ASK_CHATGPT: std::time::Duration = std::time::Duration::from_secs(35);

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
        let day_end = snap
            .today
            .is_some()
            .then(|| day_of(&chrono::Local, snap.now_ms).1);
        let reset = next_reset_in(&snap, day_end).map(|d| tokio::time::Instant::now() + d);
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

/// 等到该重收的时候。有事件就攒 [`SETTLE`] 再收；`now`（菜单打开、换了样式或语言、钟跳了）、
/// core 换了状态、到了 `reset`（额度重置、本地零点，见 [`next_reset_in`]），立刻收。
/// 菜单开着时每秒回来一次 [`Woke::Tick`]，**攒着的那几秒也走** —— 不然请求一个接一个
/// 落地时，开着的菜单里秒数会一卡几秒。`due` 是攒到什么时候，由调用方带着跨过这几次 tick
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
/// 问不到（或者 [`ASK`] 之内没回话）时留着上一次的
async fn refresh_live(state: &AppState, snap: &mut Snapshot) {
    snap.now_ms = notices::now_ms();
    if snap.gateway != Gateway::Running {
        return;
    }
    if let Ok(live) = ask(ASK, state.control.call::<ep::Live>(&[], &())).await {
        apply_live(snap, live);
    }
}

/// 问 core 一句，最多等 `within`。**等不到就当没问到**，和问了被拒一样处理
async fn ask<T>(
    within: std::time::Duration,
    question: impl std::future::Future<Output = anyhow::Result<T>>,
) -> anyhow::Result<T> {
    tokio::time::timeout(within, question)
        .await
        .unwrap_or_else(|_| Err(anyhow::anyhow!("core {within:?} 内没回话")))
}

/// **开始的时刻按 core 报的「已经跑了多久」往回推**，推到这台机器的时钟上（`snap.now_ms`
/// 是刚取的）。不拿 `at_ms`：那是 core 的时钟，连的是另一台机器上的 core 时，两边差着
/// 几秒，「已跑」就跟着差几秒，差成负数时一直是 0
fn apply_live(snap: &mut Snapshot, live: tw_api::LiveView) {
    let now = snap.now_ms;
    snap.live = live
        .running
        .into_iter()
        .map(|r| model::Live {
            id: r.id,
            app: r.client_hint,
            key: r.client,
            model: r.model,
            started_ms: now.saturating_sub(r.elapsed_ms),
        })
        .collect();
    snap.rate = live.tokens_per_sec;
}

/// 最近的一个该整个重收的时刻还有多久：额度重置（那份额度作废），或者显示着的「今日」
/// 过完了（`day_end_ms`，本地的下一个零点 —— 过了零点还挂着昨天的数，那就不是「今日」）。
///
/// **等这一段的定时器走的是 tokio 的钟**，macOS、Linux 上系统睡着时它不走：合上盖子睡过了
/// 零点，醒来还要再等睡前剩下的那一段。睡醒、改时钟、换时区由 [`crate::clock`] 另外叫醒
/// （`menubar_now`），重收时按此刻的钟重新算这一段
fn next_reset_in(snap: &Snapshot, day_end_ms: Option<i64>) -> Option<std::time::Duration> {
    snap.quotas
        .iter()
        .flat_map(|q| q.windows.iter())
        .filter_map(|w| w.resets_at_ms)
        .chain(day_end_ms.and_then(|at| u64::try_from(at).ok()))
        .filter(|at| *at > snap.now_ms)
        .min()
        .map(|at| std::time::Duration::from_millis(at - snap.now_ms))
}

/// 「今日」那一问：这台机器的本地零点起、到现在，一小时一格。
///
/// **零点在这边按本机的时区算好了交给 core**：core 只收 Unix 毫秒的时间窗。不给起点，
/// core 就按它自己那台机器的零点算 —— 连着一台跑在 UTC 容器里的远程 core、人在东八区
/// 时，「今日」每天早上八点才归零；它还是拿此刻的 UTC 偏移去推零点的，夏令时切换的
/// 那一天差一个小时。终点不给，就是到现在。
///
/// **今天的合计和每小时的柱子出自这同一问**（`/summary/buckets/by`，概览的趋势图也是它）：
/// 它和 `/summary` 是同一个时间窗、同一个筛选条件（`at_ms` 在窗里、不是本地应答），每一格
/// 带着次数、失败、费用三态和四类 token，各格加起来就是 `/summary` 的那几个数。问一次
/// 而不是两次，大数字和柱子也就永远对得上。按密钥分组：一小时里通常只有一两把密钥，
/// 回来的行最少
fn today_query<Tz: chrono::TimeZone>(tz: &Tz, now_ms: u64) -> tw_api::BucketGroupQuery {
    tw_api::BucketGroupQuery {
        from_ms: Some(day_of(tz, now_ms).0),
        to_ms: None,
        bucket_ms: Some(model::HOUR_MS),
        dim: tw_api::CostDim::Client,
    }
}

/// 把那一问的回答加成今天的合计和每小时的 token。`day` 是问的那一天（[`day_of`]）：格数按
/// 它有几个小时定（夏令时切换的那天 23 或 25 格）。**落在这一天之外的格子合计里也不算**：
/// 连着的 core 时钟快几分钟、这边快到零点时，它会回一格明天的
fn today_from(
    groups: &[tw_api::CostBucketGroup],
    day: (i64, i64),
) -> (model::Today, model::Hourly) {
    let (from, to) = day;
    let slots = usize::try_from((to - from + model::HOUR_MS - 1) / model::HOUR_MS).unwrap_or(0);
    let mut today = model::Today::default();
    let mut tokens = vec![0; slots];
    for g in groups {
        let k = (g.at_ms - from).div_euclid(model::HOUR_MS);
        let Some(slot) = usize::try_from(k).ok().and_then(|k| tokens.get_mut(k)) else {
            continue;
        };
        let t = g.input_tokens + g.output_tokens + g.cache_read_tokens + g.cache_write_tokens;
        *slot += t;
        today.requests += g.requests;
        today.failed += g.failed;
        today.tokens += t;
        today.cost_micros += g.cost_micros_exact + g.cost_micros_estimated;
        today.estimated_micros += g.cost_micros_estimated;
        today.unpriced += g.unpriced_requests;
        today.no_usage += g.no_usage_requests;
    }
    (
        today,
        model::Hourly {
            from_ms: from,
            tokens,
        },
    )
}

/// `now_ms` 所在的那一天，按 `tz` 的日历：`[零点, 下一个零点)`，Unix 毫秒。
///
/// **按日期去找零点，不拿此刻的偏移往回推**：夏令时切换的那一天，零点时的偏移和此刻的
/// 不是同一个
fn day_of<Tz: chrono::TimeZone>(tz: &Tz, now_ms: u64) -> (i64, i64) {
    let now_ms = now_ms as i64;
    let Some(now) = chrono::DateTime::from_timestamp_millis(now_ms) else {
        // 日历表示不了的时刻：不会遇到，也不值得为它编一个日子
        return (now_ms, now_ms);
    };
    let date = now.with_timezone(tz).date_naive();
    let next = date.succ_opt().unwrap_or(date);
    (day_start(tz, date), day_start(tz, next))
}

/// 这一天从哪一刻起。**零点不一定正好有一个**：
///
/// - 在零点把表往前拨的地方（智利、古巴、黎巴嫩），时钟从 23:59:59 直接跳到 01:00，这一天
///   没有零点 —— 取跳过去之后的第一刻；
/// - 在一点把表拨回零点的地方（古巴入冬），零点有两个 —— 取前一个：两个零点之间那一小时
///   已经是这一天了
fn day_start<Tz: chrono::TimeZone>(tz: &Tz, date: chrono::NaiveDate) -> i64 {
    let midnight = date.and_time(chrono::NaiveTime::MIN);
    // 跳过的那一段按分钟往后找。拨表都落在整分钟上，所以找到的就是跳过去的那一刻；
    // 一天里总有存在的时刻，最多找一天
    (0..=24 * 60)
        .find_map(|m| {
            let local = midnight.checked_add_signed(chrono::TimeDelta::minutes(m))?;
            tz.from_local_datetime(&local).earliest()
        })
        .map_or_else(
            || midnight.and_utc().timestamp_millis(),
            |t| t.timestamp_millis(),
        )
}

/// 额度用完之后问到的重置卡张数。**每次用完只问一次**：问的是 ChatGPT 的后端
#[derive(Default)]
struct Credits {
    /// 上游 → (问的时候那个窗口的重置时刻, 张数)
    seen: std::collections::HashMap<String, (Option<u64>, Option<i64>)>,
}

async fn collect(app: &tauri::AppHandle, state: &AppState, credits: &mut Credits) -> Snapshot {
    let now_ms = notices::now_ms();
    let current = state.link.current();
    let remote = match &current {
        crate::connection::Current::Remote(r) => Some(r.name.clone()),
        crate::connection::Current::Local => None,
    };
    let gateway = match state.supervisor.state() {
        // 连着远程：看的是那一条连接，本机的 core 本来就停着
        _ if remote.is_some() => match state.link.state() {
            crate::connection::LinkState::Connected { .. } => Gateway::Running,
            _ => Gateway::Unlinked,
        },
        _ if state.core_missing.is_some() => Gateway::Failed,
        CoreState::Running { .. } => Gateway::Running,
        CoreState::Starting | CoreState::Restarting { .. } => Gateway::Starting,
        CoreState::SafeMode { .. } => Gateway::SafeMode,
        CoreState::Failed { .. } | CoreState::Exited { .. } => Gateway::Failed,
        CoreState::Stopped => Gateway::Stopped,
    };
    let notices = app.try_state::<Arc<notices::Notices>>();
    let mut snap = Snapshot {
        notices_on: notices
            .as_ref()
            .is_some_and(|n| n.mode() != notices::Mode::Off),
        notices: notices.map(|n| unread(&n.list())).unwrap_or_default(),
        update: crate::updater::pending_update(app),
        connections: crate::connection::view(app)
            .profiles
            .into_iter()
            .map(|p| model::Connection {
                current: p.id == current_id(&current),
                id: p.id,
                name: p.name,
            })
            .collect(),
        remote,
        now_ms,
        gateway,
        ..Default::default()
    };
    if snap.gateway != Gateway::Running {
        return snap;
    }
    let c = &state.control;
    let day = day_of(&chrono::Local, now_ms);
    let today = today_query(&chrono::Local, now_ms);
    // 每一问各自限时：一问不回，别的照常画，没问到的那几样是「不知道」
    let (status, quota, buckets, overview, live) = tokio::join!(
        ask(ASK, c.status()),
        ask(ASK, c.call::<ep::Quota>(&[], &())),
        ask(ASK, c.call::<ep::CostBucketsBy>(&[], &today)),
        ask(ASK, c.call::<ep::Overview>(&[], &())),
        ask(ASK, c.call::<ep::Live>(&[], &()))
    );
    if let Ok(l) = live {
        apply_live(&mut snap, l);
    }
    if let Ok(s) = &status {
        snap.listen_error = s.listen_error.clone().map(|e| crate::core_text::text(&e));
    }
    // 右边写的是「复制网关地址」复制的那一个：主机按连接（本机是 127.0.0.1），端口按配置。
    // 网关没在监听时不写
    if let (Ok(s), Ok(o)) = (&status, &overview)
        && s.gateway_addr.is_some()
    {
        let url = crate::clients::base_url(&crate::clients::gateway_host(state), o.listen.port);
        snap.addr = Some(url.trim_start_matches("http://").to_string());
    }
    if let Ok(groups) = buckets {
        let (t, hourly) = today_from(&groups, day);
        snap.today = Some(t);
        snap.hourly = Some(hourly);
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
    for q in quota.unwrap_or_default() {
        let windows: Vec<model::Window> = q
            .windows
            .iter()
            .map(|w| model::Window {
                window: w.window.clone(),
                used_percent: w.used_percent,
                resets_at_ms: w.resets_at_ms,
                status: w.status.clone(),
                credits: w.credits.map(|c| model::QuotaCredits {
                    total: c.total,
                    used: c.used,
                    remaining: c.remaining,
                }),
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
                        let n = ask(ASK_CHATGPT, c.call::<ep::ChatgptUsage>(&[&q.provider], &()))
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

fn current_id(c: &crate::connection::Current) -> &str {
    match c {
        crate::connection::Current::Local => crate::connection::store::LOCAL,
        crate::connection::Current::Remote(r) => &r.id,
    }
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
        // 切到远程要先试连、再确认（确认框里要说哪些客户端还指着本机）：交给主界面
        // 走和侧栏同一条路。切回本机不用确认，直接切
        Action::SwitchConnection(id) if id != crate::connection::store::LOCAL => {
            notices::open_view(&app, format!("switch:{id}"))
        }
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
    // **失败留着码**（`CmdError`）：core 拒绝的，说给用户之前要按码翻，见 [`why`]
    let result: Result<(), CmdError> = match action {
        Action::CopyAddress => copy_address(app, &st).await,
        Action::CopyKey => copy_default_key(app, &st).await,
        Action::SelectGroup { group, provider } => st
            .control
            .select_group(&group, &provider)
            .await
            .map_err(CmdError::from),
        Action::RestartGateway => crate::gateway::restart_gateway(app).await,
        Action::RetryConnection => {
            st.link.retry_now();
            Ok(())
        }
        Action::SwitchConnection(id) => crate::connection::switch(app, &id, false)
            .await
            .map(|_| ())
            .map_err(|e| CmdError::plain(format!("{e:?}"))),
        Action::CheckUpdates => {
            check_updates(app).await;
            Ok(())
        }
        _ => Ok(()),
    };
    if let Err(e) = result {
        tracing::warn!("菜单里的操作没做成：{e}");
        say(
            app,
            tr!("操作未完成", "The Action Did Not Complete"),
            &why(e),
        );
    }
    st.menubar.notify_one();
}

/// 没做成的原因，说给用户的那一句。**core 拒绝的按码说成界面的语言**：和界面、系统通知
/// 读同一张表（`core_text`），不把 core 的英文原句直接摆在中文界面上。这一层自己的失败
/// 没有码，本来就是一句话，照原样
fn why(e: CmdError) -> String {
    crate::core_text::text(&e.into_msg())
}

async fn copy_address(app: &tauri::AppHandle, st: &AppState) -> Result<(), CmdError> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    // 客户端该连的地址，和客户端页、密钥页复制的是同一个
    let base = crate::clients::gateway_base(&st.control, &crate::clients::gateway_host(st)).await?;
    app.clipboard()
        .write_text(base)
        .map_err(|e| CmdError::plain(e.to_string()))
}

/// **明文不经过界面**：和密钥页的「复制」同一条路，在 Rust 这边直接写剪贴板
async fn copy_default_key(app: &tauri::AppHandle, st: &AppState) -> Result<(), CmdError> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let keys = st.control.call::<ep::Keys>(&[], &()).await?;
    let name = keys
        .iter()
        .find(|k| k.default)
        .or_else(|| keys.first())
        .map(|k| k.name.clone())
        .ok_or_else(|| CmdError::plain(tr!("尚无网关密钥。", "There is no gateway key yet.")))?;
    let v = st.control.call::<ep::KeyValue>(&[&name], &()).await?;
    app.clipboard()
        .write_text(v.key)
        .map_err(|e| CmdError::plain(e.to_string()))
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
        // **用户自己退出的**：之后再打开是用户要打开，不按「更新之后重新打开」恢复
        // （见 `updater::record_exit`）
        #[cfg(target_os = "macos")]
        macos::on_main(move |mtm| {
            if macos::confirm_quit(mtm, in_flight) {
                crate::updater::quitting_by_user();
                app.exit(0);
            }
        });
        #[cfg(not(target_os = "macos"))]
        {
            let _ = in_flight;
            crate::updater::quitting_by_user();
            app.exit(0);
        }
    });
}

/// 一句话的提示：检查更新的结果，菜单里的操作为什么没做成。**用户点了，就该看到结果**
fn say(app: &tauri::AppHandle, title: &str, body: &str) {
    #[cfg(target_os = "macos")]
    {
        let (title, body) = (title.to_string(), body.to_string());
        let _ = app;
        macos::on_main(move |mtm| macos::inform(mtm, &title, &body));
    }
    #[cfg(not(target_os = "macos"))]
    notify(app, title, body);
}

/// 托盘那一句提示在系统通知里的键。**只有一个**：新的一句顶掉上一句，不在通知中心里
/// 越堆越多。点开落在设置页（按键的种类，见 `notices::rules::default_view`），检查更新
/// 和网关的状态都在那一页
#[cfg(not(target_os = "macos"))]
const SAID: &str = "menubar";

/// 托盘没有自己的提示框，这一句只能是一条系统通知。
///
/// **提醒设成「系统通知」时走通知总线**（`Notices::announce`）：投给这个平台原生的那一端，
/// 点开回到应用；Linux 上那一端一直连着会话总线 —— 通知插件每条通知开一个连接、发完就断，
/// 而 GNOME 在发送方断开时会把这个应用的通知一起收走（见 `notices::linux`）。
///
/// 设成「仅在应用内」或「关闭」时总线不弹，可这一句是对用户这一下点击的回答，不是一条
/// 提醒：那一档管的是要不要被打断，而用户正等着这个结果（macOS 上它是一个对话框，也不
/// 看那一档）。这时交给通知插件
#[cfg(not(target_os = "macos"))]
fn notify(app: &tauri::AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    match app.try_state::<Arc<notices::Notices>>() {
        Some(n) if n.mode() == notices::Mode::System => n.announce(SAID, title, body),
        _ => {
            if let Err(e) = app.notification().builder().title(title).body(body).show() {
                tracing::debug!("托盘的提示没发出去：{e}");
            }
        }
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

    /// core 给的在跑的请求照原样进菜单：谁、哪个模型、跑了多久，还有速率。**跑了多久
    /// 以 core 算的为准**：它的时钟比这台机器快了一分钟（`at_ms` 在「将来」），菜单上
    /// 照样是 12 秒
    #[test]
    fn the_live_numbers_come_from_core_as_they_are() {
        let mut snap = Snapshot {
            now_ms: 100_000,
            ..Default::default()
        };
        apply_live(
            &mut snap,
            tw_api::LiveView {
                running: vec![tw_api::RunningView {
                    id: 7,
                    client: "default".into(),
                    client_hint: Some("codex".into()),
                    model: "gpt-5".into(),
                    provider: "openai".into(),
                    at_ms: 148_000,
                    elapsed_ms: 12_000,
                    session: None,
                    route: "default".into(),
                    rule: "catch-all".into(),
                    group: Some("__all__".into()),
                    upstream: None,
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
                started_ms: 88_000,
            }]
        );
        assert_eq!(snap.rate, Some(52));
        // 下一次一个都不在跑、这一分钟也没有跑完的：都清掉，不留上一次的
        apply_live(&mut snap, tw_api::LiveView::default());
        assert!(snap.live.is_empty());
        assert_eq!(snap.rate, None);
    }

    /// core 接了连接却一直不回话：问一句最多等 [`ASK`]，等不到就当没问到。收数和每秒的
    /// `/live` 都是一问接一问的，一问挂住，菜单栏就再也不刷新
    #[tokio::test(start_paused = true)]
    async fn a_core_that_never_answers_holds_up_the_menu_bar_only_for_a_while() {
        let start = tokio::time::Instant::now();
        let stalled = std::future::pending::<anyhow::Result<tw_api::LiveView>>();
        let asked = tokio::time::timeout(ASK * 10, ask(ASK, stalled)).await;
        let Ok(answer) = asked else {
            panic!("一直在等一个不回话的 core");
        };
        assert!(answer.is_err());
        assert_eq!(start.elapsed(), ASK);
        // 答得上来的照常拿到
        let live = ask(ASK, async { Ok(tw_api::LiveView::default()) }).await;
        assert!(live.is_ok());
    }

    /// 菜单里的操作被 core 拒绝了（切策略组时配置刚被别处改过）：说给用户的是界面语言的
    /// 那一句，不是 core 的英文原句。这一层自己的失败本来就是一句话，照原样
    #[test]
    fn a_refusal_from_core_is_said_in_the_interface_language() {
        use crate::i18n::{Lang, with_lang};
        let text = "version mismatch: this edit is based on v1, and the current version is v2. \
                    Refresh and edit again";
        let refused = || -> CmdError {
            anyhow::Error::new(crate::control::Refused(tw_api::Msg {
                code: "control.config_stale".into(),
                args: [("base", "v1"), ("current", "v2")]
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .into(),
                text: text.into(),
            }))
            .into()
        };
        assert_eq!(
            why(refused()),
            "版本不一致：本次修改基于 v1，当前版本为 v2。请刷新后重新修改。"
        );
        with_lang(Lang::En, || assert_eq!(why(refused()), text));
        assert_eq!(why(CmdError::plain("剪贴板不可用")), "剪贴板不可用");
    }

    #[test]
    fn the_style_survives_a_round_trip() {
        for s in [Style::Full, Style::Icon, Style::Numbers] {
            set_style(s);
            assert_eq!(style(), s);
        }
        set_style(Style::Full);
    }

    use chrono::{FixedOffset, MappedLocalTime, NaiveDate, NaiveDateTime, NaiveTime, TimeZone};

    /// UTC 的这一刻，Unix 毫秒
    fn utc_ms(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> i64 {
        NaiveDate::from_ymd_opt(y, mo, d)
            .and_then(|d| d.and_hms_opt(h, mi, 0))
            .unwrap()
            .and_utc()
            .timestamp_millis()
    }

    /// 测试用的时区：`at`（UTC 毫秒）之前是 `before`，之后是 `after` —— 夏令时的一次拨表
    #[derive(Debug, Clone, Copy)]
    struct Shift {
        at: i64,
        before: FixedOffset,
        after: FixedOffset,
    }

    fn shift(at: i64, before_h: i32, after_h: i32) -> Shift {
        let hours = |h: i32| FixedOffset::east_opt(h * 3600).unwrap();
        Shift {
            at,
            before: hours(before_h),
            after: hours(after_h),
        }
    }

    impl TimeZone for Shift {
        type Offset = FixedOffset;

        fn from_offset(o: &FixedOffset) -> Self {
            Shift {
                at: i64::MAX,
                before: *o,
                after: *o,
            }
        }

        fn offset_from_utc_datetime(&self, utc: &NaiveDateTime) -> FixedOffset {
            if utc.and_utc().timestamp_millis() < self.at {
                self.before
            } else {
                self.after
            }
        }

        fn offset_from_utc_date(&self, utc: &NaiveDate) -> FixedOffset {
            self.offset_from_utc_datetime(&utc.and_time(NaiveTime::MIN))
        }

        /// 同一个钟面按两边的偏移各换回一刻，落在自己那一边的才算数
        fn offset_from_local_datetime(
            &self,
            local: &NaiveDateTime,
        ) -> MappedLocalTime<FixedOffset> {
            let utc = |o: FixedOffset| {
                local.and_utc().timestamp_millis() - i64::from(o.local_minus_utc()) * 1000
            };
            match (utc(self.before) < self.at, utc(self.after) >= self.at) {
                (true, true) => MappedLocalTime::Ambiguous(self.before, self.after),
                (true, false) => MappedLocalTime::Single(self.before),
                (false, true) => MappedLocalTime::Single(self.after),
                (false, false) => MappedLocalTime::None,
            }
        }

        fn offset_from_local_date(&self, local: &NaiveDate) -> MappedLocalTime<FixedOffset> {
            self.offset_from_local_datetime(&local.and_time(NaiveTime::MIN))
        }
    }

    /// 人在东八区，早上七点半（UTC 前一天 23:30）看「今日」：从东八区的零点算起。**不给
    /// 起点，就是 core 那台机器的零点** —— 跑在 UTC 容器里的 core，「今日」到早上八点才归零
    #[test]
    fn today_starts_at_this_machines_midnight() {
        let now = utc_ms(2026, 9, 26, 23, 30) as u64;
        let east8 = FixedOffset::east_opt(8 * 3600).unwrap();
        let q = today_query(&east8, now);
        assert_eq!(q.from_ms, Some(utc_ms(2026, 9, 26, 16, 0)));
        assert_eq!(q.to_ms, None, "终点不给，就是到现在");
        assert_eq!(q.bucket_ms, Some(model::HOUR_MS), "一小时一格");
        // 同一刻在西五区是 9/26 的傍晚
        let west5 = FixedOffset::west_opt(5 * 3600).unwrap();
        assert_eq!(
            today_query(&west5, now).from_ms,
            Some(utc_ms(2026, 9, 26, 5, 0))
        );
    }

    /// core 回的一格里的一把密钥
    fn group(at_ms: i64, name: &str, requests: i64, tokens: [i64; 4]) -> tw_api::CostBucketGroup {
        tw_api::CostBucketGroup {
            at_ms,
            name: name.into(),
            requests,
            failed: 0,
            cost_micros_exact: 0,
            cost_micros_estimated: 0,
            unpriced_requests: 0,
            no_usage_requests: 0,
            input_tokens: tokens[0],
            output_tokens: tokens[1],
            cache_read_tokens: tokens[2],
            cache_write_tokens: tokens[3],
        }
    }

    /// 各格各把密钥加起来就是今天的合计（`/summary` 的那几个数），每一格的四类 token 加起来
    /// 落在它那一小时上；**一个请求都没有的小时是 0**，core 不回空格子
    #[test]
    fn todays_total_and_hours_come_from_the_same_answer() {
        const H: i64 = model::HOUR_MS;
        let from = utc_ms(2026, 10, 8, 16, 0);
        let day = (from, from + 24 * H);
        let mut a = group(from, "default", 3, [1_000, 200, 5_000, 100]);
        a.failed = 1;
        a.cost_micros_exact = 1_500_000;
        a.unpriced_requests = 1;
        let mut b = group(from, "codex", 1, [10, 20, 0, 0]);
        b.cost_micros_estimated = 250_000;
        b.no_usage_requests = 2;
        let c = group(from + 9 * H, "default", 2, [400, 600, 0, 0]);
        let (today, hourly) = today_from(&[a, b, c], day);
        assert_eq!(
            today,
            model::Today {
                requests: 6,
                failed: 1,
                tokens: 6_300 + 30 + 1_000,
                cost_micros: 1_750_000,
                estimated_micros: 250_000,
                unpriced: 1,
                no_usage: 2,
            }
        );
        assert_eq!(hourly.from_ms, from);
        assert_eq!(hourly.tokens.len(), 24);
        assert_eq!(hourly.tokens[0], 6_330);
        assert_eq!(hourly.tokens[9], 1_000);
        assert_eq!(
            hourly.tokens.iter().sum::<i64>(),
            today.tokens,
            "柱子加起来就是大数字"
        );
        assert!(hourly.tokens[1..9].iter().all(|t| *t == 0));
        // 一个请求都没有的一天：问到了，是 0，不是「不知道」
        let (quiet, hours) = today_from(&[], day);
        assert_eq!(quiet, model::Today::default());
        assert_eq!(hours.tokens, vec![0; 24]);
    }

    /// 夏令时切换的那一天不是 24 小时：纽约 3 月 8 日只有 23 小时，11 月 1 日有 25 小时。
    /// 格数跟着这一天走，最后一小时的请求不会因为「只有 24 格」被丢掉
    #[test]
    fn a_dst_day_has_as_many_hours_as_it_really_has() {
        const H: i64 = model::HOUR_MS;
        let spring = shift(utc_ms(2026, 3, 8, 7, 0), -5, -4);
        let day = day_of(&spring, utc_ms(2026, 3, 8, 16, 0) as u64);
        assert_eq!(today_from(&[], day).1.tokens.len(), 23);
        let fall = shift(utc_ms(2026, 11, 1, 6, 0), -4, -5);
        let day = day_of(&fall, utc_ms(2026, 11, 1, 16, 0) as u64);
        let last = group(day.0 + 24 * H + 60_000, "default", 1, [7, 0, 0, 0]);
        let (_, hourly) = today_from(&[last], day);
        assert_eq!(hourly.tokens.len(), 25);
        assert_eq!(hourly.tokens[24], 7);
        // 落在这一天之外的格子：明天的那一格不算进今天，也不画到别的小时上
        let tomorrow = group(day.1, "default", 1, [9, 0, 0, 0]);
        let (today, hourly) = today_from(&[tomorrow], day);
        assert_eq!(today, model::Today::default());
        assert!(hourly.tokens.iter().all(|t| *t == 0));
    }

    /// 夏令时开始的那一天（纽约 2026-03-08，两点拨到三点）中午：零点是拨表之前的那个
    /// （-05:00）。拿此刻的偏移（-04:00）往回推，会早一个小时
    #[test]
    fn a_dst_day_starts_at_its_own_midnight() {
        let new_york = shift(utc_ms(2026, 3, 8, 7, 0), -5, -4);
        let noon = utc_ms(2026, 3, 8, 16, 0) as u64;
        assert_eq!(
            day_of(&new_york, noon),
            (utc_ms(2026, 3, 8, 5, 0), utc_ms(2026, 3, 9, 4, 0))
        );
    }

    /// 在零点拨表的地方（圣地亚哥 2026-09-06，零点直接跳到一点）：这一天没有零点，从跳过去
    /// 的那一刻算起；前一天也正好到那一刻为止
    #[test]
    fn a_day_without_a_midnight_starts_where_the_clock_lands() {
        let santiago = shift(utc_ms(2026, 9, 6, 4, 0), -4, -3);
        let noon = utc_ms(2026, 9, 6, 15, 0) as u64;
        assert_eq!(
            day_of(&santiago, noon),
            (utc_ms(2026, 9, 6, 4, 0), utc_ms(2026, 9, 7, 3, 0))
        );
        let day_before = utc_ms(2026, 9, 5, 16, 0) as u64;
        assert_eq!(
            day_of(&santiago, day_before),
            (utc_ms(2026, 9, 5, 4, 0), utc_ms(2026, 9, 6, 4, 0))
        );
    }

    /// 在一点拨回零点的地方（哈瓦那 2026-11-01）：零点有两个，从前一个算起 —— 两个零点
    /// 之间那一小时已经是这一天了
    #[test]
    fn a_day_with_two_midnights_starts_at_the_first() {
        let havana = shift(utc_ms(2026, 11, 1, 5, 0), -4, -5);
        let noon = utc_ms(2026, 11, 1, 17, 0) as u64;
        assert_eq!(
            day_of(&havana, noon),
            (utc_ms(2026, 11, 1, 4, 0), utc_ms(2026, 11, 2, 5, 0))
        );
    }

    /// 显示着「今日」时，到了本地的下一个零点就整个重收一次，不等下一个事件：不然过了零点，
    /// 菜单栏上挂着的还是昨天的数
    #[test]
    fn the_day_is_collected_again_when_it_ends() {
        const HOUR: u64 = 3_600_000;
        let now = 1_800_000_000_000;
        let snap = Snapshot {
            now_ms: now,
            quotas: vec![model::Quota {
                provider: "chatgpt".into(),
                windows: vec![model::Window {
                    resets_at_ms: Some(now + 10 * HOUR),
                    ..Default::default()
                }],
                reset_credits: None,
            }],
            ..Default::default()
        };
        let hours = |h: u64| Some(std::time::Duration::from_millis(h * HOUR));
        let at = |h: u64| Some((now + h * HOUR) as i64);
        assert_eq!(next_reset_in(&snap, at(2)), hours(2));
        // 额度先重置的，先按额度来
        assert_eq!(next_reset_in(&snap, at(20)), hours(10));
        assert_eq!(next_reset_in(&snap, None), hours(10));
    }
}
