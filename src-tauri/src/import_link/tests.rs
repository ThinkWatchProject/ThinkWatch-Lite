//! 导入链接的校验：把每一条都当成恶意网页发来的。

use std::time::{Duration, Instant};

use tw_api::Protocol;

use super::*;

const OK: &str = "thinkwatch://import?name=relay&url=https%3A%2F%2Fapi.relay.example%2Fv1&protocol=openai-chat&key=sk-abc123&models=gpt-5,gpt-5-mini";

fn p(link: &str) -> Result<ImportProposal, Rejected> {
    parse(link)
}

fn with_url(url: &str) -> Result<ImportProposal, Rejected> {
    p(&format!("thinkwatch://import?url={url}"))
}

fn with_key(key: &str) -> Result<ImportProposal, Rejected> {
    p(&format!(
        "thinkwatch://import?url=https://relay.example&key={key}"
    ))
}

fn with_name(name: &str) -> Result<ImportProposal, Rejected> {
    p(&format!(
        "thinkwatch://import?url=https://relay.example&name={name}"
    ))
}

#[test]
fn a_well_formed_link_becomes_a_proposal() {
    let got = p(OK).unwrap();
    assert_eq!(
        got,
        ImportProposal {
            name: Some("relay".into()),
            base_url: "https://api.relay.example/v1".into(),
            host: "api.relay.example".into(),
            protocol: Some(Protocol::OpenaiChat),
            key: Some("sk-abc123".into()),
            models: vec!["gpt-5".into(), "gpt-5-mini".into()],
        }
    );
}

#[test]
fn only_url_is_required() {
    let got = with_url("https://relay.example/").unwrap();
    assert_eq!(got.base_url, "https://relay.example");
    assert_eq!(got.name, None);
    assert_eq!(got.key, None);
    assert_eq!(got.protocol, None);
    assert!(got.models.is_empty());
    assert_eq!(p("thinkwatch://import"), Err(Rejected::MissingUrl));
    assert_eq!(p("thinkwatch://import?name=x"), Err(Rejected::MissingUrl));
}

#[test]
fn the_trailing_slash_form_and_host_case_are_accepted() {
    assert!(p("thinkwatch://import/?url=https://relay.example").is_ok());
    assert!(p("THINKWATCH://Import?url=https://relay.example").is_ok());
}

#[test]
fn other_thinkwatch_links_are_not_imports() {
    assert!(!is_import("thinkwatch://chatgpt/login?code=1"));
    assert!(!is_import("thinkwatch://notice/abc"));
    assert!(!is_import("thinkwatch://importer?url=https://x.example"));
    assert!(is_import("thinkwatch://import?url=https://x.example"));
    // 写坏了的导入链接也归这里处理（然后被拒），不落到别的分支去拉窗口
    assert!(is_import("thinkwatch://import#x"));
    assert_eq!(p("thinkwatch://import#x"), Err(Rejected::Malformed));
    assert_eq!(
        p("thinkwatch://import/other?url=https://x.example"),
        Err(Rejected::Malformed)
    );
}

#[test]
fn an_unknown_parameter_rejects_the_whole_link() {
    for extra in [
        "headers=x-a%3A1",
        "proxy=system",
        "pricing=mine",
        "default=true",
        "route=all",
        "mcp=x",
        "icon=https://x.example/i.png",
        "Name=x",
        "key%00=x",
    ] {
        assert_eq!(
            p(&format!("{OK}&{extra}")),
            Err(Rejected::UnknownParam),
            "{extra}"
        );
    }
}

#[test]
fn a_duplicated_parameter_rejects_the_whole_link() {
    assert_eq!(
        p("thinkwatch://import?url=https://a.example&url=https://b.example"),
        Err(Rejected::DuplicateParam)
    );
    assert_eq!(
        p(&format!("{OK}&key=sk-other")),
        Err(Rejected::DuplicateParam)
    );
    // 参数名编码过也认得出是同一个
    assert_eq!(
        p(&format!("{OK}&%6Bey=sk-other")),
        Err(Rejected::DuplicateParam)
    );
}

