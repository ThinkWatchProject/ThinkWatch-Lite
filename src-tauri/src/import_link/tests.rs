//! 导入链接的校验：把每一条都当成恶意网页发来的。

use std::time::{Duration, Instant};

use tw_api::{BalanceSetting, Billing, LimitMeasure, LimitPer, Protocol, ZaiFamily};

use super::*;

const OK: &str = "thinkwatch://import?name=relay&url=https%3A%2F%2Fapi.relay.example%2Fv1&protocol=openai-chat&key=sk-abc123&models=gpt-5,gpt-5-mini";

/// 和网页上的 `encodeURIComponent` 一样编码
fn enc(v: &str) -> String {
    let mut out = String::new();
    for b in v.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// 按参数拼一条链接，每个值都编码
fn link(params: &[(&str, &str)]) -> String {
    let q: Vec<String> = params
        .iter()
        .map(|(k, v)| format!("{k}={}", enc(v)))
        .collect();
    format!("thinkwatch://import?{}", q.join("&"))
}

fn p(link: &str) -> Result<ImportProposal, Rejected> {
    match parse(link)? {
        ImportLink::Proposal { proposal } => Ok(*proposal),
        ImportLink::Unsupported { param } => panic!("没想到是不认识的参数：{param:?}"),
    }
}

fn pp(params: &[(&str, &str)]) -> Result<ImportProposal, Rejected> {
    p(&link(params))
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

/// 一个中转站（Sub2API）的链接，后面接上要测的那一项
fn relay(extra: &[(&str, &str)]) -> Result<ImportProposal, Rejected> {
    let mut all = vec![
        ("service", "sub2api"),
        ("url", "https://relay.example"),
        ("key", "sk-relay"),
    ];
    all.extend_from_slice(extra);
    pp(&all)
}

/// 什么都没写的那一份（自定义、API 密钥）：测试里按它改几项
fn blank(base_url: &str) -> ImportProposal {
    ImportProposal {
        service: ImportService::Custom,
        auth: ImportAuth::Key,
        site: None,
        name: None,
        base_url: Some(base_url.into()),
        protocol: None,
        key: None,
        oauth: None,
        region: None,
        aws: None,
        headers: vec![],
        client_identity: false,
        concurrency: None,
        limits: vec![],
        balance: None,
        models: vec![],
        models_only: None,
        specs: vec![],
        billing: None,
        price_sheet: None,
    }
}

// ---------------------------------------------------------- 第一版的链接

#[test]
fn a_well_formed_v1_link_becomes_a_custom_proposal() {
    assert_eq!(
        p(OK).unwrap(),
        ImportProposal {
            name: Some("relay".into()),
            protocol: Some(Protocol::OpenaiChat),
            key: Some("sk-abc123".into()),
            models: vec!["gpt-5".into(), "gpt-5-mini".into()],
            ..blank("https://api.relay.example/v1")
        }
    );
}

#[test]
fn only_url_is_required_without_a_service() {
    let got = with_url("https://relay.example/").unwrap();
    assert_eq!(got, blank("https://relay.example"));
    assert_eq!(p("thinkwatch://import"), Err(Rejected::Missing(Param::Url)));
    assert_eq!(
        p("thinkwatch://import?name=x"),
        Err(Rejected::Missing(Param::Url))
    );
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
    assert_eq!(
        parse("https://thinkwat.ch/import#url=x"),
        Err(Rejected::NotImport)
    );
}

/// 第一版的链接都没写服务类型：按地址认出来的那种服务不收它的某一项时按「自定义」，和第一版
/// 建出来的一样
#[test]
fn v1_links_stay_valid_when_the_address_is_a_vendors() {
    // 正是官方地址：认成那一种服务
    let a = with_url("https://api.anthropic.com").unwrap();
    assert_eq!(a.service, ImportService::Anthropic);
    assert_eq!(a.base_url.as_deref(), Some("https://api.anthropic.com"));
    let z = with_url("https%3A%2F%2Fapi.z.ai%2Fapi%2Fanthropic").unwrap();
    assert_eq!(
        (z.service, z.site),
        (ImportService::Zai, Some(ZaiFamily::Zai))
    );
    let b = with_url("https://bedrock-runtime.eu-west-1.amazonaws.com").unwrap();
    assert_eq!(b.service, ImportService::Bedrock);
    let o = with_url("http://127.0.0.1:11434").unwrap();
    assert_eq!(o.service, ImportService::Ollama);
    // 带着路径、协议不是它那一种、Ollama 带密钥：按「自定义」
    for (url, extra) in [
        ("https://api.openai.com/v1", ""),
        ("https://api.anthropic.com", "&protocol=openai-chat"),
        ("https://api.deepseek.com", "&protocol=openai-chat"),
        (
            "https://api.z.ai/api/coding/paas/v4",
            "&protocol=openai-chat",
        ),
        ("https://open.bigmodel.cn/api/anthropic", "&protocol=gemini"),
        (
            "https://bedrock-runtime.us-east-1.amazonaws.com",
            "&protocol=anthropic",
        ),
        ("http://127.0.0.1:11434", "&key=k"),
        ("https://chatgpt.com/backend-api", ""),
    ] {
        let got = p(&format!("thinkwatch://import?url={}{extra}", enc(url))).unwrap();
        assert_eq!(got.service, ImportService::Custom, "{url}{extra}");
        assert_eq!(got.base_url.as_deref(), Some(url), "{url}{extra}");
        assert_eq!(got.site, None);
    }
    // 认得出的那一种和「自定义」都不收的，照样作废
    assert_eq!(
        with_url("https://api.openai.com&auth=account"),
        Err(Rejected::NotOffered(Param::Auth))
    );
}

/// 官网文档里的示例和链接生成器写出来的链接（`encodeURIComponent` 编码）都要能用
#[test]
fn the_links_in_the_site_docs_parse() {
    let a = p("thinkwatch://import?name=example-relay&url=https%3A%2F%2Fapi.relay.example&protocol=anthropic&key=sk-relay-EXAMPLE").unwrap();
    assert_eq!(a.base_url.as_deref(), Some("https://api.relay.example"));
    assert_eq!(a.protocol, Some(Protocol::Anthropic));
    let b = p("thinkwatch://import?name=example-openai&url=https%3A%2F%2Fapi.relay.example%2Fv1&protocol=openai-chat&key=sk-relay-EXAMPLE&models=gpt-5%2Cgpt-5-mini").unwrap();
    assert_eq!(b.base_url.as_deref(), Some("https://api.relay.example/v1"));
    assert_eq!(b.models, ["gpt-5", "gpt-5-mini"]);
    let c = p("thinkwatch://import?url=http%3A%2F%2F%5B%3A%3A1%5D%3A9&key=a%2Bb%3D").unwrap();
    assert_eq!(c.base_url.as_deref(), Some("http://[::1]:9"));
    assert_eq!(c.key.as_deref(), Some("a+b="));
}

/// 企业版「添加到 ThinkWatch Lite」生成的链接（约定里的写法）
#[test]
fn the_enterprise_link_opens_a_thinkwatch_upstream() {
    let got = pp(&[
        ("service", "thinkwatch"),
        ("name", "thinkwatch"),
        ("url", "https://gateway.corp.example"),
        ("key", "tw-k_0123456789abcdef"),
    ])
    .unwrap();
    assert_eq!(
        got,
        ImportProposal {
            service: ImportService::Thinkwatch,
            name: Some("thinkwatch".into()),
            key: Some("tw-k_0123456789abcdef".into()),
            ..blank("https://gateway.corp.example")
        }
    );
    // 企业网关按客户端发来的格式转发：协议不给选
    assert_eq!(
        relay_like("thinkwatch", &[("protocol", "anthropic")]),
        Err(Rejected::NotOffered(Param::Protocol))
    );
}

fn relay_like(service: &str, extra: &[(&str, &str)]) -> Result<ImportProposal, Rejected> {
    let mut all = vec![("service", service), ("url", "https://relay.example")];
    all.extend_from_slice(extra);
    pp(&all)
}

/// 这种服务最少要给的（没有固定地址的带上地址），后面接上要测的那一项
fn for_service(s: &Service, extra: &[(&str, &str)]) -> Result<ImportProposal, Rejected> {
    if s.address == Address::Required {
        relay_like(s.id.slug(), extra)
    } else {
        let mut all = vec![("service", s.id.slug())];
        all.extend_from_slice(extra);
        pp(&all)
    }
}

/// 中转站一次给齐「新建上游」里能填的
#[test]
fn a_full_relay_link() {
    let got = relay(&[
        ("name", "hk-relay"),
        ("protocol", "openai-responses"),
        ("headers", "X-Group: vip\nX-Region: hk"),
        ("client_identity", "on"),
        ("concurrency", "8"),
        ("models", "gpt-5,gpt-5-mini,gpt-5"),
        ("models_only", "gpt-5*,o4-mini"),
        ("specs", "gpt-5|400000|128000|y|y;gpt-5-mini||32000||"),
        ("billing", "per-token"),
        ("price_multiplier", "1.2"),
        (
            "prices",
            "gpt-5|1.25|10|0.125;gpt-5-mini|0.25|2|0.025|0.3|0.5",
        ),
    ])
    .unwrap();
    assert_eq!(
        got,
        ImportProposal {
            service: ImportService::Sub2api,
            name: Some("hk-relay".into()),
            protocol: Some(Protocol::OpenaiResponses),
            key: Some("sk-relay".into()),
            headers: vec![
                ImportHeader {
                    name: "X-Group".into(),
                    value: "vip".into()
                },
                ImportHeader {
                    name: "X-Region".into(),
                    value: "hk".into()
                },
            ],
            client_identity: true,
            concurrency: Some(8),
            models: vec!["gpt-5".into(), "gpt-5-mini".into()],
            models_only: Some(vec!["gpt-5*".into(), "o4-mini".into()]),
            specs: vec![
                ImportSpec {
                    model: "gpt-5".into(),
                    context_window: Some(400_000),
                    max_output_tokens: Some(128_000),
                    reasoning: Some(true),
                    image_input: Some(true),
                },
                ImportSpec {
                    model: "gpt-5-mini".into(),
                    context_window: None,
                    max_output_tokens: Some(32_000),
                    reasoning: None,
                    image_input: None,
                },
            ],
            billing: Some(Billing::PerToken),
            price_sheet: Some(ImportSheet {
                multiplier: 1.2,
                prices: vec![
                    ImportPrice {
                        model: "gpt-5".into(),
                        input: 1.25,
                        output: 10.0,
                        cache_read: 0.125,
                        // 没写的缓存价按输入价
                        cache_write_5m: 1.25,
                        cache_write_1h: 1.25,
                    },
                    ImportPrice {
                        model: "gpt-5-mini".into(),
                        input: 0.25,
                        output: 2.0,
                        cache_read: 0.025,
                        cache_write_5m: 0.3,
                        cache_write_1h: 0.5,
                    },
                ],
            }),
            ..blank("https://relay.example")
        }
    );
}

// ---------------------------------------------------------- 不认识的、永远不收的参数

#[test]
fn an_unknown_parameter_asks_for_a_newer_app() {
    for (extra, shown) in [
        ("pricing=mine", Some("pricing")),
        ("mcp=x", Some("mcp")),
        ("icon=https://x.example/i.png", Some("icon")),
        ("future_option_2=1", Some("future_option_2")),
        ("a=1", Some("a")),
        // 约定里只有 `weight`：复数的写法不认识
        ("weights=1", Some("weights")),
        // 写法不像一个参数名的不拿给人看
        ("Name=x", None),
        ("key%00=x", None),
        ("x-y=1", None),
        ("%E5%90%8D=x", None),
        ("%3Cb%3E=x", None),
        (
            "abcdefghijklmnopqrstuvwxyz0123456=1",
            None, // 33 个字符
        ),
    ] {
        assert_eq!(
            parse(&format!("{OK}&{extra}")),
            Ok(ImportLink::Unsupported {
                param: shown.map(str::to_string)
            }),
            "{extra}"
        );
    }
    assert_eq!(
        parse(&format!("{OK}&abcdefghijklmnopqrstuvwxyz012345=1")),
        Ok(ImportLink::Unsupported {
            param: Some("abcdefghijklmnopqrstuvwxyz012345".into())
        })
    );
    // 不认识的参数先说：其余各项写错了也一样（新版本里它们可能是对的）
    assert_eq!(
        parse("thinkwatch://import?service=nope&newthing=1"),
        Ok(ImportLink::Unsupported {
            param: Some("newthing".into())
        })
    );
    // 写坏了的链接照样悄悄作废，不弹「无法导入」
    assert_eq!(
        parse("thinkwatch://import?newthing=1&newthing=2"),
        Err(Rejected::DuplicateParam)
    );
    assert_eq!(parse("thinkwatch://import?newthing="), Err(Rejected::Empty));
    assert_eq!(
        parse("thinkwatch://import?newthing=%zz"),
        Err(Rejected::Encoding)
    );
}

#[test]
fn never_accepted_parameters_reject_silently() {
    for name in NEVER {
        assert_eq!(
            parse(&format!("{OK}&{name}=x")),
            Err(Rejected::NeverAccepted),
            "{name}"
        );
    }
    // 和不认识的参数在一起时，不认识的先说
    assert!(matches!(
        parse(&format!("{OK}&proxy=system&newthing=1")),
        Ok(ImportLink::Unsupported { .. })
    ));
    // AWS profile 也不能写成认证方式
    assert_eq!(
        pp(&[("service", "bedrock"), ("auth", "aws-profile")]),
        Err(Rejected::Invalid(Param::Auth))
    );
}

// ---------------------------------------------------------- 整条链接的写法

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
    for k in Param::ALL {
        assert_eq!(
            p(&format!(
                "thinkwatch://import?url=https://a.example&{}=",
                k.name()
            )),
            if *k == Param::Url {
                Err(Rejected::DuplicateParam)
            } else {
                Err(Rejected::Empty)
            },
            "{}",
            k.name()
        );
    }
}

#[test]
fn oversize_links_and_fields_are_rejected() {
    let long = "a".repeat(MAX_LINK);
    assert_eq!(p(&format!("{OK}&models={long}")), Err(Rejected::TooLong));
    // 正好到上限的整条可以
    let base = "thinkwatch://import?url=https://relay.example&name=";
    let fill = "n".repeat(MAX_LINK - base.len());
    assert_eq!(
        p(&format!("{base}{fill}")),
        Err(Rejected::Invalid(Param::Name))
    );
    assert_eq!(
        with_name(&"n".repeat(MAX_NAME + 1)),
        Err(Rejected::Invalid(Param::Name))
    );
    assert!(with_name(&"n".repeat(MAX_NAME)).is_ok());
    // 名称按字符数，不按字节
    assert!(with_name(&enc(&"中".repeat(MAX_NAME))).is_ok());
    assert_eq!(
        with_key(&"k".repeat(MAX_KEY + 1)),
        Err(Rejected::Invalid(Param::Key))
    );
    assert!(with_key(&"k".repeat(MAX_KEY)).is_ok());
    assert_eq!(
        with_url(&format!("https://relay.example/{}", "p".repeat(MAX_URL))),
        Err(Rejected::Invalid(Param::Url))
    );
    let many: Vec<String> = (0..=MAX_MODELS).map(|i| format!("m{i}")).collect();
    assert_eq!(
        relay(&[("models", &many.join(","))]),
        Err(Rejected::Invalid(Param::Models))
    );
    assert!(relay(&[("models", &many[..MAX_MODELS].join(","))]).is_ok());
    assert_eq!(
        relay(&[("models", &"m".repeat(MAX_MODEL + 1))]),
        Err(Rejected::Invalid(Param::Models))
    );
    assert!(relay(&[("models", &"m".repeat(MAX_MODEL))]).is_ok());
}

// ---------------------------------------------------------- 每一个值的规矩

#[test]
fn no_value_may_contain_dollar_or_braces() {
    // core 把 `${NAME}` 换成环境变量：带着它的链接会把用户自己的东西发给对方
    for p in Param::ALL {
        for bad in ["%24", "%7B", "%7D", "%24%7BHOME%7D", "%24%24%7BX%7D"] {
            let value = if *p == Param::Headers {
                format!("X-A%3A%20a{bad}")
            } else {
                format!("a{bad}")
            };
            assert_eq!(
                parse(&format!("thinkwatch://import?{}={value}", p.name())),
                Err(Rejected::Invalid(*p)),
                "{}={value}",
                p.name()
            );
        }
    }
}

#[test]
fn no_value_may_contain_control_or_invisible_characters() {
    for p in Param::ALL {
        for bad in [
            "%00",
            "%0D",
            "%09",
            "%1B",
            "%7F",
            "%E2%80%AE",
            "%E2%80%8B",
            "%EF%BB%BF",
        ] {
            let value = if *p == Param::Headers {
                format!("X-A%3A%20a{bad}b")
            } else {
                format!("a{bad}b")
            };
            assert_eq!(
                parse(&format!("thinkwatch://import?{}={value}", p.name())),
                Err(Rejected::Invalid(*p)),
                "{}={value}",
                p.name()
            );
        }
        // 换行只在请求头里是行与行的分隔
        if *p != Param::Headers {
            assert_eq!(
                parse(&format!("thinkwatch://import?{}=a%0Ab", p.name())),
                Err(Rejected::Invalid(*p)),
                "{}",
                p.name()
            );
        }
    }
}

#[test]
fn keys_that_core_would_expand_are_rejected() {
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
        assert_eq!(with_key(key), Err(Rejected::Invalid(Param::Key)), "{key}");
    }
}

