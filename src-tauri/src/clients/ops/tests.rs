use super::*;

pub(crate) fn key(name: &str, value: &str, client: Option<&str>, default: bool) -> ClientView {
    ClientView {
        name: name.into(),
        key: value.into(),
        max_concurrent: None,
        route: None,
        allow: None,
        client: client.map(str::to_string),
        disabled: false,
        default,
        last_seen_ms: None,
        limits: vec![],
        unpriced_models: vec![],
    }
}

fn gw(keys: Vec<ClientView>) -> Gateway {
    Gateway {
        base: "http://127.0.0.1:8788".into(),
        keys,
    }
}

/// 备份放在这台假机器里，**不碰开发者自己的数据目录**
fn backups(home: &tempfile::TempDir) -> std::path::PathBuf {
    home.path().join("backups")
}

/// 一台装了 Claude Code 的机器：`~/.claude/` 在，配置文件还没有
fn home_with_claude() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(d.path().join(".claude")).unwrap();
    d
}

#[test]
fn listing_says_which_clients_are_here_and_which_are_only_advice() {
    let home = home_with_claude();
    let r = list(
        home.path(),
        &backups(&home),
        &gw(vec![key("default", "tw-d", None, true)]),
        &BTreeMap::new(),
    );
    let cc = r.clients.iter().find(|c| c.id == "claude-code").unwrap();
    assert!(cc.installed);
    assert_eq!(cc.adopted_at_ms, None);
    assert!(r.manual.iter().any(|m| m.id == "cursor"));
    assert_eq!(r.gateway_base, "http://127.0.0.1:8788");
    assert_eq!(r.keys, vec!["default"]);
}

/// 「使用中」按那把密钥算：为它生成的密钥被用过，就是它被用过
#[test]
fn in_use_is_read_off_the_clients_own_key() {
    let home = home_with_claude();
    let mut mine = key("claude-code", "tw-c", Some("claude-code"), false);
    mine.last_seen_ms = Some(42);
    let r = list(
        home.path(),
        &backups(&home),
        &gw(vec![key("default", "tw-d", None, true), mine]),
        &BTreeMap::new(),
    );
    let cc = r.clients.iter().find(|c| c.id == "claude-code").unwrap();
    assert_eq!(cc.key.as_deref(), Some("claude-code"));
    assert_eq!(cc.last_seen_ms, Some(42));
    let cursor = r.manual.iter().find(|m| m.id == "cursor").unwrap();
    assert_eq!(cursor.key, None);
    assert_eq!(cursor.last_seen_ms, None);
}

/// 手动配置给出的字段就是接管时写的那几项，密钥那一项不给值
#[test]
fn every_client_says_how_to_connect_it_by_hand_without_the_key() {
    let home = tempfile::tempdir().unwrap();
    let r = list(
        home.path(),
        &backups(&home),
        &gw(vec![key("default", "tw-d", None, true)]),
        &BTreeMap::new(),
    );
    let cc = r.clients.iter().find(|c| c.id == "claude-code").unwrap();
    assert!(!cc.manual.fields.is_empty());
    assert!(
        cc.manual
            .fields
            .iter()
            .any(|f| f.secret && f.value.is_none())
    );
    let json = serde_json::to_string(&r).unwrap();
    assert!(!json.contains("tw-d"), "{json}");
}

#[test]
fn planning_writes_nothing_and_never_echoes_the_key() {
    let home = home_with_claude();
    let p = plan_adopt(
        home.path(),
        "claude-code",
        &gw(vec![key("default", "tw-secret-value", None, true)]),
        Vec::new(),
        &Around::default(),
    )
    .unwrap();
    assert!(!home.path().join(".claude/settings.json").exists());
    assert!(!p.after.contains("tw-secret-value"), "{}", p.after);
    assert!(p.after.contains(MASK));
    // 还没有为它留着的：确认之前就说要新建一把，叫什么
    assert_eq!(p.key.as_deref(), Some("claude-code"));
    assert!(p.key_created);
}

