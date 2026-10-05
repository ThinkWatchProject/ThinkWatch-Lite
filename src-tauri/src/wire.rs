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
    /// **这一份**接管它的时间。另一个 ThinkWatch Lite 接管着的没有（见 `other_instance`）
    pub adopted_at_ms: Option<u64>,
    /// 接管着它的是另一个 ThinkWatch Lite：安装版和绿色版各有各的数据目录，接管时的
    /// 备份不在这一份的数据目录里。这时不给还原、也不给接管，要在接管它的那一份里还原
    pub other_instance: bool,
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
    /// 配置里写着的模型清单和网关此刻对它那把密钥答的不一样了（上游或路由变了）。
    /// 只有把模型写进配置的客户端（opencode、Pi、oh-my-pi、Grok Build、Qwen Code）会是
    /// `true`；点一下走一遍接管的「差异 → 确认 → 写入」重写它，**不在后台悄悄改**
    pub models_stale: bool,
    /// 配置里此刻写着的模型。只有把模型写进配置的客户端（opencode、Pi、oh-my-pi、
    /// Grok Build、Qwen Code）有；删除别名时据此说出哪几个已接管客户端的模型列表写着它
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<String>>,
    /// 配置位置能换（行菜单里给「更改路径…」，见 [`ClientLocations`]）。Claude Desktop、
    /// DeepSeek Harness 和 WSL 里的不能
    pub movable: bool,
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
    /// 这台电脑上它由组织统一管理，接管不了：给出的这句话说明原因。**这时不给
    /// 接管按钮**。只有 Claude Desktop 会有
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub managed: Option<Msg>,
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
    /// MCP 管理、安全扫描的位置能换（Cursor、Antigravity CLI），见 [`ClientLocations`]
    pub movable: bool,
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

/// WSL 里的一个发行版用哪种网络；本机时，不能接管的那几种说明卡在哪一步。
///
/// WSL 里的客户端写的地址和这台电脑上的一样（本机时是 `127.0.0.1`），够得着它的
/// 只有 WSL 1 和 mirrored。其余几种界面上说明原因，能动手的给按钮（改为 mirrored、
/// 重启 WSL）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WslNetwork {
    /// WSL 1：和 Windows 共用网络
    Wsl1,
    /// WSL 2 的 mirrored 网络：和 Windows 共用网卡
    Mirrored,
    /// WSL 2 的默认：NAT。本机时不能接管，可以改为 mirrored。`wsl_version`：
    /// 查到的 WSL 版本（够新）；查不出来是 `null`，说明里要提一句版本要求
    Nat { wsl_version: Option<String> },
    /// `.wslconfig` 已设为 mirrored，WSL 还在用改之前的网络：重启 WSL 之后生效
    Restart,
    /// 在这里重启过 WSL，它仍然没用上 mirrored
    Fallback,
    /// Windows 10、Windows 11 21H2：没有 mirrored 网络
    OldWindows,
    /// WSL 太旧，要先 `wsl --update`
    OldWsl { wsl_version: String },
}

impl From<tw_adopt::wsl::Wsl2> for WslNetwork {
    fn from(s: tw_adopt::wsl::Wsl2) -> Self {
        use tw_adopt::wsl::Wsl2;
        match s {
            Wsl2::Mirrored => Self::Mirrored,
            Wsl2::Nat { version } => Self::Nat {
                wsl_version: version,
            },
            Wsl2::Restart => Self::Restart,
            Wsl2::Fallback => Self::Fallback,
            Wsl2::OldWindows => Self::OldWindows,
            Wsl2::OldWsl { version } => Self::OldWsl {
                wsl_version: version,
            },
        }
    }
}

/// 客户端页上「WSL · <发行版>」那一组。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WslGroup {
    /// 发行版的名字（`Ubuntu`）。对这一组的命令都带着它
    pub distro: String,
    pub network: WslNetwork,
    /// 此刻能不能接管：WSL 1、mirrored 能，连着远程 core 时都能。**不能的时候不给
    /// 接管和手动配置**，接管过的照样能还原
    pub adoptable: bool,
    /// 读不到这个发行版时的原因。**这时 `clients` 是空的**，界面写「无法读取」
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<Msg>,
    /// 这个发行版里的客户端（第一批：Claude Code、Codex）
    pub clients: Vec<DetectedClient>,
    /// 这个发行版里的客户端该连的地址：和这台电脑上的一样
    pub gateway_base: String,
}

