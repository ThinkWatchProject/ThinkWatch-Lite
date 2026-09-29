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
}

impl Around {
    /// 这台电脑上的：托管策略在系统的位置（[`crate::paths::managed_settings`]）
    pub fn here(env: impl IntoIterator<Item = (String, String)>) -> Around {
        let mut managed = vec![crate::paths::managed_settings()];
        managed.extend(crate::paths::managed_settings_dropins());
        Around {
            env: env.into_iter().collect(),
            managed,
        }
    }

    /// WSL 里的：托管策略在那个发行版里，用户环境从 Windows 这边看不到
    pub fn wsl(w: &crate::wsl::WslHome) -> Around {
        let file = w.managed_settings();
        let mut managed = vec![file.clone()];
        if let Some(dir) = file.parent() {
            managed.extend(crate::paths::dropins_in(&dir.join("managed-settings.d")));
        }
        Around {
            env: BTreeMap::new(),
            managed,
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

/// Claude Code 的模型别名（model-config 一页的表）。带 `[1m]` 的也是
fn is_alias(m: &str) -> bool {
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
            managed: Vec::new(),
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
            env: BTreeMap::new(),
            managed: vec![m, d.clone()],
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
            managed: Vec::new(),
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
}
