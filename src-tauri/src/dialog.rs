//! 应用起来之前的系统原生对话框。
//!
//! 绿色版的文件夹写不进、缺 WebView2、已经有一个实例在运行，这几件事都发生在
//! Tauri 起来之前，没有网页可用，只能用系统自己的对话框。只有 Windows 上有；
//! 其他平台上什么都不做。
//!
//! Windows 上是 `TaskDialogIndirect`：按钮上的字由这里定（`MessageBoxW` 只有系统给的
//! 「确定」「取消」，而且跟着系统语言，不跟应用设置的语言），主句加大、正文另起。它只在
//! comctl32 的第 6 版里有，而那一版要靠程序清单里的依赖才拿得到 —— tauri-build 给 exe
//! 嵌的默认清单里有（`common-controls-v6`），**测试程序没有**。所以不静态链接它，用的时候
//! 现取：取不到（没有清单的进程）就退回 `MessageBoxW`。静态链接的话，测试程序会因为
//! 缺这个入口点根本起不来。

/// 弹一个对话框，返回按下的按钮的下标；关掉对话框、或者这个平台不支持时是 `None`。
///
/// `instruction` 是加大显示的那一句主句，`content` 是它下面的正文（可以为空）。
/// `buttons` 从左到右排，第一个是默认按钮，字原样显示。没有父窗口：调用的时候
/// Tauri 还没起来，进程里没有别的窗口。
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

