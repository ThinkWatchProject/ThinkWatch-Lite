//! 菜单栏的样子，用假数据看。**不起应用、不碰 `~/.thinkwatch` 和正在用的网关。**
//!
//! ```sh
//! # 导出几种状态的预览图：中文、英文，深色、浅色各一张
//! cargo run --manifest-path src-tauri/Cargo.toml --example menubar_preview -- --png <目录>
//! # 再加上菜单栏那一块的三档
//! cargo run --manifest-path src-tauri/Cargo.toml --example menubar_preview -- --png <目录> --bars
//! # 挂到菜单栏上，点开看真的菜单。Ctrl-C 退出
//! cargo run --manifest-path src-tauri/Cargo.toml --example menubar_preview -- busy
//! ```
//!
//! 状态：`busy`（有提醒、一个额度窗口、两个在跑、有新版本）、`idle`（今天还没有请求）、
//! `alert`（额度用完、有重置卡，另一家是积分制套餐）、`remote`（连着远程）、`stopped`、
//! `unlinked`（连着远程、断线重连中）、`starting`、`safemode`。另可加 `--en`、`--icon`、
//! `--numbers`，以及 `--dump`（打出原生菜单里的项就退出）。

/// `--png` 导出的那几种状态
#[cfg(all(target_os = "macos", debug_assertions))]
const STATES: [&str; 8] = [
    "busy", "idle", "alert", "remote", "stopped", "unlinked", "starting", "safemode",
];

