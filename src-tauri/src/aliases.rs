//! 新建、编辑模型别名时，名称下面那几条和客户端有关的提示（`alias_hints`）。
//!
//! 别名怎么解析、挡不挡保存，是 core 的事（`/aliases/preview`）。这几条说的是**这台机器上的
//! 客户端**会怎么对待这个名称：只有这一侧知道装了哪些、接管着哪些，所以在这里判断。
//!
//! **只说检测到的客户端。**没装的客户端会怎样，用户不关心；Claude Desktop 只在这一份接管着
//! 它的时候说 —— 只有接管着，它才从网关取模型列表。
//!
//! 给界面的是码和参数（[`AliasHint`]），句子在界面那边（`src/aliases/AliasDialog.i18n.ts`）。

use std::path::Path;

use tw_adopt::clients::Client;
use tw_adopt::{cloud, desktop, detect};

use crate::clients::{blocking, home_dir, ops};
use crate::error::Out;
use crate::wire::AliasHint;

/// 名称写成什么样会出提示。`models` 是对话框里此刻列出的上游模型。
#[tauri::command]
pub async fn alias_hints(name: String, models: Vec<String>) -> Out<Vec<AliasHint>> {
    blocking(move || {
        let seen = Seen::scan(&home_dir(), &tw_adopt::foreign::backup_root());
        hints(&name, &models, &seen)
    })
    .await
}

/// 这台机器上和这几条提示有关的客户端。
#[derive(Debug, Default, Clone)]
pub struct Seen {
    /// 检测到的（装着，或者配置文件在）
    pub installed: Vec<Client>,
    /// 这一份接管着的
    pub adopted: Vec<Client>,
}

impl Seen {
    /// 扫一遍本机。**只读**，读的是几个文件在不在、接管的旁文件，几毫秒
    pub fn scan(home: &Path, backups: &Path) -> Seen {
        let mut seen = Seen::default();
        for c in ops::all(home) {
            let d = detect::detect_one(&c, home);
            if ops::ours(&d, backups) {
                seen.adopted.push(c.clone());
            }
            if d.installed {
                seen.installed.push(c);
            }
        }
        seen
    }

    fn has(&self, id: &str) -> bool {
        self.installed.iter().any(|c| c.id == id)
    }
}

/// 这几条提示，按界面上从上往下的顺序。
pub fn hints(name: &str, models: &[String], seen: &Seen) -> Vec<AliasHint> {
    let name = name.trim();
    let mut out = Vec::new();
    if !name.is_empty() {
        if seen.has("claude-code") && cloud::is_alias(name) {
            out.push(AliasHint::ClaudeCodeReserved { name: name.into() });
        }
        if let Some((family, model)) = mismatch(name, models) {
            let clients: Vec<String> = readers(family)
                .iter()
                .filter_map(|id| seen.installed.iter().find(|c| c.id == *id))
                .map(|c| c.name.to_string())
                .collect();
            if !clients.is_empty() {
                out.push(AliasHint::FamilyMismatch {
                    family: family.into(),
                    model: model.into(),
                    clients,
                });
            }
        }
        if seen.adopted.iter().any(|c| c.id == desktop::ID) {
            out.push(if desktop::looks_like_claude(name) {
                AliasHint::ClaudeDesktopShown { name: name.into() }
            } else {
                AliasHint::ClaudeDesktopHidden { name: name.into() }
            });
        }
    }
    let listing: Vec<String> = seen
        .adopted
        .iter()
        .filter(|c| c.writes_models)
        .map(|c| c.name.to_string())
        .collect();
    if !listing.is_empty() {
        out.push(AliasHint::ModelListsUpdate { clients: listing });
    }
    out
}

/// 认得出的几家模型，按名字里的片段认：模型名按非字母数字切成几段，**某一段以这个片段开头**
/// 就算。路径前缀（`anthropic/`、`moonshotai/`）、Bedrock 的 `us.anthropic.` 也是几段，一起认。
const FAMILIES: &[(&str, &[&str])] = &[
    (
        "Claude",
        &[
            "claude",
            "anthropic",
            "sonnet",
            "opus",
            "haiku",
            "fable",
            "mythos",
        ],
    ),
    ("GPT", &["gpt", "chatgpt", "codex", "openai"]),
    ("Gemini", &["gemini"]),
    ("DeepSeek", &["deepseek"]),
    ("Qwen", &["qwen", "qwq"]),
    ("GLM", &["glm", "chatglm"]),
    ("Kimi", &["kimi", "moonshot"]),
    ("MiniMax", &["minimax"]),
    ("Grok", &["grok"]),
    ("Llama", &["llama"]),
    (
        "Mistral",
        &[
            "mistral",
            "mixtral",
            "devstral",
            "codestral",
            "magistral",
            "ministral",
        ],
    ),
];

