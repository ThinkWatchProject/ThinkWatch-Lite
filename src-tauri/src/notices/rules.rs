//! 哪件事该说，说成什么样。
//!
//! **这一层只做翻译**：core 的事件和守护的状态 → [`Signal`]。要不要真的打断用户，
//! 由总线按去抖、去重、抑制、限流决定 —— 两件事分开，才能各自测。
//!
//! 文案纪律（和界面同一套）：陈述句，不出现第一人称；**不带密钥、提示词、
//! 工具参数** —— 系统通知在锁屏上也看得见。
//!
//! 英文按 macOS 通知的规矩：**标题每个词首字母大写、不带句末标点**，正文是完整的
//! 句子。上游和代理的名字加弯引号，免得一个小写的名字混在标题里认不出来。
//! 通知在事情发生的那一刻按当时的语言写成，之后换语言，已有的那几条不跟着变。
//!
//! **core 发来的原因按码说**（[`core_text`]，和界面同一张表）：中文通知里不嵌
//! core 的英文原句。表里没有的码才退回英文。

use tw_api::Event;

use crate::core_text;

use super::{Change, Level, Signal};

/// 建连卡在哪一步，一句话。
///
/// **只翻步骤，不翻原因。**原因是 core 发来的一整句英文，翻它要在这里
/// 再抄一份 core 的码表；而步骤是个封闭集合，几个词就够，指向的又正是
/// 一眼要看的那件事。完整的原因在上游页上。
fn l1_step(s: &tw_api::L1Stage) -> String {
    use tw_api::{L1Peer, L1Step};
    let step: &str = match s.step {
        L1Step::Config => tr!("配置", "configuration"),
        L1Step::Dns => tr!("DNS 解析", "DNS lookup"),
        L1Step::Tcp => tr!("TCP 握手", "TCP handshake"),
        L1Step::Tls => tr!("TLS 握手", "TLS handshake"),
        L1Step::Handshake => tr!("代理握手", "proxy handshake"),
    };
    // 代理握手本来就只对着代理，再加一句「到代理」是废话
    if s.peer == L1Peer::Proxy && s.step != L1Step::Handshake {
        tr!(format!("到代理的{step}"), format!("{step} to the proxy"))
    } else {
        step.to_string()
    }
}

/// 界面上的落点。**和 `App.tsx` 里的页面标识是同一套词** —— 写成一个不存在的
/// 标识，点通知就落到一页空白上（「设置」这一页曾经叫 `config`，改名时这里
/// 没跟上）
const UPSTREAMS: &str = "upstreams";
const SECURITY: &str = "security";
const MCP: &str = "mcp";
const PLUGINS: &str = "plugins";
const KEYS: &str = "keys";
/// 流量页，只看失败的那一批
const FAILED_REQUESTS: &str = "requests:failed";
const SETTINGS: &str = "settings";
/// 设置页的「网关监听」一节（`settings:<节>`，界面滚到那一节）
const LISTEN_SETTINGS: &str = "settings:listen";

/// 一个键默认落在哪一页（那一条已经不在列表里时用）。按键的种类，也就是冒号前那段
pub fn default_view(key: &str) -> &'static str {
    match key.split(':').next().unwrap_or(key) {
        "upstream" | "quota" | "credential" | "auth" | "writeback" | "proxy" => UPSTREAMS,
        "toolwall" | "secwatch" => SECURITY,
        // 客户端配置里的可疑内容在 MCP 页：服务器、技能、钩子和扫描发现都在那儿
        "scan" => MCP,
        "plugin" => PLUGINS,
        "keylimit" => KEYS,
        "failed" => FAILED_REQUESTS,
        // 价格设在上游页（每家上游的价目表）
        "unpriced" => UPSTREAMS,
        // 同步要处理的事在设置的「同步与备份」；密钥改写不成的在客户端页
        "sync" => crate::sync::SYNC_VIEW,
        "keysync" => "clients",
        // 网关、配置文件、监听，以及认不出来的：设置页至少能看到网关在不在跑
        _ => SETTINGS,
    }
}

/// 这个键开着的时候，压下哪些键（前缀匹配）。
///
/// **网关不在服务时不必再说它下面每一家怎么了** —— 那时用户要做的只有一件事。
pub fn suppresses(key: &str) -> &'static [&'static str] {
    match key {
        // 连着的远程 core 断了：和本机网关停了一样，它下面每一家怎么了都不必再说
        "gateway" | "remote" => &[
            "upstream:",
            "quota:",
            "credential:",
            "auth:",
            "proxy:",
            "toolwall:",
            "secwatch:",
            "writeback:",
        ],
        _ => &[],
    }
}