/// 为它留着一把的，接着用那一把；名字被别的占了就往后编号
#[test]
fn the_plan_says_which_key_goes_in_and_whether_it_is_made_now() {
    let home = home_with_claude();
    let kept = plan_adopt(
        home.path(),
        "claude-code",
        &gw(vec![
            key("default", "tw-d", None, true),
            key("mine", "tw-m", Some("claude-code"), false),
        ]),
        Vec::new(),
        &Around::default(),
    )
    .unwrap();
    assert_eq!(kept.key.as_deref(), Some("mine"));
    assert!(!kept.key_created);

    let taken = plan_adopt(
        home.path(),
        "claude-code",
        &gw(vec![
            key("default", "tw-d", None, true),
            key("claude-code", "tw-x", None, false),
        ]),
        Vec::new(),
        &Around::default(),
    )
    .unwrap();
    assert_eq!(taken.key.as_deref(), Some("claude-code-2"));
    assert!(taken.key_created);
}

#[test]
fn without_any_key_there_is_nothing_to_point_a_client_with() {
    let home = home_with_claude();
    let e = plan_adopt(
        home.path(),
        "claude-code",
        &gw(Vec::new()),
        Vec::new(),
        &Around::default(),
    )
    .unwrap_err();
    assert_eq!(e.code, "control.no_keys");
}

#[test]
fn a_client_we_do_not_know_is_refused_by_name() {
    let home = tempfile::tempdir().unwrap();
    let e = plan_adopt(
        home.path(),
        "../etc",
        &gw(Vec::new()),
        Vec::new(),
        &Around::default(),
    )
    .unwrap_err();
    assert_eq!(e.code, "control.client_unknown");
    assert!(!known("../etc"));
    assert!(known("claude-code") && known("cursor"));
}

/// `/setup-bedrock` 把 Bedrock 的 API key、访问密钥写在 settings.json 的 `env` 里：
/// diff 画的是整份文件，它们一律打码；区域、开关这些照常显示
#[test]
fn aws_credentials_in_claude_codes_env_never_show_in_the_diff() {
    let home = home_with_claude();
    let settings = home.path().join(".claude/settings.json");
    std::fs::write(
        &settings,
        r#"{ "env": {
  "CLAUDE_CODE_USE_BEDROCK": "1",
  "AWS_REGION": "us-west-2",
  "AWS_BEARER_TOKEN_BEDROCK": "ABSKQmVkcm9ja0FQSUtleS1leGFtcGxl",
  "AWS_ACCESS_KEY_ID": "AKIAIOSFODNN7EXAMPLE",
  "AWS_SECRET_ACCESS_KEY": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
} }"#,
    )
    .unwrap();
    let secrets = [
        "ABSKQmVkcm9ja0FQSUtleS1leGFtcGxl",
        "AKIAIOSFODNN7EXAMPLE",
        "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    ];
    let p = plan_adopt(
        home.path(),
        "claude-code",
        &gw(vec![key("default", "tw-new", None, true)]),
        Vec::new(),
        &Around::default(),
    )
    .unwrap();
    for text in [p.before.as_deref().unwrap(), p.after.as_str()] {
        for s in secrets {
            assert!(!text.contains(s), "{s} shows in:\n{text}");
        }
        assert!(text.contains("us-west-2"), "{text}");
    }
    assert!(
        p.after.contains("\"CLAUDE_CODE_USE_BEDROCK\": \"\""),
        "{}",
        p.after
    );
    assert!(
        p.fields
            .iter()
            .any(|f| f.path == "env.CLAUDE_CODE_USE_BEDROCK" && f.value.as_deref() == Some("")),
        "{:?}",
        p.fields
    );
    // 交给界面的整份（说明、新建上游的草稿）里也没有：草稿里只有变量引用
    let sent = serde_json::to_string(&p).unwrap();
    for s in secrets {
        assert!(!sent.contains(s), "{s} goes to the UI:\n{sent}");
    }
    assert!(
        matches!(&p.bedrock, Some(d) if d.region == "us-west-2"
            && matches!(&d.auth, wire::DraftAuth::Key { key } if key == "${AWS_BEARER_TOKEN_BEDROCK}")),
        "{:?}",
        p.bedrock
    );

    adopt(
        home.path(),
        &backups(&home),
        "claude-code",
        &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-new", Vec::new()),
        Some(&p.digest),
        &Around::default(),
    )
    .unwrap();
    let r = plan_restore(home.path(), "claude-code", &[]).unwrap();
    for text in [r.before.as_deref().unwrap(), r.after.as_str()] {
        for s in secrets {
            assert!(!text.contains(s), "{s} shows in:\n{text}");
        }
    }
}

