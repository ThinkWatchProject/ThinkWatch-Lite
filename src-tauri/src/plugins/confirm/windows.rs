//! Windows：`MessageBoxW`。
//!
//! **只用 std 和 windows-sys**（不引 `crate::`）：在 macOS 上能原样摘进一个小 crate，对着
//! Windows 的目标跑 clippy。
//!
//! 不用 `TaskDialogIndirect`（能把按钮写成「安装」）：它只在 Common Controls v6 里有，
//! 进程没带那份清单时（测试程序就没有）连启动都失败。消息框的按钮是系统语言的「确定 /
//! 取消」，所以正文最后补一句选「确定」是做什么（`Ask::ok_hint`）。

use windows_sys::Win32::UI::WindowsAndMessaging::{
    IDOK, MB_DEFBUTTON2, MB_ICONERROR, MB_ICONWARNING, MB_OKCANCEL, MB_SETFOREGROUND, MessageBoxW,
};

/// 问一句，阻塞到用户回答。`owner` 是主窗口的 HWND（没有就是 0）：对话框开着时它不接受
/// 点击。**默认按钮是「取消」**（`MB_DEFBUTTON2`），回车不会变成一次确认。
pub fn confirm(owner: isize, title: &str, text: &str, danger: bool) -> bool {
    let title = wide(title);
    let text = wide(text);
    let icon = if danger { MB_ICONERROR } else { MB_ICONWARNING };
    // SAFETY: 两段都是以 0 结尾的 UTF-16，活到调用返回之后；owner 是一个窗口句柄或 0
    let answer = unsafe {
        MessageBoxW(
            owner as _,
            text.as_ptr(),
            title.as_ptr(),
            MB_OKCANCEL | MB_DEFBUTTON2 | MB_SETFOREGROUND | icon,
        )
    };
    answer == IDOK
}

/// 以 0 结尾的 UTF-16。**文字里的 0 换成空格**：不然消息框只显示到那里为止
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16()
        .map(|u| if u == 0 { u16::from(b' ') } else { u })
        .chain(std::iter::once(0))
        .collect()
}
