//! Pi 和它的分支 oh-my-pi（omp）：同一种 provider 写法，Pi 写 JSON，omp 写 YAML。
//!
//! ```yaml
//! providers:
//!   thinkwatch:
//!     baseUrl: http://127.0.0.1:8788/v1
//!     api: openai-completions
//!     apiKey: tw-…
//!     auth: apiKey              # 只有 omp
//!     models:
//!       - id: claude-sonnet-5
//!         api: anthropic-messages
//!         baseUrl: http://127.0.0.1:8788
//!         contextWindow: 200000     # 网关答了的规格才写，见 specs
//!         maxTokens: 64000
//!         reasoning: true
//!         input: [text, image]
//!       - id: deepseek-chat
//! ```
//!
//! **另起一个 provider，不改内置的那几个。**两边的凭据都按 provider 记：用户 `/login`
//! 登录过的是 `anthropic`、`openai-codex` 这类内置 provider，改写它们的 `baseUrl`，登录拿到
//! 的令牌就跟着请求发到网关去了。
//!
//! **模型要写进去。**Pi 不问 provider 有哪些模型，`models.json` 里没列的就选不到。omp 倒是
//! 能自己问 `/v1/models`（`discovery`），可问到的模型一律按 provider 那一种 API 发 —— 而这里
//! 每个模型挑它本家的 API（见 [`api_for`]），所以照样写清单。网关上的清单变了，客户端页提示
//! 更新，和 opencode 一样。
//!
//! **默认模型不动。**和 opencode 一样只加一个 provider：Pi 的 `settings.json`、omp 的
//! `config.yml` 一个字节都不改，ThinkWatch 的模型由用户在 `/model` 里选。

use std::collections::HashSet;
use std::path::Path;

use tw_types::{Msg, msg};

use crate::clients::{Edit, Gateway, ModelCard, PROVIDER_ID};
use crate::cloud::Around;
use crate::json::Val;
use crate::plan::lookup;

/// 两个里的哪一个。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flavor {
    /// `~/.pi/agent/models.json`
    Pi,
    /// `~/.omp/agent/models.yml`
    Omp,
}

impl Flavor {
    pub fn of(client: &str) -> Option<Flavor> {
        match client {
            "pi" => Some(Flavor::Pi),
            "omp" => Some(Flavor::Omp),
            _ => None,
        }
    }
}

/// 一个模型用哪种 API 发。两边认的名字一样。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Api {
    Anthropic,
    Responses,
    Google,
    Chat,
}

impl Api {
    pub fn slug(self) -> &'static str {
        match self {
            Api::Anthropic => "anthropic-messages",
            Api::Responses => "openai-responses",
            Api::Google => "google-generative-ai",
            Api::Chat => "openai-completions",
        }
    }

    /// 这一种要的地址写法。Anthropic 的客户端自己拼 `/v1/messages`，地址不带 `/v1`；Google
    /// 的那一种在地址后面直接接 `/models/<模型>:streamGenerateContent`，版本要写在地址里；
    /// OpenAI 的两种带 `/v1`。
    pub fn base(self, gw_base: &str) -> String {
        let b = gw_base.trim_end_matches('/');
        match self {
            Api::Anthropic => b.to_string(),
            Api::Google => format!("{b}/v1beta"),
            Api::Responses | Api::Chat => format!("{b}/v1"),
        }
    }
}

/// provider 本身那一种：没写 `api` 的模型照它发。Chat Completions 是几乎每一家兼容服务都
/// 说的那一种。
pub const DEFAULT_API: Api = Api::Chat;

/// 一个模型用哪种 API 发。
///
/// 网关四种格式互相转换，选哪一种都发得通；**挑它本家的那一种**，上游是同一种格式时
/// 请求原样直通，思考过程、缓存断点、推理内容不用转一遍：Claude 走 Anthropic Messages，
/// Gemini 走 Google 的那一种，OpenAI 的 GPT、o 系列和 Codex 走 Responses，其余的（DeepSeek、
/// Qwen、GLM、Kimi……）走 Chat Completions。认的是模型名，`anthropic/claude-…` 这种带前缀
/// 的看最后一段。
pub fn api_for(model: &str) -> Api {
    let name = model
        .rsplit('/')
        .next()
        .unwrap_or(model)
        .to_ascii_lowercase();
    let o_series = {
        let mut cs = name.chars();
        cs.next() == Some('o') && cs.next().is_some_and(|c| c.is_ascii_digit())
    };
    if name.contains("claude") {
        Api::Anthropic
    } else if name.contains("gemini") {
        Api::Google
    } else if name.starts_with("gpt-") || name.contains("codex") || o_series {
        Api::Responses
    } else {
        Api::Chat
    }
}

