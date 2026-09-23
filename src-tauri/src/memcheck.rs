//! 量一量 webview 到底占多少（M3 验收的最后一条）。
//!
//! **整个模块只有 macOS 有。**它靠 `ps` 读 RSS，而那个命令在 Windows 上
//! 不存在 —— 与其让它在那里报一串 0（一个看上去像结论的谎），不如让它
//! 根本不在。那个平台上要量内存，得另写一套（`GetProcessMemoryInfo`），
//! 而那是真需要的时候再做的事。
//!
//! **这个模块存在是因为那个问题不能靠读代码回答。**「关窗之后隐藏还是
//! 销毁 webview」取决于隐藏到底放不放得掉那部分内存，而那只有跑起来量
//! 才知道。
//!
//! 用 `--measure-memory` 跑：开窗 → 量 → 关窗 → 等 → 再量 → 退出。
//! **在进程内部驱动，不靠 UI 自动化** —— 后者要辅助访问权限，而那是
//! 用户才能给的东西，一个诊断工具不该有这种前置条件。

use std::time::Duration;

/// 命令行标志。
pub const FLAG: &str = "--measure-memory";

pub fn requested<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|a| a.as_ref() == FLAG)
}

/// 这个进程和它的 WebKit 伙伴一共占多少字节。
///
/// **WebKit 的三个 XPC 进程不是我们的子进程** —— 它们挂在 launchd 下，
/// 所以只能按名字找。这会把同一台机器上别的 WKWebView 应用也算进来，
/// 而测量的意义在**差值**：同一次运行里前后两个数字的差，那部分噪音
/// 是共同的。
pub fn footprint() -> Footprint {
    let me = std::process::id();
    Footprint {
        own_kb: rss_kb_of(&me.to_string()).unwrap_or(0),
        webkit_kb: webkit_rss_kb(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Footprint {
    pub own_kb: u64,
    pub webkit_kb: u64,
}

impl Footprint {
    pub fn total_mb(&self) -> f64 {
        (self.own_kb + self.webkit_kb) as f64 / 1024.0
    }
    pub fn own_mb(&self) -> f64 {
        self.own_kb as f64 / 1024.0
    }
    pub fn webkit_mb(&self) -> f64 {
        self.webkit_kb as f64 / 1024.0
    }
}

fn rss_kb_of(pid: &str) -> Option<u64> {
    let out = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", pid])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

fn webkit_rss_kb() -> u64 {
    let Ok(out) = std::process::Command::new("ps")
        .args(["-axo", "rss,comm"])
        .output()
    else {
        return 0;
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|l| l.contains("WebKit"))
        .filter_map(|l| l.split_whitespace().next()?.parse::<u64>().ok())
        .sum()
}

/// 跑一遍测量，把结果打在 stderr 上，然后退出。
///
/// 之所以是 stderr：这个东西的产物是给人读的一段话，不是给管道用的数据。
pub fn run(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let settle = Duration::from_secs(6);
        std::thread::sleep(settle);
        let open = footprint();
        eprintln!(
            "窗口开着      自身 {:6.1} MB   WebKit {:6.1} MB   合计 {:6.1} MB",
            open.own_mb(),
            open.webkit_mb(),
            open.total_mb()
        );

        // 走和用户点红点完全一样的那条路 —— 量一个别的路径没有意义
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            use tauri::Manager;
            if let Some(w) = app2.get_webview_window("main") {
                let _ = w.close();
            }
        });

        for wait in [6u64, 20, 40] {
            std::thread::sleep(Duration::from_secs(wait));
            let f = footprint();
            eprintln!(
                "关窗 {wait:>2} 秒后   自身 {:6.1} MB   WebKit {:6.1} MB   合计 {:6.1} MB   （比开着时 {:+.1} MB）",
                f.own_mb(),
                f.webkit_mb(),
                f.total_mb(),
                f.total_mb() - open.total_mb()
            );
        }
        eprintln!();
        eprintln!("差值才是结论：WebKit 那一列掉下去了就说明关窗真的放掉了内存。");
        std::process::exit(0);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_flag_is_recognised_and_nothing_else_is() {
        assert!(requested(["thinkwatch-lite", FLAG]));
        assert!(!requested(["thinkwatch-lite"]));
        assert!(!requested(["thinkwatch-lite", "--autostart"]));
        // 前缀相同的不算 —— 一个 `--measure-memory-usage` 是别的东西
        assert!(!requested(["thinkwatch-lite", "--measure-memory-usage"]));
    }

    #[test]
    fn the_footprint_of_this_very_process_is_not_zero() {
        let f = footprint();
        assert!(f.own_kb > 0, "量不到自己的 RSS，那这个工具没用");
        assert!(f.own_mb() > 0.0);
    }
}
