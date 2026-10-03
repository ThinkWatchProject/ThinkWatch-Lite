//! 开机自启。
//!
//! 结论见 **LaunchAgent 自启 GUI，GUI 再拉 sidecar**。
//! core 不单独注册 —— 那会在系统设置的登录项里出现两个条目、在活动监视器
//! 里出现两个后台项，而这直接违背「对用户来说这就是一个程序」。
//!
//! 这个模块处理插件给不了的那两件事：**路径漂移的校验**和**静默启动的
//! 判定**。
//!
//! **Linux 上连插件都不用**，自启项整个自己写（理由见 `linux` 子模块头上）。
//! 调用方一律经 [`launcher`] 拿开关、不直接碰插件 —— 这样 Linux 上不会有
//! 哪一处漏走插件那条路。**Windows 上设置里的开关也不经插件**，理由见
//! `approved_from_bytes` 上面那一段。

/// 纯文本的编码和解析在每个平台都编译，测试因此在哪都跑（和
/// `approved_from_bytes` 同一条理由）；读写文件那几样只有 Linux 调。
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub mod linux;

/// 开机自启的开关：`enable` / `disable` / `is_enabled`。
///
/// macOS、Windows 上是插件；Linux 上是自己写的那份 XDG 自启项。两边的错误
/// 类型不同，调用方只拿它来显示，都实现了 `Display`。
#[cfg(not(target_os = "linux"))]
pub fn launcher(
    app: &tauri::AppHandle,
) -> tauri::State<'_, tauri_plugin_autostart::AutoLaunchManager> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
}

#[cfg(target_os = "linux")]
pub fn launcher(app: &tauri::AppHandle) -> linux::Autostart {
    linux::Autostart::for_app(app)
}

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
#[cfg(not(target_os = "linux"))]
pub fn plist_path_matches(plist_contents: &str, current_exe: &str) -> bool {
    plist_contents.contains(current_exe)
}

/// 自启的 plist 在哪。
#[cfg(not(target_os = "linux"))]
pub fn plist_path(bundle_id: &str) -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(|h| {
        std::path::PathBuf::from(h)
            .join("Library/LaunchAgents")
            .join(format!("{bundle_id}.plist"))
    })
}

/// 开发构建里禁用自启（Windows 上连同链接、通知的登记，见 `winreg`）。
///
/// `cargo tauri dev` 期间调 `enable()` 会把 `target/debug/…` 写进 plist，
/// 然后每次开机 launchd 都会去启动一个可能已经被 `cargo clean` 掉的
/// 二进制。**这是个只在开发者自己机器上发作的坑**，所以更容易被忽略。
///
/// Windows 上自己编的 release 构建也算开发构建（见 `update::windows_kind`）：否则在
/// 开发机上跑一次 `target\release\…`，装好的那一份的链接和开机自启就改指向了它。
pub fn allowed_in_this_build() -> bool {
    #[cfg(windows)]
    {
        !cfg!(debug_assertions) && crate::update::kind() != crate::update::Install::Dev
    }
    #[cfg(not(windows))]
    {
        !cfg!(debug_assertions)
    }
}

// **Windows 上开关不经插件**，读写的是 `HKCU\…\Run` 里那一项，见 `winreg`。
//
// 那一项全机只有一条、安装版和绿色版共用，开关的意思随之变成「这台机器上开机时拉起
// ThinkWatch Lite」：指向哪一份都算开着，打开时写指向自己的，启动时把开着的那一条改成
// 指向正在运行的这一份（谁运行就听谁的）。插件做不到这些：它只认自己的路径，写的路径
// 还不加引号。
//
// 还有一件插件给不了的事：用户在「设置 → 应用 → 启动」里把它关掉之后，Windows 写的是
// `StartupApproved\Run` 里的一个标志，而 **`Run` 下的那一项原封不动** —— 只看那一项
// 在不在的话，界面上的开关会说「开着」，而开机时它不会被拉起来。所以「开着」还要看
// 这个标志，见下面的 `approved_from_bytes`。

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
pub(crate) fn approved_from_bytes(v: &[u8]) -> Option<bool> {
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

    #[cfg(not(target_os = "linux"))]
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
        if cfg!(debug_assertions) {
            assert!(!allowed_in_this_build());
        }
        // Windows 上测试程序（`target\…\deps` 里，旁边没有卸载程序、不是发版构建）
        // 怎么编都不算
        #[cfg(windows)]
        assert!(!allowed_in_this_build());
        #[cfg(not(windows))]
        assert_eq!(allowed_in_this_build(), !cfg!(debug_assertions));
    }

    /// **只在 macOS 上**：LaunchAgent 和 plist 是那个平台的机制。Windows 上
    /// 自启走 `HKCU\Run`，读写和路径跟随都在 `winreg`，测试也在那里。
    #[cfg(target_os = "macos")]
    #[test]
    fn the_plist_lives_next_to_the_other_launch_agents() {
        let p = plist_path("app.thinkwatch.lite").unwrap();
        assert!(p.ends_with("Library/LaunchAgents/app.thinkwatch.lite.plist"));
    }
}
