//! 呼出快捷键：在任意程序里按下，主界面出现在最前；主界面已经在最前时再按一次收起（lite#377）。
//!
//! **出厂就有一个：Ctrl+Alt+H**（macOS 上是 ⌃⌥H，同样是 Control 和 Option/Alt 两个键）。
//! 全局快捷键对所有程序生效，缺省的那个会让每一位用户在别的程序里失去这个组合，所以挑的是
//! 最不碍事的一个：Windows 和 Linux 上 Ctrl+Alt 就是 AltGr，美式国际、匈牙利、捷克、波兰、
//! 德语这些布局里 26 个字母只有 H 配 AltGr 不出字 —— 换成别的字母会挡住那些用户输入 `|`、
//! `@`、`€`、`ł`。和系统、浏览器、VS Code 都不冲突；只和 JetBrains 系 IDE 的「调用层次
//! 结构」撞，那边的用户在设置里换一个或关掉。
//!
//! **被别的程序占着就算了**：启动时注册不上不弹通知，设置页那一行说被占用了，由用户另选。
//!
//! **每台电脑各自的，不同步**（和界面大小一样，见 `zoom`）：各台电脑的键盘布局和别的程序
//! 占着的键不一样。
//!
//! 走 Tauri 的 global-shortcut 插件：macOS 是 Carbon 的 `RegisterEventHotKey`（不要辅助
//! 功能权限），Windows 是 `RegisterHotKey`，Linux 是 X11 的 `XGrabKey`。**Wayland 上用不了**：
//! 插件只会 X11，在 Wayland 会话里注册「成功」却永远收不到按键（读过 global-hotkey 0.8
//! 的源码：连不上 X 的那个线程退出之后，注册照样回 `Ok`），所以那边直接说不支持、不注册。

use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// 一个组合键。**主键按物理键位记**（W3C 的 `KeyboardEvent.code`：`KeyH`、`Digit1`、`F5`），
/// 不受输入法和键盘布局影响；界面录的就是它。`meta` 是 macOS 的 ⌘、别处的 Win / Super 键
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Combo {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
    pub code: String,
}

/// 出厂那一个：Ctrl+Alt+H
pub fn default_combo() -> Combo {
    Combo {
        ctrl: true,
        alt: true,
        shift: false,
        meta: false,
        code: "KeyH".into(),
    }
}

/// 能当主键的键。修饰键、Esc（录入时用来取消）、回车、Tab、退格不在里面
fn allowed_key(code: &str) -> bool {
    let tail = |prefix: &str| code.strip_prefix(prefix);
    matches!(tail("Key"), Some(c) if c.len() == 1 && c.as_bytes()[0].is_ascii_uppercase())
        || matches!(tail("Digit"), Some(c) if c.len() == 1 && c.as_bytes()[0].is_ascii_digit())
        || function_key(code)
        || matches!(
            code,
            "Space"
                | "ArrowUp"
                | "ArrowDown"
                | "ArrowLeft"
                | "ArrowRight"
                | "Home"
                | "End"
                | "PageUp"
                | "PageDown"
                | "Insert"
                | "Delete"
                | "Backquote"
                | "Minus"
                | "Equal"
                | "BracketLeft"
                | "BracketRight"
                | "Backslash"
                | "Semicolon"
                | "Quote"
                | "Comma"
                | "Period"
                | "Slash"
        )
}

/// F1–F12
fn function_key(code: &str) -> bool {
    code.strip_prefix('F')
        .and_then(|n| n.parse::<u8>().ok())
        .is_some_and(|n| (1..=12).contains(&n))
}

/// 录下来的组合为什么不能用
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Invalid {
    /// 不是能当主键的键
    Key,
    /// 没带 Ctrl、Alt、⌘ 里的任何一个（只有 Shift 不算）。F1–F12 例外
    NoModifier,
}

impl Combo {
    /// 能不能用：主键在名单里，带着 Ctrl、Alt、⌘ 之一（F1–F12 可以不带）
    pub fn check(&self) -> Result<(), Invalid> {
        if !allowed_key(&self.code) {
            return Err(Invalid::Key);
        }
        if !(self.ctrl || self.alt || self.meta || function_key(&self.code)) {
            return Err(Invalid::NoModifier);
        }
        Ok(())
    }

    /// 交给插件的那一个
    fn shortcut(&self) -> Option<Shortcut> {
        let mut mods = Modifiers::empty();
        mods.set(Modifiers::CONTROL, self.ctrl);
        mods.set(Modifiers::ALT, self.alt);
        mods.set(Modifiers::SHIFT, self.shift);
        mods.set(Modifiers::SUPER, self.meta);
        let code: Code = self.code.parse().ok()?;
        Some(Shortcut::new(Some(mods), code))
    }

