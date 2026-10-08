//! 菜单里自己画的那几行：头一行的状态、小节标题、提醒、额度条、今日的几格数字、在跑的
//! 请求。标准菜单项由 AppKit 画（见上一层），这几行 AppKit 画不出来。
//!
//! 列宽按字量（见下面「自定义行的列宽」），量字和画字的小工具在上一层，菜单栏那一块也用。

use std::cell::{Cell, RefCell};

use objc2::rc::Retained;
use objc2::{
    AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, Message, define_class, msg_send,
};
use objc2_app_kit::{
    NSAttributedStringNSStringDrawing, NSAutoresizingMaskOptions, NSBezierPath, NSColor, NSEvent,
    NSFont, NSView,
};
use objc2_foundation::{NSAttributedString, NSPoint, NSRect, NSString};

use super::{
    MENU_WIDTH, PAD, TEXT_X, Weight, attributed, dispatch, fill_oval, mono, rect, symbol, sys,
    weight,
};
use crate::menubar::model::{Level, Row, StatCell, StateTone, Tone, WindowRow};

// ------------------------------------------------------------------ 自定义的几行

/// 自定义行要画的东西
#[derive(Debug, Clone)]
pub(super) enum Info {
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
        cells: Vec<StatCell>,
    },
    Live {
        app: String,
        model: String,
        elapsed: String,
    },
}

/// `quota`：整份菜单的额度行一起量出来的字宽（[`quota_text`]），只有额度行用
pub(super) fn info_of(row: &Row, quota: QuotaText) -> Info {
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

pub(super) fn info_height(info: &Info) -> f64 {
    match info {
        Info::Header { .. } => 46.0,
        Info::Section { .. } => 21.0,
        Info::Notice { .. } => 40.0,
        Info::Quota { windows, .. } => {
            6.0 + 20.0 + windows.iter().map(quota_row_height).sum::<f64>() + 3.0
        }
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
    pub(super) fn new(mtm: MainThreadMarker, info: Info, tag: Option<isize>) -> Retained<Self> {
        let frame = rect(0.0, 0.0, MENU_WIDTH, info_height(&info));
        let this = Self::alloc(mtm).set_ivars(ViewIvars {
            info: RefCell::new(info),
            tag: Cell::new(tag),
        });
        let view: Retained<Self> = unsafe { msg_send![super(this), initWithFrame: frame] };
        view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable);
        view
    }

    pub(super) fn set_info(&self, info: Info, tag: Option<isize>) {
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
/// 额度行：一个窗口占多高
const QUOTA_ROW: f64 = 21.0;
/// 额度行：条下面那一行小字（还剩多少积分）再占多高
const QUOTA_DETAIL: f64 = 15.0;
/// 「今日」：标签和旁边的橙色小字（失败数）之间
const NOTE_GAP: f64 = 6.0;

fn quota_label_font() -> Retained<NSFont> {
    sys(12.0, weight(Weight::Regular))
}

/// 等宽数字：倒计时在走，同位数时宽度不变
fn quota_reset_font() -> Retained<NSFont> {
    mono(12.0, weight(Weight::Regular))
}

/// 条下面那一行小字：比窗口名小一号，和「今日」的标签同一个字号
fn quota_detail_font() -> Retained<NSFont> {
    sys(11.0, weight(Weight::Regular))
}

/// 一个窗口占多高：带小字的高一截
fn quota_row_height(w: &WindowRow) -> f64 {
    match w.detail {
        Some(_) => QUOTA_ROW + QUOTA_DETAIL,
        None => QUOTA_ROW,
    }
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
pub(super) struct QuotaText {
    label: f64,
    reset: f64,
}

pub(super) fn quota_text(rows: &[Row]) -> QuotaText {
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
fn stat_widths(w: f64, cells: &[StatCell]) -> Vec<f64> {
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

pub(super) fn draw_info(info: &Info, b: NSRect, hl: bool) {
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
            let mut y = 26.0;
            for wr in windows {
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
                // 还剩多少：贴在条的正下方、和条左对齐，读得出是这一个窗口的
                if let Some(detail) = &wr.detail {
                    let d = attributed(detail, &quota_detail_font(), &secondary);
                    draw_clipped(&d, bar_x, y + 17.0, w - PAD - bar_x);
                }
                y += quota_row_height(wr);
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
            credits: None,
        };
        let s = Snapshot {
            gateway: Gateway::Running,
            today: Some(Today {
                requests: 244,
                failed,
                tokens: 4_200_000,
                cost_micros: 40_260_000,
                ..Default::default()
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

    /// 积分制套餐的窗口在条下面多一行小字：那一块要高出这一行，不然最后一行被下一项压住
    #[test]
    fn a_line_under_a_bar_makes_the_quota_row_taller() {
        let row = |detail: Option<&str>| WindowRow {
            label: "5 小时".into(),
            percent: Some(1.0),
            reset: "3 小时后重置".into(),
            tone: model::Tone::Normal,
            detail: detail.map(str::to_string),
        };
        let height = |windows: Vec<WindowRow>| {
            info_height(&Info::Quota {
                provider: "glm".into(),
                windows,
                text: QuotaText::default(),
            })
        };
        let plain = height(vec![row(None), row(None)]);
        assert_eq!(
            plain,
            6.0 + 20.0 + 2.0 * QUOTA_ROW + 3.0,
            "按百分比报的照旧"
        );
        assert_eq!(
            height(vec![row(Some("剩余 1,976 / 2,000 积分")), row(None)]),
            plain + QUOTA_DETAIL
        );
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
