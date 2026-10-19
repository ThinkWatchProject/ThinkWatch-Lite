//! 导入链接：`thinkwatch://import?service=…&name=…&url=…&key=…&…`（第二版，第一版的链接照样能用）。
//!
//! 中转站、服务商、企业网关把这样一条链接交给用户，点开之后应用打开**新建上游对话框**，按链接
//! 预填。官网的 `https://thinkwat.ch/import#<同样的参数>` 读完片段之后打开的也是这条链接。
//!
//! **每一条链接都当作恶意的来处理**：任何网页都能触发它。所以：
//!
//! - 只认这里列出的参数（[`Param`]），每一项都是新建对话框里**这种服务、这种认证方式下
//!   显示的一栏**（[`SERVICES`]，和界面的服务类型对得上由 `tests/ts_bindings.rs` 生成的
//!   `src/generated/import-services.json` 和界面那边的测试核对）。对话框自己填的一项，链接给的
//!   得和它填的一样。同一个参数出现两次、编码不规整、值不合规矩，整条作废；每一项和整条都有
//!   长度上限。
//! - 永远不收的（[`NEVER`]）：出站代理（链接不知道这台机器的网络）、AWS profile 和 `${变量名}`
//!   （会让应用读这台机器上的凭据、环境变量，发给链接的主机）、别名、路由、默认上游、权重
//!   （会把已经接好的客户端引到别处）、停用、只用于检测的 OAuth access token。
//! - **不认识的参数不再悄悄作废**：交给界面一个「无法导入」（[`ImportLink::Unsupported`]），
//!   有新版本时给更新。参数名只在是 `^[a-z0-9_]{1,32}$` 时拿给人看。
//! - 接口地址只收 `https://`；`http://` 只给本机回环地址和内网（私有网段的 IP、单段的主机名、
//!   `.lan`、`.corp` 这类内网后缀，见 [`plain_http_ok`]）—— 公司内网的企业网关常是明文的，
//!   手动添加时密钥照样明文发过去，拒掉链接不多一分安全；对话框写明这个地址不加密。不带账号
//!   密码、查询串、片段；主机名一律转成 ASCII（IDN 转 punycode）给人看，防形近字。
//! - **任何一个值都不收 `$`、`{`、`}`**：core 会把 `${变量名}` 换成这台机器上的环境变量
//!   （`tw_secret::expand`，`$${` 是它的转义），一条 `key=${OPENAI_API_KEY}` 的链接就能把
//!   用户自己的密钥发到对方的主机上。控制字符、看不见的字符也不收。
//! - 链接只产生一份**提议**。点「下一步」（检测连接）或开始登录之前不写配置、不发任何网络
//!   请求（链接不该能让应用去探内网）。创建只新建一个上游，不改、不覆盖、不删已有的，
//!   也不设成默认、不加进路由。
//! - 同一时间只处理一条：对话框开着时再来的链接直接丢掉，不再把窗口拉到前面。
//! - 链接里的内容不进 shell、`open`、子进程、文件路径；界面拿到的是这里校验完的结构，
//!   保存走白名单里的控制面端点。

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tw_api::{BalanceSetting, Billing, Protocol, ZaiFamily};

use crate::wire::{
    ImportAuth, ImportAwsKeys, ImportHeader, ImportLink, ImportOAuth, ImportPrice, ImportProposal,
    ImportService, ImportSheet, ImportSpec, ShareLink,
};

/// 链接的前缀。主机名那一段不分大小写
pub const PREFIX: &str = "thinkwatch://import";

/// 整条链接的上限
pub const MAX_LINK: usize = 8192;
pub const MAX_NAME: usize = 64;
pub const MAX_URL: usize = 2048;
pub const MAX_KEY: usize = 512;
/// Refresh token、AWS 会话令牌
pub const MAX_LONG_KEY: usize = 4096;
pub const MAX_MODEL: usize = 128;
/// 模型清单、启用范围、规格、价格各自最多几项
pub const MAX_MODELS: usize = 64;
pub const MAX_HEADERS: usize = 16;
pub const MAX_HEADER_NAME: usize = 64;
pub const MAX_HEADER_VALUE: usize = 1024;
pub const MAX_CONCURRENCY: u32 = 1000;
/// 规格里上下文窗口、输出上限的上限
pub const MAX_SPEC_TOKENS: u32 = 10_000_000;

/// 对话框关掉之后这么久之内再来的链接不理：一个反复触发链接的网页不能在用户点了
/// 「取消」之后马上又把对话框弹回来
const COOLDOWN: Duration = Duration::from_secs(3);
/// 交出去之后界面一直没来取（网页没挂上）：过了这么久，下一条链接可以顶替它
const STALE: Duration = Duration::from_secs(60);

// ---------------------------------------------------------- 参数

/// 认识的参数
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Param {
    Service,
    Auth,
    Site,
    Name,
    Url,
    Protocol,
    Key,
    OauthEndpoint,
    OauthRefresh,
    OauthClientId,
    OauthClientSecret,
    Region,
    AwsAccessKeyId,
    AwsSecretAccessKey,
    AwsSessionToken,
    Headers,
    ClientIdentity,
    Concurrency,
    Balance,
    Models,
    ModelsOnly,
    Specs,
    Billing,
    PriceMultiplier,
    Prices,
}

impl Param {
    pub const ALL: &[Self] = &[
        Self::Service,
        Self::Auth,
        Self::Site,
        Self::Name,
        Self::Url,
        Self::Protocol,
        Self::Key,
        Self::OauthEndpoint,
        Self::OauthRefresh,
        Self::OauthClientId,
        Self::OauthClientSecret,
        Self::Region,
        Self::AwsAccessKeyId,
        Self::AwsSecretAccessKey,
        Self::AwsSessionToken,
        Self::Headers,
        Self::ClientIdentity,
        Self::Concurrency,
        Self::Balance,
        Self::Models,
        Self::ModelsOnly,
        Self::Specs,
        Self::Billing,
        Self::PriceMultiplier,
        Self::Prices,
    ];

    /// 链接里的写法
    pub fn name(self) -> &'static str {
        match self {
            Self::Service => "service",
            Self::Auth => "auth",
            Self::Site => "site",
            Self::Name => "name",
            Self::Url => "url",
            Self::Protocol => "protocol",
            Self::Key => "key",
            Self::OauthEndpoint => "oauth_endpoint",
            Self::OauthRefresh => "oauth_refresh",
            Self::OauthClientId => "oauth_client_id",
            Self::OauthClientSecret => "oauth_client_secret",
            Self::Region => "region",
            Self::AwsAccessKeyId => "aws_access_key_id",
            Self::AwsSecretAccessKey => "aws_secret_access_key",
            Self::AwsSessionToken => "aws_session_token",
            Self::Headers => "headers",
            Self::ClientIdentity => "client_identity",
            Self::Concurrency => "concurrency",
            Self::Balance => "balance",
            Self::Models => "models",
            Self::ModelsOnly => "models_only",
            Self::Specs => "specs",
            Self::Billing => "billing",
            Self::PriceMultiplier => "price_multiplier",
            Self::Prices => "prices",
        }
    }

    fn from_name(n: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|p| p.name() == n)
    }
}

