//! Qwen Code：网关的模型写成它自己的一组 provider，密钥经 `settings.env` 交给它。
//!
//! **用自己的 provider id（`thinkwatch`），经 `providerProtocol` 映射到 openai。**不写进
//! `modelProviders.openai`，三个理由：
//!
//! - 那张列表是用户自己的（`/auth` 也写它），整张换掉，接管期间他自己的模型就选不到了；
//! - 运行中的 Qwen 会热重载 `modelProviders`，可 `settings.env` 要重启才读。正在用的模型
//!   要是被换成了我们的那一条，它找不到我们的变量，就退回 `OPENAI_API_KEY` —— 用户自己的
//!   密钥被发到网关来。`providerProtocol` 也要重启才读：重启之前它认不出 `thinkwatch` 这一组，
//!   整组跳过，正在跑的会话碰不到我们写的东西；
//! - 用户再跑一次 `/auth`，改的是 `openai` 那一组，碰不到这一组。
//!
//! 代价是要 0.19.3 以后的版本（`providerProtocol` 那时才有），接管代价里说。
//!
//! 选的是 openai 协议，不是 anthropic：后者指向非官方地址时会把自己报成 `claude-cli`，
//! 而这个产品的规矩是如实说明客户端是谁。Chat Completions 拼的是 `{baseUrl}/chat/completions`，
//! 所以写带 `/v1` 的地址。

use crate::clients::{Edit, Gateway, ModelCard, PROVIDER_ID};
use crate::json::Val;

/// 装着网关密钥的那个环境变量：写进 `settings.env`，每一条模型用 `envKey` 指着它。
///
/// **名字是 Qwen 专用的。**`settings.env` 优先级最低：shell 里 export 了同名变量就用 shell
/// 里的。DeepSeek Harness 的引用名是 `THINKWATCH_API_KEY`，那把是给 dsh 发的 —— 共用一个
/// 名字的话，Qwen 的请求会记在 dsh 那把密钥名下
pub const KEY_ENV: &str = "THINKWATCH_QWEN_API_KEY";

/// 网关不要密钥时写进那个变量的值。**不能留空**：变量是空的，Qwen 退回
/// `OPENAI_API_KEY`，用户自己的密钥就发到了网关。这个值什么都打不开
pub const NO_KEY: &str = "no-key";

/// 网关列出来的模型，同名的只算一次
fn unique(gw: &Gateway) -> Vec<&ModelCard> {
    let mut seen = std::collections::HashSet::new();
    gw.models
        .iter()
        .filter(|m| seen.insert(m.id.as_str()))
        .collect()
}

fn v1(gw: &Gateway) -> String {
    format!("{}/v1", gw.base.trim_end_matches('/'))
}

fn at(path: &[&str]) -> Vec<String> {
    path.iter().map(|s| s.to_string()).collect()
}

/// 接管要写的那几项。
///
/// 选哪个模型：此刻选着的模型网关也有就留着它，否则用清单里的第一个。`model.baseUrl`
/// **跟着一起写**：同名的模型在用户自己那一组里也有一条时，Qwen 拿它分辨用哪一条。
///
/// 网关一个模型都没列出来时什么都不写，接管说明里会说（`adopt.plan.no_models`）
pub fn edits(gw: &Gateway, current: &str) -> Vec<Edit> {
    let models = unique(gw);
    let Some(first) = models.first() else {
        return Vec::new();
    };
    let base = v1(gw);
    let entries: Vec<Val> = models
        .iter()
        .map(|m| {
            Val::Obj(vec![
                ("id".into(), Val::s(&m.id)),
                ("name".into(), Val::s(format!("{} (ThinkWatch)", m.id))),
                ("baseUrl".into(), Val::s(&base)),
                ("envKey".into(), Val::s(KEY_ENV)),
            ])
        })
        .collect();
    let now = match crate::json::get(current, &["model", "name"]) {
        Ok(Some(Val::Str(s))) => Some(s),
        _ => None,
    };
    let chosen = now
        .filter(|n| models.iter().any(|m| &m.id == n))
        .unwrap_or_else(|| first.id.clone());
    let plain = |path: &[&str], value: Val| Edit {
        path: at(path),
        value,
        secret: false,
    };
    vec![
        plain(&["modelProviders", PROVIDER_ID], Val::Arr(entries)),
        plain(&["providerProtocol", PROVIDER_ID], Val::s("openai")),
        match &gw.key {
            Some(k) => Edit {
                path: at(&["env", KEY_ENV]),
                value: Val::s(k),
                secret: true,
            },
            None => plain(&["env", KEY_ENV], Val::s(NO_KEY)),
        },
        plain(&["security", "auth", "selectedType"], Val::s("openai")),
        plain(&["model", "name"], Val::s(chosen)),
        plain(&["model", "baseUrl"], Val::s(base)),
    ]
}

