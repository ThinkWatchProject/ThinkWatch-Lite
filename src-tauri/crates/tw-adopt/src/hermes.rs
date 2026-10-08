//! Hermes Agent（Nous Research）：`model` 那一节换成指向网关的自定义 provider。
//!
//! 写的是 `model.{provider: custom, base_url, api_key, default, api_mode}`。地址带 `/v1`：
//! Chat Completions 原样交给 OpenAI SDK，拼 `{base_url}/chat/completions`；Messages 先去掉
//! 末尾的 `/v1` 再拼 `/v1/messages`，两种写法都对。
//!
//! **协议只有两种可选。**普通的 `provider: custom` 上，`api_mode: codex_responses` 只在
//! OpenAI、xAI、Meta 自己的地址上才算数，指向网关时会被丢掉、退回 Chat Completions
//! （`_resolve_plain_custom_api_mode`）—— 所以 Claude 走 Messages，别的都走 Chat Completions。
//!
//! 它有多个 profile：默认的那一个就是家目录本身（`~/.hermes/config.yaml`），别的在
//! `profiles/<名>/` 下，各有各的配置。这里只改默认的那一个，有别的 profile 时接管说明里说
//! 清楚；用 `hermes profile use` 粘住了别的 profile 的，平常启动就读不到这一份，同样要说。

use std::path::Path;

use crate::clients::{Edit, Gateway};
use crate::json::Val;

/// 这个模型走哪一种协议：Claude 走 Messages（它的原生格式，思考和缓存不用转），别的走
/// Chat Completions。只看名字，网关的模型清单不说一个模型背后是哪种上游
pub fn api_mode_for(model: &str) -> &'static str {
    let m = model.trim().to_ascii_lowercase();
    let name = m.rsplit('/').next().unwrap_or(&m);
    if name.starts_with("claude") {
        "anthropic_messages"
    } else {
        "chat_completions"
    }
}

fn at(key: &str) -> Vec<String> {
    vec!["model".to_string(), key.to_string()]
}

/// 接管要写的那几项。
///
/// 默认模型：此刻的 `model.default` 网关也有就留着它，否则用清单里的第一个。网关一个模型
/// 都没列出来时什么都不写（接管说明里说），写一个它服务不了的模型名进去，Hermes 每一轮都会
/// 报错。
///
/// 没有网关密钥就不写 `api_key`：Hermes 会用 `no-key-required` 顶上，指向本机的地址拿不到
/// 别家的密钥（`_host_gated_env_key_candidates` 只把 `OPENAI_API_KEY` 这类交给它们自己的地址）
pub fn edits(gw: &Gateway, current: &str) -> Vec<Edit> {
    let Some(first) = gw.models.first() else {
        return Vec::new();
    };
    let now = match crate::yaml::get(current, &["model", "default"]) {
        Ok(Some(s)) if !s.trim().is_empty() => Some(s),
        _ => None,
    };
    let chosen = now
        .filter(|n| gw.models.iter().any(|m| &m.id == n))
        .unwrap_or_else(|| first.id.clone());
    let plain = |key: &str, value: &str| Edit {
        path: at(key),
        value: Val::s(value),
        secret: false,
    };
    let mut v = vec![plain("provider", "custom"), plain("base_url", &gw.v1())];
    if let Some(k) = &gw.key {
        v.push(Edit {
            path: at("api_key"),
            value: Val::s(k),
            secret: true,
        });
    }
    v.push(plain("api_mode", api_mode_for(&chosen)));
    v.push(plain("default", &chosen));
    v
}

/// 配置里此刻指向哪儿：`model.provider` 还是 `custom` 才算 —— 换成了别的 provider，
/// `base_url` 就不是它在用的那个了
pub fn endpoint(text: &str) -> Option<String> {
    let provider = crate::yaml::get(text, &["model", "provider"]).ok()??;
    if provider.trim() != "custom" {
        return None;
    }
    crate::yaml::get(text, &["model", "base_url"]).ok()?
}