/// 认得、但永远不收的参数：和值不合规矩一样整条作废，不说「无法导入」。三方约定的那一份名单，
/// 别的不认识的名字一律说「无法导入」
pub const NEVER: &[&str] = &[
    "proxy",
    "on_proxy_fail",
    "aws_profile",
    "alias",
    "aliases",
    "route",
    "routes",
    "default",
    "weight",
    "disabled",
    "oauth_access",
];

/// 链接为什么被拒。**不带链接里的内容**：写进日志的只有这个
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejected {
    NotImport,
    TooLong,
    Malformed,
    Encoding,
    DuplicateParam,
    Empty,
    /// 永远不收的参数（[`NEVER`]）
    NeverAccepted,
    /// 这一项的值不合规矩
    Invalid(Param),
    /// 这种服务、这种认证方式的对话框里没有这一栏，或者这一栏是对话框自己填的、链接给的不一样
    NotOffered(Param),
    /// 少了必填的一项
    Missing(Param),
}

impl Rejected {
    /// 这一条落在哪一项上（整条的毛病是 None）
    pub fn param(self) -> Option<Param> {
        match self {
            Self::Invalid(p) | Self::NotOffered(p) | Self::Missing(p) => Some(p),
            _ => None,
        }
    }
}

// ---------------------------------------------------------- 服务类型

/// 链接里的四种协议。ChatGPT 账号要登录、Bedrock 要它自己的凭据，都由服务类型定
pub const LINK_PROTOCOLS: &[Protocol] = &[
    Protocol::Anthropic,
    Protocol::OpenaiChat,
    Protocol::OpenaiResponses,
    Protocol::Gemini,
];

