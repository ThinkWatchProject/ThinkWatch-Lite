//! 通知总线：什么该打断用户，什么只该留个记号。
//!
//! # 为什么在 Rust 这一侧
//!
//! 关窗即销毁 webview（见 `lib.rs` 的 `CloseRequested`），所以**只活在界面里的
//! 提醒，在关窗期间发生就等于没发生**。而额度用完、登录失效、代理不通这几件事，
//! 恰恰最可能发生在用户没看着界面的时候。判定放在这里，界面只是它的一个视图。
//!
//! # 一条通知要过五关
//!
//! 1. **分级**：只有「此刻所有客户端都在瞎」是 critical，「有事要用户动手」是
//!    warning，其余只进应用内。
//! 2. **去抖**：故障类要持续一会儿才说 —— 一次网络抖动自己就好了。
//! 3. **去重**：同一件事（同一个去重键）只说一次，后续只更新计数。
//! 4. **抑制**：网关整个不在服务时，不必再说它下面每一家上游怎么了。
//! 5. **限流**：令牌桶。用完了的只进应用内，并合并成一句「另有 N 项」。
//!
//! 恢复默认**静默撤回**：一条撤不回来的通知，代价是用户把整个应用的通知关掉。
//!
//! # 平台
//!
//! 投递是 [`Sink`]，系统通知只是其中一个实现。Windows 要加的是一个 sink，
//! 不是另一套判定。

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(target_os = "macos")]
pub mod macos;
pub mod prefs;
pub mod rules;
pub mod sink;
mod store;

pub use prefs::{Category, Mode};
pub use sink::{Sink, SystemSink};

/// 去抖：故障类要持续这么久才说。用户已经在等结果的那几件事不等（见 [`Signal::hold`]）
const HOLD: Duration = Duration::from_secs(60);

/// 令牌桶：一次真实故障通常花 1–2 个
const BUCKET: u32 = 3;
const REFILL_EVERY: Duration = Duration::from_secs(600);

/// 同一件事在这段时间里反复开合这么多次，就是在抖
const FLAP_WINDOW: Duration = Duration::from_secs(3600);
const FLAP_TIMES: usize = 3;

/// 撑过这么久的 critical，恢复时值得说一句；短的静默撤回
const SAY_RECOVERED_AFTER: Duration = Duration::from_secs(300);

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    /// 只进应用内
    Info,
    /// 有事要用户动手
    Warning,
    /// 此刻所有客户端都在瞎
    Critical,
}

impl Level {
    /// 要不要发系统通知
    fn interrupts(self) -> bool {
        self >= Level::Warning
    }
}

/// 出事了，还是恢复了
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    Raised,
    Cleared,
}

/// 规则层交给总线的东西。**不含平台细节，也不含时间** —— 那两样由总线补
#[derive(Debug, Clone)]
pub struct Signal {
    /// 去重键：`种类:对象`。错误文本和状态码不进键，它们只进正文
    pub key: String,
    pub change: Change,
    pub level: Level,
    pub title: String,
    pub body: String,
    /// 点开之后落在哪一页
    pub view: Option<&'static str>,
    /// 这件事压下哪些键（前缀匹配）。网关不在服务时压下其余全部
    pub suppresses: &'static [&'static str],
    /// 要不要去抖。用户已经在等结果的事（安全模式、上游全挂）不等
    pub hold: bool,
}

impl Signal {
    pub fn raised(key: impl Into<String>, level: Level, title: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            change: Change::Raised,
            level,
            title: title.into(),
            body: String::new(),
            view: None,
            suppresses: &[],
            hold: true,
        }
    }

    pub fn cleared(key: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            change: Change::Cleared,
            level: Level::Info,
            title: String::new(),
            body: String::new(),
            view: None,
            suppresses: &[],
            hold: false,
        }
    }

    pub fn body(mut self, body: impl Into<String>) -> Self {
        self.body = body.into();
        self
    }

    pub fn view(mut self, view: &'static str) -> Self {
        self.view = Some(view);
        self
    }

    pub fn now(mut self) -> Self {
        self.hold = false;
        self
    }

    pub fn suppressing(mut self, keys: &'static [&'static str]) -> Self {
        self.suppresses = keys;
        self
    }
}

/// 界面上看到的一条。**这就是「通知中心」里的一行**
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Notice {
    pub key: String,
    /// 属于哪一类。「不再通知此类」按它来
    pub category: Category,
    pub level: Level,
    pub title: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<String>,
    /// 第一次发生
    pub first_at_ms: u64,
    /// 最近一次发生
    pub at_ms: u64,
    /// 这段时间里发生了几次。1 就是一次
    pub count: u32,
    /// 已经弹过系统通知
    #[serde(default)]
    pub notified: bool,
}

