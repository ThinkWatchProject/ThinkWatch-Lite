//! 设置页：语言、外观、开机启动、提醒方式、菜单栏样式。

use std::sync::Arc;

use tauri::{Emitter, Manager};

use crate::{
    AppState, autostart, data_dir, error::Out, gateway::locate_core, i18n, menubar, notices, prefs,
    theme,
};

/// 这个应用自己的信息。
///
/// **排查时最先要问的就是这几个**：哪个版本、数据在哪、core 的二进制
/// 从哪儿找到的。之前这些散落在日志里，而用户交出一份诊断包之前根本
/// 看不到它们。
#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "version": app.package_info().version.to_string(),
        "identifier": app.config().identifier,
        "data_dir": data_dir().display().to_string(),
        // core 二进制的实际位置。找不到的时候把错误原样给出来 ——
        // 那条错误里列着找过哪些位置，正是这时候要看的东西。
        "core_bin": match locate_core(&app) {
            Ok(p) => p.display().to_string(),
            Err(e) => format!("{e}"),
        },
    })
}

/// 界面语言：现在用的、设置里选的、系统的。
///
/// 三个一起给：设置页要写成「跟随系统（简体中文）」，光有现在用的那一种
/// 说不出括号里那半句。
#[derive(serde::Serialize)]
pub struct LanguageView {
    current: i18n::Lang,
    /// `None` 是跟随系统
    setting: Option<i18n::Lang>,
    system: i18n::Lang,
}

pub(crate) fn language_view() -> LanguageView {
    LanguageView {
        current: i18n::current(),
        setting: prefs::load(&data_dir()).language,
        system: i18n::system(),
    }
}

#[tauri::command]
pub fn app_language() -> LanguageView {
    language_view()
}

/// 换语言。**开着的窗口当场换，托盘菜单跟着重建**，不用重启应用。
#[tauri::command]
pub fn set_language(app: tauri::AppHandle, setting: Option<i18n::Lang>) -> Out<LanguageView> {
    prefs::update(&data_dir(), |p| p.language = setting).map_err(|e| {
        tr!(
            format!("无法保存设置：{e:#}"),
            format!("The setting could not be saved: {e:#}")
        )
    })?;
    i18n::set(i18n::effective(setting));
    // 菜单栏的文案跟着换，不等下一个事件
    if let Some(state) = app.try_state::<AppState>() {
        state.menubar_now.notify_one();
    }
    let _ = app.emit("language-changed", i18n::current());
    Ok(language_view())
}

/// 界面外观：现在用的、设置里选的、系统的。三个一起给，理由同
/// [`LanguageView`]。
#[derive(serde::Serialize)]
pub struct ThemeView {
    current: theme::Theme,
    /// `None` 是跟随系统
    setting: Option<theme::Theme>,
    system: theme::Theme,
}

pub(crate) fn theme_view() -> ThemeView {
    let setting = prefs::load(&data_dir()).theme;
    ThemeView {
        current: theme::effective(setting),
        setting,
        system: theme::system(),
    }
}

#[tauri::command]
pub fn app_theme() -> ThemeView {
    theme_view()
}

/// 换外观。**当场生效** —— 换的是窗口的外观，网页里的
/// `prefers-color-scheme` 跟着翻，不用重启也不用重画。
#[tauri::command]
pub fn set_theme(app: tauri::AppHandle, setting: Option<theme::Theme>) -> Out<ThemeView> {
    prefs::update(&data_dir(), |p| p.theme = setting).map_err(|e| {
        tr!(
            format!("无法保存设置：{e:#}"),
            format!("The setting could not be saved: {e:#}")
        )
    })?;
    theme::apply(&app, setting);
    Ok(theme_view())
}

