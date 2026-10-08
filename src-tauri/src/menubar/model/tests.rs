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

/// 菜单从上到下：分隔线（`---`）、节的标题（`[提醒]`）、各行，菜单项写 id
fn outline(rows: &[Row]) -> Vec<String> {
    rows.iter()
        .map(|r| match r {
            Row::Status { .. } => "status".to_string(),
            Row::Today(_) => "today".to_string(),
            Row::Separator => "---".to_string(),
            Row::Section { title, .. } => format!("[{title}]"),
            Row::Notice { .. } => "notice".to_string(),
            Row::Quota {
                provider, window, ..
            } => format!("quota:{provider}:{}", window.label),
            Row::Live { .. } => "live".to_string(),
            Row::Item(i) => i.id.clone(),
        })
        .collect()
}

/// 「今日」那一块
fn dash(rows: &[Row]) -> &Dash {
    rows.iter()
        .find_map(|r| match r {
            Row::Today(d) => Some(&**d),
            _ => None,
        })
        .expect("「今日」那一块不见了")
}

/// 所有额度行，按菜单里的次序
fn windows(rows: &[Row]) -> Vec<(&str, &WindowRow)> {
    rows.iter()
        .filter_map(|r| match r {
            Row::Quota {
                provider, window, ..
            } => Some((provider.as_str(), window)),
            _ => None,
        })
        .collect()
}

/// 网关在运行、什么都有：打开主界面在最上面；提醒；今日、额度连在一起；进行中；策略组和
/// 两个复制；有新版本时「安装新版本」在设置前面；退出
#[test]
fn a_busy_menu_opens_with_open_and_puts_today_and_quota_together() {
    let mut s = running();
    s.notices = vec![NoticeLine {
        key: "k".into(),
        level: Level::Warning,
        title: "t".into(),
        body: "b".into(),
    }];
    s.quotas = vec![Quota {
        provider: "chatgpt".into(),
        windows: vec![
            window("5h", 42.0, 3_600_000),
            window("weekly", 31.0, 4 * 86_400_000),
        ],
        reset_credits: None,
    }];
    s.live = vec![
        Live {
            id: 1,
            started_ms: NOW - 1_000,
            ..Default::default()
        },
        Live {
            id: 2,
            started_ms: NOW - 9_000,
            ..Default::default()
        },
    ];
    s.groups = vec![Group {
        name: "主力".into(),
        members: vec!["chatgpt".into(), "openai".into()],
        selected: Some("chatgpt".into()),
    }];
    s.update = Some("2026.10.9".into());
    assert_eq!(
        outline(&rows(&s)),
        [
            "open",
            "---",
            "[提醒]",
            "notice",
            "---",
            "today",
            "quota:chatgpt:5 小时",
            "quota:chatgpt:每周",
            "---",
            "[进行中]",
            "live",
            "live",
            "---",
            "group:主力",
            "copy-address",
            "copy-key",
            "---",
            "update",
            "settings",
            "connections",
            "---",
            "quit",
        ]
    );
}