/// 一条还开着的通知，连同判定要用的状态
#[derive(Debug, Clone)]
struct Open {
    notice: Notice,
    /// 到点才投递。`None` = 已经投过或不需要等
    due: Option<Instant>,
    /// 因为抖动被静音到什么时候
    muted_until: Option<Instant>,
}

#[derive(Debug, Default)]
struct State {
    open: HashMap<String, Open>,
    /// 每个键最近的开合时刻，用来判抖动
    flaps: HashMap<String, VecDeque<Instant>>,
    /// 令牌桶
    tokens: u32,
    refilled_at: Option<Instant>,
    /// 被限流压下去的条数，给「另有 N 项」用
    held_back: u32,
}

/// 通知总线。**整个应用只有一份**
pub struct Notices {
    state: Mutex<State>,
    sinks: Vec<Box<dyn Sink>>,
    /// 每一类怎么对待
    prefs: Mutex<prefs::Prefs>,
    /// 落盘的目录。关窗期间发生的事要留得住，设置也在这里
    dir: Option<std::path::PathBuf>,
}

const OPEN_FILE: &str = "notices.json";
const PREFS_FILE: &str = "notice-prefs.json";

impl Notices {
    /// `dir` 是留存的目录；`None` 表示只在内存里（测试用）
    pub fn new(sinks: Vec<Box<dyn Sink>>, dir: Option<std::path::PathBuf>) -> Arc<Self> {
        let open = dir
            .as_deref()
            .map(|d| store::load(&d.join(OPEN_FILE)))
            .unwrap_or_default();
        let prefs = dir
            .as_deref()
            .map(|d| prefs::load(&d.join(PREFS_FILE)))
            .unwrap_or_default();
        Arc::new(Self {
            state: Mutex::new(State {
                open: open
                    .into_iter()
                    .map(|n| {
                        (
                            n.key.clone(),
                            Open {
                                notice: n,
                                due: None,
                                muted_until: None,
                            },
                        )
                    })
                    .collect(),
                tokens: BUCKET,
                ..Default::default()
            }),
            sinks,
            prefs: Mutex::new(prefs),
            dir,
        })
    }

    /// 每一类现在怎么对待，按设置页的顺序
    pub fn modes(&self) -> Vec<(Category, Mode)> {
        let p = self.prefs.lock().expect("锁未中毒");
        Category::ALL.iter().map(|c| (*c, p.mode(*c))).collect()
    }

    /// 改一类的对待方式。**改成「关闭」时，这一类挂着的也一并撤掉** —— 用户说的是
    /// 「这类事别再出现」，留着一条旧的等于没听见
    pub fn set_mode(&self, category: Category, mode: Mode) -> std::io::Result<()> {
        let saved = {
            let mut p = self.prefs.lock().expect("锁未中毒");
            p.set(category, mode);
            p.clone()
        };
        if let Some(dir) = &self.dir {
            prefs::save(&dir.join(PREFS_FILE), &saved)?;
        }
        if mode == Mode::Off {
            let gone: Vec<String> = {
                let mut g = self.state.lock().expect("锁未中毒");
                let keys: Vec<String> = g
                    .open
                    .values()
                    .filter(|o| o.notice.category == category)
                    .map(|o| o.notice.key.clone())
                    .collect();
                for k in &keys {
                    g.open.remove(k);
                }
                keys
            };
            for k in &gone {
                for s in &self.sinks {
                    s.withdraw(k);
                }
            }
            self.persist();
            self.changed();
        }
        Ok(())
    }

    /// 这一条点开之后落在哪一页。**已经不在列表里的**（恢复了、被划掉了）按类别给
    pub fn view_of(&self, key: &str) -> String {
        self.state
            .lock()
            .ok()
            .and_then(|g| g.open.get(key).and_then(|o| o.notice.view.clone()))
            .unwrap_or_else(|| rules::default_view(Category::of(key)).to_string())
    }

    /// 界面要显示的那一份，最近的在前
    pub fn list(&self) -> Vec<Notice> {
        let g = self.state.lock().expect("锁未中毒");
        let mut out: Vec<Notice> = g.open.values().map(|o| o.notice.clone()).collect();
        out.sort_by_key(|n| std::cmp::Reverse(n.at_ms));
        out
    }

    /// 用户把一条划掉了。**只是从列表里去掉** —— 事情本身好没好由信号说了算
    pub fn dismiss(&self, key: &str) {
        let removed = {
            let mut g = self.state.lock().expect("锁未中毒");
            g.open.remove(key).is_some()
        };
        if removed {
            for s in &self.sinks {
                s.withdraw(key);
            }
            self.persist();
            self.changed();
        }
    }

