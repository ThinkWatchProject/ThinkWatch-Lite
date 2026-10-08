//! 菜单栏在 macOS 上的样子：应用自己持有的 `NSStatusItem` 和原生 `NSMenu`。
//!
//! **不用 Tauri 的托盘。**它的菜单只有文字、勾选和子菜单，画不出额度条；而且只能
//! 整份替换，替换会把开着的菜单收起来。它还在按钮上盖了一层自己的视图，按它自己
//! 记的菜单决定弹不弹 —— 换成我们的 `NSMenu` 就被那层挡住了。
//!
//! **不依赖 Tauri。**这里只认模型（[`super::model`]）和两个回调：点了什么、菜单开
//! 没开。所以它能被一个单独的小程序原样拿去挂一份假数据看样子
//! （`examples/menubar_preview.rs`），不必起整个应用。
//!
//! 所有 AppKit 调用都在主线程上。别处要改它，用 [`on_main`] 投递 —— 那走的是 GCD
//! 的主队列：菜单展开时主线程处在事件跟踪模式，别的投递方式要等菜单关了才执行。
//!
//! 菜单里自己画的那几行（额度条、今日的几格数字……）在 `info`；只给预览程序用的几样
//! （离屏画图、点开收起菜单）在 `preview`，只在开发构建里。

