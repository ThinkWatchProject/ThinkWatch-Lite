//! Grok Build 的几处特殊：每个模型一张表、每张表都带自己的密钥、按模型挑协议。
//!
//! 它的模型写在 `~/.grok/config.toml` 的 `[model.<名>]` 里，`[models] default` 选其中一张。
//! **每张表都要有自己的 `api_key`**：一张没有密钥的表，Grok 会拿用户登录 xAI 得到的会话令牌
//! 去请求表里的 `base_url`（`resolve_credentials` 的第三档，`may_receive_session` 对任何地址都
//! 放行），再不然就是 `XAI_API_KEY` —— 两样都是别人的凭据，不该发到网关来。空串也不算：它
//! 只认去掉空白后不为空的那一个。
//!
//! 地址原样拼接，所以写带 `/v1` 的那一个。它不问网关要模型清单（那条路要 `XAI_API_KEY`），
//! 模型要一张张写进来，清单变了由客户端页提示更新（[`crate::clients::Client::writes_models`]）。
//!
//! 它自己也写这份文件（`/model`、`/settings`、自动更新之后），用的是重新序列化，注释和排版
//! 一律丢掉 —— 哨兵注释会跟着没了，旁文件里的记录还在，还原照样做得了。

use crate::clients::{Edit, Gateway, ModelCard};
use crate::json::Val;

/// 我们写的模型表的名字：`[model."thinkwatch/<模型>"]`。
///
/// **不拿模型名本身当表名。**同名的内置模型（`grok-4.5`）会把它自己的默认值继承给这一张，
/// 用户自己的同名表里可能有发给别家的 `extra_headers`（Anthropic 的 `x-api-key`）—— 和我们
/// 写的字段合在一起，那把密钥就跟着发到网关来了。带上前缀，这几张表从头到尾只有我们写的字段
pub const KEY_PREFIX: &str = "thinkwatch/";

/// 一个模型在 Grok 里的表名。
pub fn key_of(model: &str) -> String {
    format!("{KEY_PREFIX}{model}")
}

/// 这个模型走哪一种协议。网关四种格式互相转换，**挑模型原生的那一种，少转一次**：
/// Claude 走 Messages；OpenAI 的 GPT、o 系列和 Codex，还有 Grok 自己（它的内置模型就是
/// `responses`）走 Responses；别的走 Chat Completions，这也是 Grok 的默认值。只看名字 ——
/// 网关的模型清单不说一个模型背后是哪种上游
pub fn backend_for(model: &str) -> &'static str {
    let m = model.trim().to_ascii_lowercase();
    // 中转的写法 `anthropic/claude-…`、`openai/gpt-…`，看最后一段
    let name = m.rsplit('/').next().unwrap_or(&m);
    let o_series = name.len() > 1
        && name.starts_with('o')
        && name[1..].starts_with(|c: char| c.is_ascii_digit());
    if name.starts_with("claude") {
        "messages"
    } else if name.starts_with("gpt-")
        || o_series
        || name.contains("codex")
        || name.starts_with("grok")
    {
        "responses"
    } else {
        "chat_completions"
    }
}

/// 网关列出来的模型，同名的只算一次
fn unique(gw: &Gateway) -> Vec<&ModelCard> {
    let mut seen = std::collections::HashSet::new();
    gw.models
        .iter()
        .filter(|m| seen.insert(m.id.as_str()))
        .collect()
}

/// 一张模型表里的字段。**没有网关密钥也要写一个不为空的 `api_key`**：空着的话 Grok 退回
/// 用户的会话令牌，见文件开头；这个值什么都打不开，网关会以「没有这把密钥」拒绝
fn table(gw: &Gateway, m: &ModelCard) -> Vec<(String, Val)> {
    let model = m.id.as_str();
    vec![
        ("model".into(), Val::s(model)),
        ("name".into(), Val::s(format!("{model} (ThinkWatch)"))),
        (
            "base_url".into(),
            Val::s(format!("{}/v1", gw.base.trim_end_matches('/'))),
        ),
        ("api_backend".into(), Val::s(backend_for(model))),
        (
            "api_key".into(),
            Val::s(gw.key.clone().unwrap_or_else(|| NO_KEY.to_string())),
        ),
    ]
}

