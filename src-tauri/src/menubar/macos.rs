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

use std::cell::{Cell, RefCell};
use std::ptr::NonNull;
use std::rc::Rc;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, ProtocolObject};
use objc2::{
    AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, Message, define_class, msg_send, sel,
};
use objc2_app_kit::{
    NSAlert, NSAlertFirstButtonReturn, NSAlertSecondButtonReturn, NSAlertStyle,
    NSAppearanceCustomization, NSApplication, NSAttributedStringNSStringDrawing,
    NSAutoresizingMaskOptions, NSBezierPath, NSColor, NSControlStateValueOff,
    NSControlStateValueOn, NSEvent, NSEventMask, NSEventModifierFlags, NSFont, NSFontAttributeName,
    NSFontWeightMedium, NSFontWeightRegular, NSFontWeightSemibold, NSForegroundColorAttributeName,
    NSImage, NSImageSymbolConfiguration, NSLineCapStyle, NSLineJoinStyle, NSMenu, NSMenuDelegate,
    NSMenuItem, NSStatusBar, NSStatusItem, NSVariableStatusItemLength, NSView,
};
use objc2_foundation::{
    NSAttributedString, NSDictionary, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString,
};

use super::model::{Action, Bar, Level, Row, StateTone, Style, Tone, WindowRow};

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
            actions: Vec::new(),
            bar: None,
        });
    });
}

/// 菜单开着吗
pub fn is_open() -> bool {
    OPEN.with(|o| o.get())
}

/// 开发用：过 `delay` 秒像用户点了一下那样把菜单打开（预览程序用）。
///
/// **走 run loop 的延时调用，不走 GCD。**菜单的跟踪循环要是嵌在一个主队列任务里，
/// CFRunLoop 为了不让主队列重入，那期间不再处理主队列 —— 投递过来的更新全都要等
/// 菜单关上。用户真点菜单栏时跟踪循环是从事件分发开始的，没有这个问题
pub fn open_menu_later(mtm: MainThreadMarker, delay: f64) {
    let button = UI.with(|ui| ui.borrow().as_ref().and_then(|ui| ui.item.button(mtm)));
    if let Some(button) = button {
        let none: Option<&AnyObject> = None;
        let _: () = unsafe {
            msg_send![&*button, performSelector: sel!(performClick:), withObject: none, afterDelay: delay]
        };
    }
}