/// 我们那一组里的模型条目
fn entries(text: &str) -> Vec<Val> {
    match crate::json::get(text, &["modelProviders", PROVIDER_ID]) {
        Ok(Some(Val::Arr(es))) => es,
        _ => Vec::new(),
    }
}

fn field(v: &Val, key: &str) -> Option<String> {
    match v {
        Val::Obj(ms) => ms
            .iter()
            .find(|(k, _)| k == key)
            .and_then(|(_, v)| match v {
                Val::Str(s) => Some(s.clone()),
                _ => None,
            }),
        _ => None,
    }
}

/// 配置里此刻指向哪儿：`model.name` 选着的是我们那一组里的一条，就是它的地址。
///
/// 用户在 `/model` 里换回了自己的模型，Qwen 就不走网关了 —— 那就是「我们写的不在了」
pub fn endpoint(text: &str) -> Option<String> {
    let name = match crate::json::get(text, &["model", "name"]).ok()?? {
        Val::Str(s) => s,
        _ => return None,
    };
    let picked = match crate::json::get(text, &["model", "baseUrl"]).ok().flatten() {
        Some(Val::Str(s)) if !s.is_empty() => Some(s),
        _ => None,
    };
    entries(text)
        .iter()
        .filter(|e| field(e, "id").as_deref() == Some(name.as_str()))
        .filter_map(|e| field(e, "baseUrl"))
        .find(|b| picked.as_ref().is_none_or(|p| p == b))
}

/// 一个模型写进配置再读回来的样子，见 [`crate::clients::Client::as_written`]
pub fn as_written(m: &ModelCard) -> ModelCard {
    ModelCard::named(&m.id)
}

/// 配置里此刻写着的模型：我们那一组里每一条的 `id`。没有那一组就是一份空的（接管时网关
/// 一个模型都没有的话就是这样，等网关有了模型，客户端页拿它去比才提示得出要更新）
pub fn models_in(text: &str) -> Option<Vec<ModelCard>> {
    Some(
        entries(text)
            .iter()
            .filter_map(|e| field(e, "id"))
            .map(ModelCard::named)
            .collect(),
    )
}

