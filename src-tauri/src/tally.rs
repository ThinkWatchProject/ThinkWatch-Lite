//! 菜单栏第二行的两个数：正在跑几个请求、最近的输出速率。
//!
//! **事件桥喂它，菜单栏读它。**两个数只靠事件就数得出来，不必为它们去问 core：
//! 开始和结局记进行中的，响应头带着首字节用了多久，结束事件里有总耗时和用量。

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, Instant};

use tw_api::Event;

/// 输出速率看最近这么久里跑完的请求
pub const RATE_WINDOW: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct Tally {
    /// 开始了、还没有结局的
    open: HashSet<u64>,
    /// 首字节用了多久，毫秒。生成用时要从总耗时里减掉它
    ttfb: HashMap<u64, u64>,
    /// 最近跑完的：（什么时候结束的，输出了多少 token，生成用了多少毫秒）
    done: VecDeque<(Instant, u64, u64)>,
    /// 正在按快照对账：快照在路上时事件流上见到的开始和结局，快照到了再合进去
    since: Option<Seen>,
}

#[derive(Default)]
struct Seen {
    started: HashSet<u64>,
    ended: HashSet<u64>,
}

impl Tally {
    pub fn on_event(&mut self, ev: &Event, now: Instant) {
        match ev {
            Event::RequestStarted { id, .. } => {
                self.open.insert(*id);
                if let Some(s) = &mut self.since {
                    s.started.insert(*id);
                }
            }
            Event::RequestHeaders { id, ttfb_ms, .. } => {
                self.ttfb.insert(*id, *ttfb_ms);
            }
            Event::RequestFinished {
                id,
                duration_ms,
                usage,
                ..
            } => {
                let ttfb = self.end(*id);
                // **只数跑完了的。**取消的、断掉的输出不全，拿来算速率只会偏低
                if let (Some(u), Some(ttfb)) = (usage, ttfb) {
                    let gen_ms = duration_ms.saturating_sub(ttfb);
                    if u.output > 0 && gen_ms > 0 {
                        self.done.push_back((now, u.output, gen_ms));
                    }
                }
                self.forget(now);
            }
            Event::RequestFailed { id, .. } | Event::RequestCancelled { id, .. } => {
                self.end(*id);
            }
            _ => {}
        }
    }

    /// 结局到了：不再在跑。返回它首字节用了多久
    fn end(&mut self, id: u64) -> Option<u64> {
        self.open.remove(&id);
        if let Some(s) = &mut self.since {
            s.ended.insert(id);
        }
        self.ttfb.remove(&id)
    }

    /// 开始按快照对账（事件流丢过事件、或者重新连上之后）。**先调它再去问快照**：
    /// 问的这会儿开始、结束的请求记在一边，快照到了一起合进去
    pub fn begin_resync(&mut self) {
        self.since = Some(Seen::default());
    }

    /// 快照没问到：不对了，照旧按事件数
    pub fn abandon_resync(&mut self) {
        self.since = None;
    }

    /// 快照到了：此刻还在跑的那些（`/in-flight` 的开始事件），加上等快照这会儿
    /// 开始的，减去这会儿结束的
    pub fn finish_resync(&mut self, snapshot: impl IntoIterator<Item = u64>) {
        let seen = self.since.take().unwrap_or_default();
        let mut open: HashSet<u64> = snapshot.into_iter().collect();
        open.extend(seen.started);
        for id in &seen.ended {
            open.remove(id);
        }
        self.ttfb.retain(|id, _| open.contains(id));
        self.open = open;
    }

    /// 进行中的请求数
    pub fn active(&self) -> u32 {
        self.open.len() as u32
    }

    /// 最近一分钟跑完的请求，平均每秒生成多少 token。
    ///
    /// **量的是生成的快慢**：每个请求的输出除以它生成用的时间（总耗时减去首字节），
    /// 按 token 加权。拿「一分钟里输出了多少」去除以六十的话，一个跑了一分钟才结束的
    /// 长请求，要等它结束之后才把速率一次性摊进来，数字跟着请求的长短忽高忽低。
    ///
    /// **这一分钟里没有跑完的请求就是 None**，不是 0：菜单栏那时退回别的读数。
    pub fn tokens_per_sec(&mut self, now: Instant) -> Option<u32> {
        self.forget(now);
        let (tokens, ms) = self
            .done
            .iter()
            .fold((0u64, 0u64), |(t, m), (_, out, gen_ms)| {
                (t + out, m + gen_ms)
            });
        (ms > 0).then(|| (tokens.saturating_mul(1000) / ms).min(u32::MAX as u64) as u32)
    }