    /// 存进 `app.json` 的写法：`Ctrl+Alt+H`。修饰键顺序固定，字母、数字写成键上的字，
    /// 别的写成 W3C 的键名（`F5`、`Space`、`Backquote`）
    fn text(&self) -> String {
        let mut parts: Vec<&str> = Vec::new();
        for (on, name) in [
            (self.ctrl, "Ctrl"),
            (self.alt, "Alt"),
            (self.shift, "Shift"),
            (self.meta, "Super"),
        ] {
            if on {
                parts.push(name);
            }
        }
        let key = self
            .code
            .strip_prefix("Key")
            .or_else(|| self.code.strip_prefix("Digit"))
            .unwrap_or(&self.code);
        parts.push(key);
        parts.join("+")
    }

    /// [`Combo::text`] 的反方向。写法不对、不能用的读不进来
    fn parse(s: &str) -> Option<Combo> {
        let mut c = Combo {
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
            code: String::new(),
        };
        let mut parts: Vec<&str> = s.split('+').collect();
        let key = parts.pop()?;
        for m in parts {
            let flag = match m {
                "Ctrl" => &mut c.ctrl,
                "Alt" => &mut c.alt,
                "Shift" => &mut c.shift,
                "Super" => &mut c.meta,
                _ => return None,
            };
            if std::mem::replace(flag, true) {
                return None;
            }
        }
        c.code = match key.as_bytes() {
            [b] if b.is_ascii_uppercase() => format!("Key{key}"),
            [b] if b.is_ascii_digit() => format!("Digit{key}"),
            _ => key.to_string(),
        };
        c.check().ok().map(|_| c)
    }
}

/// `app.json` 里的那一项。`None` 是关掉了
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Setting(pub Option<Combo>);

impl Default for Setting {
    fn default() -> Self {
        Self(Some(default_combo()))
    }
}

/// **关掉写成空串**，不是不写：不写是出厂那一个
impl TryFrom<String> for Setting {
    type Error = String;
    fn try_from(s: String) -> Result<Self, String> {
        if s.is_empty() {
            return Ok(Self(None));
        }
        Combo::parse(&s)
            .map(|c| Self(Some(c)))
            .ok_or_else(|| format!("{s} is not a usable shortcut"))
    }
}

impl From<Setting> for String {
    fn from(s: Setting) -> String {
        s.0.map(|c| c.text()).unwrap_or_default()
    }
}

/// 这个桌面能不能用全局快捷键。只有 Linux 的 Wayland 会话不能
pub fn supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some_and(|v| !v.is_empty())
            || std::env::var("XDG_SESSION_TYPE").is_ok_and(|v| v.eq_ignore_ascii_case("wayland"));
        !wayland
    }
    #[cfg(not(target_os = "linux"))]
    true
}

/// 现在注册着的那一个。设置里有、却注册不上（被别的程序占着）时是 `None`
static ACTIVE: Mutex<Option<Combo>> = Mutex::new(None);

/// 现在注册着的那一个（菜单栏把它写在「打开主界面」右边）
pub fn active() -> Option<Combo> {
    ACTIVE.lock().unwrap().clone()
}

/// 插件：按下时叫 [`pressed`]。**不支持的桌面不装**（见模块说明）
pub fn plugin() -> Option<tauri::plugin::TauriPlugin<tauri::Wry>> {
    supported().then(|| {
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    pressed(app);
                }
            })
            .build()
    })
}

/// 启动时按设置注册。注册不上（被别的程序占着）不报错，设置页那一行会说
pub fn init(app: &tauri::AppHandle, s: &Setting) {
    if let Some(c) = &s.0
        && let Err(e) = register(app, c)
    {
        tracing::debug!("呼出快捷键 {} 注册不上：{e}", c.text());
    }
}

/// 换成 `next`：先放掉现在的、再注册新的；**新的注册不上就把旧的注册回去**，交回原因
pub fn replace(app: &tauri::AppHandle, next: Option<&Combo>) -> Result<(), String> {
    let was = active();
    if let Some(c) = &was {
        unregister(app, c);
    }
    let Some(c) = next else { return Ok(()) };
    register(app, c).inspect_err(|_| {
        if let Some(w) = &was {
            let _ = register(app, w);
        }
    })
}

/// 设置页在录新的组合：**先放掉现在的**。不放的话按下现在这一个，系统先把它交给我们、
/// 窗口当场收起，网页根本收不到这一下 —— 想重录同一个组合都录不进去
pub fn pause(app: &tauri::AppHandle) {
    if let Some(c) = active() {
        unregister(app, &c);
    }
}

/// 录完了（录上了、取消了、页面没了）：按设置注册回去。已经注册着的不动
pub fn resume(app: &tauri::AppHandle) {
    if active().is_none() {
        init(app, &crate::prefs::load(&crate::data_dir()).hotkey);
    }
}

fn register(app: &tauri::AppHandle, c: &Combo) -> Result<(), String> {
    let s = c.shortcut().ok_or("unknown key")?;
    let gs = app.try_state::<tauri_plugin_global_shortcut::GlobalShortcut<tauri::Wry>>();
    let gs = gs.ok_or("global shortcuts are not available")?;
    gs.register(s).map_err(|e| e.to_string())?;
    *ACTIVE.lock().unwrap() = Some(c.clone());
    Ok(())
}