use std::cell::{Cell, RefCell};
use std::ptr::NonNull;
use std::rc::Rc;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, ProtocolObject};
use objc2::{AnyThread, MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
use objc2_app_kit::{
    NSAlert, NSAlertFirstButtonReturn, NSAlertSecondButtonReturn, NSAlertStyle,
    NSAppearanceCustomization, NSApplication, NSAttributedStringNSStringDrawing, NSBezierPath,
    NSColor, NSControlStateValueOff, NSControlStateValueOn, NSEvent, NSEventMask,
    NSEventModifierFlags, NSFont, NSFontAttributeName, NSFontWeightMedium, NSFontWeightRegular,
    NSFontWeightSemibold, NSForegroundColorAttributeName, NSImage, NSImageSymbolConfiguration,
    NSLineCapStyle, NSLineJoinStyle, NSMenu, NSMenuDelegate, NSMenuItem, NSStatusBar, NSStatusItem,
    NSVariableStatusItemLength,
};
use objc2_foundation::{
    NSAttributedString, NSDictionary, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString,
};

use super::model::{Action, Bar, Row, Style, SubItem, Tone};

mod info;
#[cfg(debug_assertions)]
pub mod preview;

use info::{InfoView, QuotaText, info_of, quota_text};

/// 菜单栏往下这么宽。自定义的几行按它画，标准的菜单项跟着撑满
const MENU_WIDTH: f64 = 308.0;
/// 自定义行的左右留白：和标准菜单项的图标列对齐
const PAD: f64 = 14.0;
/// 标准菜单项的文字从这里开始（图标列之后）
const TEXT_X: f64 = 38.0;

/// 投递到主线程执行。**菜单开着时也会执行**（见模块说明）
pub fn on_main(f: impl FnOnce(MainThreadMarker) + Send + 'static) {
    dispatch2::DispatchQueue::main().exec_async(move || {
        let mtm = MainThreadMarker::new().expect("主队列就在主线程上");
        f(mtm);
    });
}

type OnAction = Rc<dyn Fn(Action)>;
type OnOpen = Rc<dyn Fn(bool)>;

struct Ui {
    item: Retained<NSStatusItem>,
    menu: Retained<NSMenu>,
    target: Retained<Target>,
    /// 现在菜单里每一行的样子。样子没变就就地改，变了才重建
    shapes: Vec<String>,
    /// 和 `shapes` 一一对应的菜单项
    items: Vec<Retained<NSMenuItem>>,
    /// 这些菜单项现在画的是哪一份模型。就地改的时候拿它比：没变的（图标、子菜单的样子）不动
    rows: Vec<Row>,
    /// 按菜单项的 tag 找到它做什么
    actions: Vec<Action>,
    bar: Option<Bar>,
}

thread_local! {
    static UI: RefCell<Option<Ui>> = const { RefCell::new(None) };
    /// **回调单独放。**回调里可能弹一个模态的确认框，模态期间主线程照样处理投递
    /// 过来的更新 —— 这时要是还借着 `UI`，那次更新就会撞上
    static ON_ACTION: RefCell<Option<OnAction>> = const { RefCell::new(None) };
    static ON_OPEN: RefCell<Option<OnOpen>> = const { RefCell::new(None) };
    static OPEN: Cell<bool> = const { Cell::new(false) };
}

/// 在菜单栏上挂出来。只调一次
pub fn install(
    mtm: MainThreadMarker,
    on_action: impl Fn(Action) + 'static,
    on_open: impl Fn(bool) + 'static,
) {
    ON_ACTION.with(|a| *a.borrow_mut() = Some(Rc::new(on_action)));
    ON_OPEN.with(|o| *o.borrow_mut() = Some(Rc::new(on_open)));

    let item = NSStatusBar::systemStatusBar().statusItemWithLength(NSVariableStatusItemLength);
    // 用户按住 ⌘ 拖过的位置，下次启动还在
    item.setAutosaveName(Some(&NSString::from_str("ThinkWatchLite")));
    let target = Target::new(mtm);
    let menu = NSMenu::new(mtm);
    menu.setMinimumWidth(MENU_WIDTH);
    menu.setAutoenablesItems(false);
    menu.setDelegate(Some(ProtocolObject::from_ref(&*target)));
    item.setMenu(Some(&menu));
    UI.with(|ui| {
        *ui.borrow_mut() = Some(Ui {
            item,
            menu,
            target,
            shapes: Vec::new(),
            items: Vec::new(),
            rows: Vec::new(),
            actions: Vec::new(),
            bar: None,
        });
    });
}

/// 照着模型画一遍。**没变的不动**：菜单栏那一块文字和颜色都没变就不重画，菜单行的
/// 样子没变就只改文字
pub fn apply(mtm: MainThreadMarker, bar: &Bar, rows: &[Row]) {
    UI.with(|cell| {
        let mut guard = cell.borrow_mut();
        let Some(ui) = guard.as_mut() else { return };
        if ui.bar.as_ref() != Some(bar) {
            draw_bar(mtm, &ui.item, bar);
            ui.bar = Some(bar.clone());
        }
        let shapes: Vec<String> = rows.iter().map(Row::shape).collect();
        if shapes == ui.shapes {
            refresh(mtm, ui, rows);
        } else {
            rebuild(mtm, ui, rows);
            tracing::debug!(rows = ?shapes, "菜单重建");
            ui.shapes = shapes;
        }
    });
}

// ------------------------------------------------------------------ 菜单栏那一块

/// 菜单栏那一块的高度。**按系统给的厚度画**，不写死
fn thickness() -> f64 {
    NSStatusBar::systemStatusBar().thickness()
}

fn draw_bar(mtm: MainThreadMarker, item: &NSStatusItem, bar: &Bar) {
    let Some(button) = item.button(mtm) else {
        return;
    };
    let image = bar_image(bar);
    button.setImage(Some(&image));
    button.setToolTip(Some(&NSString::from_str(&bar.tooltip)));
    let label = NSString::from_str(&bar.tooltip);
    // 旁白读的就是悬停提示那一句
    let _: () = unsafe { msg_send![&*button, setAccessibilityLabel: &*label] };
}

/// 标识的尺寸：高 15pt，按应用图标 32 格坐标里 TW 字形所在的 22×20 那一块取宽
const MARK_H: f64 = 15.0;
const MARK_W: f64 = MARK_H * 22.0 / 20.0;
const GAP: f64 = 5.0;
const EDGE: f64 = 3.0;

/// 画成一张图。**正常时是模板图**：系统按菜单栏的深浅自动着色；额度紧张、用完、
/// 网关不在的时候要上色，只能关掉模板，用跟着外观走的系统颜色自己画
pub fn bar_image(bar: &Bar) -> Retained<NSImage> {
    let show_mark = bar.style != Style::Numbers;
    let show_numbers = bar.style != Style::Icon;
    let (top, bottom) = bar
        .numbers
        .clone()
        .unwrap_or_else(|| ("—".to_string(), "—".to_string()));
    let top_font = mono(10.0, weight(Weight::Semibold));
    let bottom_font = mono(10.0, weight(Weight::Medium));
    let numbers_w = if show_numbers {
        let a = attributed(&top, &top_font, &NSColor::labelColor())
            .size()
            .width;
        let b = attributed(&bottom, &bottom_font, &NSColor::labelColor())
            .size()
            .width;
        a.max(b).ceil()
    } else {
        0.0
    };
    let dot_w = if !show_mark && bar.dot { 7.0 } else { 0.0 };
    let mut width = EDGE * 2.0 + dot_w + numbers_w;
    if show_mark {
        width += MARK_W;
    }
    if show_mark && show_numbers {
        width += GAP;
    }
    let height = thickness();
    let template = bar.tone == Tone::Normal && !bar.alert;
    let bar = bar.clone();
    let block = RcBlock::new(move |_rect: NSRect| -> Bool {
        let fg = if template {
            NSColor::blackColor()
        } else {
            NSColor::labelColor()
        };
        let alpha = if bar.dim { 0.42 } else { 1.0 };
        let mut x = EDGE;
        if show_mark {
            let mark_color = match (bar.style, bar.tone) {
                (Style::Icon, Tone::Warn) => NSColor::systemOrangeColor(),
                (Style::Icon, Tone::Full) => NSColor::systemRedColor(),
                _ => fg.clone(),
            };
            draw_mark(
                x,
                (height - MARK_H) / 2.0,
                &mark_color.colorWithAlphaComponent(alpha),
            );
            if bar.dot {
                fill_oval(x + MARK_W - 1.5, (height - MARK_H) / 2.0 - 1.5, 5.0, &fg);
            }
            if bar.alert {
                fill_oval(
                    x + MARK_W - 2.0,
                    (height - MARK_H) / 2.0 - 2.5,
                    7.0,
                    &NSColor::systemRedColor(),
                );
            }
            x += MARK_W + GAP;
        }
        if show_numbers {
            let (color, alpha) = match bar.tone {
                Tone::Warn => (NSColor::systemOrangeColor(), alpha),
                Tone::Full => (NSColor::systemRedColor(), alpha),
                // 仅数值时没有角标可画：不在运行就让破折号本身变红，而且不淡化
                Tone::Normal if bar.alert && !show_mark => (NSColor::systemRedColor(), 1.0),
                Tone::Normal => (fg.clone(), alpha),
            };
            let color = color.colorWithAlphaComponent(alpha);
            if dot_w > 0.0 {
                fill_oval(x, height / 2.0 - 2.5, 5.0, &color);
                x += dot_w;
            }
            // 两行都右对齐：数字变长时向左伸，右边缘不动
            let a = attributed(&top, &top_font, &color);
            let b = attributed(&bottom, &bottom_font, &color);
            let right = x + numbers_w;
            let line = 10.5;
            let y0 = (height - line * 2.0) / 2.0 - 0.5;
            a.drawAtPoint(NSPoint::new(right - a.size().width, y0));
            b.drawAtPoint(NSPoint::new(right - b.size().width, y0 + line));
        }
        Bool::YES
    });
    let image =
        NSImage::imageWithSize_flipped_drawingHandler(NSSize::new(width, height), true, &block);
    image.setTemplate(template);
    image
}

/// 应用图标里的 TW 字形：T 的横、T 的竖（同时是 W 的轴）、W。圆头圆角
fn draw_mark(x: f64, y: f64, color: &NSColor) {
    let s = MARK_H / 20.0;
    let p = |gx: f64, gy: f64| NSPoint::new(x + (gx - 5.0) * s, y + (gy - 7.0) * s);
    let path = NSBezierPath::new();
    path.moveToPoint(p(7.0, 9.0));
    path.lineToPoint(p(25.0, 9.0));
    path.moveToPoint(p(16.0, 9.0));
    path.lineToPoint(p(16.0, 17.0));
    path.moveToPoint(p(7.0, 17.0));
    path.lineToPoint(p(11.5, 25.0));
    path.lineToPoint(p(16.0, 17.0));
    path.lineToPoint(p(20.5, 25.0));
    path.lineToPoint(p(25.0, 17.0));
    path.setLineWidth(2.1);
    path.setLineCapStyle(NSLineCapStyle::Round);
    path.setLineJoinStyle(NSLineJoinStyle::Round);
    color.setStroke();
    path.stroke();
}

fn fill_oval(x: f64, y: f64, d: f64, color: &NSColor) {
    color.setFill();
    NSBezierPath::bezierPathWithOvalInRect(rect(x, y, d, d)).fill();
}

// ------------------------------------------------------------------ 菜单

fn rebuild(mtm: MainThreadMarker, ui: &mut Ui, rows: &[Row]) {
    ui.menu.removeAllItems();
    ui.items.clear();
    ui.actions.clear();
    let quota = quota_text(rows);
    for row in rows {
        let item = make_item(mtm, ui, row, quota);
        ui.menu.addItem(&item);
        ui.items.push(item);
    }
    ui.rows = rows.to_vec();
}

/// 样子没变：只换文字和数据。**不删不加**，开着的菜单不跳 —— 子菜单里的项也一样
fn refresh(mtm: MainThreadMarker, ui: &mut Ui, rows: &[Row]) {
    ui.actions.clear();
    let quota = quota_text(rows);
    let drawn = std::mem::take(&mut ui.rows);
    for (n, (row, item)) in rows.iter().zip(ui.items.clone()).enumerate() {
        match row {
            Row::Separator => {}
            Row::Item(i) => {
                let was = match drawn.get(n) {
                    Some(Row::Item(was)) => Some(was),
                    _ => None,
                };
                fill_item(mtm, ui, &item, i, was);
            }
            _ => {
                let tag = row_action(row).map(|a| push_action(ui, a.clone()));
                if let Some(view) = item.view().and_then(|v| v.downcast::<InfoView>().ok()) {
                    view.set_info(info_of(row, quota), tag);
                }
            }
        }
    }
    ui.rows = rows.to_vec();
}

fn row_action(row: &Row) -> Option<&Action> {
    match row {
        Row::Notice { action, .. }
        | Row::Quota { action, .. }
        | Row::Stats { action, .. }
        | Row::Live { action, .. } => Some(action),
        _ => None,
    }
}

fn push_action(ui: &mut Ui, action: Action) -> isize {
    ui.actions.push(action);
    (ui.actions.len() - 1) as isize
}

fn make_item(
    mtm: MainThreadMarker,
    ui: &mut Ui,
    row: &Row,
    quota: QuotaText,
) -> Retained<NSMenuItem> {
    match row {
        Row::Separator => NSMenuItem::separatorItem(mtm),
        Row::Item(i) => {
            let item = NSMenuItem::new(mtm);
            fill_item(mtm, ui, &item, i, None);
            item
        }
        _ => {
            let item = NSMenuItem::new(mtm);
            let tag = row_action(row).map(|a| push_action(ui, a.clone()));
            let info = info_of(row, quota);
            let view = InfoView::new(mtm, info, tag);
            item.setView(Some(&view));
            item
        }
    }
}

/// 按模型填一个标准菜单项。`was` 是它现在画着的那一份（就地改时才有）：和它一样的部分
/// 不再动
fn fill_item(
    mtm: MainThreadMarker,
    ui: &mut Ui,
    item: &NSMenuItem,
    i: &super::model::Item,
    was: Option<&super::model::Item>,
) {
    item.setAttributedTitle(Some(&item_title(&i.title, i.right.as_deref())));
    item.setEnabled(i.enabled);
    // **图标变了才换**：菜单开着时每秒填一遍，每一遍都去取一次 SF Symbol 再设回去，是主线程
    // 上的白功夫
    if was.is_none_or(|w| (w.icon, w.accent) != (i.icon, i.accent)) {
        if let Some(icon) = i.icon.filter(|s| !s.is_empty()) {
            item.setImage(
                symbol(icon, i.accent.then(NSColor::controlAccentColor).as_deref()).as_deref(),
            );
        } else {
            item.setImage(None);
        }
    }
    if let Some(key) = i.key {
        item.setKeyEquivalent(&NSString::from_str(key));
        item.setKeyEquivalentModifierMask(NSEventModifierFlags::Command);
    }
    let target_obj = ui.target.clone();
    let target: &AnyObject = &target_obj;
    match &i.action {
        Some(a) => {
            let tag = push_action(ui, a.clone());
            item.setTag(tag);
            unsafe {
                item.setTarget(Some(target));
                item.setAction(Some(sel!(pick:)));
            }
        }
        None => unsafe {
            item.setAction(None);
        },
    }
    if i.submenu.is_empty() {
        item.setSubmenu(None);
        return;
    }
    // 子菜单的样子没变（一样多的项，线隔在一样的地方）：**就地改**每一项的字、勾和动作。
    // 整份删了再加的话，开着的子菜单每秒跳一下，鼠标停着的那一项也跟着没了
    if let Some(sub) = item.submenu()
        && was.is_some_and(|w| same_layout(&w.submenu, &i.submenu))
        && sub.numberOfItems() == layout_len(&i.submenu)
    {
        let mut at = 0;
        for m in &i.submenu {
            at += isize::from(m.sep_before);
            if let Some(one) = sub.itemAtIndex(at) {
                fill_sub(ui, &one, m, target);
            }
            at += 1;
        }
        return;
    }
    let sub = match item.submenu() {
        Some(s) => {
            s.removeAllItems();
            s
        }
        None => {
            let s = NSMenu::new(mtm);
            s.setAutoenablesItems(false);
            item.setSubmenu(Some(&s));
            s
        }
    };
    for m in &i.submenu {
        if m.sep_before {
            sub.addItem(&NSMenuItem::separatorItem(mtm));
        }
        let one = NSMenuItem::new(mtm);
        fill_sub(ui, &one, m, target);
        sub.addItem(&one);
    }
}

/// 子菜单里的一项：字、勾、点了做什么
fn fill_sub(ui: &mut Ui, one: &NSMenuItem, m: &SubItem, target: &AnyObject) {
    one.setTitle(&NSString::from_str(&m.title));
    one.setState(if m.checked {
        NSControlStateValueOn
    } else {
        NSControlStateValueOff
    });
    one.setTag(push_action(ui, m.action.clone()));
    unsafe {
        one.setTarget(Some(target));
        one.setAction(Some(sel!(pick:)));
    }
}

/// 两份子菜单的样子一样：一样多的项，线隔在一样的地方
fn same_layout(a: &[SubItem], b: &[SubItem]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.sep_before == y.sep_before)
}

