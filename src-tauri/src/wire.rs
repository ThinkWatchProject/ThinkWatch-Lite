//! 界面和 Rust 侧之间、**不经过 core** 的那几样东西的形状：客户端接管、MCP、
//! 客户端配置面的扫描，以及这一侧拼起来的两份结果（更换密钥之后的同步、每把
//! 密钥的用量）。
//!
//! 这些原来是 core 控制面上的端点，类型在 `tw_api` 里。现在它们在这台机器上
//! 做（改的是这台机器上别的软件的配置），类型也跟着搬到这里。前端的
//! `src/generated/lite-api.ts` 由这里生成（`tests/ts_bindings.rs` 核对）。
//!
//! **和 core 契约里同名的类型，形状也一样**：生成时同名又同形的直接从
//! `tw-api.ts` 引用，不另写一份；同名不同形的，生成那一步就失败。

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use tw_types::Msg;

// ---------------------------------------------------------- 客户端接管
//
// **注意 `DetectedClient` 和 `tw_api::ClientView` 是两个东西**：那个是
// config.yaml 里的一把网关密钥，这个是本机上装着的一个 AI 客户端 App。
// 中文都叫「客户端」，混起来的话，「有几个客户端」这句话就有两个答案。

/// 改了客户端的配置之后，什么时候生效。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum TakesEffect {
    /// 下一个请求就使用新配置
    #[serde(rename = "immediately")]
    Immediately,
    /// 客户端重新启动后才生效，读环境变量的要重开终端
    #[serde(rename = "on_restart")]
    OnRestart,
}

impl From<tw_adopt::clients::TakesEffect> for TakesEffect {
    fn from(t: tw_adopt::clients::TakesEffect) -> Self {
        match t {
            tw_adopt::clients::TakesEffect::Immediately => Self::Immediately,
            tw_adopt::clients::TakesEffect::OnRestart => Self::OnRestart,
        }
    }
}

/// 一个客户端的接管方式验证到什么程度。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum Verification {
    /// 在本机实际运行验证过
    #[serde(rename = "measured")]
    Measured,
    /// 字段名查证过，没有在本机实际运行验证
    #[serde(rename = "fields_only")]
    FieldsOnly,
}

impl From<tw_adopt::clients::Verified> for Verification {
    fn from(v: tw_adopt::clients::Verified) -> Self {
        match v {
            tw_adopt::clients::Verified::Measured => Self::Measured,
            tw_adopt::clients::Verified::FieldsOnly => Self::FieldsOnly,
        }
    }
}

/// 一个客户端此刻的样子。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DetectedClient {
    pub id: String,
    pub name: String,
    /// 用户认得的那个路径
    pub path: String,
    /// 跟完符号链接的真身。**和 `path` 不同时要显示出来** —— 用户以为
    /// 在改 ~/.claude/settings.json，实际写的可能是他 dotfiles 仓库里
    /// 的那份，而那是个会被 git 提交的地方
    pub real: String,
    pub installed: bool,
    pub has_config: bool,
    pub adopted_at_ms: Option<u64>,
    /// 配置里此刻的端点。**读出来的**，不是拿我们自己的记录充数
    pub endpoint: Option<String>,
    pub shadows: Vec<String>,
    pub takes_effect: TakesEffect,
    /// 接管之后要不要在「一直没收到请求」时提示。
    ///
    /// **需要重开终端的客户端不提示** —— 用户可能一整天都没重开过，那时
    /// 弹「是不是没生效」是狼来了
    pub warns_when_silent: bool,
    /// `measured`（在本机实际运行验证过）| `fields_only`（字段名查证过，
    /// 没有在本机实际运行验证）
    pub verified: Verification,
    /// 接管之后会失去或改变的功能
    pub costs: Vec<Msg>,
    /// 为它生成的那把网关密钥（取消接管之后仍然记着）。还没有就不给
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// 最后一次收到**那把密钥**的请求。**接管有没有真的生效，只有它能证明。**
    ///
    /// 按密钥算，不按请求头里自报的客户端标识 —— 后者可以伪造，而「接好了没有」
    /// 要的正是一个不能伪造的答案。没有密钥就没有这个值
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen_ms: Option<u64>,
    /// 手动配置的方法：没检测到它（配置文件不在默认位置）时照着做
    pub manual: ManualSetup,
}