#[test]
fn double_encoding_stays_literal() {
    // 只解一层：`%2524%257B` 解出来是字面的 `%24%7B`，不会再解成 `${`
    assert_eq!(
        with_key("%2524%257BHOME%257D"),
        Err(Rejected::Invalid(Param::Key))
    );
    assert_eq!(
        with_name("%252F..%252F").unwrap().name.as_deref(),
        Some("%2F..%2F")
    );
}

#[test]
fn bad_percent_encoding_is_rejected() {
    assert_eq!(with_key("sk-%4"), Err(Rejected::Encoding));
    assert_eq!(with_key("sk-%zz"), Err(Rejected::Encoding));
    assert_eq!(with_name("%FF%FE"), Err(Rejected::Encoding));
    assert_eq!(with_name("%C0%AF"), Err(Rejected::Encoding));
}

#[test]
fn service_must_be_one_of_the_presets() {
    for s in SERVICES {
        assert_eq!(ImportService::from_slug(s.id.slug()), Some(s.id));
    }
    for bad in [
        "Custom",
        "chatgpt",
        "openai-chat",
        "aws",
        "relay",
        " custom",
    ] {
        assert_eq!(
            pp(&[("service", bad), ("url", "https://relay.example")]),
            Err(Rejected::Invalid(Param::Service)),
            "{bad}"
        );
    }
}

