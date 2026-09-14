//! 菜单栏那 50 像素。
//!
//! 这类工具用户九成时间不开主窗口，所以这一小块常驻显示才是它每天真正
//! 被看到的界面。Surge 在那里放速率，因为流量是网络
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
    /// 订阅额度：最紧张那个窗口用了百分之多少。
    ///
    /// **有它就显示它，而不是金额。**订阅用户的账单是固定的，「今天花了
    /// $0.00」对他没有任何信息量；他想知道的是「还能用多久」。同一块
    /// 50 像素，两种人格。
    ///
    /// 按量付费的账号根本没有这些响应头，那时它是 None ——
    /// **不是 0%**，那会画出一个假的空进度条。
    pub quota_percent: Option<f64>,
    /// 那个窗口还有多少秒重置。**上游没给就是 None** —— 编一个倒计时
    /// 出来，用户会照着它安排自己的活
    pub quota_reset_in_secs: Option<u64>,
    /// 上游说快到额度了（`allowed_warning` / `rejected`）。
    ///
    /// **限流不再是突然发生的**：菜单栏在撞上 429 之前就变色。
    pub quota_warning: bool,
    /// 第二行：输出速率
    pub tokens_per_sec: Option<u32>,
    /// 有没有正在跑的流。有的话数字旁加一个点
    pub active: u32,
    pub status: Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// 还没起来。**开机自启时第一时间就要是这个状态**，不能等 core 就绪
    /// —— 否则菜单栏上什么都没有，用户以为应用没启动。
    Starting,
    Normal,
    /// 安全拦截。**这是那套防线真正落地的地方** —— 拦截发生时你可能
    /// 正埋头在别的窗口，系统通知一闪而过很容易错过，但菜单栏一直在。
    Blocked,
    /// core 断开
    Disconnected,
}

impl Default for MenuBarState {
    fn default() -> Self {
        Self {
            cost_today: None,
            quota_percent: None,
            quota_reset_in_secs: None,
            quota_warning: false,
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
            // **订阅额度优先。**有它说明这是个订阅账号，而对他「今天花了
            // $0.00」是句废话 —— 他想知道的是还能用多久。
            _ => match (self.quota_percent, self.cost_today) {
                (Some(p), _) => format!("{}%", p.round() as i64),
                // 两位小数固定，宽度才稳（「宽度抖动」）
                (None, Some(c)) => format!("${c:.2}"),
                (None, None) => "—".to_string(),
            },
        }
    }

    /// 第二行文字。
    pub fn line2(&self) -> String {
        match self.status {
            Status::Starting => "—".to_string(),
            Status::Disconnected => "!".to_string(),
            // 订阅用户的第二行是「多久重置」。**没有 reset 头就不画** ——
            // 那时退回速率，而不是编一个时间
            _ => match (
                self.quota_percent,
                self.quota_reset_in_secs,
                self.tokens_per_sec,
            ) {
                (Some(_), Some(secs), _) => reset_label(secs),
                (_, _, Some(t)) if self.active > 0 => format!("{t} t/s ·"),
                (_, _, Some(t)) => format!("{t} t/s"),
                _ if self.active > 0 => format!("{} ▶", self.active),
                _ => "—".to_string(),
            },
        }
    }

    /// 用模板图吗（macOS 自动跟随亮暗反色）。
    ///
    /// **模板图只能是单色**，所以告警状态必须关掉它自己上色 —— 那正是
    /// 那个折中：正常状态享受自动适配，告警状态换彩色。
    pub fn is_template(&self) -> bool {
        // 额度告警也要上色：**限流是「你马上要撞墙了」，那和一次安全
        // 拦截同等重要** —— 而单色的模板图说不出「注意」这件事。
        !matches!(self.status, Status::Blocked) && !self.quota_warning
    }