/// profile 名字的规矩，和 Hermes 自己的一样：小写字母或数字开头，后面跟字母、数字、`_`、`-`，
/// 最多 64 个字符
fn valid_profile_name(name: &str) -> bool {
    let mut cs = name.chars();
    cs.next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && name.len() <= 64
        && cs.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// 认得出是一个 profile 的文件：照 Hermes 的 `_HERMES_HOME_MARKERS` 一类
const PROFILE_MARKERS: &[&str] = &[
    "config.yaml",
    ".env",
    "SOUL.md",
    "profile.yaml",
    "auth.json",
    "state.db",
];

/// 默认之外的那几个 profile：`profiles/<名>/` 下名字合规、里面有 profile 的痕迹、没被删掉
/// （`profiles/.deleted/<名>`）的。按名字排好
pub fn other_profiles(home_dir: &Path) -> Vec<String> {
    let root = home_dir.join("profiles");
    let Ok(rd) = std::fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut out: Vec<String> = rd
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n != "default" && valid_profile_name(n))
        .filter(|n| {
            let dir = root.join(n);
            PROFILE_MARKERS.iter().any(|m| dir.join(m).exists())
        })
        .filter(|n| !root.join(".deleted").join(n).exists())
        .collect();
    out.sort();
    out
}

/// 用 `hermes profile use` 粘住的那一个（`active_profile` 文件），不是默认的才算。粘住了别的
/// profile 时，不带 `-p` 启动的 Hermes 读的是那个 profile 的配置，读不到这里改的这一份
pub fn active_profile(home_dir: &Path) -> Option<String> {
    let name = std::fs::read_to_string(home_dir.join("active_profile")).ok()?;
    let name = name.trim();
    (!name.is_empty() && name != "default").then(|| name.to_string())
}

/// 一份 `.env` 里会盖住我们写的那几项：`CUSTOM_BASE_URL` 压过 `model.base_url`，而这份
/// `.env` 又压过 shell 里 export 的同名变量
pub fn overriding_env(text: &str) -> Vec<String> {
    let set = text.lines().any(|l| {
        let l = l.trim_start();
        let l = l.strip_prefix("export ").unwrap_or(l).trim_start();
        l.strip_prefix("CUSTOM_BASE_URL")
            .and_then(|rest| rest.trim_start().strip_prefix('='))
            .is_some_and(|v| {
                let v = v.trim().trim_matches(|c| c == '"' || c == '\'');
                !v.is_empty() && !v.starts_with('#')
            })
    });
    if set {
        vec!["CUSTOM_BASE_URL".to_string()]
    } else {
        Vec::new()
    }
}

