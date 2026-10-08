use super::*;
use crate::i18n::{Lang, with_lang};

const NOW: u64 = 1_800_000_000_000;

fn running() -> Snapshot {
    Snapshot {
        gateway: Gateway::Running,
        addr: Some("127.0.0.1:18790".into()),
        today: Some(Today {
            requests: 186,
            failed: 0,
            tokens: 3_100_000,
            cost_micros: 41_200_000,
            ..Default::default()
        }),
        notices_on: true,
        now_ms: NOW,
        ..Default::default()
    }
}

fn window(window: &str, used: f64, reset_in_ms: u64) -> Window {
    Window {
        window: window.into(),
        used_percent: used,
        resets_at_ms: Some(NOW + reset_in_ms),
        status: None,
        credits: None,
    }
}

fn items(rows: &[Row]) -> Vec<&Item> {
    rows.iter()
        .filter_map(|r| match r {
            Row::Item(i) => Some(i),
            _ => None,
        })
        .collect()
}

fn item<'a>(rows: &'a [Row], id: &str) -> Option<&'a Item> {
    items(rows).into_iter().find(|i| i.id == id)
}

/// 菜单从上到下：状态头、分隔线（`---`）、节的标题（`[今日]`）、各行，菜单项写 id
fn outline(rows: &[Row]) -> Vec<String> {
    rows.iter()
        .map(|r| match r {
            Row::Header { .. } => "header".to_string(),
            Row::Separator => "---".to_string(),
            Row::Section { title, .. } => format!("[{title}]"),
            Row::Notice { .. } => "notice".to_string(),
            Row::Quota { provider, .. } => format!("quota:{provider}"),
            Row::Stats { .. } => "stats".to_string(),
            Row::Live { .. } => "live".to_string(),
            Row::Item(i) => i.id.clone(),
        })
        .collect()
}

#[test]
fn a_full_menu_has_today_above_quota_and_open_first_among_the_actions() {
    let mut s = running();
    s.notices = vec![NoticeLine {
        key: "k".into(),
        level: Level::Warning,
        title: "t".into(),
        body: "b".into(),
    }];
    s.quotas = vec![Quota {
        provider: "chatgpt".into(),
        windows: vec![window("5h", 42.0, 3_600_000)],
        reset_credits: None,
    }];
    s.live = vec![Live {
        id: 1,
        started_ms: NOW - 1_000,
        ..Default::default()
    }];
    s.groups = vec![Group {
        name: "主力".into(),
        members: vec!["chatgpt".into(), "openai".into()],
        selected: Some("chatgpt".into()),
    }];
    assert_eq!(
        outline(&rows(&s)),
        [
            "header",
            "---",
            "[提醒]",
            "notice",
            "---",
            "[今日]",
            "stats",
            "---",
            "[额度]",
            "quota:chatgpt",
            "---",
            "[进行中]",
            "live",
            "---",
            "open",
            "group:主力",
            "copy-address",
            "copy-key",
            "---",
            "settings",
            "connections",
            "update",
            "---",
            "quit",
        ]
    );
    // 各节都空着：动作区紧跟在状态头后面
    s.notices.clear();
    s.today = None;
    s.quotas.clear();
    s.live.clear();
    s.groups.clear();
    assert_eq!(
        outline(&rows(&s)),
        [
            "header",
            "---",
            "open",
            "copy-address",
            "copy-key",
            "---",
            "settings",
            "connections",
            "update",
            "---",
            "quit",
        ]
    );
}

/// 网关不在运行的每一种状态：「打开主界面」照样在，照样是动作区的第一项；设置、
/// 连接、更新的顺序和运行时一样。今天的用量不代表现在，不列
#[test]
fn every_state_keeps_open_first_and_the_app_items_in_one_order() {
    let fix = ["restart", "why", "---"];
    for (gateway, head) in [
        (Gateway::Starting, &[][..]),
        (Gateway::SafeMode, &fix[..]),
        (Gateway::Failed, &fix[..]),
        (Gateway::Stopped, &fix[..]),
        (Gateway::Unlinked, &["retry", "why", "---"][..]),
    ] {
        let s = Snapshot {
            gateway: gateway.clone(),
            ..running()
        };
        let want: Vec<&str> = ["header", "---"]
            .iter()
            .chain(head)
            .chain(&[
                "open",
                "---",
                "settings",
                "connections",
                "update",
                "---",
                "quit",
            ])
            .copied()
            .collect();
        assert_eq!(outline(&rows(&s)), want, "{gateway:?}");
    }
}

