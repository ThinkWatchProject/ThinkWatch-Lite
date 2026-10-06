//! 接管一次，再还原一次，用户的文件必须**一个字节都没变**。
//!
//! 这是整个 tw-adopt 唯一真正要证明的事。cc-switch 那批最集中的 issue
//! （#6902 把 23 个顶层键写剩 1 个、#6901 擦掉第三方 hooks、#6871 删掉
//! `enabledPlugins`）全都可以被这一条测出来。

use std::path::{Path, PathBuf};

use tw_adopt::clients::{Gateway, ModelCard, adoptable};
use tw_adopt::cloud::Around;
use tw_adopt::plan::{apply, apply_restore, plan_adopt, plan_restore};

fn gw() -> Gateway {
    Gateway {
        base: "http://127.0.0.1:8080".into(),
        key: Some("tw-用户的专属密钥".into()),
        models: vec!["claude-sonnet".into(), "gpt-5".into()],
    }
}

struct Bed {
    _dir: tempfile::TempDir,
    home: PathBuf,
    backups: PathBuf,
}

fn bed(client: &str, contents: &str) -> Bed {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    let c = adoptable().into_iter().find(|c| c.id == client).unwrap();
    let p = c.config_path(&home);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    if !contents.is_empty() {
        std::fs::write(&p, contents).unwrap();
    }
    Bed {
        backups: dir.path().join("backups"),
        home,
        _dir: dir,
    }
}

fn client(id: &str) -> tw_adopt::clients::Client {
    adoptable().into_iter().find(|c| c.id == id).unwrap()
}

fn read(p: &Path) -> String {
    std::fs::read_to_string(p).unwrap()
}

// ---- Claude Code：JSON，装不下注释，靠旁文件 --------------------------

/// 一份**有生活痕迹**的 settings.json。测试用的假数据太干净的话，
/// 「其余字节原样不动」这句话就没被真正考验过。
const CLAUDE: &str = r#"{
  "model": "opusplan",
  "permissions": {
    "allow": ["Bash(git diff:*)", "Read(~/Dev/**)"],
    "deny": ["Bash(rm -rf:*)"]
  },
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit", "hooks": [{ "type": "command", "command": "prettier -w $FILE" }] }
    ]
  },
  "enabledPlugins": { "my-plugin@local": true },
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-ant-我自己的密钥",
    "MY_OWN_VAR": "别动我"
  },
  "statusLine": { "type": "command", "command": "~/bin/statusline.sh" }
}
"#;

#[test]
fn adopting_claude_code_touches_only_the_fields_we_named() {
    let b = bed("claude-code", CLAUDE);
    let c = client("claude-code");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();

    let after = read(&b.home.join(".claude/settings.json"));
    for keep in [
        "\"model\": \"opusplan\"",
        "Bash(git diff:*)",
        "prettier -w $FILE",
        "my-plugin@local",
        "\"MY_OWN_VAR\": \"别动我\"",
        "~/bin/statusline.sh",
    ] {
        assert!(after.contains(keep), "接管把 {keep} 弄丢了：\n{after}");
    }
    assert!(
        after.contains("\"ANTHROPIC_BASE_URL\": \"http://127.0.0.1:8080\""),
        "{after}"
    );
    assert!(after.contains("tw-用户的专属密钥"), "{after}");
    assert!(
        after.contains("\"CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY\": \"1\""),
        "{after}"
    );
    assert!(!after.contains("sk-ant-我自己的密钥"), "{after}");
}

#[test]
fn restoring_claude_code_puts_the_file_back_byte_for_byte() {
    let b = bed("claude-code", CLAUDE);
    let c = client("claude-code");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();

    assert_eq!(
        read(&b.home.join(".claude/settings.json")),
        CLAUDE,
        "还原之后不是原来那份文件"
    );
    assert!(
        !b.home
            .join(".claude/settings.json.thinkwatch.json")
            .exists(),
        "还原之后还留着接管记录"
    );
}

#[test]
fn the_sidecar_never_holds_the_users_own_key() {
    // 旁文件是我们新造的一份文件，而那个目录常常被 dotfile 管理器
    // 提交进 git。原值是密钥的，只留一个指向全文备份的指针。
    let b = bed("claude-code", CLAUDE);
    let c = client("claude-code");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let side = read(&b.home.join(".claude/settings.json.thinkwatch.json"));
    assert!(
        !side.contains("sk-ant-我自己的密钥"),
        "用户的密钥被抄进旁文件了：\n{side}"
    );
    assert!(side.contains("secret"), "{side}");
    assert!(side.contains("full_backup"), "{side}");
}

#[test]
fn a_secret_original_comes_back_from_the_full_backup() {
    let b = bed("claude-code", CLAUDE);
    let c = client("claude-code");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert!(read(&b.home.join(".claude/settings.json")).contains("sk-ant-我自己的密钥"));
}

#[test]
fn losing_the_backup_removes_our_key_and_says_so_out_loud() {
    // **不能假装还原成功。**留着我们的密钥比删掉更糟 —— 那等于卸载
    // 之后还在替他发请求。
    let b = bed("claude-code", CLAUDE);
    let c = client("claude-code");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    std::fs::remove_dir_all(&b.backups).unwrap();

    let r = plan_restore(&c, &b.home).unwrap();
    assert!(
        r.notes
            .iter()
            .any(|n| n.text.contains("filled in again by hand")),
        "没说清密钥拿不回来了：{:?}",
        r.notes
    );
    apply_restore(&c, &r, &b.backups).unwrap();
    let after = read(&b.home.join(".claude/settings.json"));
    assert!(
        !after.contains("tw-用户的专属密钥"),
        "我们的密钥还留在里面：{after}"
    );
    assert!(after.contains("\"MY_OWN_VAR\": \"别动我\""), "{after}");
}

#[test]
fn adopting_a_client_with_no_config_file_creates_one_and_restore_takes_it_away() {
    let b = bed("claude-code", "");
    let c = client("claude-code");
    let path = b.home.join(".claude/settings.json");
    assert!(!path.exists());

    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    assert!(path.exists());

    let r = plan_restore(&c, &b.home).unwrap();
    assert!(r.delete_file, "当初是我们建的，还原时该整个删掉");
    apply_restore(&c, &r, &b.backups).unwrap();
    assert!(!path.exists(), "还原之后留下了一个用户从来没有过的文件");
}

#[test]
fn a_file_the_user_has_since_written_into_is_never_deleted_by_a_restore() {
    // 文件是我们建的，但用户这三个月往里加了自己的东西 —— 那些必须留下。
    let b = bed("claude-code", "");
    let c = client("claude-code");
    let path = b.home.join(".claude/settings.json");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();

    let mine =
        tw_adopt::json::set(&read(&path), &["model"], &tw_adopt::json::Val::s("opus")).unwrap();
    std::fs::write(&path, mine).unwrap();

    let r = plan_restore(&c, &b.home).unwrap();
    assert!(!r.delete_file, "用户往里写过东西，不该删");
    apply_restore(&c, &r, &b.backups).unwrap();
    let after = read(&path);
    assert!(
        after.contains("\"model\": \"opus\""),
        "把用户后来加的东西抹掉了：{after}"
    );
    assert!(!after.contains("127.0.0.1"), "{after}");
}

/// `env` 是接管时我们建的，之后用户往里加了自己的变量：还原收走我们那几项，
/// 他的那一项留着 —— 不是连同整个 `env` 一起删掉
#[test]
fn a_variable_the_user_added_to_a_section_we_created_survives_a_restore() {
    const SEED: &str = "{\n  \"model\": \"opus\"\n}\n";
    let b = bed("claude-code", SEED);
    let c = client("claude-code");
    let path = b.home.join(".claude/settings.json");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();

    let mine = tw_adopt::json::set(
        &read(&path),
        &["env", "MY_OWN_VAR"],
        &tw_adopt::json::Val::s("别动我"),
    )
    .unwrap();
    std::fs::write(&path, mine).unwrap();

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    let after = read(&path);
    assert!(
        after.contains("\"MY_OWN_VAR\": \"别动我\""),
        "把用户后来加的变量连同 env 一起删了：{after}"
    );
    assert!(after.contains("\"model\": \"opus\""), "{after}");
    assert!(!after.contains("127.0.0.1"), "{after}");
    assert!(!after.contains("tw-用户的专属密钥"), "{after}");

    // 没人往里加东西的话，那一段照旧整个收走：还原之后一个字节都不差
    let b = bed("claude-code", SEED);
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&b.home.join(".claude/settings.json")), SEED);
}

// ---- Codex：TOML，有注释，几十条项目授权 -------------------------------

const CODEX: &str = r#"model = "gpt-5.6-sol"
model_reasoning_effort = "xhigh"

# 这台机器上每个仓库的信任记录，丢一条都要重新点一次
[projects."/path/to/my-app"]
trust_level = "trusted"

[projects."/path/to/another-app"]
trust_level = "trusted"

[mcp_servers.filesystem]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/workspace"]
"#;

/// Codex 还原之后**唯一多出来的东西**：`[model_providers.thinkwatch]`
/// 改写成的影子 OpenAI。接管期间开的会话记着 `thinkwatch` 这个 provider，
/// 整段删掉它们就再也打不开了（见 `clients::leaves_behind`）。
const SHADOW: &str = "\n[model_providers.thinkwatch]\nname = \"OpenAI\"\nwire_api = \"responses\"\nrequires_openai_auth = true\nsupports_websockets = true\n";

fn restored_codex(seed: &str) -> String {
    format!("{seed}{SHADOW}")
}

/// 还原之后的 Codex 配置里不该有的东西：密钥、网关地址、我们的署名，
/// 以及选中那一段的 `model_provider`。
fn assert_nothing_of_ours_is_left(after: &str) {
    for gone in [
        "tw-用户的专属密钥",
        "experimental_bearer_token",
        "127.0.0.1:8080",
        "X-ThinkWatch-Client",
        "http_headers",
        "model_provider =",
        "ThinkWatch",
    ] {
        assert!(!after.contains(gone), "还原之后还留着 {gone}：\n{after}");
    }
}