/// Grok Build 一个模型一张表，整张表算密钥：字段列表里不给值，diff 里网关那把打码；
/// 用户自己那张表里发给别家的 `api_key`、Qwen Code `/auth` 写在 `env` 里的密钥，diff 里
/// 同样看不到
#[test]
fn grok_and_qwen_diffs_show_no_key_of_anyone() {
    let home = tempfile::tempdir().unwrap();
    let grok = tw_adopt::paths::GROK_CONFIG.resolve(home.path());
    std::fs::create_dir_all(grok.parent().unwrap()).unwrap();
    std::fs::write(
        &grok,
        "[model.mine]\nmodel = \"x\"\nbase_url = \"https://api.example.com/v1\"\napi_key = \"sk-mine-0123456789\"\n",
    )
    .unwrap();
    let qwen = tw_adopt::paths::QWEN_SETTINGS.resolve(home.path());
    std::fs::create_dir_all(qwen.parent().unwrap()).unwrap();
    std::fs::write(
        &qwen,
        r#"{ "env": { "DASHSCOPE_API_KEY": "sk-dash-0123456789" } }"#,
    )
    .unwrap();
    let g = gw(vec![key("default", "tw-secret-value", None, true)]);
    let models: Vec<ModelCard> = vec!["claude-sonnet-5".into(), "gpt-5.5".into()];
    for (id, theirs) in [
        ("grok-build", "sk-mine-0123456789"),
        ("qwen-code", "sk-dash-0123456789"),
    ] {
        let p = plan_adopt(home.path(), id, &g, models.clone(), &Around::default()).unwrap();
        for text in [p.before.as_deref().unwrap(), p.after.as_str()] {
            assert!(!text.contains(theirs), "{id}: {text}");
            assert!(!text.contains("tw-secret-value"), "{id}: {text}");
        }
        assert!(p.after.contains(MASK), "{id}: {}", p.after);
        let sent = serde_json::to_string(&p).unwrap();
        assert!(!sent.contains("tw-secret-value"), "{id}: {sent}");
    }
    let p = plan_adopt(home.path(), "grok-build", &g, models, &Around::default()).unwrap();
    let table = p
        .fields
        .iter()
        .find(|f| f.path == "model.thinkwatch/gpt-5.5")
        .expect("一个模型一张表");
    assert!(table.secret && table.value.is_none(), "{table:?}");
    assert!(
        p.fields
            .iter()
            .any(|f| f.path == "models.default" && f.value.is_some()),
        "{:?}",
        p.fields
    );
}

/// 关哪几个开关还看 shell 配置和用户环境：确认框和落盘之间那边变了，写下去的就会多
/// 一项确认框里没有的改动 —— 当成「改过了」，什么都不写
#[test]
fn a_switch_that_appears_after_the_review_stops_the_write() {
    let home = home_with_claude();
    let settings = home.path().join(".claude/settings.json");
    std::fs::write(&settings, "{}\n").unwrap();
    let g = gw(vec![key("default", "tw-new", None, true)]);
    let reviewed = plan_adopt(
        home.path(),
        "claude-code",
        &g,
        Vec::new(),
        &Around::default(),
    )
    .unwrap();
    let later = Around {
        env: [("CLAUDE_CODE_USE_BEDROCK".to_string(), "1".to_string())].into(),
        ..Default::default()
    };
    let e = adopt(
        home.path(),
        &backups(&home),
        "claude-code",
        &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-new", Vec::new()),
        Some(&reviewed.digest),
        &later,
    )
    .unwrap_err();
    assert_eq!(e.code, "adopt.plan.stale");
    assert_eq!(std::fs::read_to_string(&settings).unwrap(), "{}\n");
}