/// 手动配置那一页列的字段：每张表拆成一项一项，照着就能写。接管写整张表，见 [`edits`]
pub fn fields(gw: &Gateway) -> Vec<Edit> {
    let mut v: Vec<Edit> = unique(gw)
        .into_iter()
        .flat_map(|m| {
            let k = key_of(&m.id);
            table(gw, m).into_iter().map(move |(f, value)| Edit {
                secret: f == "api_key" && gw.key.is_some(),
                path: vec!["model".into(), k.clone(), f],
                value,
            })
        })
        .collect();
    v.extend(
        edits(gw, "")
            .into_iter()
            .filter(|e| e.path.first().is_some_and(|p| p != "model")),
    );
    v
}

/// 接管要写的那几项：每个模型一整张表，加上 `[models] default`。
///
/// **按整张表记**：记录和文件开头的哨兵注释里一个模型一行。网关列出几十上百个模型的
/// 时候，一项一项地记就是开头几百行注释。
///
/// 默认模型照这个次序挑：此刻选着的已经是我们的一张、而网关还列着它，就留着它（用户在
/// Grok 里换过）；此刻选着的模型网关也有，就换成它在网关上的那一张；都不是就用清单里的
/// 第一个。网关一个模型都没列出来时什么都不写，接管说明里会说（`adopt.plan.no_models`）。
///
/// `current` 是此刻的 config.toml，读不出来就当空的
pub fn edits(gw: &Gateway, current: &str) -> Vec<Edit> {
    let models = unique(gw);
    let Some(first) = models.first() else {
        return Vec::new();
    };
    let mut v: Vec<Edit> = models
        .iter()
        .map(|m| Edit {
            path: vec!["model".into(), key_of(&m.id)],
            value: Val::Obj(table(gw, m)),
            secret: gw.key.is_some(),
        })
        .collect();
    let offered = |id: &str| models.iter().any(|m| m.id == id);
    let now = default_in(current);
    let chosen = match now.as_deref() {
        Some(d) if d.strip_prefix(KEY_PREFIX).is_some_and(offered) => d.to_string(),
        Some(d) => match model_id_of(current, d) {
            Some(id) if offered(&id) => key_of(&id),
            _ => key_of(&first.id),
        },
        None => key_of(&first.id),
    };
    v.push(Edit {
        path: vec!["models".into(), "default".into()],
        value: Val::s(chosen),
        secret: false,
    });
    // **接管期间关掉 xAI 推下来的 campaign。**它是合并完配置之后再叠上去的补丁，什么字段都能
    // 改，`[models] default` 也在内 —— 换回 xAI 的模型，请求就绕开了网关，配置文件里却还是
    // 我们写的样子。还原时照原样放回去
    v.push(Edit {
        path: vec!["features".into(), "campaigns".into()],
        value: Val::Bool(false),
        secret: false,
    });
    v
}

/// 网关不要密钥时写进 `api_key` 的那个值。见 [`edits`]
pub const NO_KEY: &str = "no-key";

/// 此刻 `[models] default` 选着的那一张
fn default_in(text: &str) -> Option<String> {
    match crate::toml::get(text, &["models", "default"]).ok()?? {
        Val::Str(s) if !s.trim().is_empty() => Some(s),
        _ => None,
    }
}

/// 一张表发出去的模型名：表里写了 `model` 就是它，没写就是表名本身（内置模型的表名就是
/// 模型名，`grok-4.5`）
fn model_id_of(text: &str, key: &str) -> Option<String> {
    match crate::toml::get(text, &["model", key, "model"])
        .ok()
        .flatten()
    {
        Some(Val::Str(s)) if !s.trim().is_empty() => Some(s),
        _ => Some(key.to_string()),
    }
}

