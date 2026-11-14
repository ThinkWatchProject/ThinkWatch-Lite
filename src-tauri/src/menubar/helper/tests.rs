use super::*;
use model::*;

fn frame() -> Frame {
    Frame {
        snapshot: Snapshot {
            gateway: Gateway::Running,
            addr: Some("127.0.0.1:18790".into()),
            today: Some(Today {
                tokens: 31_900_000,
                requests: 42,
                ..Default::default()
            }),
            hourly: Some(Hourly {
                from_ms: 0,
                tokens: vec![100; 24],
            }),
            quotas: vec![Quota {
                provider: "chatgpt".into(),
                windows: vec![Window {
                    window: "5h".into(),
                    used_percent: 87.5,
                    ..Default::default()
                }],
                ..Default::default()
            }],
            live: vec![Live {
                id: 123,
                model: "test-model".into(),
                rate: Some(53),
                ..Default::default()
            }],
            notices: vec![NoticeLine {
                key: "test".into(),
                level: Level::Warning,
                title: "注意\n第二行".into(),
                body: "detail".into(),
            }],
            groups: vec![Group {
                name: "primary".into(),
                members: vec!["one".into()],
                selected: Some("one".into()),
            }],
            connections: vec![Connection {
                id: "local".into(),
                name: "本机".into(),
                current: true,
            }],
            hotkey: Some(crate::hotkey::default_combo()),
            rate: Some(53),
            now_ms: 3_600_000,
            ..Default::default()
        },
        style: Style::Numbers,
        lang: i18n::Lang::Zh,
        theme: Some(theme::Theme::Dark),
    }
}

#[test]
fn helper_renders_the_same_menu_after_a_snapshot_crosses_the_pipe() {
    for lang in [i18n::Lang::Zh, i18n::Lang::En] {
        let mut original = frame();
        original.lang = lang;
        let copy: Frame = decode(&packet(&original).unwrap()).unwrap().unwrap();
        assert_eq!(copy.lang, lang);
        assert_eq!(copy.theme, original.theme);
        i18n::with_lang(lang, || {
            assert_eq!(
                build(&copy.snapshot, copy.style),
                build(&original.snapshot, original.style)
            );
        });
    }
}

#[test]
fn every_menu_action_round_trips_without_losing_its_target() {
    let actions = [
        Action::OpenMain,
        Action::Open("dashboard".into()),
        Action::Open("upstreams".into()),
        Action::Open("requests".into()),
        Action::OpenRequest(123),
        Action::OpenNotice("notice\nkey".into()),
        Action::AllNotices,
        Action::Settings,
        Action::CopyAddress,
        Action::CopyKey,
        Action::SelectGroup {
            group: "primary".into(),
            provider: "one".into(),
        },
        Action::RestartGateway,
        Action::RetryConnection,
        Action::SwitchConnection("remote".into()),
        Action::CheckUpdates,
        Action::InstallUpdate,
        Action::Quit,
    ];
    for action in actions {
        let original = Event::Action(action);
        assert_eq!(
            decode::<Event>(&packet(&original).unwrap()).unwrap(),
            Some(original)
        );
    }
}

#[tokio::test]
async fn both_readers_preserve_message_boundaries_and_report_eof() {
    let events = [
        Event::Open(true),
        Event::Action(Action::OpenMain),
        Event::Open(false),
    ];
    let bytes: Vec<u8> = events
        .iter()
        .flat_map(|event| packet(event).unwrap())
        .collect();
    let (mut sync, mut asynchronous) = (bytes.as_slice(), bytes.as_slice());
    for expected in events {
        assert_eq!(
            read_sync::<Event>(&mut sync).unwrap(),
            Some(expected.clone())
        );
        assert_eq!(
            read_async::<Event>(&mut asynchronous).await.unwrap(),
            Some(expected)
        );
    }
    assert_eq!(read_sync::<Event>(&mut sync).unwrap(), None);
    assert_eq!(read_async::<Event>(&mut asynchronous).await.unwrap(), None);
}

#[tokio::test]
async fn oversized_malformed_and_partial_packets_are_rejected() {
    for bytes in [
        vec![b' '; MAX_PACKET + 1],
        b"not json\n".to_vec(),
        b"{\"Open\":true}".to_vec(),
    ] {
        assert!(read_sync::<Event>(&mut bytes.as_slice()).is_err());
        assert!(read_async::<Event>(&mut bytes.as_slice()).await.is_err());
    }
}

#[test]
fn a_busy_ui_keeps_only_the_latest_frame_and_can_schedule_again() {
    let mut inbox = Inbox::default();
    assert!(inbox.replace(frame()));
    let mut newer = frame();
    newer.style = Style::Hidden;
    newer.theme = None;
    newer.snapshot.rate = Some(100);
    assert!(!inbox.replace(newer));
    let latest = inbox.take().unwrap();
    assert_eq!(latest.style, Style::Hidden);
    assert_eq!(latest.theme, None);
    assert_eq!(latest.snapshot.rate, Some(100));
    assert!(inbox.take().is_none());
    assert!(inbox.replace(frame()));
}