/// 客户端页的 WSL 部分。**和 `ClientsResponse` 分开取**：读 WSL 会把发行版唤醒，
/// 所以只在打开这一页、动过它之后取，不跟着每个请求刷新。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WslResponse {
    /// 注册表里登记着的发行版，按注册表里的顺序。不在 Windows 上时是空的
    pub distros: Vec<WslGroup>,
}

/// 把 WSL 2 改成 mirrored 网络的那一份改动（`%USERPROFILE%\.wslconfig`）。
/// **UI 拿它画差异让用户确认**，确认之后才写。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WslConfigPlan {
    /// `C:\Users\u\.wslconfig`
    pub path: String,
    /// 改之前的原文。没有这个文件（要新建）时不给
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    pub after: String,
    /// 这份改动是按哪一份原文算的。确认时原样带回来，见 [`PlanView::digest`]
    pub digest: String,
    /// 改的是哪一项：`wsl2.networkingMode`（写在旧位置的是 `experimental.networkingMode`）
    pub field: String,
    /// 已经是 mirrored 了，什么都不用改
    pub noop: bool,
}

/// 卸载时不改回的 `.wslconfig`：它此刻是 mirrored，是在这里改的。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WslConfigKept {
    /// `C:\Users\u\.wslconfig`
    pub path: String,
    /// 改之前的全文备份。**这个文件是这里新建的**（改之前没有）时不给
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup: Option<String>,
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
    /// 这份改动是按哪几份原文算的（`clients::ops::fingerprint`）。**确认时原样带回来**：
    /// 落盘时按那一刻的文件重算，原文在人看差异的时候被改过就什么都不写
    pub digest: String,
    /// 同一次改动还要写的另外几份文件，和上面那一份一起落盘、一起失败，按落盘的
    /// 顺序。DeepSeek Harness 的密钥在它自己的凭据文件里；Claude Desktop 一次改
    /// 四个，`path` 那一个是它配置库里的那一份，其余三个在这里
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub also: Vec<FilePlanView>,
    /// 客户端原来直连 Bedrock：按它原来的设置新建 Bedrock 上游要填的。界面据此给一个
    /// 「新建上游」的入口；还原时没有
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bedrock: Option<BedrockDraft>,
    /// 接管、还原 Claude Desktop 时网关上要改的那条路由规则（`clients::desktop_rule`）。
    /// 不用改的、别的客户端没有
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub desktop_rule: Option<DesktopRule>,
}

/// 接管 Claude Desktop 时在它的密钥上加的那条「指定模型」规则。
///
/// 网关列出的模型它一个都不收时（它只认名称像 Claude 的），接管时选一个上游模型，
/// 这条规则把它的请求都发给那个模型：插在它的密钥所用路由的最前面，条件只有它的
/// 密钥。取消接管时删掉。别的客户端不受影响。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct DesktopRule {
    /// 规则在（或者要加进）哪条路由
    pub route: String,
    /// 是那条路由的第几条，从 1 起
    pub position: u32,
    /// 规则的名字
    pub name: String,
    /// 条件里的密钥：它的那把
    pub key: String,
    /// 要选模型（网关没有它认的模型）时：写进它配置的名称和可选的模型。没有就是
    /// 不用选 —— 这时已有的那条规则要删掉（还原，或者网关已经有它认的模型了）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pick: Option<DesktopPick>,
    /// 已经有这条规则时，它此刻指定的模型
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<Vec<PinnedModel>>,
}

/// 给 Claude Desktop 选模型：写进它配置的那个名称，和它的密钥能用的上游模型
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct DesktopPick {
    /// 写进它配置的模型名（它发来的就是这个）
    pub written: String,
    /// 可选的模型，按网关列出的顺序。选一个，规则按顺序指定提供它的每一家上游
    pub choices: Vec<ModelChoice>,
}

/// 一个上游模型，和提供它的上游（按网关排的顺序）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ModelChoice {
    pub model: String,
    pub providers: Vec<String>,
}

/// 规则去向里的一个「指定模型」：发到这家上游的这个模型，模型名原样发出
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct PinnedModel {
    pub provider: String,
    pub model: String,
}

