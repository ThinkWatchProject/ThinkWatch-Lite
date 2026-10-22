//! Lite 的通用偏好（语言、外观、菜单栏、提醒、检查更新）交给 core 保存（方案 4.4）。
//!
//! **为什么交给 core。**这几项要随导出、备份和同步走：在一台电脑上换了语言，另一台跟着
//! 换。core 不解析它们，整个存成数据目录里的 `client-prefs.json`，变了发
//! `client_prefs_changed`；这里收到就读回来、当场生效。
//!
//! **`app.json` 照旧写着一份**：core 起来之前的启动画面、窗口语言要用。两边谁说了算：
//!
//! - **core 说了算**：接上 core、core 说偏好变了时读回来，和 `app.json` 不一样的几项照 core 的
//!   改（多半是别的设备同步过来的）。core 那边还没有（头一次）就把这边的交上去；
//! - **这台电脑上刚改的说了算**：在设置里改了一项，改完 `app.json` 交给 core。交不上（core
//!   没起来、连着远程）就在数据目录里留一个记号（[`PENDING_FILE`]），下次接上本机 core 时
//!   先交这边的，不读回来盖掉。
//!
//! **只在连着本机时**。连着远程 core 时偏好只存在这台电脑上（方案 4.4）：远程 core 是另一台
//! 设备，它的偏好不是这台电脑的。
//!
//! 交上去的是 [`General`] 那几项，加上 core 那份里这一版不认识的键（新版本的 Lite 写下的）
//! 原样留着。

use std::sync::atomic::{AtomicU32, Ordering};

use tauri::{Emitter, Manager};

use crate::error::Out;
use crate::prefs::{self, Prefs};
use crate::{AppState, data_dir, i18n, menubar, notices, theme};

/// 交上去的那几项。键和 `app.json` 里的写法一样
const FIELDS: [&str; 5] = ["language", "theme", "notices", "menubar", "check_updates"];

/// 改过、还没交给本机 core 的记号
const PENDING_FILE: &str = "client-prefs.pending";

/// 通用偏好那几项，写成交给 core 的样子
pub fn general(p: &Prefs) -> serde_json::Map<String, serde_json::Value> {
    let mut m = serde_json::Map::new();
    m.insert("language".into(), serde_json::json!(p.language));
    m.insert("theme".into(), serde_json::json!(p.theme));
    m.insert("notices".into(), serde_json::json!(p.notices));
    m.insert("menubar".into(), serde_json::json!(p.menubar));
    m.insert("check_updates".into(), serde_json::json!(p.check_updates));
    m
}

/// 把 core 那一份盖到 `p` 上：**写着的、读得懂的才盖**，没写的、这一版读不懂的保持原样
/// （和 `prefs::load` 一项一项读是同一个道理）。返回盖完的
pub fn overlay(p: &Prefs, from: &serde_json::Value) -> Prefs {
    let mut out = p.clone();
    let Some(m) = from.as_object() else {
        return out;
    };
    fn read<T: serde::de::DeserializeOwned>(
        m: &serde_json::Map<String, serde_json::Value>,
        k: &str,
    ) -> Option<T> {
        serde_json::from_value(m.get(k)?.clone()).ok()
    }
    if let Some(v) = read(m, "language") {
        out.language = v;
    }
    if let Some(v) = read(m, "theme") {
        out.theme = v;
    }
    if let Some(v) = read(m, "notices") {
        out.notices = v;
    }
    if let Some(v) = read(m, "menubar") {
        out.menubar = v;
    }
    if let Some(v) = read(m, "check_updates") {
        out.check_updates = v;
    }
    out
}

/// 交给 core 的那一份：这边的几项，盖在 core 那份上（保留这一版不认识的键）
pub fn merged(p: &Prefs, theirs: Option<&serde_json::Value>) -> serde_json::Value {
    let mut m = theirs
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    for (k, v) in general(p) {
        m.insert(k, v);
    }
    serde_json::Value::Object(m)
}

/// 只比那几项
fn same(a: &Prefs, b: &Prefs) -> bool {
    let (a, b) = (general(a), general(b));
    FIELDS.iter().all(|k| a.get(*k) == b.get(*k))
}

/// 读、交、盖一次只走一条：读回来的那一份不该落在一次交之前
static ONE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// 排着还没交上去的几次。有的话读回来的是交之前的样子，不拿它盖
static QUEUED: AtomicU32 = AtomicU32::new(0);

