//! Claude Code 的云服务商开关：`CLAUDE_CODE_USE_BEDROCK` 这一类。
//!
//! 打开任何一个，Claude Code 就不看 `ANTHROPIC_BASE_URL`，直连那一家云 —— 接管写进去的
//! 网关地址形同虚设，而一切看起来都接好了。所以接管时要把打开着的关掉，还原时原样打开。
//!
//! - **名字**照 Claude Code 官方文档 env-vars 一页的表，一共五个（[`SWITCHES`]）。
//! - **怎样算打开**照它自己的判断（[`is_on`]）：去掉首尾空白、不分大小写，是 `1`、`true`、
//!   `yes`、`on` 之一。文档只写了前两个，装着的版本认这四个。
//! - **怎么关**：在 settings.json 的 `env` 里写成空串。文档写明 `env` 里的值盖过 shell 里
//!   export 的，而空串对选服务商来说等于没设。shell 配置是用户的，我们不去改它。
//! - **哪里关不掉**：比 settings.json 优先的地方。组织托管的配置盖过一切，接管写了也白写，
//!   所以拒绝（[`crate::plan::PlanError::CloudManaged`]）；`.claude/settings.local.json` 只管
//!   在那个目录里开的会话，照「被盖住了」那样说一声。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::json::Val;

/// 一家云服务商。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cloud {
    Bedrock,
    Mantle,
    Vertex,
    Foundry,
    AnthropicAws,
}

impl Cloud {
    /// 发给界面的词，词表（`core.zh.json` 的 `cloud`）按它查名字
    pub fn slug(self) -> &'static str {
        match self {
            Cloud::Bedrock => "bedrock",
            Cloud::Mantle => "mantle",
            Cloud::Vertex => "vertex",
            Cloud::Foundry => "foundry",
            Cloud::AnthropicAws => "anthropic_aws",
        }
    }
    /// 官方文档里的名字，英文句子里用
    pub fn name(self) -> &'static str {
        match self {
            Cloud::Bedrock => "Amazon Bedrock",
            Cloud::Mantle => "Amazon Bedrock (Mantle)",
            Cloud::Vertex => "Google Cloud's Agent Platform",
            Cloud::Foundry => "Microsoft Foundry",
            Cloud::AnthropicAws => "Claude Platform on AWS",
        }
    }
    /// 走的是 Bedrock（Invoke API 或 Mantle）：模型名是 Bedrock 的那一套
    pub fn is_bedrock(self) -> bool {
        matches!(self, Cloud::Bedrock | Cloud::Mantle)
    }
}

/// 五个开关，按 Claude Code 自己选服务商时看的顺序。
pub const SWITCHES: &[(&str, Cloud)] = &[
    ("CLAUDE_CODE_USE_BEDROCK", Cloud::Bedrock),
    ("CLAUDE_CODE_USE_FOUNDRY", Cloud::Foundry),
    ("CLAUDE_CODE_USE_ANTHROPIC_AWS", Cloud::AnthropicAws),
    ("CLAUDE_CODE_USE_MANTLE", Cloud::Mantle),
    ("CLAUDE_CODE_USE_VERTEX", Cloud::Vertex),
];

/// Claude Code 认不认这个值是「打开」
pub fn is_on(v: &str) -> bool {
    matches!(
        v.trim().to_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

/// 配置文件里写的一个值是不是「打开」。`env` 里照理只写字符串；写成 `1`、`true` 的，
/// Claude Code 放进进程环境时也是这个意思
pub(crate) fn val_on(v: &Val) -> bool {
    match v {
        Val::Str(s) | Val::Num(s) => is_on(s),
        Val::Bool(b) => *b,
        _ => false,
    }
}

/// 除了它自己的配置文件，还要看的地方。
#[derive(Debug, Clone, Default)]
pub struct Around {
    /// 用户环境里的变量：桌面端从登录 shell（Windows 上从注册表）取的那一份。
    /// **取不到就是空的**，那时只看得见配置文件里写的、shell 配置里 export 的
    pub env: BTreeMap<String, String>,
    /// 组织托管的配置文件，按 Claude Code 读的顺序（`managed-settings.json`，再是分片），
    /// 同一个键后读的赢
    pub managed: Vec<PathBuf>,
    /// core 解析 `${变量名}` 用的环境：本机的 core 起的时候拿到的那一份。**`None` = 不知道**
    /// （连着远程 core，变量在服务器上解析）—— 那时不说哪个变量网关看不见
    pub core_env: Option<BTreeMap<String, String>>,
    /// 用户环境里的代理变量（`http_proxy`、`NO_PROXY` 这些，大小写照原样）。`env` 里没有
    /// 它们：带给 core 的那一份特意滤掉了代理，见桌面端的 `user_env`。Pi 访问网关会不会经过
    /// 代理要看它们（[`crate::pi::proxy_notes`]）
    pub proxy: BTreeMap<String, String>,
}

impl Around {
    /// 这台电脑上的：托管策略在系统的位置（[`crate::paths::managed_settings`]）。`remote`：
    /// 连着远程 core，`${变量名}` 在服务器上解析
    pub fn here(env: impl IntoIterator<Item = (String, String)>, remote: bool) -> Around {
        let mut managed = vec![crate::paths::managed_settings()];
        managed.extend(crate::paths::managed_settings_dropins());
        let env: BTreeMap<String, String> = env.into_iter().collect();
        Around {
            core_env: (!remote).then(|| env.clone()),
            env,
            managed,
            // 代理变量另外给（桌面端的 `user_env` 从同一份用户环境里取出来）
            proxy: BTreeMap::new(),
        }
    }

    /// WSL 里的：托管策略在那个发行版里，用户环境从 Windows 这边看不到。`core_env` 是这台
    /// 电脑上的 core 的环境（WSL 里设的变量它看不见），连着远程 core 时是 `None`
    pub fn wsl(w: &crate::wsl::WslHome, core_env: Option<BTreeMap<String, String>>) -> Around {
        let file = w.managed_settings();
        let mut managed = vec![file.clone()];
        if let Some(dir) = file.parent() {
            managed.extend(crate::paths::dropins_in(&dir.join("managed-settings.d")));
        }
        Around {
            env: BTreeMap::new(),
            managed,
            core_env,
            proxy: BTreeMap::new(),
        }
    }
}

/// 一个开关在哪儿打开着。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Where {
    /// 接管写的那份 settings.json 的 `env` 里
    Settings(PathBuf),
    /// shell 配置里 export 的
    Shell { path: PathBuf, line: usize },
    /// 用户环境里有，看不出是哪一行设的（`source` 进来的文件、注册表）
    Environment,
    /// 组织托管的配置：盖过一切，接管关不掉
    Managed(PathBuf),
    /// 比 settings.json 优先的文件（`settings.local.json`）：在那个目录里开的会话照样直连
    Above(PathBuf),
}

impl Where {
    /// 接管在 settings.json 里写一个空串就能关掉它
    pub fn turned_off_here(&self) -> bool {
        matches!(
            self,
            Where::Settings(_) | Where::Shell { .. } | Where::Environment
        )
    }
}

/// 一个打开着的开关。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct On {
    pub name: &'static str,
    pub cloud: Cloud,
    pub at: Where,
}

