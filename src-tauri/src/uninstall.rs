//! 还原全部接管，以及卸载。

use tw_api::ep;

use crate::{
    AppState, autostart, data_dir,
    error::{Out, text},
};

/// 要还原哪几个，以及各自用什么去指代。返回 `(id, 名字)`。
///
/// **对 core 说 id，对用户说名字。**core 的路由是 `/clients/{id}/restore`，
/// 而 `name` 是显示名：拿「Claude Code」去拼 URI，那个空格连请求都发不出去；
/// 拿「Zed」去发，换来的是一句「未知的客户端 Zed」。两者只有 opencode 恰好
/// 相同，所以挑错了字段，测一遍还会看到一个成功的例子。把这一步单独拎出来，
/// 就是为了让「哪个字段进地址」有地方可测。
pub(crate) fn restore_targets(list: &tw_api::ClientsResponse) -> Vec<(&str, &str)> {
    list.clients
        .iter()
        .filter(|c| c.adopted_at_ms.is_some())
        .map(|c| (c.id.as_str(), c.name.as_str()))
        .collect()
}

/// 把所有接管过的客户端一次性还原（第二层的第二个入口）。
///
/// **这个按钮要一直看得见。**用户敢按下「接管」的前提，就是看得见退路
/// —— 藏起来的退路等于没有退路，他会在心里给接管打上「不可逆」的标签。
///
/// **一家失败不影响别家。**逐个还原、逐个记结果：五个客户端里有一个的
/// 文件被改坏了，不该让另外四个也留在接管状态。
#[tauri::command]
pub async fn restore_all(state: tauri::State<'_, AppState>) -> Out<Vec<RestoreOutcome>> {
    let list = state
        .control
        .call::<ep::Clients>(&[], &())
        .await
        .map_err(text)?;
    let mut out = Vec::new();
    for (id, name) in restore_targets(&list) {
        let r = state.control.call::<ep::Restore>(&[id], &()).await;
        out.push(RestoreOutcome {
            client: name.to_string(),
            ok: r.is_ok(),
            detail: match r {
                Ok(_) => tr!("已还原", "Restored").to_string(),
                Err(e) => format!("{e:#}"),
            },
        });
    }
    Ok(out)
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
pub async fn uninstall(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    drop_data: bool,
) -> Out<Vec<String>> {
    let mut log = Vec::new();
    for r in restore_all(state).await? {
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

    /// 还原一个客户端时，进地址的必须是 id，不是显示名。
    ///
    /// **这条缝裂过一次。**「全部还原」当时逐个传的是 `name`：
    /// 「Claude Code」带空格，连 URI 都拼不出来；「Zed」换来一句
    /// 「未知的客户端 Zed」。五个里只有 opencode 的 id 和名字一样，于是
    /// 它每次都成功 —— 手上有一个能用的例子，这个错就很难被看见。
    /// 夹着 opencode 一起断言，就是不让那个巧合再当证据用。
    #[test]
    fn restore_addresses_a_client_by_id_and_reports_it_by_name() {
        let list = clients_json(&[
            (r#""claude-code""#, r#""Claude Code""#, "1700000000000"),
            (r#""codex""#, r#""Codex""#, "null"),
            (r#""opencode""#, r#""opencode""#, "1700000000001"),
            (r#""zed""#, r#""Zed""#, "1700000000002"),
        ]);

        // 没接管过的那个不在里面：还原一个本来就没动过的客户端，core 那边
        // 是一次没有意义的写
        assert_eq!(
            restore_targets(&list),
            vec![
                ("claude-code", "Claude Code"),
                ("opencode", "opencode"),
                ("zed", "Zed"),
            ]
        );
    }

    /// 按 core 实际发来的形状造 `/clients` 的响应。
    ///
    /// 直接填结构体的话，字段一加一减这里就编不过，而这个测试要问的事情
    /// 跟那些字段无关；走 JSON 还顺带钉住了 `id`、`name`、`adopted_at_ms`
    /// 这三个字段名 —— 它们要是在 core 那边改了名，这里会响。
    fn clients_json(each: &[(&str, &str, &str)]) -> tw_api::ClientsResponse {
        let clients = each
            .iter()
            .map(|(id, name, adopted_at_ms)| {
                format!(
                    r#"{{
                        "id": {id},
                        "name": {name},
                        "path": "/tmp/x",
                        "real": "/tmp/x",
                        "installed": true,
                        "has_config": true,
                        "adopted_at_ms": {adopted_at_ms},
                        "endpoint": "http://127.0.0.1:8080",
                        "shadows": [],
                        "takes_effect": "immediately",
                        "warns_when_silent": true,
                        "verified": "measured",
                        "costs": [],
                        "last_seen_ms": null,
                        "manual": {{ "steps": [], "fields": [], "endpoint": "http://127.0.0.1:8080" }}
                    }}"#
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        serde_json::from_str(&format!(
            r#"{{
                "clients": [{clients}],
                "manual": [],
                "gateway_base": "http://127.0.0.1:8080",
                "keys": ["tw-x"]
            }}"#
        ))
        .expect("core 发来的 /clients 解不动")
    }
}
