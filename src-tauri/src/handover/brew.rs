//! `brew upgrade` 退出应用时认出它来（方案 8.3.2）。
//!
//! Homebrew 升级一个 cask 的顺序是：下好新版 → 执行旧版 cask 的 `uninstall quit:`（由
//! `osascript -l JavaScript` 向应用发一个退出 Apple Event，10 秒内没退出就告警继续）→ 换上
//! 新的 `.app` → `open -b` 重新打开。换上之后的重开和自动更新的「重启为新版本」是一回事，
//! 所以这次退出只要像自动更新一样 arm、不停 core，网关就不断。
//!
//! **难在分清这次退出是谁发起的。**同一个退出事件，用户在活动监视器里点「退出」、`brew
//! uninstall`、用户自己的脚本也会发；那些时候用户要的是网关跟着停。所以只认三项**同时**成立的：
//!
//! 1. 事件的发送进程（`keySenderPIDAttr`）是 `/usr/bin/osascript`；
//! 2. 它的父进程的可执行文件在**装这个应用的那份 Homebrew** 的前缀之下（Homebrew 的
//!    `system_command` 经 `/usr/bin/env` 起 osascript，env 是 exec 过去的，父进程就是跑
//!    `brew.rb` 的那个 Ruby；Ruby 是 Homebrew 自带的，在前缀里）；
//! 3. 父进程参数里 `brew.rb` 之后的子命令是 `upgrade` 或 `reinstall`（`brew.sh` 最后
//!    `exec ruby … brew.rb <命令> <参数>`，命令紧跟在 `brew.rb` 后面）。
//!
//! 系统注销、关机、重启发的退出事件带 `kAEQuitReason`，一律不算。**任何一项取不到就当普通
//! 退出**：判定只会漏判（漏了就是今天的行为，停掉 core），不会把普通退出当成升级。

use std::path::{Path, PathBuf};

/// 退出事件的发送方，判定要用到的几样。取不到的是 `None`
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Sender {
    /// 发送进程的可执行文件
    pub exe: Option<PathBuf>,
    /// 它的父进程的可执行文件
    pub parent_exe: Option<PathBuf>,
    /// 父进程的参数（`argv`，含 `argv[0]`）
    pub parent_args: Option<Vec<String>>,
}

/// Homebrew 发退出事件用的程序
const OSASCRIPT: &str = "/usr/bin/osascript";

/// 算升级的子命令。`reinstall` 同样是先退出、换上、再打开
const UPGRADES: [&str; 2] = ["upgrade", "reinstall"];

/// 这次退出是不是 `brew upgrade`（或 `brew reinstall`）发起的。
///
/// `system_quit`：事件带着 `kAEQuitReason`（注销、关机、重启）。`prefix`：装这个应用的那份
/// Homebrew 的前缀，不是 Homebrew 装的就是 `None` —— 那就不可能是它的升级
pub fn is_upgrade(sender: &Sender, prefix: Option<&Path>, system_quit: bool) -> bool {
    if system_quit {
        return false;
    }
    let Some(prefix) = prefix else {
        return false;
    };
    if sender.exe.as_deref() != Some(Path::new(OSASCRIPT)) {
        return false;
    }
    if !sender
        .parent_exe
        .as_deref()
        .is_some_and(|p| p.starts_with(prefix))
    {
        return false;
    }
    sender
        .parent_args
        .as_deref()
        .and_then(brew_command)
        .is_some_and(|c| UPGRADES.contains(&c))
}

/// 参数里 `brew.rb` 后面紧跟的那个子命令。没有 `brew.rb`（不是 Homebrew 的 Ruby）就是 `None`
fn brew_command(args: &[String]) -> Option<&str> {
    let at = args
        .iter()
        .position(|a| Path::new(a).file_name().is_some_and(|n| n == "brew.rb"))?;
    args.get(at + 1).map(String::as_str)
}

/// 解开 `sysctl(KERN_PROCARGS2)` 给的那一块：开头是 `argc`（本机字节序的 32 位整数），然后是
/// 可执行文件的路径和若干个补齐用的 NUL，再往后是 `argc` 个以 NUL 结尾的参数（之后是环境
/// 变量，不要）。
///
/// 形状不对（太短、参数个数对不上）就是 `None`：取不到，按普通退出算
pub fn parse_procargs2(buf: &[u8]) -> Option<Vec<String>> {
    let argc = i32::from_ne_bytes(buf.get(..4)?.try_into().ok()?);
    let argc = usize::try_from(argc).ok()?;
    let rest = &buf[4..];
    // 跳过可执行文件路径
    let mut at = rest.iter().position(|b| *b == 0)?;
    // 跳过补齐的 NUL
    while rest.get(at) == Some(&0) {
        at += 1;
    }
    let mut args = Vec::with_capacity(argc);
    for _ in 0..argc {
        let tail = rest.get(at..)?;
        let end = tail.iter().position(|b| *b == 0)?;
        args.push(String::from_utf8_lossy(&tail[..end]).into_owned());
        at += end + 1;
    }
    Some(args)
}

