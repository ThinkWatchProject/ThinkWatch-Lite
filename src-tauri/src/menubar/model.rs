//! 菜单栏那一块和它的菜单要显示什么。
//!
//! **只有数据和文案，没有 AppKit。**macOS 把它画成原生菜单，别的平台画成托盘
//! 菜单；什么时候出现哪一节、数字怎么写、什么时候变色，都在这里定、在这里测。
//! 画的那一层只管照着画。

/// 菜单栏上显示什么。设置里的三档，出厂是标识和数值
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Style {
    #[default]
    Full,
    Icon,
    Numbers,
}

/// 网关此刻的状态。守护进程的几种状态按「用户该知道什么」归成这几类
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum Gateway {
    /// 正在起来，或者崩了之后正在重启
    #[default]
    Starting,
    Running,
    /// 连续启动失败，只剩控制面：配置和历史能看，转发停了
    SafeMode,
    /// 程序本身跑不了：找不到、不能执行
    Failed,
    /// 停下了，没有在重启
    Stopped,
    /// 连着远程 core，眼下连不上（正在重连）
    Unlinked,
}

impl Gateway {
    fn running(&self) -> bool {
        matches!(self, Gateway::Running)
    }
}

/// 收一次数得到的全部事实。**都是已经发生的事**，怎么说由 [`build`] 决定
#[derive(Debug, Clone, Default)]
pub struct Snapshot {
    pub gateway: Gateway,
    /// 网关此刻在哪儿监听，`127.0.0.1:18790`
    pub addr: Option<String>,
    /// 监听设置没换成的原因，已经是给人看的一句话。旧地址还在服务
    pub listen_error: Option<String>,
    /// 今天的用量。**没问到是 None，不是 0** —— 0 是一个值
    pub today: Option<Today>,
    /// 报过额度的上游
    pub quotas: Vec<Quota>,
    /// 进行中的请求，开始得早的在前
    pub live: Vec<Live>,
    /// 最近一分钟跑完的请求平均每秒生成多少 token
    pub rate: Option<u32>,
    /// 未读的提醒，要紧的在前
    pub notices: Vec<NoticeLine>,
    /// 提醒没有关掉
    pub notices_on: bool,
    /// 手动选择的策略组
    pub groups: Vec<Group>,
    /// 上一版配置是什么时候的。没有上一版是 None
    pub undo_at_ms: Option<u64>,
    /// 查到了、还没装的新版本
    pub update: Option<String>,
    /// 连接列表，本机在最前。「连接」子菜单照它列
    pub connections: Vec<Connection>,
    /// 连着远程时是那台服务器的名字。状态头写它，不写应用名
    pub remote: Option<String>,
    pub now_ms: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub current: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Today {
    pub requests: i64,
    pub failed: i64,
    /// 输入、输出、缓存读写合计，和概览同一个口径
    pub tokens: i64,
    /// 实测加估算，微分
    pub cost_micros: i64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Quota {
    pub provider: String,
    pub windows: Vec<Window>,
    /// 可用的额度重置卡。只在额度用完之后问过才有
    pub reset_credits: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Window {
    /// 上游给的窗口名：`5h` / `7d` / `weekly`
    pub window: String,
    pub used_percent: f64,
    pub resets_at_ms: Option<u64>,
    /// 上游的原词：`allowed` / `allowed_warning` / `rejected`
    pub status: Option<String>,
    /// 积分制套餐（GLM Coding Plan）这个窗口的积分。别的窗口没有
    pub credits: Option<QuotaCredits>,
}

/// 积分制套餐一个额度窗口的总额、已用、剩余，**都是上游给的原数**：剩余不是总额减已用
/// 算出来的，三个数不一定对得上，显示剩余就显示它说的剩余
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct QuotaCredits {
    pub total: f64,
    pub used: f64,
    pub remaining: f64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Live {
    pub id: u64,
    /// 请求头认出来的应用（`claude-code`）。认不出来是 None
    pub app: Option<String>,
    /// 网关密钥的名字
    pub key: String,
    pub model: String,
    /// 开始的时刻，**这台机器的时钟**：由 core 报的「已经跑了多久」推回来的，
    /// 和 `Snapshot::now_ms` 相减就是已跑时长
    pub started_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Info,
    Warning,
    Critical,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoticeLine {
    pub key: String,
    pub level: Level,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Group {
    pub name: String,
    pub members: Vec<String>,
    pub selected: Option<String>,
}

/// 点了之后做什么
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    OpenMain,
    /// 打开主界面并落到这一页（`upstreams`、`dashboard`…）
    Open(&'static str),
    /// 打开流量页并展开这一条
    OpenRequest(u64),
    /// 落到能处理这条提醒的那一页，并标为已读
    OpenNotice(String),
    AllNotices,
    Settings,
    CopyAddress,
    CopyKey,
    Undo,
    SelectGroup {
        group: String,
        provider: String,
    },
    RestartGateway,
    /// 连着远程、连不上时：马上再连一次
    RetryConnection,
    /// 切到这个连接。本机直接切；远程要先试连、确认，在主界面里做
    SwitchConnection(String),
    CheckUpdates,
    InstallUpdate,
    Quit,
}

/// 数字和标识染什么颜色
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Tone {
    #[default]
    Normal,
    /// 额度紧张
    Warn,
    /// 额度用完
    Full,
}

/// 菜单栏上的那一块
#[derive(Debug, Clone, PartialEq)]
pub struct Bar {
    pub style: Style,
    /// 上面一行今日 token，下面一行今日费用。**None 画成两道破折号**：还不知道
    pub numbers: Option<(String, String)>,
    pub tone: Tone,
    /// 正在启动，或者不在运行
    pub dim: bool,
    /// 有请求在跑
    pub dot: bool,
    /// 不在运行：红色角标（仅数值时破折号变红）
    pub alert: bool,
    /// 悬停提示，旁白读的也是它
    pub tooltip: String,
}

/// 状态头右上角那个点的颜色
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateTone {
    Ok,
    Busy,
    Warn,
    Bad,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WindowRow {
    pub label: String,
    /// None：重置时刻已经过了，手上的百分比不再是现状，不画条
    pub percent: Option<f64>,
    pub reset: String,
    pub tone: Tone,
    /// 条下面那一行小字：积分制套餐的窗口还剩多少积分（「剩余 1,976 / 2,000 积分」）。
    /// 别的窗口、已经重置过的窗口没有
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatCell {
    pub value: String,
    pub label: String,
    /// 标签旁的橙色小字（失败数）
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubItem {
    pub title: String,
    pub checked: bool,
    pub action: Action,
    /// 前面隔一条线
    pub sep_before: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    /// 稳定的名字：菜单开着时按它就地更新，不重建
    pub id: String,
    /// SF Symbol
    pub icon: Option<&'static str>,
    pub title: String,
    /// 标题右边的淡色文字
    pub right: Option<String>,
    pub enabled: bool,
    pub action: Option<Action>,
    /// 菜单开着时的快捷键（`,`、`q`），配 ⌘
    pub key: Option<&'static str>,
    pub submenu: Vec<SubItem>,
    /// 图标用强调色（有新版本）
    pub accent: bool,
}

impl Item {
    fn new(id: &str, icon: &'static str, title: impl Into<String>, action: Action) -> Self {
        Self {
            id: id.to_string(),
            icon: Some(icon),
            title: title.into(),
            right: None,
            enabled: true,
            action: Some(action),
            key: None,
            submenu: Vec::new(),
            accent: false,
        }
    }
    fn right(mut self, right: impl Into<String>) -> Self {
        self.right = Some(right.into());
        self
    }
    fn key(mut self, key: &'static str) -> Self {
        self.key = Some(key);
        self
    }
    fn disabled(mut self) -> Self {
        self.enabled = false;
        self
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Row {
    Header {
        title: String,
        state: String,
        tone: StateTone,
        line2: String,
        /// 第二行说的是一件要处理的事（监听没换成、安全模式）
        line2_warn: bool,
    },
    Separator,
    Section {
        title: String,
        right: Option<String>,
    },
    Notice {
        level: Level,
        title: String,
        body: String,
        action: Action,
    },
    Quota {
        provider: String,
        windows: Vec<WindowRow>,
        action: Action,
    },
    Stats {
        cells: Vec<StatCell>,
        action: Action,
    },
    Live {
        app: String,
        model: String,
        elapsed: String,
        action: Action,
    },
    Item(Item),
}

impl Row {
    /// 行的样子：种类加稳定的名字。**样子没变就就地改**，变了才重建菜单
    pub fn shape(&self) -> String {
        match self {
            Row::Header { .. } => "header".into(),
            Row::Separator => "sep".into(),
            Row::Section { title, .. } => format!("section:{title}"),
            Row::Notice { action, .. } => format!("notice:{action:?}"),
            // 带小字的窗口高一截：哪几个窗口带着小字也是样子的一部分
            Row::Quota {
                provider, windows, ..
            } => format!(
                "quota:{provider}:{}",
                windows
                    .iter()
                    .map(|w| if w.detail.is_some() { '+' } else { '-' })
                    .collect::<String>()
            ),
            Row::Stats { cells, .. } => format!("stats:{}", cells.len()),
            Row::Live { action, .. } => format!("live:{action:?}"),
            Row::Item(i) => format!("item:{}:{}", i.id, i.submenu.len()),
        }
    }
}

/// 最多列几条提醒。再多就是一张清单了，那该去主界面看
pub const MAX_NOTICES: usize = 3;
/// 最多列几个进行中的请求
pub const MAX_LIVE: usize = 5;
/// 额度用到多少开始在菜单栏上变橙。**上游说快到了的，不管用了多少都算**
pub const WARN_PERCENT: f64 = 90.0;
/// 菜单里的额度条从多少开始变橙
pub const BAR_WARN_PERCENT: f64 = 80.0;

/// 照着快照定下菜单栏和菜单。
pub fn build(s: &Snapshot, style: Style) -> (Bar, Vec<Row>) {
    (bar(s, style), rows(s))
}

fn bar(s: &Snapshot, style: Style) -> Bar {
    let running = s.gateway.running();
    let tight = tightest(s);
    Bar {
        style,
        numbers: if running {
            s.today
                .as_ref()
                .map(|t| (tokens_short(t.tokens), cost_short(t.cost_micros)))
        } else {
            // 不在运行时，上一次的数字已经不代表现在：画破折号，不画一个凝固的旧值
            None
        },
        tone: if running {
            tight.map(|(_, w)| bar_tone(w)).unwrap_or_default()
        } else {
            Tone::Normal
        },
        dim: !running,
        dot: running && !s.live.is_empty(),
        alert: !running && !matches!(s.gateway, Gateway::Starting),
        tooltip: tooltip(s, tight),
    }
}

/// 还在当前的窗口里最紧张的那个。**过了重置时刻的不算**：手上的百分比是重置
/// 之前的，下一个请求才会带来新的
fn tightest(s: &Snapshot) -> Option<(&str, &Window)> {
    s.quotas
        .iter()
        .flat_map(|q| q.windows.iter().map(move |w| (q.provider.as_str(), w)))
        .filter(|(_, w)| current(w, s.now_ms))
        .max_by(|a, b| a.1.used_percent.total_cmp(&b.1.used_percent))
}

fn current(w: &Window, now_ms: u64) -> bool {
    w.resets_at_ms.is_none_or(|at| at > now_ms)
}

fn exhausted(w: &Window) -> bool {
    w.status.as_deref() == Some("rejected") || w.used_percent >= 100.0
}

fn bar_tone(w: &Window) -> Tone {
    if exhausted(w) {
        Tone::Full
    } else if w.status.as_deref() == Some("allowed_warning") || w.used_percent >= WARN_PERCENT {
        Tone::Warn
    } else {
        Tone::Normal
    }
}

fn window_tone(w: &Window) -> Tone {
    if exhausted(w) {
        Tone::Full
    } else if w.used_percent >= BAR_WARN_PERCENT {
        Tone::Warn
    } else {
        Tone::Normal
    }
}

fn tooltip(s: &Snapshot, tight: Option<(&str, &Window)>) -> String {
    let mut parts = vec![
        "ThinkWatch Lite".to_string(),
        state_text(&s.gateway).to_string(),
    ];
    if s.gateway.running() {
        if let Some(t) = &s.today {
            parts.push(tr!(
                format!(
                    "今日 {} token，费用 {}",
                    tokens_short(t.tokens),
                    cost_long(t.cost_micros)
                ),
                format!(
                    "{} tokens today, {} cost",
                    tokens_short(t.tokens),
                    cost_long(t.cost_micros)
                )
            ));
        }
        if let Some((provider, w)) = tight {
            let percent = w.used_percent.round() as i64;
            parts.push(tr!(
                format!("{provider} {}额度已用 {percent}%", window_label(&w.window)),
                format!(
                    "{percent}% of the {} limit used on {provider}",
                    window_label(&w.window)
                )
            ));
        }
        if !s.live.is_empty() {
            parts.push(live_count(s.live.len()));
        }
    }
    parts.join(tr!("，", ", "))
}

fn state_text(g: &Gateway) -> &'static str {
    match g {
        Gateway::Starting => tr!("正在启动", "Starting"),
        Gateway::Running => tr!("运行中", "Running"),
        Gateway::SafeMode => tr!("未在转发", "Not Forwarding"),
        Gateway::Failed => tr!("无法启动", "Cannot Start"),
        Gateway::Stopped => tr!("未运行", "Not Running"),
        Gateway::Unlinked => tr!("未连接", "Not Connected"),
    }
}

fn live_count(n: usize) -> String {
    tr!(
        format!("{n} 个请求进行中"),
        if n == 1 {
            "1 request in progress".to_string()
        } else {
            format!("{n} requests in progress")
        }
    )
}

fn rows(s: &Snapshot) -> Vec<Row> {
    let mut out = vec![header(s), Row::Separator];
    if !s.gateway.running() {
        if s.gateway == Gateway::Unlinked {
            out.push(Row::Item(Item::new(
                "retry",
                "arrow.clockwise",
                tr!("立即重试", "Retry Now"),
                Action::RetryConnection,
            )));
            out.push(Row::Item(Item::new(
                "why",
                "info.circle",
                tr!("查看原因…", "Show Details…"),
                Action::OpenMain,
            )));
            out.push(Row::Separator);
        } else if !matches!(s.gateway, Gateway::Starting) {
            out.push(Row::Item(Item::new(
                "restart",
                "arrow.clockwise",
                tr!("重新启动网关", "Restart Gateway"),
                Action::RestartGateway,
            )));
            out.push(Row::Item(Item::new(
                "why",
                "info.circle",
                tr!("查看原因…", "Show Details…"),
                Action::OpenMain,
            )));
            out.push(Row::Separator);
        }
        app_items(s, &mut out);
        return out;
    }

    if s.notices_on && !s.notices.is_empty() {
        out.push(section(tr!("提醒", "Notices"), None));
        for n in s.notices.iter().take(MAX_NOTICES) {
            out.push(Row::Notice {
                level: n.level,
                title: n.title.clone(),
                body: n.body.clone(),
                action: Action::OpenNotice(n.key.clone()),
            });
        }
        if s.notices.len() > MAX_NOTICES {
            out.push(Row::Item(Item::new(
                "all-notices",
                "bell",
                tr!(
                    format!("全部提醒（{}）…", s.notices.len()),
                    format!("All Notices ({})…", s.notices.len())
                ),
                Action::AllNotices,
            )));
        }
        out.push(Row::Separator);
    }

    let quotas: Vec<&Quota> = s.quotas.iter().filter(|q| !q.windows.is_empty()).collect();
    if !quotas.is_empty() {
        out.push(section(tr!("额度", "Quota"), None));
        for q in quotas {
            out.push(Row::Quota {
                provider: q.provider.clone(),
                windows: q.windows.iter().map(|w| window_row(w, s.now_ms)).collect(),
                action: Action::Open("upstreams"),
            });
            let used_up = q
                .windows
                .iter()
                .any(|w| current(w, s.now_ms) && exhausted(w));
            if let Some(n) = q.reset_credits.filter(|n| used_up && *n > 0) {
                out.push(Row::Item(
                    Item::new(
                        &format!("resets:{}", q.provider),
                        "arrow.counterclockwise.circle",
                        tr!("额度重置卡…", "Quota Reset Credits…"),
                        Action::Open("upstreams"),
                    )
                    .right(tr!(format!("可用 {n} 张"), format!("{n} available"))),
                ));
            }
        }
        out.push(Row::Separator);
    }

    if let Some(t) = &s.today {
        out.push(section(tr!("今日", "Today"), None));
        out.push(Row::Stats {
            cells: vec![
                StatCell {
                    value: grouped(t.requests),
                    label: tr!("请求", "Requests").to_string(),
                    note: (t.failed > 0)
                        .then(|| tr!(format!("失败 {}", t.failed), format!("{} failed", t.failed))),
                },
                StatCell {
                    value: tokens_short(t.tokens),
                    label: tr!("token", "Tokens").to_string(),
                    note: None,
                },
                StatCell {
                    value: cost_long(t.cost_micros),
                    label: tr!("费用", "Cost").to_string(),
                    note: None,
                },
            ],
            action: Action::Open("dashboard"),
        });
        out.push(Row::Separator);
    }

    if !s.live.is_empty() {
        out.push(section(
            tr!("进行中", "In Progress"),
            Some(s.live.len().to_string()),
        ));
        for l in s.live.iter().take(MAX_LIVE) {
            out.push(Row::Live {
                app: l
                    .app
                    .as_deref()
                    .map(app_label)
                    .unwrap_or(&l.key)
                    .to_string(),
                model: l.model.clone(),
                elapsed: elapsed(s.now_ms.saturating_sub(l.started_ms)),
                action: Action::OpenRequest(l.id),
            });
        }
        if s.live.len() > MAX_LIVE {
            let more = s.live.len() - MAX_LIVE;
            out.push(Row::Item(Item {
                icon: None,
                ..Item::new(
                    "live-more",
                    "",
                    tr!(format!("另有 {more} 个"), format!("{more} more")),
                    Action::Open("requests"),
                )
            }));
        }
        out.push(Row::Separator);
    }

    for g in &s.groups {
        let mut item = Item::new(
            &format!("group:{}", g.name),
            "arrow.left.arrow.right",
            g.name.clone(),
            Action::OpenMain,
        );
        item.action = None;
        item.right = g.selected.clone();
        item.submenu = g
            .members
            .iter()
            .map(|m| SubItem {
                title: m.clone(),
                checked: g.selected.as_deref() == Some(m),
                action: Action::SelectGroup {
                    group: g.name.clone(),
                    provider: m.clone(),
                },
                sep_before: false,
            })
            .collect();
        out.push(Row::Item(item));
    }
    let copy = Item::new(
        "copy-address",
        "doc.on.doc",
        tr!("复制网关地址", "Copy Gateway Address"),
        Action::CopyAddress,
    );
    out.push(Row::Item(if s.addr.is_some() {
        copy
    } else {
        copy.disabled()
    }));
    out.push(Row::Item(Item::new(
        "copy-key",
        "key",
        tr!("复制默认密钥", "Copy Default Key"),
        Action::CopyKey,
    )));
    let undo = Item::new(
        "undo",
        "arrow.uturn.backward",
        tr!("撤销上一次配置修改", "Undo Last Configuration Change"),
        Action::Undo,
    );
    // **没得撤就是灰的，不是不显示。**一个时有时无的菜单项，用户每次都要重新找
    out.push(Row::Item(match s.undo_at_ms {
        Some(at) => undo.right(clock(at, s.now_ms)),
        None => undo.disabled(),
    }));
    out.push(Row::Separator);
    app_items(s, &mut out);
    out
}

fn header(s: &Snapshot) -> Row {
    let (tone, line2, line2_warn) = match &s.gateway {
        Gateway::Running => match &s.listen_error {
            Some(why) => (StateTone::Ok, why.clone(), true),
            None => {
                let addr = s.addr.clone().unwrap_or_else(|| "—".to_string());
                let line = match s.rate {
                    Some(r) => tr!(format!("{addr} · {r} token/秒"), format!("{addr} · {r} tokens/s")),
                    None => addr,
                };
                (StateTone::Ok, line, false)
            }
        },
        Gateway::Starting => (StateTone::Busy, s.addr.clone().unwrap_or_default(), false),
        Gateway::SafeMode => (
            StateTone::Warn,
            tr!(
                "已连续启动失败，当前只有配置和历史可用。",
                "Startup failed several times in a row. Only configuration and history are available."
            )
            .to_string(),
            true,
        ),
        Gateway::Failed => (
            StateTone::Bad,
            tr!(
                "core 程序未能运行，转发已停止。",
                "The core program could not run, so forwarding has stopped."
            )
            .to_string(),
            true,
        ),
        Gateway::Stopped => (
            StateTone::Bad,
            tr!("转发已停止。", "Forwarding has stopped.").to_string(),
            true,
        ),
        Gateway::Unlinked => (
            StateTone::Bad,
            tr!("正在重新连接。", "Reconnecting.").to_string(),
            true,
        ),
    };
    Row::Header {
        // 连着远程时写服务器的名字：菜单里的数字、提醒都是那台的
        title: s
            .remote
            .clone()
            .unwrap_or_else(|| "ThinkWatch Lite".to_string()),
        state: state_text(&s.gateway).to_string(),
        tone,
        line2,
        line2_warn,
    }
}

fn section(title: &str, right: Option<String>) -> Row {
    Row::Section {
        title: title.to_string(),
        right,
    }
}

fn app_items(s: &Snapshot, out: &mut Vec<Row>) {
    out.push(Row::Item(Item::new(
        "open",
        "macwindow",
        tr!("打开主界面", "Open ThinkWatch Lite"),
        Action::OpenMain,
    )));
    out.push(Row::Item(connections(s)));
    out.push(Row::Item(
        Item::new(
            "settings",
            "gearshape",
            tr!("设置…", "Settings…"),
            Action::Settings,
        )
        .key(","),
    ));
    out.push(Row::Item(match &s.update {
        Some(v) => Item {
            accent: true,
            ..Item::new(
                "update",
                "arrow.down.circle",
                tr!(format!("安装新版本 {v}…"), format!("Install Version {v}…")),
                Action::InstallUpdate,
            )
        },
        None => Item::new(
            "update",
            "arrow.down.circle",
            tr!("检查更新…", "Check for Updates…"),
            Action::CheckUpdates,
        ),
    }));
    out.push(Row::Separator);
    out.push(Row::Item(
        Item::new(
            "quit",
            "power",
            tr!("退出 ThinkWatch Lite…", "Quit ThinkWatch Lite…"),
            Action::Quit,
        )
        .key("q"),
    ));
}

/// 「连接」子菜单：主窗口关着也能切。**本机永远在第一个**，任何状态下一步就能切回来
fn connections(s: &Snapshot) -> Item {
    let mut item = Item::new(
        "connections",
        "network",
        tr!("连接", "Connection"),
        Action::OpenMain,
    );
    item.action = None;
    let mut subs: Vec<SubItem> = s
        .connections
        .iter()
        .map(|c| SubItem {
            title: c.name.clone(),
            checked: c.current,
            action: Action::SwitchConnection(c.id.clone()),
            sep_before: false,
        })
        .collect();
    subs.push(SubItem {
        title: tr!("管理连接…", "Manage Connections…").to_string(),
        checked: false,
        action: Action::Settings,
        sep_before: true,
    });
    item.submenu = subs;
    item
}

fn window_row(w: &Window, now_ms: u64) -> WindowRow {
    if !current(w, now_ms) {
        // 剩多少也是重置之前的数，和百分比一起不再作数
        return WindowRow {
            label: window_label(&w.window),
            percent: None,
            reset: tr!("已重置", "Reset").to_string(),
            tone: Tone::Normal,
            detail: None,
        };
    }
    WindowRow {
        label: window_label(&w.window),
        percent: Some(w.used_percent.clamp(0.0, 100.0)),
        reset: match w.resets_at_ms {
            Some(at) => resets_in((at - now_ms) / 1000),
            None => String::new(),
        },
        tone: window_tone(w),
        detail: w.credits.map(credits_left),
    }
}

/// 窗口名，和上游页同一套写法
pub fn window_label(window: &str) -> String {
    match window {
        "5h" => tr!("5 小时", "5h").to_string(),
        "7d" => tr!("7 天", "7d").to_string(),
        "weekly" => tr!("每周", "Weekly").to_string(),
        other => other.to_string(),
    }
}

/// 积分制套餐的窗口还剩多少积分：「剩余 1,976 / 2,000 积分」，和上游页同一个写法。
/// 剩余照上游说的写，不拿总额减已用去算
fn credits_left(c: QuotaCredits) -> String {
    let (left, total) = (count(c.remaining), count(c.total));
    tr!(
        format!("剩余 {left} / {total} 积分"),
        format!("{left} / {total} credits left")
    )
}

/// 积分：取整、千分位。上游给的是小数时差的不到一个，不值得占位置
fn count(n: f64) -> String {
    grouped(n.max(0.0).round() as i64)
}

/// 多久之后重置。**只给一个量级**，和上游页的写法一样：读它是为了知道今天还够
/// 不够用，不是为了对表
pub fn resets_in(secs: u64) -> String {
    let (zh, en) = if secs == 0 {
        ("刚刚".to_string(), "now".to_string())
    } else if secs < 60 {
        ("1 分钟内".to_string(), "within 1 min".to_string())
    } else if secs < 3600 {
        let m = (secs as f64 / 60.0).round() as u64;
        (format!("{m} 分钟后"), format!("in {m} min"))
    } else if secs < 86_400 {
        let h = (secs as f64 / 3600.0).round() as u64;
        (format!("{h} 小时后"), format!("in {h} h"))
    } else {
        let d = (secs as f64 / 86_400.0).round() as u64;
        (
            format!("{d} 天后"),
            if d == 1 {
                "in 1 day".to_string()
            } else {
                format!("in {d} days")
            },
        )
    };
    tr!(format!("{zh}重置"), format!("Resets {en}"))
}

/// 菜单栏上的 token 数，和概览的写法一样：`845`、`9.8k`、`123k`、`3.1M`
pub fn tokens_short(n: i64) -> String {
    let n = n.max(0);
    if n < 1_000 {
        n.to_string()
    } else if n < 10_000 {
        format!("{:.1}k", n as f64 / 1_000.0)
    } else if n < 1_000_000 {
        format!("{}k", (n as f64 / 1_000.0).round() as i64)
    } else if n < 1_000_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else {
        format!("{:.1}B", n as f64 / 1_000_000_000.0)
    }
}

/// 菜单栏上的费用。**位数少才放得下**：满 $100 去掉小数，满 $1000 写成 k
pub fn cost_short(micros: i64) -> String {
    let d = micros.max(0) as f64 / 1_000_000.0;
    if d < 100.0 {
        format!("${d:.2}")
    } else if d < 1_000.0 {
        format!("${d:.0}")
    } else if d < 10_000.0 {
        format!("${:.1}k", d / 1_000.0)
    } else {
        format!("${:.0}k", d / 1_000.0)
    }
}

/// 菜单里的费用：地方够，满 $1000 之前都写到分
pub fn cost_long(micros: i64) -> String {
    let d = micros.max(0) as f64 / 1_000_000.0;
    if d < 1_000.0 {
        format!("${d:.2}")
    } else {
        format!("${}", grouped(d.round() as i64))
    }
}

/// 千分位
pub fn grouped(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    if n < 0 { format!("-{out}") } else { out }
}

/// 进行中的请求已经跑了多久：`0:42`、`12:05`、`1:03:20`
pub fn elapsed(ms: u64) -> String {
    let s = ms / 1000;
    let (h, m, s) = (s / 3600, s / 60 % 60, s % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

/// 请求头认出来的应用，和流量页同一张表
pub fn app_label(hint: &str) -> &str {
    match hint {
        "claude-code" => "Claude Code",
        "claude-desktop" => "Claude Desktop",
        "codex" => "Codex",
        "cursor" => "Cursor",
        "opencode" => "opencode",
        "aider" => "Aider",
        "zed" => "Zed",
        "continue" => "Continue",
        "antigravity-cli" => "Antigravity CLI",
        other => other,
    }
}

/// 上一版配置是什么时候的：今天的写时刻，更早的写日期
fn clock(at_ms: u64, now_ms: u64) -> String {
    let (at, now) = (local(at_ms), local(now_ms));
    if (at.0, at.1, at.2) == (now.0, now.1, now.2) {
        format!("{:02}:{:02}", at.3, at.4)
    } else {
        tr!(
            format!("{}月{}日", at.1, at.2),
            format!("{:02}-{:02}", at.1, at.2)
        )
    }
}

/// 一个时间戳在本地时区里的那个 `tm`。
///
/// **两个平台的名字和参数顺序都不一样**：POSIX 是 `localtime_r(&t, &mut tm)`，
/// MSVC 是 `localtime_s(&mut tm, &t)` —— 参数反过来。写反了不会编译失败，
/// 只会让日期错得离谱，所以两支各写一遍，谁也别去"复用"谁。
#[cfg(unix)]
fn to_local(secs: libc::time_t) -> libc::tm {
    // SAFETY: localtime_r 只写进我们给的那一块 tm
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::localtime_r(&secs, &mut tm) };
    tm
}

#[cfg(windows)]
fn to_local(secs: libc::time_t) -> libc::tm {
    // SAFETY: localtime_s 只写进我们给的那一块 tm。它失败时把 tm 清零，
    // 那给出的是 1900-01-01 —— 一个一眼看得出不对的日期，而不是一个
    // 错得像真的的日期。
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::localtime_s(&mut tm, &secs) };
    tm
}

/// 本地时间的（年, 月, 日, 时, 分）
pub(crate) fn local(ms: u64) -> (i32, u32, u32, u32, u32) {
    let secs = (ms / 1000) as libc::time_t;
    let tm = to_local(secs);
    (
        tm.tm_year + 1900,
        (tm.tm_mon + 1) as u32,
        tm.tm_mday as u32,
        tm.tm_hour as u32,
        tm.tm_min as u32,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::{Lang, with_lang};

    const NOW: u64 = 1_800_000_000_000;

    fn running() -> Snapshot {
        Snapshot {
            gateway: Gateway::Running,
            addr: Some("127.0.0.1:18790".into()),
            today: Some(Today {
                requests: 186,
                failed: 0,
                tokens: 3_100_000,
                cost_micros: 41_200_000,
            }),
            notices_on: true,
            now_ms: NOW,
            ..Default::default()
        }
    }

    fn window(window: &str, used: f64, reset_in_ms: u64) -> Window {
        Window {
            window: window.into(),
            used_percent: used,
            resets_at_ms: Some(NOW + reset_in_ms),
            status: None,
            credits: None,
        }
    }

    fn items(rows: &[Row]) -> Vec<&Item> {
        rows.iter()
            .filter_map(|r| match r {
                Row::Item(i) => Some(i),
                _ => None,
            })
            .collect()
    }

    fn item<'a>(rows: &'a [Row], id: &str) -> Option<&'a Item> {
        items(rows).into_iter().find(|i| i.id == id)
    }

    #[test]
    fn the_bar_shows_todays_tokens_over_todays_cost() {
        let (bar, _) = build(&running(), Style::Full);
        assert_eq!(bar.numbers, Some(("3.1M".into(), "$41.20".into())));
        assert!(!bar.dim && !bar.alert && !bar.dot);
    }

    #[test]
    fn an_unknown_day_is_two_dashes_and_a_quiet_day_is_zero() {
        // 0 是一个值，破折号不是：问到了、今天还没有请求，就写 0
        let mut s = running();
        s.today = None;
        assert_eq!(build(&s, Style::Full).0.numbers, None);
        s.today = Some(Today::default());
        assert_eq!(
            build(&s, Style::Full).0.numbers,
            Some(("0".into(), "$0.00".into()))
        );
    }

    #[test]
    fn numbers_are_written_the_way_the_overview_writes_them() {
        for (n, want) in [
            (0, "0"),
            (845, "845"),
            (9_800, "9.8k"),
            (123_400, "123k"),
            (3_100_000, "3.1M"),
            (1_240_000_000, "1.2B"),
        ] {
            assert_eq!(tokens_short(n), want, "{n}");
        }
        for (micros, want) in [
            (0, "$0.00"),
            (3_420_000, "$3.42"),
            (99_990_000, "$99.99"),
            (123_400_000, "$123"),
            (1_234_000_000, "$1.2k"),
            (12_345_000_000, "$12k"),
        ] {
            assert_eq!(cost_short(micros), want, "{micros}");
        }
        assert_eq!(cost_long(1_234_567_000_000), "$1,234,567");
        assert_eq!(grouped(1234), "1,234");
        assert_eq!(elapsed(102_000), "1:42");
        assert_eq!(elapsed(3_800_000), "1:03:20");
    }

    #[test]
    fn a_tight_quota_turns_the_numbers_orange_and_a_used_up_one_red() {
        let mut s = running();
        s.quotas = vec![Quota {
            provider: "chatgpt".into(),
            windows: vec![
                window("5h", 42.0, 3_600_000),
                window("weekly", 18.0, 86_400_000),
            ],
            reset_credits: None,
        }];
        assert_eq!(build(&s, Style::Full).0.tone, Tone::Normal);
        s.quotas[0].windows[0].used_percent = 91.0;
        assert_eq!(build(&s, Style::Full).0.tone, Tone::Warn);
        // 上游说快到了的，不管用了多少都算
        s.quotas[0].windows[0].used_percent = 50.0;
        s.quotas[0].windows[0].status = Some("allowed_warning".into());
        assert_eq!(build(&s, Style::Full).0.tone, Tone::Warn);
        s.quotas[0].windows[0].status = Some("rejected".into());
        assert_eq!(build(&s, Style::Full).0.tone, Tone::Full);
    }

    #[test]
    fn a_window_past_its_reset_is_not_the_current_state() {
        let mut s = running();
        s.quotas = vec![Quota {
            provider: "chatgpt".into(),
            windows: vec![Window {
                window: "5h".into(),
                used_percent: 100.0,
                resets_at_ms: Some(NOW - 1),
                status: Some("rejected".into()),
                credits: None,
            }],
            reset_credits: Some(2),
        }];
        let (bar, rows) = build(&s, Style::Full);
        assert_eq!(bar.tone, Tone::Normal, "已经重置过的窗口还在让菜单栏变红");
        let Some(Row::Quota { windows, .. }) = rows.iter().find(|r| matches!(r, Row::Quota { .. }))
        else {
            panic!("额度那一块不见了");
        };
        assert_eq!(windows[0].percent, None, "重置过的窗口还在画条");
        assert_eq!(windows[0].reset, "已重置");
        assert!(
            item(&rows, "resets:chatgpt").is_none(),
            "额度没用完却给了重置卡"
        );
    }

    #[test]
    fn a_used_up_quota_offers_the_reset_credits_only_when_there_are_some() {
        let mut s = running();
        s.quotas = vec![Quota {
            provider: "chatgpt".into(),
            windows: vec![Window {
                status: Some("rejected".into()),
                ..window("5h", 100.0, 42 * 60_000)
            }],
            reset_credits: Some(2),
        }];
        let (_, rows) = build(&s, Style::Full);
        let credits = item(&rows, "resets:chatgpt").expect("用完了、也有卡，却没给入口");
        assert_eq!(credits.right.as_deref(), Some("可用 2 张"));
        assert_eq!(
            credits.action,
            Some(Action::Open("upstreams")),
            "菜单里不直接用卡"
        );
        s.quotas[0].reset_credits = Some(0);
        assert!(item(&build(&s, Style::Full).1, "resets:chatgpt").is_none());
    }

    #[test]
    fn quota_bars_turn_orange_at_eighty_percent() {
        let mut s = running();
        s.quotas = vec![Quota {
            provider: "chatgpt".into(),
            windows: vec![
                window("5h", 79.0, 3_600_000),
                window("weekly", 80.0, 86_400_000),
            ],
            reset_credits: None,
        }];
        let rows = rows(&s);
        let Some(Row::Quota { windows, .. }) = rows.iter().find(|r| matches!(r, Row::Quota { .. }))
        else {
            panic!();
        };
        assert_eq!(
            (windows[0].tone, windows[1].tone),
            (Tone::Normal, Tone::Warn)
        );
        assert_eq!(windows[0].label, "5 小时");
        assert_eq!(windows[0].reset, "1 小时后重置");
        assert_eq!(windows[1].label, "每周");
    }

    #[test]
    fn requests_in_progress_put_a_dot_on_the_mark_and_list_at_most_five() {
        let mut s = running();
        s.live = (1..=7)
            .map(|i| Live {
                id: i,
                app: (i == 1).then(|| "codex".to_string()),
                key: "default".into(),
                model: "gpt-5-codex".into(),
                started_ms: NOW - 102_000,
            })
            .collect();
        let (bar, rows) = build(&s, Style::Full);
        assert!(bar.dot);
        let live: Vec<_> = rows
            .iter()
            .filter_map(|r| match r {
                Row::Live { app, elapsed, .. } => Some((app.as_str(), elapsed.as_str())),
                _ => None,
            })
            .collect();
        assert_eq!(live.len(), MAX_LIVE);
        assert_eq!(live[0], ("Codex", "1:42"));
        // 认不出应用的用密钥名
        assert_eq!(live[1].0, "default");
        assert_eq!(item(&rows, "live-more").unwrap().title, "另有 2 个");
    }

    #[test]
    fn notices_come_first_and_stop_at_three() {
        let mut s = running();
        s.notices = (0..4)
            .map(|i| NoticeLine {
                key: format!("k{i}"),
                level: Level::Warning,
                title: format!("t{i}"),
                body: "b".into(),
            })
            .collect();
        let rows = rows(&s);
        // 状态头、分隔线之后就是提醒
        assert!(matches!(&rows[2], Row::Section { title, .. } if title == "提醒"));
        let shown = rows
            .iter()
            .filter(|r| matches!(r, Row::Notice { .. }))
            .count();
        assert_eq!(shown, MAX_NOTICES);
        assert_eq!(item(&rows, "all-notices").unwrap().title, "全部提醒（4）…");
        // 提醒关掉了，这一节就不出现
        s.notices_on = false;
        assert!(
            !super::rows(&s)
                .iter()
                .any(|r| matches!(r, Row::Notice { .. }))
        );
    }

    #[test]
    fn a_gateway_that_is_not_running_says_why_and_offers_a_restart() {
        let mut s = running();
        s.gateway = Gateway::Failed;
        s.live = vec![Live::default()];
        let (bar, rows) = build(&s, Style::Full);
        assert_eq!(bar.numbers, None, "不在运行时还显示一个凝固的旧数字");
        assert!(bar.dim && bar.alert && !bar.dot);
        assert!(
            matches!(&rows[0], Row::Header { state, tone: StateTone::Bad, .. } if state == "无法启动")
        );
        assert_eq!(
            item(&rows, "restart").unwrap().action,
            Some(Action::RestartGateway)
        );
        assert!(
            !rows
                .iter()
                .any(|r| matches!(r, Row::Stats { .. } | Row::Live { .. }))
        );
        // 正在启动时没有什么可重启的，也不画红色角标
        s.gateway = Gateway::Starting;
        let (bar, rows) = build(&s, Style::Full);
        assert!(bar.dim && !bar.alert);
        assert!(item(&rows, "restart").is_none());
    }

    #[test]
    fn a_listen_setting_that_did_not_take_replaces_the_address_line() {
        let mut s = running();
        s.rate = Some(52);
        let Row::Header {
            line2, line2_warn, ..
        } = &rows(&s)[0]
        else {
            panic!()
        };
        assert_eq!(
            (line2.as_str(), *line2_warn),
            ("127.0.0.1:18790 · 52 token/秒", false)
        );
        s.listen_error = Some("端口 18790 已被占用。".into());
        let Row::Header {
            line2, line2_warn, ..
        } = &rows(&s)[0]
        else {
            panic!()
        };
        assert_eq!(
            (line2.as_str(), *line2_warn),
            ("端口 18790 已被占用。", true)
        );
    }

    #[test]
    fn nothing_to_undo_is_grey_not_gone_and_a_new_version_replaces_the_check() {
        let mut s = running();
        let rows1 = rows(&s);
        let undo = item(&rows1, "undo").expect("撤销那一项不见了");
        assert!(!undo.enabled);
        assert_eq!(
            item(&rows1, "update").unwrap().action,
            Some(Action::CheckUpdates)
        );
        s.undo_at_ms = Some(NOW - 60_000);
        s.update = Some("2026.9.8".into());
        let rows2 = rows(&s);
        assert!(item(&rows2, "undo").unwrap().enabled);
        let update = item(&rows2, "update").unwrap();
        assert_eq!(update.title, "安装新版本 2026.9.8…");
        assert!(update.accent);
    }

    #[test]
    fn a_select_group_is_a_submenu_with_the_current_member_checked() {
        let mut s = running();
        s.groups = vec![Group {
            name: "主力".into(),
            members: vec!["chatgpt".into(), "openai".into()],
            selected: Some("chatgpt".into()),
        }];
        let rows = rows(&s);
        let g = item(&rows, "group:主力").unwrap();
        assert_eq!(g.right.as_deref(), Some("chatgpt"));
        assert_eq!(
            g.submenu.iter().map(|m| m.checked).collect::<Vec<_>>(),
            [true, false]
        );
        assert_eq!(
            g.submenu[1].action,
            Action::SelectGroup {
                group: "主力".into(),
                provider: "openai".into()
            }
        );
    }

    #[test]
    fn the_menu_follows_the_interface_language() {
        with_lang(Lang::En, || {
            let mut s = running();
            s.quotas = vec![Quota {
                provider: "chatgpt".into(),
                windows: vec![window("weekly", 18.0, 4 * 86_400_000)],
                reset_credits: None,
            }];
            let rows = rows(&s);
            assert!(matches!(&rows[0], Row::Header { state, .. } if state == "Running"));
            let Some(Row::Quota { windows, .. }) =
                rows.iter().find(|r| matches!(r, Row::Quota { .. }))
            else {
                panic!()
            };
            assert_eq!(
                (windows[0].label.as_str(), windows[0].reset.as_str()),
                ("Weekly", "Resets in 4 days")
            );
            assert_eq!(item(&rows, "quit").unwrap().title, "Quit ThinkWatch Lite…");
            let (bar, _) = build(&s, Style::Full);
            assert!(
                bar.tooltip
                    .starts_with("ThinkWatch Lite, Running, 3.1M tokens today")
            );
        });
    }

    #[test]
    fn the_tooltip_says_the_whole_state_in_one_sentence() {
        let mut s = running();
        s.quotas = vec![Quota {
            provider: "chatgpt".into(),
            windows: vec![window("5h", 42.0, 3 * 3_600_000)],
            reset_credits: None,
        }];
        assert_eq!(
            build(&s, Style::Full).0.tooltip,
            "ThinkWatch Lite，运行中，今日 3.1M token，费用 $41.20，chatgpt 5 小时额度已用 42%"
        );
    }

    #[test]
    fn a_row_keeps_its_shape_while_only_its_text_changes() {
        // 菜单开着时，秒数、倒计时每秒在变 —— 那不该让菜单整个重建
        let mut s = running();
        s.live = vec![Live {
            id: 7,
            started_ms: NOW - 1_000,
            ..Default::default()
        }];
        let a: Vec<String> = rows(&s).iter().map(Row::shape).collect();
        s.now_ms += 5_000;
        let b: Vec<String> = rows(&s).iter().map(Row::shape).collect();
        assert_eq!(a, b);
    }

    /// GLM Coding Plan 积分制套餐：5 小时和每周两个窗口，各带总额、已用、剩余
    fn glm() -> Quota {
        let credits = |total: f64, used: f64, remaining: f64| {
            Some(QuotaCredits {
                total,
                used,
                remaining,
            })
        };
        Quota {
            provider: "glm".into(),
            windows: vec![
                Window {
                    credits: credits(2_000.0, 23.0, 1_976.0),
                    ..window("5h", 1.0, 3_600_000)
                },
                Window {
                    credits: credits(10_000.0, 268.0, 9_731.0),
                    ..window("weekly", 2.0, 3 * 86_400_000)
                },
            ],
            reset_credits: None,
        }
    }

    fn quota_rows(s: &Snapshot) -> Vec<WindowRow> {
        rows(s)
            .into_iter()
            .find_map(|r| match r {
                Row::Quota { windows, .. } => Some(windows),
                _ => None,
            })
            .expect("额度那一块不见了")
    }

    #[test]
    fn a_credit_plan_says_what_is_left_under_each_bar() {
        let mut s = running();
        s.quotas = vec![glm()];
        let w = quota_rows(&s);
        assert_eq!(w[0].label, "5 小时");
        // **剩余照上游说的写**：2000 − 23 是 1977，上游说的是 1976
        assert_eq!(w[0].detail.as_deref(), Some("剩余 1,976 / 2,000 积分"));
        assert_eq!(w[1].detail.as_deref(), Some("剩余 9,731 / 10,000 积分"));
        with_lang(Lang::En, || {
            assert_eq!(
                quota_rows(&s)[0].detail.as_deref(),
                Some("1,976 / 2,000 credits left")
            );
        });
        // 按百分比报的窗口没有这一行
        s.quotas[0].windows[0].credits = None;
        assert_eq!(quota_rows(&s)[0].detail, None);
    }

    #[test]
    fn what_was_left_before_a_reset_is_not_shown_after_it() {
        let mut s = running();
        s.quotas = vec![glm()];
        s.now_ms = NOW + 3_600_000;
        let w = quota_rows(&s);
        assert_eq!((w[0].percent, w[0].detail.as_deref()), (None, None));
        assert!(w[1].detail.is_some(), "没到重置时刻的窗口照常写");
    }

    #[test]
    fn a_line_under_a_bar_changes_the_shape_of_the_row() {
        // 带小字的窗口高一截：菜单开着时多了、少了这一行，要重建，不能就地改
        let mut s = running();
        s.quotas = vec![glm()];
        let shape = |s: &Snapshot| -> Vec<String> { rows(s).iter().map(Row::shape).collect() };
        let a = shape(&s);
        assert!(a.contains(&"quota:glm:++".to_string()), "{a:?}");
        s.quotas[0].windows[1].credits = None;
        assert!(shape(&s).contains(&"quota:glm:+-".to_string()));
        // 只是数变了：样子不变
        s.quotas[0].windows[0].credits = Some(QuotaCredits {
            total: 2_000.0,
            used: 500.0,
            remaining: 1_500.0,
        });
        assert!(shape(&s).contains(&"quota:glm:+-".to_string()));
    }
}
