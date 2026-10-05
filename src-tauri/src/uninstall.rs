//! 还原全部接管，以及卸载。
//!
//! 卸载有两个入口：应用里的「卸载」（[`uninstall`]），和 Windows 上系统的卸载程序
//! （`cleanup`：`--uninstall-cleanup`，不起界面）。**两边走同一套步骤** ——
//! 还原客户端（[`restore_everywhere`]、[`restore_steps`]）、删数据目录（[`drop_data`]）、
//! 最后那一句（[`last_line`]）—— 只在「core 怎么停」「开机自启怎么注销」上各走各的：
//! 应用里有守护和插件可用，卸载程序那边应用已经被关掉了。

use std::path::Path;
use std::time::Duration;

#[cfg(not(windows))]
use crate::autostart;
use crate::{data_dir, error::Out, wire::UninstallStep};

/// 把所有接管过的客户端一次性还原（第二层的第二个入口）。
///
/// **这个按钮要一直看得见。**用户敢按下「接管」的前提，就是看得见退路
/// —— 藏起来的退路等于没有退路，他会在心里给接管打上「不可逆」的标签。
///
/// 整个放在阻塞线程上：每个发行版要唤醒好几秒，逐个读写它们的文件
///
/// 还原了这台电脑上的 Claude Desktop 时，接着删接管时在它的密钥上加的那条路由规则
/// （`clients::desktop_rule`）。删不成照样算还原了，那一条带上提醒（[`RestoreOutcome::warning`]）
#[tauri::command]
pub async fn restore_all(state: tauri::State<'_, crate::AppState>) -> Out<Vec<RestoreOutcome>> {
    let mut out =
        crate::clients::blocking(|| restore_everywhere(&tw_adopt::foreign::backup_root())).await?;
    let desktop = tw_adopt::desktop::ID;
    if let Some(r) = out
        .iter_mut()
        .find(|r| r.here && r.id == desktop && r.ok && !r.skipped)
    {
        r.warning = crate::clients::desktop_rule::remove_after_restore(&state.control, desktop)
            .await
            .map(|w| crate::core_text::text(&w));
    }
    Ok(out)
}

/// 还原这一份接管着的每一个客户端：这台电脑上的，和每个 WSL 发行版里的。阻塞。
///
/// **一家失败不影响别家。**逐个还原、逐个记结果：五个客户端里有一个的
/// 文件被改坏了，不该让另外四个也留在接管状态。**也不问 core**：退路不该
/// 依赖网关还在不在。
///
/// **WSL 里的也还原。**每个发行版都要读一遍（会把它们唤醒），读不到的那一个记一条
/// 失败：它里面有没有接管着的客户端，这时说不上来，不能当成「没有」。
///
/// **另一个 ThinkWatch Lite 接管的跳过**（`clients::ops::theirs`），结果里列出来、
/// 标成跳过：它的备份在那一份的数据目录里，该由那一份还原。
///
/// `backups` 是这一份的备份目录（`tw_adopt::foreign::backup_root`），测试里换成临时的
pub fn restore_everywhere(backups: &Path) -> Vec<RestoreOutcome> {
    let mut out = restore_all_in(&crate::clients::home_dir(), backups, true, |n| {
        n.to_string()
    });
    for d in crate::clients::wsl::distros() {
        let name = d.name.clone();
        match crate::clients::wsl::open(d) {
            Ok(w) => out.extend(restore_all_in(&w.home, backups, false, |n| {
                crate::clients::wsl::display_name(n, &w)
            })),
            Err(e) => out.push(RestoreOutcome {
                client: crate::clients::wsl::place_name(&name),
                ok: false,
                skipped: false,
                detail: crate::core_text::text(&e),
                warning: None,
                id: String::new(),
                here: false,
            }),
        }
    }
    out
}