/// 开机自启现在是开着的吗。
///
/// **默认是关的,而且这不是「还没实现」,是产品决定。**一个装完就自己
/// 往登录项里写东西的工具,用户第一次发现它是在「系统设置 → 通用 →
/// 登录项」里看到一个自己没同意过的条目 —— 那一刻损失的信任,比自启
/// 省下的那点麻烦贵得多。
///
/// 所以:出厂不注册,界面上给一个勾选框,勾了才写 plist。
///
/// 开发构建里恒返回 false:`cargo tauri dev` 期间注册会把
/// `target/debug/…` 写进 plist,然后每次开机 launchd 都去启动一个可能
/// 已经被 `cargo clean` 掉的二进制。
#[tauri::command]
pub fn autostart_enabled(app: tauri::AppHandle) -> bool {
    if !autostart::allowed_in_this_build() {
        return false;
    }
    // Linux 上的 `is_enabled` 自己就认桌面「关掉了」的那两种写法，见
    // `autostart::linux::disabled_by_desktop`
    if !matches!(autostart::launcher(&app).is_enabled(), Ok(true)) {
        return false;
    }
    // **插件说「开着」还不够。**Windows 的「设置 → 应用 → 启动」里关掉之后，
    // 我们在 `Run` 下那一项原封不动，而插件只看那一项在不在 —— 见
    // `autostart::disabled_by_windows`。
    //
    // 键名问 `package_info().name` 要，**和插件写进去时用的是同一个来源**
    // （它就是这么取的），不是照着猜一个。
    #[cfg(windows)]
    if autostart::disabled_by_windows(&app.package_info().name) == Some(true) {
        return false;
    }
    true
}

/// 开或关开机自启。
///
/// 返回**实际生效的状态**而不是调用方传进来的那个 —— 注册可能失败
/// (沙盒、权限、只读的 LaunchAgents 目录),那时勾选框必须弹回去。
/// 回一个 `Ok(())` 让界面自己乐观地打上勾,是这类开关最常见的骗人方式。
#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, on: bool) -> Out<bool> {
    if !autostart::allowed_in_this_build() {
        return Err(tr!(
            "开发构建不支持开机启动",
            "Launch at login is not available in development builds"
        )
        .into());
    }
    // **插件不建目录。**它把 plist 直接写进 `~/Library/LaunchAgents/`，
    // 而那个目录在一台从没注册过登录项的 Mac 上根本不存在 —— 写文件
    // 得到的是 `No such file or directory (os error 2)`，一句既不说
    // 哪个文件、也不说该怎么办的话。
    //
    // 这不是边角情况：全新系统、新建用户、以及任何 HOME 被换掉的运行
    // 环境都会撞上。所以自己先建。（只有 macOS 写 plist；Linux 那份自己建目录）
    #[cfg(target_os = "macos")]
    if on
        && let Some(plist) = autostart::plist_path(&app.config().identifier)
        && let Some(dir) = plist.parent()
    {
        std::fs::create_dir_all(dir).map_err(|e| {
            tr!(
                format!("无法创建目录 {}：{e}", dir.display()),
                format!("The directory {} could not be created: {e}", dir.display())
            )
        })?;
    }
    let mgr = autostart::launcher(&app);
    let r = if on { mgr.enable() } else { mgr.disable() };
    r.map_err(|e| format!("{e}"))?;
    Ok(matches!(mgr.is_enabled(), Ok(true)))
}

/// 提醒现在是哪一档
#[tauri::command]
pub fn notice_mode(notices: tauri::State<'_, Arc<notices::Notices>>) -> notices::Mode {
    notices.mode()
}

/// 换一档。**先存盘再生效**：存不进去的话，界面弹回去，总线也还是原来那一档。
/// 工具栏的铃铛听 `notice-mode-changed` —— 关掉之后它不该还在那儿
#[tauri::command]
pub fn set_notice_mode(
    app: tauri::AppHandle,
    notices: tauri::State<'_, Arc<notices::Notices>>,
    mode: notices::Mode,
) -> Out<notices::Mode> {
    prefs::update(&data_dir(), |p| p.notices = mode).map_err(|e| {
        tr!(
            format!("无法保存设置：{e:#}"),
            format!("The setting could not be saved: {e:#}")
        )
    })?;
    notices.set_mode(mode);
    let _ = app.emit("notice-mode-changed", mode);
    Ok(mode)
}

/// 菜单栏上显示什么
#[tauri::command]
pub fn menubar_style() -> menubar::Style {
    menubar::style()
}