/// 接管不了、只能给指引的。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ManualClient {
    /// `cursor` / `continue` / `antigravity-cli`。为它生成专用密钥时用
    pub id: String,
    pub name: String,
    /// 为它生成的那把网关密钥。还没有就不给
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// 最后一次收到那把密钥的请求
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen_ms: Option<u64>,
    pub setup: ManualSetup,
    /// 配完还漏什么（Cursor 的补全不经过网关之类）
    pub caveat: Msg,
}

/// 手动配置一个客户端的方法。
///
/// **地址和密钥不写进句子里**：界面各给一个复制按钮。写进句子的话，用户
/// 得从一句话里抠出一段 URL，而密钥根本不该出现在一句说明里。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ManualSetup {
    /// 按顺序做的几步
    pub steps: Vec<Msg>,
    /// 要写进配置文件的字段，就是接管时写的那几项。只有能接管的客户端有；
    /// 密钥那一项不给值（`secret` 为真），界面换成密钥的复制按钮
    pub fields: Vec<FieldChange>,
    /// 要填的网关地址，这个客户端要的写法（有的带 `/v1`）
    pub endpoint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ClientsResponse {
    pub clients: Vec<DetectedClient>,
    pub manual: Vec<ManualClient>,
    /// 客户端该连的地址
    pub gateway_base: String,
    /// config.yaml 里有哪几把网关密钥可选
    pub keys: Vec<String>,
}

/// WSL 里的一个发行版用哪种网络。决定写进客户端的是哪个地址。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum WslNetwork {
    /// WSL1：和 Windows 共用网络，写 127.0.0.1
    #[serde(rename = "wsl1")]
    Wsl1,
    /// WSL2 的默认：写 WSL 虚拟网卡的地址，WSL 重启后会变
    #[serde(rename = "nat")]
    Nat,
    /// `.wslconfig` 里 `networkingMode=mirrored`：写 127.0.0.1
    #[serde(rename = "mirrored")]
    Mirrored,
}

/// 客户端页上「WSL · <发行版>」那一组。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WslGroup {
    /// 发行版的名字（`Ubuntu`）。对这一组的命令都带着它
    pub distro: String,
    pub network: WslNetwork,
    /// 读不到这个发行版时的原因。**这时其余几项都是空的**，界面写「无法读取」
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<Msg>,
    /// 这个发行版里的客户端（第一批：Claude Code、Codex）
    pub clients: Vec<DetectedClient>,
    /// 这个发行版里的客户端该连的地址。算不出来时是空串，原因在 `base_error`
    pub gateway_base: String,
    /// 地址算不出来的原因（NAT 模式下找不到 WSL 的虚拟网卡）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_error: Option<Msg>,
    /// 接管着、还指着旧地址的客户端 id（NAT 模式下 WSL 重启之后）。点一下「重新
    /// 指向」就改到 `gateway_base`
    pub stale: Vec<String>,
    /// 防火墙里放行 WSL 的那条规则缺了时，要在管理员 PowerShell 里执行的命令
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub firewall: Option<String>,
}

/// 客户端页的 WSL 部分。**和 `ClientsResponse` 分开取**：读 WSL 会把发行版唤醒，
/// 所以只在打开这一页、动过它之后取，不跟着每个请求刷新。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WslResponse {
    /// 注册表里登记着的发行版，按注册表里的顺序。不在 Windows 上时是空的
    pub distros: Vec<WslGroup>,
}

/// 算好但还没落盘的改动。**UI 拿它画 diff 让用户确认。**
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PlanView {
    pub client: String,
    pub path: String,
    /// 改之前的原文，**密钥已打码**。
    pub before: Option<String>,
    /// 改之后的原文，**密钥已打码 —— 落盘写的是真值**。
    ///
    /// 界面上永远不显示真正的密钥，diff 里也不行：用户会截图这一屏来问
    /// 「这样对吗」。
    pub after: String,
    pub notes: Vec<Msg>,
    pub shadows: Vec<String>,
    /// 已经是这样了，什么都不用改
    pub noop: bool,
    pub carries_secret: bool,
    /// 这次会改哪些字段。diff 之外再给一份摘要
    pub fields: Vec<FieldChange>,
    /// 写进去的是哪把网关密钥（还原时是留下来的那把）。MCP 的改动没有
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// 那把密钥要在接管的那一刻新建（此前没有为这个客户端留着的）
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub key_created: bool,
    /// 同一次改动还要写的另外几份文件，和上面那一份一起落盘、一起失败。
    /// DeepSeek Harness 的密钥在它自己的凭据文件里，就在这儿
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub also: Vec<FilePlanView>,
}