/// 模型清单：一个模型一项，不走 provider 那一种的写上自己的 `api`，地址写法不一样的再写上
/// 自己的 `baseUrl`（两边都是模型上的覆盖 provider 上的）。
///
/// 网关答了的规格也写上（见 [`specs`]）；没答的那一项不写，Pi 照它的默认值跑，omp 按模型名
/// 从它自带的目录里补。同名的只写一次，先后照网关答的。
pub fn models_val(gw: &Gateway) -> Val {
    let mut seen = HashSet::new();
    Val::Arr(
        gw.models
            .iter()
            .filter(|m| seen.insert(m.id.as_str()))
            .map(|m| {
                let api = api_for(&m.id);
                let mut fields = vec![("id".to_string(), Val::s(&m.id))];
                if api != DEFAULT_API {
                    fields.push(("api".into(), Val::s(api.slug())));
                    if api.base(&gw.base) != DEFAULT_API.base(&gw.base) {
                        fields.push(("baseUrl".into(), Val::s(api.base(&gw.base))));
                    }
                }
                fields.extend(specs(m));
                Val::Obj(fields)
            })
            .collect(),
    )
}

/// 一个模型的规格在两边的写法，两边的字段名一样（Pi 的 `model-config.ts`，omp 的
/// `models-config-schema-bundle.ts`）：
///
/// - `contextWindow`、`maxTokens`：不写时 Pi 按 128000、16384 跑，omp 先查自带的目录、查不到
///   也是这两个数。**`maxTokens` 是每次请求都带上的输出上限**，不只是一项能力说明：Pi 发出去
///   的是它和上下文剩下的空间里小的那个，omp 原样发（OpenAI 的两种另外封顶 64000）。写的是
///   网关答的这个模型真正的输出上限，上游收得下。两边都把 0 和负数当成写错了（Pi 直接报错），
///   网关答 0 当没答
/// - `reasoning`：会不会推理。不写是不会，`/model` 里就没有推理档位可选
/// - `input`：收图写 `[text, image]`，不收写 `[text]`。不写是只收文字，贴进去的图发不出去
pub fn specs(m: &ModelCard) -> Vec<(String, Val)> {
    let m = as_written(m);
    let mut v = Vec::new();
    if let Some(n) = m.context_window {
        v.push(("contextWindow".into(), Val::Num(n.to_string())));
    }
    if let Some(n) = m.max_output_tokens {
        v.push(("maxTokens".into(), Val::Num(n.to_string())));
    }
    if let Some(b) = m.reasoning {
        v.push(("reasoning".into(), Val::Bool(b)));
    }
    if let Some(image) = m.image_input {
        v.push(("input".into(), input_val(image)));
    }
    v
}

/// 收不收图的写法：文字总是收的
fn input_val(image: bool) -> Val {
    let mut v = vec![Val::s("text")];
    if image {
        v.push(Val::s("image"));
    }
    Val::Arr(v)
}

/// 读回一个 token 数。JSON 里是数，YAML 的语义值里一律是字符串（见 [`crate::yamlval`]）；
/// 0 和读不懂的当没写
pub(crate) fn count_of(v: Option<Val>) -> Option<u64> {
    match v? {
        Val::Num(n) | Val::Str(n) => n.trim().parse().ok().filter(|n| *n > 0),
        _ => None,
    }
}

/// 读回一个开关，两种文件里的写法都认
pub(crate) fn flag_of(v: Option<Val>) -> Option<bool> {
    match v? {
        Val::Bool(b) => Some(b),
        Val::Str(s) if s == "true" => Some(true),
        Val::Str(s) if s == "false" => Some(false),
        _ => None,
    }
}

/// 读回收不收图：清单里有 `image` 就是收
pub(crate) fn image_of(v: Option<Val>) -> Option<bool> {
    match v? {
        Val::Arr(es) => Some(es.iter().any(|e| e.as_str() == Some("image"))),
        _ => None,
    }
}

