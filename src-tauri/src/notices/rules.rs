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

use tw_api::Event;

use super::{Level, Signal};

/// 建连卡在哪一步，一句话。
///
/// **只翻步骤，不翻原因。**原因是 core 发来的一整句英文，翻它要在这里
/// 再抄一份 core 的码表；而步骤是个封闭集合，几个词就够，指向的又正是
/// 一眼要看的那件事。完整的原因在上游页上。
fn l1_step(s: &tw_api::L1Stage) -> String {
    let step: &str = match s.step.as_str() {
        "config" => tr!("配置", "configuration"),
        "dns" => tr!("DNS 解析", "DNS lookup"),
        "tcp" => tr!("TCP 握手", "TCP handshake"),
        "tls" => tr!("TLS 握手", "TLS handshake"),
        "handshake" => tr!("代理握手", "proxy handshake"),
        // 不在这几个里的照着码说，总好过不说
        other => other,
    };
    // 代理握手本来就只对着代理，再加一句「到代理」是废话
    if s.peer == "proxy" && s.step != "handshake" {
        tr!(format!("到代理的{step}"), format!("{step} to the proxy"))
    } else {
        step.to_string()
    }
}

/// 监听没换成的原因，中文怎么说。**码是个封闭的小集合**，和界面那张表同一套
/// 说法；认不出的码照搬 core 的英文原句。
fn listen_why(e: &tw_api::Msg) -> String {
    let addr = e.arg("addr");
    match e.code.as_str() {
        "gw.listen.port_taken" => format!("{addr} 已被其他程序占用。"),
        "gw.listen.addr_unavailable" => format!("{addr} 当前不是本机的地址。"),
        "gw.listen.denied" => format!("系统不允许监听 {addr}，1024 以下的端口需要管理员权限。"),
        "gw.listen.no_such_nic" => format!(
            "本机没有名为 {} 的网卡，现有网卡：{}。",
            e.arg("name"),
            e.arg("available")
        ),
        "gw.listen.nic_no_addr" => {
            format!(
                "网卡 {} 当前没有地址，请检查网线或 Wi-Fi 连接。",
                e.arg("name")
            )
        }
        _ => e.text.clone(),
    }
}

/// 界面上的落点。**和 `App.tsx` 里的页面标识是同一套词** —— 写成一个不存在的
/// 标识，点通知就落到一页空白上（「设置」这一页曾经叫 `config`，改名时这里
/// 没跟上）
const UPSTREAMS: &str = "upstreams";
const SECURITY: &str = "security";
const MCP: &str = "mcp";
const SETTINGS: &str = "settings";

/// 一个键默认落在哪一页（那一条已经不在列表里时用）。按键的种类，也就是冒号前那段
pub fn default_view(key: &str) -> &'static str {
    match key.split(':').next().unwrap_or(key) {
        "upstream" | "quota" | "credential" | "auth" | "writeback" | "proxy" => UPSTREAMS,
        "toolwall" => SECURITY,
        // 客户端配置里的可疑内容在 MCP 页：服务器、技能、钩子和扫描发现都在那儿
        "scan" => MCP,
        // 网关、配置文件、监听，以及认不出来的：设置页至少能看到网关在不在跑
        _ => SETTINGS,
    }
}

/// 这个键开着的时候，压下哪些键（前缀匹配）。
///
/// **网关不在服务时不必再说它下面每一家怎么了** —— 那时用户要做的只有一件事。
pub fn suppresses(key: &str) -> &'static [&'static str] {
    match key {
        "gateway" => &[
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
            reset_in_secs,
            ..
        } => {
            let reset = reset_in_secs.map(after).unwrap_or_default();
            // 几分钟后就恢复的窗口不值得打断 —— 用户等一会儿就好了
            let level = match reset_in_secs {
                Some(s) if *s <= 300 => Level::Info,
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
        } => vec![
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
        ],
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
                    tr!(format!("卡在{step}。"), format!("It got stuck at the {step}. "))
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
                    format!("{}网关仍在 {at} 上监听。", listen_why(e)),
                    format!("{} The gateway is still listening on {at}.", e.text)
                ))
                .view(SETTINGS),
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
            // **退出应用之前不处理，这份凭据就没了**：换发的那一刻旧的已经作废
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
        // 那些规则：「仅记录」的那一类本来就是用户说了不必打断的
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
                    format!("It matched the rule “{name}”. Rejecting this call in the client is recommended.")
                )
            };
            // **正文不带调用内容**：系统通知在锁屏上也看得见
            vec![
                Signal::raised(format!("toolwall:{provider}"), Level::Warning, title)
                    .body(body)
                    .view(SECURITY)
                    .now(),
            ]
        }
        // 英文写页面现在的名字「MCP」：点开这一条落到的就是那一页
        Event::ScanAlert { alerts, .. } if !alerts.is_empty() => vec![
            Signal::raised(
                "scan",
                Level::Warning,
                tr!(
                    "客户端配置中出现可疑内容",
                    "Suspicious Content in Client Configuration"
                ),
            )
            .body(tr!(
                format!("新增 {} 项，详见 MCP 页。", alerts.len()),
                match alerts.len() {
                    1 => "1 new item. Details are on the MCP page.".to_string(),
                    n => format!("{n} new items. Details are on the MCP page."),
                }
            ))
            .view(MCP)
            .now(),
        ],
        _ => Vec::new(),
    }
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
        "write-startup-item" => ("写入启动项", "Write a startup item"),
        "crontab-install" => ("安装定时任务", "Install a scheduled job"),
        "rm-rf-root" => ("删除主目录或根目录", "Delete home or root"),
        "chmod-777" => ("开放全部写权限", "World-writable permissions"),
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
        CoreState::SafeMode => vec![
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

/// `5h` / `weekly` → 「5 小时」「每周」（英文是 `5-hour`、`weekly`）。认不出来的原样用
fn window_label(w: &str) -> String {
    match w {
        "weekly" => tr!("每周", "weekly").into(),
        "5h" => tr!("5 小时", "5-hour").into(),
        other => match other.strip_suffix('h').and_then(|n| n.parse::<u32>().ok()) {
            Some(h) => tr!(format!("{h} 小时"), format!("{h}-hour")),
            None => match other.strip_suffix('d').and_then(|n| n.parse::<u32>().ok()) {
                Some(d) => tr!(format!("{d} 天"), format!("{d}-day")),
                None => other.to_string(),
            },
        },
    }
}

/// 「，约 3 小时后重置」（英文是 ` and resets in about 3 hours`，接在句子中间）
fn after(secs: u64) -> String {
    let (n, unit, unit_en) = if secs >= 3600 {
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
