//! 启动时先不连、先问连哪个的两种情形：按住 ⌥ 启动，和上两次启动都没走到就绪。
//!
//! **后一条是失败保护。**远程连不上时界面照样能开，但要是某个连接让应用一启动就出事
//! （卡在启动画面、崩掉），用户每打开一次都会再撞一次。和 core 连续启动失败就进安全
//! 模式是同一个思路：连着两次没走到就绪，第三次先让人选。

use std::path::Path;

/// 记着「这次启动还没走到就绪」的文件，里面是连着几次了
const FILE: &str = "launch-attempts";

/// 连着几次没走到就绪，下一次就先让人选
pub const PICK_AFTER: u32 = 2;

/// 为什么先显示连接选择
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Why {
    /// 按住了 ⌥（Windows、Linux 上是 Alt）
    Option,
    /// 上次启动没能走到就绪
    Unfinished,
}

/// 这次启动开始了：读出之前连着几次没走到就绪，再把这一次记上。
pub fn begin(dir: &Path) -> u32 {
    let before = std::fs::read_to_string(dir.join(FILE))
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0);
    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(dir.join(FILE), (before + 1).to_string());
    before
}

/// 走到就绪了（连上了）：清掉记号
pub fn ready(dir: &Path) {
    let _ = std::fs::remove_file(dir.join(FILE));
}

/// 这次要不要先让人选，为什么
pub fn why(before: u32, option_held: bool) -> Option<Why> {
    if option_held {
        Some(Why::Option)
    } else if before >= PICK_AFTER {
        Some(Why::Unfinished)
    } else {
        None
    }
}

/// 启动这一刻 ⌥ 是不是按着。
///
/// macOS 问 `NSEvent.modifierFlags`，Windows 问 Alt 键的状态。**Linux 上说不出来**：
/// Wayland 不让一个还没有窗口的进程读键盘，那边只有失败保护这一条
pub fn option_held() -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSEvent, NSEventModifierFlags};
        NSEvent::modifierFlags_class().contains(NSEventModifierFlags::Option)
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_MENU};
        // SAFETY: 只读一个键的状态。最高位是「此刻按着」
        (unsafe { GetAsyncKeyState(VK_MENU as i32) } as u16 & 0x8000) != 0
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("tw-launch-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// 连着两次没走到就绪，第三次先让人选；走到过一次就从头数
    #[test]
    fn two_unfinished_launches_make_the_third_one_ask() {
        let dir = tmp("guard");
        assert_eq!(why(begin(&dir), false), None);
        assert_eq!(why(begin(&dir), false), None);
        assert_eq!(why(begin(&dir), false), Some(Why::Unfinished));
        ready(&dir);
        assert_eq!(why(begin(&dir), false), None);
    }

    #[test]
    fn holding_option_always_asks() {
        assert_eq!(why(0, true), Some(Why::Option));
        assert_eq!(why(5, true), Some(Why::Option));
    }
}