fn pending_path() -> std::path::PathBuf {
    data_dir().join(PENDING_FILE)
}

fn mark_pending(on: bool) {
    let p = pending_path();
    let r = if on {
        std::fs::write(&p, b"1")
    } else {
        match std::fs::remove_file(&p) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            r => r,
        }
    };
    if let Err(e) = r {
        tracing::debug!("通用偏好的待交记号写不了：{e}");
    }
}

fn local(app: &tauri::AppHandle) -> bool {
    app.try_state::<AppState>()
        .is_some_and(|s| !s.link.is_remote())
}

/// 设置里刚改了一项（已经写进 `app.json`）：交给本机 core。连着远程时只留记号
pub fn changed(app: &tauri::AppHandle) {
    if !local(app) {
        mark_pending(true);
        return;
    }
    QUEUED.fetch_add(1, Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _one = ONE.lock().await;
        let r = push(&app).await;
        QUEUED.fetch_sub(1, Ordering::SeqCst);
        if let Err(e) = r {
            tracing::debug!("通用偏好没交给 core，下次接上再交：{e:#}");
            mark_pending(true);
        }
    });
}

/// 过一会儿读回来（接上 core、core 说变了）
pub fn pull_soon(app: &tauri::AppHandle) {
    if !local(app) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _one = ONE.lock().await;
        if QUEUED.load(Ordering::SeqCst) > 0 {
            // 后面排着一次交：交上去之后 core 会再说一声，那时再读
            return;
        }
        if let Err(e) = pull(&app).await {
            tracing::debug!("没读回通用偏好：{e:#}");
        }
    });
}

async fn push(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let st = app
        .try_state::<AppState>()
        .ok_or_else(|| anyhow::anyhow!("not ready"))?;
    let theirs = st
        .control
        .call::<tw_api::ep::GetClientPrefs>(&[], &())
        .await?;
    let p = prefs::load(&data_dir());
    let body = tw_api::ClientPrefs {
        prefs: Some(merged(&p, theirs.prefs.as_ref().filter(|v| !v.is_null()))),
    };
    st.control
        .call::<tw_api::ep::PutClientPrefs>(&[], &body)
        .await?;
    mark_pending(false);
    Ok(())
}

async fn pull(app: &tauri::AppHandle) -> anyhow::Result<()> {
    // 这边有改过没交上去的：先交，不读回来盖掉
    if pending_path().exists() {
        return push(app).await;
    }
    let st = app
        .try_state::<AppState>()
        .ok_or_else(|| anyhow::anyhow!("not ready"))?;
    let theirs = st
        .control
        .call::<tw_api::ep::GetClientPrefs>(&[], &())
        .await?;
    match theirs.prefs.as_ref().filter(|v| !v.is_null()) {
        // core 那边还没有：头一次，把这边的交上去
        None => push(app).await,
        Some(v) => {
            let v = v.clone();
            apply(app, move |p| *p = overlay(p, &v)).await?;
            Ok(())
        }
    }
}

/// 改 `app.json`，**和原来不一样的几项当场生效**：语言换掉窗口和菜单栏的文案、外观换掉
/// 窗口外观、提醒换一档、菜单栏重画。设置页听 `client-prefs-applied` 重读
async fn apply(
    app: &tauri::AppHandle,
    f: impl FnOnce(&mut Prefs) + Send + 'static,
) -> anyhow::Result<bool> {
    let before = prefs::load(&data_dir());
    let after = crate::clients::blocking(move || prefs::update(&data_dir(), f))
        .await
        .map_err(|e| anyhow::anyhow!(e.into_msg().text))??;
    if same(&before, &after) {
        return Ok(false);
    }
    if before.language != after.language {
        i18n::set(i18n::effective(after.language));
        if let Some(st) = app.try_state::<AppState>() {
            st.menubar_now.notify_one();
        }
        let _ = app.emit("language-changed", i18n::current());
    }
    if before.theme != after.theme {
        theme::apply(app, after.theme);
    }
    if before.notices != after.notices
        && let Some(n) = app.try_state::<std::sync::Arc<notices::Notices>>()
    {
        let (n, mode) = (n.inner().clone(), after.notices);
        crate::clients::blocking(move || n.set_mode(mode))
            .await
            .map_err(|e| anyhow::anyhow!(e.into_msg().text))?;
        let _ = app.emit("notice-mode-changed", mode);
    }
    if before.menubar != after.menubar {
        menubar::set_style(after.menubar);
        if let Some(st) = app.try_state::<AppState>() {
            st.menubar_now.notify_one();
        }
        let _ = app.emit("menubar-style-changed", after.menubar);
    }
    let _ = app.emit("client-prefs-applied", ());
    Ok(true)
}