/// 每一种服务 × 每一种认证方式：只收对话框里有的那几种。拼的是那种认证方式最少要给的几项
#[test]
fn every_service_takes_exactly_its_own_auth_methods() {
    for s in SERVICES {
        for auth in ["key", "oauth", "account", "aws-keys"] {
            let mut ps: Vec<(&str, &str)> = vec![("service", s.id.slug()), ("auth", auth)];
            if s.address == Address::Required && auth != "account" {
                ps.push(("url", "https://relay.example"));
            }
            match auth {
                "oauth" => ps.extend([
                    ("oauth_endpoint", "https://auth.example/oauth/token"),
                    ("oauth_refresh", "rt-1"),
                ]),
                "aws-keys" => ps.extend([
                    ("aws_access_key_id", "AKIAIOSFODNN7EXAMPLE"),
                    ("aws_secret_access_key", "wJalrXUtnFEMI/K7MDENG"),
                ]),
                _ => {}
            }
            let want = match auth {
                "key" => ImportAuth::Key,
                "oauth" => ImportAuth::Oauth,
                "account" => ImportAuth::Account,
                _ => ImportAuth::AwsKeys,
            };
            let got = pp(&ps);
            if s.auth.contains(&want) {
                let got = got.unwrap_or_else(|e| panic!("{} {auth}: {e:?}", s.id.slug()));
                assert_eq!((got.service, got.auth), (s.id, want));
            } else {
                assert_eq!(
                    got,
                    Err(Rejected::NotOffered(Param::Auth)),
                    "{} {auth}",
                    s.id.slug()
                );
            }
        }
        // 没写认证方式就是 API 密钥：每一种服务都有
        assert_eq!(s.auth[0], ImportAuth::Key);
    }
    for bad in ["aws-profile", "Key", "token", "api-key", "none"] {
        assert_eq!(
            relay(&[("auth", bad)]),
            Err(Rejected::Invalid(Param::Auth)),
            "{bad}"
        );
    }
}

#[test]
fn account_links_carry_no_credentials_or_connection_fields() {
    let chatgpt = pp(&[
        ("service", "openai"),
        ("auth", "account"),
        ("name", "work"),
        ("models", "gpt-6-luna"),
        ("models_only", "gpt-5*"),
        ("specs", "gpt-6-luna|272000|||"),
        ("billing", "free"),
    ])
    .unwrap();
    assert_eq!(chatgpt.auth, ImportAuth::Account);
    assert_eq!(chatgpt.base_url, None);
    assert_eq!(chatgpt.billing, Some(Billing::Free));
    for (k, v) in [
        ("url", "https://api.openai.com"),
        ("key", "sk-1"),
        ("headers", "X-A: 1"),
        ("protocol", "openai-chat"),
        ("concurrency", "4"),
        ("limits", "day|requests|100"),
        ("oauth_refresh", "r"),
    ] {
        let want = match k {
            "url" => Param::Url,
            "key" => Param::Key,
            "headers" => Param::Headers,
            "protocol" => Param::Protocol,
            "concurrency" => Param::Concurrency,
            "limits" => Param::Limits,
            _ => Param::OauthRefresh,
        };
        assert_eq!(
            pp(&[("service", "openai"), ("auth", "account"), (k, v)]),
            Err(Rejected::NotOffered(want)),
            "{k}"
        );
        assert_eq!(
            pp(&[("service", "zai"), ("auth", "account"), (k, v)]),
            Err(Rejected::NotOffered(want)),
            "zai {k}"
        );
    }
}

#[test]
fn z_ai_site_comes_from_the_link_or_the_address() {
    let site = |extra: &[(&str, &str)]| {
        let mut all = vec![("service", "zai")];
        all.extend_from_slice(extra);
        pp(&all).map(|x| x.site)
    };
    assert_eq!(site(&[]), Ok(Some(ZaiFamily::Bigmodel)));
    assert_eq!(site(&[("site", "zai")]), Ok(Some(ZaiFamily::Zai)));
    assert_eq!(site(&[("site", "bigmodel")]), Ok(Some(ZaiFamily::Bigmodel)));
    assert_eq!(site(&[("url", ZAI_ZAI)]), Ok(Some(ZaiFamily::Zai)));
    assert_eq!(
        site(&[("url", ZAI_BIGMODEL), ("site", "bigmodel")]),
        Ok(Some(ZaiFamily::Bigmodel))
    );
    assert_eq!(
        site(&[("url", ZAI_ZAI), ("site", "bigmodel")]),
        Err(Rejected::Invalid(Param::Site))
    );
    assert_eq!(
        site(&[("url", "https://api.z.ai/api/paas/v4")]),
        Err(Rejected::NotOffered(Param::Url))
    );
    assert_eq!(
        site(&[("auth", "account"), ("site", "zai")]),
        Ok(Some(ZaiFamily::Zai))
    );
    assert_eq!(
        site(&[("site", "ZAI")]),
        Err(Rejected::Invalid(Param::Site))
    );
    assert_eq!(
        site(&[("site", "china")]),
        Err(Rejected::Invalid(Param::Site))
    );
    // 只有 Z.ai / BigModel 有站点
    for s in SERVICES.iter().filter(|s| s.id != ImportService::Zai) {
        assert_eq!(
            for_service(s, &[("site", "zai")]),
            Err(Rejected::NotOffered(Param::Site)),
            "{}",
            s.id.slug()
        );
    }
    // 别的服务没有站点这一项
    assert_eq!(relay(&[]).unwrap().site, None);
}

#[test]
fn the_url_rule_follows_the_service() {
    // 没有固定地址的四种：给了 `service` 就得带地址
    for s in ["custom", "thinkwatch", "sub2api", "newapi"] {
        assert_eq!(
            pp(&[("service", s)]),
            Err(Rejected::Missing(Param::Url)),
            "{s}"
        );
        assert!(relay_like(s, &[]).is_ok(), "{s}");
    }
    // 有自己地址的：不给就是它，给了得一模一样
    for s in SERVICES {
        if let Address::Own { address } = s.address {
            let got = pp(&[("service", s.id.slug())]).unwrap();
            assert_eq!(got.base_url, None, "{}", s.id.slug());
            assert!(pp(&[("service", s.id.slug()), ("url", address)]).is_ok());
            assert!(pp(&[("service", s.id.slug()), ("url", &format!("{address}/"))]).is_ok());
            for other in [
                format!("{address}/v1"),
                "https://relay.example".to_string(),
                address.replace("https://", "https://x."),
            ] {
                assert_eq!(
                    pp(&[("service", s.id.slug()), ("url", &other)]),
                    Err(Rejected::NotOffered(Param::Url)),
                    "{} {other}",
                    s.id.slug()
                );
            }
        }
    }
    // Bedrock：VPC 端点、代理照用；Ollama：别的端口、别的本机地址照用
    for (s, url) in [
        (
            "bedrock",
            "https://vpce-0abc.bedrock-runtime.us-east-1.vpce.amazonaws.com",
        ),
        (
            "bedrock",
            "https://bedrock-runtime.ap-northeast-1.amazonaws.com",
        ),
        ("ollama", "http://localhost:11500"),
        ("ollama", "https://ollama.lan.example"),
    ] {
        assert_eq!(
            pp(&[("service", s), ("url", url)])
                .unwrap()
                .base_url
                .as_deref(),
            Some(url)
        );
    }
    // 地址的写法照接口地址的规矩：内网另一台机器上的 Ollama 可以是明文的，公网上的不行
    assert!(pp(&[("service", "ollama"), ("url", "http://192.168.1.5:11434")]).is_ok());
    assert_eq!(
        pp(&[
            ("service", "ollama"),
            ("url", "http://ollama.example.com:11434")
        ]),
        Err(Rejected::Invalid(Param::Url))
    );
}