/// 一边在另一个线程上跑 `work`，一边显示一个等待的对话框（主句、正文和一条来回走的
/// 进度条）；`work` 一结束对话框就关掉，返回 `work` 的结果。
///
/// **这个对话框关不掉。**唯一的按钮「取消」是灰的，Esc、Alt+F4、标题栏的关闭按钮都
/// 不管用：等的那件事一旦开始就收不回来（比如已经请运行中的程序退出了），这时放弃只会
/// 两头落空。所以 `work` 自己要有上限。`work` 发生 panic 也会关掉对话框，panic 照旧
/// 传给调用方。
///
/// 对话框占着调用它的线程跑消息循环，`work` 因此在另一个线程上跑，要能 `Send`；它可以
/// 借用调用方手里的东西。不是 Windows、或者系统对话框用不了时，直接在当前线程上跑
/// `work`，什么都不显示。
pub fn wait<T: Send>(
    title: &str,
    instruction: &str,
    content: &str,
    work: impl FnOnce() -> T + Send,
) -> T {
    #[cfg(windows)]
    {
        imp::wait(title, instruction, content, work)
    }
    #[cfg(not(windows))]
    {
        let _ = (title, instruction, content);
        work()
    }
}

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicBool, Ordering};

    use windows_sys::Win32::Foundation::{HWND, LPARAM, S_FALSE, S_OK, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::{
        GetModuleHandleW, GetProcAddress, LOAD_LIBRARY_SEARCH_SYSTEM32, LoadLibraryExW,
    };
    use windows_sys::Win32::UI::Controls::{
        TASKDIALOG_BUTTON, TASKDIALOGCONFIG, TDF_ALLOW_DIALOG_CANCELLATION, TDF_CALLBACK_TIMER,
        TDF_SHOW_MARQUEE_PROGRESS_BAR, TDM_CLICK_BUTTON, TDM_ENABLE_BUTTON,
        TDM_SET_PROGRESS_BAR_MARQUEE, TDN_BUTTON_CLICKED, TDN_CREATED, TDN_TIMER,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IDCANCEL, IDOK, MB_ICONINFORMATION, MB_OK, MB_OKCANCEL, MessageBoxW, PostMessageW,
        SendMessageW,
    };
    use windows_sys::core::{BOOL, HRESULT};

    /// 自定义按钮的编号从这里起：避开 `IDOK`、`IDCANCEL` 这些系统按钮的编号
    const FIRST_BUTTON: i32 = 100;

    type TaskDialogIndirect = unsafe extern "system" fn(
        config: *const TASKDIALOGCONFIG,
        button: *mut i32,
        radio: *mut i32,
        verified: *mut BOOL,
    ) -> HRESULT;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 现取 `TaskDialogIndirect`，见模块说明。**只在系统目录里找**（和清单指定的并排
    /// 程序集）：绿色版的文件夹在哪都可能，不能让旁边一个同名的 dll 被加载进来
    fn task_dialog() -> Option<TaskDialogIndirect> {
        let name = wide("comctl32.dll");
        // SAFETY: 名字以 0 结尾。模块不释放：对话框随时可能再用到它，进程退出时自然卸载
        let module = unsafe {
            LoadLibraryExW(
                name.as_ptr(),
                std::ptr::null_mut(),
                LOAD_LIBRARY_SEARCH_SYSTEM32,
            )
        };
        if module.is_null() {
            return None;
        }
        // SAFETY: 模块句柄有效，名字以 0 结尾
        let f = unsafe { GetProcAddress(module, c"TaskDialogIndirect".as_ptr().cast()) }?;
        // SAFETY: 导出的就是这个签名（commctrl.h）
        Some(unsafe {
            std::mem::transmute::<unsafe extern "system" fn() -> isize, TaskDialogIndirect>(f)
        })
    }

    /// 对话框所在的线程按每个显示器的 DPI 画。**不设的话在缩放过的屏幕上是糊的**：这时
    /// Tauri 还没把进程设成感知 DPI。只改这个线程，用完改回去，不动整个进程的设置
    /// （那是 Tauri 起来时自己要设的）。系统太旧、没有这个函数就算了
    struct SharpText(Option<(SetContext, isize)>);

    type SetContext = unsafe extern "system" fn(isize) -> isize;

    impl SharpText {
        fn on() -> Self {
            // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
            const PER_MONITOR_V2: isize = -4;
            let user32 = wide("user32.dll");
            // SAFETY: 名字以 0 结尾；user32 一定已经加载（`MessageBoxW` 就从它导入）
            let set = unsafe {
                let module = GetModuleHandleW(user32.as_ptr());
                if module.is_null() {
                    return Self(None);
                }
                GetProcAddress(module, c"SetThreadDpiAwarenessContext".as_ptr().cast())
            };
            let Some(set) = set else {
                return Self(None);
            };
            // SAFETY: 签名见 winuser.h，DPI_AWARENESS_CONTEXT 是一个指针大小的句柄
            let set = unsafe {
                std::mem::transmute::<unsafe extern "system" fn() -> isize, SetContext>(set)
            };
            // SAFETY: 传的是系统定义的伪句柄；返回原来的设置，失败是 0
            let before = unsafe { set(PER_MONITOR_V2) };
            Self((before != 0).then_some((set, before)))
        }
    }

    impl Drop for SharpText {
        fn drop(&mut self) {
            if let Some((set, before)) = self.0 {
                // SAFETY: 还原成 `on` 时拿到的那个设置
                unsafe { set(before) };
            }
        }
    }

    pub fn show(title: &str, instruction: &str, content: &str, buttons: &[&str]) -> Option<usize> {
        let Some(dialog) = task_dialog() else {
            return message_box(title, instruction, content, buttons);
        };
        let _sharp = SharpText::on();
        let title_w = wide(title);
        let instruction_w = wide(instruction);
        let content_w = wide(content);
        let labels: Vec<Vec<u16>> = buttons.iter().map(|b| wide(b)).collect();
        let specs: Vec<TASKDIALOG_BUTTON> = labels
            .iter()
            .zip(FIRST_BUTTON..)
            .map(|(label, id)| TASKDIALOG_BUTTON {
                nButtonID: id,
                pszButtonText: label.as_ptr(),
            })
            .collect();
        let config = TASKDIALOGCONFIG {
            cbSize: std::mem::size_of::<TASKDIALOGCONFIG>() as u32,
            // 标题栏的关闭按钮和 Esc 能关掉它，算「没选」
            dwFlags: TDF_ALLOW_DIALOG_CANCELLATION,
            pszWindowTitle: title_w.as_ptr(),
            pszMainInstruction: instruction_w.as_ptr(),
            pszContent: if content.is_empty() {
                std::ptr::null()
            } else {
                content_w.as_ptr()
            },
            cButtons: specs.len() as u32,
            pButtons: specs.as_ptr(),
            nDefaultButton: FIRST_BUTTON,
            ..Default::default()
        };
        let mut pressed = 0;
        // SAFETY: 配置里的每个指针都指向上面那几个在调用期间一直活着的缓冲区
        let hr = unsafe {
            dialog(
                &config,
                &mut pressed,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if hr < 0 {
            tracing::warn!(hr, "系统对话框没能弹出来，换成简单的那一种");
            return message_box(title, instruction, content, buttons);
        }
        usize::try_from(pressed - FIRST_BUTTON)
            .ok()
            .filter(|&i| i < buttons.len())
    }

    /// 等待对话框唯一的那个按钮。它一直是灰的，只在 `work` 结束时由这里按下去
    const WAIT_BUTTON: i32 = FIRST_BUTTON;

    pub fn wait<T: Send>(
        title: &str,
        instruction: &str,
        content: &str,
        work: impl FnOnce() -> T + Send,
    ) -> T {
        let Some(dialog) = task_dialog() else {
            return work();
        };
        let done = AtomicBool::new(false);
        std::thread::scope(|scope| {
            let worker = scope.spawn(|| {
                // panic 也要放下这个记号，否则对话框永远等下去
                struct Done<'a>(&'a AtomicBool);
                impl Drop for Done<'_> {
                    fn drop(&mut self) {
                        self.0.store(true, Ordering::SeqCst);
                    }
                }
                let _done = Done(&done);
                work()
            });

            let _sharp = SharpText::on();
            let title_w = wide(title);
            let instruction_w = wide(instruction);
            let content_w = wide(content);
            let cancel = wide(tr!("取消", "Cancel"));
            let button = TASKDIALOG_BUTTON {
                nButtonID: WAIT_BUTTON,
                pszButtonText: cancel.as_ptr(),
            };
            let config = TASKDIALOGCONFIG {
                cbSize: std::mem::size_of::<TASKDIALOGCONFIG>() as u32,
                // 不加 TDF_ALLOW_DIALOG_CANCELLATION：没有「取消」类的系统按钮时，
                // 关闭按钮、Esc、Alt+F4 都不管用
                dwFlags: TDF_SHOW_MARQUEE_PROGRESS_BAR | TDF_CALLBACK_TIMER,
                pszWindowTitle: title_w.as_ptr(),
                pszMainInstruction: instruction_w.as_ptr(),
                pszContent: if content.is_empty() {
                    std::ptr::null()
                } else {
                    content_w.as_ptr()
                },
                cButtons: 1,
                pButtons: &button,
                nDefaultButton: WAIT_BUTTON,
                pfCallback: Some(waiting),
                lpCallbackData: &done as *const AtomicBool as isize,
                ..Default::default()
            };
            // SAFETY: 配置里的指针都指向在调用期间活着的缓冲区；回调拿到的是 `done` 的
            // 地址，而对话框关掉之前这个函数不会返回
            let hr = unsafe {
                dialog(
                    &config,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                )
            };
            if hr < 0 {
                tracing::warn!(hr, "等待的对话框没能弹出来，不显示，照样等");
            }
            match worker.join() {
                Ok(out) => out,
                Err(panic) => std::panic::resume_unwind(panic),
            }
        })
    }

    /// 等待对话框的回调，跑在对话框的线程上。
    ///
    /// 系统每隔约 200 毫秒叫一次 `TDN_TIMER`，看到 `work` 结束了就把按钮按下去：
    /// 对话框只能从它自己的线程上关，这样不用跨线程发消息找它
    unsafe extern "system" fn waiting(
        hwnd: HWND,
        msg: u32,
        _: WPARAM,
        _: LPARAM,
        data: isize,
    ) -> HRESULT {
        // SAFETY: `data` 是 `wait` 里 `done` 的地址，对话框关掉之前它一直活着
        let done = unsafe { &*(data as *const AtomicBool) };
        let finished = done.load(Ordering::SeqCst);
        match msg as i32 {
            TDN_CREATED => {
                // SAFETY: 发给对话框自己的窗口，在它自己的线程上
                unsafe {
                    SendMessageW(hwnd, TDM_SET_PROGRESS_BAR_MARQUEE as u32, 1, 0);
                    SendMessageW(hwnd, TDM_ENABLE_BUTTON as u32, WAIT_BUTTON as usize, 0);
                }
                S_OK
            }
            TDN_TIMER if finished => {
                // 灰的按钮按不下去：先点亮，再排一个「按下」到消息队列里
                // SAFETY: 同上
                unsafe {
                    SendMessageW(hwnd, TDM_ENABLE_BUTTON as u32, WAIT_BUTTON as usize, 1);
                    PostMessageW(hwnd, TDM_CLICK_BUTTON as u32, WAIT_BUTTON as usize, 0);
                }
                S_OK
            }
            // 没等完的时候，不管从哪来的「按下」都不让它关
            TDN_BUTTON_CLICKED if !finished => S_FALSE,
            _ => S_OK,
        }
    }

    /// 取不到 `TaskDialogIndirect` 时的退路：按钮上的字由系统定，最多两个 ——
    /// 第一个对「确定」，第二个对「取消」
    fn message_box(
        title: &str,
        instruction: &str,
        content: &str,
        buttons: &[&str],
    ) -> Option<usize> {
        let text = if content.is_empty() {
            wide(instruction)
        } else {
            wide(&format!("{instruction}\n\n{content}"))
        };
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
            IDOK if !buttons.is_empty() => Some(0),
            IDCANCEL if buttons.len() >= 2 => Some(1),
            _ => None,
        }
    }
}
