use std::sync::{Arc, Mutex};

use ksni::Tray;

use super::*;
use crate::menubar::model::{self, Item, Snapshot};

type Clicks = Arc<Mutex<Vec<(Action, Option<String>)>>>;

fn row(title: &str, action: Action) -> Row {
    Row::Item(Item {
        id: title.into(),
        icon: None,
        title: title.into(),
        right: None,
        enabled: true,
        action: Some(action),
        key: None,
        submenu: vec![],
        accent: false,
    })
}

fn tray(rows: Vec<Row>) -> (LinuxTray, Clicks) {
    let clicks = Arc::new(Mutex::new(vec![]));
    let c = clicks.clone();
    let (bar, _) = model::build(&Snapshot::default(), model::Style::Icon);
    (
        LinuxTray {
            bar,
            rows,
            icons: vec![],
            wayland: false,
            action_epoch: false,
            on_action: Box::new(move |a, t| c.lock().unwrap().push((a, t))),
            on_open: Box::new(|| {}),
        },
        clicks,
    )
}

#[test]
fn activation_follows_the_window_opened_by_the_action() {
    for action in [
        Action::OpenMain,
        Action::Open("overview"),
        Action::OpenRequest(42),
        Action::OpenNotice("gateway:failed".into()),
        Action::AllNotices,
        Action::Settings,
        Action::SwitchConnection("remote".into()),
    ] {
        assert_eq!(activation_target(&action), Some("main"), "{action:?}");
    }
    for action in [
        Action::InstallUpdate,
        Action::OpenNotice("update:2026.11.3".into()),
    ] {
        assert_eq!(
            activation_target(&action),
            Some(crate::updater::UPDATE_WINDOW)
        );
    }
    for action in [
        Action::CopyAddress,
        Action::CopyKey,
        Action::SelectGroup {
            group: "g".into(),
            provider: "p".into(),
        },
        Action::RestartGateway,
        Action::RetryConnection,
        Action::SwitchConnection(crate::connection::store::LOCAL.into()),
        Action::CheckUpdates,
        Action::Quit,
    ] {
        assert_eq!(activation_target(&action), None, "{action:?}");
    }
}

#[test]
fn the_default_menu_starts_with_open_main_and_uses_the_same_action() {
    let (_, rows) = model::build(&Snapshot::default(), model::Style::Icon);
    let (mut tray, clicks) = tray(rows);
    let menu = tray.menu();
    let ksni::MenuItem::Standard(first) = &menu[0] else {
        panic!("first item is not clickable")
    };
    assert!(first.enabled);
    (first.activate)(&mut tray);
    assert_eq!(*clicks.lock().unwrap(), [(Action::OpenMain, None)]);
}

#[test]
fn menu_refresh_only_invalidates_ids_when_actions_change() {
    let (mut tray, _) = tray(vec![row("Open", Action::OpenRequest(1))]);
    let before = tray.menu().len();
    // 数字、语言、文案变化不收起菜单，动作仍然指向同一条。
    tray.replace((
        tray.bar.clone(),
        vec![row("Updated", Action::OpenRequest(1))],
    ));
    assert_eq!(tray.menu().len(), before);
    // 行数一样，请求换了：必须让 ksni 作废旧 id。
    tray.replace((
        tray.bar.clone(),
        vec![row("Updated", Action::OpenRequest(2))],
    ));
    let menu = tray.menu();
    assert_eq!(menu.len(), before);
    let ksni::MenuItem::SubMenu(last) = menu.last().unwrap() else {
        panic!("missing sentinel")
    };
    assert!(!last.visible && !last.enabled);
    assert_eq!(last.submenu.len(), 1);
    tray.replace((tray.bar.clone(), vec![row("Quit", Action::Quit)]));
    assert_eq!(tray.menu().len(), before);
    let menu = tray.menu();
    let ksni::MenuItem::SubMenu(last) = menu.last().unwrap() else {
        panic!("missing sentinel")
    };
    assert!(last.submenu.is_empty());
}

#[test]
fn disabled_items_and_literal_underscores_are_preserved() {
    let mut disabled = row("upstream_a", Action::OpenMain);
    if let Row::Item(i) = &mut disabled {
        i.enabled = false;
    }
    let (mut tray, clicks) = tray(vec![disabled]);
    let menu = tray.menu();
    let ksni::MenuItem::Standard(first) = &menu[0] else {
        panic!("not a standard item")
    };
    assert_eq!(first.label, "upstream__a");
    assert!(!first.enabled);
    (first.activate)(&mut tray);
    assert!(clicks.lock().unwrap().is_empty());
}

#[test]
fn icons_use_sni_network_order_argb() {
    let icon = argb_icon(2, 1, &[10, 20, 30, 40, 50, 60, 70, 80]);
    assert_eq!((icon.width, icon.height), (2, 1));
    assert_eq!(icon.data, [40, 10, 20, 30, 80, 50, 60, 70]);
}

