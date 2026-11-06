//! Linux 的 SNI / DBusMenu 托盘。AppIndicator 不接 `ProvideXdgActivationToken`，
//! 丢了这次用户操作的权限，Wayland 就不会把已有窗口提到前面（lite#404）。
//!
//! ksni 接住令牌；在它的事件回调里取出来，和动作一起交给主线程。窗口沿用通知
//! 的 GTK 激活路径，隐藏着准备首屏的窗口也能在映射时消费令牌，不用销毁 webview。

#[cfg(target_os = "linux")]
use std::sync::OnceLock;
use std::time::{Duration, Instant};

#[cfg(target_os = "linux")]
use ksni::TrayMethods;
use ksni::menu::{CheckmarkItem, StandardItem, SubMenu};
#[cfg(target_os = "linux")]
use tauri::Manager;
#[cfg(target_os = "linux")]
use tokio::sync::watch;

#[cfg(target_os = "linux")]
use super::model::{self, Snapshot};
use super::model::{Action, Bar, Row};

type Presentation = (Bar, Vec<Row>);
#[cfg(target_os = "linux")]
static LATEST: OnceLock<watch::Sender<Presentation>> = OnceLock::new();

#[cfg(target_os = "linux")]
pub fn install(app: &tauri::AppHandle) -> anyhow::Result<()> {
    use gtk::prelude::*;

    // 认实际的 GDK 后端：Wayland 会话里也可能用 GDK_BACKEND=x11。
    let wayland =
        gtk::gdk::Display::default().is_some_and(|d| d.type_().name() == "GdkWaylandDisplay");
    let icons = app
        .default_window_icon()
        .map(|i| argb_icon(i.width(), i.height(), i.rgba()))
        .into_iter()
        .collect();
    let (tx, mut rx) = watch::channel(model::build(&Snapshot::default(), super::drawn_style()));
    LATEST
        .set(tx)
        .map_err(|_| anyhow::anyhow!("Linux tray already installed"))?;

    let a = app.clone();
    let on_action = Box::new(move |action, token| dispatch(&a, action, token));
    let a = app.clone();
    let on_open = Box::new(move || {
        if let Some(st) = a.try_state::<crate::AppState>() {
            st.menubar_now.notify_one();
        }
    });
    tauri::async_runtime::spawn(async move {
        let (bar, rows) = rx.borrow_and_update().clone();
        let tray = LinuxTray {
            bar,
            rows,
            icons,
            wayland,
            action_epoch: false,
            on_action,
            on_open,
        };
        // 开机自启可能早于面板；GNOME 也可能稍后才启用托盘扩展。保留 SNI 服务，
        // watcher 出现或重启时由 ksni 重新注册。
        let handle = match tray.assume_sni_available(true).spawn().await {
            Ok(handle) => handle,
            Err(e) => {
                tracing::warn!("Linux 托盘没建起来：{e}");
                return;
            }
        };
        while rx.changed().await.is_ok() {
            let next = rx.borrow_and_update().clone();
            if handle
                .update(move |tray| tray.replace(next))
                .await
                .is_none()
            {
                break;
            }
        }
    });
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn apply(bar: &Bar, rows: &[Row]) {
    if let Some(tx) = LATEST.get() {
        tx.send_if_modified(|last| {
            if last.0 == *bar && last.1 == rows {
                return false;
            }
            *last = (bar.clone(), rows.to_vec());
            true
        });
    }
}

#[cfg(target_os = "linux")]
fn dispatch(app: &tauri::AppHandle, action: Action, token: Option<String>) {
    let label = activation_target(&action);
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        super::handle(&a, action);
        // open_view 也在主线程上开窗；没有窗口时等创建，有窗口时激活原来的那扇。
        if let (Some(label), Some(token)) = (label, token) {
            crate::window::activate_with_token(&a, label, token);
        }
    });
}

/// 后台操作不激活窗口；更新提醒打开的是更新窗口，不是主界面。
fn activation_target(action: &Action) -> Option<&'static str> {
    match action {
        Action::OpenNotice(key) if crate::updater::is_update_notice(key) => {
            Some(crate::updater::UPDATE_WINDOW)
        }
        Action::InstallUpdate => Some(crate::updater::UPDATE_WINDOW),
        Action::OpenMain
        | Action::Open(_)
        | Action::OpenRequest(_)
        | Action::OpenNotice(_)
        | Action::AllNotices
        | Action::Settings => Some("main"),
        Action::SwitchConnection(id) if id != crate::connection::store::LOCAL => Some("main"),
        _ => None,
    }
}

struct LinuxTray {
    bar: Bar,
    rows: Vec<Row>,
    icons: Vec<ksni::Icon>,
    wayland: bool,
    // ksni 只在树的形状变化时作废菜单 id。同样行数、动作换了也必须作废，否则
    // 面板还显示上一版时点下去，会执行新一版同一位置的动作。隐藏子树切换形状；
    // 它始终占一个根节点，不会和可见行数的变化相互抵消。
    action_epoch: bool,
    on_action: Box<dyn Fn(Action, Option<String>) + Send>,
    on_open: Box<dyn Fn() + Send>,
}

impl LinuxTray {
    fn replace(&mut self, (bar, rows): Presentation) {
        if actions(&self.rows) != actions(&rows) {
            self.action_epoch = !self.action_epoch;
        }
        self.bar = bar;
        self.rows = rows;
    }

    fn clicked(&self, action: Action) {
        let token = if self.wayland && activation_target(&action).is_some() {
            event_token()
        } else {
            None
        };
        (self.on_action)(action, token);
    }
}