#[test]
fn adopting_codex_keeps_every_project_trust_and_mcp_server() {
    let b = bed("codex", CODEX);
    let c = client("codex");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();

    let after = read(&b.home.join(".codex/config.toml"));
    assert!(after.contains(r#"[projects."/path/to/my-app"]"#), "{after}");
    assert!(
        after.contains(r#"[projects."/path/to/another-app"]"#),
        "{after}"
    );
    assert!(after.contains("[mcp_servers.filesystem]"), "{after}");
    assert!(after.contains("丢一条都要重新点一次"), "注释没了：{after}");
    assert!(
        after.contains(r#"model_provider = "thinkwatch""#),
        "{after}"
    );
    assert!(after.contains(r#"wire_api = "responses""#), "{after}");
    assert!(after.contains("X-ThinkWatch-Client"), "{after}");
    // 实测：不配 env_key 它也照发请求；env_key 指向没 export 的变量反而起不来
    assert!(!after.contains("env_key"), "不该写 env_key：{after}");
}

#[test]
fn codex_gets_a_sentinel_comment_because_toml_can_hold_one() {
    // 用户打开文件就该看见「这是谁改的、原来是什么」。
    let b = bed("codex", CODEX);
    let c = client("codex");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let after = read(&b.home.join(".codex/config.toml"));
    assert!(after.contains(tw_adopt::sentinel::BEGIN), "{after}");
    assert!(after.contains("to restore by hand"), "{after}");
    assert!(after.contains("no model_provider originally"), "{after}");
}

#[test]
fn restoring_codex_puts_the_file_back_plus_only_the_shadow_openai() {
    let b = bed("codex", CODEX);
    let c = client("codex");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    let after = read(&b.home.join(".codex/config.toml"));
    assert_eq!(after, restored_codex(CODEX));
    assert_nothing_of_ours_is_left(&after);
}

#[test]
fn the_shadow_openai_follows_the_users_own_openai_base_url() {
    // 顶层的 `openai_base_url` 只管内置的 `openai`，管不到影子那一段：
    // 不照抄一份，接管期间的会话会绕过用户自己设的地址
    let seed = format!("openai_base_url = \"http://127.0.0.1:18081/v1\"\n{CODEX}");
    let b = bed("codex", &seed);
    let c = client("codex");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    let after = read(&b.home.join(".codex/config.toml"));
    let got = |k: &str| tw_adopt::toml::get(&after, &["model_providers", "thinkwatch", k]).unwrap();
    assert_eq!(
        got("base_url"),
        Some(tw_adopt::json::Val::s("http://127.0.0.1:18081/v1")),
        "{after}"
    );
    assert_eq!(
        got("requires_openai_auth"),
        Some(tw_adopt::json::Val::Bool(true))
    );
    assert!(after.starts_with(&seed), "用户原有的部分变了：\n{after}");
    assert_nothing_of_ours_is_left(&after);
}

#[test]
fn re_adopting_codex_after_a_restore_points_the_shadow_back_at_the_gateway() {
    let b = bed("codex", CODEX);
    let c = client("codex");
    let path = b.home.join(".codex/config.toml");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(
        tw_adopt::detect::detect_one(&c, &b.home).endpoint,
        None,
        "影子那一段不是网关"
    );

    // 再接管一次：影子那一段要整个改回指向网关。**尤其是那两个 true** ——
    // 留着 `requires_openai_auth` 会把用户自己的 OpenAI 登录送给网关
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let after = read(&path);
    let got = |k: &str| {
        tw_adopt::toml::get(&after, &["model_providers", "thinkwatch", k])
            .unwrap()
            .unwrap_or_else(|| panic!("没有 {k}：\n{after}"))
    };
    use tw_adopt::json::Val;
    assert_eq!(got("name"), Val::s("ThinkWatch"));
    assert_eq!(got("base_url"), Val::s("http://127.0.0.1:8080/v1"));
    assert_eq!(got("requires_openai_auth"), Val::Bool(false), "{after}");
    assert_eq!(got("supports_websockets"), Val::Bool(false), "{after}");
    assert_eq!(
        got("experimental_bearer_token"),
        Val::s("tw-用户的专属密钥")
    );
    assert!(
        after.contains(r#"model_provider = "thinkwatch""#),
        "{after}"
    );
    assert_eq!(
        tw_adopt::detect::detect_one(&c, &b.home)
            .endpoint
            .as_deref(),
        Some("http://127.0.0.1:8080/v1")
    );

    // 再还原：回到的还是「原样 + 影子」，不会一轮一轮地攒东西
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    let after = read(&path);
    assert_eq!(after, restored_codex(CODEX));
    assert_nothing_of_ours_is_left(&after);
}

#[test]
fn a_codex_config_created_here_keeps_the_shadow_after_a_restore() {
    // 文件是接管时新建的。还原之后它不是空的 —— 影子那一段得留着，
    // 否则接管期间的会话照样打不开 —— 所以**不删**
    let b = bed("codex", "");
    let c = client("codex");
    let path = b.home.join(".codex/config.toml");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let r = plan_restore(&c, &b.home).unwrap();
    assert!(!r.delete_file);
    apply_restore(&c, &r, &b.backups).unwrap();
    let after = read(&path);
    assert_eq!(after.trim_start(), SHADOW.trim_start());
    assert_nothing_of_ours_is_left(&after);
}

#[test]
fn adopting_twice_does_not_stack_up_sentinels() {
    let b = bed("codex", CODEX);
    let c = client("codex");
    for _ in 0..3 {
        let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
        apply(&c, &p, &b.backups).unwrap();
    }
    let after = read(&b.home.join(".codex/config.toml"));
    assert_eq!(
        after.matches(tw_adopt::sentinel::BEGIN).count(),
        1,
        "{after}"
    );
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(
        read(&b.home.join(".codex/config.toml")),
        restored_codex(CODEX)
    );
}

/// 配置不在默认位置（`CLAUDE_CONFIG_DIR` 挪过）：接管、检测、还原都在指定的那个
/// 文件上做，默认位置一个字节都不碰
#[test]
fn a_config_file_somewhere_else_is_adopted_and_restored_where_it_is() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    let backups = dir.path().join("backups");
    let custom = dir.path().join("work").join("claude").join("settings.json");
    std::fs::create_dir_all(custom.parent().unwrap()).unwrap();
    std::fs::write(&custom, CLAUDE).unwrap();
    let mut c = client("claude-code");
    c.custom_config = Some(custom.clone());

    let p = plan_adopt(&c, &home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &backups).unwrap();
    assert!(
        read(&custom).contains("127.0.0.1:8080"),
        "{}",
        read(&custom)
    );
    assert!(!home.join(".claude").join("settings.json").exists());
    let d = tw_adopt::detect::detect_one(&c, &home);
    assert!(d.adopted_at_ms.is_some());
    assert_eq!(d.path, custom);

    let r = plan_restore(&c, &home).unwrap();
    apply_restore(&c, &r, &backups).unwrap();
    assert_eq!(read(&custom), CLAUDE);
    assert!(
        tw_adopt::detect::detect_one(&c, &home)
            .adopted_at_ms
            .is_none()
    );
}

// ---- Aider：YAML ------------------------------------------------------

const AIDER: &str = "# 我的 aider 配置\nmodel: gpt-4o\ndark-mode: true\nauto-commits: false\n";

#[test]
fn aider_round_trips_too() {
    let b = bed("aider", AIDER);
    let c = client("aider");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let after = read(&b.home.join(".aider.conf.yml"));
    assert!(after.contains("# 我的 aider 配置"), "{after}");
    assert!(after.contains("auto-commits: false"), "{after}");
    assert!(after.contains("127.0.0.1:8080/v1"), "{after}");

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&b.home.join(".aider.conf.yml")), AIDER);
}

// ---- DeepSeek Harness：补丁一行 + 凭据文件里一个引用 ---------------------

/// 一份**有生活痕迹**的家目录补丁：`!!js` 标签、注释、别的插件行、一段
/// `insert:`，还有一行用户自己调过思考深度的 `llm-deepseek`。
const DSH_PATCH: &str = "\
# 我自己的 dsh 补丁
- id: fs-sandbox
  disabled: !!js \"!ctx.get('profileContext')\"  # 行尾注释

- id: llm-deepseek
  config:
    thinking: !!js \"({ type: 'enabled', budget: 8000 })\"
    baseURL: https://api.deepseek.com/anthropic
- insert:
    - id: demo-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: demo
        transport: stdio
        command: npx
";

const DSH_CREDS: &str = "\
version: 1
refs:
  # 联网搜索也在用它，不能动
  DEEPSEEK_API_KEY: sk-我自己的
records:
  deepseek-account/default:
    kind: token
";

fn dsh_home(b: &Bed) -> PathBuf {
    b.home.join(".dsh")
}

#[test]
fn dsh_gets_one_row_and_one_reference_and_nothing_else() {
    let b = bed("dsh", DSH_PATCH);
    std::fs::write(dsh_home(&b).join(".credentials.yaml"), DSH_CREDS).unwrap();
    let c = client("dsh");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert_eq!(p.also.len(), 1, "凭据文件也在这一次改动里");
    assert!(p.carries_secret);
    apply(&c, &p, &b.backups).unwrap();

    let patch = read(&dsh_home(&b).join("cordis.patch.yml"));
    for keep in [
        "# 我自己的 dsh 补丁",
        "disabled: !!js \"!ctx.get('profileContext')\"  # 行尾注释",
        "thinking: !!js \"({ type: 'enabled', budget: 8000 })\"",
        "      name: '@deepseek-ai/dsh-mcp-client'",
    ] {
        assert!(patch.contains(keep), "接管把 {keep} 弄丢了：\n{patch}");
    }
    assert!(
        patch.contains("baseURL: http://127.0.0.1:8080/v1"),
        "{patch}"
    );
    assert!(patch.contains("apiKeyEnv: THINKWATCH_API_KEY"), "{patch}");
    assert!(!patch.contains("\n    baseURL: https://"), "{patch}");
    assert!(
        !patch.contains("tw-用户的专属密钥"),
        "补丁里只写引用名：\n{patch}"
    );

    let creds = read(&dsh_home(&b).join(".credentials.yaml"));
    assert!(creds.contains("DEEPSEEK_API_KEY: sk-我自己的"), "{creds}");
    assert!(
        creds.contains("THINKWATCH_API_KEY: tw-用户的专属密钥"),
        "{creds}"
    );
    assert!(creds.contains("version: 1\n"), "{creds}");
    assert!(creds.contains("kind: token"), "{creds}");

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&dsh_home(&b).join("cordis.patch.yml")), DSH_PATCH);
    assert_eq!(read(&dsh_home(&b).join(".credentials.yaml")), DSH_CREDS);
    for side in [
        "cordis.patch.yml.thinkwatch.json",
        ".credentials.yaml.thinkwatch.json",
    ] {
        assert!(!dsh_home(&b).join(side).exists(), "{side} 没删");
    }
}

#[test]
fn dsh_files_created_here_are_removed_again() {
    let b = bed("dsh", "");
    let c = client("dsh");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert!(p.before.is_none() && p.also[0].before.is_none());
    apply(&c, &p, &b.backups).unwrap();

    let patch = read(&dsh_home(&b).join("cordis.patch.yml"));
    assert!(
        patch.ends_with("- id: llm-deepseek\n  config:\n    baseURL: http://127.0.0.1:8080/v1\n    apiKeyEnv: THINKWATCH_API_KEY\n"),
        "{patch}"
    );
    let creds = read(&dsh_home(&b).join(".credentials.yaml"));
    // 数字的 1，不是字符串 —— 写成 '1' 的话 dsh 拒绝整个文件
    assert!(
        creds.contains("version: 1\nrefs:\n  THINKWATCH_API_KEY: tw-用户的专属密钥\n"),
        "{creds}"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dsh_home(&b).join(".credentials.yaml"))
            .unwrap()
            .permissions()
            .mode();
        // dsh 拒绝读一个别人也能读的凭据文件
        assert_eq!(mode & 0o077, 0, "{mode:o}");
    }

    let r = plan_restore(&c, &b.home).unwrap();
    assert!(
        r.delete_file && r.also[0].delete_file,
        "两份都是我们建的，还原后都是空的"
    );
    apply_restore(&c, &r, &b.backups).unwrap();
    assert!(!dsh_home(&b).join("cordis.patch.yml").exists());
    assert!(!dsh_home(&b).join(".credentials.yaml").exists());
}

#[test]
fn dsh_adopted_twice_keeps_the_first_originals() {
    let b = bed("dsh", DSH_PATCH);
    std::fs::write(dsh_home(&b).join(".credentials.yaml"), DSH_CREDS).unwrap();
    let c = client("dsh");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let again = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert!(again.is_noop(), "第二次接管应该是空操作");
    // 换一把密钥再接管一次，还原回的仍然是用户原来那一份
    let other = Gateway {
        base: "http://127.0.0.1:9090".into(),
        key: Some("tw-换过的".into()),
        models: Vec::new(),
    };
    let p = plan_adopt(&c, &b.home, &other, &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&dsh_home(&b).join("cordis.patch.yml")), DSH_PATCH);
    assert_eq!(read(&dsh_home(&b).join(".credentials.yaml")), DSH_CREDS);
}