#[test]
fn malformed_query_strings_are_rejected() {
    assert_eq!(p("thinkwatch://import?url"), Err(Rejected::Malformed));
    assert_eq!(p(&format!("{OK}&")), Err(Rejected::Malformed));
    assert_eq!(p(&format!("{OK}&&")), Err(Rejected::Malformed));
    assert_eq!(p(&format!("{OK}#frag")), Err(Rejected::Malformed));
    assert_eq!(
        p("thinkwatch://import?url=https://a.example&name="),
        Err(Rejected::Empty)
    );
}

#[test]
fn oversize_links_and_fields_are_rejected() {
    let long = "a".repeat(MAX_LINK);
    assert_eq!(p(&format!("{OK}&models={long}")), Err(Rejected::TooLong));
    assert_eq!(with_name(&"n".repeat(MAX_NAME + 1)), Err(Rejected::Name));
    assert!(with_name(&"n".repeat(MAX_NAME)).is_ok());
    assert_eq!(with_key(&"k".repeat(MAX_KEY + 1)), Err(Rejected::Key));
    assert_eq!(
        with_url(&format!("https://relay.example/{}", "p".repeat(MAX_URL))),
        Err(Rejected::Url)
    );
    let many: Vec<String> = (0..=MAX_MODELS).map(|i| format!("m{i}")).collect();
    assert_eq!(
        p(&format!(
            "thinkwatch://import?url=https://a.example&models={}",
            many.join(",")
        )),
        Err(Rejected::Models)
    );
    assert_eq!(
        p(&format!(
            "thinkwatch://import?url=https://a.example&models={}",
            "m".repeat(MAX_MODEL + 1)
        )),
        Err(Rejected::Models)
    );
}

#[test]
fn non_web_schemes_are_rejected() {
    for url in [
        "javascript:alert(1)",
        "javascript%3Aalert(1)",
        "file:///etc/passwd",
        "file%3A%2F%2F%2FUsers",
        "data:text/html,hi",
        "data%3Atext%2Fhtml%2Chi",
        "ftp://relay.example",
        "ws://relay.example",
        "thinkwatch://import",
        "//relay.example",
        "relay.example",
        "https:relay.example",
        "https:/relay.example",
    ] {
        assert_eq!(with_url(url), Err(Rejected::Url), "{url}");
    }
}

#[test]
fn plain_http_is_only_for_this_machine() {
    for url in [
        "http://192.168.1.1",
        "http://10.0.0.1:8080",
        "http://relay.example",
        "http://localhost.evil.example",
        "http://127.0.0.1.nip.io",
    ] {
        assert_eq!(with_url(url), Err(Rejected::Url), "{url}");
    }
    for (url, host) in [
        ("http://127.0.0.1:8317", "127.0.0.1:8317"),
        ("http://localhost:3000/v1", "localhost:3000"),
        ("http://[::1]:9000", "[::1]:9000"),
    ] {
        assert_eq!(with_url(url).unwrap().host, host);
    }
    // https 到内网地址可以：确认框写明发往哪里，创建之前不发任何请求
    assert_eq!(with_url("https://192.168.1.1").unwrap().host, "192.168.1.1");
}

#[test]
fn urls_with_credentials_query_or_fragment_are_rejected() {
    for url in [
        "https://user:pass@relay.example",
        "https%3A%2F%2Fuser%3Apass%40relay.example",
        "https://user@relay.example",
        "https://relay.example@evil.example",
        "https://relay.example/v1?x=1",
        "https://relay.example/v1%3Fx%3D1",
        "https://relay.example/v1%23frag",
        "https://relay.example/%2524%257BHOME%257D",
        "https://relay.example/${HOME}",
        "https://relay.example/%24%7BHOME%7D",
        "https://relay.example\\@evil.example",
        "https://relay .example",
    ] {
        assert_eq!(with_url(url), Err(Rejected::Url), "{url}");
    }
}

#[test]
fn internationalized_hosts_are_shown_as_ascii() {
    // 西里尔字母的 а 冒充拉丁字母 a
    let got = with_url("https://%D0%B0pple.example").unwrap();
    assert!(got.host.is_ascii());
    assert!(got.host.starts_with("xn--"), "{}", got.host);
    assert!(got.base_url.starts_with("https://xn--"), "{}", got.base_url);
    let got = with_url("https://%E4%BE%8B%E5%AD%90.example/v1").unwrap();
    assert_eq!(got.host, "xn--fsqu00a.example");
    assert_eq!(got.base_url, "https://xn--fsqu00a.example/v1");
}