#[test]
fn adopt_then_restore_puts_the_users_file_back_and_masks_their_key() {
    let home = home_with_claude();
    let settings = home.path().join(".claude/settings.json");
    let original = r#"{ "env": { "ANTHROPIC_BASE_URL": "https://example.com", "ANTHROPIC_AUTH_TOKEN": "users-own" } }"#;
    std::fs::write(&settings, original).unwrap();

    // 接管的 diff：被换下来的是用户自己的那把，改之前那一栏里也不能有它
    let p = plan_adopt(
        home.path(),
        "claude-code",
        &gw(vec![key("default", "tw-new", None, true)]),
        Vec::new(),
        &Around::default(),
    )
    .unwrap();
    let before = p.before.as_deref().unwrap();
    assert!(!before.contains("users-own"), "{before}");
    assert!(before.contains(HIDDEN), "{before}");
    assert!(
        p.after.contains(MASK) && !p.after.contains("tw-new"),
        "{}",
        p.after
    );
    // 不是密钥的照常显示
    assert!(before.contains("https://example.com"), "{before}");

    let a = adopt(
        home.path(),
        &backups(&home),
        "claude-code",
        &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-new", Vec::new()),
        None,
        &Around::default(),
    )
    .unwrap();
    assert_eq!(a.takes_effect, wire::TakesEffect::Immediately);
    let written = std::fs::read_to_string(&settings).unwrap();
    assert!(written.contains("tw-new") && written.contains("127.0.0.1:8788"));
    assert!(
        adopted(home.path(), &backups(&home))
            .iter()
            .any(|c| c.id == "claude-code")
    );

    let keys = vec![key("claude-code", "tw-new", Some("claude-code"), false)];
    let p = plan_restore(home.path(), "claude-code", &keys).unwrap();
    assert!(!p.before.as_deref().unwrap().contains("tw-new"));
    assert_eq!(p.key.as_deref(), Some("claude-code"));
    // 用户自己的那把正要被写回去：它也不出现在 diff 里
    assert!(!p.after.contains("tw-new"));
    assert!(!p.after.contains("users-own"), "{}", p.after);
    // core 不在（拿不到密钥清单）时，网关那把照样盖得住：它在密钥字段上
    let offline = plan_restore(home.path(), "claude-code", &[]).unwrap();
    assert!(!offline.before.as_deref().unwrap().contains("tw-new"));
    assert!(!offline.after.contains("users-own"), "{}", offline.after);

    restore(home.path(), &backups(&home), "claude-code", None).unwrap();
    let back: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
    let want: serde_json::Value = serde_json::from_str(original).unwrap();
    assert_eq!(back, want);
    assert!(adopted(home.path(), &backups(&home)).is_empty());
}

/// opencode 的模型清单跟网关对不上了才提示更新；顺序不算，没接管的不提示
#[test]
fn a_stale_opencode_model_list_is_flagged_on_the_listing() {
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(home.path().join(".config/opencode")).unwrap();
    let keys = vec![key("opencode", "tw-o", Some("opencode"), false)];
    let now = |ms: &[&str]| {
        BTreeMap::from([(
            "opencode".to_string(),
            ms.iter().map(|m| ModelCard::named(*m)).collect::<Vec<_>>(),
        )])
    };
    let stale = |models: &BTreeMap<String, Vec<ModelCard>>| {
        list(home.path(), &backups(&home), &gw(keys.clone()), models)
            .clients
            .into_iter()
            .find(|c| c.id == "opencode")
            .unwrap()
            .models_stale
    };
    assert!(!stale(&now(&["a"])), "没接管的没有清单可比");

    adopt(
        home.path(),
        &backups(&home),
        "opencode",
        &tw_adopt::clients::Gateway::keyed(
            "http://127.0.0.1:8788",
            "tw-o",
            vec!["a".into(), "b".into()],
        ),
        None,
        &Around::default(),
    )
    .unwrap();
    assert!(!stale(&now(&["b", "a"])));
    assert!(stale(&now(&["a", "b", "c"])));
    assert!(!stale(&BTreeMap::new()), "问不到网关就不说");

    // 手动配置那一栏照网关此刻答的写
    let r = list(
        home.path(),
        &backups(&home),
        &gw(keys.clone()),
        &now(&["m1"]),
    );
    let oc = r.clients.iter().find(|c| c.id == "opencode").unwrap();
    assert!(
        oc.manual
            .fields
            .iter()
            .any(|f| f.path == "provider.thinkwatch.models"
                && f.value.as_deref() == Some("{m1: {name: m1}}")),
        "{:?}",
        oc.manual.fields
    );
}