/// 凭据文件是接管时建的，接管期间 dsh 自己往里写了登录令牌：还原收走我们的密钥，
/// **`version: 1` 留着** —— 没有它 dsh 拒绝整个文件，连它自己写的令牌一起
#[test]
fn a_credentials_file_dsh_has_written_into_keeps_its_version_after_a_restore() {
    let b = bed("dsh", "");
    let c = client("dsh");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let creds = dsh_home(&b).join(".credentials.yaml");
    let mut t = read(&creds);
    t.push_str("records:\n  deepseek-account/default:\n    kind: token\n");
    std::fs::write(&creds, t).unwrap();

    let r = plan_restore(&c, &b.home).unwrap();
    assert!(!r.also[0].delete_file, "dsh 写进去的东西还在，文件不删");
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(
        read(&creds),
        "version: 1\nrecords:\n  deepseek-account/default:\n    kind: token\n"
    );
    // 补丁那一份什么都没剩，照旧整个删掉
    assert!(!dsh_home(&b).join("cordis.patch.yml").exists());
}

/// 同一份新建的凭据文件，接管期间 dsh 在我们建的 `refs` 里记了用户自己的密钥：
/// 还原只摘掉我们那一项，`refs` 留着，`version` 也就跟着留着
#[test]
fn a_credentials_file_created_here_keeps_its_version_and_the_keys_dsh_added() {
    let b = bed("dsh", "");
    let c = client("dsh");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let creds = dsh_home(&b).join(".credentials.yaml");
    let t = tw_adopt::yaml::set(
        &read(&creds),
        &["refs", "DEEPSEEK_API_KEY"],
        &tw_adopt::json::Val::s("sk-我自己的"),
    )
    .unwrap();
    std::fs::write(&creds, t).unwrap();

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(
        read(&creds),
        "version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-我自己的\n"
    );
}

/// dsh 自己写出来的几种形状：新建的补丁是 `[]`，删空了的 `refs` 是 `{}`，行里的
/// `config` 可能是行内的。接管再还原，两份文件**一个字节都不变**：还原之后补丁
/// 不能是空文件（dsh 不认），`refs` 里补的那一项得摘得回去
#[test]
fn dsh_shapes_dsh_writes_itself_come_back_exactly() {
    for (patch, creds) in [
        ("[]\n", "version: 1\nrefs: {}\n"),
        (
            "# 补丁\n[]\n",
            "version: 1\nrefs: {OTHER: x}\nrecords: {}\n",
        ),
        (
            "- id: llm-deepseek\n  config: {thinking: high}\n",
            "version: 1\nrefs: {}\n",
        ),
    ] {
        let b = bed("dsh", patch);
        std::fs::write(dsh_home(&b).join(".credentials.yaml"), creds).unwrap();
        let c = client("dsh");
        let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
        apply(&c, &p, &b.backups).unwrap();
        assert!(read(&dsh_home(&b).join(".credentials.yaml")).contains("THINKWATCH_API_KEY"));

        let r = plan_restore(&c, &b.home).unwrap();
        apply_restore(&c, &r, &b.backups).unwrap();
        assert_eq!(read(&dsh_home(&b).join("cordis.patch.yml")), patch);
        assert_eq!(read(&dsh_home(&b).join(".credentials.yaml")), creds);
    }
}

/// 凭据文件原来没有 `refs`，是接管时建的；之后用户在里面加了自己的引用（联网搜索
/// 要用）。还原收走我们那一条，他的留着 —— 而不是去删整个 `refs`、再因为它不是
/// 一个标量而整个还原失败
#[test]
fn dsh_keeps_a_reference_the_user_added_to_the_refs_we_created() {
    let b = bed("dsh", DSH_PATCH);
    let creds_path = dsh_home(&b).join(".credentials.yaml");
    std::fs::write(&creds_path, "version: 1\n").unwrap();
    let c = client("dsh");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let mut creds = read(&creds_path);
    assert!(
        creds.ends_with("refs:\n  THINKWATCH_API_KEY: tw-用户的专属密钥\n"),
        "{creds}"
    );
    creds.push_str("  DEEPSEEK_API_KEY: sk-我自己的\n");
    std::fs::write(&creds_path, creds).unwrap();

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(
        read(&creds_path),
        "version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-我自己的\n"
    );
    assert_eq!(read(&dsh_home(&b).join("cordis.patch.yml")), DSH_PATCH);
}

/// 接管期间用户在我们那一行后面加了一条 `insert:`：还原照样过得去，那一条留着
#[test]
fn dsh_restores_with_a_row_the_user_added_after_ours() {
    let b = bed("dsh", "- id: a\n");
    std::fs::write(dsh_home(&b).join(".credentials.yaml"), DSH_CREDS).unwrap();
    let c = client("dsh");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let path = dsh_home(&b).join("cordis.patch.yml");
    let mut t = read(&path);
    t.push_str("- insert:\n    - id: x\n      name: y\n");
    std::fs::write(&path, t).unwrap();

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(
        read(&path),
        "- id: a\n- insert:\n    - id: x\n      name: y\n"
    );
}

#[test]
fn dsh_is_left_untouched_when_the_second_file_cannot_be_written() {
    // 凭据文件不是 dsh 认的形状（顶层是个列表）：一个字节都不写，补丁也不写
    let b = bed("dsh", DSH_PATCH);
    std::fs::write(dsh_home(&b).join(".credentials.yaml"), "- 不是映射\n").unwrap();
    let c = client("dsh");
    assert!(plan_adopt(&c, &b.home, &gw(), &Around::default()).is_err());
    assert_eq!(read(&dsh_home(&b).join("cordis.patch.yml")), DSH_PATCH);
}

#[test]
fn dsh_settings_yaml_counts_as_shadowing_only_when_it_sets_the_base_url() {
    let b = bed("dsh", "");
    let c = client("dsh");
    // profile 那一层同 id 的行被家目录这一层压着，不算盖住
    let profile = dsh_home(&b).join("profiles/default/cordis.patch.yml");
    std::fs::create_dir_all(profile.parent().unwrap()).unwrap();
    std::fs::write(
        &profile,
        "- id: llm-deepseek\n  config:\n    baseURL: https://x\n",
    )
    .unwrap();
    let settings = dsh_home(&b).join("settings.yaml");
    std::fs::write(
        &settings,
        "llm-deepseek:\n  thinking: high\nui:\n  theme: dark\n",
    )
    .unwrap();
    assert!(
        plan_adopt(&c, &b.home, &gw(), &Around::default())
            .unwrap()
            .shadows
            .is_empty()
    );
    // 0.1.5 的设置页写了 baseURL：它压过补丁层
    std::fs::write(
        &settings,
        "llm-deepseek:\n  baseURL: https://api.deepseek.com\n",
    )
    .unwrap();
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert_eq!(p.shadows, vec![settings.clone()]);
    assert!(p.notes.iter().any(|n| n.code == "adopt.plan.shadowed"));
    // 0.1.7 导入之后改了名，就不再读它了
    std::fs::rename(&settings, dsh_home(&b).join("settings.yaml.imported")).unwrap();
    assert!(
        plan_adopt(&c, &b.home, &gw(), &Around::default())
            .unwrap()
            .shadows
            .is_empty()
    );
}

// ---- 跨格式的规矩 ------------------------------------------------------

