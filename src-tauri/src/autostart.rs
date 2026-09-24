//! 开机自启。
//!
//! 结论见 **LaunchAgent 自启 GUI，GUI 再拉 sidecar**。
//! core 不单独注册 —— 那会在系统设置的登录项里出现两个条目、在活动监视器
//! 里出现两个后台项，而这直接违背「对用户来说这就是一个程序」。
//!
//! 这个模块处理插件给不了的那两件事：**路径漂移的校验**和**静默启动的
//! 判定**。

/// 注册自启时塞进 argv 的标记。
///
/// macOS 13 起系统设置里登录项旁边的「隐藏」勾选框**被移除了**，而插件
/// 的 `--hidden` 在 LaunchAgent 模式下只是一个普通 argv 字符串，什么也
/// 不做。另一个流传的做法是读 `kAEOpenApplication` 这个 Apple Event ——
/// **对我们无效**，launchd 直接 exec 内层二进制，不经过 LaunchServices，
/// 那个事件根本不会送达。
///
/// 所以自己来：注册时塞标记，启动时看 argv。
pub const AUTOSTART_FLAG: &str = "--autostart";

/// 这次启动是开机自启拉起来的吗。
pub fn launched_by_autostart<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|a| a.as_ref() == AUTOSTART_FLAG)
}

/// plist 里记的路径还对吗。
///
/// **插件把 `enable()` 那一刻的绝对路径快照写进 plist**，指向
/// `.app/Contents/MacOS/` 里的内层二进制。用户把 App 从下载目录拖到
/// `/Applications` 之后，自启就静默失效了 —— 而插件的 `is_enabled()`
/// 只看文件在不在，仍然返回 `true`。
///
/// 所以每次启动都要比一次，不一致就重写。
pub fn plist_path_matches(plist_contents: &str, current_exe: &str) -> bool {
    plist_contents.contains(current_exe)
}

/// 自启的 plist 在哪。
pub fn plist_path(bundle_id: &str) -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(|h| {
        std::path::PathBuf::from(h)
            .join("Library/LaunchAgents")
            .join(format!("{bundle_id}.plist"))
    })
}

/// 开发构建里禁用自启。
///
/// `cargo tauri dev` 期间调 `enable()` 会把 `target/debug/…` 写进 plist，
/// 然后每次开机 launchd 都会去启动一个可能已经被 `cargo clean` 掉的
/// 二进制。**这是个只在开发者自己机器上发作的坑**，所以更容易被忽略。
pub fn allowed_in_this_build() -> bool {
    !cfg!(debug_assertions)
}

/// 用户在「设置 → 应用 → 启动」里把它关掉了吗。
///
/// **这是 Windows 上那第三件插件给不了的事**（前两件见模块头）。在那个开关里
/// 关掉之后，Windows 写的是 `StartupApproved\Run` 里的一个标志，而
/// **我们在 `Run` 下的那一项原封不动** —— 于是插件的 `is_enabled()`（它只看
/// `Run` 里那一项在不在）会说「开着呢」，而实际上开机时它不会被拉起来。
/// 界面上那个勾选框因此在撒谎，和 macOS 那个 plist 路径漂移是完全同一类。
///
/// `None` = 这个开关没碰过它（多数情况），按插件说的算。
#[cfg(windows)]
pub fn disabled_by_windows(app_name: &str) -> Option<bool> {
    use windows_sys::Win32::System::Registry::{
        HKEY_CURRENT_USER, RRF_RT_REG_BINARY, RegGetValueW,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let sub = wide(r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run");
    let name = wide(app_name);
    let mut buf = [0u8; 32];
    let mut len = buf.len() as u32;
    // SAFETY: 两个字符串都以 NUL 结尾；`len` 一开始是缓冲区的大小，函数不会
    // 写超过它。
    let rc = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            sub.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_BINARY,
            std::ptr::null_mut(),
            buf.as_mut_ptr().cast(),
            &mut len,
        )
    };
    if rc != 0 {
        return None;
    }
    approved_from_bytes(&buf[..len as usize]).map(|on| !on)
}

