//! 菜单栏那 50 像素。
//!
//! 这类工具用户九成时间不开主窗口，所以这一小块常驻显示才是它每天真正
//! 被看到的界面（DESIGN.md §7.4）。Surge 在那里放速率，因为流量是网络
//! 代理的核心指标；对一个 AI 网关，**钱才是**。

pub mod font;
pub mod render;

pub use render::{Appearance, render_rgba};

/// 菜单栏要显示的东西。
#[derive(Debug, Clone, PartialEq)]
pub struct MenuBarState {
    /// 第一行：今日花费。`None` 表示还不知道 —— 画成破折号而不是 `$0.00`，
    /// **0 是一个值，破折号不是**。
    pub cost_today: Option<f64>,
    /// 第二行：输出速率
    pub tokens_per_sec: Option<u32>,
    /// 有没有正在跑的流。有的话数字旁加一个点
    pub active: u32,
    pub status: Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// 还没起来。**开机自启时第一时间就要是这个状态**，不能等 core 就绪
    /// （§2.4）—— 否则菜单栏上什么都没有，用户以为应用没启动。
    Starting,
    Normal,
    /// 安全拦截。**这是 §5 那套防线真正落地的地方** —— 拦截发生时你可能
    /// 正埋头在别的窗口，系统通知一闪而过很容易错过，但菜单栏一直在。
    Blocked,
    /// core 断开
    Disconnected,
}

impl Default for MenuBarState {
    fn default() -> Self {
        Self {
            cost_today: None,
            tokens_per_sec: None,
            active: 0,
            status: Status::Starting,
        }
    }
}

impl MenuBarState {
    /// 第一行文字。
    pub fn line1(&self) -> String {
        match self.status {
            Status::Starting | Status::Disconnected => "—".to_string(),
            _ => match self.cost_today {
                // 两位小数固定，宽度才稳（§7.4 的「宽度抖动」）
                Some(c) => format!("${c:.2}"),
                None => "—".to_string(),
            },
        }
    }

    /// 第二行文字。
    pub fn line2(&self) -> String {
        match self.status {
            Status::Starting => "—".to_string(),
            Status::Disconnected => "!".to_string(),
            _ => match self.tokens_per_sec {
                Some(t) if self.active > 0 => format!("{t} t/s ·"),
                Some(t) => format!("{t} t/s"),
                None if self.active > 0 => format!("{} ▶", self.active),
                None => "—".to_string(),
            },
        }
    }

    /// 用模板图吗（macOS 自动跟随亮暗反色）。
    ///
    /// **模板图只能是单色**，所以告警状态必须关掉它自己上色 —— 那正是
    /// §7.4 里那个折中：正常状态享受自动适配，告警状态换彩色。
    pub fn is_template(&self) -> bool {
        !matches!(self.status, Status::Blocked)
    }

    /// 这一帧要不要重画。
    ///
    /// **空闲时跳过渲染**（§7.4）。没有活跃请求、文字也没变的时候不做
    /// 无谓的重绘 —— 这直接关系到 §4.5 那条「空闲 CPU 约等于零」。
    pub fn needs_redraw(&self, prev: &MenuBarState) -> bool {
        self.line1() != prev.line1() || self.line2() != prev.line2() || self.status != prev.status
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st(cost: Option<f64>, tps: Option<u32>, active: u32, status: Status) -> MenuBarState {
        MenuBarState {
            cost_today: cost,
            tokens_per_sec: tps,
            active,
            status,
        }
    }

    #[test]
    fn unknown_cost_is_a_dash_not_zero() {
        // $0.00 是一个断言：今天没花钱。破折号说的是「还不知道」。
        // 启动的头几秒这两件事完全不同。
        assert_eq!(st(None, None, 0, Status::Normal).line1(), "—");
        assert_eq!(st(Some(0.0), None, 0, Status::Normal).line1(), "$0.00");
    }

    #[test]
    fn starting_shows_a_dash_immediately_rather_than_nothing() {
        // 开机自启时菜单栏上必须**立刻**有东西，否则用户以为没启动。
        let s = st(None, None, 0, Status::Starting);
        assert_eq!(s.line1(), "—");
        assert_eq!(s.line2(), "—");
    }

    #[test]
    fn cost_keeps_two_decimals_so_the_width_does_not_jump() {
        // 位数一变，菜单栏里右边的所有图标都会跟着左右跳。
        assert_eq!(st(Some(3.4), None, 0, Status::Normal).line1(), "$3.40");
        assert_eq!(st(Some(3.456), None, 0, Status::Normal).line1(), "$3.46");
    }

    #[test]
    fn an_active_stream_adds_a_dot_next_to_the_rate() {
        assert_eq!(st(None, Some(47), 1, Status::Normal).line2(), "47 t/s ·");
        assert_eq!(st(None, Some(47), 0, Status::Normal).line2(), "47 t/s");
    }

    #[test]
    fn with_no_rate_yet_the_active_count_takes_the_line() {
        assert_eq!(st(None, None, 3, Status::Normal).line2(), "3 ▶");
    }

    #[test]
    fn a_disconnected_core_is_visible_without_reading_numbers() {
        // 菜单栏是余光扫的 —— 形状的变化比读数字快一个量级。
        let s = st(Some(9.99), Some(50), 0, Status::Disconnected);
        assert_eq!(s.line1(), "—", "断开时不该继续显示一个已经过时的数字");
        assert_eq!(s.line2(), "!");
    }

    #[test]
    fn only_the_blocked_state_gives_up_the_template_icon() {
        // 模板图只能单色，所以告警才值得放弃自动亮暗适配。
        for s in [Status::Starting, Status::Normal, Status::Disconnected] {
            assert!(st(None, None, 0, s).is_template());
        }
        assert!(!st(None, None, 0, Status::Blocked).is_template());
    }

    #[test]
    fn nothing_changing_means_nothing_to_redraw() {
        // 「空闲 CPU 约等于零」直接依赖这条。
        let a = st(Some(1.0), Some(10), 0, Status::Normal);
        assert!(!a.needs_redraw(&a.clone()));
        assert!(a.needs_redraw(&st(Some(1.01), Some(10), 0, Status::Normal)));
        assert!(a.needs_redraw(&st(Some(1.0), Some(10), 0, Status::Blocked)));
    }

    #[test]
    fn a_sub_cent_change_does_not_trigger_a_redraw() {
        // 每个请求都动一点点花费，但显示只有两位小数。按显示文字比较
        // 而不是按原始值，才真的省下重绘。
        let a = st(Some(3.4200), Some(10), 0, Status::Normal);
        let b = st(Some(3.4201), Some(10), 0, Status::Normal);
        assert!(!a.needs_redraw(&b));
    }

    #[test]
    fn everything_we_can_produce_is_renderable() {
        // 画不出来的字符会被静默跳过，而那在数字里就是一个错误的读数。
        for s in [
            st(Some(1234.56), Some(9999), 5, Status::Normal),
            st(None, None, 0, Status::Starting),
            st(Some(0.0), Some(0), 0, Status::Disconnected),
            st(Some(3.42), Some(47), 2, Status::Blocked),
        ] {
            for line in [s.line1(), s.line2()] {
                for c in line.chars() {
                    assert!(font::can_render(c), "{line:?} 里的 {c:?} 画不出来");
                }
            }
        }
    }
}