/// core 的一条事件要不要说、说什么。**一条事件可能对应多个键**（额度按窗口分）
pub fn from_event(ev: &Event) -> Vec<Signal> {
    match ev {
        Event::QuotaExhausted {
            provider,
            window,
            resets_at_ms,
            ..
        } => {
            // core 给的是重置的时刻：按现在去数还有多久
            let secs = resets_at_ms.map(|at| at.saturating_sub(super::now_ms()) / 1000);
            let reset = secs.map(after).unwrap_or_default();
            // 几分钟后就恢复的窗口不值得打断 —— 用户等一会儿就好了
            let level = match secs {
                Some(s) if s <= 300 => Level::Info,
                _ => Level::Warning,
            };
            vec![
                Signal::raised(
                    format!("quota:{provider}:{window}"),
                    level,
                    tr!(
                        format!("{provider} 的订阅额度已用完"),
                        format!("“{provider}” Subscription Quota Used Up")
                    ),
                )
                .body(tr!(
                    format!(
                        "{}额度已用完{}。经此上游的请求会被拒绝。",
                        window_label(window),
                        reset
                    ),
                    format!(
                        "The {} usage limit has been reached{}. Requests through this upstream will be rejected.",
                        window_label(window),
                        reset
                    )
                ))
                .view(UPSTREAMS),
            ]
        }
        // 窗口是空的：这一家的额度撤下了（GLM 的 key 被判定没有套餐），之前报过的窗口都
        // 不再作数。开着的是哪几个窗口的提醒，事件里没有 —— 这一家的全部收起
        Event::QuotaSeen {
            provider, windows, ..
        } if windows.is_empty() => vec![Signal::cleared_under(format!("quota:{provider}:"))],
        // 额度是按窗口报的：没到上限的窗口就是恢复了
        Event::QuotaSeen {
            provider, windows, ..
        } => windows
            .iter()
            .filter(|w| w.status.as_deref() != Some("rejected"))
            .map(|w| Signal::cleared(format!("quota:{provider}:{}", w.window)))
            .collect(),
        // **熔断打开才算出事。**冷却到点的那条 `closed` 只是「可以再试」，不是恢复了 ——
        // 当成恢复的话，一家一直不通的上游每分钟开合一次，去抖永远等不满。
        //
        // **只进应用内**：多数人配了回退，一家上游挂了请求照样有人接，为一次被接住的
        // 故障打断用户不值得；而熔断信号本身就会随流量开开合合
        Event::HealthChanged {
            provider, state, ..
        } if state == "open" => vec![
            Signal::raised(
                format!("upstream:{provider}"),
                Level::Info,
                tr!(
                    format!("上游「{provider}」无法连接"),
                    format!("Upstream “{provider}” Unreachable")
                ),
            )
            .body(
                tr!(
                    "连续多次请求失败，暂停向其转发。",
                    "Several consecutive requests failed. Forwarding to this upstream is paused."
                )
                .to_string(),
            )
            .view(UPSTREAMS),
        ],
        // 恢复要有证据：这家真的又接下了一个请求
        Event::RequestRouted { attempts, .. } => attempts
            .iter()
            .filter(|a| a.outcome == "served")
            .map(|a| Signal::cleared(format!("upstream:{}", a.provider)))
            .collect(),
        Event::CredentialExpired {
            provider, detail, ..
        } => {
            let detail = core_text::clause(detail);
            vec![
            Signal::raised(
                format!("credential:{provider}"),
                Level::Warning,
                tr!(
                    format!("{provider} 需要重新登录"),
                    format!("Sign In to “{provider}” Again")
                ),
            )
            .body(tr!(
                format!("{detail}。重新登录之前，经此上游的请求都会失败。"),
                format!(
                    "{detail}. Until the account is signed in again, requests through this upstream will fail."
                )
            ))
            .view(UPSTREAMS),
            ]
        }
        Event::LoginFinished {
            status, provider, ..
        } if status == "done" => provider
            .iter()
            .flat_map(|p| {
                [
                    Signal::cleared(format!("credential:{p}")),
                    Signal::cleared(format!("auth:{p}")),
                ]
            })
            .collect(),
        Event::AuthChanged {
            provider,
            state,
            status,
            ..
        } => {
            if state == "accepted" {
                return vec![Signal::cleared(format!("auth:{provider}"))];
            }
            let code = status
                .map(|s| tr!(format!("（{s}）"), format!(" ({s})")))
                .unwrap_or_default();
            vec![
                Signal::raised(
                    format!("auth:{provider}"),
                    Level::Warning,
                    tr!(
                        format!("{provider} 拒绝了当前凭据"),
                        format!("“{provider}” Rejected the Current Credential")
                    ),
                )
                .body(tr!(
                    format!("上游返回未授权{code}，该上游的凭据可能已失效。"),
                    format!(
                        "The upstream returned an unauthorized response{code}. The credential for this upstream may no longer be valid."
                    )
                ))
                .view(UPSTREAMS),
            ]
        }
        Event::ProxyChanged {
            proxy,
            state,
            failed,
            ..
        } => {
            if state == "reachable" {
                return vec![Signal::cleared(format!("proxy:{proxy}"))];
            }
            // **说的是卡在哪一步，不是 core 那句原因。**原因是 core 发来的
            // 英文，而这条通知在中文界面里也要读得通；步骤是个封闭集合，
            // 翻得了，而且它正是一眼要看的那件事 —— 卡在代理握手多半是
            // 密码错了，卡在 TCP 多半是代理没起来。完整的原因在上游页上。
            let why = failed
                .as_ref()
                .map(|s| {
                    let step = l1_step(s);
                    tr!(
                        format!("卡在{step}。"),
                        format!("It got stuck at the {step}. ")
                    )
                })
                .unwrap_or_default();
            vec![
                Signal::raised(
                    format!("proxy:{proxy}"),
                    Level::Warning,
                    tr!(
                        format!("代理「{proxy}」不通"),
                        format!("Proxy “{proxy}” Unreachable")
                    ),
                )
                .body(tr!(
                    format!("{why}经此代理的上游都无法连接。"),
                    format!("{why}Upstreams that use this proxy cannot be reached.")
                ))
                .view(UPSTREAMS),
            ]
        }
        // **界面自己写坏的不报**：那是一次保存失败，保存那条路自己会说
        Event::ConfigRejected {
            origin,
            message,
            line,
            ..
        } if origin == "external" => {
            let at = line
                .map(|l| tr!(format!("第 {l} 行："), format!("Line {l}: ")))
                .unwrap_or_default();
            let message = core_text::clause(message);
            vec![
                Signal::raised(
                    "config",
                    Level::Warning,
                    tr!("配置文件未通过校验", "Config File Failed Validation"),
                )
                .body(tr!(
                    format!("{at}{message}。上一版配置仍在服务。"),
                    format!("{at}{message}. The previous configuration remains in effect.")
                ))
                .view(SETTINGS),
            ]
        }
        Event::ConfigReloaded { .. } => vec![Signal::cleared("config")],
        // 配置里的监听地址没换上：网关还守着旧地址。**只在没换成时说**，换成了
        // 就把那一条收起来 —— 换成功是用户刚按下保存时就知道的事
        Event::ListenChanged { error: None, .. } => vec![Signal::cleared("listen")],
        Event::ListenChanged {
            error: Some(e),
            addr,
            ..
        } => {
            let at = addr.as_deref().unwrap_or("");
            vec![
                Signal::raised(
                    "listen",
                    Level::Warning,
                    tr!("监听设置未生效", "Listen Settings Not in Effect"),
                )
                .body(tr!(
                    format!("{}网关仍在 {at} 上监听。", core_text::text(e)),
                    format!("{} The gateway is still listening on {at}.", e.text)
                ))
                // 设置页并滚到「网关监听」那一节：未生效的原因也写在那里
                .view(LISTEN_SETTINGS),
            ]
        }
        Event::CredentialRotated {
            provider,
            persisted,
            detail,
            ..
        } => {
            if *persisted {
                return vec![Signal::cleared(format!("writeback:{provider}"))];
            }
            // **退出应用之前不处理，这份凭据就没了**：换发的那一刻旧的已经作废。
            // core 的原因只说卡在哪儿，「重启前要处理」由这边按 `persisted` 说
            let detail = core_text::clause(detail);
            vec![
                Signal::raised(
                    format!("writeback:{provider}"),
                    Level::Warning,
                    tr!(
                        format!("{provider} 的新凭据未能写回配置"),
                        format!("New Credential for “{provider}” Not Saved to Config")
                    ),
                )
                .body(tr!(
                    format!("{detail}。退出应用后需要重新登录或更换凭据。"),
                    format!(
                        "{detail}. Once the app quits, a new sign-in or a replacement credential will be required."
                    )
                ))
                .view(UPSTREAMS)
                .now(),
            ]
        }
        // 客户端此刻正在弹批准提示，**这一条要立刻说**。只说真的切断了的：防护处于「监控」时
        // 命中「切断」规则、或者规则本来就是「仅记录」的，走下面「只记录」那一类。
        //
        // **每拦下一次都是一件新的事**（`event`）：用户看过上一次之后再拦下，照样要说；
        // 同一家接连拦下的，由冷却合成一条，不刷屏
        Event::ToolCallFlagged {
            provider,
            tool,
            rule,
            action,
            blocked: true,
            ..
        } if action == "cut" => {
            let title = tr!(
                format!("已拦截 {provider} 返回的 {tool} 调用"),
                format!("Blocked {tool} Call from “{provider}”")
            );
            let name = tool_rule_name(rule);
            let body = tr!(
                format!("命中规则「{name}」，响应已切断。"),
                format!("It matched the rule “{name}”, so the response was cut off.")
            );
            // **正文不带调用内容**：系统通知在锁屏上也看得见
            vec![
                Signal::raised(format!("toolwall:{provider}"), Level::Warning, title)
                    .body(body)
                    .view(SECURITY)
                    .event(),
            ]
        }
        Event::ToolCallFlagged {
            provider,
            rule,
            custom,
            detail,
            ..
        } => watched("inspect_tools", provider, rule, *custom, None, detail)
            .into_iter()
            .collect(),
        Event::ContentMatched {
            provider,
            rule,
            custom,
            detail,
            ..
        } => watched("content", provider, rule, *custom, None, detail)
            .into_iter()
            .collect(),
        // 一次请求里找到的每个值各一项；同一条规则找到几个值，就是同一条规则命中了几次
        Event::SecretsFound {
            provider, items, ..
        } => items
            .iter()
            .filter_map(|i| {
                watched(
                    "redact",
                    provider,
                    &i.rule,
                    i.custom,
                    i.source.as_ref(),
                    &i.detail,
                )
            })
            .collect(),
        Event::KeyLimitAlert { .. } => key_limit(ev),
        // **请求失败只进应用内**（概览上原来那条「需要处理的事」挪到这里）：多数失败是上游
        // 一时出错，客户端会重试，为它弹系统通知不值得；一阵子接连失败攒成一条，次数照实记。
        // 界面上中止的不算 —— 那是用户自己叫停的
        Event::RequestFailed {
            model,
            source,
            message,
            ..
        } if *source != "aborted" => {
            let why = core_text::clause(message);
            vec![
                Signal::raised("failed", Level::Info, tr!("请求失败", "Request Failed"))
                    .body(tr!(
                        format!("「{model}」：{why}。"),
                        format!("“{model}”: {why}.")
                    ))
                    .view(FAILED_REQUESTS)
                    .event()
                    .gathered(),
            ]
        }
        Event::PluginFailed {
            plugin_id,
            plugin_name,
            request_id,
            message,
            ..
        } => vec![plugin_failed(plugin_id, plugin_name, *request_id, message)],
        _ => Vec::new(),
    }
}