/// 地址那一栏
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Address {
    /// 没有固定地址（中转、企业网关、自定义）：给了 `service` 时链接得带 `url`
    Required,
    /// 这种服务自己的地址。链接给的话得一模一样
    Own { address: &'static str },
    /// Z.ai / BigModel：按站点定。链接给的话是两个标准地址之一，和站点对得上
    Site,
    /// Bedrock：不给按区域生成标准地址；给了是 VPC 端点、代理这类，照用
    Endpoint { default: &'static str },
    /// Ollama：不给是本机的默认地址，给了照用
    Local { default: &'static str },
}

/// 协议那一栏
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Protocols {
    /// 这种服务定了，不显示：链接给的话得一样。`None` 是自动识别（企业网关）
    Fixed { protocol: Option<Protocol> },
    /// 在这几种里选（「全部」时是链接收的那四种）
    Choice { protocols: &'static [Protocol] },
}

/// API 密钥那一栏
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyField {
    Required,
    Optional,
    /// 不显示（本机的 Ollama）：链接不能给
    None,
}

/// 一种服务的新建对话框显示哪几栏。和 `presets.ts` 的 `PRESETS`、`upstreamForm.ts` 的
/// `fieldRules` 说的是同一件事，由界面那边的测试拿生成的 JSON 核对
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Service {
    pub id: ImportService,
    /// 链接能选的认证方式，第一个是默认
    pub auth: &'static [ImportAuth],
    pub address: Address,
    pub protocols: Protocols,
    pub key: KeyField,
    /// 「转发客户端身份」
    pub client_identity: bool,
    /// 余额从哪里读由链接写（只有「自定义」：别的服务自己定）
    pub balance: bool,
    /// 计费方式的默认值
    pub billing: Billing,
}

const KEY: &[ImportAuth] = &[ImportAuth::Key];

const fn vendor(id: ImportService, address: &'static str, protocol: Protocol) -> Service {
    Service {
        id,
        auth: KEY,
        address: Address::Own { address },
        protocols: Protocols::Fixed {
            protocol: Some(protocol),
        },
        key: KeyField::Required,
        client_identity: false,
        balance: false,
        billing: Billing::PerToken,
    }
}

const fn relay(id: ImportService) -> Service {
    Service {
        id,
        auth: KEY,
        address: Address::Required,
        protocols: Protocols::Choice {
            protocols: LINK_PROTOCOLS,
        },
        key: KeyField::Required,
        client_identity: true,
        balance: false,
        billing: Billing::PerToken,
    }
}

/// Z.ai / BigModel 的两个标准地址（`presets.ts` 的 `ZAI_ENDPOINTS`）
pub const ZAI_ZAI: &str = "https://api.z.ai/api/anthropic";
pub const ZAI_BIGMODEL: &str = "https://open.bigmodel.cn/api/anthropic";

/// 不给区域时 Bedrock 的地址（`presets.ts` 里那一格的地址）
pub const BEDROCK_DEFAULT_REGION: &str = "us-east-1";

/// 新建对话框第一步的那几格，顺序和 `PRESETS` 一样
pub const SERVICES: &[Service] = &[
    vendor(
        ImportService::Anthropic,
        "https://api.anthropic.com",
        Protocol::Anthropic,
    ),
    Service {
        auth: &[ImportAuth::Key, ImportAuth::Account],
        protocols: Protocols::Choice {
            protocols: &[Protocol::OpenaiChat, Protocol::OpenaiResponses],
        },
        ..vendor(
            ImportService::Openai,
            "https://api.openai.com",
            Protocol::OpenaiChat,
        )
    },
    vendor(
        ImportService::Gemini,
        "https://generativelanguage.googleapis.com",
        Protocol::Gemini,
    ),
    vendor(
        ImportService::Deepseek,
        "https://api.deepseek.com/anthropic",
        Protocol::Anthropic,
    ),
    Service {
        auth: &[ImportAuth::Key, ImportAuth::Account],
        address: Address::Site,
        ..vendor(ImportService::Zai, ZAI_ZAI, Protocol::Anthropic)
    },
    Service {
        auth: &[ImportAuth::Key, ImportAuth::AwsKeys],
        address: Address::Endpoint {
            default: "https://bedrock-runtime.us-east-1.amazonaws.com",
        },
        protocols: Protocols::Fixed {
            protocol: Some(Protocol::Bedrock),
        },
        ..vendor(ImportService::Bedrock, "", Protocol::Bedrock)
    },
    vendor(
        ImportService::Openrouter,
        "https://openrouter.ai/api",
        Protocol::OpenaiChat,
    ),
    Service {
        protocols: Protocols::Fixed { protocol: None },
        client_identity: false,
        ..relay(ImportService::Thinkwatch)
    },
    relay(ImportService::Sub2api),
    relay(ImportService::Newapi),
    Service {
        address: Address::Local {
            default: "http://127.0.0.1:11434",
        },
        key: KeyField::None,
        billing: Billing::Free,
        ..vendor(ImportService::Ollama, "", Protocol::OpenaiChat)
    },
    Service {
        auth: &[ImportAuth::Key, ImportAuth::Oauth],
        key: KeyField::Optional,
        balance: true,
        ..relay(ImportService::Custom)
    },
];

impl ImportService {
    fn spec(self) -> &'static Service {
        SERVICES
            .iter()
            .find(|s| s.id == self)
            .expect("每一种服务都在 SERVICES 里")
    }

    /// 链接里的写法，也是 `presets.ts` 里那一格的 ID
    pub fn slug(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::Openai => "openai",
            Self::Gemini => "gemini",
            Self::Deepseek => "deepseek",
            Self::Zai => "zai",
            Self::Bedrock => "bedrock",
            Self::Openrouter => "openrouter",
            Self::Thinkwatch => "thinkwatch",
            Self::Sub2api => "sub2api",
            Self::Newapi => "newapi",
            Self::Ollama => "ollama",
            Self::Custom => "custom",
        }
    }

    fn from_slug(s: &str) -> Option<Self> {
        SERVICES.iter().map(|x| x.id).find(|id| id.slug() == s)
    }
}

/// 官方地址的主机 → 服务类型（`presets.ts` 的 `serviceOf`：只认主机，路径不一样照样是这一家）
pub const HOSTS: &[(&str, ImportService)] = &[
    ("api.anthropic.com", ImportService::Anthropic),
    ("api.openai.com", ImportService::Openai),
    ("generativelanguage.googleapis.com", ImportService::Gemini),
    ("api.deepseek.com", ImportService::Deepseek),
    ("openrouter.ai", ImportService::Openrouter),
    ("api.z.ai", ImportService::Zai),
    ("open.bigmodel.cn", ImportService::Zai),
];

/// 没写 `service` 时按地址认，和编辑对话框认一个已保存的地址一样（`serviceOf`）：官方地址按
/// 主机，标准 Bedrock 地址，本机 Ollama 的 11434 端口，别的是「自定义」。ChatGPT 的后端也是
/// 「自定义」
fn recognize(u: &url::Url) -> ImportService {
    let host = u.host_str().unwrap_or_default().to_ascii_lowercase();
    if host == "chatgpt.com" {
        return ImportService::Custom;
    }
    if let Some((_, s)) = HOSTS.iter().find(|(h, _)| *h == host) {
        return *s;
    }
    if bedrock_region_of(&host).is_some() {
        return ImportService::Bedrock;
    }
    if u.port() == Some(11434) {
        return ImportService::Ollama;
    }
    ImportService::Custom
}

/// 标准 Bedrock 推理地址的主机里的区域（`labels.ts` 的 `bedrockRegionOf`）
fn bedrock_region_of(host: &str) -> Option<&str> {
    let rest = host
        .strip_prefix("bedrock-runtime-fips.")
        .or_else(|| host.strip_prefix("bedrock-runtime."))?;
    let region = rest.strip_suffix(".amazonaws.com")?;
    (!region.is_empty()
        && region
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'))
    .then_some(region)
}

/// Z.ai / BigModel 的哪一个站点：地址正是那一边的标准地址
fn zai_site_of(base: &str) -> Option<ZaiFamily> {
    match base {
        ZAI_ZAI => Some(ZaiFamily::Zai),
        ZAI_BIGMODEL => Some(ZaiFamily::Bigmodel),
        _ => None,
    }
}

/// 生成给界面核对的那一份（`src/generated/import-services.json`，`tests/ts_bindings.rs`）
pub fn table_json() -> String {
    #[derive(Serialize)]
    struct Table {
        services: &'static [Service],
        hosts: Vec<Host>,
        zai: Zai,
        protocols: &'static [Protocol],
        bedrock_default_region: &'static str,
    }
    #[derive(Serialize)]
    struct Host {
        host: &'static str,
        service: ImportService,
    }
    #[derive(Serialize)]
    struct Zai {
        zai: &'static str,
        bigmodel: &'static str,
    }
    let t = Table {
        services: SERVICES,
        hosts: HOSTS
            .iter()
            .map(|(host, service)| Host {
                host,
                service: *service,
            })
            .collect(),
        zai: Zai {
            zai: ZAI_ZAI,
            bigmodel: ZAI_BIGMODEL,
        },
        protocols: LINK_PROTOCOLS,
        bedrock_default_region: BEDROCK_DEFAULT_REGION,
    };
    let mut s = serde_json::to_string_pretty(&t).expect("服务表能写成 JSON");
    s.push('\n');
    s
}

// ---------------------------------------------------------- 解析

/// 是不是一条导入链接（包括写坏了的）。是的话就只由这里处理 —— 不落到授权回调那一路，
/// 那一路会把窗口拉到前面
pub fn is_import(link: &str) -> bool {
    link.get(..PREFIX.len())
        .is_some_and(|p| p.eq_ignore_ascii_case(PREFIX))
        && matches!(
            link.as_bytes().get(PREFIX.len()),
            None | Some(b'?' | b'/' | b'#')
        )
}

/// 解码之后的参数，每个认识的参数至多一份
struct Params(Vec<(Param, String)>);

impl Params {
    fn get(&self, p: Param) -> Option<&str> {
        self.0
            .iter()
            .find(|(k, _)| *k == p)
            .map(|(_, v)| v.as_str())
    }
    fn has(&self, p: Param) -> bool {
        self.get(p).is_some()
    }
}

/// 解析并逐项校验一条导入链接
pub fn parse(link: &str) -> Result<ImportLink, Rejected> {
    if link.len() > MAX_LINK {
        return Err(Rejected::TooLong);
    }
    if !is_import(link) {
        return Err(Rejected::NotImport);
    }
    let rest = &link[PREFIX.len()..];
    // `thinkwatch://import?…` 和 `thinkwatch://import/?…`，别的路径、片段都不认
    let rest = rest.strip_prefix('/').unwrap_or(rest);
    let query = match rest.strip_prefix('?') {
        Some(q) => q,
        None if rest.is_empty() => return Err(Rejected::Missing(Param::Url)),
        None => return Err(Rejected::Malformed),
    };
    if query.contains('#') {
        return Err(Rejected::Malformed);
    }

    // 先把整条拆开、解码：写坏了的整条作废，不管里面有没有不认识的参数
    let mut pairs: Vec<(String, String)> = Vec::new();
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').ok_or(Rejected::Malformed)?;
        let k = decode(k)?;
        let v = decode(v)?;
        if pairs.iter().any(|(x, _)| *x == k) {
            return Err(Rejected::DuplicateParam);
        }
        if v.is_empty() {
            return Err(Rejected::Empty);
        }
        pairs.push((k, v));
    }

    // 这一版不认识的参数：说「无法导入」，不再悄悄作废
    if let Some((k, _)) = pairs
        .iter()
        .find(|(k, _)| Param::from_name(k).is_none() && !NEVER.contains(&k.as_str()))
    {
        return Ok(ImportLink::Unsupported {
            param: shown_param(k),
        });
    }
    if pairs.iter().any(|(k, _)| NEVER.contains(&k.as_str())) {
        return Err(Rejected::NeverAccepted);
    }
    let params = Params(
        pairs
            .into_iter()
            .filter_map(|(k, v)| Param::from_name(&k).map(|p| (p, v)))
            .collect(),
    );

    // 任何一个值都不带 `$`、`{`、`}`、控制字符、看不见的字符。请求头按行查：行与行之间
    // 的换行是分隔符
    for (p, v) in &params.0 {
        let bad = |s: &str| {
            s.chars()
                .any(|c| unsafe_char(c) || matches!(c, '$' | '{' | '}'))
        };
        let unsafe_value = if *p == Param::Headers {
            v.split('\n').any(bad)
        } else {
            bad(v)
        };
        if unsafe_value {
            return Err(Rejected::Invalid(*p));
        }
    }

    let url = params.get(Param::Url).map(check_url).transpose()?;
    let proposal = match params.get(Param::Service) {
        Some(s) => {
            let service = ImportService::from_slug(s).ok_or(Rejected::Invalid(Param::Service))?;
            build(service, &params, url.as_deref())?
        }
        // 没写服务类型（第一版的链接都是这样）：按地址认。认出来的那种服务不收链接里的
        // 某一项（地址带着路径、协议不是它那一种），就按「自定义」—— 第一版的链接建出来的
        // 本来就是「自定义」
        None => {
            let base = url.as_deref().ok_or(Rejected::Missing(Param::Url))?;
            let parsed = url::Url::parse(base).map_err(|_| Rejected::Invalid(Param::Url))?;
            match recognize(&parsed) {
                ImportService::Custom => build(ImportService::Custom, &params, Some(base))?,
                s => build(s, &params, Some(base))
                    .or_else(|_| build(ImportService::Custom, &params, Some(base)))?,
            }
        }
    };
    Ok(ImportLink::Proposal {
        proposal: Box::new(proposal),
    })
}

/// 不认识的参数名能不能拿给人看
fn shown_param(k: &str) -> Option<String> {
    (!k.is_empty()
        && k.len() <= 32
        && k.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'))
    .then(|| k.to_string())
}

/// 按选定的服务类型逐项查，拼成提议。`url`：链接给的、规范化过的地址
fn build(
    service: ImportService,
    params: &Params,
    url: Option<&str>,
) -> Result<ImportProposal, Rejected> {
    let spec = service.spec();
    let offered = |p: Param, ok: bool| {
        if ok {
            Ok(())
        } else {
            Err(Rejected::NotOffered(p))
        }
    };
    let has = |p: Param| params.has(p);

    // 认证方式
    let auth = match params.get(Param::Auth) {
        None => ImportAuth::Key,
        Some("key") => ImportAuth::Key,
        Some("oauth") => ImportAuth::Oauth,
        Some("account") => ImportAuth::Account,
        Some("aws-keys") => ImportAuth::AwsKeys,
        Some(_) => return Err(Rejected::Invalid(Param::Auth)),
    };
    offered(Param::Auth, spec.auth.contains(&auth))?;
    let account = auth == ImportAuth::Account;

    // 站点
    let site_param = match params.get(Param::Site) {
        None => None,
        Some("bigmodel") => Some(ZaiFamily::Bigmodel),
        Some("zai") => Some(ZaiFamily::Zai),
        Some(_) => return Err(Rejected::Invalid(Param::Site)),
    };
    offered(
        Param::Site,
        site_param.is_none() || service == ImportService::Zai,
    )?;

    // 地址。登录账号的地址由登录定
    offered(Param::Url, url.is_none() || !account)?;
    let mut site = None;
    match spec.address {
        Address::Required if !account && url.is_none() => {
            return Err(Rejected::Missing(Param::Url));
        }
        Address::Own { address } => {
            offered(Param::Url, url.is_none_or(|u| u == address))?;
        }
        Address::Site => {
            let from_url = match url {
                Some(u) => Some(zai_site_of(u).ok_or(Rejected::NotOffered(Param::Url))?),
                None => None,
            };
            if let (Some(a), Some(b)) = (from_url, site_param)
                && a != b
            {
                return Err(Rejected::Invalid(Param::Site));
            }
            site = Some(from_url.or(site_param).unwrap_or(ZaiFamily::Bigmodel));
        }
        _ => {}
    }

    // 协议
    let protocol = match params.get(Param::Protocol) {
        None => None,
        Some(p) => {
            let p = Protocol::from_slug(p)
                .filter(|p| LINK_PROTOCOLS.contains(p))
                .ok_or(Rejected::Invalid(Param::Protocol))?;
            let ok = !account
                && match spec.protocols {
                    Protocols::Fixed { protocol } => protocol == Some(p),
                    Protocols::Choice { protocols } => protocols.contains(&p),
                };
            offered(Param::Protocol, ok)?;
            Some(p)
        }
    };

    // 密钥
    let key = params
        .get(Param::Key)
        .map(|k| check_key(k, MAX_KEY, Param::Key))
        .transpose()?;
    offered(
        Param::Key,
        key.is_none() || (auth == ImportAuth::Key && spec.key != KeyField::None),
    )?;

    // OAuth
    for p in [
        Param::OauthEndpoint,
        Param::OauthRefresh,
        Param::OauthClientId,
        Param::OauthClientSecret,
    ] {
        offered(p, !has(p) || auth == ImportAuth::Oauth)?;
    }
    let oauth = if auth == ImportAuth::Oauth {
        let endpoint = params
            .get(Param::OauthEndpoint)
            .ok_or(Rejected::Missing(Param::OauthEndpoint))?;
        let refresh = params
            .get(Param::OauthRefresh)
            .ok_or(Rejected::Missing(Param::OauthRefresh))?;
        Some(ImportOAuth {
            endpoint: check_endpoint(endpoint)?,
            refresh: check_key(refresh, MAX_LONG_KEY, Param::OauthRefresh)?,
            client_id: params
                .get(Param::OauthClientId)
                .map(|v| check_key(v, MAX_KEY, Param::OauthClientId))
                .transpose()?,
            client_secret: params
                .get(Param::OauthClientSecret)
                .map(|v| check_key(v, MAX_KEY, Param::OauthClientSecret))
                .transpose()?,
        })
    } else {
        None
    };

    // Bedrock：区域和访问密钥
    let bedrock = service == ImportService::Bedrock;
    let region = match params.get(Param::Region) {
        None => None,
        Some(r) => {
            offered(Param::Region, bedrock)?;
            let ok = (1..=32).contains(&r.len())
                && r.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
            if !ok {
                return Err(Rejected::Invalid(Param::Region));
            }
            // 标准地址里的区域就是那一栏（对话框按地址填）；别的地址只在签名时才有区域那一栏
            if let Some(u) = url {
                let own = url::Url::parse(u).ok().and_then(|x| {
                    x.host_str()
                        .and_then(|h| bedrock_region_of(h).map(str::to_string))
                });
                match own {
                    Some(own) if own != r => return Err(Rejected::Invalid(Param::Region)),
                    Some(_) => {}
                    None => offered(Param::Region, auth != ImportAuth::Key)?,
                }
            }
            Some(r.to_string())
        }
    };
    for p in [
        Param::AwsAccessKeyId,
        Param::AwsSecretAccessKey,
        Param::AwsSessionToken,
    ] {
        offered(p, !has(p) || auth == ImportAuth::AwsKeys)?;
    }
    let aws = if auth == ImportAuth::AwsKeys {
        let id = params
            .get(Param::AwsAccessKeyId)
            .ok_or(Rejected::Missing(Param::AwsAccessKeyId))?;
        let secret = params
            .get(Param::AwsSecretAccessKey)
            .ok_or(Rejected::Missing(Param::AwsSecretAccessKey))?;
        let id_ok = (16..=128).contains(&id.len())
            && id
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
        if !id_ok {
            return Err(Rejected::Invalid(Param::AwsAccessKeyId));
        }
        Some(ImportAwsKeys {
            access_key_id: id.to_string(),
            secret_access_key: check_key(secret, MAX_KEY, Param::AwsSecretAccessKey)?,
            session_token: params
                .get(Param::AwsSessionToken)
                .map(|v| check_key(v, MAX_LONG_KEY, Param::AwsSessionToken))
                .transpose()?,
        })
    } else {
        None
    };

    // 「高级设置」：登录账号那一步没有
    let headers = match params.get(Param::Headers) {
        None => Vec::new(),
        Some(h) => {
            offered(Param::Headers, !account)?;
            check_headers(h)?
        }
    };
    let client_identity = match params.get(Param::ClientIdentity) {
        None => false,
        Some("on") => {
            offered(Param::ClientIdentity, spec.client_identity && !account)?;
            true
        }
        Some(_) => return Err(Rejected::Invalid(Param::ClientIdentity)),
    };
    let concurrency = match params.get(Param::Concurrency) {
        None => None,
        Some(c) => {
            offered(Param::Concurrency, !account)?;
            Some(check_concurrency(c)?)
        }
    };
    let balance = match params.get(Param::Balance) {
        None => None,
        Some(b) => {
            offered(Param::Balance, spec.balance)?;
            Some(match b {
                "off" => BalanceSetting::Off,
                "openrouter" => BalanceSetting::Openrouter,
                "deepseek" => BalanceSetting::Deepseek,
                "moonshot" => BalanceSetting::Moonshot,
                "sub2api" => BalanceSetting::Sub2api,
                "newapi" => BalanceSetting::Newapi,
                "thinkwatch" => BalanceSetting::Thinkwatch,
                _ => return Err(Rejected::Invalid(Param::Balance)),
            })
        }
    };

    // 模型、计费：每种服务、每种认证方式都有这两步
    let models = params
        .get(Param::Models)
        .map(|m| check_models(m, false, Param::Models))
        .transpose()?
        .unwrap_or_default();
    let models_only = params
        .get(Param::ModelsOnly)
        .map(|m| check_models(m, true, Param::ModelsOnly))
        .transpose()?;
    let specs = params
        .get(Param::Specs)
        .map(check_specs)
        .transpose()?
        .unwrap_or_default();
    let billing = match params.get(Param::Billing) {
        None => None,
        Some("per-token") => Some(Billing::PerToken),
        Some("free") => Some(Billing::Free),
        Some(_) => return Err(Rejected::Invalid(Param::Billing)),
    };
    // 价目表只在按量计费时用得上（Ollama 默认不计费）
    let per_token = billing.unwrap_or(spec.billing) == Billing::PerToken;
    let multiplier = params
        .get(Param::PriceMultiplier)
        .map(check_multiplier)
        .transpose()?;
    let prices = params.get(Param::Prices).map(check_prices).transpose()?;
    offered(Param::PriceMultiplier, multiplier.is_none() || per_token)?;
    offered(Param::Prices, prices.is_none() || per_token)?;
    let price_sheet = (multiplier.is_some() || prices.is_some()).then(|| ImportSheet {
        multiplier: multiplier.unwrap_or(1.0),
        prices: prices.unwrap_or_default(),
    });

    Ok(ImportProposal {
        service,
        auth,
        site,
        name: params.get(Param::Name).map(check_name).transpose()?,
        base_url: url.map(str::to_string),
        protocol,
        key,
        oauth,
        region,
        aws,
        headers,
        client_identity,
        concurrency,
        balance,
        models,
        models_only,
        specs,
        billing,
        price_sheet,
    })
}

/// 百分号解码，只解一层。`+` 是空格（和网页上的 `URLSearchParams` 一个说法）。
/// `%` 后面不是两位十六进制、解出来不是 UTF-8，整条作废
fn decode(s: &str) -> Result<String, Rejected> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' => {
                let hex = |j: usize| {
                    b.get(j)
                        .and_then(|c| (*c as char).to_digit(16))
                        .ok_or(Rejected::Encoding)
                };
                out.push((hex(i + 1)? * 16 + hex(i + 2)?) as u8);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8(out).map_err(|_| Rejected::Encoding)
}

/// 看不见、会改变显示顺序的字符：零宽字符、双向控制符。混在名称或地址里能让人看到的
/// 和实际保存的不是一回事
fn invisible(c: char) -> bool {
    matches!(c,
        '\u{00AD}' | '\u{034F}' | '\u{061C}' | '\u{115F}' | '\u{1160}' | '\u{17B4}' | '\u{17B5}'
        | '\u{180B}'..='\u{180F}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}'
        | '\u{2060}'..='\u{206F}' | '\u{3164}' | '\u{FE00}'..='\u{FE0F}' | '\u{FEFF}'
        | '\u{FFA0}' | '\u{FFF0}'..='\u{FFFF}')
}

fn unsafe_char(c: char) -> bool {
    c.is_control() || invisible(c)
}

/// 上游名称：和新建对话框里一样的名字，再严一点 —— 不带路径分隔符、控制字符、看不见的
/// 字符，首尾没有空白，不以 core 保留的 `__` 开头
fn check_name(n: &str) -> Result<String, Rejected> {
    let bad = n.chars().count() > MAX_NAME
        || n.trim() != n
        || n == "."
        || n == ".."
        || n.starts_with("__")
        || n.chars().any(|c| {
            unsafe_char(c) || matches!(c, '/' | '\\' | '$' | '{' | '}' | '<' | '>' | '"' | '`')
        });
    if bad {
        return Err(Rejected::Invalid(Param::Name));
    }
    Ok(n.to_string())
}

/// 接口地址，规范化之后：主机名是 ASCII，末尾没有 `/`
fn check_url(raw: &str) -> Result<String, Rejected> {
    let u = web_url(raw).ok_or(Rejected::Invalid(Param::Url))?;
    let base = u.as_str().trim_end_matches('/').to_string();
    if base.len() > MAX_URL {
        return Err(Rejected::Invalid(Param::Url));
    }
    Ok(base)
}

/// OAuth 的 Token 端点：和接口地址一样的规矩，路径原样留着（末尾只有一个根路径的 `/` 时去掉）
fn check_endpoint(raw: &str) -> Result<String, Rejected> {
    let u = web_url(raw).ok_or(Rejected::Invalid(Param::OauthEndpoint))?;
    let s = u.as_str();
    let s = if u.path() == "/" {
        s.trim_end_matches('/')
    } else {
        s
    };
    if s.len() > MAX_URL {
        return Err(Rejected::Invalid(Param::OauthEndpoint));
    }
    Ok(s.to_string())
}

/// 一个网址：`https://`（`http://` 只给本机和内网，[`plain_http_ok`]），不带账号密码、查询串、
/// 片段，主机名是 ASCII（IDN 转成 punycode）
fn web_url(raw: &str) -> Option<url::Url> {
    if raw.len() > MAX_URL
        || raw.chars().any(|c| {
            unsafe_char(c)
                || c.is_whitespace()
                || matches!(
                    c,
                    '\\' | '$'
                        | '{'
                        | '}'
                        | '%'
                        | '"'
                        | '<'
                        | '>'
                        | '`'
                        | '^'
                        | '|'
                        | '@'
                        | '#'
                        | '?'
                )
        })
    {
        return None;
    }
    // 写全 scheme：`https:example.com` 这种 url 库会宽容地补成 `https://`，这里不宽容
    let lower = raw
        .get(..8)
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return None;
    }
    let u = url::Url::parse(raw).ok()?;
    if !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return None;
    }
    let host = u.host()?;
    match u.scheme() {
        "https" => {}
        "http" if plain_http_ok(&host) => {}
        _ => return None,
    }
    // url 库给出的主机名已经是 ASCII（IDN 转成了 punycode），IPv6 带方括号
    let host_str = u.host_str()?;
    if host_str.is_empty() || !host_str.is_ascii() {
        return None;
    }
    Some(u)
}

