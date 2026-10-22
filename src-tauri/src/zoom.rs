//! 界面大小：整个界面等比放大、缩小。
//!
//! **缩放的是 webview，不是字号。**macOS 上是 WKWebView 的 `pageZoom`，Windows 上是
//! WebView2 的 `ZoomFactor`，Linux 上是 WebKitGTK 的 `zoom-level`（都经 Tauri 的
//! `set_zoom`）。和浏览器的「缩放」一样：CSS 的 1px 变成 `factor` 个点，布局、图标、
//! 间距一起放大，界面一行 CSS 都不用改；改根字号做不到这一点 —— 写死的 px 不跟着变。
//!
//! **不开 Tauri 的 `zoom_hotkeys_enabled`。**它在 macOS、Linux 上是一段注入的脚本，
//! 按 20% 一档、不存盘；在 Windows 上打开的是 WebView2 自己的缩放，连 Ctrl+滚轮也
//! 一起开了。快捷键由界面自己接（`src/shell/Workspace.tsx`），走这里的档位、存进
//! `app.json`。
//!
//! **每台电脑各自的，不同步。**合适的大小取决于这台电脑的屏幕（1080p 的外接显示器和
//! 视网膜屏的笔记本不是一回事），所以不在 `client_prefs` 的同步列表里。
//!
//! 三扇窗都跟着缩放：主窗口、更新窗口、连接选择。两扇小窗按内容定高，网页量出来的是
//! CSS 像素，[`crate::window::fit`] 乘上 [`current`] 再交给窗口。

use std::sync::atomic::{AtomicU16, Ordering};

use tauri::Manager;

/// 设置里的几档，百分比
pub const STEPS: [u16; 5] = [90, 100, 110, 125, 150];

/// 出厂那一档
const DEFAULT: u16 = 100;

/// 一档界面大小。**存成百分比的数字**（`"zoom": 125`），界面发来的也是这个数；
/// 不在 [`STEPS`] 里的数读不进来（手改坏了的那一项按出厂值，见 `prefs::from_fields`）
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "u16", into = "u16")]
pub struct Zoom(u16);

impl Default for Zoom {
    fn default() -> Self {
        Self(DEFAULT)
    }
}

impl TryFrom<u16> for Zoom {
    type Error = String;
    fn try_from(pct: u16) -> Result<Self, String> {
        if STEPS.contains(&pct) {
            Ok(Self(pct))
        } else {
            Err(format!(
                "{pct}% is not one of the interface sizes {STEPS:?}"
            ))
        }
    }
}

impl From<Zoom> for u16 {
    fn from(z: Zoom) -> u16 {
        z.0
    }
}

/// 快捷键：放大一档、缩小一档、回到 100%
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Step {
    In,
    Out,
    Reset,
}

impl Zoom {
    /// 交给 webview 的倍数
    pub fn factor(self) -> f64 {
        f64::from(self.0) / 100.0
    }

    /// 按一下快捷键之后的那一档。**到头了就停在头上**，不绕回去
    pub fn step(self, step: Step) -> Zoom {
        let i = STEPS.iter().position(|&s| s == self.0).unwrap_or(1);
        match step {
            Step::In => Zoom(STEPS[(i + 1).min(STEPS.len() - 1)]),
            Step::Out => Zoom(STEPS[i.saturating_sub(1)]),
            Step::Reset => Zoom::default(),
        }
    }
}

/// 现在是哪一档。0 是还没读过设置
static CURRENT: AtomicU16 = AtomicU16::new(0);

/// 现在是哪一档。**没记下过就读一次设置**：主窗口可能在 `setup` 之前就要开
/// （单实例转交过来的那一次）
pub fn current() -> Zoom {
    match Zoom::try_from(CURRENT.load(Ordering::Relaxed)) {
        Ok(z) => z,
        Err(_) => {
            let z = crate::prefs::load(&crate::data_dir()).zoom;
            remember(z);
            z
        }
    }
}

/// 记下这一档（之后建的窗口、小窗按内容定尺寸都按它）
pub fn remember(z: Zoom) {
    CURRENT.store(z.0, Ordering::Relaxed);
}

/// 主窗口 100% 时的大小和最小尺寸（逻辑点）
pub const MAIN_SIZE: (f64, f64) = (1100.0, 720.0);
pub const MAIN_MIN: (f64, f64) = (820.0, 560.0);

/// 屏幕上给标题栏和窗口边框留的高度。最小尺寸说的是内容区，整扇窗户比它高一条标题栏
const FRAME_ROOM: f64 = 40.0;

