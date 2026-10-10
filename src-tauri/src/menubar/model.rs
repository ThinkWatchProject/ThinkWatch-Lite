//! 菜单栏那一块和它的菜单要显示什么。
//!
//! **只有数据和文案，没有 AppKit。**macOS 把它画成原生菜单，别的平台画成托盘
//! 菜单；什么时候出现哪一节、数字怎么写、什么时候变色，都在这里定、在这里测。
//! 画的那一层只管照着画。

/// 菜单栏上显示什么。设置里的四档，出厂是标识和数值
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Style {
    #[default]
    Full,
    Icon,
    Numbers,
    /// 不显示：菜单栏上没有这一项。窗口关着时再打开一次应用，主窗口就回来了
    /// （`RunEvent::Reopen`，见 `lib.rs`）
    Hidden,
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
    /// 客户端该连的网关地址（主机:端口，`127.0.0.1:18790`），和「复制网关地址」复制的是同一个。
    /// 网关没在监听、问不到时是 None
    pub addr: Option<String>,
    /// 监听设置没换成的原因，已经是给人看的一句话。旧地址还在服务
    pub listen_error: Option<String>,
    /// 今天的用量。**没问到是 None，不是 0** —— 0 是一个值
    pub today: Option<Today>,
    /// 今天每个本地小时的 token，「今日」那一块右边的小柱子照它画。和 `today` 出自同一问，
    /// 同样是没问到就 None
    pub hourly: Option<Hourly>,
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
    /// 查到了、还没装的新版本
    pub update: Option<String>,
    /// 连接列表，本机在最前。「连接」子菜单照它列
    pub connections: Vec<Connection>,
    /// 连着远程时是那台服务器的名字。跟在状态后面写：菜单里的数字、提醒都是那台的
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
    /// 其中估算的那部分，微分
    pub estimated_micros: i64,
    /// 有用量、模型却不在价目表里的请求。**它们的费用不在 `cost_micros` 里**
    pub unpriced: i64,
    /// 没有拿到用量的请求：费用同样算不出来，也不在 `cost_micros` 里
    pub no_usage: i64,
}

impl Today {
    /// 费用写出来的样子，和界面上同一套记号：有算不出钱的请求时，金额只是下限
    /// （「≥」）；**估算不能冒充实测**，含估算的带「~」
    fn cost(&self, amount: fn(i64) -> String) -> String {
        let lower_bound = if self.unpriced + self.no_usage > 0 {
            "≥"
        } else {
            ""
        };
        let estimated = if self.estimated_micros > 0 { "~" } else { "" };
        format!("{lower_bound}{estimated}{}", amount(self.cost_micros))
    }

    /// 费用那一格旁边的小字：金额里缺着的请求，先说能补上的（配个价格）。含估算的
    /// 不在这里说，金额前面那个「~」就是界面上各处说估算的记号
    fn cost_note(&self) -> Option<String> {
        if self.unpriced > 0 {
            Some(tr!(
                format!("{} 条无法计价", self.unpriced),
                format!("{} unpriced", self.unpriced)
            ))
        } else if self.no_usage > 0 {
            Some(tr!(
                format!("{} 条无用量", self.no_usage),
                format!("{} with no usage", self.no_usage)
            ))
        } else {
            None
        }
    }
}

/// 一小时，毫秒
pub const HOUR_MS: i64 = 3_600_000;

/// 今天按本地小时分的 token：第 k 格是 `[零点 + k 小时, 零点 + k + 1 小时)`，和 core 分格的
/// 算法一样（从起点数，一格一个桶宽）
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Hourly {
    /// 今天的本地零点，Unix 毫秒
    pub from_ms: i64,
    /// 每一格的 token，铺满今天：一般 24 格，夏令时切换的那天 23 或 25 格。还没到的那几格是 0
    pub tokens: Vec<i64>,
}

/// 小柱子按多少 token 算满格，**至少这么多**：按当天最高的那一小时算满格的话，一天里只有
/// 一个零星的请求时，那一小时就是满满一格，看着像用得很凶。两万差不多是一轮带着上下文的
/// 编程助手对话
pub const SPARK_MIN_PEAK: i64 = 20_000;