/// 内网的主机名后缀：`http://` 收这几种
const INTRANET_SUFFIXES: &[&str] = &[
    ".local",
    ".lan",
    ".internal",
    ".intranet",
    ".corp",
    ".home.arpa",
    ".localhost",
];

/// `http://` 收不收这个主机：本机回环地址（`localhost`、`127.0.0.1`、`[::1]`）；私有网段的
/// IPv4（`10/8`、`172.16/12`、`192.168/16`、`100.64/10`、`169.254/16`）和 IPv6（`fc00::/7`、
/// `fe80::/10`）；没有点的单段主机名，或者以内网后缀结尾的（[`INTRANET_SUFFIXES`]）。别的一律
/// 只收 `https://`
fn plain_http_ok(host: &url::Host<&str>) -> bool {
    match host {
        url::Host::Domain(d) => {
            let d = d.to_ascii_lowercase();
            d == "localhost" || !d.contains('.') || INTRANET_SUFFIXES.iter().any(|s| d.ends_with(s))
        }
        url::Host::Ipv4(ip) => {
            let [a, b, ..] = ip.octets();
            *ip == std::net::Ipv4Addr::LOCALHOST
                || a == 10
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
        }
        url::Host::Ipv6(ip) => {
            let first = ip.segments()[0];
            *ip == std::net::Ipv6Addr::LOCALHOST
                || first & 0xfe00 == 0xfc00
                || first & 0xffc0 == 0xfe80
        }
    }
}