/// Claude Code 此刻打开着的开关。
///
/// 每个开关按优先级从高往低找第一处写了它的地方：托管配置（写了就是它说了算，不再往下
/// 看）、`shadows`（比 settings.json 优先的文件，只管某个目录，所以报了之后还要往下看）、
/// `settings`（settings.json 的原文，写了就是它说了算）、shell 配置和用户环境。
///
/// shell 配置里的值认不出（`export NAME` 这种）也算打开：多写一个空串无害，漏掉一个就
/// 是接管了却直连。
pub fn switches(
    home: &Path,
    config: &Path,
    settings: &str,
    shadows: &[PathBuf],
    around: &Around,
) -> Vec<On> {
    let names: Vec<&str> = SWITCHES.iter().map(|(n, _)| *n).collect();
    let exports = crate::detect::shell_exports_valued(home, &names);
    let mut out = Vec::new();
    for &(name, cloud) in SWITCHES {
        let on = |at| On { name, cloud, at };
        // 托管配置：几个文件里最后写了它的那一个说了算
        let managed = around.managed.iter().rev().find_map(|p| {
            let v = env_val(&std::fs::read_to_string(p).ok()?, name)?;
            Some((p, v))
        });
        if let Some((p, v)) = managed {
            if val_on(&v) {
                out.push(on(Where::Managed(p.clone())));
            }
            continue;
        }
        for p in shadows {
            if let Some(v) = std::fs::read_to_string(p)
                .ok()
                .and_then(|t| env_val(&t, name))
                && val_on(&v)
            {
                out.push(on(Where::Above(p.clone())));
            }
        }
        if let Some(v) = env_val(settings, name) {
            if val_on(&v) {
                out.push(on(Where::Settings(config.to_path_buf())));
            }
            continue;
        }
        let export = exports
            .iter()
            .find(|e| e.name == name && e.value.as_deref().is_none_or(is_on));
        if let Some(e) = export {
            out.push(on(Where::Shell {
                path: e.path.clone(),
                line: e.line,
            }));
        } else if around.env.get(name).is_some_and(|v| is_on(v)) {
            out.push(on(Where::Environment));
        }
    }
    out
}

/// settings 文件 `env` 里这个变量的值。读不出来、没写都是 `None`
fn env_val(text: &str, name: &str) -> Option<Val> {
    crate::json::get(text, &["env", name]).ok().flatten()
}

/// 这个变量此刻的值：settings.json 的 `env` 里写了就是它，否则看用户环境（登录 shell
/// 取的那一份），再看 shell 配置里 export 的
pub(crate) fn effective(
    home: &Path,
    settings: &str,
    around: &Around,
    name: &str,
) -> Option<String> {
    if let Some(v) = env_val(settings, name) {
        return match v {
            Val::Str(s) | Val::Num(s) => Some(s),
            Val::Bool(b) => Some(b.to_string()),
            _ => None,
        };
    }
    if let Some(v) = around.env.get(name) {
        return Some(v.clone());
    }
    crate::detect::shell_exports_valued(home, &[name])
        .into_iter()
        .find_map(|e| e.value)
}

/// 按模型家族选模型的那几个变量。**没写成 Bedrock 模型的**，接管之后 Claude Code 就用
/// Anthropic 自己的模型名向网关要这一类模型 —— 路由里要有规则把它们改写到 Bedrock 上。
///
/// `fable` 那一类不在里面：只有用户自己点名才会用到，而默认的主模型、后台任务、`opusplan`
/// 用的都是这三类
const FAMILIES: &[(&str, &[&str])] = &[
    ("ANTHROPIC_DEFAULT_OPUS_MODEL", &[]),
    ("ANTHROPIC_DEFAULT_SONNET_MODEL", &[]),
    // 后台任务用的小模型：旧的那个变量名也还认
    (
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        &["ANTHROPIC_SMALL_FAST_MODEL"],
    ),
];

/// 看起来是不是 Bedrock 上的模型：推理配置（`us.anthropic.…`、`global.anthropic.…`）、
/// 基础模型（`anthropic.…`，Mantle 也是这样），或者 ARN
pub fn is_bedrock_model(m: &str) -> bool {
    let m = m.trim().to_ascii_lowercase();
    m.starts_with("arn:") || m.contains("anthropic.")
}

/// 接管之后会用 Anthropic 的模型名向网关要的那几个家族变量（见 [`FAMILIES`]），加上写成
/// 了 Anthropic 模型名的主模型（`ANTHROPIC_MODEL`，或者 settings.json 的 `model`）。
/// 主模型写的是别名（`opus`、`opusplan` 这些）的不算：它跟着家族变量走。
pub fn unpinned_models(home: &Path, settings: &str, around: &Around) -> Vec<&'static str> {
    let pinned =
        |name: &str| effective(home, settings, around, name).is_some_and(|v| is_bedrock_model(&v));
    let mut out: Vec<&'static str> = FAMILIES
        .iter()
        .filter(|(name, old)| !pinned(name) && !old.iter().any(|o| pinned(o)))
        .map(|(name, _)| *name)
        .collect();
    let main = effective(home, settings, around, "ANTHROPIC_MODEL")
        .map(|v| ("ANTHROPIC_MODEL", v))
        .or_else(|| {
            crate::json::get(settings, &["model"])
                .ok()
                .flatten()
                .and_then(|v| v.as_str().map(|s| ("model", s.to_string())))
        });
    if let Some((name, v)) = main
        && !is_alias(&v)
        && !is_bedrock_model(&v)
    {
        out.insert(0, name);
    }
    out
}

/// Claude Code 的模型别名（model-config 一页的表）。带 `[1m]` 的也是。它请求之前先换成完整的
/// 模型名 —— 网关的模型别名起成这些名称，Claude Code 的请求用不到（Lite 的 `aliases` 据此提示）
pub fn is_alias(m: &str) -> bool {
    let m = m.trim().to_ascii_lowercase();
    let m = m.strip_suffix("[1m]").unwrap_or(&m);
    matches!(
        m,
        "default" | "best" | "fable" | "sonnet" | "opus" | "haiku" | "opusplan"
    )
}