/// 按客户端原来直连 Bedrock 时的设置新建 Bedrock 上游，要填的那几项。
///
/// **凭据只有 `${变量名}` 和 profile 的名字**：客户端配置里写着的明文密钥不抄，也不经过这里
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BedrockDraft {
    pub region: String,
    /// 客户端自己写的 Bedrock 地址（VPC 端点、代理）。没写就是那个区域的标准地址
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    pub auth: DraftAuth,
}

/// 新建的上游用哪种凭据
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DraftAuth {
    /// Bedrock API key，写成 `${AWS_BEARER_TOKEN_BEDROCK}` 这样
    Key { key: String },
    /// 访问密钥，每一项都是 `${变量名}`
    Keys {
        access_key_id: String,
        secret_access_key: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session_token: Option<String>,
    },
    /// AWS 凭证文件里的 profile
    Profile { profile: String },
    /// 没找到网关用得上的：新建时自己填
    None,
}

impl From<tw_adopt::cloud::BedrockDraft> for BedrockDraft {
    fn from(d: tw_adopt::cloud::BedrockDraft) -> Self {
        use tw_adopt::cloud::DraftAuth as A;
        BedrockDraft {
            region: d.region,
            base_url: d.base_url,
            auth: match d.auth {
                A::Key(key) => DraftAuth::Key { key },
                A::Keys {
                    access_key_id,
                    secret_access_key,
                    session_token,
                } => DraftAuth::Keys {
                    access_key_id,
                    secret_access_key,
                    session_token,
                },
                A::Profile(profile) => DraftAuth::Profile { profile },
                A::None => DraftAuth::None,
            },
        }
    }
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
    /// 客户端 id。改为指向服务器时整个 WSL 发行版读不到，是空的：那时 `name` 是
    /// 那个发行版（`WSL · Ubuntu`），`error` 说为什么读不到
    pub client: String,
    /// 界面上显示的名字，WSL 里的带着发行版（`Claude Code (WSL · Ubuntu)`）
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
    /// 这条命令在 `source` 的第几行（1 起），找不到是 0。**发现按文件和行记**，
    /// 清单上的一行靠它认出哪些发现是自己的
    pub line: usize,
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
    /// 配置位置能换（MCP 页的右键菜单里给「更改路径…」），见 [`ClientLocations`]
    pub movable: bool,
    /// 这台电脑上有它（见 `tw_adopt::mcp::Target::present`）。没有的不占矩阵的一列，
    /// 列在矩阵下方，能换位置的可以就地指定
    pub present: bool,
}

/// 客户端配置位置里的一项。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum LocationRole {
    /// 接管改的文件
    Config,
    /// MCP 管理读写的文件
    Mcp,
    /// 安全扫描看的目录（hooks、skills、指令文件）
    Scan,
}

/// 一处配置位置，和接管、MCP 管理、安全扫描里用到它的那几项。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct LocationView {
    /// 用到它的几项，按 接管 → MCP 管理 → 安全扫描 排。同一个文件的几项在同一行
    /// （Codex 的 `config.toml` 既是接管的也是 MCP 的）
    pub roles: Vec<LocationRole>,
    /// 文件夹（安全扫描看的那一处）还是文件
    pub dir: bool,
    pub path: String,
    pub default: String,
}

/// 一个客户端的配置位置：「更改路径…」那个对话框。
///
/// **三处跟着同一个目录一起换**（`tw_adopt::locations`）：改一处，其余几处按这个
/// 客户端的布局换到同一个目录下，改之前一起列出来（[`LocationChange`]）。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ClientLocations {
    pub client: String,
    pub name: String,
    /// 接管着：先还原才能换 —— 接管的文件会跟着换，而接管记录在原来那个文件旁边
    pub adopted: bool,
    pub rows: Vec<LocationView>,
}

/// 改的是哪一项、改成什么。`~/…` 按 home 展开
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct LocationEdit {
    pub role: LocationRole,
    pub path: String,
}

/// 改之前要说的一处：从哪儿换到哪儿。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct LocationChange {
    pub roles: Vec<LocationRole>,
    pub dir: bool,
    pub from: String,
    pub to: String,
}

// ---------------------------------------------------------- 事件

