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

use crate::clients::{Edit, Gateway, ModelCard, NO_KEY, PROVIDER_ID, unique};
use crate::json::Val;
use crate::pi::{count_of, flag_of};
use crate::plan::{lookup, lookup_str};

/// 装着网关密钥的那个环境变量：写进 `settings.env`，每一条模型用 `envKey` 指着它。
///
/// **名字是 Qwen 专用的。**`settings.env` 优先级最低：shell 里 export 了同名变量就用 shell
/// 里的。DeepSeek Harness 的引用名是 `THINKWATCH_API_KEY`，那把是给 dsh 发的 —— 共用一个
/// 名字的话，Qwen 的请求会记在 dsh 那把密钥名下
pub const KEY_ENV: &str = "THINKWATCH_QWEN_API_KEY";

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
    let models = unique(&gw.models);
    let Some(first) = models.first() else {
        return Vec::new();
    };
    let base = gw.v1();
    let entries: Vec<Val> = models
        .iter()
        .map(|m| {
            let mut e = vec![
                ("id".into(), Val::s(&m.id)),
                ("name".into(), Val::s(format!("{} (ThinkWatch)", m.id))),
                ("baseUrl".into(), Val::s(&base)),
                ("envKey".into(), Val::s(KEY_ENV)),
            ];
            let spec = generation(m);
            if !spec.is_empty() {
                e.push(("generationConfig".into(), Val::Obj(spec)));
            }
            Val::Obj(e)
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
            // **不能留空**：变量是空的，Qwen 退回 `OPENAI_API_KEY`，用户自己的密钥就发到了网关
            None => plain(&["env", KEY_ENV], Val::s(NO_KEY)),
        },
        plain(&["security", "auth", "selectedType"], Val::s("openai")),
        plain(&["model", "name"], Val::s(chosen)),
        plain(&["model", "baseUrl"], Val::s(base)),
    ]
}

/// 一个模型的 `generationConfig`：网关知道的规格里 Qwen 照着跑、又不会改动每次请求的那几项。
/// 网关不知道的整项不写，Qwen 按名字查 models.dev、再按正则猜、最后取 200K。
///
/// - 上下文窗口写 `contextWindowSize`：压缩对话按它算阈值；
/// - 收不收图写 `modalities.image`：不收的话，图换成一段文字占位再发。这一项一写，Qwen 就
///   不再按名字补默认的模态（目录里的音频、视频跟着没了）—— 网关只说得出图这一项；
/// - **输出上限不写。**`samplingParams.max_tokens` 每次请求都原样带上，不是能力上限；写上
///   模型的上限（384000），每次请求就都要这么多。写了 `samplingParams`，Qwen 也就不再自己
///   补 `max_tokens`；
/// - **推理不写。**Qwen 没有只表示「会推理」的开关：`capabilities.reasoning` 要一份档位清单
///   和默认档，默认档每次请求都带上（档位还得我们编）；`generationConfig.reasoning` 写了
///   档位或预算，每次请求都带上；写 `false` 是关掉思考，`/effort` 从此不起作用，切走再切回来
///   时用户选的档位也丢了。什么都不写，`/effort` 本来就对任何模型都给全部档位，不选就不带
fn generation(m: &ModelCard) -> Vec<(String, Val)> {
    let mut g = Vec::new();
    if let Some(n) = m.context_window {
        g.push(("contextWindowSize".into(), Val::Num(n.to_string())));
    }
    if let Some(image) = m.image_input {
        g.push((
            "modalities".into(),
            Val::Obj(vec![("image".into(), Val::Bool(image))]),
        ));
    }
    g
}