#[test]
fn every_adoptable_client_survives_a_round_trip() {
    // 每加一个客户端，这条就自动覆盖到它 —— 不用记得去补测试。
    for c in adoptable() {
        let seed = match c.format {
            tw_adopt::clients::Format::Json => "{\n  \"我自己的\": \"别动\"\n}\n",
            tw_adopt::clients::Format::Toml => "\"我自己的\" = \"别动\"\n",
            tw_adopt::clients::Format::Yaml => "我自己的: 别动\n",
            tw_adopt::clients::Format::Rows => "- id: 我自己的\n  config:\n    k: 别动\n",
        };
        let b = bed(c.id, seed);
        let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
        apply(&c, &p, &b.backups).unwrap();
        let after = read(&c.config_path(&b.home));
        assert!(
            after.contains("别动"),
            "{} 把用户原有的字段弄丢了：\n{after}",
            c.id
        );

        let r = plan_restore(&c, &b.home).unwrap();
        apply_restore(&c, &r, &b.backups).unwrap();
        let want = match c.id {
            "codex" => restored_codex(seed),
            _ => seed.to_string(),
        };
        assert_eq!(
            read(&c.config_path(&b.home)),
            want,
            "{} 还原之后对不上",
            c.id
        );
    }
}

#[test]
fn a_gateway_without_a_key_writes_no_key_field() {
    // 为「一个 key 就够」的人设计。网关不要求鉴权时，不该往
    // 用户的配置里塞一个空密钥。
    let g = Gateway {
        base: "http://127.0.0.1:8080".into(),
        key: None,
        models: Vec::new(),
    };
    for c in adoptable() {
        let seed = match c.format {
            tw_adopt::clients::Format::Json => "{}\n",
            _ => "",
        };
        let b = bed(c.id, seed);
        let p = plan_adopt(&c, &b.home, &g, &Around::default()).unwrap();
        assert!(!p.carries_secret, "{} 说自己要写密钥，可是没有密钥", c.id);
        apply(&c, &p, &b.backups).unwrap();
        let after = read(&c.config_path(&b.home));
        assert!(
            !after.contains("\"apiKey\": \"\""),
            "{} 写了一个空密钥：{after}",
            c.id
        );
        assert!(
            !after.contains("_token = \"\""),
            "{} 写了一个空密钥：{after}",
            c.id
        );
    }
}

#[test]
fn a_plan_is_just_a_plan_until_it_is_applied() {
    // 「算改动」和「落盘」分成两步，是因为中间必须夹一次人的确认。
    let b = bed("codex", CODEX);
    let c = client("codex");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert_ne!(p.before.as_deref(), Some(p.after.as_str()));
    assert_eq!(
        read(&b.home.join(".codex/config.toml")),
        CODEX,
        "只是算了一下就把文件改了"
    );
    assert!(!p.notes.is_empty(), "接管的代价一条都没说");
}

#[test]
fn adopting_the_same_thing_twice_is_recognised_as_a_no_op() {
    let b = bed("codex", CODEX);
    let c = client("codex");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let again = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert!(again.is_noop(), "第二次接管应该是空操作");
}

#[test]
fn a_restore_without_a_record_refuses_instead_of_guessing() {
    // 没有接管记录就不知道该还原成什么。**猜一个「合理的默认值」
    // 写回去，是这里面最坏的做法。**
    let b = bed("codex", CODEX);
    let c = client("codex");
    let e = plan_restore(&c, &b.home).unwrap_err();
    assert!(e.to_string().contains("there is no record"), "{e}");
    assert_eq!(read(&b.home.join(".codex/config.toml")), CODEX);
}

#[test]
fn the_shadow_file_that_bit_cc_switch_is_reported_at_plan_time() {
    // cc-switch #6828：我们写了 settings.json，而 settings.local.json
    // 里的残留把它遮住了 —— 用户看到的是「接管了但没生效」。
    let b = bed("claude-code", CLAUDE);
    std::fs::write(
        b.home.join(".claude/settings.local.json"),
        "{\"env\": {\"ANTHROPIC_BASE_URL\": \"https://别的地方\"}}\n",
    )
    .unwrap();
    let c = client("claude-code");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert_eq!(p.shadows.len(), 1, "{:?}", p.shadows);
    assert!(
        p.notes
            .iter()
            .any(|n| n.text.contains("settings.local.json")),
        "没提醒它会盖住我们：{:?}",
        p.notes
    );
}

#[test]
fn re_adopting_does_not_overwrite_what_the_original_was() {
    // **最隐蔽的一种数据丢失：每一步看起来都成功了。**第二次接管时，
    // 文件里的值已经是我们写的了；照着现状记一遍「原值」，之后的还原
    // 就会把用户还原到我们这儿，而不是还原回他原来的样子。
    let b = bed("claude-code", CLAUDE);
    let c = client("claude-code");
    for base in ["http://127.0.0.1:8080", "http://127.0.0.1:9999"] {
        let g = Gateway {
            base: base.into(),
            key: Some("tw-新密钥".into()),
            models: Vec::new(),
        };
        let p = plan_adopt(&c, &b.home, &g, &Around::default()).unwrap();
        apply(&c, &p, &b.backups).unwrap();
    }
    let side = read(&b.home.join(".claude/settings.json.thinkwatch.json"));
    assert!(
        !side.contains("127.0.0.1"),
        "把我们自己写的地址记成了「原值」：\n{side}"
    );

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(
        read(&b.home.join(".claude/settings.json")),
        CLAUDE,
        "还原回到的是我们自己写的那一版"
    );
}

#[test]
fn re_adopting_codex_also_keeps_the_first_record() {
    let b = bed("codex", CODEX);
    let c = client("codex");
    for base in ["http://127.0.0.1:8080", "http://127.0.0.1:9999"] {
        let g = Gateway {
            base: base.into(),
            key: None,
            models: Vec::new(),
        };
        let p = plan_adopt(&c, &b.home, &g, &Around::default()).unwrap();
        apply(&c, &p, &b.backups).unwrap();
    }
    let after = read(&b.home.join(".codex/config.toml"));
    assert!(
        after.contains("no model_provider originally"),
        "哨兵注释记成了我们自己的值：{after}"
    );
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(
        read(&b.home.join(".codex/config.toml")),
        restored_codex(CODEX)
    );
}

/// 接管记录在、却读不出来（写到一半断了电、被别的工具改坏了）：**不接管**，和还原
/// 一样拒绝。当成「没接管过」的话，此刻文件里我们写的网关地址和密钥会被记成原值，
/// 之后的还原把用户还原到网关上 —— 每一步看起来都成功了
#[test]
fn a_record_that_cannot_be_parsed_stops_a_takeover_like_it_stops_a_restore() {
    let b = bed("claude-code", CLAUDE);
    let c = client("claude-code");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let side = b.home.join(".claude/settings.json.thinkwatch.json");
    let broken = "{ \"what_this_file_is\": \"半截";
    std::fs::write(&side, broken).unwrap();
    let path = b.home.join(".claude/settings.json");
    let before = read(&path);

    let g = Gateway {
        base: "http://127.0.0.1:9999".into(),
        ..gw()
    };
    let e = plan_adopt(&c, &b.home, &g, &Around::default()).unwrap_err();
    // 还原早就这么说，界面有这一句的译文；说的是记录那个文件
    let r = plan_restore(&c, &b.home).unwrap_err();
    assert_eq!(e.msg().code, "adopt.plan.parse_failed");
    assert_eq!(r.msg().code, e.msg().code);
    assert!(
        e.to_string().contains("settings.json.thinkwatch.json"),
        "{e}"
    );
    assert_eq!(read(&path), before, "拒绝了还是改了配置");
    assert_eq!(read(&side), broken, "拒绝了还是盖掉了那份记录");

    // 是 JSON、却不是我们写的那种：一样拒绝，**报错里不抄原文**（它会显示在界面上）
    std::fs::write(&side, "{ \"file_created_by_us\": \"sk-别抄到界面上\" }").unwrap();
    let e = plan_adopt(&c, &b.home, &g, &Around::default()).unwrap_err();
    assert_eq!(e.msg().code, "adopt.plan.parse_failed");
    assert!(!e.to_string().contains("sk-别抄到界面上"), "{e}");
    assert_eq!(read(&path), before);
}

/// 记录是另一个客户端的（两个客户端被指到了同一个文件上）：不接管，也不盖掉它 ——
/// 那一个的还原全靠这份记录
#[test]
fn a_record_that_belongs_to_another_client_stops_a_takeover() {
    let b = bed("claude-code", CLAUDE);
    let c = client("claude-code");
    let theirs = serde_json::to_string_pretty(&tw_adopt::sentinel::SidecarRecord::new(
        "codex",
        1,
        "/nowhere/backup",
        false,
        &[tw_adopt::sentinel::Original::missing("model_provider")],
    ))
    .unwrap();
    let side = b.home.join(".claude/settings.json.thinkwatch.json");
    std::fs::write(&side, &theirs).unwrap();

    let e = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap_err();
    assert!(
        matches!(e, tw_adopt::plan::PlanError::ForeignSidecar { .. }),
        "{e}"
    );
    assert_eq!(e.msg().code, "adopt.plan.foreign_record");
    assert_eq!(read(&b.home.join(".claude/settings.json")), CLAUDE);
    assert_eq!(read(&side), theirs);
}

/// 接管记录是**换上去**的，不是原地截断重写：写到一半断了电，留下的是上一份完整的
/// 记录。换上去的那一份仍然只有自己能读
#[cfg(unix)]
#[test]
fn the_record_is_replaced_whole_rather_than_rewritten_in_place() {
    use std::os::unix::fs::MetadataExt;
    let b = bed("claude-code", CLAUDE);
    let c = client("claude-code");
    let side = b.home.join(".claude/settings.json.thinkwatch.json");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let first = std::fs::metadata(&side).unwrap().ino();

    let g = Gateway {
        base: "http://127.0.0.1:9999".into(),
        ..gw()
    };
    let p = plan_adopt(&c, &b.home, &g, &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let meta = std::fs::metadata(&side).unwrap();
    assert_ne!(meta.ino(), first, "记录是在原文件上截断重写的");
    assert_eq!(meta.mode() & 0o777, 0o600);
    let strays: Vec<_> = std::fs::read_dir(b.home.join(".claude"))
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".tmp"))
        .collect();
    assert!(strays.is_empty(), "留下了临时文件：{strays:?}");
    // 重复接管照常：还原回到的是第一次之前的样子
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&b.home.join(".claude/settings.json")), CLAUDE);
}

// ---- opencode：v1 的写法两个版本都认，v2 原生的那一条在就改它 ----------

