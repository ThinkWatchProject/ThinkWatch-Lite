//! 不是 macOS 的平台：仍用 Tauri 的托盘，按同一份模型出一份纯文字菜单。
//!
//! 画不出额度条和三格数字，那几行写成文字。**判定都在模型里**，这里只是另一种画法
//! —— 以后给 Windows 做一套像样的，换掉的只是这个文件。

use std::sync::{Mutex, OnceLock};

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};

use super::model::{Action, Bar, Row};

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static TRAY: OnceLock<TrayIcon> = OnceLock::new();
/// 菜单项的 id 是 `a:<下标>`，按下标找到它做什么
static ACTIONS: Mutex<Vec<Action>> = Mutex::new(Vec::new());
/// 上一次画的那一份：没变就不重建（开着的菜单会被收起来）
static LAST: Mutex<Option<(Bar, Vec<Row>)>> = Mutex::new(None);

pub fn install(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let _ = APP.set(app.clone());
    let mut builder = TrayIconBuilder::new()
        // **左键打开主窗口，菜单只给右键。**这是 Windows 的惯例，和 macOS
        // 那边「点一下就出菜单」故意不一致 —— 各随各的。
        //
        // Tauri 默认把菜单挂在左键上，所以这一行必须写出来。
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|app, event| {
            // **认「松开」不认「按下」**：按下就动作的话，用户按住想拖一下
            // 图标的位置也会把窗口叫出来。
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = crate::window::show_main_window(app.app_handle());
            }
        })
        .on_menu_event(|app, event| {
            let Some(i) = event
                .id()
                .as_ref()
                .strip_prefix("a:")
                .and_then(|i| i.parse::<usize>().ok())
            else {
                return;
            };
            let action = ACTIONS.lock().ok().and_then(|a| a.get(i).cloned());
            if let Some(action) = action {
                super::handle(app, action);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let tray = builder.build(app)?;
    let _ = TRAY.set(tray);
    Ok(())
}

pub fn apply(bar: &Bar, rows: &[Row]) {
    {
        let mut last = LAST.lock().expect("锁未中毒");
        if last.as_ref().is_some_and(|(b, r)| b == bar && r == rows) {
            return;
        }
        *last = Some((bar.clone(), rows.to_vec()));
    }
    let (Some(app), Some(tray)) = (APP.get(), TRAY.get()) else {
        return;
    };
    let _ = tray.set_tooltip(Some(&bar.tooltip));
    match build(app, rows) {
        Ok(menu) => {
            let _ = tray.set_menu(Some(menu));
        }
        Err(e) => tracing::debug!("托盘菜单没建起来：{e}"),
    }
}

fn build(app: &tauri::AppHandle, rows: &[Row]) -> tauri::Result<Menu<tauri::Wry>> {
    let mut actions = Vec::new();
    let mut id = |a: &Action| {
        actions.push(a.clone());
        format!("a:{}", actions.len() - 1)
    };
    let mut items: Vec<Box<dyn IsMenuItem<tauri::Wry>>> = Vec::new();
    for row in rows {
        match row {
            Row::Separator => items.push(Box::new(PredefinedMenuItem::separator(app)?)),
            Row::Header {
                title,
                state,
                line2,
                ..
            } => {
                items.push(Box::new(MenuItem::new(
                    app,
                    format!("{title}  {state}"),
                    false,
                    None::<&str>,
                )?));
                if !line2.is_empty() {
                    items.push(Box::new(MenuItem::new(app, line2, false, None::<&str>)?));
                }
            }
            Row::Section { title, right } => {
                let text = match right {
                    Some(r) => format!("{title}  {r}"),
                    None => title.clone(),
                };
                items.push(Box::new(MenuItem::new(app, text, false, None::<&str>)?));
            }
            Row::Notice { title, action, .. } => {
                items.push(Box::new(MenuItem::with_id(
                    app,
                    id(action),
                    title,
                    true,
                    None::<&str>,
                )?));
            }
            Row::Quota {
                provider,
                windows,
                action,
            } => {
                let text = windows
                    .iter()
                    .map(|w| match w.percent {
                        Some(p) => format!("{} {}%", w.label, p.round() as i64),
                        None => format!("{} {}", w.label, w.reset),
                    })
                    .collect::<Vec<_>>()
                    .join(" · ");
                items.push(Box::new(MenuItem::with_id(
                    app,
                    id(action),
                    format!("{provider}  {text}"),
                    true,
                    None::<&str>,
                )?));
            }
            Row::Stats { cells, action } => {
                let text = cells
                    .iter()
                    .map(|c| format!("{} {}", c.label, c.value))
                    .collect::<Vec<_>>()
                    .join(" · ");
                items.push(Box::new(MenuItem::with_id(
                    app,
                    id(action),
                    text,
                    true,
                    None::<&str>,
                )?));
            }
            Row::Live {
                app: who,
                model,
                elapsed,
                action,
            } => {
                items.push(Box::new(MenuItem::with_id(
                    app,
                    id(action),
                    format!("{who}  {model}  {elapsed}"),
                    true,
                    None::<&str>,
                )?));
            }
            Row::Item(i) => {
                let title = match &i.right {
                    Some(r) => format!("{}  {r}", i.title),
                    None => i.title.clone(),
                };
                if i.submenu.is_empty() {
                    let item_id = i
                        .action
                        .as_ref()
                        .map(&mut id)
                        .unwrap_or_else(|| i.id.clone());
                    items.push(Box::new(MenuItem::with_id(
                        app,
                        item_id,
                        title,
                        i.enabled,
                        None::<&str>,
                    )?));
                } else {
                    let mut subs: Vec<Box<dyn IsMenuItem<tauri::Wry>>> = Vec::new();
                    for m in &i.submenu {
                        subs.push(Box::new(CheckMenuItem::with_id(
                            app,
                            id(&m.action),
                            &m.title,
                            true,
                            m.checked,
                            None::<&str>,
                        )?));
                    }
                    let refs: Vec<&dyn IsMenuItem<tauri::Wry>> =
                        subs.iter().map(|b| b.as_ref()).collect();
                    items.push(Box::new(Submenu::with_items(
                        app, &title, i.enabled, &refs,
                    )?));
                }
            }
        }
    }
    *ACTIONS.lock().expect("锁未中毒") = actions;
    let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items.iter().map(|b| b.as_ref()).collect();
    Menu::with_items(app, &refs)
}