#[test]
fn the_bar_shows_todays_tokens_over_todays_cost() {
    let (bar, _) = build(&running(), Style::Full);
    assert_eq!(bar.numbers, Some(("3.1M".into(), "$41.20".into())));
    assert!(!bar.dim && !bar.alert && !bar.dot);
}

/// **估算不能冒充实测，算不出钱的也不能当成零**：和界面上同一套记号，菜单栏上
/// 那个数是下限的写「≥」，含估算的带「~」，缺着什么写在费用那一格下面
#[test]
fn todays_cost_says_when_it_is_estimated_or_only_a_lower_bound() {
    use crate::i18n::{Lang, with_lang};
    let cost = |t: Today| {
        let mut s = running();
        s.today = Some(t);
        let (bar, rows) = build(&s, Style::Full);
        let cell = rows
            .iter()
            .find_map(|r| match r {
                Row::Stats { cells, .. } => cells.get(2).cloned(),
                _ => None,
            })
            .unwrap();
        (bar.numbers.unwrap().1, cell.value, cell.note, bar.tooltip)
    };
    let base = Today {
        requests: 10,
        tokens: 1_000,
        cost_micros: 2_500_000,
        ..Default::default()
    };
    with_lang(Lang::En, || {
        let (short, long, note, _) = cost(base.clone());
        assert_eq!(
            (short.as_str(), long.as_str(), note),
            ("$2.50", "$2.50", None)
        );

        let (short, long, note, tip) = cost(Today {
            estimated_micros: 500_000,
            ..base.clone()
        });
        assert_eq!(
            (short.as_str(), long.as_str(), note),
            ("~$2.50", "~$2.50", None)
        );
        assert!(tip.contains("~$2.50 cost"), "{tip}");

        let (short, _, note, _) = cost(Today {
            unpriced: 3,
            ..base.clone()
        });
        assert_eq!(short, "≥$2.50");
        assert_eq!(note.as_deref(), Some("3 unpriced"));

        // 一条都没算出钱：不是「今天花了 $0」
        let (short, _, note, _) = cost(Today {
            cost_micros: 0,
            no_usage: 2,
            ..base.clone()
        });
        assert_eq!(short, "≥$0.00");
        assert_eq!(note.as_deref(), Some("2 with no usage"));
    });
}

#[test]
fn an_unknown_day_is_two_dashes_and_a_quiet_day_is_zero() {
    // 0 是一个值，破折号不是：问到了、今天还没有请求，就写 0
    let mut s = running();
    s.today = None;
    assert_eq!(build(&s, Style::Full).0.numbers, None);
    s.today = Some(Today::default());
    assert_eq!(
        build(&s, Style::Full).0.numbers,
        Some(("0".into(), "$0.00".into()))
    );
}

#[test]
fn numbers_are_written_the_way_the_overview_writes_them() {
    for (n, want) in [
        (0, "0"),
        (845, "845"),
        (9_800, "9.8k"),
        (123_400, "123k"),
        (3_100_000, "3.1M"),
        (1_240_000_000, "1.2B"),
    ] {
        assert_eq!(tokens_short(n), want, "{n}");
    }
    for (micros, want) in [
        (0, "$0.00"),
        (3_420_000, "$3.42"),
        (99_990_000, "$99.99"),
        (123_400_000, "$123"),
        (1_234_000_000, "$1.2k"),
        (12_345_000_000, "$12k"),
    ] {
        assert_eq!(cost_short(micros), want, "{micros}");
    }
    assert_eq!(cost_long(1_234_567_000_000), "$1,234,567");
    assert_eq!(grouped(1234), "1,234");
    assert_eq!(elapsed(102_000), "1:42");
    assert_eq!(elapsed(3_800_000), "1:03:20");
}