#[test]
fn protocol_is_accepted_only_where_the_dialog_offers_it() {
    for s in SERVICES {
        for proto in LINK_PROTOCOLS {
            let got = for_service(s, &[("protocol", proto.slug())]);
            let offered = match s.protocols {
                Protocols::Fixed { protocol } => protocol == Some(*proto),
                Protocols::Choice { protocols } => protocols.contains(proto),
            };
            if offered {
                assert_eq!(
                    got.map(|x| x.protocol),
                    Ok(Some(*proto)),
                    "{} {proto}",
                    s.id.slug()
                );
            } else {
                assert_eq!(
                    got,
                    Err(Rejected::NotOffered(Param::Protocol)),
                    "{} {proto}",
                    s.id.slug()
                );
            }
        }
    }
    // 只收那四种写法
    for bad in [
        "chatgpt",
        "bedrock",
        "Anthropic",
        "openai",
        "auto",
        "openai_chat",
    ] {
        assert_eq!(
            relay(&[("protocol", bad)]),
            Err(Rejected::Invalid(Param::Protocol)),
            "{bad}"
        );
    }
}

#[test]
fn key_is_only_for_api_key_auth_and_not_for_ollama() {
    assert_eq!(
        pp(&[("service", "ollama"), ("key", "k")]),
        Err(Rejected::NotOffered(Param::Key))
    );
    assert_eq!(
        pp(&[
            ("service", "custom"),
            ("url", "https://relay.example"),
            ("auth", "oauth"),
            ("oauth_endpoint", "https://relay.example/token"),
            ("oauth_refresh", "r"),
            ("key", "k"),
        ]),
        Err(Rejected::NotOffered(Param::Key))
    );
    // Bedrock 的 API 密钥就是 `key`
    assert_eq!(
        pp(&[("service", "bedrock"), ("key", "ABSKabc=")])
            .unwrap()
            .key
            .as_deref(),
        Some("ABSKabc=")
    );
    for ok in ["sk-abc_123.~+/=:", "a", "ABSK/xyz=="] {
        assert!(with_key(&enc(ok)).is_ok(), "{ok}");
    }
    for bad in [
        "sk%20a",
        "sk+a",
        "sk%21",
        "sk%40a",
        "sk%2Ca",
        "sk%22",
        "%E4%B8%AD",
    ] {
        assert_eq!(with_key(bad), Err(Rejected::Invalid(Param::Key)), "{bad}");
    }
}

#[test]
fn oauth_needs_an_endpoint_and_a_refresh_token() {
    let oauth = |extra: &[(&str, &str)]| {
        let mut all = vec![
            ("service", "custom"),
            ("url", "https://api.relay.example"),
            ("auth", "oauth"),
        ];
        all.extend_from_slice(extra);
        pp(&all)
    };
    let got = oauth(&[
        ("oauth_endpoint", "https://auth.relay.example/oauth/token"),
        ("oauth_refresh", &"r".repeat(MAX_LONG_KEY)),
        ("oauth_client_id", "cli"),
        ("oauth_client_secret", "sec"),
    ])
    .unwrap();
    assert_eq!(
        got.oauth,
        Some(ImportOAuth {
            endpoint: "https://auth.relay.example/oauth/token".into(),
            refresh: "r".repeat(MAX_LONG_KEY),
            client_id: Some("cli".into()),
            client_secret: Some("sec".into()),
        })
    );
    assert_eq!(
        oauth(&[("oauth_refresh", "r")]),
        Err(Rejected::Missing(Param::OauthEndpoint))
    );
    assert_eq!(
        oauth(&[("oauth_endpoint", "https://a.example/t")]),
        Err(Rejected::Missing(Param::OauthRefresh))
    );
    let both = |extra: (&str, &str)| {
        oauth(&[
            ("oauth_endpoint", "https://a.example/t"),
            ("oauth_refresh", "r"),
            extra,
        ])
    };
    assert_eq!(
        both(("oauth_client_id", &"c".repeat(MAX_KEY + 1))),
        Err(Rejected::Invalid(Param::OauthClientId))
    );
    assert_eq!(
        both(("oauth_client_secret", "a b")),
        Err(Rejected::Invalid(Param::OauthClientSecret))
    );
    assert_eq!(
        oauth(&[
            ("oauth_endpoint", "https://a.example/t"),
            ("oauth_refresh", &"r".repeat(MAX_LONG_KEY + 1)),
        ]),
        Err(Rejected::Invalid(Param::OauthRefresh))
    );
    // 端点和接口地址一样的规矩，路径原样留着
    for bad in [
        "http://auth.example/token",
        "https://auth.example/token?x=1",
        "https://u:p@auth.example/token",
        "javascript:alert(1)",
        "auth.example/token",
    ] {
        assert_eq!(
            oauth(&[("oauth_endpoint", bad), ("oauth_refresh", "r")]),
            Err(Rejected::Invalid(Param::OauthEndpoint)),
            "{bad}"
        );
    }
    assert_eq!(
        oauth(&[
            ("oauth_endpoint", "https://auth.example/token/"),
            ("oauth_refresh", "r")
        ])
        .unwrap()
        .oauth
        .unwrap()
        .endpoint,
        "https://auth.example/token/"
    );
    // 不是 OAuth 的不收这几项
    for k in [
        "oauth_endpoint",
        "oauth_refresh",
        "oauth_client_id",
        "oauth_client_secret",
    ] {
        let want = Param::from_name(k).unwrap();
        assert_eq!(
            relay(&[(k, "https://a.example/t")]),
            Err(Rejected::NotOffered(want)),
            "{k}"
        );
    }
}