/// 这个变量装的是不是凭据：名字里有一段是 `KEY`、`TOKEN`、`SECRET`、`PASSWORD`、`HEADERS`
/// 的（`AWS_BEARER_TOKEN_BEDROCK`、`AWS_SECRET_ACCESS_KEY`、`ANTHROPIC_CUSTOM_HEADERS`……）。
///
/// 按 `_` 隔开的段整段比：`CLAUDE_CODE_MAX_OUTPUT_TOKENS` 里是 `TOKENS`，不是 `TOKEN`；
/// `CLAUDE_CODE_SKIP_BEDROCK_AUTH` 只是个开关，`AUTH` 不算
pub fn is_secret_env(name: &str) -> bool {
    name.to_ascii_uppercase().split('_').any(|seg| {
        matches!(
            seg,
            "KEY" | "TOKEN" | "SECRET" | "PASSWORD" | "PASSWD" | "HEADERS"
        )
    })
}

/// Claude Code 的 settings.json 里装着凭据的那些值（`env` 底下，见 [`is_secret_env`]）。
/// **画 diff 之前拿它们打码**：`/setup-bedrock` 把 Bedrock 的 API key、访问密钥写在这里，
/// 而界面上画的是整份文件。解析不了的文件当没有
pub fn env_secrets(text: &str) -> Vec<String> {
    let Ok(Some(Val::Obj(env))) = crate::json::get(text, &["env"]) else {
        return Vec::new();
    };
    env.into_iter()
        .filter(|(k, _)| is_secret_env(k))
        .filter_map(|(_, v)| match v {
            Val::Str(s) => Some(s),
            _ => None,
        })
        .collect()
}

// ---------------------------------------------------------------- 按原来的设置新建 Bedrock 上游

/// 按一个客户端原来直连 Bedrock 时的设置新建 Bedrock 上游，要填的那几项。
///
/// **凭据只写成 `${变量名}` 或 profile 的名字**，明文一个字都不抄：客户端配置里写着的密钥
/// 留在那里，网关要用的话由用户自己填进上游对话框。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BedrockDraft {
    pub region: String,
    /// 客户端写了自己的 Bedrock 地址（VPC 端点、代理）：上游用它，区域另写
    pub base_url: Option<String>,
    pub auth: DraftAuth,
}

/// 新建的上游用哪种凭据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DraftAuth {
    /// Bedrock API key，写成 `${AWS_BEARER_TOKEN_BEDROCK}` 这样
    Key(String),
    /// 访问密钥，每一项都写成 `${变量名}`
    Keys {
        access_key_id: String,
        secret_access_key: String,
        session_token: Option<String>,
    },
    /// AWS 凭证文件里的 profile
    Profile(String),
    /// 没找到网关用得上的：新建时自己填
    None,
}

/// 写进上游配置的变量引用
fn var_ref(name: &str) -> String {
    format!("${{{name}}}")
}