/// 子菜单里一共有几项：每一项，再加上隔在它前面的线
fn layout_len(items: &[SubItem]) -> isize {
    items.iter().map(|m| 1 + isize::from(m.sep_before)).sum()
}

/// 标题，右边跟一段淡色的字（时刻、当前选中的成员）。**用系统的语义颜色**：菜单项
/// 高亮时它们自己换成高亮的那一套
fn item_title(title: &str, right: Option<&str>) -> Retained<NSAttributedString> {
    let font = NSFont::menuFontOfSize(0.0);
    let mut out = attributed(title, &font, &NSColor::labelColor());
    if let Some(right) = right {
        let s = objc2_foundation::NSMutableAttributedString::initWithAttributedString(
            objc2_foundation::NSMutableAttributedString::alloc(),
            &out,
        );
        let gap = attributed("    ", &font, &NSColor::labelColor());
        s.appendAttributedString(&gap);
        s.appendAttributedString(&attributed(right, &font, &NSColor::secondaryLabelColor()));
        out = Retained::into_super(s);
    }
    out
}

/// SF Symbol。`color` 给了就按它上色（有新版本时的强调色），否则是模板图，跟菜单一起变色
fn symbol(name: &str, color: Option<&NSColor>) -> Option<Retained<NSImage>> {
    let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(
        &NSString::from_str(name),
        None,
    )?;
    match color {
        Some(c) => {
            let config = NSImageSymbolConfiguration::configurationWithHierarchicalColor(c);
            let tinted = image.imageWithSymbolConfiguration(&config)?;
            tinted.setTemplate(false);
            Some(tinted)
        }
        None => {
            image.setTemplate(true);
            Some(image)
        }
    }
}