/// 密钥一类：只收常见的密钥字符。没有 `$`、`{`、`}`，存进配置就是字面值，不会被展开
fn check_key(k: &str, max: usize, p: Param) -> Result<String, Rejected> {
    let ok = k.len() <= max
        && k.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.~+/=:".contains(&b));
    if !ok {
        return Err(Rejected::Invalid(p));
    }
    Ok(k.to_string())
}

/// 一个模型 ID（`glob`：启用范围里还可以是通配规则）
fn model_ok(id: &str, glob: bool) -> bool {
    !id.is_empty()
        && id.len() <= MAX_MODEL
        && id.bytes().all(|b| {
            b.is_ascii_alphanumeric() || b"-_.:/@+".contains(&b) || (glob && b"*?".contains(&b))
        })
}

/// 模型清单（启用范围）：逗号分隔。重复的只留一个
fn check_models(m: &str, glob: bool, p: Param) -> Result<Vec<String>, Rejected> {
    let mut out: Vec<String> = Vec::new();
    for id in m.split(',') {
        if !model_ok(id, glob) {
            return Err(Rejected::Invalid(p));
        }
        if !out.iter().any(|x| x == id) {
            out.push(id.to_string());
        }
    }
    if out.len() > MAX_MODELS {
        return Err(Rejected::Invalid(p));
    }
    Ok(out)
}