/// **取整之后再定单位。**先定单位再取整，就会写出「10.0k」「1000k」「$10.0k」「60 分钟」
/// 这样多出一位、或者该进位却没进的数
#[test]
fn a_number_that_rounds_up_to_the_next_unit_is_written_in_that_unit() {
    for (n, want) in [
        (9_949, "9.9k"),
        (9_960, "10k"),
        (9_999, "10k"),
        (999_499, "999k"),
        (999_500, "1.0M"),
        (999_999, "1.0M"),
        (999_949_999, "999.9M"),
        (999_950_001, "1.0B"),
    ] {
        assert_eq!(tokens_short(n), want, "{n}");
    }
    for (micros, want) in [
        (99_994_999, "$99.99"),
        (99_996_000, "$100"),
        (999_499_999, "$999"),
        (999_600_000, "$1.0k"),
        (9_949_000_000, "$9.9k"),
        (9_960_000_000, "$10k"),
    ] {
        assert_eq!(cost_short(micros), want, "{micros}");
    }
    assert_eq!(cost_long(999_994_000), "$999.99");
    assert_eq!(cost_long(999_996_000), "$1,000");
    // 59.5 分钟往上是「1 小时」，23.5 小时往上是「1 天」，和上游页一样
    assert_eq!(resets_in(3_569), "59 分钟后重置");
    assert_eq!(resets_in(3_570), "1 小时后重置");
    assert_eq!(resets_in(84_599), "23 小时后重置");
    assert_eq!(resets_in(84_600), "1 天后重置");
    with_lang(Lang::En, || {
        assert_eq!(resets_in(3_570), "Resets in 1 h");
        assert_eq!(resets_in(84_600), "Resets in 1 day");
    });
}

#[test]
fn a_tight_quota_turns_the_numbers_orange_and_a_used_up_one_red() {
    let mut s = running();
    s.quotas = vec![Quota {
        provider: "chatgpt".into(),
        windows: vec![
            window("5h", 42.0, 3_600_000),
            window("weekly", 18.0, 86_400_000),
        ],
        reset_credits: None,
    }];
    assert_eq!(build(&s, Style::Full).0.tone, Tone::Normal);
    s.quotas[0].windows[0].used_percent = 91.0;
    assert_eq!(build(&s, Style::Full).0.tone, Tone::Warn);
    // 上游说快到了的，不管用了多少都算
    s.quotas[0].windows[0].used_percent = 50.0;
    s.quotas[0].windows[0].status = Some("allowed_warning".into());
    assert_eq!(build(&s, Style::Full).0.tone, Tone::Warn);
    s.quotas[0].windows[0].status = Some("rejected".into());
    assert_eq!(build(&s, Style::Full).0.tone, Tone::Full);
}

/// 颜色看**最要紧**的那个窗口，不是用得最多的那个：每周的用了 95%，5 小时的上游已经
/// 拒绝了，菜单栏是红的；用得最多的那个没事、另一家上游说快到了，是橙的。悬停提示说的
/// 也是定了颜色的那个窗口
#[test]
fn the_bar_takes_its_color_from_the_most_severe_window_not_the_fullest() {
    let mut s = running();
    s.quotas = vec![Quota {
        provider: "chatgpt".into(),
        windows: vec![
            window("weekly", 95.0, 86_400_000),
            Window {
                status: Some("rejected".into()),
                ..window("5h", 40.0, 3_600_000)
            },
        ],
        reset_credits: None,
    }];
    let (bar, _) = build(&s, Style::Full);
    assert_eq!(bar.tone, Tone::Full);
    assert!(
        bar.tooltip.ends_with("chatgpt 5 小时额度已用 40%"),
        "{}",
        bar.tooltip
    );

    s.quotas = vec![
        Quota {
            provider: "chatgpt".into(),
            windows: vec![window("5h", 60.0, 3_600_000)],
            reset_credits: None,
        },
        Quota {
            provider: "glm".into(),
            windows: vec![Window {
                status: Some("allowed_warning".into()),
                ..window("weekly", 30.0, 86_400_000)
            }],
            reset_credits: None,
        },
    ];
    let (bar, _) = build(&s, Style::Full);
    assert_eq!(bar.tone, Tone::Warn);
    assert!(
        bar.tooltip.ends_with("glm 每周额度已用 30%"),
        "{}",
        bar.tooltip
    );
}

#[test]
fn a_window_past_its_reset_is_not_the_current_state() {
    let mut s = running();
    s.quotas = vec![Quota {
        provider: "chatgpt".into(),
        windows: vec![Window {
            window: "5h".into(),
            used_percent: 100.0,
            resets_at_ms: Some(NOW - 1),
            status: Some("rejected".into()),
            credits: None,
        }],
        reset_credits: Some(2),
    }];
    let (bar, rows) = build(&s, Style::Full);
    assert_eq!(bar.tone, Tone::Normal, "已经重置过的窗口还在让菜单栏变红");
    let Some(Row::Quota { windows, .. }) = rows.iter().find(|r| matches!(r, Row::Quota { .. }))
    else {
        panic!("额度那一块不见了");
    };
    assert_eq!(windows[0].percent, None, "重置过的窗口还在画条");
    assert_eq!(windows[0].reset, "已重置");
    assert!(
        item(&rows, "resets:chatgpt").is_none(),
        "额度没用完却给了重置卡"
    );
}

