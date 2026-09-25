//! 接管一次，再还原一次，用户的文件必须**一个字节都没变**。
//!
//! 这是整个 tw-adopt 唯一真正要证明的事。cc-switch 那批最集中的 issue
//! （#6902 把 23 个顶层键写剩 1 个、#6901 擦掉第三方 hooks、#6871 删掉
//! `enabledPlugins`）全都可以被这一条测出来。

use std::path::{Path, PathBuf};

use tw_adopt::clients::{Gateway, adoptable};
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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

    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
        let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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

// ---- Aider：YAML ------------------------------------------------------

const AIDER: &str = "# 我的 aider 配置\nmodel: gpt-4o\ndark-mode: true\nauto-commits: false\n";

#[test]
fn aider_round_trips_too() {
    let b = bed("aider", AIDER);
    let c = client("aider");
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let again = plan_adopt(&c, &b.home, &gw()).unwrap();
    assert!(again.is_noop(), "第二次接管应该是空操作");
    // 换一把密钥再接管一次，还原回的仍然是用户原来那一份
    let other = Gateway {
        base: "http://127.0.0.1:9090".into(),
        key: Some("tw-换过的".into()),
        models: Vec::new(),
    };
    let p = plan_adopt(&c, &b.home, &other).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
    assert_eq!(read(&dsh_home(&b).join("cordis.patch.yml")), DSH_PATCH);
    assert_eq!(read(&dsh_home(&b).join(".credentials.yaml")), DSH_CREDS);
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
        let p = plan_adopt(&c, &b.home, &gw()).unwrap();
        apply(&c, &p, &b.backups).unwrap();
        assert!(read(&dsh_home(&b).join(".credentials.yaml")).contains("THINKWATCH_API_KEY"));

        let r = plan_restore(&c, &b.home).unwrap();
        apply_restore(&c, &r, &b.backups).unwrap();
        assert_eq!(read(&dsh_home(&b).join("cordis.patch.yml")), patch);
        assert_eq!(read(&dsh_home(&b).join(".credentials.yaml")), creds);
    }
}

/// 接管期间用户在我们那一行后面加了一条 `insert:`：还原照样过得去，那一条留着
#[test]
fn dsh_restores_with_a_row_the_user_added_after_ours() {
    let b = bed("dsh", "- id: a\n");
    std::fs::write(dsh_home(&b).join(".credentials.yaml"), DSH_CREDS).unwrap();
    let c = client("dsh");
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    assert!(plan_adopt(&c, &b.home, &gw()).is_err());
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
    assert!(plan_adopt(&c, &b.home, &gw()).unwrap().shadows.is_empty());
    // 0.1.5 的设置页写了 baseURL：它压过补丁层
    std::fs::write(
        &settings,
        "llm-deepseek:\n  baseURL: https://api.deepseek.com\n",
    )
    .unwrap();
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
    assert_eq!(p.shadows, vec![settings.clone()]);
    assert!(p.notes.iter().any(|n| n.code == "adopt.plan.shadowed"));
    // 0.1.7 导入之后改了名，就不再读它了
    std::fs::rename(&settings, dsh_home(&b).join("settings.yaml.imported")).unwrap();
    assert!(plan_adopt(&c, &b.home, &gw()).unwrap().shadows.is_empty());
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
        let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
        let p = plan_adopt(&c, &b.home, &g).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
    apply(&c, &p, &b.backups).unwrap();
    let again = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
        let p = plan_adopt(&c, &b.home, &g).unwrap();
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
        let p = plan_adopt(&c, &b.home, &g).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    assert_eq!(
        d.models,
        Some(vec!["claude-sonnet".to_string(), "gpt-5".to_string()])
    );

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
            models: models.into_iter().map(str::to_string).collect(),
            ..gw()
        };
        let p = plan_adopt(&c, &b.home, &g).unwrap();
        apply(&c, &p, &b.backups).unwrap();
    }
    let d = tw_adopt::detect::detect_one(&c, &b.home);
    assert_eq!(d.models, Some(vec!["a".to_string(), "b".to_string()]));

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
    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
    apply(&c, &p, &b.backups).unwrap();

    let path = opencode_path(&b.home);
    let native = tw_adopt::json::set(
        &read(&path),
        &["providers", "thinkwatch"],
        &Val::Obj(vec![("name".into(), Val::s("ThinkWatch"))]),
    )
    .unwrap();
    std::fs::write(&path, native).unwrap();

    let p = plan_adopt(&c, &b.home, &gw()).unwrap();
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
    let p = plan_adopt(&c, &b.home, &g).unwrap();
    assert!(
        p.notes.iter().any(|n| n.code == "adopt.plan.no_models"),
        "{:?}",
        p.notes
    );
    let with = plan_adopt(&c, &b.home, &gw()).unwrap();
    assert!(!with.notes.iter().any(|n| n.code == "adopt.plan.no_models"));
}