fn unregister(app: &tauri::AppHandle, c: &Combo) {
    if let Some(s) = c.shortcut() {
        let _ = app.global_shortcut().unregister(s);
    }
    *ACTIVE.lock().unwrap() = None;
}

/// 按下了。**主窗口在最前、有焦点时收起**（和点关闭按钮一样销毁），别的情况都叫到最前。
///
/// 排到主线程上：Linux 上插件是在自己的 X11 线程里叫这里的
fn pressed(app: &tauri::AppHandle) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = a.get_webview_window("main") {
            let front = w.is_visible().unwrap_or(false)
                && w.is_focused().unwrap_or(false)
                && !w.is_minimized().unwrap_or(false);
            if front {
                let _ = w.close();
                return;
            }
            if w.is_minimized().unwrap_or(false) {
                let _ = w.unminimize();
            }
        }
        if let Err(e) = crate::window::show_main_window(&a) {
            tracing::warn!("呼出快捷键打不开主窗口：{e}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn combo(ctrl: bool, alt: bool, shift: bool, meta: bool, code: &str) -> Combo {
        Combo {
            ctrl,
            alt,
            shift,
            meta,
            code: code.into(),
        }
    }

    /// 存成 `Ctrl+Alt+H` 这样的一串，关掉是空串，不写是出厂那一个
    #[test]
    fn it_is_written_as_text_and_off_is_an_empty_string() {
        let json = |s: &Setting| serde_json::to_string(s).unwrap();
        assert_eq!(json(&Setting::default()), r#""Ctrl+Alt+H""#);
        assert_eq!(json(&Setting(None)), r#""""#);
        let c = combo(true, false, true, true, "F5");
        assert_eq!(json(&Setting(Some(c.clone()))), r#""Ctrl+Shift+Super+F5""#);
        assert_eq!(
            serde_json::from_str::<Setting>(r#""Ctrl+Shift+Super+F5""#).unwrap(),
            Setting(Some(c))
        );
        assert_eq!(
            serde_json::from_str::<Setting>(r#""Alt+7""#).unwrap(),
            Setting(Some(combo(false, true, false, false, "Digit7")))
        );
        assert_eq!(
            serde_json::from_str::<Setting>(r#""""#).unwrap(),
            Setting(None)
        );
    }

    /// 写坏了的、不能用的读不进来（`prefs` 那边按出厂那一个）
    #[test]
    fn broken_or_unusable_text_is_not_read() {
        for s in [
            "H",
            "Shift+H",
            "Ctrl+Ctrl+H",
            "Hyper+H",
            "Ctrl+Escape",
            "Ctrl+",
            "Ctrl+F13",
        ] {
            assert!(
                serde_json::from_str::<Setting>(&format!("{s:?}")).is_err(),
                "{s}"
            );
        }
    }

    /// 至少带 Ctrl、Alt、⌘ 之一；只有 Shift 不算；F1–F12 可以不带
    #[test]
    fn a_modifier_is_required_except_for_function_keys() {
        assert_eq!(
            combo(false, false, true, false, "KeyH").check(),
            Err(Invalid::NoModifier)
        );
        assert_eq!(
            combo(false, false, false, false, "Space").check(),
            Err(Invalid::NoModifier)
        );
        assert_eq!(combo(false, false, false, false, "F3").check(), Ok(()));
        assert_eq!(combo(false, false, true, false, "F12").check(), Ok(()));
        assert_eq!(combo(false, true, false, false, "Space").check(), Ok(()));
        assert_eq!(
            combo(true, false, false, false, "Escape").check(),
            Err(Invalid::Key)
        );
        assert_eq!(
            combo(true, false, false, false, "ShiftLeft").check(),
            Err(Invalid::Key)
        );
        assert_eq!(
            combo(true, false, false, false, "Enter").check(),
            Err(Invalid::Key)
        );
    }

    /// 每一个能录进来的键插件都认得（`Code` 按 W3C 的键名解析）
    #[test]
    fn every_allowed_key_becomes_a_shortcut() {
        let mut codes: Vec<String> = ('A'..='Z').map(|c| format!("Key{c}")).collect();
        codes.extend(('0'..='9').map(|c| format!("Digit{c}")));
        codes.extend((1..=12).map(|n| format!("F{n}")));
        for c in [
            "Space",
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
            "Home",
            "End",
            "PageUp",
            "PageDown",
            "Insert",
            "Delete",
            "Backquote",
            "Minus",
            "Equal",
            "BracketLeft",
            "BracketRight",
            "Backslash",
            "Semicolon",
            "Quote",
            "Comma",
            "Period",
            "Slash",
        ] {
            codes.push(c.into());
        }
        for code in codes {
            let c = combo(true, true, false, false, &code);
            assert_eq!(c.check(), Ok(()), "{code}");
            assert!(c.shortcut().is_some(), "{code}");
            assert_eq!(Combo::parse(&c.text()), Some(c), "{code}");
        }
    }

    /// 出厂那一个是 Control + Alt + H，不是 ⌘
    #[test]
    fn the_default_is_control_alt_h() {
        let s = default_combo().shortcut().unwrap();
        assert_eq!(
            s,
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyH)
        );
    }
}