/// 我们写的那几张表：表名带前缀的
fn ours(text: &str) -> Vec<(String, Val)> {
    match crate::toml::get(text, &["model"]).ok().flatten() {
        Some(Val::Obj(ms)) => ms
            .into_iter()
            .filter(|(k, _)| k.starts_with(KEY_PREFIX))
            .collect(),
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

/// 配置里此刻指向哪儿：`[models] default` 选着的那一张是我们的，就是它的地址。
///
/// 默认模型换回了别的（xAI 的内置模型、用户自己的表），Grok 平常就不走网关了，那就是「我们
/// 写的不在了」—— 和 Codex 的 `model_provider` 不再选我们是同一回事
pub fn endpoint(text: &str) -> Option<String> {
    let d = default_in(text)?;
    if !d.starts_with(KEY_PREFIX) {
        return None;
    }
    match crate::toml::get(text, &["model", &d, "base_url"]).ok()?? {
        Val::Str(s) => Some(s),
        _ => None,
    }
}

/// 一个模型写进配置再读回来的样子，见 [`crate::clients::Client::as_written`]
pub fn as_written(m: &ModelCard) -> ModelCard {
    ModelCard::named(&m.id)
}

/// 配置里此刻写着的模型（我们那几张表各自发出去的模型名）。
///
/// **一张都没有也是一份清单（空的）**：网关一个模型都没列出来时接管什么表都不写，等网关有了
/// 模型，客户端页拿这份空清单去比，才提示得出「要更新」。没接管过的不拿来比
pub fn models_in(text: &str) -> Option<Vec<ModelCard>> {
    Some(
        ours(text)
            .iter()
            .map(|(k, t)| field(t, "model").unwrap_or_else(|| k[KEY_PREFIX.len()..].to_string()))
            .map(ModelCard::named)
            .collect(),
    )
}

/// 上一次接管写过的这一项，这一次不写了的话要整张拿掉的那张表：我们那几张模型表里的字段。
/// 网关不再列出那个模型时，它的表留着就成了一张选得到、却用不了的表，模型清单也就永远和
/// 网关对不上（[`crate::opencode::models_stale`] 一直报要更新）
pub fn stale_table(path: &[String]) -> Option<Vec<String>> {
    match path {
        [model, key, ..] if model == "model" && key.starts_with(KEY_PREFIX) => {
            Some(vec![model.clone(), key.clone()])
        }
        _ => None,
    }
}

/// 一份压在用户配置上面的文件（组织下发的 `requirements.toml`）里，会盖住我们写的那几节。
/// 别的节（权限、沙箱）和我们并存
pub fn overriding(text: &str) -> Vec<String> {
    let Ok(Val::Obj(top)) = crate::toml::value(text) else {
        return Vec::new();
    };
    let has = |k: &str| top.iter().any(|(name, _)| name == k);
    ["models", "model"]
        .into_iter()
        .filter(|k| has(k))
        .map(str::to_string)
        .collect()
}

/// 一份 config.toml 里装着凭据的值：每张模型表的 `api_key`（用户自己的那些也在里面）。
/// 画 diff 之前拿它们打码，界面上画的是整份文件
pub fn secrets(text: &str) -> Vec<String> {
    match crate::toml::get(text, &["model"]).ok().flatten() {
        Some(Val::Obj(ms)) => ms
            .iter()
            .filter_map(|(_, t)| field(t, "api_key"))
            .filter(|k| k != NO_KEY)
            .collect(),
        _ => Vec::new(),
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

    fn get(edits: &[Edit], path: &str) -> Option<Val> {
        edits
            .iter()
            .find(|e| e.path.join(".") == path)
            .map(|e| e.value.clone())
    }

    #[test]
    fn each_model_gets_a_table_with_its_own_key_and_wire() {
        let g = gw(&["claude-sonnet-5", "gpt-5.5", "deepseek-chat", "grok-4.6"]);
        // 手动配置那一页：一项一项列出来
        let f = fields(&g);
        let k = |m: &str, x: &str| get(&f, &format!("model.thinkwatch/{m}.{x}"));
        assert_eq!(
            k("claude-sonnet-5", "api_backend"),
            Some(Val::s("messages"))
        );
        assert_eq!(k("gpt-5.5", "api_backend"), Some(Val::s("responses")));
        assert_eq!(k("grok-4.6", "api_backend"), Some(Val::s("responses")));
        assert_eq!(
            k("deepseek-chat", "api_backend"),
            Some(Val::s("chat_completions"))
        );
        assert_eq!(k("gpt-5.5", "model"), Some(Val::s("gpt-5.5")));
        assert_eq!(
            k("gpt-5.5", "base_url"),
            Some(Val::s("http://127.0.0.1:8788/v1"))
        );
        assert!(
            f.iter()
                .filter(|e| e.path.last().is_some_and(|x| x == "api_key"))
                .all(|e| e.secret && e.value == Val::s("tw-k"))
        );
        // 接管：一个模型一整张表，每一张都带密钥，整张算密钥
        let e = edits(&g, "");
        let tables: Vec<_> = e.iter().filter(|x| x.path[0] == "model").collect();
        assert_eq!(tables.len(), 4);
        for t in &tables {
            assert!(t.secret);
            let Val::Obj(ms) = &t.value else {
                panic!("整张表")
            };
            assert!(
                ms.iter()
                    .any(|(k, v)| k == "api_key" && *v == Val::s("tw-k"))
            );
        }
        assert_eq!(
            get(&e, "models.default"),
            Some(Val::s("thinkwatch/claude-sonnet-5"))
        );
        // 能改默认模型的 campaign 接管期间关掉
        assert_eq!(get(&e, "features.campaigns"), Some(Val::Bool(false)));
        assert_eq!(get(&f, "features.campaigns"), Some(Val::Bool(false)));
    }

    /// 没有网关密钥也不能留空：空着的表 Grok 会拿会话令牌去请求它
    #[test]
    fn a_table_never_goes_without_a_key() {
        let mut g = gw(&["m"]);
        g.key = None;
        let e = edits(&g, "");
        assert!(e.iter().all(|x| !x.secret));
        let Some(Val::Obj(t)) = get(&e, "model.thinkwatch/m") else {
            panic!("整张表")
        };
        let key = t.iter().find(|(k, _)| k == "api_key").unwrap();
        assert!(!key.1.to_line().trim().is_empty());
    }

    #[test]
    fn the_default_follows_what_is_selected_now() {
        let g = gw(&["grok-4.6", "claude-sonnet-5"]);
        // 选着的内置模型网关也有：换成它在网关上的那一张
        let d = |text: &str| get(&edits(&g, text), "models.default");
        assert_eq!(
            d("[models]\ndefault = \"grok-4.6\"\n"),
            Some(Val::s("thinkwatch/grok-4.6"))
        );
        // 选着的是用户自己的表，表里发的模型网关也有
        assert_eq!(
            d("[models]\ndefault = \"mine\"\n\n[model.mine]\nmodel = \"claude-sonnet-5\"\n"),
            Some(Val::s("thinkwatch/claude-sonnet-5"))
        );
        // 选着的已经是我们的一张，网关还列着：留着
        assert_eq!(
            d("[models]\ndefault = \"thinkwatch/claude-sonnet-5\"\n"),
            Some(Val::s("thinkwatch/claude-sonnet-5"))
        );
        // 网关没有的：清单里的第一个
        assert_eq!(
            d("[models]\ndefault = \"grok-9\"\n"),
            Some(Val::s("thinkwatch/grok-4.6"))
        );
        assert!(edits(&gw(&[]), "").is_empty(), "没有模型就什么都不写");
    }

    #[test]
    fn the_endpoint_and_models_are_read_from_our_tables() {
        let text = "[models]\ndefault = \"thinkwatch/a\"\n\n[model.\"thinkwatch/a\"]\nmodel = \"a\"\nbase_url = \"http://127.0.0.1:1/v1\"\n\n[model.\"thinkwatch/b\"]\nmodel = \"b\"\n\n[model.mine]\nmodel = \"c\"\n";
        assert_eq!(endpoint(text).as_deref(), Some("http://127.0.0.1:1/v1"));
        assert_eq!(models_in(text), Some(vec!["a".into(), "b".into()]));
        // 默认模型换回了别的：不走网关
        let back = text.replace("default = \"thinkwatch/a\"", "default = \"grok-4.6\"");
        assert_eq!(endpoint(&back), None);
        assert_eq!(models_in("[model.mine]\nmodel = \"c\"\n"), Some(Vec::new()));
    }

    #[test]
    fn only_our_tables_are_stale_candidates() {
        let p = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(
            stale_table(&p(&["model", "thinkwatch/a", "api_key"])),
            Some(p(&["model", "thinkwatch/a"]))
        );
        assert_eq!(stale_table(&p(&["model", "mine", "api_key"])), None);
        assert_eq!(stale_table(&p(&["models", "default"])), None);
    }

    #[test]
    fn every_api_key_in_the_file_is_a_secret_for_the_diff() {
        let text = "[model.mine]\napi_key = \"sk-mine-123\"\n\n[model.\"thinkwatch/a\"]\napi_key = \"tw-k\"\nmodel = \"a\"\n";
        assert_eq!(secrets(text), vec!["sk-mine-123", "tw-k"]);
    }
}