/// 不会被当成鉴权、连接本身、浏览器专用的请求头才收。前缀 `proxy-`、`sec-` 也不收
const DENIED_HEADERS: &[&str] = &[
    "authorization",
    "proxy-authorization",
    "x-api-key",
    "x-goog-api-key",
    "api-key",
    "cookie",
    "host",
    "content-length",
    "content-type",
    "content-encoding",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "upgrade",
    "te",
    "trailer",
    "user-agent",
];

/// 请求头：一行一个 `Name: Value`
fn check_headers(h: &str) -> Result<Vec<ImportHeader>, Rejected> {
    let bad = Rejected::Invalid(Param::Headers);
    let lines: Vec<&str> = h.split('\n').collect();
    if lines.len() > MAX_HEADERS {
        return Err(bad);
    }
    let mut out: Vec<ImportHeader> = Vec::new();
    for line in lines {
        let (name, value) = line.split_once(':').ok_or(bad)?;
        // RFC 7230 的 token
        let token = !name.is_empty()
            && name.len() <= MAX_HEADER_NAME
            && name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b));
        let value = value.trim_matches(' ');
        let printable = !value.is_empty()
            && value.len() <= MAX_HEADER_VALUE
            && value.bytes().all(|b| (0x20..=0x7E).contains(&b));
        if !token || !printable {
            return Err(bad);
        }
        let lower = name.to_ascii_lowercase();
        if DENIED_HEADERS.contains(&lower.as_str())
            || lower.starts_with("proxy-")
            || lower.starts_with("sec-")
            || out.iter().any(|x| x.name.eq_ignore_ascii_case(name))
        {
            return Err(bad);
        }
        out.push(ImportHeader {
            name: name.to_string(),
            value: value.to_string(),
        });
    }
    Ok(out)
}

/// 一个十进制正整数，不带符号、不带前导零
fn whole(s: &str, max: u32) -> Option<u32> {
    let ok = !s.is_empty()
        && s.len() <= 10
        && s.bytes().all(|b| b.is_ascii_digit())
        && !s.starts_with('0');
    ok.then(|| s.parse::<u32>().ok())
        .flatten()
        .filter(|n| (1..=max).contains(n))
}

fn check_concurrency(c: &str) -> Result<u32, Rejected> {
    whole(c, MAX_CONCURRENCY).ok_or(Rejected::Invalid(Param::Concurrency))
}

/// 模型规格：`;` 分隔，每一项 `模型|上下文窗口|输出上限|推理|图片输入`
fn check_specs(s: &str) -> Result<Vec<ImportSpec>, Rejected> {
    let bad = Rejected::Invalid(Param::Specs);
    let entries: Vec<&str> = s.split(';').collect();
    if entries.len() > MAX_MODELS {
        return Err(bad);
    }
    let mut out: Vec<ImportSpec> = Vec::new();
    for e in entries {
        let f: Vec<&str> = e.split('|').collect();
        let [model, context, output, reasoning, image] = f[..] else {
            return Err(bad);
        };
        if !model_ok(model, false) || out.iter().any(|x| x.model == model) {
            return Err(bad);
        }
        let tokens = |v: &str| match v {
            "" => Ok(None),
            v => whole(v, MAX_SPEC_TOKENS).map(Some).ok_or(bad),
        };
        let flag = |v: &str| match v {
            "" => Ok(None),
            "y" => Ok(Some(true)),
            "n" => Ok(Some(false)),
            _ => Err(bad),
        };
        let spec = ImportSpec {
            model: model.to_string(),
            context_window: tokens(context)?,
            max_output_tokens: tokens(output)?,
            reasoning: flag(reasoning)?,
            image_input: flag(image)?,
        };
        if spec.context_window.is_none()
            && spec.max_output_tokens.is_none()
            && spec.reasoning.is_none()
            && spec.image_input.is_none()
        {
            return Err(bad);
        }
        out.push(spec);
    }
    Ok(out)
}

