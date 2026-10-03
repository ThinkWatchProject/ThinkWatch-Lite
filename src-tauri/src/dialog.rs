//! 应用起来之前的系统原生对话框。
//!
//! 绿色版的文件夹写不进、缺 WebView2、已经有一个实例在运行，这几件事都发生在
//! Tauri 起来之前，没有网页可用，只能用系统自己的对话框。只有 Windows 上有；
//! 其他平台上什么都不做。

/// 弹一个对话框，返回按下的按钮的下标；关掉对话框、或者这个平台不支持时是 `None`。
///
/// `buttons` 从左到右排，第一个是默认按钮。
pub fn show(title: &str, instruction: &str, content: &str, buttons: &[&str]) -> Option<usize> {
    #[cfg(windows)]
    {
        imp::show(title, instruction, content, buttons)
    }
    #[cfg(not(windows))]
    {
        let _ = (title, instruction, content, buttons);
        None
    }
}

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IDCANCEL, IDOK, MB_ICONINFORMATION, MB_OK, MB_OKCANCEL, MessageBoxW,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 骨架：`MessageBoxW`，按钮文字由系统定、最多两个。B 路换成 `TaskDialogIndirect`
    pub fn show(title: &str, instruction: &str, content: &str, buttons: &[&str]) -> Option<usize> {
        let text = wide(&format!("{instruction}\n\n{content}"));
        let caption = wide(title);
        let kind = if buttons.len() >= 2 {
            MB_OKCANCEL
        } else {
            MB_OK
        };
        // SAFETY: 两个指针都指向以 0 结尾、在调用期间一直活着的 UTF-16 缓冲区
        let r = unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                text.as_ptr(),
                caption.as_ptr(),
                kind | MB_ICONINFORMATION,
            )
        };
        match r {
            IDOK => Some(0),
            IDCANCEL if buttons.len() >= 2 => Some(1),
            _ => None,
        }
    }
}
