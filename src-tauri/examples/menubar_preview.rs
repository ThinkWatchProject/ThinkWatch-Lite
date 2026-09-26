//! 菜单栏的样子，用假数据看。**不起应用、不碰 `~/.thinkwatch` 和正在用的网关。**
//!
//! ```sh
//! # 导出几种状态的预览图（深色、浅色各一张）
//! cargo run --manifest-path src-tauri/Cargo.toml --example menubar_preview -- --png <目录>
//! # 挂到菜单栏上，点开看真的菜单。Ctrl-C 退出
//! cargo run --manifest-path src-tauri/Cargo.toml --example menubar_preview -- sub
//! ```
//!
//! 状态：`sub`（订阅账号、有请求在跑）、`alert`（额度用完、有提醒）、`payg`（按量计费、
//! 有新版本）、`down`（网关无法启动）、`starting`、`remote`（连着远程、断线重连中）。
//! 另可加 `--en`、`--icon`、`--numbers`，以及 `--dump`（打出原生菜单里的项就退出）。

#[cfg(target_os = "macos")]
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
        for name in ["sub", "alert", "payg", "down", "starting"] {
            let (bar, rows) = model::build(&snapshot(name), style);
            for dark in [true, false] {
                let path = dir.join(format!(
                    "{name}-{}.png",
                    if dark { "dark" } else { "light" }
                ));
                let ok = macos::write_png(&macos::preview_image(&bar, &rows, dark), &path);
                println!("{} {}", if ok { "wrote" } else { "FAILED" }, path.display());
            }
        }
        // 菜单栏那一块的三档，各种状态并排
        let bars: Vec<model::Bar> = ["sub", "alert", "payg", "down", "starting"]
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
                macos::write_png(&macos::preview_image(bar, &[], dark), &path);
            }
        }
        return;
    }

    let name = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .cloned()
        .unwrap_or_else(|| "sub".to_string());
    macos::install(
        mtm,
        |action| println!("点了：{action:?}"),
        |open| println!("菜单{}", if open { "打开" } else { "关上" }),
    );
    let (bar, rows) = model::build(&snapshot(&name), style);
    macos::apply(mtm, &bar, &rows);
    // `--dump`：把原生菜单里实际有的项打出来就退出（看子菜单、勾选、分隔线）
    if args.iter().any(|a| a == "--dump") {
        for line in macos::describe_menu() {
            println!("{line}");
        }
        return;
    }
    // 进行中的秒数每秒走：和应用里一样，只在后台线程里现算、投递到主线程
    if name == "sub" || name == "alert" {
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let snap = snapshot(&name);
                macos::on_main(move |mtm| {
                    let (bar, rows) = model::build(&snap, style);
                    macos::apply(mtm, &bar, &rows);
                    // 菜单开着时主线程在事件跟踪模式：这一行打出来，就说明投递照样执行了
                    if macos::is_open() {
                        println!("菜单开着时更新了一次");
                    }
                });
            }
        });
    }
    // `--open <秒>`：过一会儿自动把菜单打开，再过这么多秒退出（截图用）
    if let Some(i) = args.iter().position(|a| a == "--open") {
        let secs: u64 = args.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or(6);
        macos::open_menu_later(mtm, 1.2);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1200));
            std::thread::sleep(std::time::Duration::from_secs(secs));
            macos::on_main(|_| macos::close_menu());
            std::thread::sleep(std::time::Duration::from_millis(300));
            std::process::exit(0);
        });
    }
    app.run();
}