/// 一份 settings.json 里装着凭据的值：`env` 底下名字像凭据的那些（`/auth` 把各家的 API key
/// 写在这里），和旧写法的 `security.auth.apiKey`。画 diff 之前拿它们打码
pub fn secrets(text: &str) -> Vec<String> {
    let mut v = crate::cloud::env_secrets(text);
    if let Ok(Some(Val::Str(k))) = crate::json::get(text, &["security", "auth", "apiKey"]) {
        v.push(k);
    }
    v.retain(|k| k != NO_KEY);
    v
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

    fn get(edits: &[Edit], path: &str) -> Option<(Val, bool)> {
        edits
            .iter()
            .find(|e| e.path.join(".") == path)
            .map(|e| (e.value.clone(), e.secret))
    }

    #[test]
    fn the_models_go_into_a_provider_of_our_own_mapped_to_openai() {
        let e = edits(&gw(&["qwen3-coder-plus", "claude-sonnet-5"]), "");
        let Some((Val::Arr(es), false)) = get(&e, "modelProviders.thinkwatch") else {
            panic!("{e:?}")
        };
        assert_eq!(es.len(), 2);
        assert_eq!(field(&es[0], "id").as_deref(), Some("qwen3-coder-plus"));
        assert_eq!(
            field(&es[0], "baseUrl").as_deref(),
            Some("http://127.0.0.1:8788/v1")
        );
        assert_eq!(field(&es[1], "envKey").as_deref(), Some(KEY_ENV));
        assert_eq!(
            get(&e, "providerProtocol.thinkwatch"),
            Some((Val::s("openai"), false))
        );
        assert_eq!(
            get(&e, &format!("env.{KEY_ENV}")),
            Some((Val::s("tw-k"), true))
        );
        assert_eq!(
            get(&e, "security.auth.selectedType"),
            Some((Val::s("openai"), false))
        );
        assert_eq!(
            get(&e, "model.name"),
            Some((Val::s("qwen3-coder-plus"), false))
        );
        assert_eq!(
            get(&e, "model.baseUrl"),
            Some((Val::s("http://127.0.0.1:8788/v1"), false))
        );
        // 用户自己的 openai 那一组不碰
        assert!(
            e.iter()
                .all(|x| x.path.get(1).map(String::as_str) != Some("openai"))
        );
    }

    /// 变量不能留空：空着的话 Qwen 退回 `OPENAI_API_KEY`
    #[test]
    fn the_key_variable_is_never_empty() {
        let mut g = gw(&["m"]);
        g.key = None;
        let (v, secret) = get(&edits(&g, ""), &format!("env.{KEY_ENV}")).unwrap();
        assert!(!secret);
        assert!(!v.to_line().trim().is_empty());
    }

    #[test]
    fn the_selected_model_stays_when_the_gateway_has_it() {
        let g = gw(&["a", "b"]);
        let pick = |text: &str| get(&edits(&g, text), "model.name").unwrap().0;
        assert_eq!(pick(r#"{"model": {"name": "b"}}"#), Val::s("b"));
        assert_eq!(pick(r#"{"model": {"name": "qwen3.7-max"}}"#), Val::s("a"));
        assert_eq!(pick("{}"), Val::s("a"));
        assert!(edits(&gw(&[]), "{}").is_empty(), "没有模型就什么都不写");
    }

    #[test]
    fn the_endpoint_is_the_entry_the_selected_model_names() {
        let text = r#"{
          "modelProviders": {
            "openai": [{"id": "a", "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1"}],
            "thinkwatch": [{"id": "a", "baseUrl": "http://127.0.0.1:1/v1"}, {"id": "b", "baseUrl": "http://127.0.0.1:1/v1"}]
          },
          "model": {"name": "a", "baseUrl": "http://127.0.0.1:1/v1"}
        }"#;
        assert_eq!(endpoint(text).as_deref(), Some("http://127.0.0.1:1/v1"));
        assert_eq!(models_in(text), Some(vec!["a".into(), "b".into()]));
        // 换回了用户自己那一条同名的：不走网关
        let theirs = text.replace(
            r#""name": "a", "baseUrl": "http://127.0.0.1:1/v1""#,
            r#""name": "a", "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1""#,
        );
        assert_eq!(endpoint(&theirs), None);
        assert_eq!(models_in("{}"), Some(Vec::new()));
    }

    #[test]
    fn credentials_in_env_and_the_old_auth_key_are_secrets_for_the_diff() {
        let text = r#"{"env": {"DASHSCOPE_API_KEY": "sk-dash-123", "THEME": "dark"}, "security": {"auth": {"apiKey": "sk-old-456"}}}"#;
        let got = secrets(text);
        assert!(got.contains(&"sk-dash-123".to_string()), "{got:?}");
        assert!(got.contains(&"sk-old-456".to_string()), "{got:?}");
        assert!(!got.contains(&"dark".to_string()), "{got:?}");
    }
}