/// 一把网关密钥这一期（天、周、月）的用量到了一条上限的八成，或者到了上限。
///
/// **每一期都是新的一件**（`event`）：core 每一期、每一档只报一次，昨天看过的那一条不该
/// 压住今天的。**同一条上限只留一条**：到顶时收起这一期八成的那条；新的一期到了八成，
/// 上一期到顶的那条也不再是现状，一并收起。正文写密钥的名字（不写它的值）、哪一条、
/// 什么时候重置
fn key_limit(ev: &Event) -> Vec<Signal> {
    let &Event::KeyLimitAlert {
        ref key,
        per,
        measure,
        max,
        used,
        cache_reads,
        reached,
        resets_at_ms,
        ..
    } = ev
    else {
        return Vec::new();
    };
    // 同一条上限：同一个周期、同一种量、缓存读取算法相同（和 core 认重复的规矩一样）
    let limit = format!(
        "keylimit:{key}:{per}-{measure}{}",
        if cache_reads { "-cache" } else { "" }
    );
    let near = format!("{limit}:near");
    let phrase = limit_phrase(per, measure, max, cache_reads);
    let secs = resets_at_ms.saturating_sub(super::now_ms()) / 1000;
    let reset = after(secs);
    if reached {
        return vec![
            Signal::cleared(near),
            Signal::raised(
                limit,
                Level::Warning,
                tr!(
                    format!("密钥「{key}」已达用量上限"),
                    format!("Key “{key}” Reached Its Usage Limit")
                ),
            )
            .body(tr!(
                format!("上限「{phrase}」已用满{reset}。使用此密钥的请求会被拒绝。"),
                format!(
                    "The limit of {phrase} has been reached{reset}. Requests with this key will be rejected."
                )
            ))
            .view(KEYS)
            .event(),
        ];
    }
    let percent = (used.saturating_mul(100) / max.max(1)).min(99);
    let n = limit_amount(measure, used);
    let spent = match measure {
        tw_api::LimitMeasure::Requests => tr!(format!("{n} 次"), format!("{n} requests")),
        tw_api::LimitMeasure::Tokens => tr!(format!("{n} token"), format!("{n} tokens")),
        tw_api::LimitMeasure::Cost => n,
    };
    vec![
        Signal::cleared(limit.clone()),
        Signal::raised(
            near,
            Level::Warning,
            tr!(
                format!("密钥「{key}」的用量接近上限"),
                format!("Key “{key}” Is Nearing Its Usage Limit")
            ),
        )
        .body(tr!(
            format!(
                "上限「{phrase}」已使用 {percent}%（{spent}）{reset}。达到上限后，使用此密钥的请求会被拒绝。"
            ),
            format!(
                "The limit of {phrase} is {percent}% used ({spent}){reset}. Once it is reached, requests with this key will be rejected."
            )
        ))
        .view(KEYS)
        .event(),
    ]
}