/// 和面板一样走真的 SNI / DBusMenu：提前、迟到、缺失的令牌，以及旧菜单点击。
/// CI 已在 dbus-run-session 下运行；没有会话总线的本地环境仍能跑上面的纯函数测试。
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn tray_clicks_carry_one_event_token_and_reject_replaced_menu_ids() {
    use std::collections::HashMap;

    use ksni::TrayMethods;
    use tokio::sync::mpsc;
    use zbus::zvariant::OwnedValue;

    struct Watcher(mpsc::UnboundedSender<String>);
    #[zbus::interface(name = "org.kde.StatusNotifierWatcher")]
    impl Watcher {
        fn register_status_notifier_item(&self, service: String) {
            let _ = self.0.send(service);
        }
        #[zbus(property)]
        fn is_status_notifier_host_registered(&self) -> bool {
            true
        }
    }

    let Ok(client) = zbus::Connection::session().await else {
        eprintln!("skipped: no session bus (run under dbus-run-session)");
        return;
    };
    let (registered, mut registrations) = mpsc::unbounded_channel();
    let watcher = zbus::connection::Builder::session()
        .unwrap()
        .name("org.kde.StatusNotifierWatcher")
        .unwrap()
        .serve_at("/StatusNotifierWatcher", Watcher(registered.clone()))
        .unwrap()
        .build()
        .await
        .unwrap();
    let (mut tray, _) = tray(vec![
        row("Open", Action::OpenMain),
        row("Settings", Action::Settings),
        row("Update", Action::InstallUpdate),
        row("Copy", Action::CopyAddress),
    ]);
    tray.wayland = true;
    let (clicked, mut clicks) = mpsc::unbounded_channel();
    tray.on_action = Box::new(move |a, t| {
        let _ = clicked.send((a, t));
    });
    let handle = tray.spawn().await.unwrap();
    let service = tokio::time::timeout(Duration::from_secs(3), registrations.recv())
        .await
        .unwrap()
        .unwrap();
    let sni = zbus::Proxy::new(
        &client,
        service.as_str(),
        "/StatusNotifierItem",
        "org.kde.StatusNotifierItem",
    )
    .await
    .unwrap();
    let menu = zbus::Proxy::new(
        &client,
        service.as_str(),
        "/MenuBar",
        "com.canonical.dbusmenu",
    )
    .await
    .unwrap();

    type Layout = (i32, HashMap<String, OwnedValue>, Vec<OwnedValue>);
    async fn ids(menu: &zbus::Proxy<'_>) -> Vec<i32> {
        let (_, root): (u32, Layout) = menu
            .call("GetLayout", &(0i32, -1i32, Vec::<String>::new()))
            .await
            .unwrap();
        root.2
            .into_iter()
            .map(|v| Layout::try_from(v).unwrap().0)
            .collect()
    }
    async fn click(menu: &zbus::Proxy<'_>, id: i32) -> zbus::Result<()> {
        menu.call("Event", &(id, "clicked", OwnedValue::from(0i32), 0u32))
            .await
    }
    let first = ids(&menu).await;
    let _: () = sni
        .call("ProvideXdgActivationToken", &("before",))
        .await
        .unwrap();
    click(&menu, first[1]).await.unwrap();
    assert_eq!(
        clicks.recv().await,
        Some((Action::Settings, Some("before".into())))
    );
    // 上一次点击的令牌不能沿用。
    click(&menu, first[0]).await.unwrap();
    assert_eq!(clicks.recv().await, Some((Action::OpenMain, None)));

    // Event 已进入回调才送令牌，验证同步回调没有挡住另一个 D-Bus task。
    let late_click = click(&menu, first[2]);
    let late_token = async {
        tokio::time::sleep(Duration::from_millis(3)).await;
        sni.call::<_, _, ()>("ProvideXdgActivationToken", &("late",))
            .await
            .unwrap();
    };
    let (result, ()) = tokio::join!(late_click, late_token);
    result.unwrap();
    assert_eq!(
        clicks.recv().await,
        Some((Action::InstallUpdate, Some("late".into())))
    );

    let _: () = sni
        .call("ProvideXdgActivationToken", &("background",))
        .await
        .unwrap();
    click(&menu, first[3]).await.unwrap();
    assert_eq!(clicks.recv().await, Some((Action::CopyAddress, None)));
    let _: () = sni.call("Activate", &(0i32, 0i32)).await.unwrap();
    assert_eq!(clicks.recv().await, Some((Action::OpenMain, None)));

    // 同样四行但换了动作，旧 id 必须无效，不能把旧的「打开」误当成新的「退出」。
    handle
        .update(|tray| {
            let rows = vec![
                row("Quit", Action::Quit),
                row("Settings", Action::Settings),
                row("Update", Action::InstallUpdate),
                row("Copy", Action::CopyAddress),
            ];
            tray.replace((tray.bar.clone(), rows));
        })
        .await
        .unwrap();
    assert_ne!(ids(&menu).await[0], first[0]);
    assert!(click(&menu, first[0]).await.is_err());
    assert!(clicks.try_recv().is_err());

    // 面板重启以后同一个 SNI 服务重新注册，菜单和激活仍然能用。
    drop(watcher);
    let _restarted = zbus::connection::Builder::session()
        .unwrap()
        .name("org.kde.StatusNotifierWatcher")
        .unwrap()
        .serve_at("/StatusNotifierWatcher", Watcher(registered))
        .unwrap()
        .build()
        .await
        .unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(3), registrations.recv())
            .await
            .unwrap(),
        Some(service.clone())
    );
    let _: () = sni
        .call("ProvideXdgActivationToken", &("restarted",))
        .await
        .unwrap();
    let _: () = sni.call("Activate", &(0i32, 0i32)).await.unwrap();
    assert_eq!(
        clicks.recv().await,
        Some((Action::OpenMain, Some("restarted".into())))
    );
    handle.shutdown().await;
}