/// 我们那一组里的模型条目
fn entries(text: &str) -> Vec<Val> {
    match crate::json::get(text, &["modelProviders", PROVIDER_ID]) {
        Ok(Some(Val::Arr(es))) => es,
        _ => Vec::new(),
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
        .filter(|e| lookup_str(e, &["id"]).as_deref() == Some(name.as_str()))
        .filter_map(|e| lookup_str(e, &["baseUrl"]))
        .find(|b| picked.as_ref().is_none_or(|p| p == b))
}

/// 一个模型写进配置再读回来的样子，见 [`crate::clients::Client::as_written`]：输出上限和
/// 推理不写（见 [`generation`]），只剩上下文窗口和收不收图
pub fn as_written(m: &ModelCard) -> ModelCard {
    ModelCard {
        id: m.id.clone(),
        context_window: m.context_window,
        image_input: m.image_input,
        ..Default::default()
    }
}

/// 配置里此刻写着的模型：我们那一组里每一条的 `id`，连同 `generationConfig` 里写着的规格。
/// 没有那一组就是一份空的（接管时网关一个模型都没有的话就是这样，等网关有了模型，客户端页
/// 拿它去比才提示得出要更新）
pub fn models_in(text: &str) -> Option<Vec<ModelCard>> {
    Some(
        entries(text)
            .iter()
            .filter_map(|e| {
                Some(ModelCard {
                    id: lookup_str(e, &["id"])?,
                    context_window: count_of(lookup(e, &["generationConfig", "contextWindowSize"])),
                    image_input: flag_of(lookup(e, &["generationConfig", "modalities", "image"])),
                    ..Default::default()
                })
            })
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
        let field = |e: &Val, k: &str| lookup_str(e, &[k]);
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

    fn card(
        id: &str,
        cw: Option<u64>,
        out: Option<u64>,
        reasoning: Option<bool>,
        image: Option<bool>,
    ) -> ModelCard {
        ModelCard {
            id: id.into(),
            context_window: cw,
            max_output_tokens: out,
            reasoning,
            image_input: image,
        }
    }

    /// 把接管要写的几项写进一份 settings.json
    fn written(g: &Gateway) -> String {
        edits(g, "").iter().fold("{}".to_string(), |text, e| {
            let path: Vec<&str> = e.path.iter().map(String::as_str).collect();
            crate::json::set(&text, &path, &e.value).unwrap()
        })
    }

    fn qwen() -> crate::clients::Client {
        crate::clients::adoptable()
            .into_iter()
            .find(|c| c.id == "qwen-code")
            .unwrap()
    }

    #[test]
    fn known_specs_go_into_generation_config_and_read_back() {
        let mut g = gw(&[]);
        g.models = vec![
            card(
                "gpt-5",
                Some(400_000),
                Some(128_000),
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
            ModelCard::named("mystery"),
        ];
        let text = written(&g);
        let gc = |id: &str, path: &[&str]| {
            let e = entries(&text)
                .into_iter()
                .find(|e| lookup_str(e, &["id"]).as_deref() == Some(id))
                .unwrap();
            lookup(&e, &[&["generationConfig"], path].concat())
        };
        assert_eq!(
            gc("gpt-5", &["contextWindowSize"]),
            Some(Val::Num("400000".into()))
        );
        assert_eq!(
            gc("gpt-5", &["modalities"]),
            Some(Val::Obj(vec![("image".into(), Val::Bool(true))]))
        );
        assert_eq!(
            gc("deepseek-chat", &["modalities", "image"]),
            Some(Val::Bool(false))
        );
        // 网关不知道的模型：一项都不写，连 generationConfig 都没有
        assert_eq!(gc("mystery", &[]), None);
        // 读回来的就是写得进去的那几项
        let back = models_in(&text).unwrap();
        let want: Vec<ModelCard> = g.models.iter().map(as_written).collect();
        assert_eq!(back, want);
        assert!(!qwen().models_stale(&back, &g.models));
    }

    /// 输出上限是每次请求的 `max_tokens`，推理写什么都会改动每次请求，两样都不写
    #[test]
    fn max_output_and_reasoning_are_never_written() {
        let mut g = gw(&[]);
        g.models = vec![
            card("a", None, Some(384_000), Some(true), None),
            card("b", None, Some(8_192), Some(false), None),
        ];
        let text = written(&g);
        assert!(!text.contains("samplingParams"), "{text}");
        assert!(!text.contains("max_tokens"), "{text}");
        assert!(!text.contains("reasoning"), "{text}");
        assert!(!text.contains("generationConfig"), "{text}");
        assert!(!text.contains("384000"), "{text}");
        // 也就不因为它们变了提示更新
        let back = models_in(&text).unwrap();
        let mut now = g.models.clone();
        now[0].max_output_tokens = Some(128_000);
        now[1].reasoning = Some(true);
        assert!(!qwen().models_stale(&back, &now));
    }

    #[test]
    fn a_changed_window_or_image_input_is_stale() {
        let mut g = gw(&[]);
        g.models = vec![card("a", Some(200_000), None, None, Some(true))];
        let back = models_in(&written(&g)).unwrap();
        let c = qwen();
        assert!(!c.models_stale(&back, &g.models));
        let mut now = g.models.clone();
        now[0].context_window = Some(1_000_000);
        assert!(c.models_stale(&back, &now));
        let mut now = g.models.clone();
        now[0].image_input = None;
        assert!(c.models_stale(&back, &now));
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