/// 一条上限说成一句：「每天 $5.00 费用」「每天 1,000,000 token（含缓存读取）」；英文是
/// 「$5.00 per day」「1,000,000 tokens per day (cache reads included)」。和密钥对话框里的同一种说法
fn limit_phrase(
    per: tw_api::LimitPer,
    measure: tw_api::LimitMeasure,
    max: u64,
    cache_reads: bool,
) -> String {
    use tw_api::{LimitMeasure, LimitPer};
    let (zh, en) = match per {
        LimitPer::Minute => ("分钟", "minute"),
        LimitPer::Hour => ("小时", "hour"),
        LimitPer::Day => ("天", "day"),
        LimitPer::Week => ("周", "week"),
        LimitPer::Month => ("月", "month"),
    };
    let n = limit_amount(measure, max);
    match measure {
        LimitMeasure::Requests => tr!(
            format!("每{zh} {n} 次请求"),
            format!("{n} requests per {en}")
        ),
        LimitMeasure::Tokens => {
            let cache = if cache_reads {
                tr!("（含缓存读取）", " (cache reads included)")
            } else {
                ""
            };
            tr!(
                format!("每{zh} {n} token{cache}"),
                format!("{n} tokens per {en}{cache}")
            )
        }
        LimitMeasure::Cost => tr!(format!("每{zh} {n} 费用"), format!("{n} per {en}")),
    }
}

/// 用量或上限写成字：费用是微分，写到分；请求数、token 数带千分位
fn limit_amount(measure: tw_api::LimitMeasure, n: u64) -> String {
    use crate::menubar::model::{cost_long, grouped};
    let n = i64::try_from(n).unwrap_or(i64::MAX);
    match measure {
        tw_api::LimitMeasure::Cost => cost_long(n),
        _ => grouped(n),
    }
}

/// 一个插件没能把事情做成（core 的 `plugin_failed`）：在一个请求上运行出错（`request` 有），
/// 或者文件变了、加载不了，从此不再运行（没有）。
///
/// **正文不带插件写的字**：插件抛出的那句话、交回来的东西可能带着提示词里的内容，而系统
/// 通知在锁屏上也看得见。只说 core 自己定下的那几种原因（[`plugin_reason`]），别的只说在
/// 哪个请求上出的错，原因在那个请求的详情里。插件名同样是插件写的，去掉能伪造换行、倒转
/// 文字的字符；默认插件按界面语言叫，和插件页上一样。
///
/// **每出错一次都是一件新的事**（`event`）：看过上一次之后再出错，照样要说。一个每个回答
/// 都出错的插件（尤其是同时跑的插件到了上限，`gw.plugin.reply_busy`，每个回答一次），
/// 一阵子里的合成一次进总线（`gathered`），系统通知再由冷却限着
pub fn plugin_failed(id: &str, name: &str, request: Option<u64>, why: &tw_api::Msg) -> Signal {
    let name = crate::plugins::words::clean_name(&crate::plugins::defaults::name(Some(id), name));
    let reason = plugin_reason(why);
    let (title, body) = match request {
        Some(r) => (
            tr!(
                format!("插件「{name}」运行出错"),
                format!("Plugin “{name}” Failed")
            ),
            match reason {
                Some(why) => tr!(
                    format!("处理请求 #{r} 时出错：{why}。"),
                    format!("It failed while handling request #{r}: {why}.")
                ),
                None => tr!(
                    format!("处理请求 #{r} 时出错。"),
                    format!("It failed while handling request #{r}.")
                ),
            },
        ),
        None => (
            tr!(
                format!("插件「{name}」已停止运行"),
                format!("Plugin “{name}” Stopped Running")
            ),
            match reason {
                Some(why) => tr!(format!("{why}。"), format!("{why}.")),
                None => tr!(
                    "在插件页处理之前，此插件不再运行。".to_string(),
                    "Until it is dealt with on the Plugins page, the plugin does not run."
                        .to_string()
                ),
            },
        ),
    };
    Signal::raised(format!("plugin:{id}"), Level::Warning, title)
        .body(body)
        .view(PLUGINS)
        .event()
        .gathered()
}