/// Pi 和 oh-my-pi 也把模型写进配置：清单跟网关对不上了一样提示更新；diff 里看不到密钥
#[test]
fn a_stale_pi_or_omp_model_list_is_flagged_too() {
    for id in ["pi", "omp"] {
        let home = tempfile::tempdir().unwrap();
        let keys = vec![key(id, "tw-p", Some(id), false)];
        let now = |ms: &[&str]| {
            BTreeMap::from([(
                id.to_string(),
                ms.iter().map(|m| ModelCard::named(*m)).collect::<Vec<_>>(),
            )])
        };
        let stale = |models: &BTreeMap<String, Vec<ModelCard>>| {
            list(home.path(), &backups(&home), &gw(keys.clone()), models)
                .clients
                .into_iter()
                .find(|c| c.id == id)
                .unwrap()
                .models_stale
        };
        let target = tw_adopt::clients::Gateway::keyed(
            "http://127.0.0.1:8788",
            "tw-p",
            vec!["claude-a".into(), "b".into()],
        );
        let v = plan_adopt(
            home.path(),
            id,
            &gw(keys.clone()),
            target.models.clone(),
            &Around::default(),
        )
        .unwrap();
        assert!(!v.after.contains("tw-p"), "{id}：{}", v.after);
        assert!(
            v.fields.iter().any(|f| f.secret && f.value.is_none()),
            "{id}"
        );
        adopt(
            home.path(),
            &backups(&home),
            id,
            &target,
            None,
            &Around::default(),
        )
        .unwrap();
        assert!(!stale(&now(&["b", "claude-a"])), "{id}");
        assert!(stale(&now(&["claude-a"])), "{id}");
    }
}

/// 别处的 home（WSL 里的、测试的临时目录）不带用户指定的配置文件：那份设置只管
/// 这台电脑上的
#[test]
fn a_home_other_than_this_computers_gets_the_default_files() {
    let home = home_with_claude();
    assert!(all(home.path()).iter().all(|c| c.custom_config.is_none()));
}

#[test]
fn restoring_something_we_never_adopted_refuses_instead_of_guessing() {
    let home = home_with_claude();
    assert!(restore(home.path(), &backups(&home), "claude-code", None).is_err());
}

/// 接管着的客户端的密钥删不得；它的主人是哪个，只有这台机器答得上来
#[test]
fn a_key_in_an_adopted_clients_config_is_found_by_its_owner() {
    let home = home_with_claude();
    let keys = vec![
        key("default", "tw-d", None, true),
        key("claude-code", "tw-c", Some("claude-code"), false),
    ];
    assert!(adopted_owner(home.path(), &backups(&home), &keys, "claude-code").is_none());
    adopt(
        home.path(),
        &backups(&home),
        "claude-code",
        &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-c", Vec::new()),
        None,
        &Around::default(),
    )
    .unwrap();
    let owner = adopted_owner(home.path(), &backups(&home), &keys, "claude-code").unwrap();
    assert_eq!(owner.id, "claude-code");
    assert_eq!(key_used_by(owner.name).code, "control.key_used_by_client");
    assert!(adopted_owner(home.path(), &backups(&home), &keys, "default").is_none());
}

#[test]
fn a_loopback_endpoint_is_this_machine_and_a_server_is_not() {
    for e in [
        "http://127.0.0.1:8788",
        "http://127.0.0.1:8788/v1",
        "http://localhost:8788/v1",
        "http://[::1]:8788",
    ] {
        assert!(is_loopback(e), "{e}");
    }
    for e in [
        "http://192.168.1.20:8788/v1",
        "http://nas.local:8788",
        "",
        "http://",
    ] {
        assert!(!is_loopback(e), "{e}");
    }
    assert_eq!(
        host_port("http://127.0.0.1:8788/v1"),
        Some("127.0.0.1:8788")
    );
}

