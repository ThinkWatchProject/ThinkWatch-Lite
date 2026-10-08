//! 不是 macOS 的平台：仍用 Tauri 的托盘，按同一份模型出一份纯文字菜单。
//!
//! 画不出「今日」那一块和额度条，那几行写成文字（写法也在模型里：`Dash::line`、
//! `WindowRow::line`）。**判定都在模型里**，这里只是另一种画法 —— 以后给 Windows 做一套
//! 像样的，换掉的只是这个文件。次序和 macOS 一样：「打开主界面」永远是第一项。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};

use super::model::{Action, Bar, Row};

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static TRAY: OnceLock<TrayIcon> = OnceLock::new();
/// 现在这一版菜单是第几版，和它上面的动作。菜单项的 id 是 `a:<第几版>:<下标>`
/// （[`item_id`]），按下标找到它做什么 —— **下标只在建它的那一版里作数**，见 [`pick`]
static ACTIONS: Mutex<(u64, Vec<Action>)> = Mutex::new((0, Vec::new()));
/// 菜单建到第几版了
static GENERATION: AtomicU64 = AtomicU64::new(0);
/// 上一次画的那一份：没变就不重建（开着的菜单会被收起来）。
///
/// Linux 上更要紧：tray-icon 的 `set_menu` 每次都把一份新的 GtkMenu 交给
/// AppIndicator，整份菜单经 D-Bus 重新导出一遍，面板那边开着的菜单跟着重画
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
        // 也没有发事件的地方）。菜单是那边唯一的入口 —— 模型把「打开主界面」排在
        // 每一种状态的第一项，那边第一眼看到的就是它。
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
            let action = ACTIONS
                .lock()
                .ok()
                .and_then(|current| pick(event.id().as_ref(), &current));
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

/// 第 `generation` 版菜单上第 `index` 个动作的那一项的 id
fn item_id(generation: u64, index: usize) -> String {
    format!("a:{generation}:{index}")
}

/// 点的那一项做什么。**只认现在这一版菜单的**：菜单开着时数据变了、菜单换了一版，旧菜单
/// 上的一下点击照样会送过来，按下标它会落到新菜单的另一项上 —— 可能就是「退出」（这些
/// 平台上退出不再问一句）。旧菜单的点击就当没点，再点一下就是
fn pick(id: &str, (generation, actions): &(u64, Vec<Action>)) -> Option<Action> {
    let (g, i) = id.strip_prefix("a:")?.split_once(':')?;
    if g.parse::<u64>().ok()? != *generation {
        return None;
    }
    actions.get(i.parse::<usize>().ok()?).cloned()
}

fn build(app: &tauri::AppHandle, rows: &[Row]) -> tauri::Result<Menu<tauri::Wry>> {
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    let mut actions = Vec::new();
    let mut id = |a: &Action| {
        actions.push(a.clone());
        item_id(generation, actions.len() - 1)
    };
    let mut items: Vec<Box<dyn IsMenuItem<tauri::Wry>>> = Vec::new();
    for row in rows {
        match row {
            Row::Separator => items.push(Box::new(PredefinedMenuItem::separator(app)?)),
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
                items.push(Box::new(MenuItem::new(app, text, false, None::<&str>)?));
                if let Some(reason) = reason {
                    items.push(Box::new(MenuItem::new(app, reason, false, None::<&str>)?));
                }
            }
            // 「今日」那一块：上面一行状态（灰的），下面一行今天的用量（点了去概览），
            // 监听没换成时再一行原因
            Row::Today(d) => {
                items.push(Box::new(MenuItem::new(
                    app,
                    d.state_line(),
                    false,
                    None::<&str>,
                )?));
                items.push(Box::new(MenuItem::with_id(
                    app,
                    id(&d.action),
                    d.line(),
                    true,
                    None::<&str>,
                )?));
                if let Some(warn) = &d.warn {
                    items.push(Box::new(MenuItem::new(app, warn, false, None::<&str>)?));
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
                window,
                action,
            } => {
                items.push(Box::new(MenuItem::with_id(
                    app,
                    id(action),
                    window.line(provider),
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
    *ACTIONS.lock().expect("锁未中毒") = (generation, actions);
    let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items.iter().map(|b| b.as_ref()).collect();
    Menu::with_items(app, &refs)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 菜单换了一版之后，旧菜单上的点击不算数：按下标，它会落到新菜单的另一项上
    #[test]
    fn a_click_on_a_replaced_menu_does_nothing() {
        let current = (7, vec![Action::OpenMain, Action::Quit]);
        assert_eq!(pick(&item_id(7, 1), &current), Some(Action::Quit));
        // 上一版菜单的第 1 项：送到的时候，菜单已经换成了这一版
        assert_eq!(pick(&item_id(6, 1), &current), None);
        assert_eq!(pick(&item_id(7, 2), &current), None);
        // 没带版本的旧写法，没有动作的那几项（策略组、连接的标题）
        assert_eq!(pick("a:1", &current), None);
        assert_eq!(pick("group:主力", &current), None);
    }
}