/// 这个模型名是哪一家的。**认出不止一家（`claude-codex`）或一家都认不出时是 `None`**：
/// 拿不准就不提示，免得说错。OpenAI 的 `o3`、`o4-mini` 这类只看第一段
pub fn family(model: &str) -> Option<&'static str> {
    let lower = model.trim().to_ascii_lowercase();
    let parts: Vec<&str> = lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|p| !p.is_empty())
        .collect();
    let o_series = parts.first().is_some_and(|p| {
        p.len() >= 2 && p.starts_with('o') && p[1..].bytes().all(|b| b.is_ascii_digit())
    });
    let mut found: Vec<&'static str> = FAMILIES
        .iter()
        .filter(|(_, frags)| parts.iter().any(|p| frags.iter().any(|f| p.starts_with(f))))
        .map(|(f, _)| *f)
        .collect();
    if o_series && !found.contains(&"GPT") {
        found.push("GPT");
    }
    match found.as_slice() {
        [one] => Some(one),
        _ => None,
    }
}

/// 名称像一家的模型、列出的上游模型却没有一个是这一家的，而至少有一个认得出是别家：
/// 返回名称的那一家和第一个别家的模型。认不出的模型名不算别家
fn mismatch<'a>(name: &str, models: &'a [String]) -> Option<(&'static str, &'a str)> {
    let want = family(name)?;
    let mut other = None;
    for m in models {
        match family(m) {
            Some(f) if f == want => return None,
            Some(_) if other.is_none() => other = Some(m.as_str()),
            _ => {}
        }
    }
    other.map(|m| (want, m))
}