/// `^\d{int}(\.\d{1,6})?$` 写的一个十进制数
fn decimal(s: &str, int: usize) -> Option<f64> {
    let (i, f) = match s.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (s, None),
    };
    let digits =
        |x: &str, max: usize| (1..=max).contains(&x.len()) && x.bytes().all(|b| b.is_ascii_digit());
    if !digits(i, int) || f.is_some_and(|f| !digits(f, 6)) {
        return None;
    }
    s.parse().ok()
}

/// 价目表的倍率：大于 0、不超过 100
fn check_multiplier(m: &str) -> Result<f64, Rejected> {
    decimal(m, 3)
        .filter(|x| *x > 0.0 && *x <= 100.0)
        .ok_or(Rejected::Invalid(Param::PriceMultiplier))
}

/// 价格：`;` 分隔，每一项 `模型|输入|输出|缓存读|5 分钟缓存写|1 小时缓存写`，美元 / 百万 tokens。
/// 输入、输出必填；缓存那三项没写（空着或者整个省掉）就按输入价
fn check_prices(s: &str) -> Result<Vec<ImportPrice>, Rejected> {
    let bad = Rejected::Invalid(Param::Prices);
    let entries: Vec<&str> = s.split(';').collect();
    if entries.len() > MAX_MODELS {
        return Err(bad);
    }
    let mut out: Vec<ImportPrice> = Vec::new();
    for e in entries {
        let f: Vec<&str> = e.split('|').collect();
        if !(3..=6).contains(&f.len()) {
            return Err(bad);
        }
        let model = f[0];
        if !model_ok(model, false) || out.iter().any(|x| x.model == model) {
            return Err(bad);
        }
        let price = |v: &str| decimal(v, 6).ok_or(bad);
        let input = price(f[1])?;
        let output = price(f[2])?;
        let cache = |i: usize| match f.get(i).copied() {
            None | Some("") => Ok(input),
            Some(v) => price(v),
        };
        out.push(ImportPrice {
            model: model.to_string(),
            input,
            output,
            cache_read: cache(3)?,
            cache_write_5m: cache(4)?,
            cache_write_1h: cache(5)?,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------- 生成（分享一个上游）
//
// 上游行的「分享…」：界面按这个上游的配置拼一份提议，这里写成链接。**生成和解析在同一个
// 模块里**：写出去的每一项都是 [`parse`] 收的写法，和对话框自己会填的一样的不写（服务自己的
// 地址、固定的协议、默认的认证方式、站点、计费方式）。写完再解析一遍，交回解析出来的那一份
// （[`share`]）—— 接收方点开之后看到的就是它。

/// 网页形式的链接：官网读完 `#` 之后的片段，打开同样参数的 `thinkwatch://import?…`。片段不发给
/// 网站的服务器
pub const WEB_PREFIX: &str = "https://thinkwat.ch/import#";

/// 链接里一个值的编码：字母、数字和 `-_.~,` 原样，别的一律 `%XX`（`+` 也编码：解析时它是空格）
fn encode(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    for b in v.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~,".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// 价格、倍率写成的十进制数：至多六位小数，末尾的 0 不写（`3`、`0.375`）
fn decimal_text(x: f64) -> String {
    let s = format!("{x:.6}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-0" {
        "0".into()
    } else {
        s.into()
    }
}

fn auth_slug(a: ImportAuth) -> &'static str {
    match a {
        ImportAuth::Key => "key",
        ImportAuth::Oauth => "oauth",
        ImportAuth::Account => "account",
        ImportAuth::AwsKeys => "aws-keys",
    }
}

/// 一个模型的规格：`模型|上下文窗口|输出上限|推理|图片输入`，没写的一格空着
fn spec_text(s: &ImportSpec) -> String {
    let n = |v: Option<u32>| v.map(|n| n.to_string()).unwrap_or_default();
    let f = |v: Option<bool>| match v {
        Some(true) => "y",
        Some(false) => "n",
        None => "",
    };
    format!(
        "{}|{}|{}|{}|{}",
        s.model,
        n(s.context_window),
        n(s.max_output_tokens),
        f(s.reasoning),
        f(s.image_input)
    )
}

/// 一个模型的价格：`模型|输入|输出|缓存读|5 分钟缓存写|1 小时缓存写`。缓存价和输入价一样的那一格
/// 空着（解析时按输入价补），末尾空着的几格整个省掉
fn price_text(p: &ImportPrice) -> String {
    let mut f = vec![
        p.model.clone(),
        decimal_text(p.input),
        decimal_text(p.output),
    ];
    let input = decimal_text(p.input);
    for c in [p.cache_read, p.cache_write_5m, p.cache_write_1h] {
        let c = decimal_text(c);
        f.push(if c == input { String::new() } else { c });
    }
    while f.len() > 3 && f.last().is_some_and(String::is_empty) {
        f.pop();
    }
    f.join("|")
}

/// 一份提议写成链接的参数（`k=v&…`，值已编码），按 [`Param::ALL`] 的顺序
pub fn query(p: &ImportProposal) -> String {
    let mut out: Vec<(Param, String)> = vec![(Param::Service, p.service.slug().into())];
    let mut put = |k: Param, v: String| out.push((k, v));
    if p.auth != ImportAuth::Key {
        put(Param::Auth, auth_slug(p.auth).into());
    }
    // 站点：地址是哪一边的标准地址就是哪一边，没有地址是 BigModel。和它一样就不写
    if p.service == ImportService::Zai
        && let Some(site) = p.site
    {
        let implied = p
            .base_url
            .as_deref()
            .and_then(zai_site_of)
            .unwrap_or(ZaiFamily::Bigmodel);
        if site != implied {
            put(Param::Site, site.slug().into());
        }
    }
    if let Some(n) = &p.name {
        put(Param::Name, n.clone());
    }
    if let Some(u) = &p.base_url {
        put(Param::Url, u.clone());
    }
    if let Some(x) = p.protocol {
        put(Param::Protocol, x.slug().into());
    }
    if let Some(k) = &p.key {
        put(Param::Key, k.clone());
    }
    if let Some(o) = &p.oauth {
        put(Param::OauthEndpoint, o.endpoint.clone());
        put(Param::OauthRefresh, o.refresh.clone());
        if let Some(v) = &o.client_id {
            put(Param::OauthClientId, v.clone());
        }
        if let Some(v) = &o.client_secret {
            put(Param::OauthClientSecret, v.clone());
        }
    }
    if let Some(r) = &p.region {
        put(Param::Region, r.clone());
    }
    if let Some(a) = &p.aws {
        put(Param::AwsAccessKeyId, a.access_key_id.clone());
        put(Param::AwsSecretAccessKey, a.secret_access_key.clone());
        if let Some(t) = &a.session_token {
            put(Param::AwsSessionToken, t.clone());
        }
    }
    if !p.headers.is_empty() {
        let lines: Vec<String> = p
            .headers
            .iter()
            .map(|h| format!("{}: {}", h.name, h.value))
            .collect();
        put(Param::Headers, lines.join("\n"));
    }
    if p.client_identity {
        put(Param::ClientIdentity, "on".into());
    }
    if let Some(c) = p.concurrency {
        put(Param::Concurrency, c.to_string());
    }
    if let Some(b) = p.balance {
        put(Param::Balance, b.slug().into());
    }
    if !p.models.is_empty() {
        put(Param::Models, p.models.join(","));
    }
    // 空的启用范围写不进链接（空值整条作废）：不写，按全部模型
    if let Some(m) = p.models_only.as_ref().filter(|m| !m.is_empty()) {
        put(Param::ModelsOnly, m.join(","));
    }
    if !p.specs.is_empty() {
        let s: Vec<String> = p.specs.iter().map(spec_text).collect();
        put(Param::Specs, s.join(";"));
    }
    if let Some(b) = p.billing {
        put(Param::Billing, b.slug().into());
    }
    if let Some(sheet) = &p.price_sheet {
        // 只有倍率、或者倍率不是 1 才写倍率：两项都不写就没有这张价目表
        if sheet.multiplier != 1.0 || sheet.prices.is_empty() {
            put(Param::PriceMultiplier, decimal_text(sheet.multiplier));
        }
        if !sheet.prices.is_empty() {
            let s: Vec<String> = sheet.prices.iter().map(price_text).collect();
            put(Param::Prices, s.join(";"));
        }
    }
    let pairs: Vec<String> = out
        .iter()
        .map(|(k, v)| format!("{}={}", k.name(), encode(v)))
        .collect();
    pairs.join("&")
}

/// `thinkwatch://import?…`
pub fn generate(p: &ImportProposal) -> String {
    format!("{PREFIX}?{}", query(p))
}

/// `https://thinkwat.ch/import#…`：参数和 [`generate`] 的一样
pub fn web_link(p: &ImportProposal) -> String {
    format!("{WEB_PREFIX}{}", query(p))
}

/// 写成链接，再按 [`parse`] 读一遍：读不了是 [`ShareLink::Invalid`]，写出来超过 [`MAX_LINK`] 是
/// [`ShareLink::TooLong`]。**交回读出来的那一份、按它重写的链接**：地址规范化过（主机名小写、
/// IDN 转 ASCII、去掉末尾的 `/`），同一份提议总是同一条链接
pub fn share(p: &ImportProposal) -> ShareLink {
    let read = |link: &str| match parse(link) {
        Ok(ImportLink::Proposal { proposal }) => Ok(*proposal),
        Ok(ImportLink::Unsupported { .. }) => Err(None),
        Err(why) => Err(why.param().map(|p| p.name().to_string())),
    };
    let too_long = |link: &str| ShareLink::TooLong {
        length: u32::try_from(link.len()).unwrap_or(u32::MAX),
    };
    let first = generate(p);
    if first.len() > MAX_LINK {
        return too_long(&first);
    }
    let canonical = match read(&first) {
        Ok(q) => q,
        Err(param) => return ShareLink::Invalid { param },
    };
    let app = generate(&canonical);
    if app.len() > MAX_LINK {
        return too_long(&app);
    }
    ShareLink::Ready {
        web: web_link(&canonical),
        app,
        proposal: Box::new(canonical),
    }
}

/// 分享一个上游：界面按它的配置拼好的提议写成链接（[`share`]）。不写配置、不发请求
#[tauri::command]
pub fn share_import_link(proposal: ImportProposal) -> ShareLink {
    share(&proposal)
}

// ---------------------------------------------------------- 一次只处理一条

#[derive(Debug)]
enum State {
    Idle {
        closed_at: Option<Instant>,
    },
    /// 交出去了，等界面来取
    Pending {
        link: ImportLink,
        at: Instant,
    },
    /// 界面取走了，对话框开着
    Open,
}

/// 同一时间最多一条。**对话框开着、或者刚关掉的那几秒里来的链接都丢掉**，
/// 也就不会一次次把窗口拉到前面。「无法导入」也算一条
#[derive(Debug)]
pub struct Gate(Mutex<State>);

impl Gate {
    pub const fn new() -> Self {
        Self(Mutex::new(State::Idle { closed_at: None }))
    }

    /// 收下一条。收下了（要打开窗口）是 true
    pub fn offer(&self, link: ImportLink, now: Instant) -> bool {
        let Ok(mut g) = self.0.lock() else {
            return false;
        };
        let free = match &*g {
            State::Idle { closed_at } => {
                closed_at.is_none_or(|t| now.saturating_duration_since(t) >= COOLDOWN)
            }
            State::Pending { at, .. } => now.saturating_duration_since(*at) >= STALE,
            State::Open => false,
        };
        if free {
            *g = State::Pending { link, at: now };
        }
        free
    }

    /// 界面来取。取走之后算对话框开着
    pub fn take(&self) -> Option<ImportLink> {
        let mut g = self.0.lock().ok()?;
        match std::mem::replace(&mut *g, State::Open) {
            State::Pending { link, .. } => Some(link),
            other => {
                *g = other;
                None
            }
        }
    }

    /// 对话框关了（取消、创建完、网页重新加载、窗口被销毁），或者界面没打开它就丢了（已经
    /// 开着一个新建、编辑的对话框）。还没取走的那一份不动
    pub fn close(&self, now: Instant) {
        if let Ok(mut g) = self.0.lock()
            && matches!(*g, State::Open)
        {
            *g = State::Idle {
                closed_at: Some(now),
            };
        }
    }
}

impl Default for Gate {
    fn default() -> Self {
        Self::new()
    }
}

static GATE: Gate = Gate::new();

/// Tauri 事件：有一条等着取（不带内容，内容由 `take_import_link` 取）
pub const EVENT: &str = "import-link";

/// 收到一条导入链接
pub fn receive(app: &tauri::AppHandle, link: &str) {
    let link = match parse(link) {
        Ok(l) => l,
        Err(why) => {
            // 链接里可能有密钥：日志只记原因
            tracing::warn!(?why, "导入链接未通过校验，已忽略");
            return;
        }
    };
    if !GATE.offer(link, Instant::now()) {
        tracing::info!("已有一条导入链接在处理，这一条已忽略");
        return;
    }
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        use tauri::Emitter;
        let _ = crate::window::show_main_window(&a);
        let _ = a.emit(EVENT, ());
    });
}

/// 界面取走等着的那一条
#[tauri::command]
pub fn take_import_link() -> Option<ImportLink> {
    GATE.take()
}

/// 导入的对话框关了（或者没打开就丢了）。界面挂上时也调一次：网页重新加载过，之前开着的
/// 对话框已经不在了
#[tauri::command]
pub fn import_link_closed() {
    GATE.close(Instant::now());
}

/// 主窗口被销毁：开着的导入对话框跟着没了
pub fn window_destroyed() {
    GATE.close(Instant::now());
}

#[cfg(test)]
mod tests;