/// 小柱子里的一根
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Spark {
    /// 这一小时没有用量，或者还没到：画一截淡淡的短线，不画成一根柱子
    Empty,
    /// 过去的一小时。高度是满格的几分之几（`0..=1`）
    Past(f64),
    /// 此刻所在的这一小时，颜色最重
    Now(f64),
}

/// 今天每小时的 token 画成几根小柱子。
///
/// **满格是当天最高的那一小时，但不低于 [`SPARK_MIN_PEAK`]。**哪一格是「此刻」按 `now_ms`
/// 现算：菜单开着时每秒重画一次，过了整点就挪到下一格，不用等下一次收数。时钟走在 core
/// 后面时（连着远程，那边快几分钟），「将来」的格子里也可能已经有数：那是真的数，照样画
fn spark(h: &Hourly, now_ms: u64) -> Vec<Spark> {
    let peak = h
        .tokens
        .iter()
        .copied()
        .max()
        .unwrap_or(0)
        .max(SPARK_MIN_PEAK) as f64;
    let now = (now_ms as i64 - h.from_ms).div_euclid(HOUR_MS);
    h.tokens
        .iter()
        .enumerate()
        .map(|(k, &t)| {
            let height = (t as f64 / peak).min(1.0);
            if t <= 0 {
                Spark::Empty
            } else if k as i64 == now {
                Spark::Now(height)
            } else {
                Spark::Past(height)
            }
        })
        .collect()
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
    /// 上游给的窗口名：`5h` / `weekly` / `30d`…，写法见 [`window_label`]
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

/// 数字和标识染什么颜色。**越往下越要紧**：比较的顺序就是这个顺序
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
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

/// 状态前面那个点的颜色
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
    /// None：重置时刻已经过了，手上的百分比不再是现状，条是空的
    pub percent: Option<f64>,
    pub reset: String,
    pub tone: Tone,
    /// 条下面那一行小字：积分制套餐的窗口还剩多少积分（「剩余 1,976 / 2,000 积分」）。
    /// 别的窗口、已经重置过的窗口没有
    pub detail: Option<String>,
}

impl WindowRow {
    /// 右边那一段：「31% · 4 天后重置」。重置过的只有「已重置」，不知道几时重置的只有百分比
    pub fn right(&self) -> String {
        match (self.percent, self.reset.is_empty()) {
            (Some(p), false) => format!("{}% · {}", p.round() as i64, self.reset),
            (Some(p), true) => format!("{}%", p.round() as i64),
            (None, _) => self.reset.clone(),
        }
    }

    /// 只能写一行字的地方（别的平台的托盘）：「chatgpt 每周 31% · 4 天后重置」，积分制套餐
    /// 的窗口在后面括上还剩多少
    pub fn line(&self, provider: &str) -> String {
        let line = format!("{provider} {} {}", self.label, self.right());
        match &self.detail {
            Some(d) => tr!(format!("{line}（{d}）"), format!("{line} ({d})")),
            None => line,
        }
    }
}

/// 「今日」那一块大字下面那一行里的一段
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Meta {
    pub text: String,
    /// 失败数：用红字
    pub failed: bool,
}

/// 「今日」那一块：网关在运行时，菜单里打开主界面之后的第一样东西。上面一行左边「今日」、
/// 右边网关的状态；中间是今天的 token，大字；下面一行是次数、失败、费用，和菜单栏上两行
/// 「token 在上、费用在下」同一个次序；右边是今天每小时的 token
#[derive(Debug, Clone, PartialEq)]
pub struct Dash {
    pub title: String,
    /// 「运行中」，和它前面那个点的颜色
    pub state: String,
    pub tone: StateTone,
    /// 连着远程时那台服务器的名字，跟在状态后面。原来写在状态头上，状态头没了
    pub server: Option<String>,
    /// 最近一分钟的生成速度「42 token/秒」，知道时才有
    pub rate: Option<String>,
    /// 今天的 token，大字。**没问到是破折号**，不是 0
    pub value: String,
    pub unit: String,
    /// 大字下面那一行，分段给：画的时候用「 · 」连起来，失败数是红的。没问到是空的
    pub meta: Vec<Meta>,
    /// 金额里缺着什么（「3 条无法计价」）。放得下才跟在那一行后面，放不下就只在悬停提示里
    pub note: Option<String>,
    /// 今天每小时的 token。没问到不画
    pub spark: Option<Vec<Spark>>,
    /// 监听设置没换成的原因：这一块最后一行橙字
    pub warn: Option<String>,
    /// 悬停提示：大字是取整过的，这里写准数，和那一行可能放不下的小字
    pub tooltip: Option<String>,
    pub action: Action,
}