/// 刚装好、用过一阵的 `opencode.jsonc`：带注释、别的 provider、MCP。
const OPENCODE_V1: &str = r#"{
  // opencode 自己生成的
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4",
  "provider": {
    "anthropic": { "options": { "apiKey": "sk-ant-我自己的" } }
  },
  "mcp": {
    "fs": { "type": "local", "command": ["npx", "-y", "server-fs"], "enabled": true },
  },
}
"#;

fn opencode_path(home: &Path) -> PathBuf {
    client("opencode").config_path(home)
}

fn get(text: &str, path: &[&str]) -> Option<tw_adopt::json::Val> {
    tw_adopt::json::get(text, path).unwrap()
}

#[test]
fn adopting_opencode_writes_a_provider_both_versions_can_use() {
    use tw_adopt::json::Val;
    let b = bed("opencode", OPENCODE_V1);
    let c = client("opencode");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();

    let after = read(&opencode_path(&b.home));
    let at = |k: &[&str]| {
        let mut path = vec!["provider", "thinkwatch"];
        path.extend_from_slice(k);
        get(&after, &path)
    };
    // 没有 npm 的话 v2 报 Unsupported package；没有 models 的话 v1 整条删掉
    assert_eq!(at(&["npm"]), Some(Val::s("@ai-sdk/openai-compatible")));
    assert_eq!(
        at(&["options", "baseURL"]),
        Some(Val::s("http://127.0.0.1:8080/v1"))
    );
    assert_eq!(
        at(&["options", "apiKey"]),
        Some(Val::s("tw-用户的专属密钥"))
    );
    assert_eq!(
        at(&["models", "gpt-5", "name"]),
        Some(Val::s("gpt-5")),
        "{after}"
    );
    assert_eq!(get(&after, &["providers"]), None, "不该另起一条原生的");
    // 别的东西一个字都不动：注释、别的 provider、MCP
    assert!(after.contains("// opencode 自己生成的"), "{after}");
    assert!(after.contains("sk-ant-我自己的"), "{after}");
    assert!(after.contains("\"server-fs\""), "{after}");

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&opencode_path(&b.home)), OPENCODE_V1);
}

/// v2 用户自己写过一条原生的 `providers.thinkwatch`：**改那一条**。另写一条 v1 的
/// 会被它整条盖掉（实测 v2.0.16：Model unavailable）
const OPENCODE_V2: &str = r#"{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "openai": { "settings": { "apiKey": "sk-我自己的" } },
    "thinkwatch": { "name": "我以前配的", "settings": { "baseURL": "http://192.168.1.2:8788/v1", "timeout": 60000 } }
  },
  "mcp": { "servers": { "fs": { "type": "local", "command": ["npx", "server-fs"] } } }
}
"#;

#[test]
fn adopting_opencode_edits_the_native_v2_entry_when_there_is_one() {
    use tw_adopt::json::Val;
    let b = bed("opencode", OPENCODE_V2);
    let c = client("opencode");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();

    let after = read(&opencode_path(&b.home));
    let at = |k: &[&str]| {
        let mut path = vec!["providers", "thinkwatch"];
        path.extend_from_slice(k);
        get(&after, &path)
    };
    assert_eq!(
        at(&["package"]),
        Some(Val::s("aisdk:@ai-sdk/openai-compatible"))
    );
    assert_eq!(
        at(&["settings", "baseURL"]),
        Some(Val::s("http://127.0.0.1:8080/v1"))
    );
    assert_eq!(
        at(&["settings", "apiKey"]),
        Some(Val::s("tw-用户的专属密钥"))
    );
    // 用户自己设的超时留着
    assert_eq!(at(&["settings", "timeout"]), Some(Val::Num("60000".into())));
    assert_eq!(
        at(&["models", "claude-sonnet", "name"]),
        Some(Val::s("claude-sonnet"))
    );
    assert_eq!(get(&after, &["provider"]), None, "不该再写一条 v1 的");

    // 检测认的是原生的那一条
    let d = tw_adopt::detect::detect_one(&c, &b.home);
    assert_eq!(d.endpoint.as_deref(), Some("http://127.0.0.1:8080/v1"));
    assert_eq!(d.models, Some(vec!["claude-sonnet".into(), "gpt-5".into()]));

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&opencode_path(&b.home)), OPENCODE_V2);
}

/// 上游或路由变了之后重写模型清单：走的就是再接管一次，还原仍然回到最初的样子
#[test]
fn rewriting_the_opencode_model_list_keeps_the_first_record() {
    let b = bed("opencode", OPENCODE_V1);
    let c = client("opencode");
    for models in [vec!["a"], vec!["a", "b"]] {
        let g = Gateway {
            models: models.into_iter().map(ModelCard::named).collect(),
            ..gw()
        };
        let p = plan_adopt(&c, &b.home, &g, &Around::default()).unwrap();
        apply(&c, &p, &b.backups).unwrap();
    }
    let d = tw_adopt::detect::detect_one(&c, &b.home);
    assert_eq!(d.models, Some(vec!["a".into(), "b".into()]));

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&opencode_path(&b.home)), OPENCODE_V1);
}

/// 两次接管之间文件里冒出一条原生的 `providers.thinkwatch`（v2 迁移写回、或者
/// 用户自己加的），第二次改的就是它。**第一次写的那条 v1 的连同密钥也得在还原时
/// 收走**：记录里只剩第二次的字段的话，它会带着我们的密钥一直留在文件里
#[test]
fn restoring_opencode_after_the_shape_changed_removes_both_entries() {
    use tw_adopt::json::Val;
    let b = bed("opencode", OPENCODE_V1);
    let c = client("opencode");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();

    let path = opencode_path(&b.home);
    let native = tw_adopt::json::set(
        &read(&path),
        &["providers", "thinkwatch"],
        &Val::Obj(vec![("name".into(), Val::s("ThinkWatch"))]),
    )
    .unwrap();
    std::fs::write(&path, native).unwrap();

    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    let after = read(&path);
    assert!(!after.contains("tw-用户的专属密钥"), "{after}");
    assert_eq!(get(&after, &["provider", "thinkwatch"]), None, "{after}");
}

/// 网关一个模型都还没有：照样能接管，但**在确认之前说清** opencode 里不会有它的模型
#[test]
fn adopting_opencode_with_no_models_says_so_before_confirming() {
    let b = bed("opencode", "");
    let c = client("opencode");
    let g = Gateway {
        models: Vec::new(),
        ..gw()
    };
    let p = plan_adopt(&c, &b.home, &g, &Around::default()).unwrap();
    assert!(
        p.notes.iter().any(|n| n.code == "adopt.plan.no_models"),
        "{:?}",
        p.notes
    );
    let with = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert!(!with.notes.iter().any(|n| n.code == "adopt.plan.no_models"));
}

// ---- Pi 和 oh-my-pi：自己的一个 provider，模型清单里每个模型挑本家的 API ----------

/// 用过一阵的 Pi `models.json`：注释（Pi 读之前会去掉）、一个本机的 ollama
const PI: &str = r#"{
  // 本机的 ollama
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [{ "id": "qwen2.5-coder:7b" }]
    }
  }
}
"#;

#[test]
fn adopting_pi_adds_a_provider_with_each_models_own_api() {
    use tw_adopt::json::Val;
    let b = bed("pi", PI);
    let c = client("pi");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    // 默认模型不动：要说清去哪儿选；只查证过字段名也要说
    let codes: Vec<&str> = p.notes.iter().map(|n| n.code.as_str()).collect();
    assert!(codes.contains(&"adopt.cost.pi.default_model"), "{codes:?}");
    assert!(codes.contains(&"adopt.plan.fields_only"), "{codes:?}");
    apply(&c, &p, &b.backups).unwrap();

    let path = c.config_path(&b.home);
    assert!(
        path.ends_with(".pi/agent/models.json"),
        "{}",
        path.display()
    );
    let after = read(&path);
    let at = |k: &[&str]| {
        let mut p = vec!["providers", "thinkwatch"];
        p.extend_from_slice(k);
        get(&after, &p)
    };
    assert_eq!(at(&["baseUrl"]), Some(Val::s("http://127.0.0.1:8080/v1")));
    assert_eq!(at(&["api"]), Some(Val::s("openai-completions")));
    assert_eq!(at(&["apiKey"]), Some(Val::s("tw-用户的专属密钥")));
    // Claude 走 Anthropic Messages、地址不带 /v1；GPT 走 Responses
    let models = tw_adopt::json::value(
        r#"[
      {"id": "claude-sonnet", "api": "anthropic-messages", "baseUrl": "http://127.0.0.1:8080"},
      {"id": "gpt-5", "api": "openai-responses"}
    ]"#,
    )
    .unwrap();
    assert_eq!(at(&["models"]), Some(models), "{after}");
    // 别的一个字都不动：注释、ollama
    assert!(after.contains("// 本机的 ollama"), "{after}");
    assert!(after.contains("\"qwen2.5-coder:7b\""), "{after}");

    let d = tw_adopt::detect::detect_one(&c, &b.home);
    assert_eq!(d.endpoint.as_deref(), Some("http://127.0.0.1:8080/v1"));
    assert_eq!(d.models, Some(vec!["claude-sonnet".into(), "gpt-5".into()]));
    assert!(d.installed);

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&path), PI);
}

/// 网关上的模型变了，重新写一遍清单：还原仍然回到最初的样子
#[test]
fn rewriting_the_pi_model_list_keeps_the_first_record() {
    let b = bed("pi", PI);
    let c = client("pi");
    for models in [vec!["a"], vec!["a", "claude-b"]] {
        let g = Gateway {
            models: models.into_iter().map(ModelCard::named).collect(),
            ..gw()
        };
        let p = plan_adopt(&c, &b.home, &g, &Around::default()).unwrap();
        apply(&c, &p, &b.backups).unwrap();
    }
    let d = tw_adopt::detect::detect_one(&c, &b.home);
    assert_eq!(d.models, Some(vec!["a".into(), "claude-b".into()]));
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&c.config_path(&b.home)), PI);
}

