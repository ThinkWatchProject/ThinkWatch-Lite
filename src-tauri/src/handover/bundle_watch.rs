//! Homebrew 没退出应用就把它换掉了：自己 arm 并重启（方案 8.3.3、F10）。
//!
//! `brew upgrade` 通常先让应用退出（见 [`super::brew`]），但有几种情况它直接换：`--no-quit`、
//! 在 SSH 里执行（没登录图形界面）、自动化权限被拒、10 秒内没退出。这时跑着的还是旧版，磁盘上
//! 已经是新版 —— 守护哪天重起 core，起来的就是一个和界面不同版本的网关；Homebrew 也不会再把
//! 它重新打开。
//!
//! 所以盯着自己应用包里的 `Info.plist`：磁盘上的版本和正在跑的不一样了，就照自动更新的样子
//! 走一遍（arm、记下退出时的样子、重启），重启之后照退出时的窗口状态恢复。
//!
//! **只看 Homebrew 装的那一份**：自己更新的那一份是更新流程自己在换包，换完自己重启；别的
//! 方式换掉的不归这里管。

use std::path::{Path, PathBuf};
use std::time::Duration;

/// 多久看一次。**轮询一个小文件**：读的是修改时间，变了才读内容
const EVERY: Duration = Duration::from_secs(3);

/// 看到版本变了之后再等多久、确认它不再变才动手：Homebrew 换好 `.app` 之后还要清掉隔离
/// 属性 —— 带着隔离属性重启，未签名的应用会被系统拦下来
const SETTLE: Duration = Duration::from_secs(5);

/// 起一个后台任务盯着。不是 Homebrew 装的、找不到自己的应用包就不盯
pub(crate) fn spawn(app: &tauri::AppHandle) {
    if crate::update::kind() != crate::update::Install::Homebrew {
        return;
    }
    let Some(bundle) = crate::update::own_bundle() else {
        return;
    };
    let plist = plist_of(&bundle);
    let running = app.package_info().version.to_string();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(found) = until_replaced(&plist, &running).await else {
            return;
        };
        tracing::info!(running, found, "应用包已被换成另一版，交接并重启");
        crate::updater::restart_into_replaced(&app).await;
    });
}

/// 等到磁盘上的版本和 `running` 不同、并且稳定下来，返回那个版本
async fn until_replaced(plist: &Path, running: &str) -> Option<String> {
    let mut seen: Option<std::time::SystemTime> = None;
    loop {
        tokio::time::sleep(EVERY).await;
        let modified = std::fs::metadata(plist).and_then(|m| m.modified()).ok();
        if modified.is_none() || modified == seen {
            continue;
        }
        seen = modified;
        let Some(disk) = read_version(plist) else {
            continue;
        };
        if disk == running {
            continue;
        }
        tokio::time::sleep(SETTLE).await;
        if read_version(plist).as_deref() == Some(disk.as_str()) {
            return Some(disk);
        }
        // 还在变：下一轮重新看
        seen = None;
    }
}

fn read_version(plist: &Path) -> Option<String> {
    plist_version(&std::fs::read_to_string(plist).ok()?)
}

/// 从 `Info.plist`（XML）里读出 `CFBundleShortVersionString`。打包器写的就是 XML；读不懂的
/// （二进制 plist、没有这一项）是 `None`，当没变
pub fn plist_version(text: &str) -> Option<String> {
    let key = "<key>CFBundleShortVersionString</key>";
    let rest = &text[text.find(key)? + key.len()..];
    let rest = rest.trim_start().strip_prefix("<string>")?;
    let v = rest[..rest.find("</string>")?].trim();
    (!v.is_empty()).then(|| v.to_string())
}

/// 应用包里的 `Info.plist`
fn plist_of(bundle: &Path) -> PathBuf {
    bundle.join("Contents").join("Info.plist")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plist(version: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>thinkwatch-lite</string>
	<key>CFBundleShortVersionString</key>
	<string>{version}</string>
	<key>CFBundleVersion</key>
	<string>{version}</string>
</dict>
</plist>"#
        )
    }

    #[test]
    fn the_version_is_read_from_the_plist() {
        assert_eq!(
            plist_version(&plist("2026.10.29")).as_deref(),
            Some("2026.10.29")
        );
        assert_eq!(plist_version("<plist><dict></dict></plist>"), None);
        assert_eq!(plist_version(&plist("")), None);
        assert_eq!(plist_version("bplist00\u{1}\u{2}"), None);
    }

    /// 换成另一版、稳定下来才报；没变一直等
    #[tokio::test(start_paused = true)]
    async fn a_replaced_bundle_is_noticed_once_it_settles() {
        let d = tempfile::tempdir().unwrap();
        let bundle = d.path().join("ThinkWatch Lite.app");
        std::fs::create_dir_all(bundle.join("Contents")).unwrap();
        let p = plist_of(&bundle);
        std::fs::write(&p, plist("2026.10.28")).unwrap();
        let watch = tokio::spawn({
            let p = p.clone();
            async move { until_replaced(&p, "2026.10.28").await }
        });
        tokio::time::sleep(EVERY * 3).await;
        assert!(!watch.is_finished(), "版本没变不该报");
        std::fs::write(&p, plist("2026.10.29")).unwrap();
        let found = tokio::time::timeout(EVERY * 10, watch)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(found.as_deref(), Some("2026.10.29"));
    }
}