/// `here`：这台电脑上的（不是某个 WSL 发行版里的）
fn restore_all_in(
    home: &Path,
    backups: &Path,
    here: bool,
    name: impl Fn(&str) -> String,
) -> Vec<RestoreOutcome> {
    use crate::clients::ops;
    let restored = ops::adopted(home, backups).into_iter().map(|c| {
        let r = ops::restore(home, backups, c.id, None);
        RestoreOutcome {
            client: name(c.name),
            ok: r.is_ok(),
            skipped: false,
            detail: match r {
                Ok(_) => tr!("已还原", "Restored").to_string(),
                Err(e) => crate::core_text::text(&e),
            },
            warning: None,
            id: c.id.to_string(),
            here,
        }
    });
    let skipped = ops::adopted_elsewhere(home, backups)
        .into_iter()
        .map(|c| RestoreOutcome {
            client: name(c.name),
            ok: true,
            skipped: true,
            detail: tr!(
                "由另一个 ThinkWatch Lite 接管，需在接管它的 ThinkWatch Lite 中还原",
                "Connected by another ThinkWatch Lite. Restore it from the ThinkWatch Lite that connected it"
            )
            .to_string(),
            warning: None,
            id: c.id.to_string(),
            here,
        });
    restored.chain(skipped).collect()
}

#[derive(Debug, serde::Serialize)]
pub struct RestoreOutcome {
    client: String,
    ok: bool,
    /// 另一个 ThinkWatch Lite 接管的，没动它。**不算失败**：这一份没有它的备份，
    /// 也就谈不上还原不了
    skipped: bool,
    detail: String,
    /// 还原了、但该说一声的事：Claude Desktop 接管时加的那条路由规则没删成
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
    /// 客户端的 id、是不是这台电脑上的：只在这一侧用
    #[serde(skip)]
    id: String,
    #[serde(skip)]
    here: bool,
}

/// 还原的结果写成卸载的步骤，一个客户端一行。第二个值：这一份接管的是不是全部
/// 还原了（跳过的不算没还原，见 [`RestoreOutcome::skipped`]）
pub fn restore_steps(restored: Vec<RestoreOutcome>) -> (Vec<UninstallStep>, bool) {
    let all = restored.iter().all(|r| r.ok);
    let log = restored
        .into_iter()
        .map(|r| {
            // 还原了、但还有一句要说的：接在后面
            let detail = match &r.warning {
                Some(w) => w.clone(),
                None => r.detail.clone(),
            };
            UninstallStep {
                ok: r.ok,
                text: tr!(
                    format!("{}：{}", r.client, detail),
                    format!("{}: {}", r.client, detail)
                ),
            }
        })
        .collect();
    (log, all)
}

/// 删数据目录要试几次、隔多久。
///
/// **core 退出要几秒。**系统卸载程序先关掉应用，core 靠 `--parent` 守望发现父进程没了
/// 才退（两秒看一次）；在那之前它开着数据库，Windows 上删到一半就会失败。应用里卸载
/// 先停了 core，只是刚退出的进程放手文件还要一小会儿
#[derive(Debug, Clone, Copy)]
pub struct Retry {
    pub tries: u32,
    pub pause: Duration,
}

/// 应用里卸载：core 已经停了，只等文件放手
pub const IN_APP: Retry = Retry {
    tries: 5,
    pause: Duration::from_millis(200),
};

/// 删数据目录（`drop_data` 为真时）。
///
/// **有客户端没还原成，数据目录就不删**（`restored_all` 为假）。它还指着本机的网关，
/// 而它的全文备份就在这个目录里：这时删掉，它剩下的只是一份指着不存在的端口的配置、
/// 再没有退路 —— 正是「先还原、最后才删数据」这个顺序要防的那种状态。
///
/// `keep`：留下不删的一个子目录（绿色版在应用里卸载时，正开着的界面占着的
/// `data\webview`；之后删整个文件夹时它跟着走）。
pub fn drop_data(
    dir: &Path,
    drop_data: bool,
    restored_all: bool,
    keep: Option<&Path>,
    retry: Retry,
) -> UninstallStep {
    if !drop_data {
        return UninstallStep::done(tr!(
            format!("数据目录已保留：{}", dir.display()),
            format!("Data directory kept: {}", dir.display())
        ));
    }
    if !restored_all {
        return UninstallStep::failed(tr!(
            format!(
                "数据目录已保留：{}。上面有客户端没能还原，它们的备份在这个目录里；处理好之后再删除它",
                dir.display()
            ),
            format!(
                "Data directory kept: {}. Some clients above could not be restored, and their backups are in it; delete it once they are sorted out.",
                dir.display()
            )
        ));
    }
    match remove_retrying(dir, keep, retry) {
        Ok(()) => UninstallStep::done(tr!(
            format!("数据目录已删除：{}", dir.display()),
            format!("Data directory deleted: {}", dir.display())
        )),
        Err(e) => UninstallStep::failed(tr!(
            format!("未能删除数据目录：{}（{e}）", dir.display()),
            format!(
                "The data directory could not be deleted: {} ({e})",
                dir.display()
            )
        )),
    }
}