    /// core 的一条事件。**不关心的事件在这里就落地了**，不进总线
    pub fn on_event(self: &Arc<Self>, ev: &tw_api::Event) {
        let at = now_ms();
        for signal in rules::from_event(ev) {
            self.ingest(signal, at);
        }
    }

    /// 网关自己的状态变了
    pub fn on_core_state(self: &Arc<Self>, state: &crate::supervisor::CoreState) {
        let at = now_ms();
        for signal in rules::from_core_state(state) {
            self.ingest(signal, at);
        }
    }

    /// 走一遍那五关。
    pub fn ingest(self: &Arc<Self>, signal: Signal, at_ms: u64) {
        match signal.change {
            Change::Cleared => self.clear(&signal.key, at_ms),
            Change::Raised => self.raise(signal, at_ms),
        }
    }

    fn raise(self: &Arc<Self>, signal: Signal, at_ms: u64) {
        let category = Category::of(&signal.key);
        let mode = self.prefs.lock().expect("锁未中毒").mode(category);
        if mode == Mode::Off {
            return;
        }
        let now = Instant::now();
        let (notice, deliver, due) = {
            let mut g = self.state.lock().expect("锁未中毒");
            let suppressed = suppressed_by(&g, &signal);
            let existing = g.open.get(&signal.key).cloned();
            let muted = existing.as_ref().and_then(|o| o.muted_until);
            let escalated = existing
                .as_ref()
                .is_some_and(|o| signal.level > o.notice.level);
            let notice = match existing {
                // 同一件事又发生了：**只更新，不再弹**（除非升级成了 critical）
                Some(o) => Notice {
                    level: signal.level.max(o.notice.level),
                    title: signal.title.clone(),
                    body: signal.body.clone(),
                    at_ms,
                    count: o.notice.count + 1,
                    notified: o.notice.notified && !escalated,
                    ..o.notice
                },
                None => Notice {
                    key: signal.key.clone(),
                    category,
                    level: signal.level,
                    title: signal.title.clone(),
                    body: signal.body.clone(),
                    view: signal.view.map(str::to_string),
                    first_at_ms: at_ms,
                    at_ms,
                    count: 1,
                    notified: false,
                },
            };
            // 抖动中、被抑制、或者已经弹过：只留记号
            let quiet = muted.is_some_and(|until| now < until) || suppressed || notice.notified;
            // 用户说了「只进应用内」的，级别再高也不打断
            let wants = mode == Mode::System && signal.level.interrupts() && !quiet;
            let due = (wants && signal.hold).then(|| now + HOLD);
            let deliver = wants && !signal.hold && take_token(&mut g, signal.level);
            g.open.insert(
                signal.key.clone(),
                Open {
                    notice: notice.clone(),
                    due,
                    muted_until: muted,
                },
            );
            (notice, deliver, due)
        };
        if deliver {
            self.deliver(&notice);
        } else {
            for s in &self.sinks {
                s.update(&notice);
            }
        }
        if let Some(at) = due {
            self.schedule(signal.key.clone(), at);
        }
        self.persist();
        self.changed();
    }

