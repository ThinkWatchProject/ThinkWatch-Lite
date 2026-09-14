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

    #[test]
    fn dev_builds_refuse_to_register() {
        // debug 构建注册的话，plist 里会写 target/debug/…，然后每次开机
        // launchd 去启动一个可能已经 cargo clean 掉的二进制。
        assert_eq!(allowed_in_this_build(), !cfg!(debug_assertions));
    }

    #[test]
    fn the_plist_lives_next_to_the_other_launch_agents() {
        let p = plist_path("app.thinkwatch.lite").unwrap();
        assert!(p.ends_with("Library/LaunchAgents/app.thinkwatch.lite.plist"));
    }
}