/// `StartupApproved\Run` 里那串字节说的是「开着」还是「被关掉了」。
///
/// 十二个字节，**只有第一个有意义**。已知的取值：`0x02` 开、`0x03` 关、
/// `0x06` 开（从「启动」文件夹来的那一档）。判据取最低位 —— `0x03` 就是在
/// `0x02` 上点亮了那一位，而 `0x06` 没点。**写成「等于 0x02 才算开」的话，
/// `0x06` 会被判成关掉了。**
///
/// 这个格式微软没有写明，是观察出来的。所以拿不准的一律当成「开着」：这一条
/// 只用来发现「用户在系统设置里关掉了它」，而把一个开着的说成关掉了，会让
/// 界面上那个勾选框自己跳回去 —— 比不查还糟。
///
/// **两个平台都编译它，尽管只有 Windows 会调。**它是一段纯粹的字节判断，
/// 而它要防的那个错（把 `0x06` 判成「关掉了」）在任何一台机器上都测得出来。
/// 把它 cfg 掉就等于把那条测试也 cfg 掉，于是它只在没人日常跑测试的平台上跑
/// —— 那和没有测试差不多。
///
/// （顺带：`clippy --all-targets` 看不出它在别处是死代码，因为测试目标用了
/// 它。单独编 lib 才会报。）
#[cfg_attr(not(windows), allow(dead_code))]
fn approved_from_bytes(v: &[u8]) -> Option<bool> {
    Some(v.first()? & 1 == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_flag_is_how_we_know_it_was_a_login_launch() {
        assert!(launched_by_autostart(["thinkwatch-lite", "--autostart"]));
        assert!(!launched_by_autostart(["thinkwatch-lite"]));
        // 别的参数不该被误当成自启
        assert!(!launched_by_autostart(["thinkwatch-lite", "--hidden"]));
    }

    #[test]
    fn a_moved_app_is_detected_by_comparing_paths() {
        // 用户把 App 从下载目录拖到 /Applications 之后，plist 里还指着
        // 旧路径 —— 而插件的 is_enabled() 只看文件在不在，会说「开着呢」。
        let plist =
            "<string>/Applications/ThinkWatch Lite.app/Contents/MacOS/thinkwatch-lite</string>";
        assert!(plist_path_matches(
            plist,
            "/Applications/ThinkWatch Lite.app/Contents/MacOS/thinkwatch-lite"
        ));
        assert!(!plist_path_matches(
            plist,
            "/Users/x/Downloads/ThinkWatch Lite.app/Contents/MacOS/thinkwatch-lite"
        ));
    }

    /// 已知的三个取值各是什么意思，以及**拿不准时当成开着**。
    #[test]
    fn the_startup_approved_flag_reads_the_low_bit() {
        // 0x02 开、0x03 关、0x06 开（「启动」文件夹那一档）
        assert_eq!(approved_from_bytes(&[0x02, 0, 0, 0]), Some(true));
        assert_eq!(approved_from_bytes(&[0x03, 0, 0, 0]), Some(false));
        assert_eq!(
            approved_from_bytes(&[0x06, 0, 0, 0]),
            Some(true),
            "写成「等于 0x02 才算开」的话这一条会挂"
        );
        // 一个字节都没有：答不上来，交给上面按「插件说的算」处理
        assert_eq!(approved_from_bytes(&[]), None);
    }

    #[test]
    fn dev_builds_refuse_to_register() {
        // debug 构建注册的话，plist 里会写 target/debug/…，然后每次开机
        // launchd 去启动一个可能已经 cargo clean 掉的二进制。
        assert_eq!(allowed_in_this_build(), !cfg!(debug_assertions));
    }

    /// **只在 macOS 上**：LaunchAgent 和 plist 是那个平台的机制。Windows 上
    /// 自启走 `HKCU\Run`，对应的那道检查（用户在「设置 → 应用 → 启动」里关掉
    /// 之后，Run 键还在、插件仍然说「开着」）是 `disabled_by_windows`，它自己
    /// 带着测试。
    #[cfg(target_os = "macos")]
    #[test]
    fn the_plist_lives_next_to_the_other_launch_agents() {
        let p = plist_path("app.thinkwatch.lite").unwrap();
        assert!(p.ends_with("Library/LaunchAgents/app.thinkwatch.lite.plist"));
    }
}
