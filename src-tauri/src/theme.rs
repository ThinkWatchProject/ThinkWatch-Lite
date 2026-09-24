//! 界面外观：浅色、深色，或者跟随系统。
//!
//! **换的是窗口的外观，不是一套 CSS。**shadcn 的常规做法是在 `<html>` 上
//! 挂一个 `.dark` 类，并把 Tailwind 的 `dark:` 重定义成「祖先有这个类」；
//! 这个项目没有那个类，两百多处 `dark:` 走的是 `prefers-color-scheme`
//! （`src/index.css` 开头那段说的就是这件事）。改成类切换，等于把那两百多
//! 处一起作废，再补一段在首屏之前跑的内联脚本。
//!
//! 所以这里换的是 `NSApp` 的外观：WKWebView 继承它，网页里的
//! `prefers-color-scheme` 跟着翻，**界面一行 CSS 都不用改**。
//!
//! 代价是它在 macOS 上是应用级的（Tauri 的 `set_theme` 文档写明了），不是
//! 单个窗口的 —— 对一个只有一个窗口的应用来说，正是想要的那个范围。菜单栏
//! 上那个图标不受影响：它是模板图，靠 alpha 跟随菜单栏自己的亮暗。
//!
//! **Linux 上换的是 GTK 的 `gtk-application-prefer-dark-theme`。**tao 的
//! `set_theme` 写的就是这一项（进程级），WebKitGTK 按它定
//! `prefers-color-scheme`，它一变当场重算。但 GTK 3 自己不知道系统是深是浅
//! —— GNOME 的深色模式只写在 xdg-desktop-portal 的
//! `org.freedesktop.appearance color-scheme` 里 —— 所以「跟随系统」在那里
//! 不能交给窗口：由 [`linux`] 读 portal，把答案当成一次选择写进去，系统切换
//! 时再写一次。
//!
//! **tao 自己那一份 portal 监听是关掉的**（`Cargo.toml` 里 tauri 去掉了
//! `dbus` 特性）。它在系统切换时无条件写这一项，会把用户强制选的那一档
//! 冲掉。

use tauri::Manager;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
}

impl From<Theme> for tauri::Theme {
    fn from(t: Theme) -> Self {
        match t {
            Theme::Light => tauri::Theme::Light,
            Theme::Dark => tauri::Theme::Dark,
        }
    }
}

/// 系统现在是深色还是浅色。
///
/// **读 `AppleInterfaceStyle`，不问窗口。**窗口的 `theme()` 返回的是当前
/// 生效的那个 —— 一旦设过覆盖，它答的就是我们自己刚写进去的值，而设置页
/// 要说的是「跟随系统会得到什么」。这个用户默认项只反映系统的设置。
pub fn system() -> Theme {
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSString, NSUserDefaults};
        let defaults = NSUserDefaults::standardUserDefaults();
        let key = NSString::from_str("AppleInterfaceStyle");
        // 浅色时这一项根本不存在，深色时是 "Dark"
        let dark = defaults
            .stringForKey(&key)
            .is_some_and(|v| v.to_string().eq_ignore_ascii_case("dark"));
        if dark { Theme::Dark } else { Theme::Light }
    }
    #[cfg(windows)]
    {
        match apps_use_light_theme() {
            Some(0) => Theme::Dark,
            Some(_) => Theme::Light,
            // 读不到就当浅色。**这一项在没有深色模式的那些 Windows 上根本
            // 不存在**，所以「没有这个值」和「用户选了浅色」在这里是同一件事。
            None => Theme::Light,
        }
    }
    #[cfg(target_os = "linux")]
    {
        linux::system()
    }
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    Theme::Light
}

/// `HKCU\…\Themes\Personalize\AppsUseLightTheme`：0 是深色，1 是浅色。
///
/// **读 `AppsUseLightTheme`，不读旁边那个 `SystemUsesLightTheme`。**后者管的是
/// 任务栏和开始菜单，而这两项是分开的 —— 用户完全可以让系统深、应用浅。我们
/// 要跟的是应用那一档，因为这个应用就是一个应用。
#[cfg(windows)]
fn apps_use_light_theme() -> Option<u32> {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RegGetValueW};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let sub = wide(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
    let name = wide("AppsUseLightTheme");
    let mut val: u32 = 0;
    let mut len = std::mem::size_of::<u32>() as u32;
    // SAFETY: 两个字符串都以 NUL 结尾；出参是本地变量，`len` 一开始就是那块
    // 内存的大小，函数不会写超过它。
    let rc = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            sub.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            (&raw mut val).cast(),
            &mut len,
        )
    };
    (rc == 0).then_some(val)
}

