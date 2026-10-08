//! 菜单里自己画的那几行：网关不在运行时的状态、「今日」那一块、额度、小节标题、提醒、在跑
//! 的请求。标准菜单项由 AppKit 画（见上一层），这几行 AppKit 画不出来。
//!
//! 量字和画字的小工具在上一层，菜单栏那一块也用。

use std::cell::{Cell, RefCell};

use objc2::rc::Retained;
use objc2::{
    AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, Message, define_class, msg_send,
};
use objc2_app_kit::{
    NSAttributedStringNSExtendedStringDrawing, NSAttributedStringNSStringDrawing,
    NSAutoresizingMaskOptions, NSBezierPath, NSColor, NSEvent, NSFont, NSStringDrawingOptions,
    NSView,
};
use objc2_foundation::{
    NSAttributedString, NSMutableAttributedString, NSPoint, NSRect, NSSize, NSString,
};

use super::{
    MENU_WIDTH, PAD, TEXT_X, Weight, attributed, dispatch, fill_oval, mono, rect, symbol, sys,
    weight,
};
use crate::menubar::model::{Dash, Level, Row, Spark, StateTone, Tone, WindowRow};

// ------------------------------------------------------------------ 自定义的几行

/// 这一行要多宽。**菜单按最宽的那一项撑开**：「今日」那一块左边的字整段放下、右边的柱子
/// 照设计稿的粗细画，要的比菜单的最小宽度多（英文的「128 requests · 2 failed · $3.47」）
/// 时，就让菜单宽一点，最多到 [`MAX_WIDTH`]。别的行跟着菜单走
pub(super) fn row_width(row: &Row) -> f64 {
    match row {
        Row::Today(d) => {
            let spark = d
                .spark
                .as_ref()
                .map_or(0.0, |b| SPARK_FULL.width(b.len()) + SPARK_GAP);
            (PAD * 2.0 + today_text(d).0 + spark)
                .ceil()
                .clamp(MENU_WIDTH, MAX_WIDTH)
        }
        _ => MENU_WIDTH,
    }
}

/// 这一行有多高。**按菜单的最小宽度量**：菜单被别的项撑宽时，折行的字只会更少，底下多出
/// 一点空，不会压到下一行
pub(super) fn row_height(row: &Row) -> f64 {
    let w = MENU_WIDTH;
    match row {
        Row::Status { reason, .. } => {
            STATUS_ROW
                + reason.as_deref().map_or(0.0, |r| {
                    wrapped_height(r, &reason_font(), w - TEXT_X - PAD) + REASON_GAP
                })
                + STATUS_BOTTOM
        }
        Row::Today(d) => match d.warn.as_deref() {
            Some(r) => TODAY_WARN_Y + wrapped_height(r, &reason_font(), w - PAD * 2.0) + 8.0,
            None => TODAY_META_BASELINE + TODAY_BOTTOM,
        },
        Row::Section { .. } => 21.0,
        Row::Notice { .. } => 40.0,
        Row::Quota { window, .. } => {
            QUOTA_BAR_Y
                + QUOTA_BAR_H
                + window.detail.as_ref().map_or(0.0, |_| QUOTA_DETAIL)
                + QUOTA_BOTTOM
        }
        Row::Live { .. } => 24.0,
        Row::Separator | Row::Item(_) => unreachable!("标准菜单项不走自定义视图"),
    }
}

pub struct ViewIvars {
    row: RefCell<Row>,
    /// 点了做什么（`Ui::actions` 里的下标）。没有就是一行只读的
    tag: Cell<Option<isize>>,
}

define_class!(
    /// 菜单里自己画的一行
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "ThinkWatchMenuRow"]
    #[ivars = ViewIvars]
    pub(super) struct InfoView;

    impl InfoView {
        #[unsafe(method(isFlipped))]
        fn is_flipped(&self) -> bool {
            true
        }

        #[unsafe(method(drawRect:))]
        fn draw_rect(&self, _dirty: NSRect) {
            let highlighted = self.ivars().tag.get().is_some()
                && self.enclosingMenuItem().is_some_and(|i| i.isHighlighted());
            draw_row(&self.ivars().row.borrow(), self.bounds(), highlighted);
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
    pub(super) fn new(mtm: MainThreadMarker, row: Row, tag: Option<isize>) -> Retained<Self> {
        let frame = rect(0.0, 0.0, row_width(&row), row_height(&row));
        let this = Self::alloc(mtm).set_ivars(ViewIvars {
            row: RefCell::new(row),
            tag: Cell::new(tag),
        });
        let view: Retained<Self> = unsafe { msg_send![super(this), initWithFrame: frame] };
        view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable);
        view
    }

    /// 就地换上新的数据。**要的宽度变大了就跟着放宽**（「今日」那一块从破折号变成一行英文）：
    /// 高度由样子定，样子没变就不变；变窄不收，菜单不在用户眼前缩一下
    pub(super) fn set_row(&self, row: Row, tag: Option<isize>) {
        let want = row_width(&row);
        let frame = self.frame();
        if want > frame.size.width {
            self.setFrameSize(NSSize::new(want, frame.size.height));
        }
        *self.ivars().row.borrow_mut() = row;
        self.ivars().tag.set(tag);
        self.setNeedsDisplay(true);
    }
}

