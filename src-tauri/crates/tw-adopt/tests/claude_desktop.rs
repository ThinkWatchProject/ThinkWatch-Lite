//! Claude Desktop：一次接管改四个文件，还原之后**四个都要一个字节不差**。
//!
//! 目录结构按跑测试的那个平台造（macOS 的 `Application Support`、Windows 的
//! 本地和漫游 AppData、Linux 的 `~/.config`）—— CI 在三个平台上各跑一遍，三种
//! 结构就都走到了。

use std::path::{Path, PathBuf};

use tw_adopt::clients::{Client, Gateway, adoptable};
use tw_adopt::desktop::{self, PROFILE_ID};
use tw_adopt::plan::{PlanError, apply, apply_restore, plan_adopt, plan_restore};

fn gw() -> Gateway {
    Gateway {
        base: "http://127.0.0.1:8080".into(),
        key: Some("tw-桌面版的专属密钥".into()),
        models: Vec::new(),
    }
}

fn client() -> Client {
    adoptable()
        .into_iter()
        .find(|c| c.id == desktop::ID)
        .unwrap()
}

struct Bed {
    _dir: tempfile::TempDir,
    home: PathBuf,
    backups: PathBuf,
}

/// 一台装着 Claude Desktop 的机器：平常那个数据目录在，里面的配置有 MCP
/// 服务器和别的键；第三方模式的目录还没有。
fn bed() -> Bed {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    write(&desktop::first_party_config(&home), FIRST);
    Bed {
        backups: dir.path().join("backups"),
        home,
        _dir: dir,
    }
}

fn write(p: &Path, text: &str) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
}

fn read(p: &Path) -> String {
    std::fs::read_to_string(p).unwrap()
}

/// 有生活痕迹的一份：MCP 服务器、窗口偏好。MCP 页改的就是这个文件
const FIRST: &str = r#"{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "~/Documents"] }
  },
  "globalShortcut": "Alt+Space"
}
"#;

fn json(p: &Path) -> serde_json::Value {
    serde_json::from_str(&read(p)).unwrap()
}

fn adopt(b: &Bed, models: Option<&[String]>) {
    let c = client();
    let p = desktop::plan_adopt_in(&c, &b.home, &gw(), models, None).unwrap();
    apply(&c, &p, &b.backups).unwrap();
}

fn restore(b: &Bed) {
    let c = client();
    let r = plan_restore(&c, &b.home).unwrap();
    apply_restore(&c, &r, &b.backups).unwrap();
}