#[cfg(all(target_os = "macos", debug_assertions))]
fn main() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
    use thinkwatch_lite_lib::i18n::{self, Lang};
    use thinkwatch_lite_lib::menubar::{macos, model};

    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--en") {
        i18n::set(Lang::En);
    }
    let style = if args.iter().any(|a| a == "--icon") {
        model::Style::Icon
    } else if args.iter().any(|a| a == "--numbers") {
        model::Style::Numbers
    } else {
        model::Style::Full
    };
    let mtm = MainThreadMarker::new().expect("主线程");
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);

    if let Some(i) = args.iter().position(|a| a == "--png") {
        let dir = std::path::PathBuf::from(args.get(i + 1).expect("--png 后面要一个目录"));
        std::fs::create_dir_all(&dir).expect("建不了目录");
        for (lang, tag) in [(Lang::Zh, "zh"), (Lang::En, "en")] {
            i18n::set(lang);
            for name in STATES {
                let (bar, rows) = model::build(&snapshot(name), style);
                for dark in [true, false] {
                    let path = dir.join(format!(
                        "{name}-{tag}-{}.png",
                        if dark { "dark" } else { "light" }
                    ));
                    let ok = macos::preview::write_png(
                        &macos::preview::preview_image(&bar, &rows, dark),
                        &path,
                    );
                    println!("{} {}", if ok { "wrote" } else { "FAILED" }, path.display());
                }
            }
        }
        if !args.iter().any(|a| a == "--bars") {
            return;
        }
        // 菜单栏那一块的三档，各种状态并排
        let bars: Vec<model::Bar> = STATES
            .iter()
            .flat_map(|n| {
                [
                    model::Style::Full,
                    model::Style::Icon,
                    model::Style::Numbers,
                ]
                .map(|s| model::build(&snapshot(n), s).0)
            })
            .collect();
        for (i, bar) in bars.iter().enumerate() {
            for dark in [true, false] {
                let path = dir.join(format!(
                    "bar-{i:02}-{}.png",
                    if dark { "dark" } else { "light" }
                ));
                macos::preview::write_png(&macos::preview::preview_image(bar, &[], dark), &path);
            }
        }
        return;
    }

    let name = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .cloned()
        .unwrap_or_else(|| "busy".to_string());
    macos::install(
        mtm,
        |action| println!("点了：{action:?}"),
        |open| println!("菜单{}", if open { "打开" } else { "关上" }),
    );
    let (bar, rows) = model::build(&snapshot(&name), style);
    macos::apply(mtm, &bar, &rows);
    // `--dump`：把原生菜单里实际有的项打出来就退出（看子菜单、勾选、分隔线）
    if args.iter().any(|a| a == "--dump") {
        for line in macos::preview::describe_menu() {
            println!("{line}");
        }
        return;
    }
    // 进行中的秒数每秒走：和应用里一样，只在后台线程里现算、投递到主线程
    if name == "busy" || name == "alert" || name == "remote" {
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let snap = snapshot(&name);
                macos::on_main(move |mtm| {
                    let (bar, rows) = model::build(&snap, style);
                    macos::apply(mtm, &bar, &rows);
                    // 菜单开着时主线程在事件跟踪模式：这一行打出来，就说明投递照样执行了
                    if macos::preview::is_open() {
                        println!("菜单开着时更新了一次");
                    }
                });
            }
        });
    }
    // `--open <秒>`：过一会儿自动把菜单打开，再过这么多秒退出（截图用）
    if let Some(i) = args.iter().position(|a| a == "--open") {
        let secs: u64 = args.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or(6);
        macos::preview::open_menu_later(mtm, 1.2);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1200));
            std::thread::sleep(std::time::Duration::from_secs(secs));
            macos::on_main(|_| macos::preview::close_menu());
            std::thread::sleep(std::time::Duration::from_millis(300));
            std::process::exit(0);
        });
    }
    app.run();
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn snapshot(name: &str) -> thinkwatch_lite_lib::menubar::model::Snapshot {
    use thinkwatch_lite_lib::menubar::model::*;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    // 秒数从启动那一刻算起，看得出它在走
    static START: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    let start = *START.get_or_init(|| now);
    const H: u64 = 3_600_000;
    const DAY: u64 = 86_400_000;
    let window = |w: &str, used: f64, in_ms: u64| Window {
        window: w.into(),
        used_percent: used,
        resets_at_ms: Some(now + in_ms),
        status: None,
        credits: None,
    };
    // GLM Coding Plan 积分制套餐：每个窗口的条下面多一行还剩多少积分
    let credits = |total: f64, used: f64, remaining: f64| {
        Some(QuotaCredits {
            total,
            used,
            remaining,
        })
    };
    // 今天每小时的 token：`hours` 的最后一格是此刻所在的那一小时，其余的到午夜都还没到。
    // 合计就是「今日」的大数字 —— 和真的一样，两者出自同一问
    let day = |hours: &[i64], unit: i64, requests: i64, failed: i64, cost_micros: i64| {
        let mut tokens: Vec<i64> = hours.iter().map(|h| h * unit).collect();
        let total = tokens.iter().sum();
        tokens.resize(24, 0);
        let hourly = Hourly {
            from_ms: (now - (hours.len() as u64 - 1) * H - H / 2) as i64,
            tokens,
        };
        let today = Today {
            requests,
            failed,
            tokens: total,
            cost_micros,
            ..Default::default()
        };
        (Some(today), Some(hourly))
    };
    let busy_hours = [
        0, 0, 0, 0, 0, 0, 0, 1, 3, 8, 12, 10, 6, 9, 14, 16, 11, 9, 7, 5, 10, 7,
    ];
    let remote_hours = [
        0, 0, 0, 0, 0, 0, 0, 0, 2, 5, 6, 4, 3, 5, 7, 6, 4, 3, 2, 1, 3, 2,
    ];
    let live = |id: u64, app: &str, model: &str, secs: u64| Live {
        id,
        app: Some(app.into()),
        key: app.into(),
        model: model.into(),
        started_ms: start - secs * 1000,
    };
    let remote = matches!(name, "remote" | "unlinked");
    let base = Snapshot {
        gateway: Gateway::Running,
        addr: Some(if remote {
            "192.168.1.20:8788".into()
        } else {
            "127.0.0.1:8788".into()
        }),
        notices_on: true,
        now_ms: now,
        remote: remote.then(|| "office-mac".to_string()),
        connections: vec![
            Connection {
                id: "local".into(),
                name: thinkwatch_lite_lib::connection::store::local_name().into(),
                current: !remote,
            },
            Connection {
                id: "a1".into(),
                name: "office-mac".into(),
                current: remote,
            },
            Connection {
                id: "b2".into(),
                name: "home-server".into(),
                current: false,
            },
        ],
        groups: vec![Group {
            name: "主力".into(),
            members: vec!["Claude".into(), "chatgpt".into(), "openrouter".into()],
            selected: Some("Claude".into()),
        }],
        ..Default::default()
    };
    match name {
        "busy" => {
            let (today, hourly) = day(&busy_hours, 9_700, 128, 2, 3_470_000);
            Snapshot {
                today,
                hourly,
                rate: Some(42),
                quotas: vec![Quota {
                    provider: "ChatGPT".into(),
                    windows: vec![window("weekly", 31.0, 4 * DAY)],
                    reset_credits: None,
                }],
                notices: vec![NoticeLine {
                    key: "balance:openrouter".into(),
                    level: Level::Warning,
                    title: thinkwatch_lite_lib::tr!(
                        "OpenRouter 余额不足",
                        "OpenRouter balance is low"
                    )
                    .into(),
                    body: thinkwatch_lite_lib::tr!(
                        "已暂停使用 10 分钟。",
                        "Paused for 10 minutes."
                    )
                    .into(),
                }],
                live: vec![
                    live(41, "claude-code", "claude-opus-4-6", 12),
                    live(42, "codex", "gpt-5.2-codex", 3),
                ],
                update: Some("2026.10.9".into()),
                ..base
            }
        }
        "idle" => Snapshot {
            today: Some(Today::default()),
            hourly: Some(Hourly {
                from_ms: (now - 9 * H - H / 2) as i64,
                tokens: vec![0; 24],
            }),
            quotas: vec![Quota {
                provider: "ChatGPT".into(),
                windows: vec![window("weekly", 27.0, 4 * DAY)],
                reset_credits: None,
            }],
            ..base
        },
        "alert" => {
            let (today, hourly) = day(&busy_hours, 32_800, 244, 9, 40_260_000);
            Snapshot {
                today: today.map(|t| Today { unpriced: 3, ..t }),
                hourly,
                rate: Some(52),
                listen_error: Some(thinkwatch_lite_lib::tr!(
                    "端口 8788 已被占用，仍在旧地址上服务。",
                    "Port 8788 is already in use. The old address is still serving."
                )
                .into()),
                quotas: vec![
                    Quota {
                        provider: "chatgpt".into(),
                        windows: vec![
                            Window {
                                status: Some("rejected".into()),
                                ..window("5h", 100.0, 42 * 60_000)
                            },
                            window("weekly", 83.0, 3 * DAY),
                        ],
                        reset_credits: Some(2),
                    },
                    Quota {
                        provider: "glm".into(),
                        windows: vec![
                            Window {
                                credits: credits(2_000.0, 23.0, 1_976.0),
                                ..window("5h", 1.0, 58 * 60_000)
                            },
                            Window {
                                credits: credits(10_000.0, 268.0, 9_731.0),
                                ..window("weekly", 2.0, 3 * DAY)
                            },
                        ],
                        reset_credits: None,
                    },
                ],
                notices: vec![
                    NoticeLine {
                        key: "quota:chatgpt:5h".into(),
                        level: Level::Warning,
                        title: thinkwatch_lite_lib::tr!("chatgpt 的订阅额度已用完", "The chatgpt subscription quota is used up").into(),
                        body: thinkwatch_lite_lib::tr!("5 小时额度已用完，42 分钟后重置。经此上游的请求会被拒绝。", "The 5h quota is used up and resets in 42 min. Requests through this upstream are refused.").into(),
                    },
                    NoticeLine {
                        key: "auth:gemini".into(),
                        level: Level::Critical,
                        title: thinkwatch_lite_lib::tr!("gemini 拒绝了当前凭据", "gemini rejected the current credentials").into(),
                        body: thinkwatch_lite_lib::tr!("上游返回未授权（401），该上游的凭据可能已失效。", "The upstream answered 401 Unauthorized. Its credentials may have expired.").into(),
                    },
                    NoticeLine {
                        key: "upstream:anthropic".into(),
                        level: Level::Info,
                        title: thinkwatch_lite_lib::tr!("上游「anthropic」无法连接", "The upstream anthropic is unreachable").into(),
                        body: thinkwatch_lite_lib::tr!("连续多次请求失败，暂停向其转发。", "Several requests in a row failed. Forwarding to it is paused.").into(),
                    },
                    NoticeLine {
                        key: "proxy:corp".into(),
                        level: Level::Info,
                        title: thinkwatch_lite_lib::tr!("代理「corp」不通", "The proxy corp is unreachable").into(),
                        body: thinkwatch_lite_lib::tr!("经此代理的上游都无法连接。", "No upstream behind this proxy can be reached.").into(),
                    },
                ],
                live: (0..7)
                    .map(|i| live(7 + i, "claude-code", "claude-sonnet-4-5", 21 + i * 13))
                    .collect(),
                ..base
            }
        }
        "remote" => {
            let (today, hourly) = day(&remote_hours, 6_700, 56, 0, 1_120_000);
            Snapshot {
                today,
                hourly,
                rate: Some(38),
                live: vec![live(9, "claude-code", "claude-sonnet-4-5", 5)],
                ..base
            }
        }
        "stopped" => Snapshot {
            gateway: Gateway::Stopped,
            ..base
        },
        "unlinked" => Snapshot {
            gateway: Gateway::Unlinked,
            update: Some("2026.10.9".into()),
            ..base
        },
        "safemode" => Snapshot {
            gateway: Gateway::SafeMode,
            ..base
        },
        _ => Snapshot {
            gateway: Gateway::Starting,
            ..base
        },
    }
}

/// 预览的那几样只在开发构建里（`menubar::macos::preview`）：`cargo run` 就是开发构建
#[cfg(not(all(target_os = "macos", debug_assertions)))]
fn main() {}
