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

use crate::clients::{Edit, Gateway, PROVIDER_ID};
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
/// 别的元数据不写：Pi 照默认的上下文和输出长度跑，omp 按模型名从它自带的目录里补。同名的
/// 只写一次，先后照网关答的。
pub fn models_val(gw: &Gateway) -> Val {
    let mut seen = HashSet::new();
    Val::Arr(
        gw.models
            .iter()
            .filter(|m| seen.insert(m.as_str()))
            .map(|m| {
                let api = api_for(m);
                let mut fields = vec![("id".to_string(), Val::s(m))];
                if api != DEFAULT_API {
                    fields.push(("api".into(), Val::s(api.slug())));
                    if api.base(&gw.base) != DEFAULT_API.base(&gw.base) {
                        fields.push(("baseUrl".into(), Val::s(api.base(&gw.base))));
                    }
                }
                Val::Obj(fields)
            })
            .collect(),
    )
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

/// 配置里此刻写着的模型。没有那一条 provider 就是 `None`。
pub fn models_in(text: &str, flavor: Flavor) -> Option<Vec<String>> {
    let v = match flavor {
        Flavor::Pi => crate::json::value(text).ok()?,
        Flavor::Omp => crate::yamlval::value(text).ok()?,
    };
    let provider = lookup(&v, &["providers", PROVIDER_ID])?;
    match lookup(&provider, &["models"]) {
        Some(Val::Arr(ms)) => Some(
            ms.iter()
                .filter_map(|m| match lookup(m, &["id"]) {
                    Some(Val::Str(id)) => Some(id),
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
            models: models.iter().map(|m| m.to_string()).collect(),
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

    #[test]
    fn the_models_are_read_back_from_either_file() {
        let json = r#"{"providers": {"thinkwatch": {"models": [{"id": "a"}, {"id": "b", "api": "anthropic-messages"}]}}}"#;
        assert_eq!(
            models_in(json, Flavor::Pi),
            Some(vec!["a".to_string(), "b".to_string()])
        );
        assert_eq!(models_in(r#"{"providers": {}}"#, Flavor::Pi), None);
        assert_eq!(
            models_in(r#"{"providers": {"thinkwatch": {}}}"#, Flavor::Pi),
            Some(Vec::new())
        );
        let yaml = "providers:\n  thinkwatch:\n    models:\n      - id: a\n      - id: b\n";
        assert_eq!(
            models_in(yaml, Flavor::Omp),
            Some(vec!["a".to_string(), "b".to_string()])
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