/// 接管着、指着本机网关的才算；指到了服务器上的不算
#[test]
fn only_clients_pointing_at_this_machine_count() {
    let home = home_with_claude();
    std::fs::create_dir_all(home.path().join(".codex")).unwrap();
    adopt(
        home.path(),
        &backups(&home),
        "claude-code",
        &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-c", Vec::new()),
        None,
        &Around::default(),
    )
    .unwrap();
    adopt(
        home.path(),
        &backups(&home),
        "codex",
        &tw_adopt::clients::Gateway::keyed("http://192.168.1.20:8788", "tw-x", Vec::new()),
        None,
        &Around::default(),
    )
    .unwrap();
    let here: Vec<_> = adopted_on_this_machine(home.path(), &backups(&home))
        .into_iter()
        .map(|(c, e)| (c.id, e))
        .collect();
    assert_eq!(
        here,
        vec![("claude-code", "http://127.0.0.1:8788".to_string())]
    );
}

/// 一个假的 WSL 发行版：`etc/passwd` 和默认用户的 home，Claude Code 和 Codex 都装了
pub(crate) fn wsl_home() -> (tempfile::TempDir, tw_adopt::wsl::WslHome) {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("Ubuntu");
    std::fs::create_dir_all(root.join("etc")).unwrap();
    std::fs::write(
        root.join("etc/passwd"),
        "u:x:1000:1000::/home/u:/bin/bash\n",
    )
    .unwrap();
    std::fs::create_dir_all(root.join("home/u/.claude")).unwrap();
    std::fs::create_dir_all(root.join("home/u/.codex")).unwrap();
    std::fs::create_dir_all(root.join("home/u/.config/zed")).unwrap();
    let w = tw_adopt::wsl::WslHome::read(
        tw_adopt::wsl::Distro {
            name: "Ubuntu".into(),
            version: 2,
            uid: 1000,
        },
        root,
    )
    .unwrap();
    (d, w)
}

/// WSL 里只列第一批的那两个；路径写成 WSL 里的样子；密钥认的是为 WSL 里
/// 这一份发的那把，不是这台电脑上同一个客户端的那把
#[test]
fn a_wsl_distro_lists_its_own_copies_with_their_own_keys() {
    let (d, w) = wsl_home();
    let b = d.path().join("backups");
    let mut mine = key(
        "claude-code-wsl-ubuntu",
        "tw-w",
        Some("claude-code-wsl-ubuntu"),
        false,
    );
    mine.last_seen_ms = Some(7);
    let gw = Gateway {
        base: "http://127.0.0.1:8788".into(),
        keys: vec![
            key("default", "tw-d", None, true),
            key("claude-code", "tw-c", Some("claude-code"), false),
            mine,
        ],
    };
    let r = list_wsl(&w, &b, &gw);
    let ids: Vec<_> = r.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, ["claude-code", "codex"]);
    let cc = &r[0];
    assert!(cc.installed);
    assert_eq!(cc.path, "~/.claude/settings.json");
    assert_eq!(cc.key.as_deref(), Some("claude-code-wsl-ubuntu"));
    assert_eq!(cc.last_seen_ms, Some(7));
    // 手动配置给的地址和这台电脑上的一样
    assert_eq!(cc.manual.endpoint, "http://127.0.0.1:8788");
    assert_eq!(cc.manual.steps[0].arg("file"), "~/.claude/settings.json");
    assert_eq!(r[1].key, None);
    // 接管的方案：新建的那把叫 WSL 那一份的名字
    let p = plan_adopt_as(
        &w.home,
        "codex",
        "codex-wsl-ubuntu",
        &gw,
        Vec::new(),
        &Around::default(),
    )
    .unwrap();
    assert_eq!(p.key.as_deref(), Some("codex-wsl-ubuntu"));
    assert!(p.key_created);
    assert!(known("codex-wsl-ubuntu"));
}