/// 开发用：把开着的菜单收起来
pub fn close_menu() {
    UI.with(|ui| {
        if let Some(ui) = ui.borrow().as_ref() {
            ui.menu.cancelTracking();
        }
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
}

/// 样子没变：只换文字和数据。**不删不加**，开着的菜单不跳
fn refresh(mtm: MainThreadMarker, ui: &mut Ui, rows: &[Row]) {
    ui.actions.clear();
    let quota = quota_text(rows);
    for (row, item) in rows.iter().zip(ui.items.clone()) {
        match row {
            Row::Separator => {}
            Row::Item(i) => fill_item(mtm, ui, &item, i),
            _ => {
                let tag = row_action(row).map(|a| push_action(ui, a.clone()));
                if let Some(view) = item.view().and_then(|v| v.downcast::<InfoView>().ok()) {
                    view.set_info(info_of(row, quota), tag);
                }
            }
        }
    }
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
            fill_item(mtm, ui, &item, i);
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

fn fill_item(mtm: MainThreadMarker, ui: &mut Ui, item: &NSMenuItem, i: &super::model::Item) {
    item.setAttributedTitle(Some(&item_title(&i.title, i.right.as_deref())));
    item.setEnabled(i.enabled);
    if let Some(icon) = i.icon.filter(|s| !s.is_empty()) {
        item.setImage(
            symbol(icon, i.accent.then(NSColor::controlAccentColor).as_deref()).as_deref(),
        );
    } else {
        item.setImage(None);
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
    } else {
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
            sub.addItem(&one);
        }
    }
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

// ------------------------------------------------------------------ 自定义的几行

/// 自定义行要画的东西
#[derive(Debug, Clone)]
enum Info {
    Header {
        title: String,
        state: String,
        tone: StateTone,
        line2: String,
        line2_warn: bool,
    },
    Section {
        title: String,
        right: Option<String>,
    },
    Notice {
        level: Level,
        title: String,
        body: String,
    },
    Quota {
        provider: String,
        windows: Vec<WindowRow>,
        /// 菜单里所有额度行共用的字宽，见 [`quota_text`]
        text: QuotaText,
    },
    Stats {
        cells: Vec<super::model::StatCell>,
    },
    Live {
        app: String,
        model: String,
        elapsed: String,
    },
}

/// `quota`：整份菜单的额度行一起量出来的字宽（[`quota_text`]），只有额度行用
fn info_of(row: &Row, quota: QuotaText) -> Info {
    match row.clone() {
        Row::Header {
            title,
            state,
            tone,
            line2,
            line2_warn,
        } => Info::Header {
            title,
            state,
            tone,
            line2,
            line2_warn,
        },
        Row::Section { title, right } => Info::Section { title, right },
        Row::Notice {
            level, title, body, ..
        } => Info::Notice { level, title, body },
        Row::Quota {
            provider, windows, ..
        } => Info::Quota {
            provider,
            windows,
            text: quota,
        },
        Row::Stats { cells, .. } => Info::Stats { cells },
        Row::Live {
            app,
            model,
            elapsed,
            ..
        } => Info::Live {
            app,
            model,
            elapsed,
        },
        Row::Separator | Row::Item(_) => unreachable!("标准菜单项不走自定义视图"),
    }
}

fn info_height(info: &Info) -> f64 {
    match info {
        Info::Header { .. } => 46.0,
        Info::Section { .. } => 21.0,
        Info::Notice { .. } => 40.0,
        Info::Quota { windows, .. } => 6.0 + 20.0 + 21.0 * windows.len() as f64 + 3.0,
        Info::Stats { .. } => 48.0,
        Info::Live { .. } => 24.0,
    }
}

pub struct ViewIvars {
    info: RefCell<Info>,
    /// 点了做什么（`Ui::actions` 里的下标）。没有就是一行只读的
    tag: Cell<Option<isize>>,
}

define_class!(
    /// 菜单里自己画的一行
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "ThinkWatchMenuRow"]
    #[ivars = ViewIvars]
    struct InfoView;

    impl InfoView {
        #[unsafe(method(isFlipped))]
        fn is_flipped(&self) -> bool {
            true
        }

        #[unsafe(method(drawRect:))]
        fn draw_rect(&self, _dirty: NSRect) {
            let highlighted = self.ivars().tag.get().is_some()
                && self.enclosingMenuItem().is_some_and(|i| i.isHighlighted());
            draw_info(&self.ivars().info.borrow(), self.bounds(), highlighted);
        }

        #[unsafe(method(mouseUp:))]
        fn mouse_up(&self, _event: &NSEvent) {
            let Some(tag) = self.ivars().tag.get() else { return };
            if let Some(menu) = self.enclosingMenuItem().and_then(|i| unsafe { i.menu() }) {
                menu.cancelTracking();
            }
            dispatch(tag);
        }
    }
);

impl InfoView {
    fn new(mtm: MainThreadMarker, info: Info, tag: Option<isize>) -> Retained<Self> {
        let frame = rect(0.0, 0.0, MENU_WIDTH, info_height(&info));
        let this = Self::alloc(mtm).set_ivars(ViewIvars {
            info: RefCell::new(info),
            tag: Cell::new(tag),
        });
        let view: Retained<Self> = unsafe { msg_send![super(this), initWithFrame: frame] };
        view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable);
        view
    }

    fn set_info(&self, info: Info, tag: Option<isize>) {
        *self.ivars().info.borrow_mut() = info;
        self.ivars().tag.set(tag);
        self.setNeedsDisplay(true);
    }
}

// ------------------------------------------------------------------ 自定义行的列宽
//
// **列宽按字量，不按一种语言写死。**中文的字都落在下面的最小列宽里，排出来和原来
// 写死的一样；英文的「Resets in 3 days」「Requests 4 failed」比那宽，写死的时候
// 就压到了旁边那一列上。

/// 同一行里两段字之间至少空这么多
const TEXT_GAP: f64 = 10.0;
/// 额度行：窗口名和条之间
const LABEL_GAP: f64 = 8.0;
/// 额度行：窗口名一列至少这么宽（含它和条之间的空）
const QUOTA_LABEL: f64 = 50.0;
/// 额度行：窗口名一列最多这么宽。上游给了很长的窗口名就截断，不把条挤没
const QUOTA_LABEL_MAX: f64 = 96.0;
/// 额度行：条和百分比之间
const QUOTA_BAR_GAP: f64 = 8.0;
/// 额度行：百分比一列，「100%」放得下
const QUOTA_PCT: f64 = 40.0;
/// 额度行：重置一列至少这么宽（含它和百分比之间的空）
const QUOTA_RESET: f64 = 92.0;
/// 额度行：条最短这么长
const QUOTA_MIN_BAR: f64 = 40.0;
/// 「今日」：标签和旁边的橙色小字（失败数）之间
const NOTE_GAP: f64 = 6.0;

fn quota_label_font() -> Retained<NSFont> {
    sys(12.0, weight(Weight::Regular))
}

/// 等宽数字：倒计时在走，同位数时宽度不变
fn quota_reset_font() -> Retained<NSFont> {
    mono(12.0, weight(Weight::Regular))
}

fn stat_value_font() -> Retained<NSFont> {
    mono(17.0, weight(Weight::Semibold))
}

fn stat_label_font() -> Retained<NSFont> {
    sys(11.0, weight(Weight::Regular))
}

fn text_width(text: &str, font: &NSFont) -> f64 {
    attributed(text, font, &NSColor::labelColor()).size().width
}

/// 额度行里最宽的窗口名和最宽的重置时刻。**整份菜单的额度行一起量**：几家的额度
/// 共用一套列，条的起止上下对齐
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct QuotaText {
    label: f64,
    reset: f64,
}

fn quota_text(rows: &[Row]) -> QuotaText {
    let (label_font, reset_font) = (quota_label_font(), quota_reset_font());
    rows.iter()
        .flat_map(|r| match r {
            Row::Quota { windows, .. } => windows.as_slice(),
            _ => &[],
        })
        .fold(QuotaText::default(), |t, wr| QuotaText {
            label: t.label.max(text_width(&wr.label, &label_font)),
            reset: t.reset.max(text_width(&wr.reset, &reset_font)),
        })
}

/// 额度行横着怎么排：窗口名 · 条 · 百分比 · 重置
#[derive(Debug, Clone, Copy, PartialEq)]
struct QuotaCols {
    /// 窗口名一列，含它和条之间的空
    label: f64,
    bar_x: f64,
    bar_w: f64,
    /// 百分比右对齐到这里
    pct_right: f64,
    /// 重置一列，含它和百分比之间的空。右对齐到 `w - PAD`
    reset: f64,
}

/// 两头的字要多宽给多宽，条拿剩下的。条短到 [`QUOTA_MIN_BAR`] 还放不下时，重置一列
/// 不再放宽，字截断
fn quota_cols(w: f64, text: QuotaText) -> QuotaCols {
    let label = (text.label + LABEL_GAP).clamp(QUOTA_LABEL, QUOTA_LABEL_MAX);
    let bar_x = PAD + label;
    let room = w - PAD - bar_x - QUOTA_MIN_BAR - QUOTA_BAR_GAP - QUOTA_PCT;
    let reset = (text.reset + TEXT_GAP).max(QUOTA_RESET).min(room);
    let bar_w = w - PAD - reset - QUOTA_PCT - QUOTA_BAR_GAP - bar_x;
    QuotaCols {
        label,
        bar_x,
        bar_w,
        pct_right: bar_x + bar_w + QUOTA_BAR_GAP + QUOTA_PCT,
        reset,
    }
}

/// 「今日」几格各多宽：量出每一格的字，交给 [`share_columns`]
fn stat_widths(w: f64, cells: &[super::model::StatCell]) -> Vec<f64> {
    let (value_font, label_font) = (stat_value_font(), stat_label_font());
    let needs: Vec<f64> = cells
        .iter()
        .map(|c| {
            let line2 = text_width(&c.label, &label_font)
                + c.note
                    .as_deref()
                    .map_or(0.0, |n| NOTE_GAP + text_width(n, &label_font));
            text_width(&c.value, &value_font).max(line2) + TEXT_GAP
        })
        .collect();
    share_columns(w - PAD * 2.0, &needs)
}

/// 把 `avail` 分给几格。**放得下时等分**；有一格要的比等分多（英文的「Requests
/// 4 failed」），就给它要的那么多，其余几格平分剩下的 —— 那几格也不小于自己要的。
/// 怎么分都放不下时按各自要的比例分，画的时候截断
fn share_columns(avail: f64, needs: &[f64]) -> Vec<f64> {
    let total: f64 = needs.iter().sum();
    if total > avail && total > 0.0 {
        return needs.iter().map(|n| avail * n / total).collect();
    }
    // 从要得最多的一格起：比「剩下的地方平分」还多，就照它要的给，剩下的接着平分
    let mut order: Vec<usize> = (0..needs.len()).collect();
    order.sort_by(|&a, &b| needs[b].total_cmp(&needs[a]));
    let (mut left, mut rest) = (avail, needs.len());
    let mut fixed = vec![false; needs.len()];
    for i in order {
        if needs[i] <= left / rest as f64 {
            break;
        }
        fixed[i] = true;
        left -= needs[i];
        rest -= 1;
    }
    let share = left / rest.max(1) as f64;
    needs
        .iter()
        .zip(fixed)
        .map(|(&n, fixed)| if fixed { n } else { share })
        .collect()
}

fn draw_info(info: &Info, b: NSRect, hl: bool) {
    let w = b.size.width;
    if hl {
        NSColor::selectedContentBackgroundColor().setFill();
        NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(
            rect(5.0, 0.0, w - 10.0, b.size.height),
            5.0,
            5.0,
        )
        .fill();
    }
    // 高亮时一律白字：底色是强调色
    let label = if hl {
        NSColor::whiteColor()
    } else {
        NSColor::labelColor()
    };
    let secondary = if hl {
        NSColor::whiteColor().colorWithAlphaComponent(0.8)
    } else {
        NSColor::secondaryLabelColor()
    };
    match info {
        Info::Header {
            title,
            state,
            tone,
            line2,
            line2_warn,
        } => {
            let st = attributed(state, &sys(12.0, weight(Weight::Regular)), &secondary);
            let sw = st.size().width;
            st.drawAtPoint(NSPoint::new(w - PAD - sw, 7.0));
            let dot = match tone {
                StateTone::Ok => NSColor::systemGreenColor(),
                StateTone::Busy => NSColor::systemYellowColor(),
                StateTone::Warn => NSColor::systemOrangeColor(),
                StateTone::Bad => NSColor::systemRedColor(),
            };
            let dot_x = w - PAD - sw - 12.0;
            fill_oval(dot_x, 11.0, 7.0, &dot);
            // 连着远程时标题是服务器的名字，多长都有：截断在状态前面，不压上去
            let t = attributed(title, &sys(13.0, weight(Weight::Semibold)), &label);
            draw_clipped(&t, PAD, 6.0, dot_x - TEXT_GAP - PAD);
            let color = if *line2_warn {
                NSColor::systemOrangeColor()
            } else {
                secondary.clone()
            };
            let l2 = attributed(line2, &mono(12.0, weight(Weight::Regular)), &color);
            draw_clipped(&l2, PAD, 25.0, w - PAD * 2.0);
        }
        Info::Section { title, right } => {
            let font = sys(11.0, weight(Weight::Semibold));
            attributed(title, &font, &secondary).drawAtPoint(NSPoint::new(PAD, 4.0));
            if let Some(r) = right {
                let a = attributed(r, &font, &secondary);
                a.drawAtPoint(NSPoint::new(w - PAD - a.size().width, 4.0));
            }
        }
        Info::Notice { level, title, body } => {
            let (name, color) = match level {
                Level::Critical => ("xmark.octagon.fill", NSColor::systemRedColor()),
                Level::Warning => (
                    "exclamationmark.triangle.fill",
                    NSColor::systemOrangeColor(),
                ),
                Level::Info => ("info.circle.fill", NSColor::systemBlueColor()),
            };
            let tint = if hl { NSColor::whiteColor() } else { color };
            if let Some(img) = symbol(name, Some(&tint)) {
                img.drawInRect(rect(PAD, 5.0, 16.0, 16.0));
            }
            let t = attributed(title, &NSFont::menuFontOfSize(0.0), &label);
            draw_clipped(&t, TEXT_X, 3.0, w - TEXT_X - PAD);
            let bd = attributed(body, &sys(11.5, weight(Weight::Regular)), &secondary);
            draw_clipped(&bd, TEXT_X, 21.0, w - TEXT_X - PAD);
        }
        Info::Quota {
            provider,
            windows,
            text,
        } => {
            let name = attributed(provider, &sys(13.0, weight(Weight::Medium)), &label);
            draw_clipped(&name, PAD, 4.0, w - PAD * 2.0);
            let pct_font = mono(12.0, weight(Weight::Medium));
            let QuotaCols {
                label: label_col,
                bar_x,
                bar_w,
                pct_right,
                reset: reset_col,
            } = quota_cols(w, *text);
            for (i, wr) in windows.iter().enumerate() {
                let y = 26.0 + 21.0 * i as f64;
                let lab = attributed(&wr.label, &quota_label_font(), &secondary);
                draw_clipped(&lab, PAD, y, label_col - LABEL_GAP);
                let track = if hl {
                    NSColor::whiteColor().colorWithAlphaComponent(0.3)
                } else {
                    NSColor::quaternaryLabelColor()
                };
                track.setFill();
                NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(
                    rect(bar_x, y + 6.0, bar_w, 5.0),
                    2.5,
                    2.5,
                )
                .fill();
                let tone_color = match wr.tone {
                    Tone::Normal => label.clone(),
                    Tone::Warn => NSColor::systemOrangeColor(),
                    Tone::Full => NSColor::systemRedColor(),
                };
                let tone_color = if hl {
                    NSColor::whiteColor()
                } else {
                    tone_color
                };
                if let Some(p) = wr.percent {
                    let fill = if matches!(wr.tone, Tone::Normal) && !hl {
                        label.colorWithAlphaComponent(0.8)
                    } else {
                        tone_color.clone()
                    };
                    fill.setFill();
                    let fw = (bar_w * p / 100.0).max(if p > 0.0 { 5.0 } else { 0.0 });
                    if fw > 0.0 {
                        NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(
                            rect(bar_x, y + 6.0, fw, 5.0),
                            2.5,
                            2.5,
                        )
                        .fill();
                    }
                    let pct = attributed(&format!("{}%", p.round() as i64), &pct_font, &tone_color);
                    pct.drawAtPoint(NSPoint::new(pct_right - pct.size().width, y));
                }
                // 右对齐。列宽是按字量出来的，截断只在菜单窄得放不下条的时候才会发生
                let rs = attributed(&wr.reset, &quota_reset_font(), &secondary);
                if let Some(rs) = fit(&rs, reset_col - TEXT_GAP) {
                    rs.drawAtPoint(NSPoint::new(w - PAD - rs.size().width, y));
                }
            }
        }
        Info::Stats { cells } => {
            let note_color = if hl {
                NSColor::whiteColor()
            } else {
                NSColor::systemOrangeColor()
            };
            let mut x = PAD;
            for (c, col) in cells.iter().zip(stat_widths(w, cells)) {
                // 格子右边留出和下一格之间的空；字只在这一格里画，放不下的截断
                let right = x + col - TEXT_GAP;
                let value = attributed(&c.value, &stat_value_font(), &label);
                draw_clipped(&value, x, 3.0, right - x);
                let lab = attributed(&c.label, &stat_label_font(), &secondary);
                draw_clipped(&lab, x, 27.0, right - x);
                if let Some(note) = &c.note {
                    let nx = x + lab.size().width + NOTE_GAP;
                    let note = attributed(note, &stat_label_font(), &note_color);
                    draw_clipped(&note, nx, 27.0, right - nx);
                }
                x += col;
            }
        }
        Info::Live {
            app,
            model,
            elapsed,
        } => {
            if let Some(img) = symbol("circle.dashed", Some(&*secondary)) {
                img.drawInRect(rect(PAD, 4.0, 16.0, 16.0));
            }
            let el = attributed(elapsed, &mono(12.0, weight(Weight::Regular)), &secondary);
            let ew = el.size().width;
            el.drawAtPoint(NSPoint::new(w - PAD - ew, 4.5));
            // 应用名和模型都在时长左边。放不下先截模型；应用名（认不出应用时是密钥名，
            // 多长都有）再长也截在时长前面
            let right = w - PAD - ew - 10.0;
            let a = attributed(app, &NSFont::menuFontOfSize(0.0), &label);
            let aw = match fit(&a, right - TEXT_X) {
                Some(a) => {
                    a.drawAtPoint(NSPoint::new(TEXT_X, 3.5));
                    a.size().width
                }
                None => 0.0,
            };
            let mx = TEXT_X + aw + 8.0;
            let m = attributed(model, &sys(12.0, weight(Weight::Regular)), &secondary);
            draw_clipped(&m, mx, 4.5, right - mx);
        }
    }
}

/// 画一段字，**放不下就截断**：自定义行不会自己换行，超出的部分会画到别的格子上
fn draw_clipped(s: &NSAttributedString, x: f64, y: f64, max_w: f64) {
    if let Some(s) = fit(s, max_w) {
        s.drawAtPoint(NSPoint::new(x, y));
    }
}

/// 列宽是「字宽 + 空」再减去空算回来的，和量出来的字宽之间差一点浮点误差。这点差不算
/// 放不下 —— 否则正好放得下的字会被截成「4 fai…」
const FIT_SLACK: f64 = 0.001;

/// 放得下就是它本身；放不下就从尾巴上去字、末尾加「…」，直到放得下。一个字都放不下
/// 是 None。**要右对齐的先拿它，再按它的宽定位置**
fn fit(s: &NSAttributedString, max_w: f64) -> Option<Retained<NSAttributedString>> {
    if max_w <= 0.0 {
        return None;
    }
    if s.size().width <= max_w + FIT_SLACK {
        return Some(s.retain());
    }
    let text = s.string().to_string();
    // SAFETY: 第 0 个字符一定在（上面已经量过它比 max_w 宽），不要范围就传空指针
    let attrs = unsafe { s.attributesAtIndex_effectiveRange(0, std::ptr::null_mut()) };
    let mut chars: Vec<char> = text.chars().collect();
    while !chars.is_empty() {
        chars.pop();
        let candidate: String = chars.iter().collect::<String>() + "…";
        let a = unsafe {
            NSAttributedString::initWithString_attributes(
                NSAttributedString::alloc(),
                &NSString::from_str(&candidate),
                Some(&attrs),
            )
        };
        if a.size().width <= max_w + FIT_SLACK {
            return Some(a);
        }
    }
    None
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
            // **菜单跟菜单栏的深浅走**，不跟应用内选的外观 —— 和系统其他菜单栏菜单一样
            let mtm = MainThreadMarker::from(self);
            let bar = UI.with(|ui| ui.borrow().as_ref().and_then(|ui| ui.item.button(mtm)));
            if let Some(button) = bar {
                menu.setAppearance(Some(&button.effectiveAppearance()));
            }
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

/// 此刻菜单里有什么，一行一项，子菜单缩进、勾选的打 ✓、分隔线写成 `---`。
/// **给预览程序用**（`menubar_preview -- --dump`）：没有屏幕录制权限时，核对原生菜单
/// 真长什么样只能靠它
pub fn describe_menu() -> Vec<String> {
    fn walk(menu: &NSMenu, depth: usize, out: &mut Vec<String>) {
        for i in 0..menu.numberOfItems() {
            let Some(item) = menu.itemAtIndex(i) else {
                continue;
            };
            let pad = "  ".repeat(depth);
            if item.isSeparatorItem() {
                out.push(format!("{pad}---"));
                continue;
            }
            let title = item
                .attributedTitle()
                .map(|t| t.string().to_string())
                .unwrap_or_else(|| item.title().to_string());
            let check = if item.state() == NSControlStateValueOn {
                "✓ "
            } else {
                ""
            };
            let title = if title.is_empty() && item.view().is_some() {
                "[自绘]".to_string()
            } else {
                title
            };
            out.push(format!("{pad}{check}{title}"));
            if let Some(sub) = item.submenu() {
                walk(&sub, depth + 1, out);
            }
        }
    }
    UI.with(|ui| {
        let mut out = Vec::new();
        if let Some(ui) = ui.borrow().as_ref() {
            walk(&ui.menu, 0, &mut out);
        }
        out
    })
}

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

// ------------------------------------------------------------------ 开发用：离屏预览

/// 开发用：把菜单栏那一块和整份菜单离屏画成一张图，用来看样子
/// （`examples/menubar_preview.rs`）。**标准菜单项画的是近似的样子** —— 真的由
/// AppKit 画；自定义的几行和菜单栏那一块是真的。
pub fn preview_image(bar: &Bar, rows: &[Row], dark: bool) -> Retained<NSImage> {
    use objc2_app_kit::{
        NSAffineTransformNSAppKitAdditions, NSAppearance, NSAppearanceNameAqua,
        NSAppearanceNameDarkAqua, NSGraphicsContext,
    };
    use objc2_foundation::NSAffineTransform;

    let quota = quota_text(rows);
    let heights: Vec<f64> = rows
        .iter()
        .map(|r| match r {
            Row::Separator => 11.0,
            Row::Item(_) => 24.0,
            other => info_height(&info_of(other, quota)),
        })
        .collect();
    let bar_img = bar_image(bar);
    let bar_h = thickness() + 8.0;
    let total = bar_h + 10.0 + heights.iter().sum::<f64>() + 10.0;
    let width = MENU_WIDTH + 24.0;
    let rows = rows.to_vec();
    let block = RcBlock::new(move |_r: NSRect| -> Bool {
        let name = unsafe {
            if dark {
                NSAppearanceNameDarkAqua
            } else {
                NSAppearanceNameAqua
            }
        };
        let Some(appearance) = NSAppearance::appearanceNamed(name) else {
            return Bool::NO;
        };
        let rows = rows.clone();
        let heights = heights.clone();
        let bar_img = bar_img.clone();
        let draw = RcBlock::new(move || {
            // 桌面和菜单栏
            let desk = if dark {
                (0.11, 0.12, 0.16)
            } else {
                (0.86, 0.89, 0.94)
            };
            NSColor::colorWithSRGBRed_green_blue_alpha(desk.0, desk.1, desk.2, 1.0).setFill();
            NSBezierPath::fillRect(rect(0.0, 0.0, width, total));
            let sz = bar_img.size();
            let at = rect(width - 12.0 - sz.width, 4.0, sz.width, sz.height);
            if bar_img.isTemplate() {
                // 模板图在真菜单栏上由系统着色：这里照样染一遍，深色菜单栏上是白字
                let src = bar_img.clone();
                let paint = RcBlock::new(move |r: NSRect| -> Bool {
                    src.drawInRect(r);
                    let tint = if dark {
                        NSColor::whiteColor()
                    } else {
                        NSColor::blackColor()
                    };
                    tint.setFill();
                    objc2_app_kit::NSRectFillUsingOperation(
                        r,
                        objc2_app_kit::NSCompositingOperation::SourceAtop,
                    );
                    Bool::YES
                });
                NSImage::imageWithSize_flipped_drawingHandler(sz, true, &paint).drawInRect(at);
            } else {
                bar_img.drawInRect(at);
            }
            // 菜单的底
            let menu_bg = if dark {
                (0.17, 0.17, 0.19)
            } else {
                (0.96, 0.96, 0.97)
            };
            NSColor::colorWithSRGBRed_green_blue_alpha(menu_bg.0, menu_bg.1, menu_bg.2, 1.0)
                .setFill();
            NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(
                rect(12.0, bar_h, MENU_WIDTH, total - bar_h - 4.0),
                12.0,
                12.0,
            )
            .fill();
            let mut y = bar_h + 6.0;
            for (row, h) in rows.iter().zip(heights.iter()) {
                let Some(ctx) = NSGraphicsContext::currentContext() else {
                    return;
                };
                ctx.saveGraphicsState();
                let t = NSAffineTransform::transform();
                t.translateXBy_yBy(12.0, y);
                t.concat();
                let r = rect(0.0, 0.0, MENU_WIDTH, *h);
                match row {
                    Row::Separator => {
                        NSColor::separatorColor().setFill();
                        NSBezierPath::fillRect(rect(PAD, 5.0, MENU_WIDTH - PAD * 2.0, 1.0));
                    }
                    Row::Item(i) => preview_item(i, r),
                    other => draw_info(&info_of(other, quota), r, false),
                }
                ctx.restoreGraphicsState();
                y += h;
            }
        });
        appearance.performAsCurrentDrawingAppearance(&draw);
        Bool::YES
    });
    NSImage::imageWithSize_flipped_drawingHandler(NSSize::new(width, total), true, &block)
}

/// 标准菜单项的近似样子：图标、标题、右边的淡色字或快捷键
fn preview_item(i: &super::model::Item, b: NSRect) {
    let color = if i.enabled {
        NSColor::labelColor()
    } else {
        NSColor::tertiaryLabelColor()
    };
    if let Some(icon) = i.icon.filter(|s| !s.is_empty())
        && let Some(img) = symbol(
            icon,
            Some(&*if i.accent {
                NSColor::controlAccentColor()
            } else {
                color.clone()
            }),
        )
    {
        img.drawInRect(rect(PAD, 4.0, 16.0, 16.0));
    }
    let font = NSFont::menuFontOfSize(0.0);
    attributed(&i.title, &font, &color).drawAtPoint(NSPoint::new(TEXT_X, 3.0));
    let right = i
        .key
        .map(|k| format!("⌘{}", k.to_uppercase()))
        .or_else(|| i.right.clone())
        .or_else(|| (!i.submenu.is_empty()).then(|| "›".to_string()));
    if let Some(r) = right {
        let a = attributed(&r, &font, &NSColor::secondaryLabelColor());
        a.drawAtPoint(NSPoint::new(b.size.width - PAD - a.size().width, 3.0));
    }
}

/// 开发用：把一张图写成 PNG
pub fn write_png(image: &NSImage, path: &std::path::Path) -> bool {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    // 按 2 倍画，和 Retina 上看到的一样
    let size = image.size();
    let mut proposed = rect(0.0, 0.0, size.width * 2.0, size.height * 2.0);
    let Some(cg) =
        (unsafe { image.CGImageForProposedRect_context_hints(&mut proposed, None, None) })
    else {
        return false;
    };
    let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg);
    let props = NSDictionary::new();
    let Some(data) =
        (unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &props) })
    else {
        return false;
    };
    std::fs::write(path, data.to_vec()).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::{Lang, with_lang};
    use crate::menubar::model::{self, Gateway, Quota, Snapshot, StatCell, Today, Window};

    /// 量字的几条测试一条一条来：AppKit 排字不必经得起几个线程同时量
    static APPKIT: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// 一条挂了不连累别的：锁被挂掉的那条带走了也照样拿
    fn appkit() -> std::sync::MutexGuard<'static, ()> {
        APPKIT.lock().unwrap_or_else(|e| e.into_inner())
    }

    const NOW: u64 = 1_800_000_000_000;
    const MIN: u64 = 60_000;
    const DAY: u64 = 86_400_000;

    /// 截图里那一份菜单：ChatGPT 两个窗口，今天有几次失败
    fn menu(lang: Lang, failed: i64) -> Vec<Row> {
        let window = |name: &str, used: f64, in_ms: u64| Window {
            window: name.into(),
            used_percent: used,
            resets_at_ms: Some(NOW + in_ms),
            status: None,
        };
        let s = Snapshot {
            gateway: Gateway::Running,
            today: Some(Today {
                requests: 244,
                failed,
                tokens: 4_200_000,
                cost_micros: 40_260_000,
            }),
            quotas: vec![Quota {
                provider: "chatgpt".into(),
                windows: vec![
                    window("5h", 58.0, 42 * MIN),
                    window("weekly", 31.0, 3 * DAY),
                ],
                reset_credits: None,
            }],
            now_ms: NOW,
            ..Default::default()
        };
        with_lang(lang, || model::build(&s, model::Style::Full).1)
    }

    fn windows(rows: &[Row]) -> Vec<WindowRow> {
        rows.iter()
            .flat_map(|r| match r {
                Row::Quota { windows, .. } => windows.clone(),
                _ => Vec::new(),
            })
            .collect()
    }

    fn cells(rows: &[Row]) -> Vec<StatCell> {
        rows.iter()
            .find_map(|r| match r {
                Row::Stats { cells, .. } => Some(cells.clone()),
                _ => None,
            })
            .expect("今日那一格不见了")
    }

    #[test]
    fn chinese_quota_rows_keep_the_columns_they_always_had() {
        let _appkit = appkit();
        let cols = quota_cols(MENU_WIDTH, quota_text(&menu(Lang::Zh, 0)));
        assert_eq!(
            cols,
            QuotaCols {
                label: 50.0,
                bar_x: 64.0,
                bar_w: 90.0,
                pct_right: 202.0,
                reset: 92.0,
            }
        );
    }

    /// 英文的「Resets in 3 days」比写死的 92 宽：曾经压在「31%」上，画成「31%Resets in 3 days」
    #[test]
    fn english_reset_times_leave_room_after_the_percentage() {
        let _appkit = appkit();
        let rows = menu(Lang::En, 0);
        let all = windows(&rows);
        assert!(all.iter().any(|w| w.reset == "Resets in 3 days"), "{all:?}");
        let cols = quota_cols(MENU_WIDTH, quota_text(&rows));
        assert!(cols.bar_w >= QUOTA_MIN_BAR, "{cols:?}");
        for w in &all {
            let reset_left = MENU_WIDTH - PAD - text_width(&w.reset, &quota_reset_font());
            assert!(
                reset_left - cols.pct_right >= TEXT_GAP - 1e-9,
                "「{}」离百分比只有 {:.1}",
                w.reset,
                reset_left - cols.pct_right
            );
            let label_right = PAD + text_width(&w.label, &quota_label_font());
            assert!(label_right + LABEL_GAP <= cols.bar_x + 1e-9, "{w:?}");
        }
    }

    /// 英文的「Requests 4 failed」比三等分的一格宽：曾经画成「Requests 4 failedTokens」
    #[test]
    fn the_failed_count_stays_inside_its_own_cell() {
        let _appkit = appkit();
        let avail = MENU_WIDTH - PAD * 2.0;
        for lang in [Lang::Zh, Lang::En] {
            let cells = cells(&menu(lang, 4));
            assert!(cells[0].note.is_some());
            let widths = stat_widths(MENU_WIDTH, &cells);
            assert!(
                (widths.iter().sum::<f64>() - avail).abs() < 1e-9,
                "{widths:?}"
            );
            for (c, w) in cells.iter().zip(&widths) {
                let line2 = text_width(&c.label, &stat_label_font())
                    + c.note
                        .as_deref()
                        .map_or(0.0, |n| NOTE_GAP + text_width(n, &stat_label_font()));
                let value = text_width(&c.value, &stat_value_font());
                assert!(
                    line2.max(value) + TEXT_GAP <= w + 1e-9,
                    "{lang:?} {c:?} 放不进 {w:.1}"
                );
            }
        }
        // 中文照旧三等分
        let zh = stat_widths(MENU_WIDTH, &cells(&menu(Lang::Zh, 4)));
        assert!(zh.iter().all(|w| (w - avail / 3.0).abs() < 1e-9), "{zh:?}");
    }

    #[test]
    fn columns_are_equal_until_one_cell_needs_more() {
        assert_eq!(share_columns(300.0, &[50.0, 60.0, 70.0]), [100.0; 3]);
        // 多要的那一格照它要的给，其余平分剩下的
        assert_eq!(
            share_columns(300.0, &[150.0, 60.0, 70.0]),
            [150.0, 75.0, 75.0]
        );
        // 平分之后又有一格不够：它也照要的给
        assert_eq!(
            share_columns(300.0, &[150.0, 60.0, 85.0]),
            [150.0, 65.0, 85.0]
        );
        // 怎么分都放不下：按比例
        assert_eq!(share_columns(100.0, &[100.0, 100.0]), [50.0, 50.0]);
        assert!(share_columns(100.0, &[]).is_empty());
    }

    #[test]
    fn text_that_does_not_fit_is_cut_with_an_ellipsis() {
        let _appkit = appkit();
        let s = attributed(
            "Resets in 3 days",
            &quota_reset_font(),
            &NSColor::labelColor(),
        );
        let whole = fit(&s, 1000.0).unwrap();
        assert_eq!(whole.string().to_string(), "Resets in 3 days");
        // 列宽差一点浮点误差，照样算放得下
        let exact = fit(&s, s.size().width - 1e-9).unwrap();
        assert_eq!(exact.string().to_string(), "Resets in 3 days");
        let cut = fit(&s, 50.0).unwrap();
        assert!(cut.string().to_string().ends_with('…'), "{}", cut.string());
        assert!(cut.size().width <= 50.0);
        assert!(fit(&s, 0.0).is_none());
    }
}