/// 换一档。**先存盘再生效**，和提醒那一档一样；改完菜单栏立刻重画
#[tauri::command]
pub fn set_menubar_style(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    style: menubar::Style,
) -> Out<menubar::Style> {
    prefs::update(&data_dir(), |p| p.menubar = style).map_err(|e| {
        tr!(
            format!("无法保存设置：{e:#}"),
            format!("The setting could not be saved: {e:#}")
        )
    })?;
    menubar::set_style(style);
    state.menubar_now.notify_one();
    let _ = app.emit("menubar-style-changed", style);
    Ok(style)
}

/// 第一次开机自启之后提示一次「我在菜单栏这儿」，之后永不再弹。
///
/// **每次开机都弹是噪音**，而噪音的代价是用户学会忽略通知 —— 包括那些
/// 真该看的（和守护的分级告知同一条理由）。
pub(crate) fn maybe_notify_first_autostart(app: &tauri::AppHandle) {
    let dir = data_dir();
    let marker = dir.join(".autostart-notified");
    if marker.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(&dir);
    // 先写标记再发通知。反过来的话，发通知失败会让它每次开机都重试，
    // 而那正是我们要避免的噪音。
    if std::fs::write(&marker, "1").is_err() {
        return;
    }
    // 窗口这时没开：只有系统通知说得到
    if let Some(n) = app.try_state::<Arc<notices::Notices>>() {
        // Windows 上没有菜单栏，图标在任务栏右侧的通知区域
        #[cfg(windows)]
        let (title, body) = (
            tr!(
                "ThinkWatch 已在通知区域运行",
                "ThinkWatch Is Running in the Notification Area"
            ),
            tr!(
                "开机时已自动启动。窗口关闭后，应用仍在通知区域中运行。",
                "It started at login. When the window is closed, the app keeps running in the notification area."
            ),
        );
        #[cfg(target_os = "linux")]
        let (title, body) = (
            tr!(
                "ThinkWatch 已在系统托盘运行",
                "ThinkWatch Is Running in the System Tray"
            ),
            tr!(
                "开机时已自动启动。窗口关闭后，应用仍在系统托盘中运行。",
                "It started at login. When the window is closed, the app keeps running in the system tray."
            ),
        );
        #[cfg(target_os = "macos")]
        let (title, body) = (
            tr!(
                "ThinkWatch 已在菜单栏运行",
                "ThinkWatch Is Running in the Menu Bar"
            ),
            tr!(
                "开机时已自动启动。窗口关闭后，应用仍在菜单栏中运行。",
                "It started at login. When the window is closed, the app keeps running in the menu bar."
            ),
        );
        n.announce("autostart", title, body);
    }
    tracing::info!("首次开机自启，已提示一次");
}

/// Linux 上的自启项是自己写的，路径核对也在那边（`$APPIMAGE` 挪了就重写）。
/// 开发构建不碰：否则开着自启的机器上跑一次 `cargo tauri dev`，自启项就被
/// 改指向 `target/debug/…`
#[cfg(target_os = "linux")]
pub(crate) fn check_autostart_path(app: &tauri::AppHandle) {
    if autostart::allowed_in_this_build() {
        autostart::launcher(app).repair();
    }
}

/// plist 里的路径还指着现在这个二进制吗。
///
/// 不一致就重新注册一次。这件事插件不做，而它的失败模式是**静默的**：
/// 开机之后什么都没发生，而设置里显示自启是开着的。
#[cfg(not(target_os = "linux"))]
pub(crate) fn check_autostart_path(app: &tauri::AppHandle) {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    if !matches!(mgr.is_enabled(), Ok(true)) {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let exe = exe.display().to_string();
    let Some(plist) = autostart::plist_path(&app.config().identifier) else {
        return;
    };
    let Ok(contents) = std::fs::read_to_string(&plist) else {
        return;
    };
    if autostart::plist_path_matches(&contents, &exe) {
        return;
    }
    tracing::warn!(
        plist = %plist.display(),
        current = %exe,
        "自启的 plist 指向旧路径（App 被挪过？），重新注册"
    );
    let _ = mgr.disable();
    if let Err(e) = mgr.enable() {
        tracing::error!("重新注册自启失败：{e}");
    }
}