/// Pi 访问 127.0.0.1 也走代理：`NO_PROXY` 不列它的话，接管之前说
#[test]
fn a_proxy_in_the_way_of_pi_is_said_before_connecting() {
    let b = bed("pi", PI);
    let c = client("pi");
    let around = |no_proxy: Option<&str>| Around {
        env: [("HOME".to_string(), b.home.display().to_string())].into(),
        proxy: std::iter::once(("HTTPS_PROXY", "http://proxy:3128"))
            .chain(std::iter::once(("HTTP_PROXY", "http://proxy:3128")))
            .chain(no_proxy.map(|v| ("NO_PROXY", v)))
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        ..Default::default()
    };
    let p = plan_adopt(&c, &b.home, &gw(), &around(None)).unwrap();
    let n = p
        .notes
        .iter()
        .find(|n| n.code == "adopt.plan.pi.proxy_env")
        .expect("没说代理的事");
    assert_eq!(n.args["name"], "HTTP_PROXY");
    assert_eq!(n.args["host"], "127.0.0.1");
    let p = plan_adopt(&c, &b.home, &gw(), &around(Some("localhost,127.0.0.1"))).unwrap();
    assert!(
        !p.notes
            .iter()
            .any(|n| n.code.starts_with("adopt.plan.pi.proxy"))
    );
    // 别的客户端不说这件事
    let o = bed("omp", "");
    let p = plan_adopt(&client("omp"), &o.home, &gw(), &around(None)).unwrap();
    assert!(
        !p.notes
            .iter()
            .any(|n| n.code.starts_with("adopt.plan.pi.proxy"))
    );
}

/// 用过一阵的 oh-my-pi `models.yml`：注释、一个按 discovery 找模型的 ollama
const OMP: &str = "# 我的 omp 模型\nproviders:\n  ollama:\n    baseUrl: http://127.0.0.1:11434\n    api: openai-completions\n    auth: none  # 本机的不要密钥\n    discovery:\n      type: ollama\n";

#[test]
fn adopting_omp_says_it_authenticates_with_a_key() {
    let b = bed("omp", OMP);
    let c = client("omp");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();

    let path = c.config_path(&b.home);
    assert!(
        path.ends_with(".omp/agent/models.yml"),
        "{}",
        path.display()
    );
    let after = read(&path);
    let at = |k: &str| {
        tw_adopt::yaml::get(&after, &["providers", "thinkwatch", k])
            .unwrap()
            .unwrap_or_default()
    };
    // **不写 `auth: apiKey` 的话，Anthropic 的那几个模型会伪装成 Claude Code 发出去**
    assert_eq!(at("auth"), "apiKey");
    assert_eq!(at("baseUrl"), "http://127.0.0.1:8080/v1");
    assert_eq!(at("api"), "openai-completions");
    assert_eq!(at("apiKey"), "tw-用户的专属密钥");
    // YAML 读回来标量都是字符串，和同一张 JSON 写法的清单比
    let models = tw_adopt::json::value(
        r#"[
      {"id": "claude-sonnet", "api": "anthropic-messages", "baseUrl": "http://127.0.0.1:8080"},
      {"id": "gpt-5", "api": "openai-responses"}
    ]"#,
    )
    .unwrap();
    assert_eq!(at("models"), models.to_line(), "{after}");
    assert!(
        after.contains("    models:\n      - id: claude-sonnet\n        api: anthropic-messages\n"),
        "{after}"
    );
    // 用户的东西一个字节不动：原文整个还在（哨兵注释放在最前面）
    assert!(after.contains(OMP), "{after}");
    assert!(after.starts_with("# === ThinkWatch: begin ==="), "{after}");

    let d = tw_adopt::detect::detect_one(&c, &b.home);
    assert_eq!(d.endpoint.as_deref(), Some("http://127.0.0.1:8080/v1"));
    assert_eq!(d.models, Some(vec!["claude-sonnet".into(), "gpt-5".into()]));

    // 再接管一次是空操作
    let again = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert!(again.is_noop(), "{}", again.after);

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&path), OMP);
}

/// 没有 `models.yml` 只有 `models.yaml`：oh-my-pi 读的是后者，就写进后者，不另建一份把它盖住
#[test]
fn omp_is_written_into_the_one_file_it_reads() {
    let b = bed("omp", "");
    let c = client("omp");
    let yml = c.config_path(&b.home);
    let yaml = yml.with_file_name("models.yaml");
    std::fs::write(&yaml, OMP).unwrap();
    assert_eq!(c.config_path(&b.home), yaml);
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    assert!(!yml.exists());
    assert!(read(&yaml).contains("thinkwatch"));

    // 之后才建了 `models.yml`：它一在，写进 `models.yaml` 的就整个没人读了
    std::fs::write(&yml, "providers: {}\n").unwrap();
    assert_eq!(c.config_path(&b.home), yaml, "换了文件就还原不了");
    let f = tw_adopt::detect::diagnose(&c, &b.home, None, &Around::default())
        .into_iter()
        .find(|f| f.title.code == "adopt.diag.shadowed")
        .expect("没报被盖住");
    assert_eq!(f.level, tw_adopt::detect::Level::Blocking);
    assert_eq!(f.detail.code, "adopt.diag.shadowed.whole_file");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert!(
        p.notes
            .iter()
            .any(|n| n.code == "adopt.plan.shadowed.whole_file"),
        "{:?}",
        p.notes
    );

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&yaml), OMP);
}

/// 网关答了规格的模型：规格照各家的写法写进去、写回校验过得去（omp 的 YAML 读回来数和开关
/// 都是字符串），读回来不提示更新、再接管是空操作；规格一变就提示，还原照样一个字节不差
#[test]
fn model_specs_are_written_read_back_and_restored() {
    let card = |id: &str| ModelCard {
        id: id.into(),
        context_window: Some(200_000),
        max_output_tokens: Some(64_000),
        reasoning: Some(true),
        image_input: Some(true),
    };
    let g = Gateway {
        models: vec![card("claude-sonnet"), ModelCard::named("gpt-5")],
        ..gw()
    };
    for (id, before) in [("pi", PI), ("omp", OMP), ("opencode", "{}\n")] {
        let b = bed(id, before);
        let c = client(id);
        let p = plan_adopt(&c, &b.home, &g, &Around::default()).unwrap();
        apply(&c, &p, &b.backups).unwrap();
        let after = read(&c.config_path(&b.home));
        let field = match id {
            "opencode" => "\"context\": 200000",
            "pi" => "\"contextWindow\": 200000",
            _ => "contextWindow: 200000",
        };
        assert!(after.contains(field), "{id}: {after}");

        let d = tw_adopt::detect::detect_one(&c, &b.home);
        let written = d.models.unwrap();
        assert!(!c.models_stale(&written, &g.models), "{id}: {written:?}");
        let again = plan_adopt(&c, &b.home, &g, &Around::default()).unwrap();
        assert!(again.is_noop(), "{id}: {}", again.after);
        let mut changed = g.models.clone();
        changed[0].context_window = Some(1_000_000);
        assert!(c.models_stale(&written, &changed), "{id}");

        let r = plan_restore(&c, &b.home).unwrap();
        apply_restore(&c, &r, &b.backups).unwrap();
        assert_eq!(read(&c.config_path(&b.home)), before, "{id}");
    }
}

/// 两边都还没有配置文件：新建的，还原时删掉
#[test]
fn a_pi_or_omp_file_created_here_is_removed_again() {
    for id in ["pi", "omp"] {
        let b = bed(id, "");
        let c = client(id);
        let path = c.config_path(&b.home);
        let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
        assert!(p.before.is_none(), "{id}");
        apply(&c, &p, &b.backups).unwrap();
        assert!(read(&path).contains("tw-用户的专属密钥"), "{id}");
        let r = plan_restore(&c, &b.home).unwrap();
        apply_restore(&c, &r, &b.backups).unwrap();
        assert!(!path.exists(), "{id}：{}", read(&path));
    }
}

// ---- Claude Code 直连云服务商：`CLAUDE_CODE_USE_BEDROCK` 这一类开关 ------------

/// `/setup-bedrock` 写出来的那种 settings.json：开关、区域、API key、钉好的模型都在 `env` 里
const CLAUDE_BEDROCK: &str = r#"{
  "model": "opusplan",
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "AWS_REGION": "us-west-2",
    "AWS_BEARER_TOKEN_BEDROCK": "ABSK-我的Bedrock密钥",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "us.anthropic.claude-opus-4-8",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "us.anthropic.claude-sonnet-4-6"
  },
  "awsAuthRefresh": "aws sso login --profile dev"
}
"#;

/// 开关打开着，Claude Code 就不看 `ANTHROPIC_BASE_URL` —— 接管要把它关掉，还原时一个
/// 字节不差地打开回去
#[test]
fn a_bedrock_switch_in_settings_is_turned_off_and_restored_byte_for_byte() {
    let b = bed("claude-code", CLAUDE_BEDROCK);
    let c = client("claude-code");
    let path = b.home.join(".claude/settings.json");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    let codes: Vec<&str> = p.notes.iter().map(|n| n.code.as_str()).collect();
    assert!(
        codes.contains(&"adopt.plan.cloud_off.settings"),
        "{codes:?}"
    );
    // 只钉了 opus 和 sonnet：haiku 那一类（后台任务）会用 Anthropic 的名字发给网关
    let models = p
        .notes
        .iter()
        .find(|n| n.code == "adopt.plan.cloud_models")
        .expect("没说哪些模型会用 Anthropic 的名字");
    assert_eq!(models.args["names"], "ANTHROPIC_DEFAULT_HAIKU_MODEL");
    // 按原来的设置新建 Bedrock 上游要填的：区域、API key 的变量引用 —— 不是明文
    let draft = p.bedrock.clone().expect("没备好新建上游要填的");
    assert_eq!(draft.region, "us-west-2");
    assert_eq!(
        draft.auth,
        tw_adopt::cloud::DraftAuth::Key("${AWS_BEARER_TOKEN_BEDROCK}".into())
    );
    apply(&c, &p, &b.backups).unwrap();

    let after = read(&path);
    assert_eq!(
        tw_adopt::json::get(&after, &["env", "CLAUDE_CODE_USE_BEDROCK"]).unwrap(),
        Some(tw_adopt::json::Val::s(""))
    );
    for keep in [
        "\"AWS_REGION\": \"us-west-2\"",
        "ABSK-我的Bedrock密钥",
        "us.anthropic.claude-sonnet-4-6",
        "aws sso login --profile dev",
    ] {
        assert!(after.contains(keep), "接管把 {keep} 弄丢了：\n{after}");
    }

    let r = plan_restore(&c, &b.home).unwrap();
    assert!(
        r.notes.iter().any(|n| n.code == "adopt.restore.cloud_on"),
        "{:?}",
        r.notes
    );
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&path), CLAUDE_BEDROCK, "还原之后不是原来那份文件");
}

