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
/// 上一次画的那一份：没变就不重建（开着的菜单会被收起来）。
///
/// Linux 上更要紧：tray-icon 的 `set_menu` 每次都把一份新的 GtkMenu 交给
/// AppIndicator，整份菜单经 D-Bus 重新导出一遍，面板那边开着的菜单跟着重画。
/// 比较的是模型，挪「打开主界面」那一步在比较之后，不影响这层判断
static LAST: Mutex<Option<(Bar, Vec<Row>)>> = Mutex::new(None);

pub fn install(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let _ = APP.set(app.clone());
    let mut builder = TrayIconBuilder::new()
        // **左键打开主窗口，菜单只给右键。**这是 Windows 的惯例，和 macOS
        // 那边「点一下就出菜单」故意不一致 —— 各随各的。
        //
        // Tauri 默认把菜单挂在左键上，所以这一行必须写出来。
        //
        // **Linux 上这一行和下面的点击回调都不起作用。**那边的托盘是 AppIndicator
        // （StatusNotifierItem），点击由面板处理、一律弹菜单，tray-icon 一个点击
        // 事件也收不到（它的 `TrayIconEvent` 文档写明 Linux 不支持，gtk 那份实现里
        // 也没有发事件的地方）。所以 Linux 菜单的第一项是「打开主界面」，见 `build`。
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

/// Linux 上把「打开主界面」挪到最前面，后面跟一条分隔线。
///
/// 别处点一下图标就开窗口，这一项放在末尾那组里就够了；AppIndicator 不给点击
/// 事件，**菜单是唯一的入口**，它就得是第一眼看到的那一项。是挪不是加：同一个
/// 菜单里出现两次「打开主界面」没有道理。
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn open_first(rows: &[Row]) -> Vec<Row> {
    let is_open = |r: &Row| matches!(r, Row::Item(i) if i.id == "open");
    let Some(at) = rows.iter().position(is_open) else {
        return rows.to_vec();
    };
    let mut out = Vec::with_capacity(rows.len() + 1);
    out.push(rows[at].clone());
    out.push(Row::Separator);
    out.extend(rows[..at].iter().cloned());
    // 挪走之后原处前后可能剩下两条相邻的分隔线，或者末尾一条
    for r in &rows[at + 1..] {
        if matches!(r, Row::Separator) && matches!(out.last(), Some(Row::Separator)) {
            continue;
        }
        out.push(r.clone());
    }
    if matches!(out.last(), Some(Row::Separator)) {
        out.pop();
    }
    out
}

fn build(app: &tauri::AppHandle, rows: &[Row]) -> tauri::Result<Menu<tauri::Wry>> {
    #[cfg(target_os = "linux")]
    let rows = &open_first(rows);
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
                        // 隔在线后面的是动作（「管理连接…」），不是几个里选一个：不画成勾选项
                        if m.sep_before {
                            subs.push(Box::new(PredefinedMenuItem::separator(app)?));
                            subs.push(Box::new(MenuItem::with_id(
                                app,
                                id(&m.action),
                                &m.title,
                                true,
                                None::<&str>,
                            )?));
                            continue;
                        }
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

#[cfg(test)]
mod tests {
    use super::super::model::{Snapshot, Style, build};
    use super::*;

    fn ids(rows: &[Row]) -> Vec<String> {
        rows.iter()
            .map(|r| match r {
                Row::Item(i) => i.id.clone(),
                Row::Separator => "---".to_string(),
                _ => "·".to_string(),
            })
            .collect()
    }

    /// AppIndicator 不给点击事件：「打开主界面」得是第一项，而且只出现一次
    #[test]
    fn open_moves_to_the_top_once() {
        let (_, rows) = build(&Snapshot::default(), Style::default());
        assert!(ids(&rows).contains(&"open".to_string()), "模型里得有这一项");
        let out = ids(&open_first(&rows));
        assert_eq!(out[0], "open");
        assert_eq!(out[1], "---");
        assert_eq!(out.iter().filter(|i| *i == "open").count(), 1);
        // 挪走之后不留两条相邻的分隔线，也不以分隔线结尾
        assert!(!out.windows(2).any(|w| w[0] == "---" && w[1] == "---"));
        assert_ne!(out.last().map(String::as_str), Some("---"));
    }

    #[test]
    fn a_menu_without_it_is_left_alone() {
        let rows = vec![Row::Separator];
        assert_eq!(open_first(&rows), rows);
    }
}