/// 像不像一个区域名（`us-east-1`、`us-gov-west-1`）。Claude Code 把不像的当没写
fn is_region(v: &str) -> bool {
    let v = v.trim();
    v.contains('-')
        && v.ends_with(|c: char| c.is_ascii_digit())
        && v.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// AWS 那种 INI：节名 → 键 → 值。
///
/// 和 core 读 `aws.profile` 时一样认：节名里的空白压成一个空格，键不分大小写，值去掉两头
/// 空白，行尾的 `#` 不是注释，缩进的行是上一个键的子项（不是这一节的键）
type Ini = std::collections::HashMap<String, std::collections::HashMap<String, String>>;

fn parse_ini(text: &str) -> Ini {
    let mut out = Ini::new();
    let mut current: Option<String> = None;
    for line in text.lines() {
        let l = line.trim();
        if l.is_empty() || l.starts_with('#') || l.starts_with(';') {
            continue;
        }
        if let Some(name) = l.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
            let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
            out.entry(name.clone()).or_default();
            current = Some(name);
            continue;
        }
        if line.starts_with(char::is_whitespace) {
            continue;
        }
        if let (Some(sec), Some((k, v))) = (current.as_ref(), l.split_once('='))
            && let Some(s) = out.get_mut(sec)
        {
            s.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    out
}

/// AWS 的两个凭证文件，解析好了。
struct AwsFiles {
    credentials: Ini,
    config: Ini,
}

impl AwsFiles {
    /// 和 AWS CLI 一样找：`AWS_SHARED_CREDENTIALS_FILE`、`AWS_CONFIG_FILE` 给了就用，否则是
    /// `dir`（默认 `~/.aws`）下的 `credentials` 和 `config`。读不到的当空的
    fn read(dir: &Path, lookup: impl Fn(&str) -> Option<String>) -> AwsFiles {
        let file = |var: &str, name: &str| {
            let p = lookup(var)
                .filter(|v| !v.trim().is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| dir.join(name));
            parse_ini(&std::fs::read_to_string(p).unwrap_or_default())
        };
        AwsFiles {
            credentials: file("AWS_SHARED_CREDENTIALS_FILE", "credentials"),
            config: file("AWS_CONFIG_FILE", "config"),
        }
    }

    /// 这个 profile 在两个文件里的那两节：凭证文件里写 `[名字]`，配置文件里写
    /// `[profile 名字]`，只有 default 是 `[default]`
    fn sections(&self, profile: &str) -> [Option<&std::collections::HashMap<String, String>>; 2] {
        [
            self.credentials.get(profile),
            self.config
                .get(&format!("profile {profile}"))
                .or_else(|| self.config.get(profile).filter(|_| profile == "default")),
        ]
    }

    /// 这个 profile 里的区域：先凭证文件，后配置文件（和 Claude Code 的顺序一样）
    fn region(&self, profile: &str) -> Option<String> {
        self.sections(profile)
            .into_iter()
            .flatten()
            .find_map(|s| s.get("region").filter(|r| is_region(r)).cloned())
    }

    /// core 用得上这个 profile 吗。规则和 core 读 `aws.profile` 时一样：扮演角色、Web 身份、
    /// IAM Identity Center 排在文件里的密钥前面，`credential_process` 排在凭证文件的密钥之后
    fn usable(&self, profile: &str) -> Profile {
        const BEFORE_KEYS: &[&str] = &[
            "role_arn",
            "web_identity_token_file",
            "sso_session",
            "sso_start_url",
            "sso_account_id",
        ];
        let [creds, config] = self.sections(profile);
        if creds.is_none() && config.is_none() {
            return Profile::Missing;
        }
        let secs = || [creds, config].into_iter().flatten();
        if let Some(s) = BEFORE_KEYS
            .iter()
            .find(|k| secs().any(|sec| sec.contains_key(**k)))
        {
            return Profile::Unusable(s);
        }
        let keys = |sec: &std::collections::HashMap<String, String>| {
            ["aws_access_key_id", "aws_secret_access_key"]
                .iter()
                .all(|k| sec.get(*k).is_some_and(|v| !v.is_empty()))
        };
        if creds.is_some_and(keys) {
            return Profile::Keys;
        }
        if secs().any(|sec| sec.contains_key("credential_process")) {
            return Profile::Unusable("credential_process");
        }
        if config.is_some_and(keys) {
            Profile::Keys
        } else {
            Profile::NoKeys
        }
    }
}

/// 一个 profile 对 core 来说是什么样
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Profile {
    /// 文件里写着访问密钥
    Keys,
    /// 要跑程序、要登录才拿得到：是哪一项设置
    Unusable(&'static str),
    NoKeys,
    Missing,
}

/// 客户端拿凭据的一种网关用不了的办法，词表（`core.zh.json` 的 `aws_how`）按它说
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum How {
    /// Claude Code 的 `awsCredentialExport`
    CredentialExport,
    /// IAM Identity Center 登录（Claude Desktop 应用里登录）
    Sso,
    /// 凭据脚本（Claude Desktop 的 `inferenceCredentialHelper`）
    CredentialHelper,
    /// 经代理的身份提供方登录（Claude Desktop 的 `inferenceIdpOidc`）
    Idp,
}

impl How {
    fn slug(self) -> &'static str {
        match self {
            How::CredentialExport => "credential_export",
            How::Sso => "sso",
            How::CredentialHelper => "credential_helper",
            How::Idp => "idp",
        }
    }
    fn name(self) -> &'static str {
        match self {
            How::CredentialExport => "awsCredentialExport, a command Claude Code runs",
            How::Sso => "an IAM Identity Center sign-in",
            How::CredentialHelper => "a credential helper script",
            How::Idp => "an identity provider sign-in through a proxy",
        }
    }
}

/// 「这种拿凭据的办法网关用不了」那一句
pub(crate) fn unusable(client: &str, how: How) -> tw_types::Msg {
    let label = how.name();
    tw_types::msg!(
        "adopt.plan.bedrock_unusable", client = client, how = how.slug()
        => "{client} gets its AWS credentials through {label}, which the gateway cannot use: it \
            runs no commands and signs in nowhere. The new upstream needs a Bedrock API key, access \
            keys, or an AWS profile that holds access keys."
    )
}

/// 这个 profile 用不了、或者没找到能用的：说一句，凭据留给用户填
fn profile_note(client: &str, profile: &str, p: Profile) -> tw_types::Msg {
    match p {
        Profile::Unusable(setting) => tw_types::msg!(
            "adopt.plan.bedrock_profile_unusable", profile = profile, setting = setting
            => "AWS profile {profile} gets its credentials through {setting}, which the gateway \
                does not run. The new upstream needs a Bedrock API key, access keys, or an AWS \
                profile that holds access keys."
        ),
        _ => no_credential(client),
    }
}

/// 「没找到网关用得上的凭据」那一句
pub(crate) fn no_credential(client: &str) -> tw_types::Msg {
    tw_types::msg!(
        "adopt.plan.bedrock_no_credential", client = client
        => "No AWS credential of {client}'s that the gateway can use was found; the credentials of \
            the new upstream have to be entered when creating it."
    )
}

/// 草稿里引用的变量，core 的环境里没有的那几个，各说一句：只写在 settings.json 里的
/// （`/setup-bedrock` 就写在那里）点名那个文件，别的只说网关的环境里没有
fn unseen_notes(
    settings_path: &Path,
    settings: &str,
    around: &Around,
    names: &[&str],
) -> Vec<tw_types::Msg> {
    let Some(core) = &around.core_env else {
        return Vec::new();
    };
    let missing: Vec<&str> = names
        .iter()
        .copied()
        .filter(|n| !core.contains_key(*n))
        .collect();
    let (only_here, elsewhere): (Vec<&str>, Vec<&str>) = missing
        .into_iter()
        .partition(|n| env_val(settings, n).is_some());
    let mut out = Vec::new();
    if !only_here.is_empty() {
        out.push(tw_types::msg!(
            "adopt.plan.bedrock_settings_only",
            vars = only_here.join(", "),
            path = settings_path.display()
            => "{vars} is set only in {path}, which the gateway does not read: the new upstream can \
                use it once the gateway's environment has it, or the value can be entered when \
                creating the upstream."
        ));
    }
    if !elsewhere.is_empty() {
        out.push(tw_types::msg!(
            "adopt.plan.bedrock_unseen", vars = elsewhere.join(", ")
            => "The gateway's environment has no {vars}: the new upstream can use it once the \
                gateway's environment has it, or the value can be entered when creating the \
                upstream."
        ));
    }
    out
}

/// 按 Claude Code 原来直连 Bedrock 时的设置，新建 Bedrock 上游要填的，和关于凭据要说的话。
///
/// 找法照它自己的（Claude Code 文档 Amazon Bedrock 一页）：
/// - **区域**：`AWS_REGION`、`AWS_DEFAULT_REGION`、正在用的 profile（`AWS_PROFILE`，没有就是
///   `default`）里的 `region`（先凭证文件后配置文件），都没有就是 `us-east-1`；不像区域名的
///   当没写。
/// - **地址**：`ANTHROPIC_BEDROCK_BASE_URL`（打开的是 `CLAUDE_CODE_USE_BEDROCK` 才看：Mantle
///   的地址是另一套接口）。
/// - **凭据**：设了 `AWS_BEARER_TOKEN_BEDROCK` 就是它（Bedrock API key）；`awsCredentialExport`
///   是它自己跑的命令，网关不跑；再是环境里的访问密钥；再是 profile。
///
/// 变量的值按 [`effective`] 取：settings.json 的 `env` 盖过用户环境和 shell 配置。
pub fn claude_code_draft(
    home: &Path,
    settings_path: &Path,
    settings: &str,
    around: &Around,
    runtime: bool,
) -> (BedrockDraft, Vec<tw_types::Msg>) {
    const CLIENT: &str = "Claude Code";
    let get = |n: &str| effective(home, settings, around, n).filter(|v| !v.trim().is_empty());
    let files = AwsFiles::read(&home.join(".aws"), get);
    let profile = get("AWS_PROFILE");
    let region = ["AWS_REGION", "AWS_DEFAULT_REGION"]
        .into_iter()
        .find_map(|n| get(n).filter(|r| is_region(r)))
        .or_else(|| files.region(profile.as_deref().unwrap_or("default")))
        .unwrap_or_else(|| "us-east-1".to_string());
    let base_url = runtime.then(|| get("ANTHROPIC_BEDROCK_BASE_URL")).flatten();
    let setting = |k: &str| {
        crate::json::get(settings, &[k])
            .ok()
            .flatten()
            .and_then(|v| v.as_str().map(str::to_string))
            .filter(|v| !v.trim().is_empty())
    };

    let mut notes = Vec::new();
    let mut used: Vec<&str> = Vec::new();
    let auth = if get("AWS_BEARER_TOKEN_BEDROCK").is_some() {
        used.push("AWS_BEARER_TOKEN_BEDROCK");
        DraftAuth::Key(var_ref("AWS_BEARER_TOKEN_BEDROCK"))
    } else if setting("awsCredentialExport").is_some() {
        notes.push(unusable(CLIENT, How::CredentialExport));
        DraftAuth::None
    } else if get("AWS_ACCESS_KEY_ID").is_some() && get("AWS_SECRET_ACCESS_KEY").is_some() {
        used.extend(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]);
        let token = get("AWS_SESSION_TOKEN").is_some();
        if token {
            used.push("AWS_SESSION_TOKEN");
        }
        DraftAuth::Keys {
            access_key_id: var_ref("AWS_ACCESS_KEY_ID"),
            secret_access_key: var_ref("AWS_SECRET_ACCESS_KEY"),
            session_token: token.then(|| var_ref("AWS_SESSION_TOKEN")),
        }
    } else {
        let name = profile.clone().unwrap_or_else(|| "default".to_string());
        match files.usable(&name) {
            Profile::Keys => {
                if setting("awsAuthRefresh").is_some() {
                    notes.push(tw_types::msg!(
                        "adopt.plan.bedrock_refresh", path = settings_path.display()
                        => "{path} sets awsAuthRefresh, a command Claude Code runs when its AWS \
                            credentials expire. The gateway does not run it; it reads the AWS \
                            credential files again whenever they change."
                    ));
                }
                DraftAuth::Profile(name)
            }
            p => {
                notes.push(profile_note(CLIENT, &name, p));
                DraftAuth::None
            }
        }
    };
    notes.extend(unseen_notes(settings_path, settings, around, &used));
    (
        BedrockDraft {
            region,
            base_url,
            auth,
        },
        notes,
    )
}

