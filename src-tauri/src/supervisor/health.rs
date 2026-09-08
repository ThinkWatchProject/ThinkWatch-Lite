//! 心跳：三信号里最慢、但**唯一能抓到「活着但卡死」的那一条**。
//!
//! DESIGN.md §2.2.1 列了三个信号，它们不是冗余：
//!
//! | 信号 | 快慢 | 覆盖什么 |
//! |---|---|---|
//! | 子进程退出事件 | 最快最准 | 只覆盖我们自己 spawn 的那个 |
//! | socket 断开 | 次之 | core 关了控制面，或者进程没了 |
//! | **心跳** | 最慢 | **进程还在、socket 还在，但它不回话** |
//!
//! 第三种是前两种都抓不到的：一个死锁的进程既不退出，也不关 socket。
//! 而它对用户的表现和「挂了」完全一样 —— 所有 AI 客户端一起卡住。

use std::time::Duration;

/// 多久探一次。
///
/// 不能太密：控制面每次问都要跑一遍状态收集，而这是个常驻进程，一天
/// 探一万次和探两千次的信息量是一样的。
pub const INTERVAL: Duration = Duration::from_secs(5);

/// 单次探测的超时。
pub const TIMEOUT: Duration = Duration::from_secs(3);

/// 连续失败多少次算卡死。
///
/// **3 次（约 15 秒）是刻意保守的。** 误判的代价是掐掉一个可能正在跑的
/// 长请求 —— §4.7 说过一个 6 分钟的 Opus 任务是正常的。不过真卡死的时候
/// 所有请求本来就已经在失败了，所以代价其实是不对称的：**漏判比误判贵**，
/// 但误判会让人不信任这套守护，那更贵。
pub const FAILURES_TO_DECLARE_WEDGED: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// 还好
    Healthy,
    /// 探测失败了，但还没到判死的次数
    Degraded { consecutive: u32 },
    /// 活着但不响应，该换掉了
    Wedged,
}

#[derive(Debug, Default)]
pub struct HealthTracker {
    consecutive: u32,
}

impl HealthTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn on_ok(&mut self) -> Verdict {
        self.consecutive = 0;
        Verdict::Healthy
    }

    pub fn on_fail(&mut self) -> Verdict {
        self.consecutive += 1;
        if self.consecutive >= FAILURES_TO_DECLARE_WEDGED {
            Verdict::Wedged
        } else {
            Verdict::Degraded {
                consecutive: self.consecutive,
            }
        }
    }

    /// core 重启了，计数归零。
    ///
    /// **必须显式调用。** 不清零的话，重启后头几次探测（core 还在启动，
    /// 控制面 socket 还没建好）会立刻累加到判死次数，然后守护把一个正在
    /// 正常启动的进程又杀了 —— 那是一个自我维持的重启循环。
    pub fn reset(&mut self) {
        self.consecutive = 0;
    }

    pub fn consecutive_failures(&self) -> u32 {
        self.consecutive
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_single_failure_is_not_a_verdict() {
        // 探测失败一次可能只是赶上了别的什么。掐掉一个可能正在跑六分钟
        // 的请求，理由不能这么薄。
        let mut h = HealthTracker::new();
        assert_eq!(h.on_fail(), Verdict::Degraded { consecutive: 1 });
        assert_eq!(h.on_fail(), Verdict::Degraded { consecutive: 2 });
    }

    #[test]
    fn three_in_a_row_is() {
        let mut h = HealthTracker::new();
        h.on_fail();
        h.on_fail();
        assert_eq!(h.on_fail(), Verdict::Wedged);
    }

    #[test]
    fn one_success_wipes_the_streak() {
        // 「连续」是关键词。断断续续失败的探测说明网络或者负载有波动，
        // 不说明进程卡死了。
        let mut h = HealthTracker::new();
        h.on_fail();
        h.on_fail();
        assert_eq!(h.on_ok(), Verdict::Healthy);
        assert_eq!(h.on_fail(), Verdict::Degraded { consecutive: 1 });
    }

    #[test]
    fn a_restart_must_reset_the_counter() {
        // 不清零的话，重启后 core 还在启动、控制面 socket 还没建好，
        // 几次探测就把它又判死了 —— 一个自我维持的重启循环。
        let mut h = HealthTracker::new();
        h.on_fail();
        h.on_fail();
        h.reset();
        assert_eq!(h.consecutive_failures(), 0);
        assert_eq!(h.on_fail(), Verdict::Degraded { consecutive: 1 });
    }

    #[test]
    fn staying_wedged_keeps_reporting_wedged() {
        // 判死之后继续探测失败，不该退回 Degraded。
        let mut h = HealthTracker::new();
        for _ in 0..3 {
            h.on_fail();
        }
        assert_eq!(h.on_fail(), Verdict::Wedged);
        assert_eq!(h.on_fail(), Verdict::Wedged);
    }

    #[test]
    fn the_timeout_is_shorter_than_the_interval() {
        // 否则探测会互相叠上，连续失败次数的语义就不是「连续 N 个周期」
        // 而是别的什么了。
        assert!(TIMEOUT < INTERVAL);
    }
}