impl Dash {
    /// 右上角那一句：「运行中 · office-mac · 42 token/秒」
    pub fn state_line(&self) -> String {
        [Some(&self.state), self.server.as_ref(), self.rate.as_ref()]
            .into_iter()
            .flatten()
            .cloned()
            .collect::<Vec<_>>()
            .join(" · ")
    }

    /// 大字下面那一行：「128 次 · 失败 2 · $3.47」
    pub fn meta_line(&self) -> String {
        self.meta
            .iter()
            .map(|m| m.text.as_str())
            .collect::<Vec<_>>()
            .join(" · ")
    }

    /// 只能写一行字的地方（别的平台的托盘）：「今日 1.2M token · 128 次 · $3.47」。那边没有
    /// 悬停提示，金额缺着什么括在后面
    pub fn line(&self) -> String {
        let mut line = format!("{} {} {}", self.title, self.value, self.unit);
        if !self.meta.is_empty() {
            line.push_str(" · ");
            line.push_str(&self.meta_line());
        }
        match &self.note {
            Some(n) => tr!(format!("{line}（{n}）"), format!("{line} ({n})")),
            None => line,
        }
    }
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
    /// 网关不在运行：点和状态，下面一行橙字说为什么
    Status {
        state: String,
        tone: StateTone,
        /// 连着远程时那台服务器的名字
        server: Option<String>,
        reason: Option<String>,
    },
    /// 网关在运行：「今日」那一块
    Today(Box<Dash>),
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
    /// 一个额度窗口一行：上面是上游、窗口名、用了多少、几时重置，下面一根通栏的条
    Quota {
        provider: String,
        window: WindowRow,
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
            // 原因可能折成两行，行高跟着字走：字变了就重建（只在状态变了、换了语言时）
            Row::Status { reason, .. } => format!("status:{}", reason.as_deref().unwrap_or("")),
            Row::Today(d) => format!("today:{}", d.warn.as_deref().unwrap_or("")),
            Row::Separator => "sep".into(),
            Row::Section { title, .. } => format!("section:{title}"),
            Row::Notice { action, .. } => format!("notice:{action:?}"),
            // 带小字的窗口高一截：带不带小字也是样子的一部分
            Row::Quota {
                provider, window, ..
            } => format!(
                "quota:{provider}:{}:{}",
                window.label,
                if window.detail.is_some() { '+' } else { '-' }
            ),
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
                // **菜单栏上只写数，和 token 数一样**：「≥」「~」那套记号放不下也读不快，留给
                // 点开的菜单和悬停提示（那里写着金额是下限、含估算，以及缺了哪些请求）
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

/// 还在当前的窗口里最紧张的那个。**先比颜色，再比用了多少**：上游说快到了、说已经
/// 拒绝的那个窗口，用得再少也比一个用了 89% 的要紧 —— 只比百分比的话，菜单栏就不变色，
/// 悬停提示说的也是另一个窗口。**过了重置时刻的不算**：手上的百分比是重置之前的，
/// 下一个请求才会带来新的
fn tightest(s: &Snapshot) -> Option<(&str, &Window)> {
    s.quotas
        .iter()
        .flat_map(|q| q.windows.iter().map(move |w| (q.provider.as_str(), w)))
        .filter(|(_, w)| current(w, s.now_ms))
        .max_by(|a, b| {
            bar_tone(a.1)
                .cmp(&bar_tone(b.1))
                .then(a.1.used_percent.total_cmp(&b.1.used_percent))
        })
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
                    t.cost(cost_long)
                ),
                format!(
                    "{} tokens today, {} cost",
                    tokens_short(t.tokens),
                    t.cost(cost_long)
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

/// 菜单从上到下。**「打开主界面」永远是第一项**，每一种状态都是：用户点开菜单最常做的就是
/// 这一件，它不该压在一堆数字下面。
///
/// 网关在运行时：打开主界面 ─ 提醒 ─ 今日、额度 ─ 进行中 ─ 策略组、复制地址和密钥 ─ 更新、
/// 设置、连接 ─ 退出。不在运行时：打开主界面 ─ 状态和能做的事 ─ 更新、设置、连接 ─ 退出
fn rows(s: &Snapshot) -> Vec<Row> {
    let mut out = vec![
        Row::Item(Item::new(
            "open",
            "macwindow",
            tr!("打开主界面", "Open ThinkWatch Lite"),
            Action::OpenMain,
        )),
        Row::Separator,
    ];
    if !s.gateway.running() {
        out.push(status(s));
        // 地址、密钥、策略组都要问运行着的网关：这里只有让它重新跑起来的那几样
        match s.gateway {
            Gateway::Starting => {}
            Gateway::Unlinked => {
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
            }
            _ => {
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
            }
        }
        out.push(Row::Separator);
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

    out.push(Row::Today(Box::new(dash(s))));
    // **报了几个窗口就画几行**：ChatGPT 有时只报每周的那一个，不假定总有 5 小时的
    for q in s.quotas.iter().filter(|q| !q.windows.is_empty()) {
        for w in &q.windows {
            out.push(Row::Quota {
                provider: q.provider.clone(),
                window: window_row(w, s.now_ms),
                action: Action::Open("upstreams"),
            });
        }
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
    // 右边写着要复制的那个地址：点之前就看得到
    let copy = Item::new(
        "copy-address",
        "doc.on.doc",
        tr!("复制网关地址", "Copy Gateway Address"),
        Action::CopyAddress,
    );
    out.push(Row::Item(match &s.addr {
        Some(addr) => copy.right(addr.clone()),
        None => copy.disabled(),
    }));
    out.push(Row::Item(Item::new(
        "copy-key",
        "key",
        tr!("复制默认密钥", "Copy Default Key"),
        Action::CopyKey,
    )));
    out.push(Row::Separator);
    app_items(s, &mut out);
    out
}

/// 网关不在运行时的那一块：点、状态（连着远程时跟着服务器的名字），下面一行说为什么
fn status(s: &Snapshot) -> Row {
    let (tone, reason) = match &s.gateway {
        Gateway::Running | Gateway::Starting => (StateTone::Busy, None),
        Gateway::SafeMode => (
            StateTone::Warn,
            Some(tr!(
                "已连续启动失败，当前只有配置和历史可用。",
                "Startup failed several times in a row. Only configuration and history are available."
            )),
        ),
        Gateway::Failed => (
            StateTone::Bad,
            Some(tr!(
                "core 程序未能运行，转发已停止。",
                "The core program could not run, so forwarding has stopped."
            )),
        ),
        Gateway::Stopped => (
            StateTone::Bad,
            Some(tr!("转发已停止。", "Forwarding has stopped.")),
        ),
        Gateway::Unlinked => (StateTone::Bad, Some(tr!("正在重新连接。", "Reconnecting."))),
    };
    Row::Status {
        state: state_text(&s.gateway).to_string(),
        tone,
        server: s.remote.clone(),
        reason: reason.map(str::to_string),
    }
}

/// 「今日」那一块。**没问到时大字是破折号、下面那一行空着**：不写 0，0 是一个值
fn dash(s: &Snapshot) -> Dash {
    let t = s.today.as_ref();
    let mut meta = Vec::new();
    if let Some(t) = t {
        let n = grouped(t.requests);
        meta.push(Meta {
            text: tr!(
                format!("{n} 次"),
                if t.requests == 1 {
                    "1 request".to_string()
                } else {
                    format!("{n} requests")
                }
            ),
            failed: false,
        });
        if t.failed > 0 {
            meta.push(Meta {
                text: tr!(format!("失败 {}", t.failed), format!("{} failed", t.failed)),
                failed: true,
            });
        }
        meta.push(Meta {
            text: t.cost(cost_long),
            failed: false,
        });
    }
    Dash {
        title: tr!("今日", "Today").to_string(),
        state: state_text(&s.gateway).to_string(),
        tone: StateTone::Ok,
        server: s.remote.clone(),
        rate: s
            .rate
            .map(|r| tr!(format!("{r} token/秒"), format!("{r} tokens/s"))),
        value: t.map_or_else(|| "—".to_string(), |t| tokens_short(t.tokens)),
        unit: tr!(
            "token",
            if t.is_some_and(|t| t.tokens == 1) {
                "token"
            } else {
                "tokens"
            }
        )
        .to_string(),
        meta,
        note: t.and_then(Today::cost_note),
        spark: t.and(s.hourly.as_ref()).map(|h| spark(h, s.now_ms)),
        warn: s.listen_error.clone(),
        tooltip: t.map(|t| {
            let tokens = grouped(t.tokens);
            let requests = grouped(t.requests);
            let cost = t.cost(cost_long);
            let mut tip = tr!(
                format!("今日 {tokens} token，{requests} 次请求"),
                format!(
                    "{tokens} {} today, {requests} {}",
                    if t.tokens == 1 { "token" } else { "tokens" },
                    if t.requests == 1 {
                        "request"
                    } else {
                        "requests"
                    }
                )
            );
            if t.failed > 0 {
                tip.push_str(&tr!(
                    format!("，失败 {} 次", t.failed),
                    format!(", {} failed", t.failed)
                ));
            }
            tip.push_str(&tr!(format!("，费用 {cost}"), format!(", {cost} cost")));
            if let Some(note) = t.cost_note() {
                tip.push_str(&tr!(format!("（{note}）"), format!(" ({note})")));
            }
            tip
        }),
        action: Action::Open("dashboard"),
    }
}

fn section(title: &str, right: Option<String>) -> Row {
    Row::Section {
        title: title.to_string(),
        right,
    }
}

/// 菜单的后半截，每种状态都是这个样子：更新、设置、连接，隔一条线退出。**有新版本时「安装
/// 新版本」在这一组最前**，带强调色；没有时「检查更新」排在这一组最后
fn app_items(s: &Snapshot, out: &mut Vec<Row>) {
    if let Some(v) = &s.update {
        out.push(Row::Item(Item {
            accent: true,
            ..Item::new(
                "update",
                "arrow.down.circle",
                tr!(format!("安装新版本 {v}…"), format!("Install Version {v}…")),
                Action::InstallUpdate,
            )
        }));
    }
    out.push(Row::Item(
        Item::new(
            "settings",
            "gearshape",
            tr!("设置…", "Settings…"),
            Action::Settings,
        )
        .key(","),
    ));
    out.push(Row::Item(connections(s)));
    if s.update.is_none() {
        out.push(Row::Item(Item::new(
            "update",
            "arrow.down.circle",
            tr!("检查更新…", "Check for Updates…"),
            Action::CheckUpdates,
        )));
    }
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

/// 窗口名，和上游页同一套写法：`5h`、`weekly` 有自己的叫法，别的按长度说（「30 天」
/// 「45 分钟」），认不出来的原样显示
pub fn window_label(window: &str) -> String {
    match window {
        "5h" => tr!("5 小时", "5h").to_string(),
        "weekly" => tr!("每周", "Weekly").to_string(),
        other => match window_span(other) {
            Some((n, Span::Days)) => tr!(format!("{n} 天"), english_count(n, "day")),
            Some((n, Span::Hours)) => tr!(format!("{n} 小时"), english_count(n, "hour")),
            Some((n, Span::Minutes)) => tr!(format!("{n} 分钟"), english_count(n, "minute")),
            None => other.to_string(),
        },
    }
}

/// 窗口长度的单位
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Span {
    Minutes,
    Hours,
    Days,
}

/// 按长度起名的窗口有多长：`30d` 是 30 天。core 把窗口的分钟数写成 `<数>d`、`<数>h`、
/// `<数>m`，除得尽一天的按天写、除得尽一小时的按小时写（core 的 `quota::codex_window`）。
/// 不是这个写法的（`weekly`）是 None
pub(crate) fn window_span(window: &str) -> Option<(u64, Span)> {
    let unit = match window.as_bytes().last()? {
        b'd' => Span::Days,
        b'h' => Span::Hours,
        b'm' => Span::Minutes,
        _ => return None,
    };
    // 最后一个字节是 ASCII，切在它前面不会切开一个字。`parse` 认前面的 `+`，先挡掉
    let digits = &window[..window.len() - 1];
    if !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((digits.parse().ok()?, unit))
}

/// `1 day`、`30 days`
fn english_count(n: u64, unit: &str) -> String {
    if n == 1 {
        format!("1 {unit}")
    } else {
        format!("{n} {unit}s")
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
/// 不够用，不是为了对表。**取整之后再定单位**：59.5 分钟是「1 小时」，不是「60 分钟」
pub fn resets_in(secs: u64) -> String {
    let [m, h, d] = [60.0, 3600.0, 86_400.0].map(|unit| (secs as f64 / unit).round() as u64);
    let (zh, en) = if secs == 0 {
        ("刚刚".to_string(), "now".to_string())
    } else if secs < 60 {
        ("1 分钟内".to_string(), "within 1 min".to_string())
    } else if m < 60 {
        (format!("{m} 分钟后"), format!("in {m} min"))
    } else if h < 24 {
        (format!("{h} 小时后"), format!("in {h} h"))
    } else {
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

/// `x` 按 `digits` 位小数写出来。**写出来的数到了 `limit` 就不算**（进位进到了下一档）：
/// 比的是写出来的那个数，所以和它怎么舍入永远一致
fn below(x: f64, digits: usize, limit: f64) -> Option<String> {
    let s = format!("{x:.digits$}");
    s.parse::<f64>().is_ok_and(|v| v < limit).then_some(s)
}

/// 菜单栏上的 token 数，和概览的写法一样：`845`、`9.8k`、`123k`、`3.1M`。
///
/// **先按这一档的精度取整，再看落在哪一档**：9,960 写一位小数是「10.0k」，那已经是下一档
/// 的「10k」；999,600 取整是「1000k」，那是「1.0M」
pub fn tokens_short(n: i64) -> String {
    let n = n.max(0);
    if n < 1_000 {
        return n.to_string();
    }
    let k = n as f64 / 1_000.0;
    if let Some(s) = below(k, 1, 10.0) {
        return format!("{s}k");
    }
    if k.round() < 1_000.0 {
        return format!("{}k", k.round() as i64);
    }
    match below(n as f64 / 1_000_000.0, 1, 1_000.0) {
        Some(s) => format!("{s}M"),
        None => format!("{:.1}B", n as f64 / 1_000_000_000.0),
    }
}

/// 菜单栏上的费用。**写法和 token 数一样，单位跟在数后面**：`41.20$`、`123$`、`1.2k$`。
/// 位数少才放得下：满 100 去掉小数，满 1000 写成 k。和 token 数一样取整之后再定单位：
/// 99.996 是「100$」，9,960 是「10k$」
pub fn cost_short(micros: i64) -> String {
    let d = micros.max(0) as f64 / 1_000_000.0;
    if let Some(s) = below(d, 2, 100.0).or_else(|| below(d, 0, 1_000.0)) {
        return format!("{s}$");
    }
    match below(d / 1_000.0, 1, 10.0) {
        Some(s) => format!("{s}k$"),
        None => format!("{:.0}k$", d / 1_000.0),
    }
}

/// 菜单里的费用：地方够，满 $1000 之前都写到分。$999.996 写到分是「$1000.00」，那已经是
/// 满 $1000 的「$1,000」
pub fn cost_long(micros: i64) -> String {
    let d = micros.max(0) as f64 / 1_000_000.0;
    match below(d, 2, 1_000.0) {
        Some(s) => format!("${s}"),
        None => format!("${}", grouped(d.round() as i64)),
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

#[cfg(test)]
mod tests;