/// 这台机器上发生的、界面要跟上的事（Tauri 事件 `local-event`）。
///
/// **和 core 的事件流是两条路**：core 的说网关里的事，这条说这台机器上客户端的
/// 配置文件，和这台机器的钟。连着哪个 core 都一样，这些总在这台机器上。
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
    /// 钟跳了：系统睡醒、时钟被改、时区换了（见 `clock`）。定在某个钟点上的定时器
    /// 要按此刻的钟重新定
    ClockChanged { at_ms: u64 },
}

// ---------------------------------------------------------- 导入链接

/// 一条导入链接（`thinkwatch://import?…`）提议新建的上游。**已经在 Rust 侧逐项校验过**
/// （`import_link::parse`），界面只负责给人确认；确认之前不写配置、不发任何请求。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ImportProposal {
    /// 链接给的名称。没给是空，界面按地址起一个
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 规范化之后的接口地址：主机名是 ASCII（IDN 转成 punycode），末尾没有 `/`
    pub base_url: String,
    /// 请求和密钥会发往的主机（带端口时带上端口），ASCII
    pub host: String,
    /// 没给就是自动识别
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<tw_api::Protocol>,
    /// API 密钥，原样。保证不含 `$`、`{`、`}`：不会被当成 `${变量名}` 展开
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// 服务不提供模型列表时的手动清单
    pub models: Vec<String>,
}

// ---------------------------------------------------------- 插件：在系统的确认框里点头的几步
//
// 改得了回答里工具调用的插件，装上它、打开它、改它的代码、批准它磁盘上改过的文件，要在系统
// 的确认框里点头（约定附录 4 §3）。点头之后发的那几个端点（`…Confirmed`）**不在网页的白名单
// 里**（`call.rs`）：网页只能请 Rust 去做，Rust 自己把插件再读一遍，在系统的确认框里写明它是
// 谁、能做什么、这次改什么，点了头才写配置（`plugins` 模块）。

/// 装一个插件（`plugin_install_confirmed`）：代码、ID 和开关，和 `CreatePlugin` 一样。
///
/// **没有 manifest**：名字、权限、处理哪几种请求、适用范围由 Rust 把代码交给 core 再读一遍，
/// 网页说的不算。出错时怎么办、适用范围、设置都写在代码里
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PluginInstallRequest {
    pub source: String,
    /// 添加插件时「设置」页上的插件 ID。不给由 core 按名字起
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_version: Option<String>,
}

/// 保存一个插件（`plugin_save_confirmed`）：整份代码和开关，和 `SavePlugin` 一样。这次改
/// 什么由 Rust 和 core 那边确认过的那一份比出来
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PluginSaveRequest {
    pub id: String,
    pub source: String,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_version: Option<String>,
}

/// 批准一个插件磁盘上改过的文件（`plugin_approve_confirmed`）。**文件由 Rust 自己去取**：
/// 读的、给人看的、交给 core 认的是同一个 SHA-256
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PluginApproveRequest {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_version: Option<String>,
}

/// 写成了（配置的新版本），或者在系统的确认框里点了取消 —— **取消不是失败**，什么都
/// 没写，界面照原样
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PluginWrite {
    Done { version: String },
    Cancelled,
}

// ---------------------------------------------------------- 模型别名：名称提示

/// 新建、编辑模型别名时，名称下面的一条提示（`alias_hints`）。说的是**这台机器上检测到的
/// 客户端**会怎么对待这个名称，所以由这一侧判断（`crate::aliases`）。只给码和参数，句子在界面
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum AliasHint {
    /// 名称是 Claude Code 自己的档位名（`sonnet`、`opus`、`opusplan`……）：它请求之前先换成
    /// 完整的模型名，它的请求里不会出现这个名称
    ClaudeCodeReserved { name: String },
    /// 名称像 `family` 这一家的模型，列出的上游模型却是别家的（`model` 是其中第一个）。
    /// `clients`：检测到的、按模型名决定请求参数的客户端（产品名）
    FamilyMismatch {
        family: String,
        model: String,
        clients: Vec<String>,
    },
    /// 接管着的 Claude Desktop 只列出名称像 Claude 的模型：不会显示这个名称
    ClaudeDesktopHidden { name: String },
    /// 接管着的 Claude Desktop 会在模型列表里显示这个名称
    ClaudeDesktopShown { name: String },
    /// 这几个接管着的客户端把网关的模型列表写进了自己的配置（产品名）：多了、改了一个名称，
    /// 客户端页会提示更新它们的模型列表
    ModelListsUpdate { clients: Vec<String> },
}