/// 100% 时的一个尺寸放大到这一档，**放不下就夹在屏幕的可用范围里**。
///
/// 主窗口的最小尺寸要跟着放大：界面按 CSS 像素排版，150% 下 820 点宽的窗口只剩
/// 547 个 CSS 像素，掉到 640 / 768 的响应式断点下面，布局就换成窄屏的那一套。按比例
/// 放大之后，最小的窗口在每一档里都还是 820×560 个 CSS 像素。
///
/// 但 150% 的最小尺寸是 1230×840 点，Windows 上 1080p 屏、系统缩放 125%（笔记本的出厂
/// 值）的可用高度只有八百多点 —— 最小尺寸比屏幕还大，窗口就有一截永远在屏幕外面。所以
/// 夹住：放不下的那一边退到屏幕的可用范围，窄一点的布局总比够不着的窗口好。
/// `room` 是 `None`（问不到屏幕，比如某些 Wayland 合成器）时不夹
pub fn scaled(base: (f64, f64), z: Zoom, room: Option<(f64, f64)>) -> (f64, f64) {
    let (w, h) = (base.0 * z.factor(), base.1 * z.factor());
    match room {
        // 夹也不夹到 100% 的尺寸以下：屏幕小到那个份上，夹了也没用
        Some((rw, rh)) => (w.min(rw).max(base.0.min(w)), h.min(rh).max(base.1.min(h))),
        None => (w, h),
    }
}

/// 一块屏幕能放下多大的窗口内容（逻辑点）。工作区不算菜单栏、程序坞、任务栏
pub fn room_on(m: &tauri::Monitor) -> Option<(f64, f64)> {
    let s = m.scale_factor();
    let area = m.work_area().size;
    let (w, h) = (
        f64::from(area.width) / s,
        f64::from(area.height) / s - FRAME_ROOM,
    );
    // 报不出工作区的（报成 0）当问不到
    (w >= 100.0 && h >= 100.0).then_some((w, h))
}

/// 这扇窗所在的屏幕能放下多大。不知道在哪块屏幕上时用主屏
fn room_for(w: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    let m = w
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| w.primary_monitor().ok().flatten())?;
    room_on(&m)
}

/// 主窗口按这一档定最小尺寸。窗口比新的最小尺寸小的话，系统把它撑大
pub fn fit_main_min(w: &tauri::WebviewWindow, z: Zoom) {
    let (mw, mh) = scaled(MAIN_MIN, z, room_for(w));
    let _ = w.set_min_size(Some(tauri::LogicalSize::new(mw, mh)));
}

/// 刚建好的小窗（更新窗口、连接选择）按现在这一档缩放。它们建出来先藏着，量完内容
/// 才亮出来，所以建好再设不会先闪一下 100%
pub fn zoom_new(w: &tauri::WebviewWindow) {
    let z = current();
    if z != Zoom::default() {
        let _ = w.set_zoom(z.factor());
    }
}

/// 换一档：记下来，开着的每扇窗当场换。
///
/// 两扇小窗不用在这里改尺寸：缩放一变，网页的可用宽度跟着变，它们量内容的
/// `ResizeObserver` 会再报一次，[`crate::window::fit`] 按新的一档重新定
pub fn apply(app: &tauri::AppHandle, z: Zoom) {
    remember(z);
    for (label, w) in app.webview_windows() {
        let _ = w.set_zoom(z.factor());
        if label == "main" {
            fit_main_min(&w, z);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn z(pct: u16) -> Zoom {
        Zoom::try_from(pct).unwrap()
    }

    /// 存成百分比的数字，界面发来的也是这个数；不是那几档的读不进来
    #[test]
    fn it_is_written_as_a_percentage_and_only_the_steps_are_read() {
        assert_eq!(serde_json::to_string(&z(125)).unwrap(), "125");
        assert_eq!(serde_json::from_str::<Zoom>("150").unwrap(), z(150));
        assert!(serde_json::from_str::<Zoom>("120").is_err());
        assert!(serde_json::from_str::<Zoom>("\"125\"").is_err());
        assert_eq!(Zoom::default(), z(100));
    }

    /// 一档一档地走，到头停住；回到 100%
    #[test]
    fn steps_move_one_at_a_time_and_stop_at_the_ends() {
        assert_eq!(z(100).step(Step::In), z(110));
        assert_eq!(z(110).step(Step::In), z(125));
        assert_eq!(z(150).step(Step::In), z(150));
        assert_eq!(z(100).step(Step::Out), z(90));
        assert_eq!(z(90).step(Step::Out), z(90));
        assert_eq!(z(150).step(Step::Reset), z(100));
        assert_eq!(serde_json::from_str::<Step>("\"in\"").unwrap(), Step::In);
    }

    /// 最小尺寸跟着放大；放不下的那一边夹在屏幕里，但不比 100% 的还小
    #[test]
    fn the_minimum_size_scales_and_is_kept_on_the_screen() {
        assert_eq!(scaled(MAIN_MIN, z(100), None), MAIN_MIN);
        assert_eq!(scaled(MAIN_MIN, z(150), None), (1230.0, 840.0));
        // macOS，1080p 屏：放得下
        assert_eq!(
            scaled(MAIN_MIN, z(150), Some((1920.0, 1000.0))),
            (1230.0, 840.0)
        );
        // Windows，1080p 屏、系统缩放 125%：高度夹住，宽度放得下
        assert_eq!(
            scaled(MAIN_MIN, z(150), Some((1536.0, 792.0))),
            (1230.0, 792.0)
        );
        // 屏幕比 100% 的最小尺寸还小：不往下夹
        assert_eq!(scaled(MAIN_MIN, z(125), Some((800.0, 500.0))), MAIN_MIN);
        assert_eq!(scaled(MAIN_MIN, z(90), Some((1920.0, 1000.0))).0, 738.0);
    }
}