/// 设置里的选择落到实际用哪一种。
pub fn effective(setting: Option<Theme>) -> Theme {
    setting.unwrap_or_else(system)
}

/// 把选择应用到窗口上。`None` 是交还给系统。
///
/// **传 `None` 而不是 `Some(system())`。**两者当下画出来一样，但前者之后
/// 跟着系统走，后者会把这一刻的样子钉死 —— 用户在系统设置里切换时，界面
/// 不动。
///
/// Linux 例外：那里 `None` 的意思是「不偏好深色」，也就是浅色。跟随系统得把
/// 系统现在的答案写进去，之后由 [`linux`] 盯着系统再改。
pub fn apply(app: &tauri::AppHandle, setting: Option<Theme>) {
    #[cfg(target_os = "linux")]
    {
        linux::remember(setting);
        paint(app, Some(effective(setting).into()));
    }
    #[cfg(not(target_os = "linux"))]
    paint(app, setting.map(Into::into));
}

/// **应用级和窗口级都设。**应用级那一下管的是还没建出来的窗口：启动时设外观
/// 的时候一个窗口都还没有，只逐个窗口设的话，存下来的选择要等用户再点一次
/// 才生效。
fn paint(app: &tauri::AppHandle, want: Option<tauri::Theme>) {
    app.set_theme(want);
    for (_, w) in app.webview_windows() {
        let _ = w.set_theme(want);
    }
}

/// 启动时调一次，在任何窗口出现之前。
///
/// Linux 上先把系统现在是哪一档问清楚（最多等一小会儿），再开始听它的变化；
/// 别处跟随系统是窗口自己的事，这里只是把存下来的选择设上。
pub fn init(app: &tauri::AppHandle, setting: Option<Theme>) {
    #[cfg(target_os = "linux")]
    {
        // 先记下选择再开始听：听的那条线程据此判断系统变了要不要跟
        linux::remember(setting);
        linux::watch(app);
    }
    apply(app, setting);
}

/// Linux 的系统外观：portal 优先，GTK 主题兜底。
///
/// **读一次、记下来、之后只听变化。**`system()` 在同步命令里被调用，而同步
/// 命令跑在主线程上 —— 在那里等一次 D-Bus 往返，portal 卡住时整个界面跟着卡。
#[cfg(target_os = "linux")]
mod linux {
    use super::Theme;
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::mpsc;
    use std::time::Duration;
    use zbus::zvariant::{OwnedValue, Value};

    const NAMESPACE: &str = "org.freedesktop.appearance";
    const KEY: &str = "color-scheme";

    /// 系统现在是哪一档。0 是还不知道
    static SYSTEM: AtomicU8 = AtomicU8::new(0);
    /// 设置里选的。0 是跟随系统
    static CHOICE: AtomicU8 = AtomicU8::new(0);

    /// 启动时等 portal 回答的上限。平常几毫秒；等不到就先用 GTK 猜的那一档
    /// 画第一帧，portal 答了再换 —— 不能为了它让窗口晚出来
    const FIRST_ANSWER: Duration = Duration::from_millis(300);

    fn code(t: Option<Theme>) -> u8 {
        match t {
            None => 0,
            Some(Theme::Light) => 1,
            Some(Theme::Dark) => 2,
        }
    }

    fn decode(c: u8) -> Option<Theme> {
        match c {
            1 => Some(Theme::Light),
            2 => Some(Theme::Dark),
            _ => None,
        }
    }

    pub fn system() -> Theme {
        decode(SYSTEM.load(Ordering::Relaxed)).unwrap_or(Theme::Light)
    }

    pub fn remember(setting: Option<Theme>) {
        CHOICE.store(code(setting), Ordering::Relaxed);
    }

    /// portal 的 `color-scheme`：1 偏好深色，2 偏好浅色，0 没有偏好。
    ///
    /// **0 不等于浅色。**没有偏好时交给 GTK 主题去猜：一个没有深色开关、
    /// 但主题本身是 `Adwaita-dark` 的桌面，portal 报的就是 0。
    pub(super) fn from_scheme(scheme: u32, gtk: Theme) -> Theme {
        match scheme {
            1 => Theme::Dark,
            2 => Theme::Light,
            _ => gtk,
        }
    }

    /// `Read` 把值包了两层 variant（这个方法的已知毛病，`ReadOne` 才改掉，
    /// 而老的 portal 没有 `ReadOne`），信号里是一层。一律剥到底。
    pub(super) fn scheme_of(v: &Value<'_>) -> Option<u32> {
        match v {
            Value::U32(n) => Some(*n),
            Value::Value(inner) => scheme_of(inner),
            _ => None,
        }
    }