/// 一次改动里的另一份文件：改哪个、改哪几项、完整的前后原文。**密钥已打码。**
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FilePlanView {
    pub path: String,
    /// 改之前的原文。没有 = 这个文件本来不存在，会新建（还原时：会删掉）
    pub before: Option<String>,
    pub after: String,
    pub fields: Vec<FieldChange>,
    /// 这一份已经是这样了
    pub noop: bool,
    /// 还原时这个文件会被整个删掉（当初就是接管时建的，还原后又空了）
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub deletes: bool,
}

/// 对一个字段做什么。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum FieldOp {
    #[serde(rename = "set")]
    Set,
    #[serde(rename = "remove")]
    Remove,
}

/// 配置文件里的一处改动。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct FieldChange {
    /// `set` | `remove`
    pub op: FieldOp,
    /// 字段路径，按层级用 `.` 连起来：`env.ANTHROPIC_BASE_URL`
    pub path: String,
    /// 要写入的值。写的是网关密钥时不给
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// 这一项是网关密钥。**值不回显**，哪怕是打码的；界面写成「密钥 xxx」
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub secret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct AdoptResponse {
    pub real: String,
    pub backup: String,
    pub created: bool,
    /// 不至于失败、但用户该知道的事（符号链接、权限太松……）
    pub warnings: Vec<Msg>,
    /// 改动什么时候生效
    pub takes_effect: TakesEffect,
}

/// 一条诊断发现的结论。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum FindingLevel {
    /// 就是它让接管没有生效
    #[serde(rename = "blocking")]
    Blocking,
    /// 可能有关，要人看一眼
    #[serde(rename = "suspect")]
    Suspect,
    /// 查过了，没有问题
    #[serde(rename = "clear")]
    Clear,
}

/// 一条诊断发现。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FindingView {
    pub level: FindingLevel,
    pub title: Msg,
    pub detail: Msg,
    /// 用户可以自己执行的下一步。**我们不替他执行。**
    pub fix: Option<Msg>,
}

// ---------------------------------------------------------- 更换密钥

/// 换完之后的结果：core 换好的那把，加上**这台机器上**跟着改好、或者没能改好的客户端。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct KeyRotation {
    /// 配置的新版本
    pub version: String,
    /// 新的密钥值。**只在这里给一次**，之后列表里只有脱敏的
    pub key: String,
    /// 跟着改好的客户端。空的就是没有客户端在用它
    pub synced: Vec<KeySynced>,
    /// 同步不上的客户端。**密钥已经换了**，这些要用户自己去改
    pub failed: Vec<KeySyncFailed>,
}

/// 把接管着的客户端改为指向另一个 core 之后：改好的、没改成的
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Retargeted {
    pub synced: Vec<KeySynced>,
    pub failed: Vec<KeySyncFailed>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct KeySynced {
    /// 客户端 id（`claude-code` …）
    pub client: String,
    /// 界面上显示的名字
    pub name: String,
    pub takes_effect: TakesEffect,
    /// 改之前的全文备份在哪
    pub backup: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct KeySyncFailed {
    pub client: String,
    pub name: String,
    pub error: Msg,
}

// ---------------------------------------------------------- 密钥用量

/// 每把密钥一段时间里的用量（`key_usage`）：合计，和同一个时间窗按格子分的走势。
///
/// **两样一起给。**密钥页、客户端页上它们是同一格（次数、费用和一条小柱图），
/// 分两次取的话那一格会在几十毫秒里跳两次。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct KeyUsage {
    /// 时间窗的起点，**原样回传**：界面补空格从它数起，和取数时算的是同一个
    pub since_ms: i64,
    /// 一格多宽
    pub bucket_ms: i64,
    /// 每把密钥的合计，`name` 是密钥名
    pub totals: Vec<tw_api::CostGroup>,
    /// 按格子分。**稀疏的**：没有请求的格子不在里面，由界面补
    pub buckets: Vec<tw_api::CostBucketGroup>,
}

// ---------------------------------------------------------- 卸载

/// 完全卸载的一步（`uninstall` 交回的是一串）：做成了没有，和给用户看的那句话。
///
/// **成败要单独给，不能让界面从句子里猜。**对话框的标题要说「卸载完成」还是
/// 「有几项没做成」，没做成的那几行要标出来；句子是按语言拼的，拿来判断成败
/// 换一种语言就失效。说明性的几句（数据目录已保留、现在可以删应用了）算成。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UninstallStep {
    pub ok: bool,
    pub text: String,
}