#[test]
fn a_used_up_quota_offers_the_reset_credits_only_when_there_are_some() {
    let mut s = running();
    s.quotas = vec![Quota {
        provider: "chatgpt".into(),
        windows: vec![Window {
            status: Some("rejected".into()),
            ..window("5h", 100.0, 42 * 60_000)
        }],
        reset_credits: Some(2),
    }];
    let (_, rows) = build(&s, Style::Full);
    let credits = item(&rows, "resets:chatgpt").expect("用完了、也有卡，却没给入口");
    assert_eq!(credits.right.as_deref(), Some("可用 2 张"));
    assert_eq!(
        credits.action,
        Some(Action::Open("upstreams")),
        "菜单里不直接用卡"
    );
    s.quotas[0].reset_credits = Some(0);
    assert!(item(&build(&s, Style::Full).1, "resets:chatgpt").is_none());
}

#[test]
fn quota_bars_turn_orange_at_eighty_percent() {
    let mut s = running();
    s.quotas = vec![Quota {
        provider: "chatgpt".into(),
        windows: vec![
            window("5h", 79.0, 3_600_000),
            window("weekly", 80.0, 86_400_000),
        ],
        reset_credits: None,
    }];
    let rows = rows(&s);
    let Some(Row::Quota { windows, .. }) = rows.iter().find(|r| matches!(r, Row::Quota { .. }))
    else {
        panic!();
    };
    assert_eq!(
        (windows[0].tone, windows[1].tone),
        (Tone::Normal, Tone::Warn)
    );
    assert_eq!(windows[0].label, "5 小时");
    assert_eq!(windows[0].reset, "1 小时后重置");
    assert_eq!(windows[1].label, "每周");
}

/// `5h`、`weekly` 有自己的叫法；core 按长度起的名字（ChatGPT 账号的 `30d`）按长度说；
/// 认不出来的原样显示
#[test]
fn windows_named_by_their_length_are_said_in_words() {
    let names = [
        "5h", "weekly", "30d", "1d", "7d", "3h", "1h", "45m", "1m", "monthly", "d", "+5h", "5 h",
        "",
    ];
    assert_eq!(
        names.map(window_label),
        [
            "5 小时",
            "每周",
            "30 天",
            "1 天",
            "7 天",
            "3 小时",
            "1 小时",
            "45 分钟",
            "1 分钟",
            "monthly",
            "d",
            "+5h",
            "5 h",
            "",
        ]
    );
    with_lang(Lang::En, || {
        assert_eq!(
            names.map(window_label),
            [
                "5h",
                "Weekly",
                "30 days",
                "1 day",
                "7 days",
                "3 hours",
                "1 hour",
                "45 minutes",
                "1 minute",
                "monthly",
                "d",
                "+5h",
                "5 h",
                "",
            ]
        );
    });
}

#[test]
fn requests_in_progress_put_a_dot_on_the_mark_and_list_at_most_five() {
    let mut s = running();
    s.live = (1..=7)
        .map(|i| Live {
            id: i,
            app: (i == 1).then(|| "codex".to_string()),
            key: "default".into(),
            model: "gpt-5-codex".into(),
            started_ms: NOW - 102_000,
        })
        .collect();
    let (bar, rows) = build(&s, Style::Full);
    assert!(bar.dot);
    let live: Vec<_> = rows
        .iter()
        .filter_map(|r| match r {
            Row::Live { app, elapsed, .. } => Some((app.as_str(), elapsed.as_str())),
            _ => None,
        })
        .collect();
    assert_eq!(live.len(), MAX_LIVE);
    assert_eq!(live[0], ("Codex", "1:42"));
    // 认不出应用的用密钥名
    assert_eq!(live[1].0, "default");
    assert_eq!(item(&rows, "live-more").unwrap().title, "另有 2 个");
}