/// core 自己定下的那几种原因，说成一小句。**参数里没有插件写的字的才说**；别的（插件抛出的
/// 错、交回的东西不合规矩）是 None
fn plugin_reason(m: &tw_api::Msg) -> Option<String> {
    Some(match m.code.as_str() {
        "gw.plugin.cpu_limit" => tr!("CPU 时间超出上限", "it used more CPU time than allowed").into(),
        "gw.plugin.memory_limit" => {
            tr!("内存超出上限", "it used more memory than allowed").into()
        }
        "gw.plugin.output_limit" => tr!(
            "返回的内容超出上限",
            "it returned more output than allowed"
        )
        .into(),
        // 不是插件的错：同时跑在回答上的插件到了上限，这一个没起来
        "gw.plugin.reply_busy" => match m.args.get("max") {
            Some(max) => tr!(
                format!("同时处理回答的插件已达上限（{max} 个），此回答未经此插件处理"),
                format!(
                    "the limit of {max} plugins running on answers at once was reached, so it did not run on this answer"
                )
            ),
            None => tr!(
                "同时处理回答的插件已达上限，此回答未经此插件处理",
                "the limit of plugins running on answers at once was reached, so it did not run on this answer"
            )
            .into(),
        },
        "gw.plugin.file_changed" | "gw.plugin.changed" => tr!(
            "插件文件已更改，在插件页审核并确认之前不再运行",
            "its file changed, and it does not run until the change is reviewed and approved on the Plugins page"
        )
        .into(),
        _ => return None,
    })
}

/// 客户端的配置文件里新出现了可疑的东西（`n` 项）。**不是 core 说的**：这台机器
/// 上的文件监视（`scan::spawn_watcher`）发现的，连着哪个 core 都一样。
///
/// **每次新出现都是一件新的事**（`event`）：看过上一次之后又出现的，照样要说。
///
/// 英文写页面现在的名字「MCP」：点开这一条落到的就是那一页
pub fn scan_alert(n: usize) -> Option<Signal> {
    (n > 0).then(|| {
        Signal::raised(
            "scan",
            Level::Warning,
            tr!(
                "客户端配置中出现可疑内容",
                "Suspicious Content in Client Configuration"
            ),
        )
        .body(tr!(
            format!("新增 {n} 项，详见 MCP 页。"),
            match n {
                1 => "1 new item. Details are on the MCP page.".to_string(),
                n => format!("{n} new items. Details are on the MCP page."),
            }
        ))
        .view(MCP)
        .event()
    })
}

/// 此刻的样子，按对账的需要从 core 问来：`/status`、`/overview`、`/quota`。
pub struct Snapshot<'a> {
    pub status: &'a tw_api::Status,
    pub overview: &'a tw_api::Overview,
    pub quotas: &'a [tw_api::ProviderQuota],
    /// 默认价目表的现状：最近 7 天里哪些上游的哪些模型有请求无法计价
    pub pricing: &'a tw_api::PricingStatus,
}

/// 对账时认得的那几类键：**现状查得到的**。快照里没有、而列表里还开着的这几类，
/// 就是在没连上的那段时间里好了。
///
/// 上游不通（`upstream:`）不在里面：熔断冷却到点的半开在现状里和「正常」一样，拿它
/// 收起一条提醒，就是把「可以再试」当成了恢复（见 `HealthChanged` 那条规则）。
pub const RECONCILED: &[&str] = &[
    "credential:",
    "auth:",
    "proxy:",
    "writeback:",
    "quota:",
    "config",
    "listen",
    "unpriced:",
];

/// 这个键是不是对账管的那几类
pub fn reconciled(key: &str) -> bool {
    RECONCILED.iter().any(|p| {
        if p.ends_with(':') {
            key.starts_with(p)
        } else {
            key == *p
        }
    })
}

/// 现状里**此刻不对**的那几件事，说成和事件一样的话。
///
/// **按事件的样子造一条，再走同一套规则**：通知怎么写只有 [`from_event`] 一处。
/// 事件流是「那一刻」，这里是「现在」—— 桌面端半路才连上（启动时 core 已经报过
/// 凭据失效，或者断线重连），错过的就从这里补上。
pub fn from_snapshot(s: &Snapshot<'_>, now_ms: u64) -> Vec<Signal> {
    use tw_api::{AuthState, ConfigOrigin, Event, ProxyState};
    let mut events = Vec::new();
    for p in &s.overview.providers {
        if let Some(o) = &p.oauth
            && o.needs_login
            && let Some(detail) = &o.failure
        {
            events.push(Event::CredentialExpired {
                id: 0,
                provider: p.name.clone(),
                detail: detail.clone(),
                at_ms: now_ms,
            });
        }
        if let Some(status) = p.auth_rejected {
            events.push(Event::AuthChanged {
                id: 0,
                provider: p.name.clone(),
                state: AuthState::Rejected,
                status: Some(status),
                at_ms: now_ms,
            });
        }
        if let Some(detail) = &p.writeback_failed {
            events.push(Event::CredentialRotated {
                id: 0,
                provider: p.name.clone(),
                persisted: false,
                detail: detail.clone(),
                at_ms: now_ms,
            });
        }
        if p.health == tw_api::Health::Open {
            events.push(Event::HealthChanged {
                id: 0,
                provider: p.name.clone(),
                state: tw_api::BreakerState::Open,
                at_ms: now_ms,
            });
        }
    }
    for x in &s.overview.proxies {
        if let Some(f) = &x.unreachable {
            events.push(Event::ProxyChanged {
                id: 0,
                proxy: x.name.clone(),
                state: ProxyState::Unreachable,
                failed: f.failed.clone(),
                detail: Some(f.detail.clone()),
                at_ms: now_ms,
            });
        }
    }
    for q in s.quotas {
        for w in &q.windows {
            // 用完了、而且还没到重置的时刻
            let used_up = w.status.as_deref() == Some("rejected") || w.used_percent >= 100.0;
            if used_up && w.resets_at_ms.is_none_or(|at| at > now_ms) {
                events.push(Event::QuotaExhausted {
                    id: 0,
                    provider: q.provider.clone(),
                    window: w.window.clone(),
                    resets_at_ms: w.resets_at_ms,
                    at_ms: now_ms,
                });
            }
        }
    }
    if let Some(r) = &s.status.config_rejected {
        events.push(Event::ConfigRejected {
            id: 0,
            stage: r.stage,
            message: r.message.clone(),
            line: r.line,
            excerpt: r.excerpt.clone(),
            origin: ConfigOrigin::External,
            at_ms: r.at_ms,
        });
    }
    if let Some(e) = &s.status.listen_error {
        events.push(Event::ListenChanged {
            id: 0,
            addr: s.status.gateway_addr.clone(),
            error: Some(e.clone()),
            at_ms: now_ms,
        });
    }
    events
        .iter()
        .flat_map(from_event)
        .filter(|sig| sig.change == Change::Raised)
        .chain(s.pricing.unpriced_models.iter().map(unpriced))
        .collect()
}