/// 删 `dir`（留下 `keep`），删不掉就隔一会儿再试，至多 `retry.tries` 次。本来就没有算删掉了
fn remove_retrying(dir: &Path, keep: Option<&Path>, retry: Retry) -> std::io::Result<()> {
    let mut left = retry.tries.max(1);
    loop {
        left -= 1;
        match remove(dir, keep) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) if left > 0 => std::thread::sleep(retry.pause),
            r => return r,
        }
    }
}

fn remove(dir: &Path, keep: Option<&Path>) -> std::io::Result<()> {
    // `keep` 得是 `dir` 下面的一项才算数。两边可能是不同的写法（一个带 `\\?\` 前缀），
    // 对不上字面时按磁盘上的真实路径比
    let same = |a: &Path| {
        a == dir
            || matches!(
                (std::fs::canonicalize(a), std::fs::canonicalize(dir)),
                (Ok(x), Ok(y)) if x == y
            )
    };
    let Some(name) = keep
        .filter(|k| k.parent().is_some_and(same))
        .and_then(|k| k.file_name())
    else {
        return std::fs::remove_dir_all(dir);
    };
    // 一项一项删，删不掉的记下第一个原因、接着删别的
    let mut first = None;
    for e in std::fs::read_dir(dir)? {
        let e = e?;
        if e.file_name() == name {
            continue;
        }
        let p = e.path();
        let r = if p.is_dir() && !p.is_symlink() {
            std::fs::remove_dir_all(&p)
        } else {
            std::fs::remove_file(&p)
        };
        if let Err(e) = r {
            first.get_or_insert(e);
        }
    }
    first.map_or(Ok(()), Err)
}

/// 最后一句：现在可以把应用本身删掉了。**我们不删自己** —— macOS 上应用删除没有
/// 钩子，也不该由应用自己动手；那一下由用户来。
///
/// 「废纸篓」只是 macOS 的说法；Windows 上安装版走系统的卸载，绿色版删掉整个文件夹
/// （数据也在里面），Linux 上就是删掉那个 AppImage 文件
pub fn last_line() -> String {
    #[cfg(target_os = "macos")]
    let last = tr!(
        "现可将应用移到废纸篓。",
        "The app can now be moved to the Trash."
    )
    .into();
    #[cfg(windows)]
    let last = if crate::portable::is_portable() {
        tr!(
            "卸载步骤已完成，现可删除整个文件夹。",
            "Uninstall steps are complete. The whole folder can now be deleted."
        )
        .into()
    } else {
        tr!(
            "现可卸载或删除应用。",
            "The app can now be uninstalled or deleted."
        )
        .into()
    };
    #[cfg(target_os = "linux")]
    let last = match crate::desktop_entry::appimage() {
        Some(file) => tr!(
            format!("现可删除 AppImage 文件：{}", file.display()),
            format!("The AppImage file can now be deleted: {}", file.display())
        ),
        None => tr!("现可删除应用。", "The app can now be deleted.").into(),
    };
    last
}