/// 按模型名决定请求参数的客户端（id），按家：名字像这一家，它就照这一家的参数发。
///
/// - Claude Code：上下文长度、思考、Claude 专有的请求头和字段都看模型名；
/// - Codex：按模型名的前缀（`gpt-5`、`o3`、`codex-`）挑工具的写法、推理参数和上下文长度；
/// - Qwen Code：按 `qwen` 系列的名字定上下文长度；
/// - opencode：按模型名里的 `claude`、`gpt`、`gemini`、`qwen`、`glm`、`kimi`、`minimax` 定
///   温度、top_p 和各家专有的选项。
fn readers(family: &str) -> &'static [&'static str] {
    match family {
        "Claude" => &["claude-code", "opencode"],
        "GPT" => &["codex", "opencode"],
        "Qwen" => &["qwen-code", "opencode"],
        "Gemini" | "GLM" | "Kimi" | "MiniMax" => &["opencode"],
        _ => &[],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(id: &str) -> Client {
        tw_adopt::clients::adoptable()
            .into_iter()
            .find(|c| c.id == id)
            .unwrap_or_else(|| panic!("{id}"))
    }

    fn seen(installed: &[&str], adopted: &[&str]) -> Seen {
        Seen {
            installed: installed.iter().map(|id| client(id)).collect(),
            adopted: adopted.iter().map(|id| client(id)).collect(),
        }
    }

    fn models(ms: &[&str]) -> Vec<String> {
        ms.iter().map(|m| m.to_string()).collect()
    }

    #[test]
    fn families_are_recognised_by_name_parts() {
        for (m, f) in [
            ("claude-sonnet-5", "Claude"),
            ("anthropic/claude-opus-5", "Claude"),
            ("us.anthropic.claude-sonnet-5-v1:0", "Claude"),
            ("claude-opus-5@20260101", "Claude"),
            ("sonnet", "Claude"),
            ("opusplan", "Claude"),
            ("gpt-5", "GPT"),
            ("openai/gpt-oss-120b", "GPT"),
            ("chatgpt-4o-latest", "GPT"),
            ("gpt-5-codex", "GPT"),
            ("o3", "GPT"),
            ("o4-mini", "GPT"),
            ("gemini-2.5-pro", "Gemini"),
            ("google/gemini-2.5-flash", "Gemini"),
            ("DeepSeek-v4.1-flash", "DeepSeek"),
            ("deepseek/deepseek-chat", "DeepSeek"),
            ("qwen3-coder-plus", "Qwen"),
            ("qwen/qwen3-coder", "Qwen"),
            ("glm-4.6", "GLM"),
            ("z-ai/glm-4.6", "GLM"),
            ("kimi-k2", "Kimi"),
            ("moonshotai/kimi-k2", "Kimi"),
            ("MiniMax-M2", "MiniMax"),
            ("grok-4", "Grok"),
            ("meta-llama/llama-4-maverick", "Llama"),
            ("devstral-medium", "Mistral"),
        ] {
            assert_eq!(family(m), Some(f), "{m}");
        }
        // 认不出，或者认出不止一家：不说
        for m in [
            "",
            "my-coder",
            "flash",
            "claude-codex",
            "anthropic/kimi-k2",
            "claude-deepseek-v3",
            // `o` 系列只看第一段，`o` 后面要有数字
            "turbo-o3",
            "omni",
        ] {
            assert_eq!(family(m), None, "{m}");
        }
    }

    #[test]
    fn a_claude_name_for_another_model_names_the_detected_clients() {
        let all = seen(&["claude-code", "opencode", "codex"], &[]);
        assert_eq!(
            hints("claude-sonnet-5", &models(&["glm-4.6"]), &all),
            vec![AliasHint::FamilyMismatch {
                family: "Claude".into(),
                model: "glm-4.6".into(),
                clients: vec!["Claude Code".into(), "opencode".into()],
            }]
        );
        // 只装了 Claude Code：只说它
        assert_eq!(
            hints(
                "claude-sonnet-5",
                &models(&["glm-4.6"]),
                &seen(&["claude-code"], &[])
            ),
            vec![AliasHint::FamilyMismatch {
                family: "Claude".into(),
                model: "glm-4.6".into(),
                clients: vec!["Claude Code".into()],
            }]
        );
        // 一个看模型名的客户端都没装：不说
        assert!(
            hints(
                "claude-sonnet-5",
                &models(&["glm-4.6"]),
                &seen(&["zed"], &[])
            )
            .is_empty()
        );
        // GPT 的名字给 DeepSeek：Codex 和 opencode
        assert_eq!(
            hints("gpt-5", &models(&["deepseek-chat"]), &all),
            vec![AliasHint::FamilyMismatch {
                family: "GPT".into(),
                model: "deepseek-chat".into(),
                clients: vec!["Codex".into(), "opencode".into()],
            }]
        );
    }

    #[test]
    fn the_same_family_or_an_unknown_model_is_not_a_mismatch() {
        let all = seen(&["claude-code", "opencode", "codex", "qwen-code"], &[]);
        // 几家上游的同一个 Claude
        assert!(
            hints(
                "claude-sonnet-5",
                &models(&[
                    "claude-sonnet-5",
                    "us.anthropic.claude-sonnet-5-v1:0",
                    "anthropic/claude-sonnet-5"
                ]),
                &all
            )
            .is_empty()
        );
        // 列出的里有一个是这一家的就不说，哪怕还列了别家的
        assert!(
            hints(
                "claude-sonnet-5",
                &models(&["glm-4.6", "claude-sonnet-5"]),
                &all
            )
            .is_empty()
        );
        // 名字认不出、模型认不出：不说
        assert!(hints("my-coder", &models(&["glm-4.6"]), &all).is_empty());
        assert!(hints("claude-sonnet-5", &models(&["local-model"]), &all).is_empty());
        assert!(hints("deepseek-v4.1", &models(&["DeepSeek-v4.1-flash"]), &all).is_empty());
        // 还没列模型
        assert!(hints("claude-sonnet-5", &[], &all).is_empty());
        // 第一个认得出的别家模型
        assert_eq!(
            hints(
                "qwen-max",
                &models(&["local-model", "glm-4.6", "kimi-k2"]),
                &all
            ),
            vec![AliasHint::FamilyMismatch {
                family: "Qwen".into(),
                model: "glm-4.6".into(),
                clients: vec!["Qwen Code".into(), "opencode".into()],
            }]
        );
    }

    #[test]
    fn claude_codes_own_tier_names_are_flagged_when_it_is_installed() {
        for name in [
            "sonnet",
            "Opus",
            "opusplan",
            "haiku",
            "default",
            "best",
            "sonnet[1m]",
        ] {
            assert_eq!(
                hints(
                    name,
                    &models(&["claude-sonnet-5"]),
                    &seen(&["claude-code"], &[])
                ),
                vec![AliasHint::ClaudeCodeReserved { name: name.into() }],
                "{name}"
            );
        }
        // 没装 Claude Code：不说
        assert!(
            hints(
                "sonnet",
                &models(&["claude-sonnet-5"]),
                &seen(&["codex"], &[])
            )
            .is_empty()
        );
        // 带版本的完整名字不是它的档位名
        assert!(
            hints(
                "claude-sonnet-5",
                &models(&["claude-sonnet-5"]),
                &seen(&["claude-code"], &[])
            )
            .is_empty()
        );
        // 档位名指向别家的模型：两条都说
        assert_eq!(
            hints("opus", &models(&["glm-4.6"]), &seen(&["claude-code"], &[])),
            vec![
                AliasHint::ClaudeCodeReserved {
                    name: "opus".into()
                },
                AliasHint::FamilyMismatch {
                    family: "Claude".into(),
                    model: "glm-4.6".into(),
                    clients: vec!["Claude Code".into()],
                },
            ]
        );
    }

    #[test]
    fn claude_desktop_is_told_only_when_this_copy_has_taken_it_over() {
        let desktop = desktop::ID;
        // 接管着：说它显示不显示
        assert_eq!(
            hints(
                "glm-4.6-fast",
                &models(&["glm-4.6"]),
                &seen(&[desktop], &[desktop])
            ),
            vec![AliasHint::ClaudeDesktopHidden {
                name: "glm-4.6-fast".into()
            }]
        );
        assert_eq!(
            hints(
                "my-sonnet",
                &models(&["glm-4.6"]),
                &seen(&[desktop], &[desktop])
            ),
            vec![AliasHint::ClaudeDesktopShown {
                name: "my-sonnet".into()
            }]
        );
        // 只是装着：它不从网关取模型列表，不说
        assert!(
            hints(
                "glm-4.6-fast",
                &models(&["glm-4.6"]),
                &seen(&[desktop], &[])
            )
            .is_empty()
        );
    }

    #[test]
    fn adopted_clients_that_write_the_model_list_are_named() {
        let s = seen(
            &["opencode", "pi", "claude-code"],
            &["opencode", "pi", "claude-code"],
        );
        assert_eq!(
            hints("deepseek-v4.1", &models(&["DeepSeek-v4.1-flash"]), &s),
            vec![AliasHint::ModelListsUpdate {
                clients: vec!["opencode".into(), "Pi".into()],
            }]
        );
        // 名称还空着也说：它和名称无关
        assert_eq!(
            hints("", &[], &s),
            vec![AliasHint::ModelListsUpdate {
                clients: vec!["opencode".into(), "Pi".into()],
            }]
        );
        // 只是装着、没接管：不说
        assert!(hints("deepseek-v4.1", &[], &seen(&["opencode"], &[])).is_empty());
    }

    #[test]
    fn hints_are_tagged_by_code_for_the_interface() {
        let v = serde_json::to_value(AliasHint::FamilyMismatch {
            family: "Claude".into(),
            model: "glm-4.6".into(),
            clients: vec!["Claude Code".into()],
        })
        .unwrap();
        assert_eq!(
            v,
            serde_json::json!({
                "code": "family_mismatch",
                "family": "Claude",
                "model": "glm-4.6",
                "clients": ["Claude Code"],
            })
        );
    }

    #[test]
    fn scanning_finds_claude_code_by_its_directory() {
        let home = tempfile::tempdir().unwrap();
        let backups = home.path().join("backups");
        let has = |s: &Seen| s.installed.iter().any(|c| c.id == "claude-code");
        assert!(!has(&Seen::scan(home.path(), &backups)));
        std::fs::create_dir(home.path().join(".claude")).unwrap();
        let s = Seen::scan(home.path(), &backups);
        assert!(has(&s));
        // 装着、没接管
        assert!(!s.adopted.iter().any(|c| c.id == "claude-code"));
        assert!(
            hints("opusplan", &[], &s).contains(&AliasHint::ClaudeCodeReserved {
                name: "opusplan".into()
            })
        );
    }
}