/// 开关是 shell 里 export 的：shell 配置是用户的，不去改它；在 settings.json 里写一个
/// 空串盖住它，还原时拿掉这个空串，shell 里的那一行就又起作用
#[test]
#[cfg(not(windows))]
fn a_switch_the_shell_exports_is_overridden_here_and_the_override_goes_on_restore() {
    let b = bed("claude-code", CLAUDE);
    std::fs::write(
        b.home.join(".zshrc"),
        "export PATH=$HOME/bin:$PATH\nexport CLAUDE_CODE_USE_BEDROCK=1\n",
    )
    .unwrap();
    let c = client("claude-code");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    let off = p
        .notes
        .iter()
        .find(|n| n.code == "adopt.plan.cloud_off.shell")
        .expect("没说 shell 里打开着");
    assert_eq!(off.args["line"], "2");
    apply(&c, &p, &b.backups).unwrap();
    let path = b.home.join(".claude/settings.json");
    assert!(
        read(&path).contains("\"CLAUDE_CODE_USE_BEDROCK\": \"\""),
        "{}",
        read(&path)
    );
    // shell 配置一个字节都没动
    assert_eq!(
        read(&b.home.join(".zshrc")),
        "export PATH=$HOME/bin:$PATH\nexport CLAUDE_CODE_USE_BEDROCK=1\n"
    );

    let r = plan_restore(&c, &b.home).unwrap();
    assert!(
        r.notes.iter().any(|n| n.code == "adopt.restore.cloud_env"),
        "{:?}",
        r.notes
    );
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&path), CLAUDE, "还原之后留下了那个空串");
}

/// 只在用户环境里（`source` 进来的文件、注册表）打开的，一样关掉
#[test]
fn a_switch_only_the_environment_has_is_turned_off_too() {
    let b = bed("claude-code", CLAUDE);
    let c = client("claude-code");
    let around = Around {
        env: [("CLAUDE_CODE_USE_VERTEX".to_string(), "true".to_string())].into(),
        ..Default::default()
    };
    let p = plan_adopt(&c, &b.home, &gw(), &around).unwrap();
    assert!(
        p.notes.iter().any(|n| n.code == "adopt.plan.cloud_off.env"),
        "{:?}",
        p.notes
    );
    // 不是 Bedrock：没有「哪些模型会用 Anthropic 的名字」那一句，也没有新建上游的草稿
    assert!(!p.notes.iter().any(|n| n.code == "adopt.plan.cloud_models"));
    assert!(p.bedrock.is_none());
    apply(&c, &p, &b.backups).unwrap();
    let path = b.home.join(".claude/settings.json");
    assert!(read(&path).contains("\"CLAUDE_CODE_USE_VERTEX\": \"\""));
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&path), CLAUDE);
}

/// 第二次接管时文件里已经是我们写的空串了：原值照第一次的记录，还原回 "1"
#[test]
fn re_adopting_keeps_the_switch_as_it_first_was() {
    let b = bed("claude-code", CLAUDE_BEDROCK);
    let c = client("claude-code");
    for _ in 0..2 {
        let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
        apply(&c, &p, &b.backups).unwrap();
    }
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&b.home.join(".claude/settings.json")), CLAUDE_BEDROCK);
}

/// 组织托管的配置打开的开关盖过一切：接管写了也白写，所以拒绝，一个字节都不写
#[test]
fn a_switch_a_managed_configuration_turns_on_stops_the_takeover() {
    let b = bed("claude-code", CLAUDE);
    let managed = b.home.join("managed-settings.json");
    std::fs::write(&managed, r#"{"env": {"CLAUDE_CODE_USE_BEDROCK": "1"}}"#).unwrap();
    let c = client("claude-code");
    let around = Around {
        managed: vec![managed.clone()],
        ..Default::default()
    };
    let e = plan_adopt(&c, &b.home, &gw(), &around).unwrap_err();
    assert_eq!(e.msg().code, "adopt.plan.cloud_managed", "{e}");
    assert_eq!(e.msg().args["path"], managed.display().to_string());
    assert_eq!(read(&b.home.join(".claude/settings.json")), CLAUDE);
}

/// 别的客户端不看这些开关：它们是 Claude Code 的
#[test]
#[cfg(not(windows))]
fn the_switches_are_claude_codes_alone() {
    let b = bed("codex", CODEX);
    std::fs::write(b.home.join(".zshrc"), "export CLAUDE_CODE_USE_BEDROCK=1\n").unwrap();
    let c = client("codex");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert!(!p.after.contains("CLAUDE_CODE_USE_BEDROCK"), "{}", p.after);
    assert!(
        !p.notes
            .iter()
            .any(|n| n.code.starts_with("adopt.plan.cloud"))
    );
}

// ---- Grok Build：每个模型一张表，每张表都带自己的密钥 ------------------------

/// 用过一阵的 config.toml：自己的模型表（带发给 Anthropic 的头）、MCP、权限。
const GROK: &str = r#"# 我的 Grok 配置
[models]
default = "grok-4.6"

[model.my-claude]
model = "claude-opus-4-6"
base_url = "https://api.anthropic.com/v1"
api_backend = "messages"
extra_headers = { "x-api-key" = "sk-ant-我自己的" }

[mcp_servers.fs]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem"]

[permission]
allow = ["Bash(git status)"]
"#;

fn grok_path(home: &Path) -> PathBuf {
    client("grok-build").config_path(home)
}

fn toml_get(text: &str, path: &[&str]) -> Option<tw_adopt::json::Val> {
    tw_adopt::toml::get(text, path).unwrap()
}

#[test]
fn adopting_grok_writes_a_keyed_table_per_model_and_restores_byte_for_byte() {
    let b = bed("grok-build", GROK);
    let c = client("grok-build");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert!(p.carries_secret);
    apply(&c, &p, &b.backups).unwrap();
    let after = read(&grok_path(&b.home));
    for m in ["claude-sonnet", "gpt-5"] {
        let key = format!("thinkwatch/{m}");
        let at = |f: &str| toml_get(&after, &["model", key.as_str(), f]);
        assert_eq!(at("model"), Some(tw_adopt::json::Val::s(m)), "{after}");
        assert_eq!(
            at("base_url"),
            Some(tw_adopt::json::Val::s("http://127.0.0.1:8080/v1"))
        );
        // **每一张都带自己的密钥**：没有的话 Grok 会拿 xAI 的会话令牌去请求它
        assert_eq!(
            at("api_key"),
            Some(tw_adopt::json::Val::s("tw-用户的专属密钥"))
        );
    }
    assert_eq!(
        toml_get(
            &after,
            &["model", "thinkwatch/claude-sonnet", "api_backend"]
        ),
        Some(tw_adopt::json::Val::s("messages"))
    );
    assert_eq!(
        toml_get(&after, &["model", "thinkwatch/gpt-5", "api_backend"]),
        Some(tw_adopt::json::Val::s("responses"))
    );
    // 选着的 grok-4.6 网关没有：换成清单里的第一个；campaign 关掉
    assert_eq!(
        toml_get(&after, &["models", "default"]),
        Some(tw_adopt::json::Val::s("thinkwatch/claude-sonnet"))
    );
    assert_eq!(
        toml_get(&after, &["features", "campaigns"]),
        Some(tw_adopt::json::Val::Bool(false))
    );
    // 用户自己的表、MCP、权限一样不少，自己的表一个字段都没被碰
    assert!(after.contains("sk-ant-我自己的"), "{after}");
    assert!(after.contains("[mcp_servers.fs]"), "{after}");
    assert!(after.contains("Bash(git status)"), "{after}");
    let detected = tw_adopt::detect::detect_one(&c, &b.home);
    assert_eq!(
        detected.endpoint.as_deref(),
        Some("http://127.0.0.1:8080/v1")
    );
    assert_eq!(
        detected.models,
        Some(vec!["claude-sonnet".into(), "gpt-5".into()])
    );

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&grok_path(&b.home)), GROK);
}

/// 网关不再列出某个模型：重新接管时它那张表整个拿掉（留着就是一张选得到、用不了的表，
/// 模型清单也永远对不上），第一次记下的原值不变，还原照样一个字节不差
#[test]
fn re_adopting_grok_with_a_changed_model_list_drops_the_stale_table() {
    let b = bed("grok-build", GROK);
    let c = client("grok-build");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();

    let mut g = gw();
    g.models = vec!["gpt-5".into(), "deepseek-chat".into()];
    let p = plan_adopt(&c, &b.home, &g, &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let after = read(&grok_path(&b.home));
    assert!(!after.contains("thinkwatch/claude-sonnet"), "{after}");
    assert_eq!(
        toml_get(
            &after,
            &["model", "thinkwatch/deepseek-chat", "api_backend"]
        ),
        Some(tw_adopt::json::Val::s("chat_completions"))
    );
    // 默认模型选的那一张没了：换成新清单的第一个
    assert_eq!(
        toml_get(&after, &["models", "default"]),
        Some(tw_adopt::json::Val::s("thinkwatch/gpt-5"))
    );
    let d = tw_adopt::detect::detect_one(&c, &b.home);
    assert!(
        !c.models_stale(d.models.as_deref().unwrap(), &g.models),
        "{:?}",
        d.models
    );
    // 原值还是第一次的：默认模型是 grok-4.6
    assert!(after.contains("# was models.default: grok-4.6"), "{after}");

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&grok_path(&b.home)), GROK);
}

/// Grok 自己写这份文件时注释全丢（`/model`、自动更新之后）：哨兵没了，旁文件里的记录
/// 还在，还原照样把我们写的收走
#[test]
fn grok_rewriting_the_file_without_our_comment_still_restores() {
    let b = bed("grok-build", GROK);
    let c = client("grok-build");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let path = grok_path(&b.home);
    let stripped: String = read(&path)
        .lines()
        .filter(|l| !l.starts_with('#'))
        .map(|l| format!("{l}\n"))
        .collect();
    std::fs::write(&path, &stripped).unwrap();

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    let back = read(&path);
    assert!(!back.contains("thinkwatch"), "{back}");
    assert!(!back.contains("campaigns"), "{back}");
    assert_eq!(
        toml_get(&back, &["models", "default"]),
        Some(tw_adopt::json::Val::s("grok-4.6"))
    );
    assert!(back.contains("sk-ant-我自己的"), "{back}");
}