/// 刚收到的退出事件判成了升级。**只在主线程上写和读**：退出事件的处理函数和退出回调都在
/// 主线程的事件循环上
static UPGRADE_QUIT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 退出回调问：这次退出是不是 `brew upgrade` 发起的（见 [`super::arm_on_quit`]）
pub(crate) fn quit_was_upgrade() -> bool {
    UPGRADE_QUIT.load(std::sync::atomic::Ordering::SeqCst)
}

#[cfg(target_os = "macos")]
pub use macos::install_quit_handler;

#[cfg(target_os = "macos")]
mod macos {
    use std::path::PathBuf;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol};
    use objc2::{MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
    use objc2_app_kit::NSApplication;
    use objc2_foundation::{NSAppleEventDescriptor, NSAppleEventManager};

    use super::{Sender, UPGRADE_QUIT, is_upgrade};

    /// 四个字符的 Apple Event 代码
    const fn four(c: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*c)
    }
    const K_CORE_EVENT_CLASS: u32 = four(b"aevt");
    const K_AE_QUIT_APPLICATION: u32 = four(b"quit");
    /// 发送进程的 pid（`keySenderPIDAttr`）
    const KEY_SENDER_PID: u32 = four(b"spid");
    /// 注销、关机、重启时退出事件带着的理由（`kAEQuitReason`）
    const K_AE_QUIT_REASON: u32 = four(b"why?");

    define_class!(
        /// 退出事件的处理者：先判定来源、记下，再走原来的退出（`terminate:`）
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "ThinkWatchQuitHandler"]
        struct QuitHandler;

        impl QuitHandler {
            #[unsafe(method(handleQuit:withReplyEvent:))]
            fn handle_quit(&self, event: &NSAppleEventDescriptor, _reply: &NSAppleEventDescriptor) {
                let upgrade = from_brew_upgrade(event);
                if upgrade {
                    tracing::info!("退出事件来自 brew upgrade");
                }
                UPGRADE_QUIT.store(upgrade, std::sync::atomic::Ordering::SeqCst);
                // **交给原来的退出流程**：系统默认的处理函数做的也就是这一下
                let mtm = MainThreadMarker::from(self);
                NSApplication::sharedApplication(mtm).terminate(None);
            }
        }

        unsafe impl NSObjectProtocol for QuitHandler {}
    );

    thread_local! {
        /// Apple Event 管理器不持有处理者，这里拿着它活到进程结束
        static HANDLER: std::cell::OnceCell<Retained<QuitHandler>> = const { std::cell::OnceCell::new() };
    }

    /// 换上自己的退出事件处理函数。**在应用起来之后调**（setup 里）：系统在
    /// `finishLaunching` 时装默认的那一个，早于它装的会被盖掉
    pub fn install_quit_handler(mtm: MainThreadMarker) {
        let handler: Retained<QuitHandler> = unsafe { msg_send![QuitHandler::alloc(mtm), init] };
        let manager = NSAppleEventManager::sharedAppleEventManager();
        let target: &AnyObject = &handler;
        // SAFETY: 选择子和上面声明的方法同名同签名；类和事件号是 32 位的四字符代码
        unsafe {
            let _: () = msg_send![
                &*manager,
                setEventHandler: target,
                andSelector: sel!(handleQuit:withReplyEvent:),
                forEventClass: K_CORE_EVENT_CLASS,
                andEventID: K_AE_QUIT_APPLICATION
            ];
        }
        HANDLER.with(|h| {
            let _ = h.set(handler);
        });
    }

    /// 这个退出事件是不是 `brew upgrade` 发的
    fn from_brew_upgrade(event: &NSAppleEventDescriptor) -> bool {
        let system_quit = keyword(event, K_AE_QUIT_REASON, true).is_some()
            || keyword(event, K_AE_QUIT_REASON, false).is_some();
        if system_quit {
            return false;
        }
        let Some(prefix) = crate::update::homebrew_prefix() else {
            return false;
        };
        let pid = keyword(event, KEY_SENDER_PID, true).map(|d| d.int32Value());
        let sender = match pid {
            Some(pid) if pid > 0 => sender_of(pid),
            _ => Sender::default(),
        };
        is_upgrade(&sender, Some(&prefix), false)
    }

    /// 事件上的一项：`attribute` 为真取属性，否则取参数
    fn keyword(
        event: &NSAppleEventDescriptor,
        key: u32,
        attribute: bool,
    ) -> Option<Retained<NSAppleEventDescriptor>> {
        // SAFETY: 两个方法都只读这个描述符，关键字是四字符代码；没有这一项时返回空
        unsafe {
            if attribute {
                msg_send![event, attributeDescriptorForKeyword: key]
            } else {
                msg_send![event, paramDescriptorForKeyword: key]
            }
        }
    }

    /// 发送进程、它的父进程、父进程的参数。都是同一个用户读得到的信息
    fn sender_of(pid: i32) -> Sender {
        let parent = parent_of(pid);
        Sender {
            exe: path_of(pid),
            parent_exe: parent.and_then(path_of),
            parent_args: parent.and_then(args_of),
        }
    }

    /// 可执行文件的路径（`proc_pidpath`）
    fn path_of(pid: i32) -> Option<PathBuf> {
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        // SAFETY: 缓冲区的大小如实交出去，写进来的是以 NUL 结尾的路径，返回写了多少字节
        let n = unsafe { libc::proc_pidpath(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
        if n <= 0 {
            return None;
        }
        buf.truncate(n as usize);
        Some(PathBuf::from(String::from_utf8(buf).ok()?))
    }

    /// 父进程的 pid（`proc_pidinfo` 的 BSD 信息）
    fn parent_of(pid: i32) -> Option<i32> {
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
        // SAFETY: 结构体的大小如实交出去；成功时返回写进来的字节数
        let n = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast(),
                size,
            )
        };
        (n == size && info.pbi_ppid > 0).then_some(info.pbi_ppid as i32)
    }

    /// 进程的参数（`sysctl(KERN_PROCARGS2)`）
    fn args_of(pid: i32) -> Option<Vec<String>> {
        let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
        let mut size: libc::size_t = 0;
        // SAFETY: 先问要多大（缓冲区为空），再按问到的大小取
        unsafe {
            if libc::sysctl(
                mib.as_mut_ptr(),
                3,
                std::ptr::null_mut(),
                &mut size,
                std::ptr::null_mut(),
                0,
            ) != 0
            {
                return None;
            }
        }
        let mut buf = vec![0u8; size];
        unsafe {
            if libc::sysctl(
                mib.as_mut_ptr(),
                3,
                buf.as_mut_ptr().cast(),
                &mut size,
                std::ptr::null_mut(),
                0,
            ) != 0
            {
                return None;
            }
        }
        buf.truncate(size);
        super::parse_procargs2(&buf)
    }

    #[cfg(test)]
    mod tests {
        /// 本进程的参数读得出来，和标准库看到的一样（`KERN_PROCARGS2` 的解析在真机上对得上）
        #[test]
        fn our_own_arguments_read_back() {
            let pid = std::process::id() as i32;
            let args = super::args_of(pid).expect("读不到自己的参数");
            let std_args: Vec<String> = std::env::args().collect();
            assert_eq!(args, std_args);
            assert!(super::path_of(pid).is_some());
            assert!(super::parent_of(pid).is_some());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PREFIX: &str = "/opt/homebrew";
    const RUBY: &str = "/opt/homebrew/Library/Homebrew/vendor/portable-ruby/3.4.7/bin/ruby";
    const BREW_RB: &str = "/opt/homebrew/Library/Homebrew/brew.rb";

    fn ruby_args(command: &[&str]) -> Vec<String> {
        let mut a: Vec<String> = [RUBY, "-W1", "--disable=gems,rubyopt", BREW_RB]
            .iter()
            .map(|s| s.to_string())
            .collect();
        a.extend(command.iter().map(|s| s.to_string()));
        a
    }

    fn from_brew(command: &[&str]) -> Sender {
        Sender {
            exe: Some(OSASCRIPT.into()),
            parent_exe: Some(RUBY.into()),
            parent_args: Some(ruby_args(command)),
        }
    }

    fn judge(s: &Sender) -> bool {
        is_upgrade(s, Some(Path::new(PREFIX)), false)
    }

    /// 判定表：三项都成立的 `upgrade`、`reinstall` 才算升级
    #[test]
    fn only_an_upgrade_or_reinstall_from_this_homebrew_counts() {
        assert!(judge(&from_brew(&["upgrade", "--cask", "thinkwatch-lite"])));
        // `brew upgrade` 不带参数，一次升级所有过期的
        assert!(judge(&from_brew(&["upgrade"])));
        assert!(judge(&from_brew(&["reinstall", "thinkwatch-lite"])));
        // 卸载、别的子命令：网关跟着停
        assert!(!judge(&from_brew(&["uninstall", "thinkwatch-lite"])));
        assert!(!judge(&from_brew(&["install", "thinkwatch-lite"])));
        assert!(!judge(&from_brew(&[])));
    }

    /// 不是 osascript 发的（活动监视器、用户自己的程序）、父进程不在这份 Homebrew 的前缀里
    /// （用户自己的脚本里写了 brew.rb upgrade）：不算
    #[test]
    fn other_senders_are_ordinary_quits() {
        let mut s = from_brew(&["upgrade"]);
        s.exe = Some(
            "/System/Applications/Utilities/Activity Monitor.app/Contents/MacOS/Activity Monitor"
                .into(),
        );
        assert!(!judge(&s));

        let mut s = from_brew(&["upgrade"]);
        s.parent_exe = Some("/usr/bin/ruby".into());
        assert!(!judge(&s));

        // 另一份 Homebrew（Intel 的前缀）发的，而这一份是 /opt/homebrew 装的
        let mut s = from_brew(&["upgrade"]);
        s.parent_exe = Some(
            "/usr/local/Homebrew/Library/Homebrew/vendor/portable-ruby/current/bin/ruby".into(),
        );
        assert!(!judge(&s));

        // 父进程是 shell（用户在终端里直接跑 osascript）
        let s = Sender {
            exe: Some(OSASCRIPT.into()),
            parent_exe: Some("/bin/zsh".into()),
            parent_args: Some(vec!["-zsh".into()]),
        };
        assert!(!judge(&s));
    }

    /// **取不到任何一项都当普通退出**：只会漏判，不会误判
    #[test]
    fn anything_missing_is_an_ordinary_quit() {
        let full = from_brew(&["upgrade"]);
        for s in [
            Sender {
                exe: None,
                ..full.clone()
            },
            Sender {
                parent_exe: None,
                ..full.clone()
            },
            Sender {
                parent_args: None,
                ..full.clone()
            },
            Sender::default(),
        ] {
            assert!(!judge(&s), "{s:?}");
        }
        // 不是 Homebrew 装的这一份
        assert!(!is_upgrade(&full, None, false));
        // 参数里没有 brew.rb（父进程不是 brew 的 Ruby）
        let mut s = full.clone();
        s.parent_args = Some(vec![RUBY.into(), "-e".into(), "upgrade".into()]);
        assert!(!judge(&s));
    }

    /// 注销、关机、重启（带 `kAEQuitReason`）：哪怕别的都对上了也不算
    #[test]
    fn a_system_quit_is_never_an_upgrade() {
        assert!(!is_upgrade(
            &from_brew(&["upgrade"]),
            Some(Path::new(PREFIX)),
            true
        ));
    }

    fn procargs(argc: i32, exe: &str, pad: usize, args: &[&str], env: &[&str]) -> Vec<u8> {
        let mut b = argc.to_ne_bytes().to_vec();
        b.extend_from_slice(exe.as_bytes());
        b.extend(std::iter::repeat_n(0u8, pad));
        for a in args.iter().chain(env) {
            b.extend_from_slice(a.as_bytes());
            b.push(0);
        }
        b
    }

    #[test]
    fn procargs2_yields_the_arguments_and_not_the_environment() {
        let buf = procargs(
            3,
            RUBY,
            5,
            &[RUBY, BREW_RB, "upgrade"],
            &["HOME=/Users/x", "PATH=/usr/bin"],
        );
        assert_eq!(
            parse_procargs2(&buf),
            Some(vec![
                RUBY.to_string(),
                BREW_RB.to_string(),
                "upgrade".to_string()
            ])
        );
    }

    /// 截断的、个数对不上的、负数的：取不到
    #[test]
    fn a_malformed_procargs2_is_unreadable() {
        assert_eq!(parse_procargs2(&[1, 0]), None);
        let buf = procargs(4, RUBY, 1, &[RUBY, BREW_RB], &[]);
        assert_eq!(parse_procargs2(&buf), None);
        let buf = procargs(-1, RUBY, 1, &[RUBY], &[]);
        assert_eq!(parse_procargs2(&buf), None);
        let mut buf = procargs(1, RUBY, 1, &["abc"], &[]);
        buf.pop(); // 最后一个参数没有结尾的 NUL
        assert_eq!(parse_procargs2(&buf), None);
    }
}