    /// 等去抖那一段过去。**期间事情好了就不说了** —— 这正是去抖的意义
    fn schedule(self: &Arc<Self>, key: String, at: Instant) {
        let me = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep_until(at.into()).await;
            let notice = {
                let mut g = me.state.lock().expect("锁未中毒");
                match g.open.get_mut(&key) {
                    // 还开着、还没弹过、拿得到令牌
                    Some(o) if o.due == Some(at) && !o.notice.notified => {
                        let level = o.notice.level;
                        o.due = None;
                        if !take_token(&mut g, level) {
                            None
                        } else {
                            g.open.get(&key).map(|o| o.notice.clone())
                        }
                    }
                    _ => None,
                }
            };
            if let Some(n) = notice {
                me.deliver(&n);
                me.persist();
                me.changed();
            }
        });
    }

    fn deliver(&self, notice: &Notice) {
        let held = {
            let mut g = self.state.lock().expect("锁未中毒");
            if let Some(o) = g.open.get_mut(&notice.key) {
                o.notice.notified = true;
            }
            std::mem::take(&mut g.held_back)
        };
        let mut shown = notice.clone();
        shown.notified = true;
        if held > 0 {
            // 被限流压下去的那些，在这一条里带一句
            shown.body = tr!(
                format!("{}（另有 {held} 项待处理）", shown.body),
                if held == 1 {
                    format!("{} (1 more notice pending)", shown.body)
                } else {
                    format!("{} ({held} more notices pending)", shown.body)
                }
            );
        }
        for s in &self.sinks {
            s.show(&shown);
        }
    }

    fn clear(&self, key: &str, at_ms: u64) {
        let (was, flapping) = {
            let mut g = self.state.lock().expect("锁未中毒");
            let Some(o) = g.open.remove(key) else {
                return;
            };
            let now = Instant::now();
            let times = g.flaps.entry(key.to_string()).or_default();
            times.push_back(now);
            while times.front().is_some_and(|t| now - *t > FLAP_WINDOW) {
                times.pop_front();
            }
            let flapping = times.len() >= FLAP_TIMES;
            if flapping {
                // 时断时续：下一次别再弹了，直到它稳定一段时间
                g.open.insert(
                    key.to_string(),
                    Open {
                        notice: Notice {
                            level: Level::Info,
                            title: tr!(
                                format!("{}（时断时续）", o.notice.title),
                                format!("{} (Intermittent)", o.notice.title)
                            ),
                            at_ms,
                            ..o.notice.clone()
                        },
                        due: None,
                        muted_until: Some(now + FLAP_WINDOW),
                    },
                );
            }
            (o, flapping)
        };
        for s in &self.sinks {
            s.withdraw(key);
        }
        // 撑过一阵的 critical 才值得说一句「好了」
        let lasted = at_ms.saturating_sub(was.notice.first_at_ms);
        if !flapping
            && was.notice.level == Level::Critical
            && was.notice.notified
            && lasted >= SAY_RECOVERED_AFTER.as_millis() as u64
        {
            for s in &self.sinks {
                s.show(&Notice {
                    key: format!("{key}:recovered"),
                    category: was.notice.category,
                    level: Level::Info,
                    title: tr!(
                        format!("{}已恢复", was.notice.title),
                        format!("Resolved: {}", was.notice.title)
                    ),
                    body: String::new(),
                    view: was.notice.view.clone(),
                    first_at_ms: at_ms,
                    at_ms,
                    count: 1,
                    notified: true,
                });
            }
        }
        self.persist();
        self.changed();
    }

    fn persist(&self) {
        let Some(dir) = &self.dir else { return };
        let list = self.list();
        store::save(&dir.join(OPEN_FILE), &list);
    }

    /// 界面在开着的话，让它重画
    fn changed(&self) {
        let list = self.list();
        for s in &self.sinks {
            s.listed(&list);
        }
    }
}

/// 有没有更要紧的事正开着。**网关整个不在服务时，不必再说它下面每一家怎么了**
fn suppressed_by(state: &State, signal: &Signal) -> bool {
    state.open.values().any(|o| {
        o.notice.key != signal.key
            && open_suppresses(&o.notice.key)
                .iter()
                .any(|p| signal.key.starts_with(p))
    })
}

/// 开着的这条压下哪些键。**存的是键，不是信号**，所以这里按键反查
fn open_suppresses(key: &str) -> &'static [&'static str] {
    rules::suppresses(key)
}

/// 取一个令牌。critical 不走桶 —— 它本来就少，而且每一条都该看见
fn take_token(state: &mut State, level: Level) -> bool {
    if level == Level::Critical {
        return true;
    }
    let now = Instant::now();
    let since = state.refilled_at.get_or_insert(now);
    let earned = (now.duration_since(*since).as_secs() / REFILL_EVERY.as_secs()) as u32;
    if earned > 0 {
        state.tokens = (state.tokens + earned).min(BUCKET);
        state.refilled_at = Some(now);
    }
    if state.tokens == 0 {
        state.held_back += 1;
        return false;
    }
    state.tokens -= 1;
    true
}

/// 点通知之后要落到的那一页。**窗口这时可能根本不存在** —— 新建的界面挂上之后自己来取
static PENDING_VIEW: Mutex<Option<String>> = Mutex::new(None);

/// 点了系统通知：把窗口带回来，落到能处理这件事的那一页
pub fn open_from_notification(app: &tauri::AppHandle, key: &str) {
    use tauri::{Emitter, Manager};
    let view = app
        .try_state::<Arc<Notices>>()
        .map(|n| n.view_of(key))
        .unwrap_or_else(|| rules::default_view(Category::of(key)).to_string());
    if let Ok(mut g) = PENDING_VIEW.lock() {
        *g = Some(view.clone());
    }
    // 通知的回调不在主线程上，建窗口要回到主线程
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = crate::show_main_window(&a);
        let _ = a.emit("open-view", &view);
    });
}

/// 取走待落的那一页。取一次就没了：下次开窗不该又跳过去
pub fn take_pending_view() -> Option<String> {
    PENDING_VIEW.lock().ok().and_then(|mut g| g.take())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;