/// 一个模型最近 7 天里有请求无法计价（概览上原来那条「需要处理的事」挪到这里）。
///
/// **按现状说，没有对应的事件**：`request_priced` 不带模型，而无法计价是一个持续的状态 ——
/// 价目表里没有它，就一直算不出来。每家上游的每个模型一条，点开落到上游页去设价格；
/// 7 天里不再有算不出来的请求，对账时自己收起。只进应用内：请求照常转发，只是费用没计入
fn unpriced(m: &tw_api::UnpricedModel) -> Signal {
    let (provider, model, n) = (&m.provider, &m.model, m.requests);
    Signal::raised(
        format!("unpriced:{provider}:{model}"),
        Level::Info,
        tr!(
            format!("模型「{model}」未定价"),
            format!("No Price for “{model}”")
        ),
    )
    .body(tr!(
        format!("最近 7 天经「{provider}」的 {n} 次请求无法计价，费用未计入。在上游页为它设定价格。"),
        format!(
            "{n} {} through “{provider}” in the last 7 days could not be priced, so their cost is not counted. Set a price for it on the Upstreams page.",
            if n == 1 { "request" } else { "requests" }
        )
    ))
    .view(UPSTREAMS)
}

/// 「仅记录」的命中：规则的动作就是仅记录，或者防护处于「监控」（那时每条规则都按仅记录
/// 处理）。**只认 core 说的结局**（`outcome_detail` 是 `recorded`），不自己按档位和动作推。
///
/// 规格（安全页重整 §3）：仅记录 = 记入安全日志并发出系统通知。正文**只有规则名和上游**，
/// 不带命中的原文（锁屏上也看得见）。「ThinkWatch 中保存的密钥」再写明是哪一处保存的
/// （`source`：上游「DeepSeek」的密钥……），**只有来源，没有值的任何部分**。键按规则分（`secwatch:<防护>:<b|c>:<规则>`），所以
/// **同一条规则 5 分钟里至多弹一次**（[`Signal::event`] 的冷却）；同时命中的几条规则由总线
/// 合成一条通知（[`Signal::merged`]，那一行是这条规则在合成通知里的样子）。
fn watched(
    guard: &'static str,
    provider: &str,
    rule: &str,
    custom: bool,
    source: Option<&tw_api::SavedSource>,
    detail: &tw_api::SecurityHitDetail,
) -> Option<Signal> {
    if !matches!(detail.outcome_detail, tw_api::OutcomeDetail::Recorded {}) {
        return None;
    }
    let name = guard_rule_name(guard, rule, custom, &detail.rule_snapshot.name);
    let what = guard_name(guard);
    let answer = detail.direction == tw_api::SecurityDirection::Response;
    let body = match (source, answer, crate::i18n::current()) {
        (Some(s), false, crate::i18n::Lang::Zh) => {
            let s = saved_source_zh(s);
            format!("{what}：经上游「{provider}」的请求含有{s}，已记入安全日志。")
        }
        (Some(s), true, crate::i18n::Lang::Zh) => {
            let s = saved_source_zh(s);
            format!("{what}：上游「{provider}」的回答含有{s}，已记入安全日志。")
        }
        (Some(s), false, crate::i18n::Lang::En) => {
            let s = saved_source_en(s);
            format!(
                "{what}: a request through upstream “{provider}” contained {s}. It was recorded in the security log."
            )
        }
        (Some(s), true, crate::i18n::Lang::En) => {
            let s = saved_source_en(s);
            format!(
                "{what}: an answer from upstream “{provider}” contained {s}. It was recorded in the security log."
            )
        }
        (None, false, crate::i18n::Lang::Zh) => {
            format!("{what}：经上游「{provider}」的请求命中此规则，已记入安全日志。")
        }
        (None, true, crate::i18n::Lang::Zh) => {
            format!("{what}：上游「{provider}」的回答命中此规则，已记入安全日志。")
        }
        (None, false, crate::i18n::Lang::En) => format!(
            "{what}: a request through upstream “{provider}” matched this rule. It was recorded in the security log."
        ),
        (None, true, crate::i18n::Lang::En) => format!(
            "{what}: an answer from upstream “{provider}” matched this rule. It was recorded in the security log."
        ),
    };
    let kind = if custom { "c" } else { "b" };
    Some(
        Signal::raised(
            format!("secwatch:{guard}:{kind}:{rule}"),
            Level::Warning,
            tr!(
                format!("安全规则「{name}」命中"),
                format!("Security Rule “{name}” Matched")
            ),
        )
        .body(body)
        .view(SECURITY)
        .event()
        .merged(tr!(
            format!("「{name}」· {provider}"),
            format!("“{name}” · {provider}")
        )),
    )
}

/// 防护的名字，和安全页的页签一样
fn guard_name(guard: &str) -> String {
    tr!(
        crate::core_text::table_zh("guard", guard).unwrap_or_else(|| guard.to_string()),
        match guard {
            "redact" => "Secrets & privacy",
            "inspect_tools" => "Dangerous commands",
            _ => "Content filter",
        }
        .to_string()
    )
}