// ------------------------------------------------------------------ 尺寸
//
// 照着设计稿量的，换成了 AppKit 的系统字体和语义颜色。纵向的位置都按**基线**给：字号不同
// 的几段字（大字和它后面的单位）要落在同一条线上，按行顶对齐是对不齐的。

/// 同一行里两段字之间至少空这么多
const TEXT_GAP: f64 = 10.0;
/// 自画的行最多把菜单撑到这么宽。再宽就收窄柱子、截字（见 [`today_fit`]）
const MAX_WIDTH: f64 = 380.0;

/// 状态那一块：点和状态那一行，和标准菜单项一样高
const STATUS_ROW: f64 = 24.0;
/// 状态那一块：原因和上面那一行之间
const REASON_GAP: f64 = 1.0;
/// 状态那一块：最下面留的空
const STATUS_BOTTOM: f64 = 5.0;
/// 原因、监听没换成的那一行橙字最多折成几行
const REASON_LINES: f64 = 2.0;

/// 「今日」：上面那一行（「今日」和状态）的基线
const TODAY_TOP_BASELINE: f64 = 16.0;
/// 「今日」：大字的基线
const TODAY_HERO_BASELINE: f64 = 47.0;
/// 「今日」：下面那一行（次数、失败、费用）的基线。小柱子的底也落在这条线上
const TODAY_META_BASELINE: f64 = 68.0;
/// 「今日」：最下面留的空（从那一行的基线算起，含字的下沿）
const TODAY_BOTTOM: f64 = 11.0;
/// 「今日」：监听没换成的那一行橙字从这里起（行顶）
const TODAY_WARN_Y: f64 = TODAY_META_BASELINE + 6.0;
/// 「今日」：状态前面那个点
const TODAY_DOT: f64 = 6.0;
/// 「今日」：大字和单位之间
const UNIT_GAP: f64 = 5.0;
/// 「今日」：左边的字和小柱子之间至少空这么多
const SPARK_GAP: f64 = 14.0;
/// 小柱子满格多高
const SPARK_MAX_H: f64 = 26.0;
/// 有用量的那一小时至少这么高：比没有用量的短线高出一截，分得清
const SPARK_MIN_H: f64 = 3.0;
/// 没有用量、还没到的那一小时：一截短线
const SPARK_STUB_H: f64 = 2.0;

/// 额度行：上面那一行的基线
const QUOTA_BASELINE: f64 = 15.0;
/// 额度行：条的顶
const QUOTA_BAR_Y: f64 = 22.0;
/// 额度行：条有多粗
const QUOTA_BAR_H: f64 = 4.0;
/// 额度行：条下面那一行小字（还剩多少积分）再占多高
const QUOTA_DETAIL: f64 = 15.0;
/// 额度行：最下面留的空
const QUOTA_BOTTOM: f64 = 5.0;

fn reason_font() -> Retained<NSFont> {
    sys(12.0, weight(Weight::Regular))
}

fn top_font() -> Retained<NSFont> {
    sys(11.0, weight(Weight::Regular))
}

fn top_title_font() -> Retained<NSFont> {
    sys(11.0, weight(Weight::Semibold))
}

/// 等宽数字：数在涨，同位数时宽度不变
fn hero_font() -> Retained<NSFont> {
    mono(28.0, weight(Weight::Semibold))
}

fn unit_font() -> Retained<NSFont> {
    sys(13.0, weight(Weight::Regular))
}

fn meta_font() -> Retained<NSFont> {
    mono(12.0, weight(Weight::Regular))
}

fn quota_font() -> Retained<NSFont> {
    sys(12.0, weight(Weight::Regular))
}

/// 等宽数字：倒计时在走，同位数时宽度不变
fn quota_right_font() -> Retained<NSFont> {
    mono(12.0, weight(Weight::Regular))
}

/// 条下面那一行小字：比上面那一行小一号
fn quota_detail_font() -> Retained<NSFont> {
    sys(11.0, weight(Weight::Regular))
}

fn text_width(text: &str, font: &NSFont) -> f64 {
    attributed(text, font, &NSColor::labelColor()).size().width
}

/// 排出来的一行有多高。**按排字的结果量**，不拿字体的上下沿去加：系统字体排出来的行比
/// 上下沿之和高一点，按后者给的框装不下第二行，折行的字就只剩一行加「…」
fn line_height(font: &NSFont) -> f64 {
    attributed("Ag", font, &NSColor::labelColor())
        .boundingRectWithSize_options_context(
            NSSize::new(f64::MAX, f64::MAX),
            NSStringDrawingOptions::UsesLineFragmentOrigin,
            None,
        )
        .size
        .height
}

/// 一段字折行之后有多高，最多 [`REASON_LINES`] 行
fn wrapped_height(text: &str, font: &NSFont, max_w: f64) -> f64 {
    let s = attributed(text, font, &NSColor::labelColor());
    let h = s
        .boundingRectWithSize_options_context(
            NSSize::new(max_w, f64::MAX),
            NSStringDrawingOptions::UsesLineFragmentOrigin,
            None,
        )
        .size
        .height;
    h.min(line_height(font) * REASON_LINES).ceil()
}