#[test]
fn keys_that_core_would_expand_are_rejected() {
    // core 把 `${NAME}` 换成环境变量：带着它的链接会把用户自己的密钥发给对方
    for key in [
        "${HOME}",
        "%24%7BHOME%7D",
        "%24%7BOPENAI_API_KEY%7D",
        "sk-%24%7BAWS_SECRET_ACCESS_KEY%7D",
        "%24%24%7BX%7D",
        "$HOME",
        "%24HOME",
        "%7B%7Baccess_token%7D%7D",
        "sk-%7Bx%7D",
    ] {
        assert_eq!(with_key(key), Err(Rejected::Key), "{key}");
    }
}

#[test]
fn double_encoding_stays_literal_and_is_rejected() {
    // 只解一层：`%2524%257B` 解出来是字面的 `%24%7B`，不会再解成 `${`
    assert_eq!(with_key("%2524%257BHOME%257D"), Err(Rejected::Key));
    assert_eq!(with_name("%252F..%252F"), proposal_named("%2F..%2F"));
}

fn proposal_named(n: &str) -> Result<ImportProposal, Rejected> {
    Ok(ImportProposal {
        name: Some(n.into()),
        base_url: "https://relay.example".into(),
        host: "relay.example".into(),
        protocol: None,
        key: None,
        models: vec![],
    })
}

#[test]
fn control_characters_and_newlines_are_rejected() {
    for (field, v) in [
        ("key", "sk-a%0Ab"),
        ("key", "sk-a%0D%0Ax-evil%3A1"),
        ("key", "sk-a%00"),
        ("key", "sk-a%09b"),
        ("key", "sk+a"),
        ("name", "a%0Ab"),
        ("name", "a%00"),
        ("name", "a%1Bb"),
        ("name", "a%E2%80%AEb"),
        ("name", "a%E2%80%8Bb"),
        ("url", "https%3A%2F%2Frelay.example%0A"),
        ("url", "https://relay.example/%00"),
        (
            "url",
            "https%3A%2F%2Frelay.example%2Fv1%0D%0AHost%3A%20evil",
        ),
        ("models", "gpt-5%0Agpt-4"),
        ("models", "gpt+5"),
    ] {
        let link = if field == "url" {
            format!("thinkwatch://import?url={v}")
        } else {
            format!("thinkwatch://import?url=https://relay.example&{field}={v}")
        };
        assert!(p(&link).is_err(), "{field}={v}");
    }
}

#[test]
fn bad_percent_encoding_is_rejected() {
    assert_eq!(with_key("sk-%4"), Err(Rejected::Encoding));
    assert_eq!(with_key("sk-%zz"), Err(Rejected::Encoding));
    assert_eq!(with_name("%FF%FE"), Err(Rejected::Encoding));
    assert_eq!(with_name("%C0%AF"), Err(Rejected::Encoding));
}

#[test]
fn names_with_paths_or_reserved_prefixes_are_rejected() {
    for name in [
        "../etc",
        "..%2F..%2Fconfig",
        "a%2Fb",
        "a%5Cb",
        "..",
        ".",
        "__all__",
        "%20lead",
        "trail%20",
        "%24%7BHOME%7D",
        "%3Cimg%20src%3Dx%3E",
    ] {
        assert_eq!(with_name(name), Err(Rejected::Name), "{name}");
    }
    assert_eq!(
        with_name("My+Relay").unwrap().name.as_deref(),
        Some("My Relay")
    );
    assert_eq!(
        with_name("%E4%B8%AD%E8%BD%AC").unwrap().name.as_deref(),
        Some("中转")
    );
}

