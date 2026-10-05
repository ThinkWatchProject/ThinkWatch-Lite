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
const SETTINGS: &str = "settings";
/// 设置页的「网关监听」一节（`settings:<节>`，界面滚到那一节）
const LISTEN_SETTINGS: &str = "settings:listen";

/// 一个键默认落在哪一页（那一条已经不在列表里时用）。按键的种类，也就是冒号前那段
pub fn default_view(key: &str) -> &'static str {
    match key.split(':').next().unwrap_or(key) {
        "upstream" | "quota" | "credential" | "auth" | "writeback" | "proxy" => UPSTREAMS,
        "toolwall" => SECURITY,
        // 客户端配置里的可疑内容在 MCP 页：服务器、技能、钩子和扫描发现都在那儿
        "scan" => MCP,
        "plugin" => PLUGINS,
        "keylimit" => KEYS,
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
        // 客户端此刻正在弹批准提示，**这一条要立刻说**。只说处置为「切断」的
        // 那些规则：「仅记录」的那一类本来就是用户说了不必打断的。
        //
        // **每拦下一次都是一件新的事**（`event`）：用户看过上一次之后再拦下，照样要说；
        // 同一家接连拦下的，由冷却合成一条，不刷屏
        Event::ToolCallFlagged {
            provider,
            tool,
            rule,
            action,
            blocked,
            ..
        } if action == "cut" => {
            let title = if *blocked {
                tr!(
                    format!("已拦截 {provider} 返回的 {tool} 调用"),
                    format!("Blocked {tool} Call from “{provider}”")
                )
            } else {
                tr!(
                    format!("{provider} 返回了可疑的 {tool} 调用"),
                    format!("Suspicious {tool} Call from “{provider}”")
                )
            };
            let name = tool_rule_name(rule);
            let body = if *blocked {
                tr!(
                    format!("命中规则「{name}」，响应已切断。"),
                    format!("It matched the rule “{name}”, so the response was cut off.")
                )
            } else {
                tr!(
                    format!("命中规则「{name}」。建议在客户端拒绝此调用。"),
                    format!(
                        "It matched the rule “{name}”. Rejecting this call in the client is recommended."
                    )
                )
            };
            // **正文不带调用内容**：系统通知在锁屏上也看得见
            vec![
                Signal::raised(format!("toolwall:{provider}"), Level::Warning, title)
                    .body(body)
                    .view(SECURITY)
                    .event(),
            ]
        }
        Event::KeyLimitAlert { .. } => key_limit(ev),
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
        .collect()
}

/// 工具调用规则的名字，和安全页上的一样。**只有内置的这些**：自定义规则的
/// id 就是用户起的名字，原样用。
fn tool_rule_name(rule: &str) -> String {
    let (zh, en) = match rule {
        "curl-pipe-sh" => ("下载即执行", "Download and run"),
        "base64-decode-exec" => ("解码后执行", "Decode and run"),
        "exfil-env" => ("外发环境变量", "Send out environment variables"),
        "exfil-credentials" => ("外发凭据文件", "Send out a credential file"),
        "exfil-credentials-reversed" => (
            "外发凭据文件（动词在前）",
            "Send out a credential file (verb first)",
        ),
        "ssh-key-read" => ("读取私钥或云凭据", "Read a private key or cloud credential"),
        "secret-to-unknown-host" => ("凭据发往陌生主机", "Send a credential to an unknown host"),
        "thinkwatch-data" => (
            "读写 ThinkWatch 自己的数据",
            "Read or change ThinkWatch's own data",
        ),
        "write-startup-item" => ("写入启动项", "Write a startup item"),
        "crontab-install" => ("安装定时任务", "Install a scheduled job"),
        "rm-rf-root" => ("删除主目录或根目录", "Delete home or root"),
        "chmod-777" => ("开放全部写权限", "World-writable permissions"),
        "upload-file-to-host" => (
            "上传本地文件到外部主机",
            "Upload a local file to an external host",
        ),
        other => return other.to_string(),
    };
    tr!(zh, en).to_string()
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
/// 满一天按天说：每周的窗口离重置常常还有好几天，「约 150 小时」没法读
fn after(secs: u64) -> String {
    let (n, unit, unit_en) = if secs >= 86_400 {
        (secs / 86_400, "天", "day")
    } else if secs >= 3600 {
        (secs / 3600, "小时", "hour")
    } else if secs >= 60 {
        (secs / 60, "分钟", "minute")
    } else {
        return tr!("，即将重置", " and resets shortly").into();
    };
    let plural = if n == 1 { "" } else { "s" };
    tr!(
        format!("，约 {n} {unit}后重置"),
        format!(" and resets in about {n} {unit_en}{plural}")
    )
}