    /// 这一帧要不要重画。
    ///
    /// **空闲时跳过渲染**。没有活跃请求、文字也没变的时候不做
    /// 无谓的重绘 —— 这直接关系到那条「空闲 CPU 约等于零」。
    pub fn needs_redraw(&self, prev: &MenuBarState) -> bool {
        self.line1() != prev.line1()
            || self.line2() != prev.line2()
            || self.status != prev.status
            // 颜色变了也要重画，哪怕字一模一样
            || self.quota_warning != prev.quota_warning
    }
}

/// 「2h」「45m」「3d」。**宽度要稳**（宽度抖动）：一个在
/// 「119m」和「2h」之间跳来跳去的标签会让右边的图标一直动。
fn reset_label(secs: u64) -> String {
    match secs {
        0 => "已重置".to_string(),
        s if s < 3600 => format!("{}m", s.div_ceil(60)),
        s if s < 86_400 => format!("{}h", s.div_ceil(3600)),
        s => format!("{}d", s.div_ceil(86_400)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st(cost: Option<f64>, tps: Option<u32>, active: u32, status: Status) -> MenuBarState {
        MenuBarState {
            cost_today: cost,
            tokens_per_sec: tps,
            quota_percent: None,
            quota_reset_in_secs: None,
            quota_warning: false,
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

#[cfg(test)]
mod quota_tests {
    use super::*;

    fn sub(percent: f64, reset: Option<u64>, warn: bool) -> MenuBarState {
        MenuBarState {
            cost_today: Some(0.0),
            quota_percent: Some(percent),
            quota_reset_in_secs: reset,
            quota_warning: warn,
            status: Status::Normal,
            ..Default::default()
        }
    }

    #[test]
    fn a_subscription_account_sees_a_percentage_not_a_price() {
        // **对订阅用户「今天花了 $0.00」是句废话** —— 他的账单是固定的，
        // 想知道的是还能用多久。
        let s = sub(62.0, Some(7200), false);
        assert_eq!(s.line1(), "62%");
        assert_eq!(s.line2(), "2h");
    }

    #[test]
    fn a_pay_as_you_go_account_still_sees_the_price() {
        let s = MenuBarState {
            cost_today: Some(3.42),
            status: Status::Normal,
            ..Default::default()
        };
        assert_eq!(s.line1(), "$3.42");
    }

    #[test]
    fn no_reset_header_means_no_countdown_not_a_made_up_one() {
        // **编一个倒计时出来，用户会照着它安排自己的活**。
        let s = sub(62.0, None, false);
        assert_eq!(s.line2(), "—", "上游没给重置时间，我们却画了一个");
    }

    #[test]
    fn the_reset_label_keeps_a_stable_width() {
        // 一个在「119m」和「2h」之间跳来跳去的标签会让右边的图标一直动
        // （宽度抖动）。
        assert_eq!(reset_label(0), "已重置");
        assert_eq!(reset_label(59), "1m");
        assert_eq!(reset_label(3599), "60m");
        assert_eq!(reset_label(3600), "1h");
        assert_eq!(reset_label(7200), "2h");
        assert_eq!(reset_label(86_400), "1d");
        assert_eq!(reset_label(86_401), "2d");
    }

    #[test]
    fn a_quota_warning_switches_off_the_template_so_it_can_be_coloured() {
        // **限流是「你马上要撞墙了」，那和一次安全拦截同等重要** ——
        // 而单色的模板图说不出「注意」这件事。
        assert!(!sub(95.0, None, true).is_template());
        assert!(sub(95.0, None, false).is_template());
    }

    #[test]
    fn a_colour_change_alone_still_triggers_a_redraw() {
        // 字一模一样但颜色变了，不重画的话用户永远看不到那个告警。
        let calm = sub(95.0, Some(60), false);
        let warn = sub(95.0, Some(60), true);
        assert_eq!(calm.line1(), warn.line1());
        assert!(warn.needs_redraw(&calm));
    }

    #[test]
    fn a_percentage_is_rounded_so_the_width_does_not_jitter() {
        assert_eq!(sub(62.4, None, false).line1(), "62%");
        assert_eq!(sub(62.6, None, false).line1(), "63%");
        assert_eq!(sub(100.0, None, false).line1(), "100%");
    }
}