/// 一份 config.yaml 里装着凭据的值：各处名字像凭据的键（`api_key`、`*_token`、`password`…）
/// 底下的字符串 —— `model.api_key`，`providers.<名>.api_key`，`auxiliary.*.api_key`，
/// `hooks.outbound` 的 `secret`。画 diff 之前拿它们打码，界面上画的是整份文件，而 YAML 里
/// 它们多半不带引号
pub fn secrets(text: &str) -> Vec<String> {
    fn walk(v: &Val, out: &mut Vec<String>) {
        match v {
            Val::Obj(ms) => {
                for (k, x) in ms {
                    match x {
                        // `key_env`、`secret_env` 写的是变量名，不是密钥
                        Val::Str(s)
                            if (crate::cloud::is_secret_env(k) && !k.ends_with("_env"))
                                || k == "secret" =>
                        {
                            out.push(s.clone())
                        }
                        _ => walk(x, out),
                    }
                }
            }
            Val::Arr(es) => es.iter().for_each(|x| walk(x, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    if let Ok(v) = crate::yamlval::value(text) {
        walk(&v, &mut out);
    }
    // `${VAR}` 引用不是密钥本身，别把那几个字盖掉
    out.retain(|s| !(s.starts_with("${") && s.ends_with('}')));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gw(models: &[&str]) -> Gateway {
        Gateway {
            base: "http://127.0.0.1:8788".into(),
            key: Some("tw-k".into()),
            models: models
                .iter()
                .map(|m| crate::clients::ModelCard::named(*m))
                .collect(),
        }
    }

    fn get(edits: &[Edit], path: &str) -> Option<(Val, bool)> {
        edits
            .iter()
            .find(|e| e.path.join(".") == path)
            .map(|e| (e.value.clone(), e.secret))
    }

    #[test]
    fn the_model_section_points_at_the_gateway() {
        let e = edits(&gw(&["claude-sonnet-5", "gpt-5.5"]), "");
        assert_eq!(get(&e, "model.provider"), Some((Val::s("custom"), false)));
        assert_eq!(
            get(&e, "model.base_url"),
            Some((Val::s("http://127.0.0.1:8788/v1"), false))
        );
        assert_eq!(get(&e, "model.api_key"), Some((Val::s("tw-k"), true)));
        assert_eq!(
            get(&e, "model.default"),
            Some((Val::s("claude-sonnet-5"), false))
        );
        assert_eq!(
            get(&e, "model.api_mode"),
            Some((Val::s("anthropic_messages"), false))
        );
        // 别的模型走 Chat Completions；Responses 在自定义地址上会被它丢掉
        let e = edits(&gw(&["gpt-5.5"]), "");
        assert_eq!(
            get(&e, "model.api_mode"),
            Some((Val::s("chat_completions"), false))
        );
        assert!(edits(&gw(&[]), "").is_empty(), "没有模型就什么都不写");
        let mut g = gw(&["m"]);
        g.key = None;
        assert!(get(&edits(&g, ""), "model.api_key").is_none());
    }

    #[test]
    fn the_default_model_stays_when_the_gateway_has_it() {
        let g = gw(&["a", "b"]);
        let pick = |text: &str| get(&edits(&g, text), "model.default").unwrap().0;
        assert_eq!(pick("model:\n  default: b\n"), Val::s("b"));
        assert_eq!(
            pick("model:\n  default: \"anthropic/claude-opus-4.6\"\n"),
            Val::s("a")
        );
        assert_eq!(pick(""), Val::s("a"));
    }

    #[test]
    fn the_endpoint_counts_only_while_the_provider_is_custom() {
        let text = "model:\n  provider: custom\n  base_url: http://127.0.0.1:1/v1\n";
        assert_eq!(endpoint(text).as_deref(), Some("http://127.0.0.1:1/v1"));
        let other = text.replace("provider: custom", "provider: openrouter");
        assert_eq!(endpoint(&other), None);
    }

    #[test]
    fn other_profiles_and_the_sticky_one_are_found_the_way_hermes_finds_them() {
        let d = tempfile::tempdir().unwrap();
        let home = d.path();
        let mk = |rel: &str| {
            let p = home.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, "x").unwrap();
        };
        mk("profiles/work/config.yaml");
        mk("profiles/coder/SOUL.md");
        mk("profiles/gone/config.yaml");
        mk("profiles/.deleted/gone");
        mk("profiles/Bad/config.yaml");
        std::fs::create_dir_all(home.join("profiles/empty")).unwrap();
        assert_eq!(other_profiles(home), ["coder", "work"]);
        assert_eq!(active_profile(home), None);
        std::fs::write(home.join("active_profile"), "work\n").unwrap();
        assert_eq!(active_profile(home).as_deref(), Some("work"));
        std::fs::write(home.join("active_profile"), "default").unwrap();
        assert_eq!(active_profile(home), None);
    }

    #[test]
    fn custom_base_url_in_env_overrides_us() {
        assert_eq!(
            overriding_env("OPENROUTER_API_KEY=sk-or\nCUSTOM_BASE_URL=http://x/v1\n"),
            ["CUSTOM_BASE_URL"]
        );
        assert_eq!(
            overriding_env("export CUSTOM_BASE_URL = 'http://x'\n"),
            ["CUSTOM_BASE_URL"]
        );
        assert!(overriding_env("# CUSTOM_BASE_URL=http://x\nCUSTOM_BASE_URL=\n").is_empty());
        assert!(overriding_env("CUSTOM_BASE_URL_OLD=x\n").is_empty());
    }

    #[test]
    fn credential_looking_values_are_secrets_for_the_diff() {
        let text = "model:\n  api_key: sk-mine-123\n  default: x\nproviders:\n  relay:\n    api_key: \"sk-relay-456\"\n    key_env: RELAY_KEY\n  env:\n    api_key: ${HERMES_KEY}\nhooks:\n  outbound:\n    - url: https://hooks.example.com\n      secret: whsec-789\n";
        let got = secrets(text);
        for s in ["sk-mine-123", "sk-relay-456", "whsec-789"] {
            assert!(got.contains(&s.to_string()), "{s}: {got:?}");
        }
        assert!(
            !got.iter().any(|s| s == "x" || s.starts_with("${")),
            "{got:?}"
        );
    }
}