#[test]
fn only_link_capable_protocols_are_accepted() {
    for (slug, want) in [
        ("anthropic", Protocol::Anthropic),
        ("openai-chat", Protocol::OpenaiChat),
        ("openai-responses", Protocol::OpenaiResponses),
        ("gemini", Protocol::Gemini),
    ] {
        let got = p(&format!(
            "thinkwatch://import?url=https://a.example&protocol={slug}"
        ));
        assert_eq!(got.unwrap().protocol, Some(want));
    }
    for slug in ["chatgpt", "bedrock", "Anthropic", "openai", "auto"] {
        assert_eq!(
            p(&format!(
                "thinkwatch://import?url=https://a.example&protocol={slug}"
            )),
            Err(Rejected::Protocol),
            "{slug}"
        );
    }
}

#[test]
fn model_lists_are_validated_and_deduplicated() {
    let got = p("thinkwatch://import?url=https://a.example&models=claude-sonnet-5,openai/gpt-5,claude-sonnet-5").unwrap();
    assert_eq!(got.models, ["claude-sonnet-5", "openai/gpt-5"]);
    for m in [
        "a,,b",
        "a,",
        ",a",
        "a%20b",
        "a;b",
        "%24%7BX%7D",
        "%3Cscript%3E",
    ] {
        assert_eq!(
            p(&format!(
                "thinkwatch://import?url=https://a.example&models={m}"
            )),
            Err(Rejected::Models),
            "{m}"
        );
    }
}

#[test]
fn a_burst_of_links_opens_one_dialog() {
    let gate = Gate::new();
    let t0 = Instant::now();
    let proposal = p(OK).unwrap();
    let accepted = (0..200)
        .filter(|i| gate.offer(proposal.clone(), t0 + Duration::from_millis(*i)))
        .count();
    assert_eq!(accepted, 1);
    assert_eq!(gate.take(), Some(proposal.clone()));
    // 对话框开着：再来的都丢掉，取也取不到第二份
    assert!(!gate.offer(proposal.clone(), t0 + Duration::from_secs(600)));
    assert_eq!(gate.take(), None);
    // 关掉之后的冷却期里也不收
    gate.close(t0 + Duration::from_secs(700));
    assert!(!gate.offer(proposal.clone(), t0 + Duration::from_secs(701)));
    assert!(gate.offer(proposal.clone(), t0 + Duration::from_secs(704)));
}

#[test]
fn a_proposal_nobody_took_can_be_replaced_after_a_while() {
    let gate = Gate::new();
    let t0 = Instant::now();
    let a = with_url("https://a.example").unwrap();
    let b = with_url("https://b.example").unwrap();
    assert!(gate.offer(a, t0));
    assert!(!gate.offer(b.clone(), t0 + Duration::from_secs(5)));
    assert!(gate.offer(b.clone(), t0 + Duration::from_secs(61)));
    assert_eq!(gate.take(), Some(b));
}

#[test]
fn closing_does_not_drop_a_proposal_not_yet_taken() {
    let gate = Gate::new();
    let t0 = Instant::now();
    let a = with_url("https://a.example").unwrap();
    assert!(gate.offer(a.clone(), t0));
    // 网页挂上时先报一次「关了」，再来取
    gate.close(t0);
    assert_eq!(gate.take(), Some(a));
}

/// 官网文档里的示例和链接生成器写出来的链接（`encodeURIComponent` 编码）都要能用
#[test]
fn the_links_in_the_site_docs_parse() {
    let a = p("thinkwatch://import?name=example-relay&url=https%3A%2F%2Fapi.relay.example&protocol=anthropic&key=sk-relay-EXAMPLE").unwrap();
    assert_eq!(a.base_url, "https://api.relay.example");
    assert_eq!(a.protocol, Some(Protocol::Anthropic));
    let b = p("thinkwatch://import?name=example-openai&url=https%3A%2F%2Fapi.relay.example%2Fv1&protocol=openai-chat&key=sk-relay-EXAMPLE&models=gpt-5%2Cgpt-5-mini").unwrap();
    assert_eq!(b.base_url, "https://api.relay.example/v1");
    assert_eq!(b.models, ["gpt-5", "gpt-5-mini"]);
    let c = p("thinkwatch://import?url=http%3A%2F%2F%5B%3A%3A1%5D%3A9&key=a%2Bb%3D").unwrap();
    assert_eq!(c.host, "[::1]:9");
    assert_eq!(c.key.as_deref(), Some("a+b="));
}