/// 闲着的时候：没有提醒、没有在跑的、没有新版本。「今日」照样在（今天还没有请求就是 0），
/// 「检查更新」排在这一组最后
#[test]
fn an_idle_menu_keeps_today_and_checks_for_updates_last() {
    let mut s = running();
    s.today = Some(Today::default());
    assert_eq!(
        outline(&rows(&s)),
        [
            "open",
            "---",
            "today",
            "---",
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
    let d = dash(&rows(&s)).clone();
    assert_eq!(d.value, "0");
    assert_eq!(d.meta_line(), "0 次 · $0.00");
    // 还没问到：那一块照样在（状态写在它上面），大字是破折号，下面那一行空着
    s.today = None;
    let rows = rows(&s);
    let d = dash(&rows);
    assert_eq!((d.value.as_str(), d.meta.is_empty()), ("—", true));
    assert_eq!(d.spark, None);
    assert_eq!(d.tooltip, None);
    assert_eq!(d.state, "运行中");
}

/// 「今日」那一块：今天的 token 是大字，下面一行次数、失败、费用 —— 和菜单栏上「token 在上、
/// 费用在下」一个次序。失败数只在有失败时出现，用红字
#[test]
fn today_leads_with_tokens_and_puts_the_cost_last_in_the_small_line() {
    let mut s = running();
    s.today = Some(Today {
        requests: 128,
        failed: 2,
        tokens: 1_240_000,
        cost_micros: 3_470_000,
        ..Default::default()
    });
    s.rate = Some(42);
    let rows = rows(&s);
    let d = dash(&rows);
    assert_eq!(
        (d.title.as_str(), d.state_line()),
        ("今日", "运行中 · 42 token/秒".into())
    );
    assert_eq!(d.tone, StateTone::Ok);
    assert_eq!((d.value.as_str(), d.unit.as_str()), ("1.2M", "token"));
    assert_eq!(d.meta_line(), "128 次 · 失败 2 · $3.47");
    assert_eq!(
        d.meta.iter().map(|m| m.failed).collect::<Vec<_>>(),
        [false, true, false]
    );
    assert_eq!(d.action, Action::Open("dashboard"));
    assert_eq!(d.line(), "今日 1.2M token · 128 次 · 失败 2 · $3.47");
    // 大字是取整过的：悬停提示里写准数
    assert_eq!(
        d.tooltip.as_deref(),
        Some("今日 1,240,000 token，128 次请求，失败 2 次，费用 $3.47")
    );
    // 不知道速率时不写
    let mut s = s.clone();
    s.rate = None;
    s.today.as_mut().unwrap().failed = 0;
    let rows = super::rows(&s);
    assert_eq!(dash(&rows).state_line(), "运行中");
    assert_eq!(dash(&rows).meta_line(), "128 次 · $3.47");
}

/// 连着远程：状态头没了，服务器的名字跟在「运行中」后面 —— 菜单里的数字都是那台的
#[test]
fn a_remote_core_is_named_next_to_the_state() {
    let mut s = running();
    s.remote = Some("office-mac".into());
    s.rate = Some(42);
    assert_eq!(
        dash(&rows(&s)).state_line(),
        "运行中 · office-mac · 42 token/秒"
    );
    // 连不上时：状态那一块写它
    s.gateway = Gateway::Unlinked;
    let rows = rows(&s);
    let Some(Row::Status {
        state,
        server,
        reason,
        tone,
    }) = rows.iter().find(|r| matches!(r, Row::Status { .. }))
    else {
        panic!("状态那一块不见了")
    };
    assert_eq!(state, "未连接");
    assert_eq!(server.as_deref(), Some("office-mac"));
    assert_eq!(reason.as_deref(), Some("正在重新连接。"));
    assert_eq!(*tone, StateTone::Bad);
}

/// 网关不在运行的每一种状态：「打开主界面」照样在最上面；下面是状态和能做的事；更新、设置、
/// 连接和运行时一个次序。今天的用量不代表现在，不列。正在启动时没有可做的事
#[test]
fn every_state_opens_with_open_and_says_what_is_wrong() {
    let fix = ["restart", "why"];
    for (gateway, head, has_update) in [
        (Gateway::Starting, &[][..], false),
        (Gateway::SafeMode, &fix[..], false),
        (Gateway::Failed, &fix[..], true),
        (Gateway::Stopped, &fix[..], false),
        (Gateway::Unlinked, &["retry", "why"][..], true),
    ] {
        let s = Snapshot {
            gateway: gateway.clone(),
            update: has_update.then(|| "2026.10.9".to_string()),
            ..running()
        };
        let app: &[&str] = if has_update {
            &["update", "settings", "connections"]
        } else {
            &["settings", "connections", "update"]
        };
        let want: Vec<&str> = ["open", "---", "status"]
            .iter()
            .chain(head)
            .chain(&["---"])
            .chain(app)
            .chain(&["---", "quit"])
            .copied()
            .collect();
        assert_eq!(outline(&rows(&s)), want, "{gateway:?}");
    }
}

/// 状态那一块：点的颜色和下面那一行橙字，和原来的状态头一样
#[test]
fn the_status_block_says_why_the_gateway_is_not_running() {
    let status = |g: Gateway| {
        let s = Snapshot {
            gateway: g,
            ..running()
        };
        match rows(&s)
            .into_iter()
            .find(|r| matches!(r, Row::Status { .. }))
        {
            Some(Row::Status {
                state,
                tone,
                reason,
                ..
            }) => (state, tone, reason),
            _ => panic!(),
        }
    };
    assert_eq!(
        status(Gateway::Starting),
        ("正在启动".into(), StateTone::Busy, None)
    );
    assert_eq!(
        status(Gateway::SafeMode),
        (
            "未在转发".into(),
            StateTone::Warn,
            Some("已连续启动失败，当前只有配置和历史可用。".into())
        )
    );
    assert_eq!(
        status(Gateway::Failed),
        (
            "无法启动".into(),
            StateTone::Bad,
            Some("core 程序未能运行，转发已停止。".into())
        )
    );
    assert_eq!(
        status(Gateway::Stopped),
        ("未运行".into(), StateTone::Bad, Some("转发已停止。".into()))
    );
    with_lang(Lang::En, || {
        assert_eq!(
            status(Gateway::Stopped),
            (
                "Not Running".into(),
                StateTone::Bad,
                Some("Forwarding has stopped.".into())
            )
        );
    });
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
        let d = dash(&rows);
        // 费用是那一行的最后一段
        let long = d.meta.last().unwrap().text.clone();
        (bar.numbers.unwrap().1, long, d.note.clone(), bar.tooltip)
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
        // 那一行放不下小字时它只在悬停提示里：提示里总有它
        let mut s = running();
        s.today = Some(Today {
            unpriced: 3,
            ..base.clone()
        });
        let rows = rows(&s);
        let d = dash(&rows);
        assert_eq!(
            d.tooltip.as_deref(),
            Some("1,000 tokens today, 10 requests, ≥$2.50 cost (3 unpriced)")
        );
        assert_eq!(
            d.line(),
            "Today 1.0k tokens · 10 requests · ≥$2.50 (3 unpriced)"
        );

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
    let w = windows(&rows)[0].1;
    assert_eq!(w.percent, None, "重置过的窗口还在画条");
    assert_eq!(w.reset, "已重置");
    assert_eq!(w.right(), "已重置", "百分比是重置之前的，不写");
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
    let w = windows(&rows);
    assert_eq!((w[0].1.tone, w[1].1.tone), (Tone::Normal, Tone::Warn));
    assert_eq!(w[0].1.label, "5 小时");
    assert_eq!(w[0].1.reset, "1 小时后重置");
    assert_eq!(w[1].1.label, "每周");
}

/// **报了几个窗口就画几行**：ChatGPT 有时只报每周的那一个，菜单里就只有那一行，不凭空补一个
/// 5 小时的。每一行说清是哪家的哪个窗口，右边「31% · 4 天后重置」；点了去上游页
#[test]
fn each_quota_window_reported_gets_its_own_row() {
    let mut s = running();
    s.quotas = vec![Quota {
        provider: "ChatGPT".into(),
        windows: vec![window("weekly", 31.0, 4 * 86_400_000)],
        reset_credits: None,
    }];
    let rows = rows(&s);
    let w = windows(&rows);
    assert_eq!(w.len(), 1);
    assert_eq!(w[0].0, "ChatGPT");
    assert_eq!(w[0].1.label, "每周");
    assert_eq!(w[0].1.right(), "31% · 4 天后重置");
    assert_eq!(w[0].1.line("ChatGPT"), "ChatGPT 每周 31% · 4 天后重置");
    assert!(rows.iter().any(|r| matches!(
        r,
        Row::Quota { action, .. } if *action == Action::Open("upstreams")
    )));
    // 紧跟在「今日」后面，之后一条分隔线
    let at = rows
        .iter()
        .position(|r| matches!(r, Row::Today(_)))
        .unwrap();
    assert!(matches!(rows[at + 1], Row::Quota { .. }));
    assert_eq!(rows[at + 2], Row::Separator);
    // 两家各报两个：四行，一家的挨在一起
    s.quotas.push(glm());
    s.quotas[0]
        .windows
        .insert(0, window("5h", 58.0, 42 * 60_000));
    let rows = super::rows(&s);
    assert_eq!(
        windows(&rows)
            .iter()
            .map(|(p, w)| format!("{p}:{}", w.label))
            .collect::<Vec<_>>(),
        ["ChatGPT:5 小时", "ChatGPT:每周", "glm:5 小时", "glm:每周"]
    );
    // 没有重置时刻的窗口只写百分比
    let w = Window {
        resets_at_ms: None,
        ..window("30d", 12.4, 0)
    };
    assert_eq!(window_row(&w, NOW).right(), "12%");
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
        matches!(&rows[2], Row::Status { state, tone: StateTone::Bad, .. } if state == "无法启动")
    );
    assert_eq!(
        item(&rows, "restart").unwrap().action,
        Some(Action::RestartGateway)
    );
    assert!(
        !rows
            .iter()
            .any(|r| matches!(r, Row::Today(_) | Row::Quota { .. } | Row::Live { .. }))
    );
    // 正在启动时没有什么可重启的，也不画红色角标
    s.gateway = Gateway::Starting;
    let (bar, rows) = build(&s, Style::Full);
    assert!(bar.dim && !bar.alert);
    assert!(item(&rows, "restart").is_none());
}

/// 监听设置没换成：「今日」那一块最后多一行橙字。行高跟着变，所以它是样子的一部分
#[test]
fn a_listen_setting_that_did_not_take_shows_inside_today() {
    let mut s = running();
    s.rate = Some(52);
    let shape = |s: &Snapshot| rows(s).iter().map(Row::shape).collect::<Vec<_>>();
    let before = shape(&s);
    assert_eq!(dash(&rows(&s)).warn, None);
    s.listen_error = Some("端口 18790 已被占用。".into());
    let rows = rows(&s);
    assert_eq!(dash(&rows).warn.as_deref(), Some("端口 18790 已被占用。"));
    assert_ne!(shape(&s), before);
}

/// 「复制网关地址」右边写着要复制的那个地址；网关没在监听、不知道地址时点不了
#[test]
fn copy_address_shows_the_address_it_copies() {
    let mut s = running();
    let rows = rows(&s);
    let copy = item(&rows, "copy-address").unwrap();
    assert_eq!(copy.right.as_deref(), Some("127.0.0.1:18790"));
    assert!(copy.enabled);
    s.addr = None;
    let rows = super::rows(&s);
    let copy = item(&rows, "copy-address").unwrap();
    assert_eq!(copy.right, None);
    assert!(!copy.enabled);
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
    // 只有一项，不是安装和检查各一项
    assert_eq!(items(&rows).iter().filter(|i| i.id == "update").count(), 1);
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
        s.rate = Some(42);
        s.today = Some(Today {
            requests: 128,
            failed: 2,
            tokens: 1_240_000,
            cost_micros: 3_470_000,
            ..Default::default()
        });
        let rows = rows(&s);
        assert_eq!(item(&rows, "open").unwrap().title, "Open ThinkWatch Lite");
        let d = dash(&rows);
        assert_eq!(d.title, "Today");
        assert_eq!(d.state_line(), "Running · 42 tokens/s");
        assert_eq!((d.value.as_str(), d.unit.as_str()), ("1.2M", "tokens"));
        assert_eq!(d.meta_line(), "128 requests · 2 failed · $3.47");
        let w = windows(&rows)[0].1;
        assert_eq!(
            (w.label.as_str(), w.right()),
            ("Weekly", "18% · Resets in 4 days".to_string())
        );
        assert_eq!(w.line("chatgpt"), "chatgpt Weekly 18% · Resets in 4 days");
        assert_eq!(item(&rows, "quit").unwrap().title, "Quit ThinkWatch Lite…");
        let (bar, _) = build(&s, Style::Full);
        assert!(
            bar.tooltip
                .starts_with("ThinkWatch Lite, Running, 1.2M tokens today")
        );
        // 一次请求、一个 token：单数
        s.today = Some(Today {
            requests: 1,
            tokens: 1,
            ..Default::default()
        });
        let rows = super::rows(&s);
        let d = dash(&rows);
        assert_eq!(
            (d.unit.as_str(), d.meta_line()),
            ("token", "1 request · $0.00".into())
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
    s.hourly = Some(Hourly {
        from_ms: NOW as i64 - 10 * HOUR_MS,
        tokens: vec![0; 24],
    });
    s.quotas = vec![Quota {
        provider: "chatgpt".into(),
        windows: vec![window("weekly", 31.0, 4 * 86_400_000)],
        reset_credits: None,
    }];
    let a: Vec<String> = rows(&s).iter().map(Row::shape).collect();
    s.now_ms += 5_000;
    // 今天的数涨了、这一小时多了 token、额度多用了一点：都只是字和柱子变了
    s.today.as_mut().unwrap().tokens += 50_000;
    s.hourly.as_mut().unwrap().tokens[10] += 50_000;
    s.quotas[0].windows[0].used_percent = 32.0;
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
    let rows = rows(s);
    let w: Vec<WindowRow> = windows(&rows).into_iter().map(|(_, w)| w.clone()).collect();
    assert!(!w.is_empty(), "额度那几行不见了");
    w
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
    assert!(a.contains(&"quota:glm:每周:+".to_string()), "{a:?}");
    s.quotas[0].windows[1].credits = None;
    assert!(shape(&s).contains(&"quota:glm:每周:-".to_string()));
    // 只是数变了：样子不变
    s.quotas[0].windows[0].credits = Some(QuotaCredits {
        total: 2_000.0,
        used: 500.0,
        remaining: 1_500.0,
    });
    assert!(shape(&s).contains(&"quota:glm:5 小时:+".to_string()));
    // 托盘那一行把还剩多少括在后面
    assert_eq!(
        quota_rows(&s)[0].line("glm"),
        "glm 5 小时 1% · 1 小时后重置（剩余 1,500 / 2,000 积分）"
    );
}

/// 今天每小时的 token，零点在 `NOW` 之前十个半小时：此刻在第 10 格
fn hourly(tokens: &[(usize, i64)]) -> Hourly {
    let mut h = Hourly {
        from_ms: NOW as i64 - 10 * HOUR_MS - HOUR_MS / 2,
        tokens: vec![0; 24],
    };
    for &(k, t) in tokens {
        h.tokens[k] = t;
    }
    h
}

/// 小柱子：过去的小时、此刻这一小时、没有用量的（和还没到的）分三种画。**满格是当天最高
/// 的那一小时**
#[test]
fn the_sparkline_marks_the_current_hour_and_leaves_empty_hours_as_stubs() {
    let h = hourly(&[(8, 100_000), (9, 50_000), (10, 25_000)]);
    let bars = spark(&h, NOW);
    assert_eq!(bars.len(), 24);
    assert_eq!(bars[8], Spark::Past(1.0));
    assert_eq!(bars[9], Spark::Past(0.5));
    assert_eq!(bars[10], Spark::Now(0.25));
    // 没有用量的小时、还没到的小时：短线
    assert!(bars[..8].iter().all(|b| *b == Spark::Empty));
    assert!(bars[11..].iter().all(|b| *b == Spark::Empty));
    // 此刻这一小时还没有用量：也是短线，不是一根高度为 0 的「此刻」
    let quiet = hourly(&[(8, 100_000)]);
    assert_eq!(spark(&quiet, NOW)[10], Spark::Empty);
}

/// **满格不低于 [`SPARK_MIN_PEAK`]**：一天里只有一个零星的请求，那一小时不是满满一格
#[test]
fn a_tiny_hour_does_not_fill_the_sparkline() {
    let bars = spark(&hourly(&[(10, 2_000)]), NOW);
    assert_eq!(bars[10], Spark::Now(2_000.0 / SPARK_MIN_PEAK as f64));
    // 到了下限，按当天最高的算
    let bars = spark(
        &hourly(&[(3, SPARK_MIN_PEAK * 4), (10, SPARK_MIN_PEAK)]),
        NOW,
    );
    assert_eq!((bars[3], bars[10]), (Spark::Past(1.0), Spark::Now(0.25)));
}

/// 「此刻」按现在的钟算：菜单开着过了整点，下一次重画就挪到下一格，前一格成了过去
#[test]
fn the_current_hour_moves_on_with_the_clock() {
    let h = hourly(&[(10, 40_000)]);
    assert_eq!(spark(&h, NOW)[10], Spark::Now(1.0));
    let next = NOW + HOUR_MS as u64;
    let bars = spark(&h, next);
    assert_eq!((bars[10], bars[11]), (Spark::Past(1.0), Spark::Empty));
    // 时钟走在 core 后面（连着远程，那边快几分钟）：「将来」那一格里已经有数，照样画
    let ahead = hourly(&[(11, 40_000)]);
    assert_eq!(spark(&ahead, NOW)[11], Spark::Past(1.0));
}

/// 柱子和大数字出自同一问：今天的数没问到时不画柱子，问到了才画
#[test]
fn the_sparkline_shows_only_with_todays_numbers() {
    let mut s = running();
    s.hourly = Some(hourly(&[(10, 40_000)]));
    let rows = rows(&s);
    let bars = dash(&rows).spark.clone().expect("问到了却没画柱子");
    assert_eq!(bars[10], Spark::Now(1.0));
    s.today = None;
    assert_eq!(dash(&super::rows(&s)).spark, None);
    s.today = Some(Today::default());
    s.hourly = None;
    assert_eq!(dash(&super::rows(&s)).spark, None);
}

/// 每一种状态：「打开主界面」是第一项、只出现一次，后面跟一条分隔线；不留两条相邻的分隔线，
/// 也不以分隔线结尾。Linux 的托盘没有点击事件，菜单是唯一的入口，靠的就是这一条
#[test]
fn open_is_the_first_item_once_in_every_state() {
    for gateway in [
        Gateway::Starting,
        Gateway::Running,
        Gateway::SafeMode,
        Gateway::Failed,
        Gateway::Stopped,
        Gateway::Unlinked,
    ] {
        for busy in [false, true] {
            let mut s = Snapshot {
                gateway: gateway.clone(),
                ..running()
            };
            if busy {
                s.notices = vec![NoticeLine {
                    key: "k".into(),
                    level: Level::Info,
                    title: "t".into(),
                    body: "b".into(),
                }];
                s.live = vec![Live::default()];
                s.update = Some("2026.10.9".into());
            }
            let out = outline(&rows(&s));
            assert_eq!(&out[..2], ["open", "---"], "{gateway:?}");
            assert_eq!(out.iter().filter(|i| *i == "open").count(), 1);
            assert!(
                !out.windows(2).any(|w| w[0] == "---" && w[1] == "---"),
                "{gateway:?} {out:?}"
            );
            assert_eq!(out.last().map(String::as_str), Some("quit"));
        }
    }
}