/// WSL 1 和 mirrored 下，WSL 里的客户端写的就是 `127.0.0.1`，和这台电脑上的一样
/// （地址由 `wsl::target` 给，它交回的就是这台电脑的那一个）；还原回到原样
#[test]
fn a_wsl_copy_is_pointed_at_127_0_0_1_and_restored_to_what_it_was() {
    let (d, w) = wsl_home();
    let b = d.path().join("backups");
    let settings = w.home.join(".claude").join("settings.json");
    let original =
        r#"{ "model": "opus", "env": { "ANTHROPIC_BASE_URL": "https://api.anthropic.com" } }"#;
    std::fs::write(&settings, original).unwrap();
    let config = w.home.join(".codex").join("config.toml");
    std::fs::write(&config, "model = \"gpt-5\"\n").unwrap();

    adopt(
        &w.home,
        &b,
        "claude-code",
        &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-c", Vec::new()),
        None,
        &Around::default(),
    )
    .unwrap();
    adopt(
        &w.home,
        &b,
        "codex",
        &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-x", Vec::new()),
        None,
        &Around::default(),
    )
    .unwrap();
    let listed = list_wsl(
        &w,
        &b,
        &Gateway {
            base: "http://127.0.0.1:8788".into(),
            keys: Vec::new(),
        },
    );
    for c in &listed {
        let e = c.endpoint.as_deref().unwrap_or_default();
        assert!(e.starts_with("http://127.0.0.1:8788"), "{}: {e}", c.id);
        assert!(is_loopback(e));
    }

    restore(&w.home, &b, "claude-code", None).unwrap();
    restore(&w.home, &b, "codex", None).unwrap();
    let back: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
    let want: serde_json::Value = serde_json::from_str(original).unwrap();
    assert_eq!(back, want);
    assert!(adopted(&w.home, &b).is_empty());
}

/// 按 NAT 的做法接管过的（指着 WSL 虚拟网卡的地址）不迁移：列出来的就是它
/// 此刻指着的地址（界面据此标成未生效），照样能还原
#[test]
fn a_copy_adopted_the_old_nat_way_is_listed_as_is_and_can_be_restored() {
    let (d, w) = wsl_home();
    let b = d.path().join("backups");
    adopt(
        &w.home,
        &b,
        "claude-code",
        &tw_adopt::clients::Gateway::keyed("http://172.27.96.1:8788", "tw-c", Vec::new()),
        None,
        &Around::default(),
    )
    .unwrap();
    let gw = Gateway {
        base: "http://127.0.0.1:8788".into(),
        keys: Vec::new(),
    };
    let cc = list_wsl(&w, &b, &gw)
        .into_iter()
        .find(|c| c.id == "claude-code")
        .unwrap();
    assert!(cc.adopted_at_ms.is_some());
    assert_eq!(cc.endpoint.as_deref(), Some("http://172.27.96.1:8788"));
    restore(&w.home, &b, "claude-code", None).unwrap();
    assert!(adopted(&w.home, &b).is_empty());
}

/// 换了密钥之后重新指一次：新值写进它的配置
#[test]
fn repointing_writes_the_new_key_into_the_clients_config() {
    let home = home_with_claude();
    adopt(
        home.path(),
        &backups(&home),
        "claude-code",
        &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-old", Vec::new()),
        None,
        &Around::default(),
    )
    .unwrap();
    let c = find("claude-code", home.path()).unwrap();
    let s = repoint(
        home.path(),
        &backups(&home),
        &c,
        "http://127.0.0.1:8788",
        "tw-fresh",
        Vec::new(),
        &Around::default(),
    )
    .unwrap();
    assert_eq!(s.client, "claude-code");
    let text = std::fs::read_to_string(home.path().join(".claude/settings.json")).unwrap();
    assert!(
        text.contains("tw-fresh") && !text.contains("tw-old"),
        "{text}"
    );
}

/// 重新指向 Claude Desktop：**模型列表按新网关此刻答的换**，和接管同一个入口。
/// 按单个文件的通用那一套算的话，列表还是旧网关那一份
#[test]
fn repointing_claude_desktop_rewrites_its_model_list_too() {
    let home = tempfile::tempdir().unwrap();
    if tw_adopt::desktop::managed(home.path()).is_some() {
        // 这台跑测试的机器上的 Claude Desktop 由组织托管：接管本来就会被拒
        return;
    }
    let first = tw_adopt::desktop::first_party_config(home.path());
    std::fs::create_dir_all(first.parent().unwrap()).unwrap();
    std::fs::write(&first, "{\n  \"globalShortcut\": \"Alt+Space\"\n}\n").unwrap();
    let base = "http://127.0.0.1:8788";
    let id = tw_adopt::desktop::ID;
    adopt(
        home.path(),
        &backups(&home),
        id,
        &tw_adopt::clients::Gateway::keyed(base, "tw-old", vec!["claude-sonnet-5".into()]),
        None,
        &Around::default(),
    )
    .unwrap();
    let c = find(id, home.path()).unwrap();
    repoint(
        home.path(),
        &backups(&home),
        &c,
        "http://10.0.0.2:8788",
        "tw-fresh",
        vec!["claude-opus-5".into(), "gpt-5".into()],
        &Around::default(),
    )
    .unwrap();
    let profile: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(tw_adopt::desktop::profile_path(home.path())).unwrap(),
    )
    .unwrap();
    assert_eq!(profile["inferenceGatewayApiKey"], "tw-fresh");
    assert_eq!(
        profile["inferenceModels"],
        serde_json::json!(["claude-opus-5"])
    );
}