    /// portal 不在时的退路：GTK 自己的设置。**必须在主线程上调**，GTK 不是
    /// 线程安全的。
    ///
    /// `gtk-application-prefer-dark-theme` 只在我们写它之前读才算数 —— 写过
    /// 之后读到的是我们自己的选择，和 macOS 那一支不问窗口是一个道理。所以
    /// 这个函数只在 [`watch`] 开头、第一次 [`super::apply`] 之前跑一次。
    fn gtk_guess() -> Theme {
        use gtk::prelude::*;
        // `GTK_THEME=Adwaita:dark` 这种写法盖过设置
        if let Ok(t) = std::env::var("GTK_THEME") {
            return if t.to_ascii_lowercase().ends_with(":dark") {
                Theme::Dark
            } else {
                Theme::Light
            };
        }
        let Some(s) = gtk::Settings::default() else {
            return Theme::Light;
        };
        let name = s
            .gtk_theme_name()
            .map(|n| n.to_ascii_lowercase())
            .unwrap_or_default();
        if s.is_gtk_application_prefer_dark_theme() || name.ends_with("-dark") {
            Theme::Dark
        } else {
            Theme::Light
        }
    }

    /// 问一次 portal，然后在一条自己的线程上一直听它的 `SettingChanged`。
    ///
    /// 用的是 zbus 的阻塞接口和一条普通线程：整个应用里只有这一个长期监听，
    /// 为它把异步的那一套牵进来不值得。连不上会话总线（没有桌面的环境）、
    /// portal 不在或者不认这一项，都安静地停在 GTK 猜的那一档。
    pub fn watch(app: &tauri::AppHandle) {
        let gtk = gtk_guess();
        SYSTEM.store(code(Some(gtk)), Ordering::Relaxed);
        let (tx, rx) = mpsc::channel::<()>();
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("theme-portal".into())
            .spawn(move || {
                let heard = listen(PORTAL, gtk, &tx, |now| update(&app, now));
                if let Err(e) = heard {
                    tracing::debug!("the desktop portal did not report the color scheme: {e}");
                }
                // 失败时也要放行启动那一头，不让它白等到超时
                let _ = tx.send(());
            });
        if spawned.is_ok() {
            let _ = rx.recv_timeout(FIRST_ANSWER);
        }
    }

    /// portal 在会话总线上的名字。测试里换成一个假的
    const PORTAL: &str = "org.freedesktop.portal.Desktop";
    pub(super) const PATH: &str = "/org/freedesktop/portal/desktop";

    /// 系统每答一次（启动时读的那一次、之后每次切换）就交给 `heard` 一次。
    ///
    /// **先订阅、再读。**反过来的话，读完到订阅上之间那一下切换就丢了。
    pub(super) fn listen(
        portal: &str,
        gtk: Theme,
        ready: &mpsc::Sender<()>,
        heard: impl Fn(Theme),
    ) -> zbus::Result<()> {
        let conn = zbus::blocking::Connection::session()?;
        let proxy = zbus::blocking::Proxy::new(
            &conn,
            portal.to_string(),
            PATH,
            "org.freedesktop.portal.Settings",
        )?;
        let changes = proxy.receive_signal("SettingChanged")?;
        // 读不到（portal 太老、不认这一项）不算失败：变化的信号可能照样会来
        if let Ok(v) = proxy.call::<_, _, OwnedValue>("Read", &(NAMESPACE, KEY))
            && let Some(scheme) = scheme_of(&v)
        {
            heard(from_scheme(scheme, gtk));
        }
        let _ = ready.send(());
        for msg in changes {
            let Ok((ns, key, v)) = msg.body().deserialize::<(String, String, OwnedValue)>() else {
                continue;
            };
            if ns == NAMESPACE
                && key == KEY
                && let Some(scheme) = scheme_of(&v)
            {
                heard(from_scheme(scheme, gtk));
            }
        }
        Ok(())
    }