/// 画一段会折行的字：最多 [`REASON_LINES`] 行，再多的截在最后一行末尾
fn draw_wrapped(s: &NSAttributedString, font: &NSFont, x: f64, y: f64, max_w: f64) {
    s.drawWithRect_options_context(
        rect(x, y, max_w, (line_height(font) * REASON_LINES).ceil()),
        NSStringDrawingOptions::UsesLineFragmentOrigin
            | NSStringDrawingOptions::TruncatesLastVisibleLine,
        None,
    );
}

/// 让字的基线落在 `baseline` 上
fn at_baseline(s: &NSAttributedString, font: &NSFont, x: f64, baseline: f64) {
    s.drawAtPoint(NSPoint::new(x, baseline - font.ascender()));
}

/// 几段颜色不同的字接成一段
fn joined(parts: &[(&str, &NSFont, &NSColor)]) -> Retained<NSAttributedString> {
    let out = NSMutableAttributedString::new();
    for (text, font, color) in parts {
        out.appendAttributedString(&attributed(text, font, color));
    }
    Retained::into_super(out)
}

// ------------------------------------------------------------------ 「今日」怎么排

/// 「今日」那一块左边的字要多宽：大字连单位和下面那一行里宽的那个；以及跟在那一行后面的
/// 小字（连同前面的「 · 」）
fn today_text(d: &Dash) -> (f64, Option<f64>) {
    let hero = text_width(&d.value, &hero_font()) + UNIT_GAP + text_width(&d.unit, &unit_font());
    let meta = text_width(&d.meta_line(), &meta_font());
    let note = d
        .note
        .as_deref()
        .map(|n| text_width(&format!(" · {n}"), &meta_font()));
    (hero.max(meta), note)
}

/// 小柱子的粗细。**放不下时先收窄**，再放不下才不画
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct SparkSize {
    pub bar: f64,
    pub gap: f64,
}

/// 设计稿上的粗细
pub(super) const SPARK_FULL: SparkSize = SparkSize { bar: 3.0, gap: 1.5 };
/// 地方不够时
pub(super) const SPARK_COMPACT: SparkSize = SparkSize { bar: 2.0, gap: 1.0 };

impl SparkSize {
    /// `n` 根柱子一共多宽
    pub fn width(self, n: usize) -> f64 {
        if n == 0 {
            return 0.0;
        }
        n as f64 * self.bar + (n - 1) as f64 * self.gap
    }
}

/// 「今日」那一块横着怎么排
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct TodayFit {
    /// 小柱子画多粗。None：不画
    pub spark: Option<SparkSize>,
    /// 金额缺着什么那几个字跟不跟在那一行后面
    pub note: bool,
}

/// 左边的字（大字和那一行，`text_w` 是两者里宽的那个；`note_w` 是跟在后面的小字连同前面
/// 的「 · 」）和右边的小柱子（`bars` 根）怎么在 `w` 里排开。
///
/// **左边的字不让**：费用在那一行的最后，截掉的话截的正是要看的数。先不跟小字（它在悬停
/// 提示里），再把柱子收窄，最后不画柱子；都放不下时才截字
pub(super) fn today_fit(text_w: f64, note_w: Option<f64>, bars: Option<usize>, w: f64) -> TodayFit {
    let avail = w - PAD * 2.0;
    let fits = |spark: Option<SparkSize>, note: bool| {
        let right = match (spark, bars) {
            (Some(size), Some(n)) => size.width(n) + SPARK_GAP,
            _ => 0.0,
        };
        let left = text_w + if note { note_w.unwrap_or(0.0) } else { 0.0 };
        left + right <= avail
    };
    let mut tries = Vec::new();
    if bars.is_some() {
        tries.extend([
            (Some(SPARK_FULL), true),
            (Some(SPARK_FULL), false),
            (Some(SPARK_COMPACT), false),
        ]);
    }
    tries.extend([(None, true), (None, false)]);
    tries
        .into_iter()
        .filter(|(_, note)| !*note || note_w.is_some())
        .find(|(spark, note)| fits(*spark, *note))
        .map_or(
            TodayFit {
                spark: None,
                note: false,
            },
            |(spark, note)| TodayFit { spark, note },
        )
}

/// 一根柱子多高
pub(super) fn spark_height(s: Spark) -> f64 {
    match s {
        Spark::Empty => SPARK_STUB_H,
        Spark::Past(f) | Spark::Now(f) => {
            (f.clamp(0.0, 1.0) * SPARK_MAX_H).round().max(SPARK_MIN_H)
        }
    }
}

// ------------------------------------------------------------------ 画

fn state_color(tone: StateTone) -> Retained<NSColor> {
    match tone {
        StateTone::Ok => NSColor::systemGreenColor(),
        StateTone::Busy => NSColor::systemYellowColor(),
        StateTone::Warn => NSColor::systemOrangeColor(),
        StateTone::Bad => NSColor::systemRedColor(),
    }
}

/// 一行里的几种字色。高亮时一律白字：底色是强调色
struct Ink {
    label: Retained<NSColor>,
    secondary: Retained<NSColor>,
    /// 分隔用的「·」，比次要的字再淡一档
    tertiary: Retained<NSColor>,
    hl: bool,
}

