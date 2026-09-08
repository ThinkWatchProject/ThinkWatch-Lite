//! 重启策略。**刻意做成纯逻辑** —— 不 spawn 任何东西、不碰时钟以外的
//! 系统状态，这样「连续崩五次会怎样」是可以在毫秒内测出来的，而不是
//! 要真的把 core 杀五遍。
//!
//! 设计见 DESIGN.md §2.2.1。

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// 退避阶梯。**第一次立刻重启**，因为多数崩溃是偶发的 —— 让用户等一秒
/// 去换一个大概率没用的谨慎，不划算。
const DELAYS: [Duration; 5] = [
    Duration::from_secs(0),
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
    Duration::from_secs(8),
];

/// 计数窗口。超过这个时间的失败不再算数 —— 否则一个跑了三个月的进程
/// 会被三个月前的两次偶发崩溃拖进安全模式。
const WINDOW: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// 等这么久再重启
    RestartAfter(Duration),
    /// 连续失败太多次，进安全模式：只起控制面，让用户还能改配置和回滚
    SafeMode,
}

#[derive(Debug)]
pub struct RestartPolicy {
    recent: VecDeque<Instant>,
}

impl Default for RestartPolicy {
    fn default() -> Self {
        Self::new()
    }
}

impl RestartPolicy {
    pub fn new() -> Self {
        Self {
            recent: VecDeque::new(),
        }
    }

    /// core 死了一次，接下来怎么办。
    pub fn on_exit(&mut self, now: Instant) -> Decision {
        self.prune(now);
        self.recent.push_back(now);
        match DELAYS.get(self.recent.len() - 1) {
            Some(d) => Decision::RestartAfter(*d),
            None => Decision::SafeMode,
        }
    }

    /// core 稳定跑了一段时间，把计数清掉。
    ///
    /// **这条比看起来重要**：没有它，一个每天崩一次的进程会在第五天进
    /// 安全模式 —— 而那五次之间隔了好几天，根本不是「连续失败」。
    pub fn on_healthy(&mut self) {
        self.recent.clear();
    }

    /// 窗口内的失败次数。UI 拿它决定要不要打扰用户。
    pub fn recent_failures(&self) -> usize {
        self.recent.len()
    }

    fn prune(&mut self, now: Instant) {
        while let Some(front) = self.recent.front() {
            if now.duration_since(*front) > WINDOW {
                self.recent.pop_front();
            } else {
                break;
            }
        }
    }
}

/// 该不该打断用户。
///
/// **分级告知**（§2.2.1）：偶发崩溃自动恢复了就别打扰人 —— 一个用完就
/// 忘的通知，代价是用户下次真出事时也不看了。
pub fn should_interrupt(decision: Decision, failures: usize) -> bool {
    match decision {
        // 进安全模式必须打断，而且要自动开窗：这时候网关已经不转发了，
        // 用户的所有 AI 客户端都在瞎，他必须知道。
        Decision::SafeMode => true,
        // 第一次崩溃自动恢复了，安静处理。连着崩到第三次说明不是偶发。
        Decision::RestartAfter(_) => failures >= 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t0() -> Instant {
        Instant::now()
    }

    #[test]
    fn the_first_crash_restarts_immediately() {
        // 多数崩溃是偶发的。让用户等一秒去换一个大概率没用的谨慎，不划算。
        let mut p = RestartPolicy::new();
        assert_eq!(p.on_exit(t0()), Decision::RestartAfter(Duration::ZERO));
    }

    #[test]
    fn backoff_climbs_then_gives_up_into_safe_mode() {
        let mut p = RestartPolicy::new();
        let now = t0();
        let got: Vec<_> = (0..6).map(|_| p.on_exit(now)).collect();
        assert_eq!(
            got,
            vec![
                Decision::RestartAfter(Duration::from_secs(0)),
                Decision::RestartAfter(Duration::from_secs(1)),
                Decision::RestartAfter(Duration::from_secs(2)),
                Decision::RestartAfter(Duration::from_secs(4)),
                Decision::RestartAfter(Duration::from_secs(8)),
                Decision::SafeMode,
            ]
        );
    }

    #[test]
    fn failures_older_than_the_window_do_not_count() {
        // 没有这条，一个跑了三个月的进程会被三个月前的两次偶发崩溃
        // 拖进安全模式。
        let mut p = RestartPolicy::new();
        let old = t0();
        for _ in 0..4 {
            p.on_exit(old);
        }
        assert_eq!(p.recent_failures(), 4);
        let later = old + WINDOW + Duration::from_secs(1);
        // 窗口外的全部过期，这一次又是「第一次」
        assert_eq!(p.on_exit(later), Decision::RestartAfter(Duration::ZERO));
        assert_eq!(p.recent_failures(), 1);
    }

    #[test]
    fn a_healthy_run_resets_the_ladder() {
        // 每天崩一次的进程不该在第五天进安全模式 —— 那五次不是「连续」。
        let mut p = RestartPolicy::new();
        let now = t0();
        p.on_exit(now);
        p.on_exit(now);
        p.on_healthy();
        assert_eq!(p.on_exit(now), Decision::RestartAfter(Duration::ZERO));
    }

    #[test]
    fn safe_mode_is_sticky_while_the_window_holds() {
        // 进了安全模式还继续崩，不该反复弹「进入安全模式」。
        let mut p = RestartPolicy::new();
        let now = t0();
        for _ in 0..5 {
            p.on_exit(now);
        }
        assert_eq!(p.on_exit(now), Decision::SafeMode);
        assert_eq!(p.on_exit(now), Decision::SafeMode);
    }

    #[test]
    fn one_off_crashes_do_not_interrupt_the_user() {
        // 一个用完就忘的通知，代价是用户下次真出事时也不看了。
        assert!(!should_interrupt(Decision::RestartAfter(Duration::ZERO), 1));
        assert!(!should_interrupt(
            Decision::RestartAfter(Duration::from_secs(1)),
            2
        ));
    }

    #[test]
    fn a_run_of_crashes_and_safe_mode_do_interrupt() {
        assert!(should_interrupt(
            Decision::RestartAfter(Duration::from_secs(2)),
            3
        ));
        // 安全模式必须打断：网关已经不转发了，用户所有的 AI 客户端都在瞎。
        assert!(should_interrupt(Decision::SafeMode, 6));
    }
}