/// 保存的密钥是哪一处的，放进句中（「经上游「X」的请求含有上游「DeepSeek」的密钥」）。
/// 和安全页上写的一样（`savedSourceText`）
fn saved_source_zh(s: &tw_api::SavedSource) -> String {
    use tw_api::SavedSourceKind as K;
    let n = &s.name;
    match s.kind {
        K::UpstreamKey => format!("上游「{n}」的密钥"),
        K::UpstreamHeader => format!("上游「{n}」请求头中的值"),
        K::AccessKey => format!("网关密钥「{n}」"),
        K::ProxyPassword => format!("代理「{n}」的密码"),
        K::ControlKey => "远程控制密钥".to_string(),
        K::SyncCredential => "同步与备份凭据".to_string(),
    }
}

/// 同上，英文，句中的写法（小写开头）
fn saved_source_en(s: &tw_api::SavedSource) -> String {
    use tw_api::SavedSourceKind as K;
    let n = &s.name;
    match s.kind {
        K::UpstreamKey => format!("the key of upstream “{n}”"),
        K::UpstreamHeader => format!("a header value of upstream “{n}”"),
        K::AccessKey => format!("gateway key “{n}”"),
        K::ProxyPassword => format!("the password of proxy “{n}”"),
        K::ControlKey => "the remote control key".to_string(),
        K::SyncCredential => "a sync and backup credential".to_string(),
    }
}

/// 规则的名字，和安全页上的一样：自定义规则就是用户起的名字；内置的取 core 规则目录里的
/// 中英文名（钉着的这一版 tw-guard，安全页上 core 给的是同一份）。目录里没有的（连着的远程
/// core 更新、多了规则），用事件里的英文名
fn guard_rule_name(guard: &str, rule: &str, custom: bool, english: &str) -> String {
    if custom {
        return rule.to_string();
    }
    let english = if english.is_empty() { rule } else { english };
    let zh = match guard {
        "redact" => tw_guard::redact::rules::builtin(rule).map(|b| b.name_zh.to_string()),
        "content" => tw_guard::content::builtin(rule).map(|b| b.name_zh.clone()),
        _ => tool_rule(rule).map(|r| r.name_zh.clone()),
    };
    tr!(
        zh.filter(|z| !z.is_empty())
            .unwrap_or_else(|| english.to_string()),
        english.to_string()
    )
}

/// 一条内置的工具调用规则（危险命令和提示注入两组）
fn tool_rule(id: &str) -> Option<&'static tw_guard::tools::rules::RuleSpec> {
    let f = tw_guard::tools::rules::builtin();
    f.dangerous.iter().chain(&f.injection).find(|r| r.id == id)
}

/// 工具调用规则的名字，和安全页上的一样。**只有内置的这些**：自定义规则的
/// id 就是用户起的名字，原样用。
fn tool_rule_name(rule: &str) -> String {
    match tool_rule(rule) {
        Some(r) => guard_rule_name("inspect_tools", rule, false, &r.name),
        None => rule.to_string(),
    }
}

/// 网关本身的状态。**这是唯一的 critical** —— 它一停，所有客户端都在瞎
pub fn from_core_state(state: &crate::supervisor::CoreState) -> Vec<Signal> {
    use crate::supervisor::CoreState;
    match state {
        // 用户自己停掉的也算「这件事过去了」：界面上那一条说得清清楚楚
        CoreState::Running { .. } | CoreState::Stopped => vec![Signal::cleared("gateway")],
        CoreState::SafeMode { .. } => vec![
            Signal::raised(
                "gateway",
                Level::Critical,
                tr!("网关未在转发", "Gateway Not Forwarding"),
            )
            .body(
                tr!(
                    "已连续启动失败，当前只有配置和历史可用。",
                    "Startup failed several times in a row. Only configuration and history are available."
                )
                .to_string(),
            )
            .view(SETTINGS)
            .now()
            .suppressing(suppresses("gateway")),
        ],
        // 程序本身运行不了、或者安全模式里也起不来：不会自己好，转发已经停了
        CoreState::Exited { .. } => vec![
            Signal::raised(
                "gateway",
                Level::Critical,
                tr!("网关无法启动", "Gateway Cannot Start"),
            )
            .body(
                tr!(
                    "core 启动后退出，转发已停止。打开窗口可以查看原因并重试。",
                    "core exited right after starting, so forwarding has stopped. Open the window to see why and try again."
                )
                .to_string(),
            )
            .view(SETTINGS)
            .now()
            .suppressing(suppresses("gateway")),
        ],
        // 程序本身运行不了：不会自己好，转发已经停了
        CoreState::Failed { .. } => vec![
            Signal::raised(
                "gateway",
                Level::Critical,
                tr!("网关无法启动", "Gateway Cannot Start"),
            )
            .body(
                tr!(
                    "core 程序未能运行，转发已停止。打开窗口可以查看原因并重试。",
                    "The core program could not run, so forwarding has stopped. Open the window to see why and try again."
                )
                .to_string(),
            )
            .view(SETTINGS)
            .now()
            .suppressing(suppresses("gateway")),
        ],
        // 偶发崩溃自己好了就别打扰人；连着崩说明不是偶发
        CoreState::Restarting { attempt, .. } if *attempt >= 3 => vec![
            Signal::raised(
                "gateway",
                Level::Critical,
                tr!("网关反复退出", "Gateway Keeps Exiting"),
            )
            .body(tr!(
                format!("已连续重启 {attempt} 次，转发可能时断时续。"),
                format!(
                    "The gateway restarted {attempt} times in a row. Forwarding may be intermittent."
                )
            ))
            .view(SETTINGS)
            .now()
            .suppressing(suppresses("gateway")),
        ],
        _ => Vec::new(),
    }
}