// ------------------------------------------------------------------ 点击与开合

define_class!(
    /// 菜单项的 target，也是菜单的 delegate
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ThinkWatchMenuTarget"]
    struct Target;

    impl Target {
        #[unsafe(method(pick:))]
        fn pick(&self, sender: &NSMenuItem) {
            dispatch(sender.tag());
        }
    }

    unsafe impl NSObjectProtocol for Target {}

    unsafe impl NSMenuDelegate for Target {
        #[unsafe(method(menuWillOpen:))]
        fn menu_will_open(&self, menu: &NSMenu) {
            // **菜单跟应用内选的外观走**（跟随系统时就是系统的深浅模式），不跟菜单栏
            // —— macOS 26 的菜单栏透明，深浅随壁纸变：深色模式配亮壁纸时它是浅的。
            // 显式设上，不留给 AppKit 去推断状态栏菜单该继承谁
            let mtm = MainThreadMarker::from(self);
            menu.setAppearance(Some(&NSApplication::sharedApplication(mtm).effectiveAppearance()));
            OPEN.with(|o| o.set(true));
            if let Some(f) = ON_OPEN.with(|o| o.borrow().clone()) {
                f(true);
            }
        }

        #[unsafe(method(menuDidClose:))]
        fn menu_did_close(&self, _menu: &NSMenu) {
            OPEN.with(|o| o.set(false));
            if let Some(f) = ON_OPEN.with(|o| o.borrow().clone()) {
                f(false);
            }
        }
    }
);