#[cfg(target_os = "macos")]
fn snapshot(name: &str) -> thinkwatch_lite_lib::menubar::model::Snapshot {
    use thinkwatch_lite_lib::menubar::model::*;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    // 秒数从启动那一刻算起，看得出它在走
    static START: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    let start = *START.get_or_init(|| now);
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
    let base = Snapshot {
        gateway: Gateway::Running,
        addr: Some("127.0.0.1:18790".into()),
        notices_on: true,
        now_ms: now,
        connections: vec![
            Connection {
                id: "local".into(),
                name: thinkwatch_lite_lib::connection::store::local_name().into(),
                current: name != "remote",
            },
            Connection {
                id: "a1".into(),
                name: "home-server".into(),
                current: name == "remote",
            },
            Connection {
                id: "b2".into(),
                name: "office-nas".into(),
                current: false,
            },
        ],
        ..Default::default()
    };
    if name == "remote" {
        return Snapshot {
            gateway: Gateway::Unlinked,
            remote: Some("home-server".into()),
            ..base
        };
    }
    match name {
        "sub" => Snapshot {
            today: Some(Today {
                requests: 186,
                failed: 0,
                tokens: 3_100_000,
                cost_micros: 41_200_000,
            }),
            quotas: vec![
                Quota {
                    provider: "chatgpt".into(),
                    windows: vec![
                        window("5h", 42.0, 3 * 3_600_000),
                        window("weekly", 18.0, 4 * 86_400_000),
                    ],
                    reset_credits: None,
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
                            ..window("weekly", 2.0, 3 * 86_400_000)
                        },
                    ],
                    reset_credits: None,
                },
            ],
            live: vec![
                Live {
                    id: 41,
                    app: Some("codex".into()),
                    key: "codex".into(),
                    model: "gpt-5-codex".into(),
                    started_ms: start - 102_000,
                },
                Live {
                    id: 42,
                    app: Some("opencode".into()),
                    key: "default".into(),
                    model: "gpt-5-mini".into(),
                    started_ms: start - 8_000,
                },
            ],
            rate: Some(52),
            groups: vec![Group {
                name: "主力".into(),
                members: vec!["chatgpt".into(), "openai".into(), "openrouter".into()],
                selected: Some("chatgpt".into()),
            }],
            ..base
        },
        "alert" => Snapshot {
            today: Some(Today {
                requests: 244,
                failed: 9,
                tokens: 4_200_000,
                cost_micros: 40_260_000,
            }),
            quotas: vec![Quota {
                provider: "chatgpt".into(),
                windows: vec![
                    Window {
                        status: Some("rejected".into()),
                        ..window("5h", 100.0, 42 * 60_000)
                    },
                    window("weekly", 63.0, 3 * 86_400_000),
                ],
                reset_credits: Some(2),
            }],
            notices: vec![
                NoticeLine {
                    key: "quota:chatgpt:5h".into(),
                    level: Level::Warning,
                    title: "chatgpt 的订阅额度已用完".into(),
                    body: "5 小时额度已用完，42 分钟后重置。经此上游的请求会被拒绝。".into(),
                },
                NoticeLine {
                    key: "auth:gemini".into(),
                    level: Level::Warning,
                    title: "gemini 拒绝了当前凭据".into(),
                    body: "上游返回未授权（401），该上游的凭据可能已失效。".into(),
                },
                NoticeLine {
                    key: "upstream:anthropic".into(),
                    level: Level::Info,
                    title: "上游「anthropic」无法连接".into(),
                    body: "连续多次请求失败，暂停向其转发。".into(),
                },
                NoticeLine {
                    key: "proxy:corp".into(),
                    level: Level::Info,
                    title: "代理「corp」不通".into(),
                    body: "经此代理的上游都无法连接。".into(),
                },
            ],
            live: vec![Live {
                id: 7,
                app: Some("claude-code".into()),
                key: "claude-code".into(),
                model: "claude-sonnet-4-5".into(),
                started_ms: start - 21_000,
            }],
            groups: vec![Group {
                name: "主力".into(),
                members: vec!["chatgpt".into(), "openrouter".into()],
                selected: Some("openrouter".into()),
            }],
            ..base
        },
        "payg" => Snapshot {
            today: Some(Today {
                requests: 312,
                failed: 0,
                tokens: 5_800_000,
                cost_micros: 3_420_000,
            }),
            update: Some("2026.9.8".into()),
            ..base
        },
        "down" => Snapshot {
            gateway: Gateway::Failed,
            ..base
        },
        _ => Snapshot {
            gateway: Gateway::Starting,
            ..base
        },
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {}