/// core 活着但不回心跳，被换掉了。
///
/// **只进应用内**：自己好了的一次卡顿和一次偶发崩溃一个待遇，不打断人。但那几秒里
/// 用户看到的失败要有地方说得清，所以留一条。同一件事再发生只累计次数
pub fn wedged() -> Signal {
    Signal::raised(
        "wedged",
        Level::Info,
        tr!("网关曾无响应，已重启", "Gateway Stopped Responding and Was Restarted"),
    )
    .body(
        tr!(
            "网关连续几次没有响应，已自动重启。重启期间的请求可能失败。",
            "The gateway did not respond several times in a row and was restarted automatically. Requests during the restart may have failed."
        )
        .to_string(),
    )
    .view(SETTINGS)
    .now()
}

/// 应用常驻的那个图标在哪：macOS 的菜单栏、Windows 的通知区域、Linux 的系统托盘。
/// 中文和英文各一份，英文是句中的写法（小写）
fn tray_place() -> (&'static str, &'static str) {
    if cfg!(target_os = "macos") {
        ("菜单栏", "menu bar")
    } else if cfg!(windows) {
        ("通知区域", "notification area")
    } else {
        ("系统托盘", "system tray")
    }
}

/// 启动时那个常驻图标没建起来（[`tray_place`]）。**应用照常跑**：网关、窗口都在，只是少了
/// 那个入口。原因（系统的原话）只进日志，同 [`wedged`] 那几条：通知在锁屏上也看得见
pub fn tray_failed() -> Signal {
    let (zh, _) = tray_place();
    // 英文标题每个词首字母大写，见模块头上
    let title_en = if cfg!(target_os = "macos") {
        "Menu Bar Icon Could Not Be Shown"
    } else if cfg!(windows) {
        "Notification Area Icon Could Not Be Shown"
    } else {
        "System Tray Icon Could Not Be Shown"
    };
    Signal::raised(
        "startup:tray",
        Level::Warning,
        tr!(format!("{zh}图标未能显示"), title_en.to_string()),
    )
    .body(
        tr!(
            "网关照常运行。窗口关闭后，再次打开应用即可回到主界面。",
            "The gateway keeps running. After the window is closed, opening the app again brings it back."
        )
        .to_string(),
    )
    .event()
}

/// 启动时主窗口没开起来。网关、常驻图标照常，从图标那里可以再开一次
pub fn window_failed() -> Signal {
    let (zh, en) = tray_place();
    Signal::raised(
        "startup:window",
        Level::Warning,
        tr!("主窗口未能打开", "Main Window Could Not Be Opened"),
    )
    .body(tr!(
        format!("网关照常运行。可以从{zh}再次打开主界面。"),
        format!("The gateway keeps running. The window can be opened again from the {en}.")
    ))
    .event()
}

/// 启动时要先选连接，连接选择却没开起来。这时什么都还没连；常驻图标的「连接」里照样选得了
pub fn picker_failed() -> Signal {
    let (zh, en) = tray_place();
    Signal::raised(
        "startup:picker",
        Level::Warning,
        tr!("连接选择未能打开", "Connection Picker Could Not Be Opened"),
    )
    .body(tr!(
        format!("尚未连接 core。可以在{zh}的「连接」中选择要连接的 core。"),
        format!("No core is connected yet. One can be chosen under Connection in the {en}.")
    ))
    .event()
}

/// 和远程 core 的连接断了。**只报一次**：总线按键去重，重连的每一次失败都不再说；
/// 连上之后由 [`remote_back`] 收起
pub fn remote_lost(name: &str) -> Signal {
    Signal::raised(
        "remote",
        Level::Critical,
        tr!(
            format!("与 {name} 的连接已断开"),
            format!("Disconnected from “{name}”")
        ),
    )
    .body(
        tr!(
            "正在重新连接。连接恢复前，应用中的内容停留在断开时的状态。",
            "Reconnecting. Until the connection is restored, the app shows the state at the time of the disconnect."
        )
        .to_string(),
    )
    .view(SETTINGS)
    .now()
    .suppressing(suppresses("remote"))
}

pub fn remote_back() -> Signal {
    Signal::cleared("remote")
}

/// `5h` / `weekly` → 「5 小时」「每周」；按长度起的名字按长度说：`30d` → 「30 天」、
/// `45m` → 「45 分钟」（和菜单栏认的是同一套写法，见 `window_span`）。认不出来的原样用。
///
/// 英文接在「usage limit」前面当定语，写成 `5-hour`、`weekly`、`30-day`、`45-minute`
fn window_label(w: &str) -> String {
    use crate::menubar::model::{Span, window_span};
    match w {
        "weekly" => tr!("每周", "weekly").into(),
        "5h" => tr!("5 小时", "5-hour").into(),
        other => match window_span(other) {
            Some((n, Span::Days)) => tr!(format!("{n} 天"), format!("{n}-day")),
            Some((n, Span::Hours)) => tr!(format!("{n} 小时"), format!("{n}-hour")),
            Some((n, Span::Minutes)) => tr!(format!("{n} 分钟"), format!("{n}-minute")),
            None => other.to_string(),
        },
    }
}

/// 「，约 3 小时后重置」（英文是 ` and resets in about 3 hours`，接在句子中间）。
/// 满一天按天说：每周的窗口离重置常常还有好几天，「约 150 小时」没法读。
///
/// **四舍五入、取整之后再定单位**，和菜单栏的 `resets_in` 一样：1 小时 59 分是「约 2 小时」，
/// 不是「约 1 小时」；59.5 分钟是「约 1 小时」，不是「约 60 分钟」
fn after(secs: u64) -> String {
    let [m, h, d] = [60.0, 3600.0, 86_400.0].map(|unit| (secs as f64 / unit).round() as u64);
    let (n, unit, unit_en) = if secs < 60 {
        return tr!("，即将重置", " and resets shortly").into();
    } else if m < 60 {
        (m, "分钟", "minute")
    } else if h < 24 {
        (h, "小时", "hour")
    } else {
        (d, "天", "day")
    };
    let plural = if n == 1 { "" } else { "s" };
    tr!(
        format!("，约 {n} {unit}后重置"),
        format!(" and resets in about {n} {unit_en}{plural}")
    )
}