#[test]
fn bedrock_region_and_access_keys() {
    let bedrock = |extra: &[(&str, &str)]| {
        let mut all = vec![("service", "bedrock")];
        all.extend_from_slice(extra);
        pp(&all)
    };
    let got = bedrock(&[
        ("auth", "aws-keys"),
        ("region", "eu-central-1"),
        ("aws_access_key_id", "AKIAIOSFODNN7EXAMPLE"),
        (
            "aws_secret_access_key",
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        ),
        ("aws_session_token", &"T".repeat(MAX_LONG_KEY)),
    ])
    .unwrap();
    assert_eq!(got.region.as_deref(), Some("eu-central-1"));
    assert_eq!(got.base_url, None);
    assert_eq!(
        got.aws,
        Some(ImportAwsKeys {
            access_key_id: "AKIAIOSFODNN7EXAMPLE".into(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".into(),
            session_token: Some("T".repeat(MAX_LONG_KEY)),
        })
    );
    let keys = [
        ("auth", "aws-keys"),
        ("aws_access_key_id", "AKIAIOSFODNN7EXAMPLE"),
        ("aws_secret_access_key", "s"),
    ];
    assert_eq!(
        bedrock(&keys[..2]),
        Err(Rejected::Missing(Param::AwsSecretAccessKey))
    );
    assert_eq!(
        bedrock(&[keys[0], keys[2]]),
        Err(Rejected::Missing(Param::AwsAccessKeyId))
    );
    for bad in [
        "AKIA",
        "akiaiosfodnn7example",
        "AKIA-IOSFODNN7EXAMPLE",
        &"A".repeat(129),
    ] {
        assert_eq!(
            bedrock(&[keys[0], ("aws_access_key_id", bad), keys[2]]),
            Err(Rejected::Invalid(Param::AwsAccessKeyId)),
            "{bad}"
        );
    }
    assert!(bedrock(&[keys[0], ("aws_access_key_id", &"A".repeat(16)), keys[2]]).is_ok());
    assert!(bedrock(&[keys[0], ("aws_access_key_id", &"7".repeat(128)), keys[2]]).is_ok());
    assert_eq!(
        bedrock(&[
            keys[0],
            keys[1],
            ("aws_secret_access_key", &"s".repeat(MAX_KEY + 1))
        ]),
        Err(Rejected::Invalid(Param::AwsSecretAccessKey))
    );
    assert_eq!(
        bedrock(&[
            keys[0],
            keys[1],
            keys[2],
            ("aws_session_token", &"t".repeat(MAX_LONG_KEY + 1))
        ]),
        Err(Rejected::Invalid(Param::AwsSessionToken))
    );
    // 访问密钥只给 aws-keys
    assert_eq!(
        bedrock(&[keys[1]]),
        Err(Rejected::NotOffered(Param::AwsAccessKeyId))
    );
    assert_eq!(
        relay(&[("aws_session_token", "t")]),
        Err(Rejected::NotOffered(Param::AwsSessionToken))
    );
    // 区域：写法、只有 Bedrock 有
    for ok in ["us-east-1", "a", &"a".repeat(32)] {
        assert!(bedrock(&[("region", ok)]).is_ok(), "{ok}");
    }
    for bad in ["US-EAST-1", "us_east_1", &"a".repeat(33), "us east"] {
        assert_eq!(
            bedrock(&[("region", bad)]),
            Err(Rejected::Invalid(Param::Region)),
            "{bad}"
        );
    }
    assert_eq!(
        relay(&[("region", "us-east-1")]),
        Err(Rejected::NotOffered(Param::Region))
    );
    // 标准地址里的区域就是那一栏：链接给的得一样
    let std = ("url", "https://bedrock-runtime.eu-west-1.amazonaws.com");
    assert!(bedrock(&[std, ("region", "eu-west-1")]).is_ok());
    assert_eq!(
        bedrock(&[std, ("region", "us-east-1")]),
        Err(Rejected::Invalid(Param::Region))
    );
    // 别的地址（VPC 端点）：只在访问密钥签名时有区域那一栏
    let vpc = (
        "url",
        "https://vpce-1.bedrock-runtime.us-east-1.vpce.amazonaws.com",
    );
    assert_eq!(
        bedrock(&[vpc, ("region", "us-east-1")]),
        Err(Rejected::NotOffered(Param::Region))
    );
    assert!(bedrock(&[vpc, ("region", "us-east-1"), keys[0], keys[1], keys[2]]).is_ok());
}

#[test]
fn headers_follow_the_rules() {
    let h = |v: &str| relay(&[("headers", v)]);
    assert_eq!(
        h("X-A:1").unwrap().headers,
        [ImportHeader {
            name: "X-A".into(),
            value: "1".into()
        }]
    );
    assert_eq!(
        h("X-A:   spaced value  ").unwrap().headers[0].value,
        "spaced value"
    );
    let sixteen: Vec<String> = (0..MAX_HEADERS).map(|i| format!("X-H{i}: v")).collect();
    assert_eq!(h(&sixteen.join("\n")).unwrap().headers.len(), MAX_HEADERS);
    let seventeen: Vec<String> = (0..=MAX_HEADERS).map(|i| format!("X-H{i}: v")).collect();
    let token = "!#%&'*+-.^_`|~0aZ";
    assert_eq!(h(&format!("{token}: v")).unwrap().headers[0].name, token);
    for bad in [
        seventeen.join("\n"),
        "X-A".into(),
        ": v".into(),
        "X-A:".into(),
        "X-A:   ".into(),
        "X A: v".into(),
        "X-A : v".into(),
        "X-(A): v".into(),
        "X-A: v\n".into(),
        "\nX-A: v".into(),
        "X-A: 1\nx-a: 2".into(),
        format!("{}: v", "h".repeat(MAX_HEADER_NAME + 1)),
        format!("X-A: {}", "v".repeat(MAX_HEADER_VALUE + 1)),
        "X-A: caf\u{e9}".into(),
        "X-Ä: v".into(),
        "X-A: a\r\nX-B: b".into(),
    ] {
        assert_eq!(h(&bad), Err(Rejected::Invalid(Param::Headers)), "{bad:?}");
    }
    assert!(h(&format!("{}: v", "h".repeat(MAX_HEADER_NAME))).is_ok());
    assert!(h(&format!("X-A: {}", "v".repeat(MAX_HEADER_VALUE))).is_ok());
}

#[test]
fn credential_and_transport_headers_are_denied() {
    for name in DENIED_HEADERS
        .iter()
        .map(|s| s.to_string())
        .chain(DENIED_HEADERS.iter().map(|s| s.to_ascii_uppercase()))
        .chain([
            "Authorization".to_string(),
            "X-Api-Key".to_string(),
            "proxy-connection".to_string(),
            "Proxy-Anything".to_string(),
            "sec-fetch-mode".to_string(),
            "Sec-CH-UA".to_string(),
        ])
    {
        assert_eq!(
            relay(&[("headers", &format!("X-Ok: 1\n{name}: v"))]),
            Err(Rejected::Invalid(Param::Headers)),
            "{name}"
        );
    }
    for ok in [
        "X-Proxy",
        "Secret",
        "X-Sec-Token",
        "Authorization-Extra",
        "Hostname",
        "Te-Extra",
    ] {
        assert!(relay(&[("headers", &format!("{ok}: v"))]).is_ok(), "{ok}");
    }
}

#[test]
fn client_identity_only_where_offered() {
    for s in SERVICES {
        let got = for_service(s, &[("client_identity", "on")]);
        if s.client_identity {
            assert_eq!(got.map(|x| x.client_identity), Ok(true), "{}", s.id.slug());
        } else {
            assert_eq!(
                got,
                Err(Rejected::NotOffered(Param::ClientIdentity)),
                "{}",
                s.id.slug()
            );
        }
    }
    for bad in ["off", "true", "1", "ON", "yes"] {
        assert_eq!(
            relay(&[("client_identity", bad)]),
            Err(Rejected::Invalid(Param::ClientIdentity)),
            "{bad}"
        );
    }
}

#[test]
fn concurrency_is_a_plain_whole_number_up_to_a_thousand() {
    for (v, n) in [("1", 1), ("8", 8), ("999", 999), ("1000", 1000)] {
        assert_eq!(relay(&[("concurrency", v)]).unwrap().concurrency, Some(n));
    }
    for bad in [
        "0",
        "1001",
        "01",
        "+1",
        "-1",
        "1.0",
        "1e3",
        "4294967296",
        " 8",
        "八",
    ] {
        assert_eq!(
            relay(&[("concurrency", bad)]),
            Err(Rejected::Invalid(Param::Concurrency)),
            "{bad}"
        );
    }
}

/// 用量上限：`周期|计量|上限|N|缓存读取`，和 core 的配置校验同一套规矩
#[test]
fn limits_are_checked_like_the_config() {
    let lim = |per, every, measure, max, cache_reads| ImportLimit {
        per,
        every,
        measure,
        max,
        cache_reads,
    };
    assert_eq!(
        relay(&[(
            "limits",
            "minute|tokens|10000000|5;day|cost|5.5;week|tokens|900000||y;hour|requests|600|24;month|cost|0.01"
        )])
        .unwrap()
        .limits,
        vec![
            lim(LimitPer::Minute, 5, LimitMeasure::Tokens, 10_000_000, false),
            lim(LimitPer::Day, 1, LimitMeasure::Cost, 5_500_000, false),
            lim(LimitPer::Week, 1, LimitMeasure::Tokens, 900_000, true),
            lim(LimitPer::Hour, 24, LimitMeasure::Requests, 600, false),
            lim(LimitPer::Month, 1, LimitMeasure::Cost, 10_000, false),
        ]
    );
    // N 不同就不是同一条；缓存读取算法不同也不是
    assert_eq!(
        relay(&[(
            "limits",
            "minute|tokens|100|5;minute|tokens|100;minute|tokens|100||y"
        )])
        .unwrap()
        .limits
        .len(),
        3
    );
    for bad in [
        "day|cost",
        "day|cost|5|1|y|x",
        "days|cost|5",
        "day|usd|5",
        "day|requests|0",
        "day|requests|01",
        "day|requests|1.5",
        "day|requests|1000000000000000",
        "day|cost|0",
        "day|cost|0.009999",
        "day|cost|5.1234567",
        "day|cost|05",
        "day|cost|.5",
        "day|cost|5.",
        "day|requests|5|2",
        "day|requests|5|1",
        "minute|requests|5|0",
        "minute|requests|5|61",
        "hour|requests|5|25",
        "minute|requests|5|05",
        "day|requests|5||y",
        "day|cost|5||y",
        "day|tokens|5||n",
        "day|cost|5;day|cost|6",
        "minute|tokens|5|3;minute|tokens|9|3",
        "day|requests|5;",
    ] {
        assert_eq!(
            relay(&[("limits", bad)]),
            Err(Rejected::Invalid(Param::Limits)),
            "{bad}"
        );
    }
    let many = vec!["day|requests|1"; MAX_LIMITS + 1].join(";");
    assert_eq!(
        relay(&[("limits", &many)]),
        Err(Rejected::Invalid(Param::Limits))
    );
    // 写回链接：N 是 1、缓存读取不算的那一格省掉，费用写美元
    let q = relay(&[(
        "limits",
        "minute|tokens|10000000|5;day|cost|5.50;week|tokens|900000||y;hour|requests|60|1",
    )])
    .unwrap();
    assert!(
        generate(&q).ends_with(
            "&limits=minute%7Ctokens%7C10000000%7C5%3Bday%7Ccost%7C5.5%3Bweek%7Ctokens%7C900000%7C%7Cy%3Bhour%7Crequests%7C60"
        ),
        "{}",
        generate(&q)
    );
    round_trip(&q);
}

#[test]
fn balance_is_only_for_custom() {
    let custom = |v: &str| relay_like("custom", &[("balance", v)]);
    for (v, want) in [
        ("off", BalanceSetting::Off),
        ("openrouter", BalanceSetting::Openrouter),
        ("deepseek", BalanceSetting::Deepseek),
        ("moonshot", BalanceSetting::Moonshot),
        ("sub2api", BalanceSetting::Sub2api),
        ("newapi", BalanceSetting::Newapi),
        ("thinkwatch", BalanceSetting::Thinkwatch),
    ] {
        assert_eq!(custom(v).unwrap().balance, Some(want), "{v}");
    }
    for bad in ["auto", "Off", "kimi", "none"] {
        assert_eq!(custom(bad), Err(Rejected::Invalid(Param::Balance)), "{bad}");
    }
    for s in SERVICES.iter().filter(|s| s.id != ImportService::Custom) {
        assert_eq!(
            for_service(s, &[("balance", "off")]),
            Err(Rejected::NotOffered(Param::Balance)),
            "{}",
            s.id.slug()
        );
    }
    // 没写服务类型、地址认不出来：就是「自定义」
    assert_eq!(
        p("thinkwatch://import?url=https://relay.example&balance=newapi")
            .unwrap()
            .balance,
        Some(BalanceSetting::Newapi)
    );
}

#[test]
fn model_lists_are_validated_and_deduplicated() {
    let got = relay(&[("models", "claude-sonnet-5,openai/gpt-5,claude-sonnet-5")]).unwrap();
    assert_eq!(got.models, ["claude-sonnet-5", "openai/gpt-5"]);
    assert_eq!(
        relay(&[("models", "a:b@c+d_e.f-g/h")]).unwrap().models,
        ["a:b@c+d_e.f-g/h"]
    );
    for m in [
        "a,,b", "a,", ",a", "a b", "a;b", "<script>", "a*", "a?", "a|b",
    ] {
        assert_eq!(
            relay(&[("models", m)]),
            Err(Rejected::Invalid(Param::Models)),
            "{m}"
        );
    }
}

#[test]
fn models_only_takes_ids_and_globs() {
    let got = relay(&[("models_only", "claude-*,gpt-5?,o4-mini,o4-mini")]).unwrap();
    assert_eq!(
        got.models_only,
        Some(vec!["claude-*".into(), "gpt-5?".into(), "o4-mini".into()])
    );
    let many: Vec<String> = (0..=MAX_MODELS).map(|i| format!("m{i}*")).collect();
    for bad in [
        "a,,b".to_string(),
        "a b".into(),
        "[a]".into(),
        "a|b".into(),
        many.join(","),
        "*".repeat(MAX_MODEL + 1),
    ] {
        assert_eq!(
            relay(&[("models_only", &bad)]),
            Err(Rejected::Invalid(Param::ModelsOnly)),
            "{bad}"
        );
    }
    assert!(relay(&[("models_only", &many[..MAX_MODELS].join(","))]).is_ok());
}

#[test]
fn specs_follow_the_rules() {
    let s = |v: &str| relay(&[("specs", v)]);
    assert_eq!(
        s("m|1|10000000|n|n").unwrap().specs,
        [ImportSpec {
            model: "m".into(),
            context_window: Some(1),
            max_output_tokens: Some(MAX_SPEC_TOKENS),
            reasoning: Some(false),
            image_input: Some(false),
        }]
    );
    assert_eq!(s("m||||y").unwrap().specs[0].image_input, Some(true));
    let many: Vec<String> = (0..=MAX_MODELS).map(|i| format!("m{i}|1|||")).collect();
    assert!(s(&many[..MAX_MODELS].join(";")).is_ok());
    for bad in [
        many.join(";"),
        "m||||".into(),
        "m|1|||".to_string() + ";m|2|||",
        "m|1||".into(),
        "m|1||||".into(),
        "|1|||".into(),
        "m*|1|||".into(),
        "m|0|||".into(),
        "m|10000001|||".into(),
        "m|01|||".into(),
        "m|+1|||".into(),
        "m|1.5|||".into(),
        "m|||yes|".into(),
        "m||||Y".into(),
        "m|1|||;".into(),
        ";m|1|||".into(),
    ] {
        assert_eq!(s(&bad), Err(Rejected::Invalid(Param::Specs)), "{bad}");
    }
}

#[test]
fn billing_and_the_new_price_sheet() {
    assert_eq!(
        relay(&[("billing", "free")]).unwrap().billing,
        Some(Billing::Free)
    );
    for bad in ["Free", "subscription", "per_token", "none"] {
        assert_eq!(
            relay(&[("billing", bad)]),
            Err(Rejected::Invalid(Param::Billing)),
            "{bad}"
        );
    }
    // 只有倍率：新价目表，没有覆盖
    assert_eq!(
        relay(&[("price_multiplier", "0.85")]).unwrap().price_sheet,
        Some(ImportSheet {
            multiplier: 0.85,
            prices: vec![]
        })
    );
    // 只有价格：倍率是 1
    let only = relay(&[("prices", "m|3|15")]).unwrap().price_sheet.unwrap();
    assert_eq!(only.multiplier, 1.0);
    assert_eq!(only.prices[0].cache_write_1h, 3.0);
    for ok in ["100", "100.000000", "0.000001", "1", "12.5", "007.5"] {
        assert!(relay(&[("price_multiplier", ok)]).is_ok(), "{ok}");
    }
    for bad in [
        "999.999999",
        "0",
        "0.0",
        "100.000001",
        "101",
        "1000",
        "-1",
        "+1",
        "1.",
        ".5",
        "1.0000001",
        "1,5",
        "1e2",
        "NaN",
        "inf",
    ] {
        assert_eq!(
            relay(&[("price_multiplier", bad)]),
            Err(Rejected::Invalid(Param::PriceMultiplier)),
            "{bad}"
        );
    }
    let price = |v: &str| relay(&[("prices", v)]);
    assert!(price("m|0|0").is_ok());
    assert!(price("m|999999.999999|0.000001|1|2|3").is_ok());
    assert_eq!(
        price("m|1|2||4|").unwrap().price_sheet.unwrap().prices[0],
        ImportPrice {
            model: "m".into(),
            input: 1.0,
            output: 2.0,
            cache_read: 1.0,
            cache_write_5m: 4.0,
            cache_write_1h: 1.0,
        }
    );
    let many: Vec<String> = (0..=MAX_MODELS).map(|i| format!("m{i}|1|2")).collect();
    assert!(price(&many[..MAX_MODELS].join(";")).is_ok());
    for bad in [
        many.join(";"),
        "m|1".into(),
        "m||2".into(),
        "m|1|".into(),
        "m|1|2|3|4|5|6".into(),
        "m|1|2;m|3|4".into(),
        "m*|1|2".into(),
        "|1|2".into(),
        "m|1000000|2".into(),
        "m|1.1234567|2".into(),
        "m|-1|2".into(),
        "m|1|2|x".into(),
        "m|1|2;".into(),
    ] {
        assert_eq!(price(&bad), Err(Rejected::Invalid(Param::Prices)), "{bad}");
    }
    // 不计费时用不上价目表
    assert_eq!(
        relay(&[("billing", "free"), ("price_multiplier", "1")]),
        Err(Rejected::NotOffered(Param::PriceMultiplier))
    );
    assert_eq!(
        relay(&[("billing", "free"), ("prices", "m|1|2")]),
        Err(Rejected::NotOffered(Param::Prices))
    );
    // Ollama 默认不计费；写明按量计费就可以
    assert_eq!(
        pp(&[("service", "ollama"), ("prices", "m|1|2")]),
        Err(Rejected::NotOffered(Param::Prices))
    );
    assert!(
        pp(&[
            ("service", "ollama"),
            ("billing", "per-token"),
            ("prices", "m|1|2")
        ])
        .is_ok()
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
        assert_eq!(with_url(url), Err(Rejected::Invalid(Param::Url)), "{url}");
    }
}

/// `http://` 只给本机和内网（约定 v2.2）：每一段的边上都试一下
#[test]
fn plain_http_is_only_for_this_machine_and_private_networks() {
    for url in [
        // 本机
        "http://127.0.0.1:8317",
        "http://localhost:3000/v1",
        "http://[::1]:9000",
        // 私有网段的 IPv4，各段的头尾
        "http://10.0.0.0",
        "http://10.255.255.255:8080",
        "http://172.16.0.1",
        "http://172.31.255.255",
        "http://192.168.0.1",
        "http://192.168.255.254",
        "http://100.64.0.1",
        "http://100.127.255.255",
        "http://169.254.0.1",
        "http://169.254.255.255",
        // 私有网段的 IPv6
        "http://[fc00::1]",
        "http://[fdff:ffff::1]:8080",
        "http://[fe80::1]",
        "http://[febf::1]",
        // 单段的主机名、内网后缀
        "http://corp",
        "http://gateway:8080/v1",
        "http://example.corp",
        "http://gw.example.local",
        "http://gw.lan",
        "http://gw.internal",
        "http://gw.intranet",
        "http://gw.home.arpa",
        "http://gw.localhost",
        "http://GW.Example.CORP",
    ] {
        let got = with_url(url).unwrap_or_else(|e| panic!("{url}: {e:?}"));
        assert_eq!(
            got.base_url.as_deref(),
            Some(url.to_ascii_lowercase().trim_end_matches('/')),
            "{url}"
        );
    }
    for url in [
        // 公网的、紧挨着私有网段的
        "http://9.255.255.255",
        "http://11.0.0.1",
        "http://172.15.255.255",
        "http://172.32.0.1",
        "http://192.167.255.255",
        "http://192.169.0.1",
        "http://100.63.255.255",
        "http://100.128.0.1",
        "http://169.253.255.255",
        "http://169.255.0.1",
        "http://127.0.0.2",
        "http://8.8.8.8",
        "http://[fbff::1]",
        "http://[fe00::1]",
        "http://[fec0::1]",
        "http://[2001:db8::1]",
        "http://[::ffff:192.168.1.1]",
        // 公网的名字、长得像内网的名字
        "http://relay.example",
        "http://example.com",
        "http://corp.example.com",
        "http://example.corp.com",
        "http://localhost.evil.example",
        "http://127.0.0.1.nip.io",
        "http://gw.locall",
        "http://gwcorp",
    ] {
        let want = if url == "http://gwcorp" {
            // 单段的主机名都算内网
            Ok(())
        } else {
            Err(Rejected::Invalid(Param::Url))
        };
        assert_eq!(with_url(url).map(|_| ()), want, "{url}");
    }
    // OAuth 的 Token 端点同样的规矩
    let endpoint = |e: &str| {
        pp(&[
            ("service", "custom"),
            ("url", "http://gw.corp"),
            ("auth", "oauth"),
            ("oauth_endpoint", e),
            ("oauth_refresh", "r"),
        ])
        .map(|x| x.oauth.unwrap().endpoint)
    };
    assert_eq!(
        endpoint("http://10.1.2.3/token"),
        Ok("http://10.1.2.3/token".into())
    );
    assert_eq!(
        endpoint("http://sso.corp/token"),
        Ok("http://sso.corp/token".into())
    );
    assert_eq!(
        endpoint("http://sso.example.com/token"),
        Err(Rejected::Invalid(Param::OauthEndpoint))
    );
    // https 到哪里都可以：对话框写明发往哪里，按「下一步」之前不发任何请求
    assert!(with_url("https://192.168.1.1").is_ok());
    assert!(with_url("https://example.com").is_ok());
    // 企业版的按钮：内网的明文网关也能用
    assert_eq!(
        pp(&[
            ("service", "thinkwatch"),
            ("name", "thinkwatch"),
            ("url", "http://10.0.0.5:8080"),
            ("key", "tw-k"),
        ])
        .unwrap()
        .base_url
        .as_deref(),
        Some("http://10.0.0.5:8080")
    );
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
        "https://relay.example\\@evil.example",
        "https://relay .example",
    ] {
        assert_eq!(with_url(url), Err(Rejected::Invalid(Param::Url)), "{url}");
    }
}