impl Ink {
    fn new(hl: bool) -> Self {
        if hl {
            let white = NSColor::whiteColor();
            Self {
                secondary: white.colorWithAlphaComponent(0.8),
                tertiary: white.colorWithAlphaComponent(0.6),
                label: white,
                hl,
            }
        } else {
            Self {
                label: NSColor::labelColor(),
                secondary: NSColor::secondaryLabelColor(),
                tertiary: NSColor::tertiaryLabelColor(),
                hl,
            }
        }
    }

    /// 要紧的颜色（失败的红、要处理的橙）。高亮时也是白的
    fn alert(&self, color: Retained<NSColor>) -> Retained<NSColor> {
        if self.hl { self.label.clone() } else { color }
    }
}

pub(super) fn draw_row(row: &Row, b: NSRect, hl: bool) {
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
    let ink = Ink::new(hl);
    match row {
        Row::Status {
            state,
            tone,
            server,
            reason,
        } => draw_status(state, *tone, server.as_deref(), reason.as_deref(), w, &ink),
        Row::Today(d) => draw_today(d, w, &ink),
        Row::Section { title, right } => {
            let font = sys(11.0, weight(Weight::Semibold));
            attributed(title, &font, &ink.secondary).drawAtPoint(NSPoint::new(PAD, 4.0));
            if let Some(r) = right {
                let a = attributed(r, &font, &ink.secondary);
                a.drawAtPoint(NSPoint::new(w - PAD - a.size().width, 4.0));
            }
        }
        Row::Notice {
            level, title, body, ..
        } => {
            let (name, color) = match level {
                Level::Critical => ("xmark.octagon.fill", NSColor::systemRedColor()),
                Level::Warning => (
                    "exclamationmark.triangle.fill",
                    NSColor::systemOrangeColor(),
                ),
                Level::Info => ("info.circle.fill", NSColor::systemBlueColor()),
            };
            if let Some(img) = symbol(name, Some(&ink.alert(color))) {
                img.drawInRect(rect(PAD, 5.0, 16.0, 16.0));
            }
            let t = attributed(title, &NSFont::menuFontOfSize(0.0), &ink.label);
            draw_clipped(&t, TEXT_X, 3.0, w - TEXT_X - PAD);
            let bd = attributed(body, &sys(11.5, weight(Weight::Regular)), &ink.secondary);
            draw_clipped(&bd, TEXT_X, 21.0, w - TEXT_X - PAD);
        }
        Row::Quota {
            provider, window, ..
        } => draw_quota(provider, window, w, &ink),
        Row::Live {
            app,
            model,
            elapsed,
            ..
        } => {
            if let Some(img) = symbol("circle.dashed", Some(&*ink.secondary)) {
                img.drawInRect(rect(PAD, 4.0, 16.0, 16.0));
            }
            let el = attributed(
                elapsed,
                &mono(12.0, weight(Weight::Regular)),
                &ink.secondary,
            );
            let ew = el.size().width;
            el.drawAtPoint(NSPoint::new(w - PAD - ew, 4.5));
            // 应用名和模型都在时长左边。放不下先截模型；应用名（认不出应用时是密钥名，
            // 多长都有）再长也截在时长前面
            let right = w - PAD - ew - 10.0;
            let a = attributed(app, &NSFont::menuFontOfSize(0.0), &ink.label);
            let aw = match fit(&a, right - TEXT_X) {
                Some(a) => {
                    a.drawAtPoint(NSPoint::new(TEXT_X, 3.5));
                    a.size().width
                }
                None => 0.0,
            };
            let mx = TEXT_X + aw + 8.0;
            let m = attributed(model, &sys(12.0, weight(Weight::Regular)), &ink.secondary);
            draw_clipped(&m, mx, 4.5, right - mx);
        }
        Row::Separator | Row::Item(_) => {}
    }
}

/// 网关不在运行：点在图标那一列，状态和标准菜单项的字对齐，服务器的名字在右边；下面是原因
fn draw_status(
    state: &str,
    tone: StateTone,
    server: Option<&str>,
    reason: Option<&str>,
    w: f64,
    ink: &Ink,
) {
    fill_oval(PAD + 4.0, 8.0, 8.0, &state_color(tone));
    let menu = NSFont::menuFontOfSize(0.0);
    let right = server.map_or(0.0, |name| {
        let a = attributed(name, &menu, &ink.secondary);
        // 名字多长都有：最多占一半，截断
        match fit(&a, (w - TEXT_X - PAD) / 2.0) {
            Some(a) => {
                let aw = a.size().width;
                a.drawAtPoint(NSPoint::new(w - PAD - aw, 3.5));
                aw + TEXT_GAP
            }
            None => 0.0,
        }
    });
    let st = attributed(state, &menu, &ink.label);
    draw_clipped(&st, TEXT_X, 3.5, w - TEXT_X - PAD - right);
    if let Some(reason) = reason {
        let font = reason_font();
        let r = attributed(reason, &font, &ink.alert(NSColor::systemOrangeColor()));
        draw_wrapped(
            &r,
            &font,
            TEXT_X,
            STATUS_ROW + REASON_GAP - 3.0,
            w - TEXT_X - PAD,
        );
    }
}