impl Target {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

/// 按 tag 找到要做的事，**放开 `UI` 之后**再交给回调
fn dispatch(tag: isize) {
    let action = UI.with(|ui| {
        ui.borrow()
            .as_ref()
            .and_then(|ui| ui.actions.get(tag as usize).cloned())
    });
    let Some(action) = action else { return };
    // 菜单的动作在菜单收起之后才执行；再往后排一拍，让它彻底收干净，再弹确认框之类
    on_main(move |_| {
        if let Some(f) = ON_ACTION.with(|a| a.borrow().clone()) {
            f(action);
        }
    });
}

/// 退出前的确认。**原生的对话框**：不为了问一句话去拉起整个主窗口
pub fn confirm_quit(mtm: MainThreadMarker, in_flight: usize) -> bool {
    let app = NSApplication::sharedApplication(mtm);
    #[allow(deprecated)]
    app.activateIgnoringOtherApps(true);
    let alert = NSAlert::new(mtm);
    alert.setAlertStyle(NSAlertStyle::Warning);
    alert.setMessageText(&NSString::from_str(tr!(
        "退出 ThinkWatch Lite",
        "Quit ThinkWatch Lite"
    )));
    let mut info = tr!(
        "退出后网关将停止监听，所有已接管的客户端将立即无法连接。",
        "After quitting, the gateway stops listening, and every connected client immediately loses its connection."
    )
    .to_string();
    if in_flight > 0 {
        info.push('\n');
        info.push_str(&tr!(
            format!("{in_flight} 个请求正在进行，将被中断。"),
            if in_flight == 1 {
                "1 request in progress will be interrupted.".to_string()
            } else {
                format!("{in_flight} requests in progress will be interrupted.")
            }
        ));
    }
    alert.setInformativeText(&NSString::from_str(&info));
    // **取消是默认按钮**：回车不该变成一次退出。要明说 —— 标题恰好是英文「Cancel」时，
    // AppKit 给它配的是 Esc，对话框里就没有默认按钮了
    let cancel = alert.addButtonWithTitle(&NSString::from_str(tr!("取消", "Cancel")));
    cancel.setKeyEquivalent(&NSString::from_str("\r"));
    let quit = alert.addButtonWithTitle(&NSString::from_str(tr!("退出", "Quit")));
    quit.setHasDestructiveAction(true);
    // Esc 也是取消。一个按钮只有一个快捷键，所以在对话框开着的这段时间里单独接住它
    let esc = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        if unsafe { event.as_ref() }.keyCode() == KEY_ESCAPE {
            NSApplication::sharedApplication(mtm).stopModalWithCode(NSAlertFirstButtonReturn);
            return std::ptr::null_mut();
        }
        event.as_ptr()
    });
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &esc)
    };
    let answer = alert.runModal();
    if let Some(monitor) = monitor {
        unsafe { NSEvent::removeMonitor(&monitor) };
    }
    // 只有点了「退出」才退：模态被系统收掉之类别的返回值一律当没退
    answer == NSAlertSecondButtonReturn
}