/// 令牌和菜单点击分属两个 D-Bus 接口，ksni 允许令牌在事件开始后 20ms 内到达。
/// 必须留在当前事件的 task-local 作用域里读取；另起 task 就读不到。不能直接 sleep
/// 堵住工作线程，否则处理迟到令牌的 D-Bus task 也可能跑不了。
fn event_token() -> Option<String> {
    if let token @ Some(_) = ksni::current_xdg_activation_token() {
        return token;
    }
    tokio::task::block_in_place(|| {
        let deadline = Instant::now() + Duration::from_millis(20);
        loop {
            if let token @ Some(_) = ksni::current_xdg_activation_token() {
                return token;
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    })
}

impl ksni::Tray for LinuxTray {
    fn id(&self) -> String {
        "thinkwatch-lite".into()
    }

    fn title(&self) -> String {
        "ThinkWatch Lite".into()
    }

    fn icon_pixmap(&self) -> Vec<ksni::Icon> {
        self.icons.clone()
    }

    fn tool_tip(&self) -> ksni::ToolTip {
        ksni::ToolTip {
            title: "ThinkWatch Lite".into(),
            description: self.bar.tooltip.clone(),
            ..Default::default()
        }
    }

    fn activate(&mut self, _x: i32, _y: i32) {
        self.clicked(Action::OpenMain);
    }

    fn menu_about_to_show(&mut self) {
        (self.on_open)();
    }

    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        let mut menu = build(&self.rows);
        let submenu = if self.action_epoch {
            vec![
                StandardItem {
                    visible: false,
                    enabled: false,
                    ..Default::default()
                }
                .into(),
            ]
        } else {
            vec![]
        };
        menu.push(
            SubMenu {
                visible: false,
                enabled: false,
                submenu,
                ..Default::default()
            }
            .into(),
        );
        menu
    }
}

fn argb_icon(width: u32, height: u32, rgba: &[u8]) -> ksni::Icon {
    let mut data = rgba.to_vec();
    for pixel in data.as_chunks_mut::<4>().0 {
        pixel.rotate_right(1);
    }
    ksni::Icon {
        width: width as i32,
        height: height as i32,
        data,
    }
}

fn item(label: String, action: Option<Action>) -> ksni::MenuItem<LinuxTray> {
    StandardItem {
        // DBusMenu 的下划线是助记符，模型里的名字必须按原样显示。
        label: label.replace('_', "__"),
        enabled: action.is_some(),
        activate: Box::new(move |tray: &mut LinuxTray| {
            if let Some(action) = &action {
                tray.clicked(action.clone());
            }
        }),
        ..Default::default()
    }
    .into()
}

fn actions(rows: &[Row]) -> Vec<&Action> {
    rows.iter()
        .flat_map(|row| match row {
            Row::Today(d) => vec![&d.action],
            Row::Notice { action, .. } | Row::Quota { action, .. } | Row::Live { action, .. } => {
                vec![action]
            }
            Row::Item(i) if i.submenu.is_empty() => i.action.iter().collect(),
            Row::Item(i) => i.submenu.iter().map(|m| &m.action).collect(),
            _ => vec![],
        })
        .collect()
}

fn build(rows: &[Row]) -> Vec<ksni::MenuItem<LinuxTray>> {
    let mut menu = Vec::new();
    for row in rows {
        match row {
            Row::Separator => menu.push(ksni::MenuItem::Separator),
            Row::Status {
                state,
                server,
                reason,
                ..
            } => {
                let text = match server {
                    Some(name) => format!("{state} · {name}"),
                    None => state.clone(),
                };
                menu.push(item(text, None));
                if let Some(reason) = reason {
                    menu.push(item(reason.clone(), None));
                }
            }
            Row::Today(d) => {
                menu.push(item(d.state_line(), None));
                menu.push(item(d.line(), Some(d.action.clone())));
                if let Some(warn) = &d.warn {
                    menu.push(item(warn.clone(), None));
                }
            }
            Row::Section { title, right } => menu.push(item(
                match right {
                    Some(r) => format!("{title}  {r}"),
                    None => title.clone(),
                },
                None,
            )),
            Row::Notice { title, action, .. } => {
                menu.push(item(title.clone(), Some(action.clone())));
            }
            Row::Quota {
                provider,
                window,
                action,
            } => {
                menu.push(item(window.line(provider), Some(action.clone())));
            }
            Row::Live {
                app,
                model,
                rate,
                elapsed,
                action,
            } => {
                let right = match rate {
                    Some(r) => format!("{r}  {elapsed}"),
                    None => elapsed.clone(),
                };
                menu.push(item(
                    format!("{app}  {model}  {right}"),
                    Some(action.clone()),
                ));
            }
            Row::Item(i) => {
                let title = match &i.right {
                    Some(r) => format!("{}  {r}", i.title),
                    None => i.title.clone(),
                };
                if i.submenu.is_empty() {
                    menu.push(item(title, i.enabled.then(|| i.action.clone()).flatten()));
                } else {
                    let mut submenu = Vec::new();
                    for m in &i.submenu {
                        if m.sep_before {
                            submenu.push(ksni::MenuItem::Separator);
                            submenu.push(item(m.title.clone(), Some(m.action.clone())));
                        } else {
                            let action = m.action.clone();
                            submenu.push(
                                CheckmarkItem {
                                    label: m.title.replace('_', "__"),
                                    checked: m.checked,
                                    activate: Box::new(move |tray: &mut LinuxTray| {
                                        tray.clicked(action.clone())
                                    }),
                                    ..Default::default()
                                }
                                .into(),
                            );
                        }
                    }
                    menu.push(
                        SubMenu {
                            label: title.replace('_', "__"),
                            enabled: i.enabled,
                            submenu,
                            ..Default::default()
                        }
                        .into(),
                    );
                }
            }
        }
    }
    menu
}

#[cfg(test)]
mod tests;