#[test]
fn notices_come_first_and_stop_at_three() {
    let mut s = running();
    s.notices = (0..4)
        .map(|i| NoticeLine {
            key: format!("k{i}"),
            level: Level::Warning,
            title: format!("t{i}"),
            body: "b".into(),
        })
        .collect();
    let rows = rows(&s);
    // 状态头、分隔线之后就是提醒
    assert!(matches!(&rows[2], Row::Section { title, .. } if title == "提醒"));
    let shown = rows
        .iter()
        .filter(|r| matches!(r, Row::Notice { .. }))
        .count();
    assert_eq!(shown, MAX_NOTICES);
    assert_eq!(item(&rows, "all-notices").unwrap().title, "全部提醒（4）…");
    // 提醒关掉了，这一节就不出现
    s.notices_on = false;
    assert!(
        !super::rows(&s)
            .iter()
            .any(|r| matches!(r, Row::Notice { .. }))
    );
}

#[test]
fn a_gateway_that_is_not_running_says_why_and_offers_a_restart() {
    let mut s = running();
    s.gateway = Gateway::Failed;
    s.live = vec![Live::default()];
    let (bar, rows) = build(&s, Style::Full);
    assert_eq!(bar.numbers, None, "不在运行时还显示一个凝固的旧数字");
    assert!(bar.dim && bar.alert && !bar.dot);
    assert!(
        matches!(&rows[0], Row::Header { state, tone: StateTone::Bad, .. } if state == "无法启动")
    );
    assert_eq!(
        item(&rows, "restart").unwrap().action,
        Some(Action::RestartGateway)
    );
    assert!(
        !rows
            .iter()
            .any(|r| matches!(r, Row::Stats { .. } | Row::Live { .. }))
    );
    // 正在启动时没有什么可重启的，也不画红色角标
    s.gateway = Gateway::Starting;
    let (bar, rows) = build(&s, Style::Full);
    assert!(bar.dim && !bar.alert);
    assert!(item(&rows, "restart").is_none());
}

#[test]
fn a_listen_setting_that_did_not_take_replaces_the_address_line() {
    let mut s = running();
    s.rate = Some(52);
    let Row::Header {
        line2, line2_warn, ..
    } = &rows(&s)[0]
    else {
        panic!()
    };
    assert_eq!(
        (line2.as_str(), *line2_warn),
        ("127.0.0.1:18790 · 52 token/秒", false)
    );
    s.listen_error = Some("端口 18790 已被占用。".into());
    let Row::Header {
        line2, line2_warn, ..
    } = &rows(&s)[0]
    else {
        panic!()
    };
    assert_eq!(
        (line2.as_str(), *line2_warn),
        ("端口 18790 已被占用。", true)
    );
}

#[test]
fn a_new_version_replaces_the_check() {
    let mut s = running();
    assert_eq!(
        item(&rows(&s), "update").unwrap().action,
        Some(Action::CheckUpdates)
    );
    s.update = Some("2026.9.8".into());
    let rows = rows(&s);
    let update = item(&rows, "update").unwrap();
    assert_eq!(update.title, "安装新版本 2026.9.8…");
    assert_eq!(update.action, Some(Action::InstallUpdate));
    assert!(update.accent);
}

#[test]
fn a_select_group_is_a_submenu_with_the_current_member_checked() {
    let mut s = running();
    s.groups = vec![Group {
        name: "主力".into(),
        members: vec!["chatgpt".into(), "openai".into()],
        selected: Some("chatgpt".into()),
    }];
    let rows = rows(&s);
    let g = item(&rows, "group:主力").unwrap();
    assert_eq!(g.right.as_deref(), Some("chatgpt"));
    assert_eq!(
        g.submenu.iter().map(|m| m.checked).collect::<Vec<_>>(),
        [true, false]
    );
    assert_eq!(
        g.submenu[1].action,
        Action::SelectGroup {
            group: "主力".into(),
            provider: "openai".into()
        }
    );
}

#[test]
fn the_menu_follows_the_interface_language() {
    with_lang(Lang::En, || {
        let mut s = running();
        s.quotas = vec![Quota {
            provider: "chatgpt".into(),
            windows: vec![window("weekly", 18.0, 4 * 86_400_000)],
            reset_credits: None,
        }];
        let rows = rows(&s);
        assert!(matches!(&rows[0], Row::Header { state, .. } if state == "Running"));
        let Some(Row::Quota { windows, .. }) = rows.iter().find(|r| matches!(r, Row::Quota { .. }))
        else {
            panic!()
        };
        assert_eq!(
            (windows[0].label.as_str(), windows[0].reset.as_str()),
            ("Weekly", "Resets in 4 days")
        );
        assert_eq!(item(&rows, "quit").unwrap().title, "Quit ThinkWatch Lite…");
        let (bar, _) = build(&s, Style::Full);
        assert!(
            bar.tooltip
                .starts_with("ThinkWatch Lite, Running, 3.1M tokens today")
        );
    });
}