impl UninstallStep {
    pub fn done(text: impl Into<String>) -> Self {
        Self {
            ok: true,
            text: text.into(),
        }
    }

    pub fn failed(text: impl Into<String>) -> Self {
        Self {
            ok: false,
            text: text.into(),
        }
    }
}

// ---------------------------------------------------------- 静态扫描

/// 一处扫描发现有多要紧。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum ScanLevel {
    #[serde(rename = "high")]
    High,
    #[serde(rename = "medium")]
    Medium,
    #[serde(rename = "low")]
    Low,
}

/// 扫描发现出在客户端配置面的哪一类东西里。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum ScanSource {
    #[serde(rename = "hooks")]
    Hooks,
    #[serde(rename = "mcp")]
    Mcp,
    #[serde(rename = "skill")]
    Skill,
    #[serde(rename = "command")]
    Command,
    #[serde(rename = "agent")]
    Agent,
    #[serde(rename = "instructions")]
    Instructions,
}

/// 一处发现。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ScanFinding {
    pub level: ScanLevel,
    /// 哪条规则命中的
    pub rule: String,
    /// `hooks` | `mcp` | `skill` | `command` | `agent` | `instructions`
    pub kind: ScanSource,
    pub client: String,
    pub path: String,
    /// 第几行，从 1 开始
    pub line: usize,
    pub title: Msg,
    pub detail: Msg,
    /// 命中的那一行，**不可见字符已经换成可见记号**
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpView {
    pub name: String,
    pub client: String,
    pub command: String,
    pub args: Vec<String>,
    /// 远端型的地址
    pub url: Option<String>,
    /// **只有名字，没有值**
    pub env_keys: Vec<String>,
    pub enabled: bool,
    pub source: String,
    /// 远端而且不在本机
    pub third_party: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SkillView {
    pub name: String,
    pub client: String,
    pub path: String,
    pub allowed_tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct HookView {
    pub client: String,
    pub event: String,
    pub command: String,
    pub source: String,
}

/// 扫一次的结果：用户级的配置面，此刻磁盘上的样子。
///
/// **不存任何东西**：页面关了就没了。**只扫用户级的**：界面递不进一个目录来 ——
/// 那等于给 webview 开一个「读这台机器上任意目录」的口子。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ScanReport {
    pub findings: Vec<ScanFinding>,
    pub mcp: Vec<McpView>,
    pub skills: Vec<SkillView>,
    pub hooks: Vec<HookView>,
    /// 同名但配置不同的 MCP server 名字（矩阵上要标记号）
    pub conflicting: Vec<String>,
    /// 读不动的文件。**要显示** —— 悄悄跳过会给人「查过了」的错觉
    pub unreadable: Vec<String>,
    pub scanned: usize,
}

/// MCP 矩阵上的一下。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum McpOp {
    /// 从一个客户端拷到另一个
    #[serde(rename = "copy")]
    Copy,
    #[serde(rename = "remove")]
    Remove,
}

/// 在矩阵上点一下。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpOpRequest {
    /// `copy` 或 `remove`
    pub op: McpOp,
    pub name: String,
    /// `copy` 时从哪个客户端取
    #[serde(default)]
    pub from: Option<String>,
    /// 写到（或从中删掉）哪个客户端
    pub to: String,
}

/// 哪些客户端能被写入，哪些只能看。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct McpTargetView {
    pub client: String,
    pub name: String,
    pub path: String,
    /// 能不能往里写。**不能写的照样在清单里** —— 看得见是第一目标
    pub copyable: bool,
    /// 不能写的话，为什么。能写的时候没有
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub why_not: Option<Msg>,
}

// ---------------------------------------------------------- 事件

/// 这台机器上发生的、界面要跟上的事（Tauri 事件 `local-event`）。
///
/// **和 core 的事件流是两条路**：core 的说网关里的事，这条说这台机器上客户端的
/// 配置文件。连着哪个 core 都一样，这些文件总在这台机器上。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LocalEvent {
    /// 客户端的配置文件动了。**文件动了本身就是一条消息**，和可疑不可疑无关：
    /// 接管状态读的就是这几个文件
    ClientsChanged { at_ms: u64 },
    /// 客户端配置面上**新出现了**可疑的东西。首次扫描不算新出现
    ScanAlert {
        alerts: Vec<ScanFinding>,
        at_ms: u64,
    },
}