/// 这台电脑上的通用偏好（远程模式下导出时附进配置包，方案 4.4）
#[tauri::command]
pub fn client_prefs() -> serde_json::Value {
    serde_json::Value::Object(general(&prefs::load(&data_dir())))
}

/// 用一份通用偏好（远程模式下导入配置包时）。和 core 推来的一样：读得懂的几项盖上、当场
/// 生效；连着本机时随后交给 core
#[tauri::command]
pub async fn apply_client_prefs(app: tauri::AppHandle, prefs: serde_json::Value) -> Out<bool> {
    let changed = apply(&app, move |p| *p = overlay(p, &prefs))
        .await
        .map_err(crate::error::text)?;
    if changed {
        self::changed(&app);
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::Lang;
    use crate::notices::Mode;
    use crate::theme::Theme;

    /// 交上去的就是那五项，`null` 是跟随系统
    #[test]
    fn the_general_prefs_are_the_five_shared_settings() {
        let p = Prefs {
            language: Some(Lang::En),
            theme: None,
            notices: Mode::App,
            menubar: menubar::Style::Numbers,
            check_updates: false,
            ..Prefs::default()
        };
        assert_eq!(
            serde_json::Value::Object(general(&p)),
            serde_json::json!({
                "language": "en",
                "theme": null,
                "notices": "app",
                "menubar": "numbers",
                "check_updates": false,
            })
        );
    }

    /// 写着的盖上（`null` 也是写着：改回跟随系统）；没写的、读不懂的保持原样；
    /// 客户端配置位置不在里面，不被碰
    #[test]
    fn only_what_is_written_and_understood_is_taken() {
        let mine = Prefs {
            language: Some(Lang::Zh),
            theme: Some(Theme::Dark),
            notices: Mode::System,
            check_updates: true,
            client_locations: std::collections::BTreeMap::from([(
                "codex".to_string(),
                tw_adopt::locations::Places::default(),
            )]),
            ..Prefs::default()
        };
        let got = overlay(
            &mine,
            &serde_json::json!({
                "language": "en",
                "theme": null,
                "notices": "digest",
                "added_later": 1,
            }),
        );
        assert_eq!(got.language, Some(Lang::En));
        assert_eq!(got.theme, None);
        assert_eq!(got.notices, Mode::System, "读不懂的一档不盖");
        assert!(got.check_updates, "没写的不盖");
        assert_eq!(got.client_locations, mine.client_locations);
        // 不是一份偏好：原样
        assert_eq!(overlay(&mine, &serde_json::json!([1])), mine);
    }

    /// 交上去时，core 那份里这一版不认识的键留着
    #[test]
    fn keys_this_version_does_not_know_are_kept_on_the_way_up() {
        let p = Prefs {
            language: Some(Lang::En),
            ..Prefs::default()
        };
        let up = merged(
            &p,
            Some(&serde_json::json!({ "language": "zh", "added_later": [1] })),
        );
        assert_eq!(up["language"], "en");
        assert_eq!(up["added_later"], serde_json::json!([1]));
        assert_eq!(merged(&p, None)["check_updates"], true);
    }

    /// 界面大小跟着这台电脑的屏幕走：不交上去，别处交下来的也不盖
    #[test]
    fn the_interface_size_stays_on_this_computer() {
        let big = crate::zoom::Zoom::try_from(150).unwrap();
        let p = Prefs {
            zoom: big,
            ..Prefs::default()
        };
        assert!(!general(&p).contains_key("zoom"));
        assert!(same(&Prefs::default(), &p));
        let got = overlay(&Prefs::default(), &serde_json::json!({ "zoom": 150 }));
        assert_eq!(got.zoom, crate::zoom::Zoom::default());
    }

    #[test]
    fn sameness_only_looks_at_the_shared_settings() {
        let a = Prefs::default();
        let mut b = a.clone();
        b.client_locations
            .insert("codex".into(), tw_adopt::locations::Places::default());
        assert!(same(&a, &b));
        b.menubar = menubar::Style::Icon;
        assert!(!same(&a, &b));
    }
}