    fn forget(&mut self, now: Instant) {
        while self
            .done
            .front()
            .is_some_and(|(at, _, _)| now.saturating_duration_since(*at) > RATE_WINDOW)
        {
            self.done.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn started(id: u64) -> Event {
        Event::RequestStarted {
            id,
            client: "c".into(),
            client_hint: None,
            session_fp: None,
            peer: None,
            key_masked: None,
            provider: "p".into(),
            billing: "per-token".into(),
            model: "m".into(),
            method: "POST".into(),
            path: "/v1/messages".into(),
            at_ms: 0,
        }
    }

    fn headers(id: u64, ttfb_ms: u64) -> Event {
        Event::RequestHeaders {
            id,
            status: 200,
            ttfb_ms,
        }
    }

    fn finished(id: u64, duration_ms: u64, output: u64) -> Event {
        Event::RequestFinished {
            id,
            model: "m".into(),
            status: 200,
            bytes: 1,
            duration_ms,
            usage: Some(tw_api::UsageView {
                input: 10,
                output,
                ..Default::default()
            }),
        }
    }

    #[test]
    fn it_counts_what_is_running() {
        let mut t = Tally::default();
        let now = Instant::now();
        t.on_event(&started(1), now);
        t.on_event(&started(2), now);
        assert_eq!(t.active(), 2);
        t.on_event(&finished(1, 1_000, 10), now);
        t.on_event(
            &Event::RequestCancelled {
                id: 2,
                model: "m".into(),
                status: None,
                bytes: 0,
                duration_ms: 5,
                usage: None,
            },
            now,
        );
        assert_eq!(t.active(), 0);
    }

    /// **量的是生成的快慢**：首字节之前那一段不算。两个请求按 token 加权
    #[test]
    fn the_rate_is_output_over_generation_time() {
        let mut t = Tally::default();
        let now = Instant::now();
        // 首字节 1 秒，之后 2 秒生成了 100 个
        t.on_event(&started(1), now);
        t.on_event(&headers(1, 1_000), now);
        t.on_event(&finished(1, 3_000, 100), now);
        assert_eq!(t.tokens_per_sec(now), Some(50));
        // 又一个：1 秒生成了 50 个。合起来 150 个 / 3 秒
        t.on_event(&started(2), now);
        t.on_event(&headers(2, 500), now);
        t.on_event(&finished(2, 1_500, 50), now);
        assert_eq!(t.tokens_per_sec(now), Some(50));
    }

    /// 一分钟之前跑完的不算；**没有就是没有**，不是 0
    #[test]
    fn an_idle_minute_has_no_rate() {
        let mut t = Tally::default();
        let then = Instant::now();
        assert_eq!(t.tokens_per_sec(then), None);
        t.on_event(&started(1), then);
        t.on_event(&headers(1, 100), then);
        t.on_event(&finished(1, 1_100, 40), then);
        assert_eq!(t.tokens_per_sec(then), Some(40));
        assert_eq!(
            t.tokens_per_sec(then + RATE_WINDOW + Duration::from_secs(1)),
            None
        );
    }

    /// 没见过响应头的（订阅之前就开始了）不知道生成用了多久，不瞎算
    #[test]
    fn a_request_without_its_headers_does_not_make_up_a_rate() {
        let mut t = Tally::default();
        let now = Instant::now();
        t.on_event(&finished(9, 2_000, 100), now);
        assert_eq!(t.tokens_per_sec(now), None);
    }

    /// 快照在路上时开始、结束的都要算进去：开始的补上，结束的去掉
    #[test]
    fn a_resync_keeps_what_happened_while_the_snapshot_was_on_its_way() {
        let mut t = Tally::default();
        let now = Instant::now();
        // 丢过事件：1 号的结局没收到，还挂在进行中
        t.on_event(&started(1), now);
        t.begin_resync();
        // 问快照的这会儿：3 号开始了，2 号结束了
        t.on_event(&started(3), now);
        t.on_event(&finished(2, 10, 0), now);
        // 快照里是 2 号（问的时候还在跑）和 4 号（订阅之前就开始了）
        t.finish_resync([2, 4]);
        let mut open: Vec<_> = t.open.iter().copied().collect();
        open.sort();
        assert_eq!(open, [3, 4], "1 号早结束了、2 号刚结束");
        assert_eq!(t.active(), 2);
    }
}