    /// 记下系统这一档；设置里是跟随系统的话，当场换过去。
    fn update(app: &tauri::AppHandle, now: Theme) {
        let before = SYSTEM.swap(code(Some(now)), Ordering::Relaxed);
        if before != code(Some(now)) && decode(CHOICE.load(Ordering::Relaxed)).is_none() {
            super::paint(app, Some(now.into()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 1 深、2 浅、0 交给 GTK 猜；值在一层还是两层 variant 里都认得出来。
    #[cfg(target_os = "linux")]
    #[test]
    fn the_portal_answer_is_read_through_any_nesting() {
        use zbus::zvariant::Value;
        assert_eq!(linux::from_scheme(1, Theme::Light), Theme::Dark);
        assert_eq!(linux::from_scheme(2, Theme::Dark), Theme::Light);
        assert_eq!(linux::from_scheme(0, Theme::Dark), Theme::Dark);
        assert_eq!(linux::from_scheme(0, Theme::Light), Theme::Light);

        let once = Value::Value(Box::new(Value::U32(1)));
        let twice = Value::Value(Box::new(Value::Value(Box::new(Value::U32(1)))));
        assert_eq!(linux::scheme_of(&Value::U32(2)), Some(2));
        assert_eq!(linux::scheme_of(&once), Some(1));
        assert_eq!(linux::scheme_of(&twice), Some(1));
        assert_eq!(linux::scheme_of(&Value::from("dark")), None);
    }

    /// 对着一个假的 portal 真走一遍 D-Bus：启动时读到的那一档（值包两层，和真的
    /// portal 一样），之后的切换；别的设置项变了不算。
    ///
    /// 要会话总线：CI 里整个 `cargo test` 套在 `dbus-run-session` 里。假 portal
    /// 用一个自己的名字，开着真 portal 的桌面上跑也不会撞上。
    #[cfg(target_os = "linux")]
    #[test]
    fn the_portal_is_read_once_and_then_followed() {
        use std::sync::mpsc;
        use std::time::Duration;
        use zbus::object_server::SignalEmitter;
        use zbus::zvariant::{OwnedValue, Value};

        struct Fake;
        #[zbus::interface(name = "org.freedesktop.portal.Settings")]
        impl Fake {
            fn read(&self, namespace: &str, key: &str) -> zbus::fdo::Result<OwnedValue> {
                if (namespace, key) != ("org.freedesktop.appearance", "color-scheme") {
                    return Err(zbus::fdo::Error::Failed("no such setting".into()));
                }
                Ok(OwnedValue::try_from(Value::Value(Box::new(Value::U32(1)))).unwrap())
            }

            #[zbus(signal)]
            async fn setting_changed(
                emitter: &SignalEmitter<'_>,
                namespace: &str,
                key: &str,
                value: Value<'_>,
            ) -> zbus::Result<()>;
        }

        let name = format!("app.thinkwatch.test.Portal{}", std::process::id());
        let conn = zbus::blocking::connection::Builder::session()
            .and_then(|b| b.name(name.as_str()))
            .and_then(|b| b.serve_at(linux::PATH, Fake))
            .and_then(|b| b.build())
            .expect("no session bus; run the tests under dbus-run-session");

        let (ready_tx, ready_rx) = mpsc::channel();
        let (tx, rx) = mpsc::channel();
        let portal = name.clone();
        std::thread::spawn(move || {
            let _ = linux::listen(&portal, Theme::Light, &ready_tx, |t| {
                let _ = tx.send(t);
            });
        });
        let wait = Duration::from_secs(5);
        ready_rx.recv_timeout(wait).expect("never subscribed");
        assert_eq!(
            rx.recv_timeout(wait).unwrap(),
            Theme::Dark,
            "the first read"
        );

        let iface = conn
            .object_server()
            .interface::<_, Fake>(linux::PATH)
            .unwrap();
        let emit = |ns: &str, key: &str, v: Value<'_>| {
            zbus::block_on(Fake::setting_changed(iface.signal_emitter(), ns, key, v)).unwrap();
        };
        emit(
            "org.gnome.desktop.interface",
            "gtk-theme",
            Value::from("Adwaita"),
        );
        emit("org.freedesktop.appearance", "color-scheme", Value::U32(2));
        assert_eq!(rx.recv_timeout(wait).unwrap(), Theme::Light, "the switch");
        assert!(
            rx.try_recv().is_err(),
            "an unrelated setting was taken as a switch"
        );
    }

    #[test]
    fn a_choice_wins_over_the_system_and_no_choice_follows_it() {
        assert_eq!(effective(Some(Theme::Dark)), Theme::Dark);
        assert_eq!(effective(Some(Theme::Light)), Theme::Light);
        assert_eq!(effective(None), system());
    }

    /// 设置文件里存的是 `"light"` / `"dark"`，网页发过来的也是这两个词。
    /// 换了写法，存量用户的选择会在下一次启动时静悄悄退回跟随系统。
    #[test]
    fn it_is_written_as_the_word_the_web_side_sends() {
        assert_eq!(serde_json::to_string(&Theme::Dark).unwrap(), "\"dark\"");
        assert_eq!(serde_json::to_string(&Theme::Light).unwrap(), "\"light\"");
        assert_eq!(
            serde_json::from_str::<Option<Theme>>("null").unwrap(),
            None,
            "跟随系统存成 null"
        );
    }
}