/// 完全卸载（第二层的第三个入口）。
///
/// 顺序是**先还原、再注销自启、最后才提删数据** —— 反过来的话，中途
/// 失败会留下一个「客户端还指着一个已经不在的端口」的状态，而那正是
/// 这一整节要防的事。
///
/// 每一步交回做成了没有（`UninstallStep`），一步没做成不影响后面的步骤。
///
/// **`.wslconfig` 不改回。**客户端页上改成 mirrored 的那一项是 WSL 自己的网络设置，
/// 改的时候是为了接管，改完之后别的东西也可能用上了它；卸载确认框里说了这件事
/// （`clients::wsl::kept`），修改前的全文备份留在备份目录里。
#[tauri::command]
pub async fn uninstall(app: tauri::AppHandle, drop_data: bool) -> Out<Vec<UninstallStep>> {
    use tauri::Manager;
    let (mut log, restored_all) = restore_steps(restore_all(app.state()).await?);
    // 注销 LaunchAgent。**失败只记一句**：它不该挡住卸载，而留下一个
    // 开机自启项的后果，用户在系统设置里看得见、也删得掉
    #[cfg(not(windows))]
    {
        let launcher = autostart::launcher(&app);
        match launcher.disable() {
            Ok(_) => log.push(UninstallStep::done(tr!(
                "已取消开机启动",
                "Launch at login turned off"
            ))),
            // 退路按平台说：自启项在哪儿、用户去哪儿关，各不相同
            #[cfg(target_os = "macos")]
            Err(e) => log.push(UninstallStep::failed(tr!(
                format!(
                    "未能取消开机启动（{e}）。请在「系统设置 › 通用 › 登录项」中关闭 ThinkWatch Lite。"
                ),
                format!(
                    "Launch at login could not be turned off ({e}). Turn off ThinkWatch Lite in System Settings › General › Login Items."
                )
            ))),
            // 各家桌面的「开机启动的应用」设置不在同一个地方，文件在哪儿却是确定的
            #[cfg(target_os = "linux")]
            Err(e) => {
                let file = launcher.file().display();
                log.push(UninstallStep::failed(tr!(
                    format!("未能取消开机启动（{e}）。请删除 {file}。"),
                    format!("Launch at login could not be turned off ({e}). Delete {file}.")
                )))
            }
        }
    }
    // Windows 上开机自启、`thinkwatch://` 链接、通知登记都在 HKCU 里，指着正在运行的
    // 这个 exe（见 `winreg`）：和系统卸载程序走同一步，删指着自己的那几项、各记一行
    #[cfg(windows)]
    match std::env::current_exe() {
        Ok(exe) => log.extend(crate::winreg::release_all(&exe)),
        Err(e) => log.push(UninstallStep::failed(tr!(
            format!("未能确定程序位置，注册项未清理（{e}）"),
            format!("The program location could not be determined, so its registry entries were left in place ({e})")
        ))),
    }
    // AppImage 每次启动写的菜单条目和图标（见 `desktop_entry`）。删不掉的
    // 说出是哪个文件；这之后应用还开着，重新启动会再写一份
    #[cfg(target_os = "linux")]
    log.extend(crate::desktop_entry::remove(&app));
    if drop_data && restored_all {
        // 先停掉本机的 core：它开着数据库和日志，Windows 上删到一半就会失败，而且留下
        // 一个没有数据目录还在跑的网关。连着远程时它本来就停着，这一步什么都不做
        if let Some(st) = app.try_state::<crate::AppState>() {
            st.supervisor
                .stop_and_wait(std::time::Duration::from_secs(5))
                .await;
        }
    }
    // 绿色版的界面缓存在数据目录里（`data\webview`），开着的窗口正占着它
    let keep = crate::portable::webview_data_dir();
    let dir = data_dir();
    let step = tokio::task::spawn_blocking(move || {
        self::drop_data(&dir, drop_data, restored_all, keep.as_deref(), IN_APP)
    })
    .await
    .map_err(|e| crate::error::CmdError::plain(e.to_string()))?;
    log.push(step);
    log.push(UninstallStep::done(last_line()));
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
            &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-c", Vec::new()),
            None,
            &tw_adopt::cloud::Around::default(),
        )
        .unwrap();
        let out = restore_all_in(home.path(), &backups, true, |n| n.to_string());
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].client, "Claude Code");
        assert!(out[0].ok, "{}", out[0].detail);
        assert!(!out[0].skipped);
        assert!(ops::adopted(home.path(), &backups).is_empty());
    }

    /// 另一个 ThinkWatch Lite（备份在它自己的数据目录里）接管的：不动它，结果里列出来、
    /// 标成跳过，**不算失败** —— 卸载照样能删这一份的数据目录
    #[test]
    fn a_client_taken_over_by_another_instance_is_skipped_and_named() {
        use crate::clients::ops;
        let home = tempfile::tempdir().unwrap();
        let (mine, theirs) = (home.path().join("a/backups"), home.path().join("b/backups"));
        std::fs::create_dir_all(home.path().join(".claude")).unwrap();
        std::fs::create_dir_all(home.path().join(".codex")).unwrap();
        let gw =
            |key: &str| tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", key, Vec::new());
        let around = tw_adopt::cloud::Around::default();
        ops::adopt(
            home.path(),
            &theirs,
            "claude-code",
            &gw("tw-b"),
            None,
            &around,
        )
        .unwrap();
        ops::adopt(home.path(), &mine, "codex", &gw("tw-a"), None, &around).unwrap();
        let settings = home.path().join(".claude/settings.json");
        let before = std::fs::read_to_string(&settings).unwrap();

        let out = restore_all_in(home.path(), &mine, true, |n| n.to_string());
        let got: Vec<_> = out
            .iter()
            .map(|r| (r.client.as_str(), r.ok, r.skipped))
            .collect();
        assert_eq!(got, [("Codex", true, false), ("Claude Code", true, true)]);
        assert_eq!(
            std::fs::read_to_string(&settings).unwrap(),
            before,
            "别人接管的没被动过"
        );
        // 那一份照样能还原它
        assert_eq!(ops::adopted(home.path(), &theirs).len(), 1);
        // 跳过的不挡删数据：这一份没有它的备份
        let (log, all) = restore_steps(out);
        assert!(all);
        assert!(log[1].text.contains("Claude Code"), "{}", log[1].text);
        // 从这一份直接还原、接管它，都拦下来
        let e = ops::restore(home.path(), &mine, "claude-code", None).unwrap_err();
        assert_eq!(e.code, "adopt.other_instance");
        let e = ops::adopt(
            home.path(),
            &mine,
            "claude-code",
            &gw("tw-a"),
            None,
            &around,
        )
        .unwrap_err();
        assert_eq!(e.code, "adopt.other_instance");
        assert_eq!(std::fs::read_to_string(&settings).unwrap(), before);
    }

    /// 有一个没还原成就算没全部还原：数据目录要留着
    #[test]
    fn one_failed_restore_means_not_all_restored() {
        let r = |ok, skipped| RestoreOutcome {
            client: "X".into(),
            ok,
            skipped,
            detail: String::new(),
            warning: None,
            id: String::new(),
            here: true,
        };
        assert!(restore_steps(vec![r(true, false), r(true, true)]).1);
        let (log, all) = restore_steps(vec![r(true, false), r(false, false)]);
        assert!(!all);
        assert_eq!(log.iter().filter(|s| !s.ok).count(), 1);
    }

    const ONCE: Retry = Retry {
        tries: 1,
        pause: Duration::ZERO,
    };

    /// 数据目录：没勾就留着；勾了但有客户端没还原成也留着（它们的备份在里面）；
    /// 都还原了才删。本来就没有的算删掉了
    #[test]
    fn the_data_directory_goes_only_when_asked_and_every_client_is_back() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("ThinkWatch");
        std::fs::create_dir_all(dir.join("backups")).unwrap();
        std::fs::write(dir.join("config.yaml"), "x").unwrap();

        let kept = drop_data(&dir, false, true, None, ONCE);
        assert!(kept.ok && dir.exists(), "{}", kept.text);
        let held = drop_data(&dir, true, false, None, ONCE);
        assert!(!held.ok && dir.exists(), "{}", held.text);
        let gone = drop_data(&dir, true, true, None, ONCE);
        assert!(gone.ok && !dir.exists(), "{}", gone.text);
        assert!(drop_data(&dir, true, true, None, ONCE).ok, "已经没有了");
    }

    /// 绿色版在应用里卸载：开着的界面占着的 `webview` 留下，别的都删
    #[test]
    fn the_folder_in_use_is_left_and_everything_else_goes() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("data");
        let webview = dir.join("webview");
        std::fs::create_dir_all(&webview).unwrap();
        std::fs::create_dir_all(dir.join("backups/1-0000")).unwrap();
        std::fs::write(dir.join("config.yaml"), "x").unwrap();
        std::fs::write(webview.join("Local State"), "x").unwrap();

        let step = drop_data(&dir, true, true, Some(&webview), ONCE);
        assert!(step.ok, "{}", step.text);
        let left: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(left, ["webview"]);
        // 换一种写法（Windows 上 `canonicalize` 给的是带 `\\?\` 的那种）也认得出是它
        std::fs::write(dir.join("config.yaml"), "x").unwrap();
        let spelled = std::fs::canonicalize(&dir).unwrap().join("webview");
        let step = drop_data(&dir, true, true, Some(&spelled), ONCE);
        assert!(step.ok && webview.exists() && !dir.join("config.yaml").exists());
        // 不在数据目录里的 `keep` 不算数：整个删
        let other = d.path().join("elsewhere");
        let step = drop_data(&dir, true, true, Some(&other), ONCE);
        assert!(step.ok && !dir.exists(), "{}", step.text);
    }
}