fn draw_today(d: &Dash, w: f64, ink: &Ink) {
    // 上面一行：左边「今日」，右边点和状态。状态太长时截服务器的名字：状态和速率要留着
    let (title_font, top) = (top_title_font(), top_font());
    let title = attributed(&d.title, &title_font, &ink.secondary);
    at_baseline(&title, &title_font, PAD, TODAY_TOP_BASELINE);
    let room = w - PAD * 2.0 - title.size().width - TEXT_GAP - TODAY_DOT - 5.0;
    let line = state_text_fitting(d, &top, room);
    let st = attributed(&line, &top, &ink.secondary);
    let st = fit(&st, room).unwrap_or(st);
    let sw = st.size().width;
    at_baseline(&st, &top, w - PAD - sw, TODAY_TOP_BASELINE);
    let dot_y = TODAY_TOP_BASELINE - top.capHeight() / 2.0 - TODAY_DOT / 2.0;
    fill_oval(
        w - PAD - sw - 5.0 - TODAY_DOT,
        dot_y,
        TODAY_DOT,
        &state_color(d.tone),
    );

    // 大字和单位，基线对齐
    let (hero_font, unit_font, meta_font) = (hero_font(), unit_font(), meta_font());
    let hero = attributed(&d.value, &hero_font, &ink.label);
    let unit = attributed(&d.unit, &unit_font, &ink.secondary);

    // 下面那一行：几段用「 · 」连起来，失败数是红的
    let sep = " · ";
    let mut parts: Vec<(&str, Retained<NSColor>)> = Vec::new();
    for (i, m) in d.meta.iter().enumerate() {
        if i > 0 {
            parts.push((sep, ink.tertiary.clone()));
        }
        let color = if m.failed {
            ink.alert(NSColor::systemRedColor())
        } else {
            ink.secondary.clone()
        };
        parts.push((&m.text, color));
    }
    let meta = joined(
        &parts
            .iter()
            .map(|(t, c)| (*t, &*meta_font, &**c))
            .collect::<Vec<_>>(),
    );
    let note = d.note.as_deref().map(|n| {
        joined(&[
            (sep, &meta_font, &ink.tertiary),
            (n, &meta_font, &ink.alert(NSColor::systemOrangeColor())),
        ])
    });
    // 和 `row_width` 量的是同一份：菜单为它撑开多少，这里就按多少排
    let (text_w, note_w) = today_text(d);
    let layout = today_fit(text_w, note_w, d.spark.as_ref().map(Vec::len), w);

    let spark_w = match (layout.spark, &d.spark) {
        (Some(size), Some(bars)) => {
            draw_spark(bars, size, w - PAD, TODAY_META_BASELINE, ink);
            size.width(bars.len()) + SPARK_GAP
        }
        _ => 0.0,
    };
    let left_w = w - PAD * 2.0 - spark_w;
    at_baseline(&hero, &hero_font, PAD, TODAY_HERO_BASELINE);
    at_baseline(
        &unit,
        &unit_font,
        PAD + hero.size().width + UNIT_GAP,
        TODAY_HERO_BASELINE,
    );
    let meta = fit(&meta, left_w).unwrap_or(meta);
    at_baseline(&meta, &meta_font, PAD, TODAY_META_BASELINE);
    if let (true, Some(note)) = (layout.note, note) {
        at_baseline(
            &note,
            &meta_font,
            PAD + meta.size().width,
            TODAY_META_BASELINE,
        );
    }

    // 监听设置没换成：最后一行橙字
    if let Some(warn) = &d.warn {
        let font = reason_font();
        let r = attributed(warn, &font, &ink.alert(NSColor::systemOrangeColor()));
        draw_wrapped(&r, &font, PAD, TODAY_WARN_Y, w - PAD * 2.0);
    }
}

/// 右上角那一句放得下的写法：放不下先把服务器的名字截短，状态和速率留着
fn state_text_fitting(d: &Dash, font: &NSFont, room: f64) -> String {
    let full = d.state_line();
    let Some(server) = &d.server else {
        return full;
    };
    if text_width(&full, font) <= room {
        return full;
    }
    let without = Dash {
        server: None,
        ..d.clone()
    }
    .state_line();
    // 名字那一段能占的宽：去掉名字之后剩下的，再去掉它前后的「 · 」
    let name_room = room - text_width(&without, font) - text_width(" · ", font);
    let name = attributed(server, font, &NSColor::labelColor());
    match fit(&name, name_room) {
        Some(cut) => Dash {
            server: Some(cut.string().to_string()),
            ..d.clone()
        }
        .state_line(),
        None => without,
    }
}

/// 小柱子：右边缘对齐到 `right`，底落在 `baseline` 上
fn draw_spark(bars: &[Spark], size: SparkSize, right: f64, baseline: f64, ink: &Ink) {
    // **`colorWithAlphaComponent` 是换掉透明度，不是乘上去**：系统的语义色本身就带着
    // 透明度（深色下次要的字是白色 55%），这里给的就是画出来的透明度
    let (past, now, empty) = if ink.hl {
        let white = NSColor::whiteColor();
        (
            white.colorWithAlphaComponent(0.55),
            white.clone(),
            white.colorWithAlphaComponent(0.25),
        )
    } else {
        (
            NSColor::secondaryLabelColor().colorWithAlphaComponent(0.34),
            NSColor::labelColor(),
            NSColor::quaternaryLabelColor(),
        )
    };
    let mut x = right - size.width(bars.len());
    for b in bars {
        let h = spark_height(*b);
        let color = match b {
            Spark::Empty => &empty,
            Spark::Past(_) => &past,
            Spark::Now(_) => &now,
        };
        color.setFill();
        let r = (size.bar / 3.0).min(1.0);
        NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(
            rect(x, baseline - h, size.bar, h),
            r,
            r,
        )
        .fill();
        x += size.bar + size.gap;
    }
}