/// 按 Claude Desktop 接管前那一份第三方推理配置（`profile` 是它的原文），新建 Bedrock 上游要
/// 填的，和关于凭据要说的话。
///
/// 键名照 Claude Desktop 的官方文档（third-party 的 configuration、bedrock、mantle 三页）：
/// - **区域** `inferenceBedrockRegion`，**地址** `inferenceBedrockBaseUrl`（Mantle 的地址是另一套
///   接口，不用）。
/// - **凭据**：`inferenceCredentialKind` 写了就只看它；没写就按应用自己的顺序找第一个在的 ——
///   身份提供方登录、应用里的 AWS 登录（四个 `inferenceBedrockSso*` 都写了才算）、profile、
///   凭据脚本、bearer token。Mantle 只认后两样。
/// - **bearer token 是明文写在这份配置里的**：不抄，上游写成 `${AWS_BEARER_TOKEN_BEDROCK}`，
///   说清楚要么让网关的环境里有这个变量，要么新建时自己填。
pub(crate) fn claude_desktop_draft(
    home: &Path,
    profile_path: &Path,
    profile: &str,
    cloud: Cloud,
    around: &Around,
) -> (BedrockDraft, Vec<tw_types::Msg>) {
    const CLIENT: &str = "Claude Desktop";
    let s = |k: &str| {
        crate::json::get(profile, &[k])
            .ok()
            .flatten()
            .and_then(|v| v.as_str().map(str::to_string))
            .filter(|v| !v.trim().is_empty())
    };
    // 写了、而且不是空的（对象、列表也算）
    let present = |k: &str| match crate::json::get(profile, &[k]).ok().flatten() {
        None | Some(Val::Null) => false,
        Some(Val::Str(v)) => !v.trim().is_empty(),
        Some(_) => true,
    };
    let region = s("inferenceBedrockRegion")
        .filter(|r| is_region(r))
        .unwrap_or_else(|| "us-east-1".to_string());
    let base_url = (cloud == Cloud::Bedrock)
        .then(|| s("inferenceBedrockBaseUrl"))
        .flatten();

    #[derive(PartialEq)]
    enum Source {
        Idp,
        Sso,
        Profile,
        Helper,
        Bearer,
        Nothing,
    }
    let runtime = cloud == Cloud::Bedrock;
    let sso = runtime
        && [
            "inferenceBedrockSsoStartUrl",
            "inferenceBedrockSsoRegion",
            "inferenceBedrockSsoAccountId",
            "inferenceBedrockSsoRoleName",
        ]
        .iter()
        .all(|k| present(k));
    let source = match s("inferenceCredentialKind").as_deref() {
        Some("static") => Source::Bearer,
        Some("helper-script") => Source::Helper,
        Some("interactive") => Source::Sso,
        Some("vendor-profile") => Source::Profile,
        Some("external-idp") => Source::Idp,
        _ if runtime && present("inferenceIdpOidc") => Source::Idp,
        _ if sso => Source::Sso,
        _ if runtime && present("inferenceBedrockProfile") => Source::Profile,
        _ if present("inferenceCredentialHelper") => Source::Helper,
        _ if present("inferenceBedrockBearerToken") => Source::Bearer,
        _ => Source::Nothing,
    };

    let mut notes = Vec::new();
    let auth = match source {
        Source::Bearer => {
            notes.push(tw_types::msg!(
                "adopt.plan.claude_desktop.bedrock_key", path = profile_path.display()
                => "Claude Desktop keeps its Bedrock API key in {path}, which the gateway does not \
                    read. The new upstream reads the key from AWS_BEARER_TOKEN_BEDROCK, which has \
                    to hold it in the gateway's environment; otherwise the key can be entered when \
                    creating the upstream."
            ));
            DraftAuth::Key(var_ref("AWS_BEARER_TOKEN_BEDROCK"))
        }
        Source::Profile => {
            let name = s("inferenceBedrockProfile").unwrap_or_else(|| "default".to_string());
            // 网关读的是它自己环境里说的那两个文件
            let core = |n: &str| around.core_env.as_ref().and_then(|e| e.get(n).cloned());
            let aws = home.join(".aws");
            match AwsFiles::read(&aws, core).usable(&name) {
                Profile::Keys => {
                    if let Some(dir) =
                        s("inferenceBedrockAwsDir").filter(|d| Path::new(d.trim()) != aws.as_path())
                    {
                        notes.push(tw_types::msg!(
                            "adopt.plan.claude_desktop.aws_dir", dir = dir, profile = name.clone()
                            => "Claude Desktop reads AWS profile {profile} from {dir}, while the \
                                gateway reads the AWS credential files in ~/.aws unless \
                                AWS_SHARED_CREDENTIALS_FILE and AWS_CONFIG_FILE name other files."
                        ));
                    }
                    DraftAuth::Profile(name)
                }
                p => {
                    notes.push(profile_note(CLIENT, &name, p));
                    DraftAuth::None
                }
            }
        }
        Source::Helper => {
            notes.push(unusable(CLIENT, How::CredentialHelper));
            DraftAuth::None
        }
        Source::Sso => {
            notes.push(unusable(CLIENT, How::Sso));
            DraftAuth::None
        }
        Source::Idp => {
            notes.push(unusable(CLIENT, How::Idp));
            DraftAuth::None
        }
        Source::Nothing => {
            notes.push(no_credential(CLIENT));
            DraftAuth::None
        }
    };
    (
        BedrockDraft {
            region,
            base_url,
            auth,
        },
        notes,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn settings_at(h: &Path) -> PathBuf {
        h.join(".claude/settings.json")
    }

    #[test]
    fn a_switch_is_on_exactly_when_claude_code_would_say_so() {
        for v in ["1", "true", "TRUE", " yes ", "On"] {
            assert!(is_on(v), "{v}");
        }
        for v in ["", "0", "false", "no", "off", "2", "enabled"] {
            assert!(!is_on(v), "{v}");
        }
    }

    #[test]
    fn a_switch_in_settings_json_is_found_and_an_empty_one_is_not() {
        let h = home();
        let s = r#"{"env": {"CLAUDE_CODE_USE_BEDROCK": "1", "CLAUDE_CODE_USE_VERTEX": ""}}"#;
        let on = switches(h.path(), &settings_at(h.path()), s, &[], &Around::default());
        assert_eq!(
            on,
            vec![On {
                name: "CLAUDE_CODE_USE_BEDROCK",
                cloud: Cloud::Bedrock,
                at: Where::Settings(settings_at(h.path())),
            }]
        );
    }

    /// settings.json 里写了（哪怕是关着的）就是它说了算：shell 里 export 的盖不过它
    #[test]
    #[cfg(not(windows))]
    fn settings_json_wins_over_the_shell() {
        let h = home();
        std::fs::write(
            h.path().join(".zshrc"),
            "export CLAUDE_CODE_USE_BEDROCK=1\nexport CLAUDE_CODE_USE_MANTLE=true\n",
        )
        .unwrap();
        let s = r#"{"env": {"CLAUDE_CODE_USE_BEDROCK": ""}}"#;
        let on = switches(h.path(), &settings_at(h.path()), s, &[], &Around::default());
        assert_eq!(on.len(), 1, "{on:?}");
        assert_eq!(on[0].name, "CLAUDE_CODE_USE_MANTLE");
        assert_eq!(
            on[0].at,
            Where::Shell {
                path: h.path().join(".zshrc"),
                line: 2
            }
        );
    }

    /// shell 里写的是 0、false 的不算；认不出值的（`export NAME`）算
    #[test]
    #[cfg(not(windows))]
    fn a_shell_export_counts_unless_it_clearly_says_off() {
        let h = home();
        std::fs::write(
            h.path().join(".bashrc"),
            "export CLAUDE_CODE_USE_BEDROCK=0\nexport CLAUDE_CODE_USE_VERTEX\n",
        )
        .unwrap();
        let on = switches(
            h.path(),
            &settings_at(h.path()),
            "{}",
            &[],
            &Around::default(),
        );
        let names: Vec<_> = on.iter().map(|o| o.name).collect();
        assert_eq!(names, ["CLAUDE_CODE_USE_VERTEX"]);
    }

    #[test]
    fn a_switch_only_the_environment_has_is_found_too() {
        let h = home();
        let around = Around {
            env: [("CLAUDE_CODE_USE_BEDROCK".into(), "1".into())].into(),
            ..Default::default()
        };
        let on = switches(h.path(), &settings_at(h.path()), "{}", &[], &around);
        assert_eq!(on[0].at, Where::Environment);
        assert!(on[0].at.turned_off_here());
    }

    /// 托管配置里写了就是它说了算：打开着的关不掉，关着的就不再往下看
    #[test]
    fn a_managed_configuration_decides_on_its_own() {
        let h = home();
        let m = h.path().join("managed-settings.json");
        let d = h.path().join("10-cloud.json");
        std::fs::write(&m, r#"{"env": {"CLAUDE_CODE_USE_BEDROCK": "1"}}"#).unwrap();
        // 分片后读，写了空串的那一个赢
        std::fs::write(
            &d,
            r#"{"env": {"CLAUDE_CODE_USE_VERTEX": "1", "CLAUDE_CODE_USE_BEDROCK": ""}}"#,
        )
        .unwrap();
        let around = Around {
            managed: vec![m, d.clone()],
            ..Default::default()
        };
        let s = r#"{"env": {"CLAUDE_CODE_USE_BEDROCK": "1"}}"#;
        let on = switches(h.path(), &settings_at(h.path()), s, &[], &around);
        assert_eq!(
            on,
            vec![On {
                name: "CLAUDE_CODE_USE_VERTEX",
                cloud: Cloud::Vertex,
                at: Where::Managed(d),
            }]
        );
        assert!(!on[0].at.turned_off_here());
    }

    /// 比 settings.json 优先的文件只管某个目录：报出来，但下面的照样要关
    #[test]
    fn a_higher_file_is_reported_and_the_rest_still_counts() {
        let h = home();
        let local = h.path().join(".claude/settings.local.json");
        std::fs::create_dir_all(local.parent().unwrap()).unwrap();
        std::fs::write(&local, r#"{"env": {"CLAUDE_CODE_USE_BEDROCK": "true"}}"#).unwrap();
        let s = r#"{"env": {"CLAUDE_CODE_USE_BEDROCK": "1"}}"#;
        let on = switches(
            h.path(),
            &settings_at(h.path()),
            s,
            std::slice::from_ref(&local),
            &Around::default(),
        );
        let at: Vec<_> = on.iter().map(|o| o.at.clone()).collect();
        assert_eq!(
            at,
            vec![Where::Above(local), Where::Settings(settings_at(h.path()))]
        );
    }

    #[test]
    fn the_models_that_would_go_out_by_anthropic_names_are_listed() {
        let h = home();
        let s = r#"{"model": "opusplan", "env": {
            "ANTHROPIC_DEFAULT_OPUS_MODEL": "us.anthropic.claude-opus-4-8",
            "ANTHROPIC_SMALL_FAST_MODEL": "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/x"
        }}"#;
        assert_eq!(
            unpinned_models(h.path(), s, &Around::default()),
            ["ANTHROPIC_DEFAULT_SONNET_MODEL"]
        );
        // 主模型写成了 Anthropic 的名字：它也会原样发出去
        let around = Around {
            env: [("ANTHROPIC_MODEL".into(), "claude-sonnet-4-5".into())].into(),
            ..Default::default()
        };
        assert_eq!(
            unpinned_models(h.path(), s, &around),
            ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL"]
        );
        let all = r#"{"env": {
            "ANTHROPIC_DEFAULT_OPUS_MODEL": "global.anthropic.claude-opus-5-5",
            "ANTHROPIC_DEFAULT_SONNET_MODEL": "us.anthropic.claude-sonnet-4-5-20250929-v1:0[1m]",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL": "anthropic.claude-haiku-4-5",
            "ANTHROPIC_MODEL": "sonnet[1m]"
        }}"#;
        assert!(unpinned_models(h.path(), all, &Around::default()).is_empty());
    }

    #[test]
    fn credentials_in_the_env_block_are_picked_out_by_name() {
        let s = r#"{"env": {
            "AWS_BEARER_TOKEN_BEDROCK": "ABSKQmVkcm9ja0FQSUtleQ",
            "AWS_ACCESS_KEY_ID": "AKIAIOSFODNN7EXAMPLE",
            "AWS_SECRET_ACCESS_KEY": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            "AWS_REGION": "us-west-2",
            "MY_SERVICE_API_KEY": "svc-123456789",
            "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "32000",
            "CLAUDE_CODE_SKIP_BEDROCK_AUTH": "1",
            "CLAUDE_CODE_USE_BEDROCK": "1"
        }}"#;
        let mut got = env_secrets(s);
        got.sort();
        assert_eq!(
            got,
            [
                "ABSKQmVkcm9ja0FQSUtleQ",
                "AKIAIOSFODNN7EXAMPLE",
                "svc-123456789",
                "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            ]
        );
        assert!(env_secrets("not json").is_empty());
    }

    // ---- 按原来的设置新建 Bedrock 上游 ----

    fn draft(h: &Path, settings: &str, around: &Around) -> (BedrockDraft, Vec<tw_types::Msg>) {
        claude_code_draft(h, &settings_at(h), settings, around, true)
    }

    fn codes(notes: &[tw_types::Msg]) -> Vec<&str> {
        notes.iter().map(|n| n.code.as_str()).collect()
    }

    fn aws(h: &Path, file: &str, text: &str) {
        std::fs::create_dir_all(h.join(".aws")).unwrap();
        std::fs::write(h.join(".aws").join(file), text).unwrap();
    }

    /// `/setup-bedrock` 写出来的那种：API key 在 settings.json 里。**上游只写变量引用**；
    /// 网关的环境里没有这个变量时，点名它只写在那个文件里
    #[test]
    fn an_api_key_in_settings_json_becomes_a_reference_the_gateway_may_not_see() {
        let h = home();
        let s = r#"{"env": {"CLAUDE_CODE_USE_BEDROCK": "1", "AWS_REGION": "us-west-2",
            "AWS_BEARER_TOKEN_BEDROCK": "ABSK-明文密钥"}}"#;
        let local = Around {
            core_env: Some(BTreeMap::new()),
            ..Default::default()
        };
        let (d, notes) = draft(h.path(), s, &local);
        assert_eq!(
            d,
            BedrockDraft {
                region: "us-west-2".into(),
                base_url: None,
                auth: DraftAuth::Key("${AWS_BEARER_TOKEN_BEDROCK}".into()),
            }
        );
        assert_eq!(codes(&notes), ["adopt.plan.bedrock_settings_only"]);
        assert_eq!(notes[0].args["vars"], "AWS_BEARER_TOKEN_BEDROCK");
        assert!(!format!("{d:?}{notes:?}").contains("ABSK-明文密钥"));
        // 网关的环境里有它：不用说；连着远程 core（不知道）：也不说
        let seen = Around {
            core_env: Some([("AWS_BEARER_TOKEN_BEDROCK".into(), "x".into())].into()),
            ..Default::default()
        };
        assert!(draft(h.path(), s, &seen).1.is_empty());
        assert!(draft(h.path(), s, &Around::default()).1.is_empty());
    }

    /// 区域的找法和 Claude Code 一样：两个变量、正在用的 profile 里的、`us-east-1`；
    /// 不像区域名的当没写
    #[test]
    fn the_region_is_found_the_way_claude_code_finds_it() {
        let h = home();
        aws(
            h.path(),
            "config",
            "[default]\nregion = eu-west-3\n[profile dev]\nregion = ap-northeast-1\n",
        );
        let region = |s: &str| draft(h.path(), s, &Around::default()).0.region;
        assert_eq!(
            region(r#"{"env": {"AWS_REGION": "us east", "AWS_DEFAULT_REGION": "eu-central-1"}}"#),
            "eu-central-1"
        );
        assert_eq!(
            region(r#"{"env": {"AWS_PROFILE": "dev"}}"#),
            "ap-northeast-1"
        );
        assert_eq!(region("{}"), "eu-west-3");
        let bare = home();
        assert_eq!(
            draft(bare.path(), "{}", &Around::default()).0.region,
            "us-east-1"
        );
    }

    /// 凭据的先后：API key、`awsCredentialExport`（网关不跑命令）、环境里的访问密钥、profile
    #[test]
    fn credentials_are_picked_in_claude_codes_order() {
        let h = home();
        let env = |pairs: &[(&str, &str)]| Around {
            env: pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            ..Default::default()
        };
        let keys = env(&[
            ("AWS_ACCESS_KEY_ID", "AKIA"),
            ("AWS_SECRET_ACCESS_KEY", "s"),
            ("AWS_SESSION_TOKEN", "t"),
        ]);
        assert_eq!(
            draft(h.path(), "{}", &keys).0.auth,
            DraftAuth::Keys {
                access_key_id: "${AWS_ACCESS_KEY_ID}".into(),
                secret_access_key: "${AWS_SECRET_ACCESS_KEY}".into(),
                session_token: Some("${AWS_SESSION_TOKEN}".into()),
            }
        );
        let export = r#"{"awsCredentialExport": "/bin/generate_aws_grant.sh"}"#;
        let (d, notes) = draft(h.path(), export, &keys);
        assert_eq!(d.auth, DraftAuth::None);
        assert_eq!(codes(&notes), ["adopt.plan.bedrock_unusable"]);
        assert_eq!(notes[0].args["how"], "credential_export");
        let with_key = env(&[("AWS_BEARER_TOKEN_BEDROCK", "k")]);
        assert_eq!(
            draft(h.path(), export, &with_key).0.auth,
            DraftAuth::Key("${AWS_BEARER_TOKEN_BEDROCK}".into())
        );
    }

    /// profile：写着访问密钥的能用；要登录、要跑命令的说清是哪一项；`awsAuthRefresh` 说一声
    /// 网关不跑它、但文件变了会重读
    #[test]
    fn a_profile_is_used_only_when_it_holds_access_keys() {
        let h = home();
        aws(
            h.path(),
            "credentials",
            "[dev]\naws_access_key_id = AKIA\naws_secret_access_key = s\n",
        );
        aws(
            h.path(),
            "config",
            "[profile sso]\nsso_session = corp\n[profile proc]\ncredential_process = /bin/creds\n",
        );
        let with = |p: &str, extra: &str| {
            draft(
                h.path(),
                &format!(r#"{{{extra}"env": {{"AWS_PROFILE": "{p}"}}}}"#),
                &Around::default(),
            )
        };
        let (d, notes) = with("dev", r#""awsAuthRefresh": "aws sso login", "#);
        assert_eq!(d.auth, DraftAuth::Profile("dev".into()));
        assert_eq!(codes(&notes), ["adopt.plan.bedrock_refresh"]);
        for (p, setting) in [("sso", "sso_session"), ("proc", "credential_process")] {
            let (d, notes) = with(p, "");
            assert_eq!(d.auth, DraftAuth::None, "{p}");
            assert_eq!(codes(&notes), ["adopt.plan.bedrock_profile_unusable"]);
            assert_eq!(notes[0].args["setting"], setting);
        }
        let (d, notes) = with("nowhere", "");
        assert_eq!(d.auth, DraftAuth::None);
        assert_eq!(codes(&notes), ["adopt.plan.bedrock_no_credential"]);
    }

    /// 自己的 Bedrock 地址（VPC 端点、代理）带过去；只开了 Mantle 的不带 —— 那是另一套接口
    #[test]
    fn a_custom_bedrock_address_is_kept_for_the_invoke_api_only() {
        let h = home();
        let s = r#"{"env": {"ANTHROPIC_BEDROCK_BASE_URL": "https://vpce-1.bedrock-runtime.us-east-1.vpce.amazonaws.com"}}"#;
        let (d, _) = draft(h.path(), s, &Around::default());
        assert_eq!(
            d.base_url.as_deref(),
            Some("https://vpce-1.bedrock-runtime.us-east-1.vpce.amazonaws.com")
        );
        let (mantle, _) = claude_code_draft(
            h.path(),
            &settings_at(h.path()),
            s,
            &Around::default(),
            false,
        );
        assert_eq!(mantle.base_url, None);
    }

    fn desktop(h: &Path, profile: &str, cloud: Cloud) -> (BedrockDraft, Vec<tw_types::Msg>) {
        claude_desktop_draft(
            h,
            Path::new("/lib/p.json"),
            profile,
            cloud,
            &Around::default(),
        )
    }

    /// Claude Desktop 的 bearer token 明文写在它的配置里：不抄，写成变量引用并说清楚
    #[test]
    fn claude_desktops_bearer_token_is_never_copied() {
        let h = home();
        let p = r#"{"inferenceProvider": "bedrock", "inferenceBedrockRegion": "eu-west-1",
            "inferenceBedrockBaseUrl": "https://bedrock-proxy.corp.example",
            "inferenceBedrockBearerToken": "ABSK-明文"}"#;
        let (d, notes) = desktop(h.path(), p, Cloud::Bedrock);
        assert_eq!(
            d,
            BedrockDraft {
                region: "eu-west-1".into(),
                base_url: Some("https://bedrock-proxy.corp.example".into()),
                auth: DraftAuth::Key("${AWS_BEARER_TOKEN_BEDROCK}".into()),
            }
        );
        assert_eq!(codes(&notes), ["adopt.plan.claude_desktop.bedrock_key"]);
        assert!(!format!("{d:?}{notes:?}").contains("ABSK-明文"));
    }

    /// 凭据按应用自己的顺序：写了 `inferenceCredentialKind` 就只看它，没写就找第一个在的
    #[test]
    fn claude_desktops_credential_follows_its_own_order() {
        let h = home();
        aws(
            h.path(),
            "credentials",
            "[team]\naws_access_key_id = AKIA\naws_secret_access_key = s\n",
        );
        let sso = r#""inferenceBedrockSsoStartUrl": "https://corp.awsapps.com/start",
            "inferenceBedrockSsoRegion": "us-east-1", "inferenceBedrockSsoAccountId": "123456789012",
            "inferenceBedrockSsoRoleName": "Bedrock""#;
        // 四个 SSO 键都在，排在 profile 前面
        let (d, notes) = desktop(
            h.path(),
            &format!(r#"{{{sso}, "inferenceBedrockProfile": "team"}}"#),
            Cloud::Bedrock,
        );
        assert_eq!(d.auth, DraftAuth::None);
        assert_eq!(notes[0].args["how"], "sso");
        // 明说用 profile
        let (d, _) = desktop(
            h.path(),
            &format!(
                r#"{{{sso}, "inferenceCredentialKind": "vendor-profile", "inferenceBedrockProfile": "team"}}"#
            ),
            Cloud::Bedrock,
        );
        assert_eq!(d.auth, DraftAuth::Profile("team".into()));
        // profile 在别的目录里：网关看的是 ~/.aws
        let (_, notes) = desktop(
            h.path(),
            r#"{"inferenceBedrockProfile": "team", "inferenceBedrockAwsDir": "/Volumes/corp/aws"}"#,
            Cloud::Bedrock,
        );
        assert_eq!(codes(&notes), ["adopt.plan.claude_desktop.aws_dir"]);
        // 凭据脚本
        let (d, notes) = desktop(
            h.path(),
            r#"{"inferenceCredentialHelper": "/usr/local/bin/tok"}"#,
            Cloud::Bedrock,
        );
        assert_eq!(d.auth, DraftAuth::None);
        assert_eq!(notes[0].args["how"], "credential_helper");
        // Mantle 不认 profile
        let (d, notes) = desktop(
            h.path(),
            r#"{"inferenceBedrockProfile": "team"}"#,
            Cloud::Mantle,
        );
        assert_eq!(d.auth, DraftAuth::None);
        assert_eq!(codes(&notes), ["adopt.plan.bedrock_no_credential"]);
    }
}