/// Esc 的键码
const KEY_ESCAPE: u16 = 53;

/// 一句话的提示框（检查更新之后「已是最新版本」这类）
pub fn inform(mtm: MainThreadMarker, title: &str, body: &str) {
    let app = NSApplication::sharedApplication(mtm);
    #[allow(deprecated)]
    app.activateIgnoringOtherApps(true);
    let alert = NSAlert::new(mtm);
    alert.setMessageText(&NSString::from_str(title));
    alert.setInformativeText(&NSString::from_str(body));
    alert.addButtonWithTitle(&NSString::from_str(tr!("好", "OK")));
    alert.runModal();
}

// ------------------------------------------------------------------ 画字的小工具

#[derive(Clone, Copy)]
enum Weight {
    Regular,
    Medium,
    Semibold,
}

fn weight(w: Weight) -> f64 {
    // SAFETY: AppKit 导出的常量，只读
    unsafe {
        match w {
            Weight::Regular => NSFontWeightRegular,
            Weight::Medium => NSFontWeightMedium,
            Weight::Semibold => NSFontWeightSemibold,
        }
    }
}

fn sys(size: f64, weight: f64) -> Retained<NSFont> {
    NSFont::systemFontOfSize_weight(size, weight)
}

/// 等宽数字：同位数的数字一样宽，数字变化时右边的东西不跳
fn mono(size: f64, weight: f64) -> Retained<NSFont> {
    NSFont::monospacedDigitSystemFontOfSize_weight(size, weight)
}

fn attributed(text: &str, font: &NSFont, color: &NSColor) -> Retained<NSAttributedString> {
    // SAFETY: AppKit 导出的键，只读
    let keys = unsafe { [NSFontAttributeName, NSForegroundColorAttributeName] };
    let values: [&AnyObject; 2] = [font.as_ref(), color.as_ref()];
    let attrs = NSDictionary::from_slices(&keys, &values);
    unsafe {
        NSAttributedString::initWithString_attributes(
            NSAttributedString::alloc(),
            &NSString::from_str(text),
            Some(&attrs),
        )
    }
}

fn rect(x: f64, y: f64, w: f64, h: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
}