/// 一个模型都没有的网关：什么表都不写，接管之前就说
#[test]
fn adopting_grok_with_no_models_writes_no_table_and_says_so() {
    let b = bed("grok-build", GROK);
    let c = client("grok-build");
    let mut g = gw();
    g.models = Vec::new();
    let p = plan_adopt(&c, &b.home, &g, &Around::default()).unwrap();
    assert!(!p.after.contains("thinkwatch/"), "{}", p.after);
    // 什么都不写就是空操作：不凭空多出一段哨兵注释
    assert!(p.is_noop(), "{}", p.after);
    assert!(
        p.notes
            .iter()
            .any(|n| n.code == "adopt.plan.no_models_nothing_written"),
        "{:?}",
        p.notes
    );
}

/// 同一份清单再接管一次：什么都不用改（不留备份、不记历史）
#[test]
fn re_adopting_grok_with_the_same_models_is_a_no_op() {
    let b = bed("grok-build", GROK);
    let c = client("grok-build");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let again = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert!(again.is_noop(), "{}", again.after);
}

// ---- Qwen Code：自己的一组 provider，密钥经 settings.env 交给它 ----------------

/// 用过一阵的 settings.json：带注释、用户自己的 openai 那一组、`/auth` 写下的密钥、MCP。
const QWEN: &str = r#"{
  // Qwen 自己维护的版本号
  "$version": 4,
  "modelProviders": {
    "openai": [
      { "id": "qwen3-coder-plus", "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1", "envKey": "DASHSCOPE_API_KEY" }
    ]
  },
  "env": {
    "DASHSCOPE_API_KEY": "sk-dash-我自己的"
  },
  "security": {
    "auth": {
      "selectedType": "openai"
    }
  },
  "model": {
    "name": "qwen3-coder-plus"
  },
  "mcpServers": {
    "fs": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"] }
  }
}
"#;

fn qwen_path(home: &Path) -> PathBuf {
    client("qwen-code").config_path(home)
}

#[test]
fn adopting_qwen_adds_a_provider_of_our_own_and_restores_byte_for_byte() {
    let b = bed("qwen-code", QWEN);
    let c = client("qwen-code");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert!(p.carries_secret);
    apply(&c, &p, &b.backups).unwrap();
    let after = read(&qwen_path(&b.home));
    let ours = get(&after, &["modelProviders", "thinkwatch"]).unwrap();
    let tw_adopt::json::Val::Arr(es) = ours else {
        panic!("{after}")
    };
    assert_eq!(es.len(), 2, "{after}");
    assert_eq!(
        get(&after, &["providerProtocol", "thinkwatch"]),
        Some(tw_adopt::json::Val::s("openai"))
    );
    assert_eq!(
        get(&after, &["env", tw_adopt::qwen::KEY_ENV]),
        Some(tw_adopt::json::Val::s("tw-用户的专属密钥"))
    );
    // 选着的 qwen3-coder-plus 网关没有：换成清单里的第一个，地址跟着写
    assert_eq!(
        get(&after, &["model", "name"]),
        Some(tw_adopt::json::Val::s("claude-sonnet"))
    );
    assert_eq!(
        get(&after, &["model", "baseUrl"]),
        Some(tw_adopt::json::Val::s("http://127.0.0.1:8080/v1"))
    );
    // 用户自己的那一组、`/auth` 写下的密钥、注释、MCP 一样不少
    assert!(after.contains("// Qwen 自己维护的版本号"), "{after}");
    assert!(after.contains("sk-dash-我自己的"), "{after}");
    assert_eq!(
        get(&after, &["modelProviders", "openai"]),
        get(QWEN, &["modelProviders", "openai"])
    );
    let d = tw_adopt::detect::detect_one(&c, &b.home);
    assert_eq!(d.endpoint.as_deref(), Some("http://127.0.0.1:8080/v1"));
    assert_eq!(d.models, Some(vec!["claude-sonnet".into(), "gpt-5".into()]));

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&qwen_path(&b.home)), QWEN);
}

/// 新的模型清单整组换掉，第一次记下的原值不变
#[test]
fn re_adopting_qwen_with_a_changed_model_list_replaces_the_group() {
    let b = bed("qwen-code", QWEN);
    let c = client("qwen-code");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let mut g = gw();
    g.models = vec!["gpt-5".into()];
    let p = plan_adopt(&c, &b.home, &g, &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let after = read(&qwen_path(&b.home));
    assert_eq!(
        tw_adopt::qwen::models_in(&after),
        Some(vec!["gpt-5".into()])
    );
    assert_eq!(
        get(&after, &["model", "name"]),
        Some(tw_adopt::json::Val::s("gpt-5"))
    );
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&qwen_path(&b.home)), QWEN);
}

/// 还没有 settings.json：建出来，还原时它空了就收走
#[test]
fn a_qwen_settings_file_created_here_is_removed_again() {
    let b = bed("qwen-code", "");
    let c = client("qwen-code");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    assert!(qwen_path(&b.home).exists());
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert!(!qwen_path(&b.home).exists());
}

// ---- Hermes Agent：`model` 那一节换成指向网关的自定义 provider ----------------

/// 照它安装时铺下的那一份写的：大段注释、带引号的值、MCP、`_config_version`。
const HERMES: &str = r#"# Hermes Agent CLI Configuration
_config_version: 49

# =============================================================================
# Model Configuration
# =============================================================================
model:
  # Default model to use (can be overridden with --model flag)
  default: "anthropic/claude-opus-4.6"

  # Inference provider selection
  provider: "auto"

  # API configuration (falls back to OPENROUTER_API_KEY env var)
  base_url: "https://openrouter.ai/api/v1"

mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_我自己的"
"#;

fn hermes_path(home: &Path) -> PathBuf {
    client("hermes-agent").config_path(home)
}

fn yget(text: &str, path: &[&str]) -> Option<String> {
    tw_adopt::yaml::get(text, path).unwrap()
}

#[test]
fn adopting_hermes_points_its_model_section_at_the_gateway_and_restores_byte_for_byte() {
    let b = bed("hermes-agent", HERMES);
    let c = client("hermes-agent");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    assert!(p.carries_secret);
    apply(&c, &p, &b.backups).unwrap();
    let after = read(&hermes_path(&b.home));
    assert_eq!(
        yget(&after, &["model", "provider"]).as_deref(),
        Some("custom")
    );
    assert_eq!(
        yget(&after, &["model", "base_url"]).as_deref(),
        Some("http://127.0.0.1:8080/v1")
    );
    assert_eq!(
        yget(&after, &["model", "api_key"]).as_deref(),
        Some("tw-用户的专属密钥")
    );
    // 选着的模型网关没有：用清单里的第一个，Claude 走 Messages
    assert_eq!(
        yget(&after, &["model", "default"]).as_deref(),
        Some("claude-sonnet")
    );
    assert_eq!(
        yget(&after, &["model", "api_mode"]).as_deref(),
        Some("anthropic_messages")
    );
    // 注释、版本号、MCP 一样不少
    assert!(after.contains("# Default model to use"), "{after}");
    assert!(after.contains("_config_version: 49"), "{after}");
    assert!(after.contains("ghp_我自己的"), "{after}");
    let d = tw_adopt::detect::detect_one(&c, &b.home);
    assert_eq!(d.endpoint.as_deref(), Some("http://127.0.0.1:8080/v1"));

    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&hermes_path(&b.home)), HERMES);
}

/// 只改默认的 profile：别的 profile 在、粘住了别的 profile、`.env` 里写了
/// `CUSTOM_BASE_URL`，都在确认之前说
#[test]
fn hermes_profiles_and_an_overriding_env_file_are_stated_before_confirming() {
    let b = bed("hermes-agent", HERMES);
    let c = client("hermes-agent");
    let dir = hermes_path(&b.home).parent().unwrap().to_path_buf();
    std::fs::create_dir_all(dir.join("profiles/work")).unwrap();
    std::fs::write(dir.join("profiles/work/config.yaml"), "model: {}\n").unwrap();
    std::fs::write(dir.join("active_profile"), "work\n").unwrap();
    std::fs::write(
        dir.join(".env"),
        "CUSTOM_BASE_URL=https://relay.example.com/v1\n",
    )
    .unwrap();
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    let codes: Vec<_> = p.notes.iter().map(|n| n.code.as_str()).collect();
    assert!(
        codes.contains(&"adopt.plan.hermes_agent.other_profiles"),
        "{codes:?}"
    );
    assert!(
        codes.contains(&"adopt.plan.hermes_agent.active_profile"),
        "{codes:?}"
    );
    assert!(codes.contains(&"adopt.plan.shadowed"), "{codes:?}");
    assert_eq!(p.shadows, vec![dir.join(".env")]);
    // 别的 profile 一个字节都不动
    assert_eq!(read(&dir.join("profiles/work/config.yaml")), "model: {}\n");

    apply(&c, &p, &b.backups).unwrap();
    let f = tw_adopt::detect::diagnose(&c, &b.home, None, &Around::default());
    assert!(
        f.iter()
            .any(|x| x.title.code == "adopt.diag.hermes_agent.active_profile"),
        "{f:?}"
    );
    let shadow = f
        .iter()
        .find(|x| x.title.code == "adopt.diag.shadowed")
        .expect("`.env` 里的 CUSTOM_BASE_URL 要报");
    assert_eq!(shadow.detail.arg("fields"), "CUSTOM_BASE_URL");
}

/// 还没有 config.yaml：建出来，还原时它空了就收走
#[test]
fn a_hermes_config_created_here_is_removed_again() {
    let b = bed("hermes-agent", "");
    let c = client("hermes-agent");
    let p = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    assert!(hermes_path(&b.home).exists());
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert!(!hermes_path(&b.home).exists());
}

/// 老写法 `model: "名字"`（一个字符串，不是一节）：往下面写不进去，**什么都不改、说出来**，
/// 而不是把这一行改坏
#[test]
fn a_hermes_model_written_as_a_plain_string_is_refused_without_a_change() {
    let old = "model: \"anthropic/claude-opus-4.6\"\n";
    let b = bed("hermes-agent", old);
    let c = client("hermes-agent");
    let e = plan_adopt(&c, &b.home, &gw(), &Around::default()).unwrap_err();
    assert_eq!(e.msg().code, "adopt.plan.parse_failed", "{e}");
    assert_eq!(read(&hermes_path(&b.home)), old);
}