/// 写进 `apiKey` 的那一串：读回来要原样是这把密钥。
///
/// Pi 会解释两种写法（`resolve-config-value.ts`）：`!` 开头的整串是一条 shell 命令，
/// `$NAME` / `${NAME}` 换成环境变量；`$$` 是一个 `$`，`$!` 是一个 `!`。core 发的密钥是
/// `tw-` 加 24 个小写字母和数字，两样都碰不上 —— 照样转义一遍，手改过 config.yaml 的密钥
/// 也不会被当成命令去执行。
///
/// omp 不认 `$`；`!` 开头的照样是命令，而且没有转义的写法；整串恰好是一个环境变量的名字时
/// 换成那个变量的值。`tw-` 开头的两样都不会是（变量名里没有 `-`），原样写。
pub fn literal_key(key: &str, flavor: Flavor) -> String {
    match flavor {
        Flavor::Pi => {
            let escaped = key.replace('$', "$$");
            match escaped.strip_prefix('!') {
                Some(rest) => format!("$!{rest}"),
                None => escaped,
            }
        }
        Flavor::Omp => key.to_string(),
    }
}

/// 接管要写的那几项。
pub fn edits(gw: &Gateway, flavor: Flavor) -> Vec<Edit> {
    let field = |k: &str, value: Val, secret: bool| Edit {
        path: vec!["providers".into(), PROVIDER_ID.into(), k.into()],
        value,
        secret,
    };
    let mut v = Vec::new();
    // provider 的显示名。omp 的 provider 没有这个字段
    if flavor == Flavor::Pi {
        v.push(field("name", Val::s("ThinkWatch"), false));
    }
    v.push(field("baseUrl", Val::s(DEFAULT_API.base(&gw.base)), false));
    v.push(field("api", Val::s(DEFAULT_API.slug()), false));
    if let Some(k) = &gw.key {
        v.push(field("apiKey", Val::s(literal_key(k, flavor)), true));
    }
    // **omp 必须写明 `auth`。**不写的话，`anthropic-messages` 的自定义模型按 OAuth 那一套
    // 发：请求伪装成 Claude Code（`custom-models.ts` 的 `resolveCustomModelIsOAuth`）。客户端
    // 是谁就说是谁。网关不要求鉴权时写 `none`：有模型却既没有 `apiKey` 又不是 `none`，omp
    // 认为整份文件不合法，连用户自己的 provider 一起不用了
    if flavor == Flavor::Omp {
        let auth = if gw.key.is_some() { "apiKey" } else { "none" };
        v.push(field("auth", Val::s(auth), false));
    }
    v.push(field("models", models_val(gw), false));
    v
}

/// 一个模型写进配置再读回来的样子，见 [`crate::clients::Client::as_written`]。四项都写得
/// 进去，只有 0 不写（见 [`specs`]）
pub fn as_written(m: &ModelCard) -> ModelCard {
    ModelCard {
        id: m.id.clone(),
        context_window: m.context_window.filter(|n| *n > 0),
        max_output_tokens: m.max_output_tokens.filter(|n| *n > 0),
        reasoning: m.reasoning,
        image_input: m.image_input,
    }
}

/// 配置里此刻写着的模型。没有那一条 provider 就是 `None`。
pub fn models_in(text: &str, flavor: Flavor) -> Option<Vec<ModelCard>> {
    let v = match flavor {
        Flavor::Pi => crate::json::value(text).ok()?,
        Flavor::Omp => crate::yamlval::value(text).ok()?,
    };
    let provider = lookup(&v, &["providers", PROVIDER_ID])?;
    match lookup(&provider, &["models"]) {
        Some(Val::Arr(ms)) => Some(
            ms.iter()
                .filter_map(|m| match lookup(m, &["id"]) {
                    Some(Val::Str(id)) => Some(ModelCard {
                        id,
                        context_window: count_of(lookup(m, &["contextWindow"])),
                        max_output_tokens: count_of(lookup(m, &["maxTokens"])),
                        reasoning: flag_of(lookup(m, &["reasoning"])),
                        image_input: image_of(lookup(m, &["input"])),
                    }),
                    _ => None,
                })
                .collect(),
        ),
        _ => Some(Vec::new()),
    }
}

// ---------------------------------------------------------------- 代理