#[test]
fn internationalized_hosts_are_ascii() {
    // 西里尔字母的 а 冒充拉丁字母 a
    let got = with_url("https://%D0%B0pple.example").unwrap();
    let base = got.base_url.unwrap();
    assert!(base.is_ascii());
    assert!(base.starts_with("https://xn--"), "{base}");
    let got = with_url("https://%E4%BE%8B%E5%AD%90.example/v1").unwrap();
    assert_eq!(
        got.base_url.as_deref(),
        Some("https://xn--fsqu00a.example/v1")
    );
    let got = pp(&[
        ("service", "custom"),
        ("url", "https://relay.example"),
        ("auth", "oauth"),
        ("oauth_endpoint", "https://例子.example/token"),
        ("oauth_refresh", "r"),
    ])
    .unwrap();
    assert_eq!(
        got.oauth.unwrap().endpoint,
        "https://xn--fsqu00a.example/token"
    );
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
        "%3Cimg%20src%3Dx%3E",
        "a%22b",
        "a%60b",
    ] {
        assert_eq!(
            with_name(name),
            Err(Rejected::Invalid(Param::Name)),
            "{name}"
        );
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

/// 生成给界面核对的那一份和这里的表一致（文件本身由 `tests/ts_bindings.rs` 核对）
#[test]
fn the_service_table_is_complete() {
    let ids: Vec<&str> = SERVICES.iter().map(|s| s.id.slug()).collect();
    assert_eq!(
        ids,
        [
            "anthropic",
            "openai",
            "gemini",
            "deepseek",
            "zai",
            "bedrock",
            "openrouter",
            "thinkwatch",
            "sub2api",
            "newapi",
            "ollama",
            "custom"
        ]
    );
    let json: serde_json::Value = serde_json::from_str(&table_json()).unwrap();
    assert_eq!(json["services"].as_array().unwrap().len(), SERVICES.len());
    assert_eq!(
        json["services"][5]["address"]["default"],
        format!("https://bedrock-runtime.{BEDROCK_DEFAULT_REGION}.amazonaws.com")
    );
    for (_, s) in HOSTS {
        assert_ne!(*s, ImportService::Custom);
    }
}

// ---------------------------------------------------------- 一次只处理一条

fn proposal(url: &str) -> ImportLink {
    parse(&format!("thinkwatch://import?url={url}")).unwrap()
}

#[test]
fn a_burst_of_links_opens_one_dialog() {
    let gate = Gate::new();
    let t0 = Instant::now();
    let link = proposal("https://a.example");
    let accepted = (0..200)
        .filter(|i| gate.offer(link.clone(), t0 + Duration::from_millis(*i)))
        .count();
    assert_eq!(accepted, 1);
    assert_eq!(gate.take(), Some(link.clone()));
    // 对话框开着：再来的都丢掉，取也取不到第二份
    assert!(!gate.offer(link.clone(), t0 + Duration::from_secs(600)));
    assert_eq!(gate.take(), None);
    // 关掉之后的冷却期里也不收
    gate.close(t0 + Duration::from_secs(700));
    assert!(!gate.offer(link.clone(), t0 + Duration::from_secs(701)));
    assert!(gate.offer(link.clone(), t0 + Duration::from_secs(704)));
}

#[test]
fn cannot_import_takes_the_same_gate() {
    let gate = Gate::new();
    let t0 = Instant::now();
    let unsupported = parse(&format!("{OK}&newthing=1")).unwrap();
    assert!(gate.offer(unsupported.clone(), t0));
    assert!(!gate.offer(proposal("https://a.example"), t0));
    assert_eq!(gate.take(), Some(unsupported.clone()));
    assert!(!gate.offer(unsupported.clone(), t0 + Duration::from_secs(1)));
    gate.close(t0 + Duration::from_secs(2));
    assert!(gate.offer(unsupported, t0 + Duration::from_secs(6)));
}

#[test]
fn a_proposal_nobody_took_can_be_replaced_after_a_while() {
    let gate = Gate::new();
    let t0 = Instant::now();
    let a = proposal("https://a.example");
    let b = proposal("https://b.example");
    assert!(gate.offer(a, t0));
    assert!(!gate.offer(b.clone(), t0 + Duration::from_secs(5)));
    assert!(gate.offer(b.clone(), t0 + Duration::from_secs(61)));
    assert_eq!(gate.take(), Some(b));
}

#[test]
fn closing_does_not_drop_a_proposal_not_yet_taken() {
    let gate = Gate::new();
    let t0 = Instant::now();
    let a = proposal("https://a.example");
    assert!(gate.offer(a.clone(), t0));
    // 网页挂上时先报一次「关了」，再来取
    gate.close(t0);
    assert_eq!(gate.take(), Some(a));
}

/// New API 的聊天预设 `thinkwatch://import?service=newapi&url={address}&key={key}`：站点把
/// `{address}` 换成 `encodeURIComponent` 编码后的服务器地址，`{key}` 换成补上 `sk-` 的令牌
/// （不编码）。生成出来的这一条要原样收下
#[test]
fn a_new_api_chat_preset_link_is_accepted() {
    let got = p(&format!(
        "thinkwatch://import?service=newapi&url={}&key=sk-{}",
        enc("https://api.example.com"),
        "abc123XYZ"
    ))
    .unwrap();
    assert_eq!(got.service, ImportService::Newapi);
    assert_eq!(got.base_url.as_deref(), Some("https://api.example.com"));
    assert_eq!(got.key.as_deref(), Some("sk-abc123XYZ"));
    assert_eq!(got.protocol, None);
    assert_eq!(got.name, None);
    // 站点配在子路径下、带端口的也一样
    let sub = p(&format!(
        "thinkwatch://import?service=newapi&url={}&key=sk-abc",
        enc("https://relay.example:8443/newapi")
    ))
    .unwrap();
    assert_eq!(
        sub.base_url.as_deref(),
        Some("https://relay.example:8443/newapi")
    );
}

/// Sub2API 的「导入到 ThinkWatch Lite」：地址去掉末尾的 `/` 和 `/v1`，Antigravity 分组接上
/// `/antigravity` 并指定 Anthropic 协议，每个值都 `encodeURIComponent`
#[test]
fn sub2api_import_button_links_are_accepted() {
    let plain = pp(&[
        ("service", "sub2api"),
        ("url", "https://relay.example"),
        ("key", "sk-a+b/c=="),
    ])
    .unwrap();
    assert_eq!(plain.service, ImportService::Sub2api);
    assert_eq!(plain.base_url.as_deref(), Some("https://relay.example"));
    assert_eq!(plain.key.as_deref(), Some("sk-a+b/c=="));
    let antigravity = pp(&[
        ("service", "sub2api"),
        ("url", "https://relay.example/antigravity"),
        ("protocol", "anthropic"),
        ("key", "sk-abc"),
    ])
    .unwrap();
    assert_eq!(
        antigravity.base_url.as_deref(),
        Some("https://relay.example/antigravity")
    );
    assert_eq!(antigravity.protocol, Some(Protocol::Anthropic));
}

// ---------------------------------------------------------- 生成（分享）与往返

/// 生成的链接按同一版解析出来的就是原来那一份；再写一遍还是同一条链接
#[track_caller]
fn round_trip(q: &ImportProposal) {
    let link = generate(q);
    assert!(link.len() <= MAX_LINK, "{link}");
    let back = p(&link).unwrap_or_else(|why| panic!("{why:?}: {link}"));
    assert_eq!(&back, q, "{link}");
    assert_eq!(generate(&back), link);
    // 网页形式的 `#` 之后和 `?` 之后是同一串
    assert_eq!(
        web_link(q).strip_prefix(WEB_PREFIX),
        link.strip_prefix(&format!("{PREFIX}?"))
    );
}

/// 一批各种写法的链接（每种服务、每种认证方式、高级设置、模型、规格、价目表）：解析出来的
/// 每一份都能原样写回去
#[test]
fn every_proposal_the_parser_accepts_round_trips() {
    let links: Vec<Vec<(&str, &str)>> = vec![
        vec![
            ("url", "https://api.relay.example/v1"),
            ("key", "sk-abc123"),
        ],
        vec![("service", "anthropic"), ("key", "sk-ant-1")],
        vec![
            ("service", "openai"),
            ("protocol", "openai-responses"),
            ("key", "sk-1"),
        ],
        vec![
            ("service", "openai"),
            ("auth", "account"),
            ("name", "chatgpt"),
        ],
        vec![("service", "gemini"), ("key", "AIza-1")],
        vec![("service", "deepseek"), ("key", "sk-ds")],
        vec![("service", "zai"), ("key", "z-1")],
        vec![("service", "zai"), ("site", "zai"), ("key", "z-1")],
        vec![("service", "zai"), ("url", ZAI_ZAI), ("key", "z-1")],
        vec![("service", "zai"), ("auth", "account"), ("site", "zai")],
        vec![("service", "zai"), ("auth", "account")],
        vec![
            ("service", "bedrock"),
            ("region", "ap-northeast-1"),
            ("key", "ABSK-1"),
        ],
        vec![
            ("service", "bedrock"),
            ("auth", "aws-keys"),
            (
                "url",
                "https://vpce-1.bedrock-runtime.us-west-2.vpce.amazonaws.com",
            ),
            ("region", "us-west-2"),
            ("aws_access_key_id", "AKIAIOSFODNN7EXAMPLE"),
            (
                "aws_secret_access_key",
                "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            ),
            ("aws_session_token", "FQoGZXIvYXdzE+token="),
        ],
        vec![
            ("service", "openrouter"),
            ("key", "sk-or-1"),
            ("models", "anthropic/claude-sonnet-5"),
        ],
        vec![
            ("service", "thinkwatch"),
            ("url", "http://gateway.corp"),
            ("key", "tw-1"),
        ],
        vec![
            ("service", "sub2api"),
            ("name", "公司中转"),
            ("url", "https://relay.example/antigravity"),
            ("protocol", "anthropic"),
            ("key", "sk-a+b/c=="),
            ("client_identity", "on"),
            ("concurrency", "8"),
            ("limits", "minute|tokens|10000000|5;day|cost|20"),
            ("models", "claude-opus-5-5,claude-sonnet-5-5"),
            ("models_only", "claude-*,gpt-5?"),
        ],
        vec![
            ("service", "newapi"),
            ("url", "https://new.example"),
            ("key", "sk-n"),
        ],
        vec![("service", "ollama")],
        vec![
            ("service", "ollama"),
            ("url", "http://192.168.1.20:11434"),
            ("billing", "per-token"),
        ],
        vec![
            ("service", "custom"),
            ("auth", "oauth"),
            ("url", "https://relay.example"),
            ("oauth_endpoint", "https://auth.relay.example/oauth/token"),
            ("oauth_refresh", "rt-1"),
            ("oauth_client_id", "cid"),
            ("oauth_client_secret", "csec"),
            ("headers", "X-Team: core\nX-Trace: on"),
            ("balance", "sub2api"),
        ],
        vec![
            ("service", "custom"),
            ("url", "https://relay.example"),
            ("specs", "m-1|200000|32000|y|n;m-2||8192||y"),
            ("billing", "free"),
        ],
        vec![
            ("service", "custom"),
            ("url", "https://relay.example"),
            ("price_multiplier", "1.055"),
        ],
        vec![
            ("service", "custom"),
            ("url", "https://relay.example"),
            ("prices", "m-1|3|15|0.3|3.75|6;m-2|0.5|1.5;m-3|1|2||1.25"),
        ],
        vec![
            ("service", "custom"),
            ("url", "https://relay.example"),
            ("price_multiplier", "0.8"),
            ("prices", "m-1|3.000001|15"),
        ],
    ];
    for l in &links {
        let q = pp(l).unwrap_or_else(|why| panic!("{why:?}: {l:?}"));
        round_trip(&q);
    }
}

/// 和对话框自己会填的一样的不写：服务自己的地址、固定的协议、默认的认证方式、默认的站点、
/// 没开的转发客户端身份
#[test]
fn defaults_are_left_out_of_the_link() {
    let q = pp(&[("service", "anthropic"), ("key", "sk-ant-1")]).unwrap();
    assert_eq!(
        generate(&q),
        "thinkwatch://import?service=anthropic&key=sk-ant-1"
    );
    let z = pp(&[("service", "zai"), ("url", ZAI_BIGMODEL), ("key", "z")]).unwrap();
    assert_eq!(
        generate(&z),
        "thinkwatch://import?service=zai&url=https%3A%2F%2Fopen.bigmodel.cn%2Fapi%2Fanthropic&key=z"
    );
    let z = pp(&[
        ("service", "zai"),
        ("auth", "account"),
        ("site", "bigmodel"),
    ])
    .unwrap();
    assert_eq!(generate(&z), "thinkwatch://import?service=zai&auth=account");
    // 价目表：倍率是 1 不写；缓存价和输入价一样的那几格空着、末尾的省掉
    let s = pp(&[
        ("service", "custom"),
        ("url", "https://r.example"),
        ("prices", "m|3|15|3|3.75|3"),
    ])
    .unwrap();
    assert!(
        generate(&s).ends_with("&prices=m%7C3%7C15%7C%7C3.75"),
        "{}",
        generate(&s)
    );
}

/// 分享：交回解析出来的那一份。地址规范化过（主机名小写、末尾没有 `/`）
#[test]
fn sharing_hands_back_what_the_receiver_will_see() {
    let mut q = blank("https://Relay.Example/v1/");
    q.service = ImportService::Sub2api;
    q.key = Some("sk-1".into());
    q.name = Some("公司中转".into());
    let ShareLink::Ready { app, web, proposal } = share(&q) else {
        panic!("{:?}", share(&q));
    };
    assert_eq!(
        proposal.base_url.as_deref(),
        Some("https://relay.example/v1")
    );
    assert_eq!(
        app,
        "thinkwatch://import?service=sub2api&name=%E5%85%AC%E5%8F%B8%E4%B8%AD%E8%BD%AC&url=https%3A%2F%2Frelay.example%2Fv1&key=sk-1"
    );
    assert_eq!(
        web,
        "https://thinkwat.ch/import#service=sub2api&name=%E5%85%AC%E5%8F%B8%E4%B8%AD%E8%BD%AC&url=https%3A%2F%2Frelay.example%2Fv1&key=sk-1"
    );
    round_trip(&proposal);
}

/// 写不进链接的值（`${变量名}`、链接不收的字符）说是哪一项；整条超过上限说多长
#[test]
fn values_a_link_cannot_carry_are_named_and_long_links_refused() {
    let mut q = blank("https://relay.example");
    q.key = Some("${OPENAI_API_KEY}".into());
    assert_eq!(
        share(&q),
        ShareLink::Invalid {
            param: Some("key".into())
        }
    );
    let mut q = blank("https://relay.example");
    q.name = Some("a/b".into());
    assert_eq!(
        share(&q),
        ShareLink::Invalid {
            param: Some("name".into())
        }
    );
    let mut q = blank("https://relay.example");
    q.price_sheet = Some(ImportSheet {
        multiplier: 1.0,
        prices: (0..64)
            .map(|i| ImportPrice {
                model: format!("vendor/{}-{i:03}", "m".repeat(100)),
                input: 123.456789,
                output: 234.567891,
                cache_read: 12.345678,
                cache_write_5m: 156.789012,
                cache_write_1h: 246.801357,
            })
            .collect(),
    });
    match share(&q) {
        ShareLink::TooLong { length } => assert!(length as usize > MAX_LINK),
        other => panic!("{other:?}"),
    }
}

/// 价格、倍率的写法：至多六位小数，末尾的 0 不写
#[test]
fn decimals_are_written_without_trailing_zeros() {
    assert_eq!(decimal_text(3.0), "3");
    assert_eq!(decimal_text(10.0), "10");
    assert_eq!(decimal_text(0.375), "0.375");
    assert_eq!(decimal_text(1.055), "1.055");
    assert_eq!(decimal_text(0.0), "0");
    assert_eq!(decimal_text(0.000_000_4), "0");
    assert_eq!(decimal_text(3.000_001), "3.000001");
}

/// 编码之后只剩链接里安全的字符：`&`、`=`、`+`、`#`、`%`、空格、中文都编码
#[test]
fn every_value_is_encoded_so_it_stays_one_parameter() {
    assert_eq!(encode("a&b=c+d #%"), "a%26b%3Dc%2Bd%20%23%25");
    assert_eq!(encode("中"), "%E4%B8%AD");
    assert_eq!(encode("m-1,m_2.x~"), "m-1,m_2.x~");
}