fn names(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn adopting_writes_the_profile_registers_it_and_switches_both_modes() {
    let b = bed();
    adopt(
        &b,
        Some(&names(&[
            "deepseek-chat",
            "claude-sonnet-5",
            "claude-opus-5",
        ])),
    );

    let profile = json(&desktop::profile_path(&b.home));
    assert_eq!(profile["inferenceProvider"], "gateway");
    assert_eq!(profile["inferenceGatewayBaseUrl"], "http://127.0.0.1:8080");
    assert_eq!(profile["inferenceGatewayApiKey"], "tw-桌面版的专属密钥");
    assert_eq!(profile["inferenceGatewayAuthScheme"], "x-api-key");
    assert_eq!(profile["chatTabEnabled"], true);
    // 只留它收的名字，顺序照网关给的：第一个是默认模型
    assert_eq!(
        profile["inferenceModels"],
        serde_json::json!(["claude-sonnet-5", "claude-opus-5"])
    );
    // 不属于「指向网关」的两个键不写
    assert!(profile.get("disableDeploymentModeChooser").is_none());
    assert!(profile.get("coworkEgressAllowedHosts").is_none());

    let meta = json(&desktop::meta_path(&b.home));
    assert_eq!(meta["appliedId"], PROFILE_ID);
    assert_eq!(
        meta["entries"],
        serde_json::json!([{ "id": PROFILE_ID, "name": "ThinkWatch" }])
    );

    for p in [
        desktop::first_party_config(&b.home),
        desktop::third_party_config(&b.home),
    ] {
        assert_eq!(json(&p)["deploymentMode"], "3p", "{}", p.display());
    }
    // 平常那一份只多了这一个键：MCP 服务器和别的键原样
    let first = read(&desktop::first_party_config(&b.home));
    assert!(first.contains("server-filesystem"), "{first}");
    assert!(
        first.contains("\"globalShortcut\": \"Alt+Space\""),
        "{first}"
    );

    // 配置库里只有应用自己的两种文件：我们那一份和 _meta.json。记录放在上一层
    let lib = desktop::meta_path(&b.home).parent().unwrap().to_path_buf();
    let mut in_lib: Vec<_> = std::fs::read_dir(&lib)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    in_lib.sort();
    assert_eq!(
        in_lib,
        vec![format!("{PROFILE_ID}.json"), "_meta.json".into()]
    );

    // 客户端页读得出它接管着、指着哪儿
    let d = tw_adopt::detect::detect_one(&client(), &b.home);
    assert!(d.installed);
    assert!(d.adopted_at_ms.is_some());
    assert_eq!(d.endpoint.as_deref(), Some("http://127.0.0.1:8080"));
}

#[test]
fn restoring_puts_every_file_back_byte_for_byte() {
    let b = bed();
    // 第三方模式的目录也用过：有自己的配置，没有 deploymentMode
    let third = r#"{ "mcpServers": {}, "zoomLevel": 1.25 }"#;
    write(&desktop::third_party_config(&b.home), third);

    adopt(&b, Some(&names(&["claude-sonnet-5"])));
    restore(&b);

    assert_eq!(read(&desktop::first_party_config(&b.home)), FIRST);
    assert_eq!(read(&desktop::third_party_config(&b.home)), third);
    // 我们建的都收走：那一份配置、_meta.json、所有记录
    assert!(!desktop::profile_path(&b.home).exists());
    assert!(!desktop::meta_path(&b.home).exists());
    let leftovers: Vec<_> = walk(&b.home)
        .into_iter()
        .filter(|p| p.to_string_lossy().contains(".thinkwatch.json"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
    assert!(
        tw_adopt::detect::detect_one(&client(), &b.home)
            .adopted_at_ms
            .is_none()
    );
}

#[test]
fn a_deployment_mode_that_was_there_goes_back_to_its_old_value() {
    let b = bed();
    let first = "{\n  \"deploymentMode\": \"1p\",\n  \"mcpServers\": {}\n}\n";
    write(&desktop::first_party_config(&b.home), first);
    adopt(&b, None);
    assert_eq!(
        json(&desktop::first_party_config(&b.home))["deploymentMode"],
        "3p"
    );
    restore(&b);
    assert_eq!(read(&desktop::first_party_config(&b.home)), first);
}

#[test]
fn adopting_twice_changes_nothing_and_still_restores_to_the_original() {
    let b = bed();
    let models = names(&["claude-sonnet-5"]);
    adopt(&b, Some(&models));

    let c = client();
    let again = desktop::plan_adopt_in(&c, &b.home, &gw(), Some(&models), None).unwrap();
    assert!(again.is_noop(), "第二次接管应该是空操作");

    // 换了一把钥匙、换了网关地址再接管一次（更换密钥之后的同步走的就是这条，
    // 不问模型）：模型列表留着，原值仍是第一次之前的
    let g = Gateway {
        base: "http://127.0.0.1:9090".into(),
        key: Some("tw-换过的钥匙".into()),
        models: Vec::new(),
    };
    let p = plan_adopt(&c, &b.home, &g).unwrap();
    assert!(!p.is_noop());
    apply(&c, &p, &b.backups).unwrap();
    let profile = json(&desktop::profile_path(&b.home));
    assert_eq!(profile["inferenceGatewayApiKey"], "tw-换过的钥匙");
    assert_eq!(
        profile["inferenceModels"],
        serde_json::json!(["claude-sonnet-5"])
    );

    restore(&b);
    assert_eq!(read(&desktop::first_party_config(&b.home)), FIRST);
    assert!(!desktop::profile_path(&b.home).exists());
    assert!(!desktop::meta_path(&b.home).exists());
    assert!(!desktop::third_party_config(&b.home).exists());
}

#[test]
fn a_managed_machine_is_refused_and_nothing_is_written() {
    let b = bed();
    let c = client();
    let e = desktop::plan_adopt_in(
        &c,
        &b.home,
        &gw(),
        None,
        Some("/Library/Managed Preferences/com.anthropic.claudefordesktop.plist".into()),
    )
    .unwrap_err();
    assert!(matches!(e, PlanError::Managed { .. }), "{e}");
    assert_eq!(e.msg().code, "adopt.plan.managed");
    assert!(e.to_string().contains("managed by an organization"), "{e}");
    assert_eq!(read(&desktop::first_party_config(&b.home)), FIRST);
    assert!(!desktop::profile_path(&b.home).exists());
    assert!(!desktop::meta_path(&b.home).exists());
}

/// 用户自己在应用里建的一份，和 CC Switch 写的一份，正在用的是 CC Switch 那份
const META: &str = r#"{
  "appliedId": "00000000-0000-4000-8000-000000157210",
  "entries": [
    { "id": "b1c2d3e4-0000-4000-8000-000000000001", "name": "My Bedrock" },
    { "id": "00000000-0000-4000-8000-000000157210", "name": "CC Switch" }
  ]
}
"#;

#[test]
fn other_configurations_in_the_library_are_kept_and_the_applied_one_comes_back() {
    let b = bed();
    write(&desktop::meta_path(&b.home), META);
    let theirs = r#"{"inferenceProvider":"bedrock"}"#;
    let theirs_path =
        desktop::meta_path(&b.home).with_file_name("b1c2d3e4-0000-4000-8000-000000000001.json");
    write(&theirs_path, theirs);

    adopt(&b, Some(&names(&["claude-sonnet-5"])));
    let meta = json(&desktop::meta_path(&b.home));
    assert_eq!(meta["appliedId"], PROFILE_ID);
    let ids: Vec<_> = meta["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        ids,
        vec![
            "b1c2d3e4-0000-4000-8000-000000000001".to_string(),
            "00000000-0000-4000-8000-000000157210".to_string(),
            PROFILE_ID.to_string()
        ]
    );
    assert_eq!(read(&theirs_path), theirs, "别人的那一份不该被碰");

    restore(&b);
    assert_eq!(read(&desktop::meta_path(&b.home)), META);
    assert_eq!(read(&theirs_path), theirs);
}

#[test]
fn if_the_old_applied_configuration_is_gone_the_next_one_takes_over() {
    let b = bed();
    write(&desktop::meta_path(&b.home), META);
    adopt(&b, None);

    // 接管期间用户在应用里删掉了 CC Switch 那一份
    let meta = desktop::meta_path(&b.home);
    let text = read(&meta).replace(
        ",\n    { \"id\": \"00000000-0000-4000-8000-000000157210\", \"name\": \"CC Switch\" }",
        "",
    );
    std::fs::write(&meta, &text).unwrap();
    assert!(!text.contains("CC Switch"), "{text}");

    restore(&b);
    let after = json(&meta);
    assert_eq!(after["appliedId"], "b1c2d3e4-0000-4000-8000-000000000001");
    assert_eq!(after["entries"].as_array().unwrap().len(), 1);
}

#[test]
fn a_configuration_switched_in_the_app_is_left_as_the_user_chose() {
    let b = bed();
    write(&desktop::meta_path(&b.home), META);
    adopt(&b, None);
    let meta = desktop::meta_path(&b.home);
    let text = read(&meta).replace(
        &format!("\"appliedId\": \"{PROFILE_ID}\""),
        "\"appliedId\": \"b1c2d3e4-0000-4000-8000-000000000001\"",
    );
    std::fs::write(&meta, &text).unwrap();

    restore(&b);
    let after = json(&meta);
    assert_eq!(after["appliedId"], "b1c2d3e4-0000-4000-8000-000000000001");
    assert!(!read(&meta).contains(PROFILE_ID));
}

#[test]
fn without_a_claude_model_the_fallback_is_written_and_the_rule_is_spelled_out() {
    let b = bed();
    let c = client();
    let p = desktop::plan_adopt_in(
        &c,
        &b.home,
        &gw(),
        Some(&names(&["deepseek-chat", "gpt-5"])),
        None,
    )
    .unwrap();
    let note = p
        .notes
        .iter()
        .find(|n| n.code == "adopt.plan.claude_desktop.no_claude_model")
        .expect("没有说要加一条规则");
    assert!(
        note.text.contains("set: { model: deepseek-chat }"),
        "{note}"
    );
    assert!(note.text.contains(desktop::FALLBACK_MODEL), "{note}");
    apply(&c, &p, &b.backups).unwrap();
    assert_eq!(
        json(&desktop::profile_path(&b.home))["inferenceModels"],
        serde_json::json!([desktop::FALLBACK_MODEL])
    );
}

#[test]
fn the_plan_names_all_four_files_and_the_costs_before_anything_is_written() {
    let b = bed();
    let c = client();
    let p = desktop::plan_adopt_in(&c, &b.home, &gw(), None, None).unwrap();
    let mut files = vec![p.path.clone()];
    files.extend(p.also.iter().map(|a| a.path.clone()));
    assert_eq!(
        files,
        vec![
            desktop::profile_path(&b.home),
            desktop::meta_path(&b.home),
            desktop::third_party_config(&b.home),
            desktop::first_party_config(&b.home),
        ]
    );
    assert!(p.carries_secret);
    assert!(p.also.iter().all(|a| !a.carries_secret), "密钥只进主文件");
    for code in [
        "adopt.cost.claude_desktop.restart",
        "adopt.cost.claude_desktop.sign_in",
        "adopt.cost.claude_desktop.separate_history",
        "adopt.cost.claude_desktop.web_search",
    ] {
        assert!(p.notes.iter().any(|n| n.code == code), "{code}");
    }
    // 只是算了一下，什么都没写
    assert_eq!(read(&desktop::first_party_config(&b.home)), FIRST);
    assert!(!desktop::profile_path(&b.home).exists());
}

#[test]
fn a_failure_halfway_leaves_every_file_as_it_was() {
    let b = bed();
    let c = client();
    let p = desktop::plan_adopt_in(&c, &b.home, &gw(), None, None).unwrap();
    // 算完之后、落盘之前，MCP 页改了平常那一份：最后一个文件写不成
    let changed = FIRST.replace("Alt+Space", "Ctrl+Space");
    std::fs::write(desktop::first_party_config(&b.home), &changed).unwrap();
    apply(&c, &p, &b.backups).unwrap_err();

    assert_eq!(read(&desktop::first_party_config(&b.home)), changed);
    assert!(!desktop::profile_path(&b.home).exists());
    assert!(!desktop::meta_path(&b.home).exists());
    assert!(!desktop::third_party_config(&b.home).exists());
    let leftovers: Vec<_> = walk(&b.home)
        .into_iter()
        .filter(|p| p.to_string_lossy().contains(".thinkwatch.json"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

/// MCP 页改的是同一个 `claude_desktop_config.json`：接管前后都能复制、移除
/// server，还原也不会把期间加的 server 弄丢。
#[test]
fn the_mcp_page_keeps_working_on_the_same_file() {
    use tw_adopt::mcp;
    let b = bed();
    let t = mcp::target("claude-desktop").unwrap();
    assert_eq!(t.path(&b.home), desktop::first_party_config(&b.home));

    adopt(&b, None);
    let server = mcp::read_server(&t, &b.home, "filesystem").unwrap();
    let p = mcp::plan_copy(&t, &b.home, "fs-copy", &server).unwrap();
    mcp::apply(&t, &p, &b.backups).unwrap();
    let p = mcp::plan_remove(&t, &b.home, "filesystem").unwrap();
    mcp::apply(&t, &p, &b.backups).unwrap();
    let now = json(&desktop::first_party_config(&b.home));
    assert_eq!(
        now["deploymentMode"], "3p",
        "MCP 页的改动带走了 deploymentMode"
    );
    assert!(now["mcpServers"]["fs-copy"].is_object());

    restore(&b);
    let now = json(&desktop::first_party_config(&b.home));
    assert!(now.get("deploymentMode").is_none());
    assert!(
        now["mcpServers"]["fs-copy"].is_object(),
        "还原把 MCP 页加的 server 弄丢了"
    );
    assert!(now["mcpServers"].get("filesystem").is_none());
    assert_eq!(now["globalShortcut"], "Alt+Space");
}

#[test]
fn the_directories_are_where_each_platform_keeps_them() {
    let home = Path::new("/h");
    let first = desktop::first_party_config(home);
    let lib = desktop::meta_path(home);
    if cfg!(windows) {
        assert!(first.ends_with(r"AppData\Roaming\Claude\claude_desktop_config.json"));
        assert!(lib.ends_with(r"AppData\Local\Claude-3p\configLibrary\_meta.json"));
    } else if cfg!(target_os = "macos") {
        assert!(first.ends_with("Library/Application Support/Claude/claude_desktop_config.json"));
        assert!(lib.ends_with("Library/Application Support/Claude-3p/configLibrary/_meta.json"));
    } else {
        assert!(first.ends_with("Claude/claude_desktop_config.json"));
        assert!(lib.ends_with("Claude-3p/configLibrary/_meta.json"));
    }
    // MCP 页和接管改的是同一个文件
    assert_eq!(first, tw_adopt::paths::CLAUDE_DESKTOP_CONFIG.resolve(home));
}

#[test]
fn it_counts_as_installed_when_either_directory_is_there() {
    for dir in [desktop::FIRST_PARTY_DIR, desktop::THIRD_PARTY_DIR] {
        let d = tempfile::tempdir().unwrap();
        assert!(!tw_adopt::detect::detect_one(&client(), d.path()).installed);
        std::fs::create_dir_all(dir.resolve(d.path())).unwrap();
        assert!(tw_adopt::detect::detect_one(&client(), d.path()).installed);
    }
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                out.extend(walk(&p));
            } else {
                out.push(p);
            }
        }
    }
    out
}