/// Pi 访问网关会不会经过代理：会的话，接管之前说一声。
///
/// Pi 的出站请求都走 undici 的 `EnvHttpProxyAgent`（`http-dispatcher.ts`），它不认得回环
/// 地址：`NO_PROXY` 空着就一律走代理，**127.0.0.1 也不例外**。代理在别的机器上的话，它连的
/// 是它自己的 127.0.0.1，请求一个都到不了网关。Pi 设置里的 `httpProxy` 在 `HTTP_PROXY`、
/// `HTTPS_PROXY` 没设时补上它们（`main.ts` 的 `applyHttpProxySettings`）。
///
/// omp 不用说：它访问回环和内网地址一律不走代理（`proxy.ts` 的 `isLocalOrMetadataHost`）。
pub fn proxy_notes(client: &str, home: &Path, gw_base: &str, around: &Around) -> Vec<Msg> {
    if client != "pi" {
        return Vec::new();
    }
    let Some(url) = Target::parse(gw_base) else {
        return Vec::new();
    };
    let env = Env { home, around };
    // Pi 的 `httpProxy` 设置：大写的那个变量没设时由它补上（`applyHttpProxySettings`）
    let setting = || {
        let path = crate::paths::PI_SETTINGS.resolve(home);
        let text = std::fs::read_to_string(&path).ok()?;
        match crate::json::get(&text, &["httpProxy"]).ok()?? {
            Val::Str(s) if !s.trim().is_empty() => Some(path),
            _ => None,
        }
    };
    // undici 的挑法：小写的在就用小写的，设成空串也算设了、就是没有代理
    let proxy = |lower: &'static str, upper: &'static str| match env.get(lower) {
        Some(v) => (!v.is_empty()).then_some(Source::Env(lower)),
        None => match env.get(upper) {
            Some(v) => (!v.is_empty()).then_some(Source::Env(upper)),
            None => setting().map(Source::Setting),
        },
    };
    // https 的地址没有它自己的代理时，退回 http 的那一个
    let source = if url.https {
        proxy("https_proxy", "HTTPS_PROXY").or_else(|| proxy("http_proxy", "HTTP_PROXY"))
    } else {
        proxy("http_proxy", "HTTP_PROXY")
    };
    let no_proxy = env
        .get("no_proxy")
        .or_else(|| env.get("NO_PROXY"))
        .unwrap_or_default();
    let host = url.host.clone();
    match source {
        Some(_) if !url.proxied(&no_proxy) => Vec::new(),
        Some(Source::Env(name)) => vec![msg!(
            "adopt.plan.pi.proxy_env", name = name, host = host =>
            "{name} is set and NO_PROXY does not list {host}, so Pi sends its requests for the \
             gateway through that proxy. Adding {host} to NO_PROXY sends them directly."
        )],
        Some(Source::Setting(path)) => vec![msg!(
            "adopt.plan.pi.proxy_setting", path = crate::paths::shown_path(&path), host = host =>
            "{path} sets httpProxy and NO_PROXY does not list {host}, so Pi sends its requests \
             for the gateway through that proxy. Adding {host} to NO_PROXY sends them directly."
        )],
        None => Vec::new(),
    }
}

/// 代理是从哪儿来的。
enum Source {
    /// 这个环境变量
    Env(&'static str),
    /// Pi 设置文件里的 `httpProxy`
    Setting(std::path::PathBuf),
}

/// Pi 起来时手里的环境变量，尽量看准。
struct Env<'a> {
    home: &'a Path,
    around: &'a Around,
}

impl Env<'_> {
    /// 用户环境（登录 shell 取的那一份）说了算；那一份没取到的时候，看 shell 配置里 export 的
    fn get(&self, name: &str) -> Option<String> {
        if !self.around.env.is_empty() {
            return self.around.proxy.get(name).cloned();
        }
        crate::detect::shell_exports_valued(self.home, &[name])
            .into_iter()
            .next()
            .map(|e| e.value.unwrap_or_default())
    }
}

/// 网关地址里决定走不走代理的那几样。
struct Target {
    https: bool,
    host: String,
    port: u16,
}