/// 一个额度窗口：上面一行左边「ChatGPT · 每周」，右边「31% · 4 天后重置」；下面一根通栏的条
fn draw_quota(provider: &str, wr: &WindowRow, w: f64, ink: &Ink) {
    let (font, right_font) = (quota_font(), quota_right_font());
    let tone = match wr.tone {
        Tone::Normal => ink.label.clone(),
        Tone::Warn => ink.alert(NSColor::systemOrangeColor()),
        Tone::Full => ink.alert(NSColor::systemRedColor()),
    };
    // 右边：百分比是主色（紧张、用完时变色），重置时刻是次要的
    let right = match wr.percent {
        Some(p) => {
            let pct = format!("{}%", p.round() as i64);
            let rest = wr.right()[pct.len()..].to_string();
            joined(&[
                (&pct, &right_font, &tone),
                (&rest, &right_font, &ink.secondary),
            ])
        }
        None => attributed(&wr.reset, &right_font, &ink.secondary),
    };
    let rw = right.size().width;
    at_baseline(&right, &right_font, w - PAD - rw, QUOTA_BASELINE);
    // 左边：上游的名字多长都有，放不下截它，窗口名留着
    let label = attributed(&format!(" · {}", wr.label), &font, &ink.secondary);
    let lw = label.size().width;
    let name = attributed(provider, &font, &ink.label);
    let name_room = w - PAD * 2.0 - rw - TEXT_GAP - lw;
    let nw = match fit(&name, name_room) {
        Some(n) => {
            at_baseline(&n, &font, PAD, QUOTA_BASELINE);
            n.size().width
        }
        None => 0.0,
    };
    if let Some(label) = fit(&label, w - PAD * 2.0 - rw - TEXT_GAP - nw) {
        at_baseline(&label, &font, PAD + nw, QUOTA_BASELINE);
    }
    // 通栏的条
    let bar_w = w - PAD * 2.0;
    let track = if ink.hl {
        NSColor::whiteColor().colorWithAlphaComponent(0.3)
    } else {
        NSColor::quaternaryLabelColor()
    };
    let radius = QUOTA_BAR_H / 2.0;
    track.setFill();
    NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(
        rect(PAD, QUOTA_BAR_Y, bar_w, QUOTA_BAR_H),
        radius,
        radius,
    )
    .fill();
    if let Some(p) = wr.percent {
        let fw = (bar_w * p / 100.0).max(if p > 0.0 { QUOTA_BAR_H } else { 0.0 });
        if fw > 0.0 {
            tone.setFill();
            NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(
                rect(PAD, QUOTA_BAR_Y, fw, QUOTA_BAR_H),
                radius,
                radius,
            )
            .fill();
        }
    }
    // 还剩多少：贴在条的正下方
    if let Some(detail) = &wr.detail {
        let d = attributed(detail, &quota_detail_font(), &ink.secondary);
        draw_clipped(&d, PAD, QUOTA_BAR_Y + QUOTA_BAR_H + 2.0, bar_w);
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

/// 放得下就是它本身；放不下就从尾巴上去字、末尾加「…」，留下放得下的最多的字。连一个
/// 「…」都放不下是 None。**要右对齐的先拿它，再按它的宽定位置**
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
    let chars: Vec<char> = text.chars().collect();
    // 留前 n 个字再接「…」
    let cut = |n: usize| {
        let candidate: String = chars[..n].iter().collect::<String>() + "…";
        unsafe {
            NSAttributedString::initWithString_attributes(
                NSAttributedString::alloc(),
                &NSString::from_str(&candidate),
                Some(&attrs),
            )
        }
    };
    let fits = |a: &NSAttributedString| a.size().width <= max_w + FIT_SLACK;
    // 留的字越多越宽，所以**二分找放得下的最多的那个 n**。一个字一个字地往回退、每退
    // 一个量一次，长的服务器名、提醒正文要在主线程上量上百次，菜单开着时每秒一遍。
    // 整段放不下，所以至多留 len - 1 个字
    let mut best = cut(0);
    if !fits(&best) {
        return None;
    }
    let (mut lo, mut hi) = (0, chars.len().saturating_sub(1));
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        let a = cut(mid);
        if fits(&a) {
            (lo, best) = (mid, a);
        } else {
            hi = mid - 1;
        }
    }
    Some(best)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::{Lang, with_lang};
    use crate::menubar::model::{self, Gateway, Hourly, Snapshot, Today};

    /// 量字的几条测试一条一条来：AppKit 排字不必经得起几个线程同时量
    static APPKIT: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// 一条挂了不连累别的：锁被挂掉的那条带走了也照样拿
    fn appkit() -> std::sync::MutexGuard<'static, ()> {
        APPKIT.lock().unwrap_or_else(|e| e.into_inner())
    }

    const NOW: u64 = 1_800_000_000_000;

    /// 截图里那一份菜单的「今日」：128 次、失败几次、$3.47，有每小时的柱子
    fn today(lang: Lang, t: Today) -> Dash {
        let s = Snapshot {
            gateway: Gateway::Running,
            today: Some(t),
            hourly: Some(Hourly {
                from_ms: NOW as i64 - 21 * model::HOUR_MS,
                tokens: (0..24).map(|h| h * 10_000).collect(),
            }),
            rate: Some(42),
            now_ms: NOW,
            ..Default::default()
        };
        with_lang(lang, || {
            model::build(&s, model::Style::Full)
                .1
                .into_iter()
                .find_map(|r| match r {
                    Row::Today(d) => Some(*d),
                    _ => None,
                })
                .expect("「今日」那一块不见了")
        })
    }

    fn busy() -> Today {
        Today {
            requests: 128,
            failed: 2,
            tokens: 1_240_000,
            cost_micros: 3_470_000,
            ..Default::default()
        }
    }

    /// 设计稿那一份：中文在菜单的最小宽度里就放得下；英文的那一行长，菜单宽一点。两种都是
    /// 左边的字整段放下、柱子照设计稿的粗细画
    #[test]
    fn the_busy_day_fits_beside_a_full_sparkline_in_both_languages() {
        let _appkit = appkit();
        for lang in [Lang::Zh, Lang::En] {
            let d = today(lang, busy());
            let w = row_width(&Row::Today(Box::new(d.clone())));
            let (text, note) = today_text(&d);
            let fit = today_fit(text, note, d.spark.as_ref().map(Vec::len), w);
            assert_eq!(
                fit,
                TodayFit {
                    spark: Some(SPARK_FULL),
                    note: false
                },
                "{lang:?} {} 宽 {w}",
                d.meta_line()
            );
            if lang == Lang::Zh {
                assert_eq!(w, MENU_WIDTH, "中文不用撑宽菜单");
            } else {
                assert!(w > MENU_WIDTH && w < MENU_WIDTH + 30.0, "{w}");
            }
        }
        // 别的行跟着菜单走
        let section = Row::Section {
            title: "提醒".into(),
            right: None,
        };
        assert_eq!(row_width(&section), MENU_WIDTH);
    }

    /// **费用不截**：那一行很长时（英文、上千次、上百刀），先把柱子收窄，再不画柱子
    #[test]
    fn a_long_line_narrows_the_sparkline_before_cutting_the_cost() {
        let _appkit = appkit();
        let d = today(
            Lang::En,
            Today {
                requests: 12_345,
                failed: 1_234,
                tokens: 999_000_000,
                cost_micros: 123_456_000,
                unpriced: 3,
                ..Default::default()
            },
        );
        let (text, note) = today_text(&d);
        let w = row_width(&Row::Today(Box::new(d.clone())));
        assert_eq!(w, MAX_WIDTH, "撑到头了");
        let fit = today_fit(text, note, Some(24), w);
        assert!(!fit.note, "放不下的小字该进悬停提示");
        assert_ne!(fit.spark, Some(SPARK_FULL), "{}", d.meta_line());
        let spark = fit.spark.map_or(0.0, |s| s.width(24) + SPARK_GAP);
        assert!(text + spark <= w - PAD * 2.0, "{}", d.meta_line());
    }

    #[test]
    fn the_layout_gives_way_in_order() {
        let avail = MENU_WIDTH - PAD * 2.0;
        let full = SPARK_FULL.width(24) + SPARK_GAP;
        let compact = SPARK_COMPACT.width(24) + SPARK_GAP;
        let fit = |text: f64, note: Option<f64>, bars: Option<usize>| {
            today_fit(text, note, bars, MENU_WIDTH)
        };
        let at = |spark, note| TodayFit { spark, note };
        assert_eq!(fit(100.0, Some(40.0), Some(24)), at(Some(SPARK_FULL), true));
        // 小字先让
        assert_eq!(
            fit(avail - full - 10.0, Some(40.0), Some(24)),
            at(Some(SPARK_FULL), false)
        );
        // 再收窄柱子
        assert_eq!(
            fit(avail - compact - 1.0, Some(40.0), Some(24)),
            at(Some(SPARK_COMPACT), false)
        );
        // 再不画柱子；没有柱子时小字放得下就跟着
        assert_eq!(fit(avail - 30.0, Some(20.0), Some(24)), at(None, true));
        assert_eq!(fit(avail - 30.0, Some(40.0), Some(24)), at(None, false));
        // 什么都放不下：只剩截字
        assert_eq!(fit(avail + 50.0, None, Some(24)), at(None, false));
        // 没问到每小时的数：本来就没有柱子
        assert_eq!(fit(100.0, None, None), at(None, false));
        assert_eq!(SPARK_FULL.width(24), 24.0 * 3.0 + 23.0 * 1.5);
        assert_eq!(SPARK_FULL.width(0), 0.0);
    }

    /// 没有用量的小时是一截短线；有用量的再少也比短线高一截，满格是 26
    #[test]
    fn bars_never_look_like_the_empty_stub() {
        assert_eq!(spark_height(Spark::Empty), SPARK_STUB_H);
        assert_eq!(spark_height(Spark::Past(0.001)), SPARK_MIN_H);
        const { assert!(SPARK_MIN_H > SPARK_STUB_H) };
        assert_eq!(spark_height(Spark::Now(1.0)), SPARK_MAX_H);
        assert_eq!(spark_height(Spark::Past(0.5)), 13.0);
        assert_eq!(spark_height(Spark::Past(2.0)), SPARK_MAX_H, "不画出格");
    }

    /// 英文的原因比一行长：折成两行，那一块跟着高一截，不截成「Startup failed several…」
    #[test]
    fn a_long_reason_wraps_and_makes_the_status_taller() {
        let _appkit = appkit();
        let status = |lang: Lang| {
            let s = Snapshot {
                gateway: Gateway::SafeMode,
                ..Default::default()
            };
            with_lang(lang, || model::build(&s, model::Style::Full).1)
                .into_iter()
                .find(|r| matches!(r, Row::Status { .. }))
                .unwrap()
        };
        let line = line_height(&reason_font());
        let zh = row_height(&status(Lang::Zh));
        let en = row_height(&status(Lang::En));
        assert!(
            (zh - (STATUS_ROW + REASON_GAP + line.ceil() + STATUS_BOTTOM)).abs() <= 1.0,
            "{zh}"
        );
        assert!(en > zh + line * 0.5, "英文 {en}，中文 {zh}");
        assert!(en <= STATUS_ROW + REASON_GAP + (line * REASON_LINES).ceil() + STATUS_BOTTOM);
        // 正在启动：没有原因，就是一行
        let starting = Row::Status {
            state: "正在启动".into(),
            tone: StateTone::Busy,
            server: None,
            reason: None,
        };
        assert_eq!(row_height(&starting), STATUS_ROW + STATUS_BOTTOM);
    }

    /// 积分制套餐的窗口在条下面多一行小字：那一行要高出这一截，不然被下一项压住
    #[test]
    fn a_line_under_a_bar_makes_the_quota_row_taller() {
        let row = |detail: Option<&str>| Row::Quota {
            provider: "glm".into(),
            window: WindowRow {
                label: "5 小时".into(),
                percent: Some(1.0),
                reset: "3 小时后重置".into(),
                tone: Tone::Normal,
                detail: detail.map(str::to_string),
            },
            action: model::Action::Open("upstreams"),
        };
        let plain = row_height(&row(None));
        assert_eq!(plain, QUOTA_BAR_Y + QUOTA_BAR_H + QUOTA_BOTTOM);
        assert_eq!(
            row_height(&row(Some("剩余 1,976 / 2,000 积分"))),
            plain + QUOTA_DETAIL
        );
    }

    /// 监听没换成的那一行橙字让「今日」那一块高一截
    #[test]
    fn a_listen_error_makes_today_taller() {
        let _appkit = appkit();
        let mut d = today(Lang::Zh, busy());
        let plain = row_height(&Row::Today(Box::new(d.clone())));
        assert_eq!(plain, TODAY_META_BASELINE + TODAY_BOTTOM);
        d.warn = Some("端口 18790 已被占用。".into());
        assert!(row_height(&Row::Today(Box::new(d))) > plain + 10.0);
    }

    /// 服务器的名字很长：截它，状态和速率留着
    #[test]
    fn a_long_server_name_is_cut_before_the_rate() {
        let _appkit = appkit();
        let mut d = today(Lang::Zh, busy());
        d.server = Some("a-very-long-remote-server-name-that-never-ends.example.com".into());
        let font = top_font();
        let line = state_text_fitting(&d, &font, 200.0);
        assert!(line.starts_with("运行中 · a-very"), "{line}");
        assert!(line.ends_with("… · 42 token/秒"), "{line}");
        assert!(text_width(&line, &font) <= 200.0 + 0.01);
        // 放得下就原样
        d.server = Some("office-mac".into());
        assert_eq!(
            state_text_fitting(&d, &font, 200.0),
            "运行中 · office-mac · 42 token/秒"
        );
    }

    #[test]
    fn text_that_does_not_fit_is_cut_with_an_ellipsis() {
        let _appkit = appkit();
        let s = attributed(
            "Resets in 3 days",
            &quota_right_font(),
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

    /// 截断留下的是放得下的最多的字：和一个字一个字往回退、第一个放得下的那一截一样。
    /// 二分只是找得快，每一种宽度下结果都不变
    #[test]
    fn cutting_keeps_as_many_characters_as_fit() {
        let _appkit = appkit();
        let font = sys(11.5, weight(Weight::Regular));
        let body = "5 小时额度已用完，42 分钟后重置。Requests through this upstream are refused.";
        let s = attributed(body, &font, &NSColor::labelColor());
        let chars: Vec<char> = body.chars().collect();
        let whole = s.size().width;
        let mut w = 1.0;
        while w < whole + 10.0 {
            let one_by_one = (0..chars.len()).rev().find_map(|n| {
                let t = chars[..n].iter().collect::<String>() + "…";
                let a = attributed(&t, &font, &NSColor::labelColor());
                (a.size().width <= w + FIT_SLACK).then_some(t)
            });
            let want = if whole <= w + FIT_SLACK {
                Some(body.to_string())
            } else {
                one_by_one
            };
            assert_eq!(fit(&s, w).map(|a| a.string().to_string()), want, "宽 {w}");
            w += 3.0;
        }
    }
}
