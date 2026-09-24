//! 还原全部接管，以及卸载。

use crate::{autostart, data_dir, error::Out};

/// 把所有接管过的客户端一次性还原（第二层的第二个入口）。
///
/// **这个按钮要一直看得见。**用户敢按下「接管」的前提，就是看得见退路
/// —— 藏起来的退路等于没有退路，他会在心里给接管打上「不可逆」的标签。
///
/// **一家失败不影响别家。**逐个还原、逐个记结果：五个客户端里有一个的
/// 文件被改坏了，不该让另外四个也留在接管状态。**也不问 core**：退路不该
/// 依赖网关还在不在。
#[tauri::command]
pub async fn restore_all() -> Out<Vec<RestoreOutcome>> {
    Ok(restore_all_in(
        &crate::clients::home_dir(),
        &tw_adopt::foreign::backup_root(),
    ))
}

fn restore_all_in(home: &std::path::Path, backups: &std::path::Path) -> Vec<RestoreOutcome> {
    use crate::clients::ops;
    ops::adopted(home)
        .into_iter()
        .map(|c| {
            let r = ops::restore(home, backups, c.id);
            RestoreOutcome {
                client: c.name.to_string(),
                ok: r.is_ok(),
                detail: match r {
                    Ok(_) => tr!("已还原", "Restored").to_string(),
                    Err(e) => crate::core_text::text(&e),
                },
            }
        })
        .collect()
}

#[derive(serde::Serialize)]
pub struct RestoreOutcome {
    client: String,
    ok: bool,
    detail: String,
}

/// 完全卸载（第二层的第三个入口）。
///
/// 顺序是**先还原、再注销自启、最后才提删数据** —— 反过来的话，中途
/// 失败会留下一个「客户端还指着一个已经不在的端口」的状态，而那正是
/// 这一整节要防的事。
///
/// **我们不删自己。**macOS 上应用删除没有钩子，也不该由应用自己动手 ——
/// 最后一句话是「可以把应用拖进废纸篓了」，那一下由用户来。
#[tauri::command]
pub async fn uninstall(app: tauri::AppHandle, drop_data: bool) -> Out<Vec<String>> {
    let mut log = Vec::new();
    for r in restore_all().await? {
        log.push(tr!(
            format!("{}：{}", r.client, r.detail),
            format!("{}: {}", r.client, r.detail)
        ));
    }
    // 注销 LaunchAgent。**失败只记一句**：它不该挡住卸载，而留下一个
    // 开机自启项的后果，用户在系统设置里看得见、也删得掉
    let launcher = autostart::launcher(&app);
    match launcher.disable() {
        Ok(_) => log.push(tr!("已取消开机启动", "Launch at login turned off").into()),
        // 退路按平台说：自启项在哪儿、用户去哪儿关，三处各不相同
        #[cfg(target_os = "macos")]
        Err(e) => log.push(tr!(
            format!(
                "未能取消开机启动（{e}）。请在「系统设置 › 通用 › 登录项」中关闭 ThinkWatch Lite。"
            ),
            format!(
                "Launch at login could not be turned off ({e}). Turn off ThinkWatch Lite in System Settings › General › Login Items."
            )
        )),
        #[cfg(windows)]
        Err(e) => log.push(tr!(
            format!("未能取消开机启动（{e}）。请在「设置 › 应用 › 启动」中关闭 ThinkWatch Lite。"),
            format!(
                "Launch at login could not be turned off ({e}). Turn off ThinkWatch Lite in Settings › Apps › Startup."
            )
        )),
        // 各家桌面的「开机启动的应用」设置不在同一个地方，文件在哪儿却是确定的
        #[cfg(target_os = "linux")]
        Err(e) => {
            let file = launcher.file().display();
            log.push(tr!(
                format!("未能取消开机启动（{e}）。请删除 {file}。"),
                format!("Launch at login could not be turned off ({e}). Delete {file}.")
            ))
        }
    }
    // AppImage 每次启动写的菜单条目和图标（见 `desktop_entry`）。删不掉的
    // 说出是哪个文件；这之后应用还开着，重新启动会再写一份
    #[cfg(target_os = "linux")]
    log.extend(crate::desktop_entry::remove(&app));
    if drop_data {
        let dir = data_dir();
        match std::fs::remove_dir_all(&dir) {
            Ok(_) => log.push(tr!(
                format!("数据目录已删除：{}", dir.display()),
                format!("Data directory deleted: {}", dir.display())
            )),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => log.push(tr!(
                format!("未能删除数据目录：{}（{e}）", dir.display()),
                format!(
                    "The data directory could not be deleted: {} ({e})",
                    dir.display()
                )
            )),
        }
    } else {
        log.push(tr!(
            format!("数据目录已保留：{}", data_dir().display()),
            format!("Data directory kept: {}", data_dir().display())
        ));
    }
    // 「废纸篓」只是 macOS 的说法；Windows 上走系统的卸载，Linux 上就是删掉
    // 那个 AppImage 文件
    #[cfg(target_os = "macos")]
    let last: String = tr!(
        "现可将应用移到废纸篓。",
        "The app can now be moved to the Trash."
    )
    .into();
    #[cfg(windows)]
    let last: String = tr!(
        "现可卸载或删除应用。",
        "The app can now be uninstalled or deleted."
    )
    .into();
    #[cfg(target_os = "linux")]
    let last: String = match crate::desktop_entry::appimage() {
        Some(file) => tr!(
            format!("现可删除 AppImage 文件：{}", file.display()),
            format!("The AppImage file can now be deleted: {}", file.display())
        ),
        None => tr!("现可删除应用。", "The app can now be deleted.").into(),
    };
    log.push(last);
    Ok(log)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 还原全部：接管过的每一个都还原，**报的是名字**；没接管过的不碰
    #[test]
    fn restoring_all_puts_every_adopted_client_back_and_names_it() {
        use crate::clients::ops;
        let home = tempfile::tempdir().unwrap();
        let backups = home.path().join("backups");
        std::fs::create_dir_all(home.path().join(".claude")).unwrap();
        std::fs::create_dir_all(home.path().join(".codex")).unwrap();
        ops::adopt(
            home.path(),
            &backups,
            "claude-code",
            "http://127.0.0.1:8788",
            "tw-c",
        )
        .unwrap();
        let out = restore_all_in(home.path(), &backups);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].client, "Claude Code");
        assert!(out[0].ok, "{}", out[0].detail);
        assert!(ops::adopted(home.path()).is_empty());
    }
}