impl Target {
    fn parse(base: &str) -> Option<Target> {
        let (scheme, rest) = base.split_once("://")?;
        let https = scheme.eq_ignore_ascii_case("https");
        let authority = rest.split(['/', '?', '#']).next()?;
        let (host, port) = match authority.strip_prefix('[') {
            Some(v6) => {
                let (h, after) = v6.split_once(']')?;
                (h.to_string(), after.strip_prefix(':'))
            }
            None => match authority.rsplit_once(':') {
                Some((h, p)) => (h.to_string(), Some(p)),
                None => (authority.to_string(), None),
            },
        };
        let port = match port {
            Some(p) => p.parse().ok()?,
            None if https => 443,
            None => 80,
        };
        Some(Target {
            https,
            host: host.to_ascii_lowercase(),
            port,
        })
    }

    /// 照 undici `EnvHttpProxyAgent#shouldProxy` 判：一项都没有就走代理；`*` 一律不走；
    /// 带端口的只管那个端口；主机名一样、或者是它的子域名就不走（`*.x` 只管子域名）。
    fn proxied(&self, no_proxy: &str) -> bool {
        for entry in no_proxy
            .split([',', ' ', '\t', '\n'])
            .filter(|e| !e.is_empty())
        {
            let (host, port) = match entry.strip_prefix('[').and_then(|e| e.split_once("]:")) {
                Some((h, p)) => (h, p.parse::<u16>().ok()),
                None => {
                    let bare = entry
                        .strip_prefix('[')
                        .and_then(|e| e.strip_suffix(']'))
                        .unwrap_or(entry);
                    match bare.split_once(':') {
                        Some((h, p))
                            if !p.contains(':') && p.bytes().all(|b| b.is_ascii_digit()) =>
                        {
                            (h, p.parse::<u16>().ok())
                        }
                        _ => (bare, None),
                    }
                }
            };
            let wildcard = entry.starts_with('*');
            let host = host
                .trim_start_matches("*.")
                .trim_start_matches('.')
                .trim_end_matches('.')
                .to_ascii_lowercase();
            if port.is_some_and(|p| p != self.port) {
                continue;
            }
            if host == "*"
                || (!wildcard && host == self.host)
                || self.host.ends_with(&format!(".{host}"))
            {
                return false;
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gw(models: &[&str]) -> Gateway {
        Gateway {
            base: "http://127.0.0.1:8788".into(),
            key: Some("tw-k".into()),
            models: models.iter().map(|m| ModelCard::named(*m)).collect(),
        }
    }

    #[test]
    fn each_model_goes_out_in_its_own_family_api() {
        for (m, api) in [
            ("claude-sonnet-5", Api::Anthropic),
            ("anthropic/claude-opus-4.5", Api::Anthropic),
            ("gemini-3-pro", Api::Google),
            ("gpt-5.5", Api::Responses),
            ("openai/gpt-5", Api::Responses),
            ("gpt-5.3-codex", Api::Responses),
            ("o3-mini", Api::Responses),
            ("o4-mini", Api::Responses),
            ("deepseek-chat", Api::Chat),
            ("qwen3-coder-plus", Api::Chat),
            ("glm-5", Api::Chat),
            ("kimi-k2", Api::Chat),
            // o 开头、后面不是数字的不是 o 系列
            ("ollama-mix", Api::Chat),
        ] {
            assert_eq!(api_for(m), api, "{m}");
        }
        assert_eq!(Api::Anthropic.base("http://h:1/"), "http://h:1");
        assert_eq!(Api::Google.base("http://h:1"), "http://h:1/v1beta");
        assert_eq!(Api::Chat.base("http://h:1"), "http://h:1/v1");
    }

    /// provider 那一种（Chat Completions、带 `/v1`）的模型只写 `id`；别的写上 `api`，地址
    /// 写法不一样的再写上 `baseUrl`
    #[test]
    fn a_model_carries_only_what_differs_from_the_provider() {
        let Val::Arr(ms) = models_val(&gw(&[
            "deepseek-chat",
            "claude-sonnet-5",
            "gpt-5",
            "gemini-3-pro",
            "deepseek-chat",
        ])) else {
            unreachable!()
        };
        let s = |k: &str, v: &str| (k.to_string(), Val::s(v));
        assert_eq!(
            ms,
            vec![
                Val::Obj(vec![s("id", "deepseek-chat")]),
                Val::Obj(vec![
                    s("id", "claude-sonnet-5"),
                    s("api", "anthropic-messages"),
                    s("baseUrl", "http://127.0.0.1:8788"),
                ]),
                Val::Obj(vec![s("id", "gpt-5"), s("api", "openai-responses")]),
                Val::Obj(vec![
                    s("id", "gemini-3-pro"),
                    s("api", "google-generative-ai"),
                    s("baseUrl", "http://127.0.0.1:8788/v1beta"),
                ]),
            ],
            "同名的只写一次"
        );
    }

    /// 照 Pi 自己的规则（`resolve-config-value.ts`）读回来，得是原来那把密钥
    #[test]
    fn the_key_written_for_pi_reads_back_as_itself() {
        // Pi 的解析：`!` 开头是命令；`$$` → `$`，`$!` → `!`，`$NAME` 换成变量
        fn pi_reads(v: &str) -> Option<String> {
            if v.starts_with('!') {
                return None;
            }
            let (mut out, mut it) = (String::new(), v.chars().peekable());
            while let Some(c) = it.next() {
                if c != '$' {
                    out.push(c);
                    continue;
                }
                match it.peek() {
                    Some('$') | Some('!') => out.push(it.next().unwrap()),
                    Some(n) if n.is_ascii_alphabetic() || *n == '_' || *n == '{' => return None,
                    _ => out.push('$'),
                }
            }
            Some(out)
        }
        for k in [
            "tw-abcdefghjkmnpqrstuvwxyz2",
            "tw-$HOME",
            "!rm -rf ~",
            "a$$b",
            "$!x",
            "tw-${X}",
        ] {
            let w = literal_key(k, Flavor::Pi);
            assert_eq!(pi_reads(&w).as_deref(), Some(k), "{k} 写成了 {w}");
        }
        // core 发的密钥原样写
        assert_eq!(literal_key("tw-abc23", Flavor::Pi), "tw-abc23");
        assert_eq!(literal_key("tw-$x", Flavor::Omp), "tw-$x");
    }

    /// omp 一定写明 `auth`，Pi 不写；Pi 的 provider 带显示名
    #[test]
    fn omp_always_says_how_it_authenticates() {
        let paths = |g: &Gateway, f| {
            edits(g, f)
                .into_iter()
                .map(|e| (e.path.join("."), e.value, e.secret))
                .collect::<Vec<_>>()
        };
        let omp = paths(&gw(&["claude-sonnet-5"]), Flavor::Omp);
        assert!(omp.contains(&("providers.thinkwatch.auth".into(), Val::s("apiKey"), false)));
        assert!(omp.contains(&("providers.thinkwatch.apiKey".into(), Val::s("tw-k"), true)));
        assert!(!omp.iter().any(|(p, _, _)| p == "providers.thinkwatch.name"));
        let keyless = Gateway {
            key: None,
            ..gw(&[])
        };
        let omp = paths(&keyless, Flavor::Omp);
        assert!(omp.contains(&("providers.thinkwatch.auth".into(), Val::s("none"), false)));
        assert!(!omp.iter().any(|(_, _, s)| *s));

        let pi = paths(&gw(&[]), Flavor::Pi);
        assert!(pi.contains(&(
            "providers.thinkwatch.name".into(),
            Val::s("ThinkWatch"),
            false
        )));
        assert!(pi.contains(&(
            "providers.thinkwatch.baseUrl".into(),
            Val::s("http://127.0.0.1:8788/v1"),
            false
        )));
        assert!(pi.contains(&(
            "providers.thinkwatch.api".into(),
            Val::s("openai-completions"),
            false
        )));
        assert!(!pi.iter().any(|(p, _, _)| p == "providers.thinkwatch.auth"));
    }

    fn card(
        id: &str,
        context: Option<u64>,
        output: Option<u64>,
        reasoning: Option<bool>,
        image: Option<bool>,
    ) -> ModelCard {
        ModelCard {
            id: id.into(),
            context_window: context,
            max_output_tokens: output,
            reasoning,
            image_input: image,
        }
    }

    #[test]
    fn known_specs_are_written_and_unknown_ones_left_out() {
        let g = Gateway {
            models: vec![
                card(
                    "claude-x",
                    Some(200_000),
                    Some(64_000),
                    Some(true),
                    Some(true),
                ),
                card(
                    "deepseek-chat",
                    Some(128_000),
                    None,
                    Some(false),
                    Some(false),
                ),
                card("bare", None, None, None, None),
                // 0 是没答，不是上限为 0：Pi 遇到 0 整份文件报错
                card("zero", Some(0), Some(0), None, None),
            ],
            ..gw(&[])
        };
        let Val::Arr(ms) = models_val(&g) else {
            unreachable!()
        };
        let num = |k: &str, n: &str| (k.to_string(), Val::Num(n.into()));
        let s = |k: &str, v: &str| (k.to_string(), Val::s(v));
        let input = |xs: &[&str]| {
            (
                "input".to_string(),
                Val::Arr(xs.iter().map(|x| Val::s(*x)).collect()),
            )
        };
        assert_eq!(
            ms,
            vec![
                Val::Obj(vec![
                    s("id", "claude-x"),
                    s("api", "anthropic-messages"),
                    s("baseUrl", "http://127.0.0.1:8788"),
                    num("contextWindow", "200000"),
                    num("maxTokens", "64000"),
                    ("reasoning".into(), Val::Bool(true)),
                    input(&["text", "image"]),
                ]),
                Val::Obj(vec![
                    s("id", "deepseek-chat"),
                    num("contextWindow", "128000"),
                    ("reasoning".into(), Val::Bool(false)),
                    input(&["text"]),
                ]),
                Val::Obj(vec![s("id", "bare")]),
                Val::Obj(vec![s("id", "zero")]),
            ]
        );
    }

    /// 写进两种文件再读回来，和网关答的一样；规格变了就要更新
    #[test]
    fn specs_read_back_from_either_file() {
        let now = vec![
            card(
                "claude-x",
                Some(200_000),
                Some(64_000),
                Some(true),
                Some(true),
            ),
            card(
                "deepseek-chat",
                Some(128_000),
                None,
                Some(false),
                Some(false),
            ),
            card("bare", None, None, None, None),
        ];
        let g = Gateway {
            models: now.clone(),
            ..gw(&[])
        };
        for (flavor, id) in [(Flavor::Pi, "pi"), (Flavor::Omp, "omp")] {
            let text = edits(&g, flavor).iter().fold(String::new(), |t, e| {
                let p: Vec<&str> = e.path.iter().map(String::as_str).collect();
                match flavor {
                    Flavor::Pi => {
                        crate::json::set(if t.is_empty() { "{}" } else { &t }, &p, &e.value)
                            .unwrap()
                    }
                    Flavor::Omp => crate::yaml::set(&t, &p, &e.value).unwrap(),
                }
            });
            assert_eq!(models_in(&text, flavor), Some(now.clone()), "{text}");
            let c = crate::clients::adoptable()
                .into_iter()
                .find(|c| c.id == id)
                .unwrap();
            let back = models_in(&text, flavor).unwrap();
            assert!(!c.models_stale(&back, &now));
            for change in [
                |m: &mut ModelCard| m.context_window = Some(1_000_000),
                |m: &mut ModelCard| m.max_output_tokens = Some(128_000),
                |m: &mut ModelCard| m.reasoning = None,
                |m: &mut ModelCard| m.image_input = Some(false),
            ] {
                let mut changed = now.clone();
                change(&mut changed[0]);
                assert!(c.models_stale(&back, &changed), "{id}: {changed:?}");
            }
        }
    }

    #[test]
    fn the_models_are_read_back_from_either_file() {
        let json = r#"{"providers": {"thinkwatch": {"models": [{"id": "a"}, {"id": "b", "api": "anthropic-messages"}]}}}"#;
        assert_eq!(
            models_in(json, Flavor::Pi),
            Some(vec!["a".into(), "b".into()])
        );
        assert_eq!(models_in(r#"{"providers": {}}"#, Flavor::Pi), None);
        assert_eq!(
            models_in(r#"{"providers": {"thinkwatch": {}}}"#, Flavor::Pi),
            Some(Vec::new())
        );
        let yaml = "providers:\n  thinkwatch:\n    models:\n      - id: a\n      - id: b\n";
        assert_eq!(
            models_in(yaml, Flavor::Omp),
            Some(vec!["a".into(), "b".into()])
        );
    }

    fn around(vars: &[(&str, &str)]) -> Around {
        Around {
            // 取到过用户环境：只认里面的代理变量
            env: [("HOME".to_string(), "/h".to_string())].into(),
            proxy: vars
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            ..Around::default()
        }
    }

    #[test]
    fn a_proxy_without_no_proxy_is_said_before_connecting_pi() {
        let d = tempfile::tempdir().unwrap();
        let base = "http://127.0.0.1:8788";
        let notes = |vars: &[(&str, &str)]| proxy_notes("pi", d.path(), base, &around(vars));
        let n = notes(&[("HTTP_PROXY", "http://proxy:3128")]);
        assert_eq!(n.len(), 1);
        assert_eq!(n[0].code, "adopt.plan.pi.proxy_env");
        assert_eq!(n[0].arg("name"), "HTTP_PROXY");
        assert_eq!(n[0].arg("host"), "127.0.0.1");
        // 小写的优先；设成空串就是没有代理
        assert_eq!(
            notes(&[("http_proxy", "http://p:1")])[0].arg("name"),
            "http_proxy"
        );
        assert!(notes(&[("http_proxy", ""), ("HTTP_PROXY", "http://p:1")]).is_empty());
        // NO_PROXY 列了这个地址（带不带端口都行）、或者写了 * 就直连
        for no in [
            "127.0.0.1",
            "localhost,127.0.0.1",
            "127.0.0.1:8788",
            "*",
            " *  ",
            "[::1],127.0.0.1",
        ] {
            assert!(
                notes(&[("HTTP_PROXY", "http://p:1"), ("NO_PROXY", no)]).is_empty(),
                "{no}"
            );
        }
        // 只写 localhost、端口不对、别的主机的不算
        for no in ["localhost", "127.0.0.1:9999", "example.com"] {
            assert_eq!(
                notes(&[("HTTP_PROXY", "http://p:1"), ("NO_PROXY", no)]).len(),
                1,
                "{no}"
            );
        }
        // http 的地址不看 HTTPS_PROXY；omp 不走代理，不说
        assert!(notes(&[("HTTPS_PROXY", "http://p:1")]).is_empty());
        assert!(
            proxy_notes(
                "omp",
                d.path(),
                base,
                &around(&[("HTTP_PROXY", "http://p:1")])
            )
            .is_empty()
        );
        assert!(notes(&[]).is_empty());
    }

    /// Pi 设置里的 `httpProxy`：两个变量都没设时它生效
    #[test]
    fn the_http_proxy_setting_of_pi_counts_too() {
        let d = tempfile::tempdir().unwrap();
        let settings = crate::paths::PI_SETTINGS.resolve(d.path());
        std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
        std::fs::write(&settings, r#"{"httpProxy": "http://proxy:3128"}"#).unwrap();
        let n = proxy_notes("pi", d.path(), "http://127.0.0.1:8788", &around(&[]));
        assert_eq!(n.len(), 1);
        assert_eq!(n[0].code, "adopt.plan.pi.proxy_setting");
        let none = proxy_notes(
            "pi",
            d.path(),
            "http://127.0.0.1:8788",
            &around(&[("NO_PROXY", "127.0.0.1")]),
        );
        assert!(none.is_empty());
    }

    /// 没取到用户环境（取不到、WSL）时，看 shell 配置里 export 的
    #[test]
    #[cfg(not(windows))]
    fn without_the_user_environment_the_shell_files_are_read() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join(".zshrc"), "export HTTP_PROXY=http://p:1\n").unwrap();
        let n = proxy_notes("pi", d.path(), "http://127.0.0.1:8788", &Around::default());
        assert_eq!(n.len(), 1);
        std::fs::write(
            d.path().join(".zshrc"),
            "export HTTP_PROXY=http://p:1\nexport NO_PROXY=localhost,127.0.0.1\n",
        )
        .unwrap();
        assert!(
            proxy_notes("pi", d.path(), "http://127.0.0.1:8788", &Around::default()).is_empty()
        );
    }

    #[test]
    fn the_gateway_address_is_read_like_undici_reads_it() {
        let t = Target::parse("http://[::1]:8788/x").unwrap();
        assert_eq!((t.host.as_str(), t.port, t.https), ("::1", 8788, false));
        assert!(!t.proxied("[::1]:8788"));
        assert!(!t.proxied("::1"));
        let t = Target::parse("https://Core.Example.com").unwrap();
        assert_eq!(
            (t.host.as_str(), t.port, t.https),
            ("core.example.com", 443, true)
        );
        assert!(!t.proxied(".example.com"));
        assert!(!t.proxied("*.example.com"));
        assert!(t.proxied("other.com"));
        assert!(Target::parse("not a url").is_none());
    }
}