#[test]
fn the_tooltip_says_the_whole_state_in_one_sentence() {
    let mut s = running();
    s.quotas = vec![Quota {
        provider: "chatgpt".into(),
        windows: vec![window("5h", 42.0, 3 * 3_600_000)],
        reset_credits: None,
    }];
    assert_eq!(
        build(&s, Style::Full).0.tooltip,
        "ThinkWatch Lite，运行中，今日 3.1M token，费用 $41.20，chatgpt 5 小时额度已用 42%"
    );
}

#[test]
fn a_row_keeps_its_shape_while_only_its_text_changes() {
    // 菜单开着时，秒数、倒计时每秒在变 —— 那不该让菜单整个重建
    let mut s = running();
    s.live = vec![Live {
        id: 7,
        started_ms: NOW - 1_000,
        ..Default::default()
    }];
    let a: Vec<String> = rows(&s).iter().map(Row::shape).collect();
    s.now_ms += 5_000;
    let b: Vec<String> = rows(&s).iter().map(Row::shape).collect();
    assert_eq!(a, b);
}

/// GLM Coding Plan 积分制套餐：5 小时和每周两个窗口，各带总额、已用、剩余
fn glm() -> Quota {
    let credits = |total: f64, used: f64, remaining: f64| {
        Some(QuotaCredits {
            total,
            used,
            remaining,
        })
    };
    Quota {
        provider: "glm".into(),
        windows: vec![
            Window {
                credits: credits(2_000.0, 23.0, 1_976.0),
                ..window("5h", 1.0, 3_600_000)
            },
            Window {
                credits: credits(10_000.0, 268.0, 9_731.0),
                ..window("weekly", 2.0, 3 * 86_400_000)
            },
        ],
        reset_credits: None,
    }
}

fn quota_rows(s: &Snapshot) -> Vec<WindowRow> {
    rows(s)
        .into_iter()
        .find_map(|r| match r {
            Row::Quota { windows, .. } => Some(windows),
            _ => None,
        })
        .expect("额度那一块不见了")
}

#[test]
fn a_credit_plan_says_what_is_left_under_each_bar() {
    let mut s = running();
    s.quotas = vec![glm()];
    let w = quota_rows(&s);
    assert_eq!(w[0].label, "5 小时");
    // **剩余照上游说的写**：2000 − 23 是 1977，上游说的是 1976
    assert_eq!(w[0].detail.as_deref(), Some("剩余 1,976 / 2,000 积分"));
    assert_eq!(w[1].detail.as_deref(), Some("剩余 9,731 / 10,000 积分"));
    with_lang(Lang::En, || {
        assert_eq!(
            quota_rows(&s)[0].detail.as_deref(),
            Some("1,976 / 2,000 credits left")
        );
    });
    // 按百分比报的窗口没有这一行
    s.quotas[0].windows[0].credits = None;
    assert_eq!(quota_rows(&s)[0].detail, None);
}

#[test]
fn what_was_left_before_a_reset_is_not_shown_after_it() {
    let mut s = running();
    s.quotas = vec![glm()];
    s.now_ms = NOW + 3_600_000;
    let w = quota_rows(&s);
    assert_eq!((w[0].percent, w[0].detail.as_deref()), (None, None));
    assert!(w[1].detail.is_some(), "没到重置时刻的窗口照常写");
}

#[test]
fn a_line_under_a_bar_changes_the_shape_of_the_row() {
    // 带小字的窗口高一截：菜单开着时多了、少了这一行，要重建，不能就地改
    let mut s = running();
    s.quotas = vec![glm()];
    let shape = |s: &Snapshot| -> Vec<String> { rows(s).iter().map(Row::shape).collect() };
    let a = shape(&s);
    assert!(a.contains(&"quota:glm:++".to_string()), "{a:?}");
    s.quotas[0].windows[1].credits = None;
    assert!(shape(&s).contains(&"quota:glm:+-".to_string()));
    // 只是数变了：样子不变
    s.quotas[0].windows[0].credits = Some(QuotaCredits {
        total: 2_000.0,
        used: 500.0,
        remaining: 1_500.0,
    });
    assert!(shape(&s).contains(&"quota:glm:+-".to_string()));
}
