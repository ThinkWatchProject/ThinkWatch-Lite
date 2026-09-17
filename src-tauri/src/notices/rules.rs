//! 哪件事该说，说成什么样。
//!
//! **这一层只做翻译**：core 的事件和守护的状态 → [`Signal`]。要不要真的打断用户，
//! 由总线按去抖、去重、抑制、限流决定 —— 两件事分开，才能各自测。
//!
//! 文案纪律（和界面同一套）：陈述句，不出现第一人称；**不带密钥、提示词、
//! 工具参数** —— 系统通知在锁屏上也看得见。

use tw_api::Event;

use super::{Level, Signal};

/// 界面上的落点。和 `App.tsx` 里的页面标识是同一套词
const UPSTREAMS: &str = "upstreams";
const SECURITY: &str = "security";
const CONFIG: &str = "config";

/// 这个键开着的时候，压下哪些键（前缀匹配）。
///
/// **网关不在服务时不必再说它下面每一家怎么了** —— 那时用户要做的只有一件事。
pub fn suppresses(key: &str) -> &'static [&'static str] {
    match key {
        "gateway" => &[
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
                    format!("{provider} 的订阅额度已用完"),
                )
                .body(format!(
                    "{}额度已用完{}。经此上游的请求会被拒绝。",
                    window_label(window),
                    reset
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
        Event::CredentialExpired {
            provider, detail, ..
        } => vec![
            Signal::raised(
                format!("credential:{provider}"),
                Level::Warning,
                format!("{provider} 需要重新登录"),
            )
            .body(format!("{detail}。重新登录之前，经此上游的请求都会失败。"))
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
            let code = status.map(|s| format!("（{s}）")).unwrap_or_default();
            vec![
                Signal::raised(
                    format!("auth:{provider}"),
                    Level::Warning,
                    format!("{provider} 拒绝了当前凭据"),
                )
                .body(format!("上游返回未授权{code}，该上游的凭据可能已失效。"))
                .view(UPSTREAMS),
            ]
        }
        Event::ProxyChanged {
            proxy,
            state,
            detail,
            ..
        } => {
            if state == "reachable" {
                return vec![Signal::cleared(format!("proxy:{proxy}"))];
            }
            let why = detail
                .as_deref()
                .map(|d| format!("{d}。"))
                .unwrap_or_default();
            vec![
                Signal::raised(
                    format!("proxy:{proxy}"),
                    Level::Warning,
                    format!("代理「{proxy}」不通"),
                )
                .body(format!("{why}经此代理的上游都无法连接。"))
                .view(UPSTREAMS),
            ]
        }
        Event::StorageChanged {
            level, free_bytes, ..
        } => {
            if level == "ok" {
                return vec![Signal::cleared("storage")];
            }
            let title = if level == "stopped" {
                "磁盘空间严重不足，已停止记录"
            } else {
                "磁盘空间不足，已停止保存请求正文"
            };
            vec![
                Signal::raised("storage", Level::Warning, title)
                    .body(format!("剩余 {}。转发不受影响。", size(*free_bytes)))
                    .view(CONFIG),
            ]
        }
        // **界面自己写坏的不报**：那是一次保存失败，保存那条路自己会说
        Event::ConfigRejected {
            origin,
            message,
            line,
            ..
        } if origin == "external" => {
            let at = line.map(|l| format!("第 {l} 行：")).unwrap_or_default();
            vec![
                Signal::raised("config", Level::Warning, "配置文件未通过校验")
                    .body(format!("{at}{message}。上一版配置仍在服务。"))
                    .view(CONFIG),
            ]
        }
        Event::ConfigReloaded { .. } => vec![Signal::cleared("config")],
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
                    format!("{provider} 的新凭据未能写回配置"),
                )
                .body(format!("{detail}。退出应用后需要重新登录或更换凭据。"))
                .view(UPSTREAMS)
                .now(),
            ]
        }
        // 客户端此刻正在弹批准提示，**这一条要立刻说**
        Event::ToolCallFlagged {
            provider,
            tool,
            why,
            high,
            blocked,
            ..
        } if *high => {
            let title = if *blocked {
                format!("已拦截 {provider} 返回的 {tool} 调用")
            } else {
                format!("{provider} 返回了可疑的 {tool} 调用")
            };
            let tail = if *blocked {
                "此上游标记为不受信任，响应流已切断。"
            } else {
                "建议在客户端拒绝此调用。"
            };
            // **正文不带调用内容**：系统通知在锁屏上也看得见
            vec![
                Signal::raised(format!("toolwall:{provider}"), Level::Warning, title)
                    .body(format!("{why}。{tail}"))
                    .view(SECURITY)
                    .now(),
            ]
        }
        Event::ScanAlert { alerts, .. } if !alerts.is_empty() => vec![
            Signal::raised("scan", Level::Warning, "客户端配置中出现可疑内容")
                .body(format!("新增 {} 项，详见安全页。", alerts.len()))
                .view(SECURITY)
                .now(),
        ],
        _ => Vec::new(),
    }
}

/// 网关本身的状态。**这是唯一的 critical** —— 它一停，所有客户端都在瞎
pub fn from_core_state(state: &crate::supervisor::CoreState) -> Vec<Signal> {
    use crate::supervisor::CoreState;
    match state {
        // 用户自己停掉的也算「这件事过去了」：界面上那一条说得清清楚楚
        CoreState::Running { .. } | CoreState::Stopped => vec![Signal::cleared("gateway")],
        CoreState::SafeMode => vec![
            Signal::raised("gateway", Level::Critical, "网关未在转发")
                .body("已连续启动失败，当前只有配置和历史可用。".to_string())
                .view(CONFIG)
                .now()
                .suppressing(suppresses("gateway")),
        ],
        // 偶发崩溃自己好了就别打扰人；连着崩说明不是偶发
        CoreState::Restarting { attempt, .. } if *attempt >= 3 => vec![
            Signal::raised("gateway", Level::Critical, "网关反复退出")
                .body(format!("已连续重启 {attempt} 次，转发可能时断时续。"))
                .view(CONFIG)
                .now()
                .suppressing(suppresses("gateway")),
        ],
        _ => Vec::new(),
    }
}

/// `5h` / `weekly` → 「5 小时」「每周」。认不出来的原样用
fn window_label(w: &str) -> String {
    match w {
        "weekly" => "每周".into(),
        "5h" => "5 小时".into(),
        other => match other.strip_suffix('h').and_then(|n| n.parse::<u32>().ok()) {
            Some(h) => format!("{h} 小时"),
            None => match other.strip_suffix('d').and_then(|n| n.parse::<u32>().ok()) {
                Some(d) => format!("{d} 天"),
                None => other.to_string(),
            },
        },
    }
}

/// 「，约 3 小时后重置」
fn after(secs: u64) -> String {
    let (n, unit) = if secs >= 3600 {
        (secs / 3600, "小时")
    } else if secs >= 60 {
        (secs / 60, "分钟")
    } else {
        return "，即将重置".into();
    };
    format!("，约 {n} {unit}后重置")
}

/// 「1.2 GB」
fn size(bytes: u64) -> String {
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    let gb = bytes as f64 / GB;
    if gb >= 1.0 {
        format!("{gb:.1} GB")
    } else {
        format!("{} MB", bytes / 1024 / 1024)
    }
}