/// 同一份原文同一个指纹；原文、路径、有没有这个文件，任何一样不同都不同
#[test]
fn the_fingerprint_follows_every_file_the_plan_read() {
    let a = Path::new("/h/a.json");
    let b = Path::new("/h/b.json");
    let f = |xs: &[(&Path, Option<&[u8]>)]| fingerprint(xs.iter().copied());
    assert_eq!(f(&[(a, Some(b"x"))]), f(&[(a, Some(b"x"))]));
    assert_ne!(f(&[(a, Some(b"x"))]), f(&[(a, Some(b"y"))]));
    assert_ne!(f(&[(a, Some(b"x"))]), f(&[(b, Some(b"x"))]));
    assert_ne!(f(&[(a, None)]), f(&[(a, Some(b""))]));
    assert_ne!(
        f(&[(a, Some(b"x"))]),
        f(&[(a, Some(b"x")), (b, None)]),
        "多一份文件也算"
    );
}

/// 看着差异的时候文件被改了：**什么都不写**，按此刻的文件重算的那一份才写得进去
#[test]
fn a_file_changed_while_its_diff_was_shown_is_not_written() {
    let home = home_with_claude();
    let settings = home.path().join(".claude/settings.json");
    std::fs::write(&settings, "{\n  \"model\": \"opus\"\n}\n").unwrap();
    let g = gw(vec![key("default", "tw-d", None, true)]);
    let shown = plan_adopt(
        home.path(),
        "claude-code",
        &g,
        Vec::new(),
        &Around::default(),
    )
    .unwrap();

    // 客户端自己在这时改了一项设置
    let changed = "{\n  \"model\": \"sonnet\"\n}\n";
    std::fs::write(&settings, changed).unwrap();
    let adopt_now = |expect: &str| {
        adopt(
            home.path(),
            &backups(&home),
            "claude-code",
            &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-d", Vec::new()),
            Some(expect),
            &Around::default(),
        )
    };
    let e = adopt_now(&shown.digest).unwrap_err();
    assert_eq!(e.code, "adopt.plan.stale");
    assert_eq!(std::fs::read_to_string(&settings).unwrap(), changed);
    assert!(adopted(home.path(), &backups(&home)).is_empty());

    // 重新算一份给人看，照那一份就写得进去
    let again = plan_adopt(
        home.path(),
        "claude-code",
        &g,
        Vec::new(),
        &Around::default(),
    )
    .unwrap();
    assert_ne!(again.digest, shown.digest);
    adopt_now(&again.digest).unwrap();
    assert_eq!(adopted(home.path(), &backups(&home)).len(), 1);

    // 还原也一样
    let shown = plan_restore(home.path(), "claude-code", &[]).unwrap();
    let edited = std::fs::read_to_string(&settings)
        .unwrap()
        .replace("sonnet", "haiku");
    std::fs::write(&settings, &edited).unwrap();
    let e = restore(
        home.path(),
        &backups(&home),
        "claude-code",
        Some(&shown.digest),
    )
    .unwrap_err();
    assert_eq!(e.code, "adopt.plan.stale");
    assert_eq!(std::fs::read_to_string(&settings).unwrap(), edited);
    let again = plan_restore(home.path(), "claude-code", &[]).unwrap();
    restore(
        home.path(),
        &backups(&home),
        "claude-code",
        Some(&again.digest),
    )
    .unwrap();
    assert!(adopted(home.path(), &backups(&home)).is_empty());
}
