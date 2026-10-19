//! 同步（方案第 6 节）在这一侧的几件事。**同步本身在 core**：存储、合并、冲突、版本都是
//! core 的，界面照着 `/sync` 画、按端点改。这里做 core 做不了的：
//!
//! - **需要处理的状态发一次系统通知**（冲突、同步位置连不上、拒绝访问、口令在别处改了、
//!   版本过新）。正常运转时什么都不说；判定照例交给通知总线；
//! - **网关密钥换了值，改写这台机器上接管着的客户端**（6.12）：同步、恢复、导入覆盖改了
//!   密钥时 core 说一声（`gateway_keys_changed`），这里走和「更换密钥」同一条路
//!   （`clients::sync_rotated`）。远程模式下也一样：密钥是连着的那个 core 发的；
//! - **哪几把密钥正被接管着的客户端用着**，告诉 core（`PUT /pinned-keys`）：同步要删、
//!   恢复要删的时候，core 据此保留它们；
//! - **打开主窗口时立刻同步一次**（6.5）；
//! - 选同步文件夹的系统对话框、本机的计算机名（设备名称的缺省值）。

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;
use tw_api::{Msg, SyncState, SyncView};

use crate::AppState;
use crate::error::Out;
use crate::notices::{self, Level, Signal};

/// 事件流上同步那三种（`gateway` 的事件桥调）。界面那一份由调用方照常转发
pub fn on_event(app: &tauri::AppHandle, ev: &tw_api::Event) {
    match ev {
        tw_api::Event::SyncStatus { view, .. } => tell(app, view),
        tw_api::Event::GatewayKeysChanged { names, .. } => {
            let (app, names) = (app.clone(), names.clone());
            tauri::async_runtime::spawn(async move { keys_changed(&app, names).await });
        }
        tw_api::Event::ClientPrefsChanged { .. } => crate::client_prefs::pull_soon(app),
        _ => {}
    }
}

/// 事件流接上了（启动、重连、换了连接）：按现状对一次。事件流只说「那一刻」，接上之前
/// 发生的（别的设备改了偏好、同步早就进了冲突）这里补上
pub fn on_link(app: &tauri::AppHandle) {
    pinned_soon(app);
    crate::client_prefs::pull_soon(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(st) = app.try_state::<AppState>() else {
            return;
        };
        match st.control.call::<tw_api::ep::SyncStatus>(&[], &()).await {
            Ok(v) => tell(&app, &v),
            Err(e) => tracing::debug!("没问到同步状态：{e:#}"),
        }
    });
}

// ───────────────────────────────────────────── 通知

/// 同步的几种需要处理的状态，各一个键。**都在 `sync:` 下面**，点开落在设置的「同步与备份」
const KEYS: [&str; 8] = [
    "sync:conflict",
    "sync:unreachable",
    "sync:auth",
    "sync:locked",
    "sync:too_new",
    "sync:keyring",
    "sync:emptied",
    "sync:misconfigured",
];

/// 每个键此刻说的是什么（标题和正文）。没开着的不在里面
type Said = BTreeMap<&'static str, (String, String)>;

/// 这一份同步状态该开着哪几条、各怎么说
pub fn wanted(b: &SyncView) -> Said {
    let mut out = Said::new();
    // 冲突和状态分开看：连不上的时候冲突照样还在
    if b.conflicts > 0 {
        let n = b.conflicts;
        out.insert(
            "sync:conflict",
            (
                tr!(
                    format!("同步有 {n} 项冲突"),
                    if n == 1 {
                        "1 Sync Conflict".to_string()
                    } else {
                        format!("{n} Sync Conflicts")
                    }
                ),
                tr!(
                    "本机与其他设备将同一对象修改为不同内容。处理之前，本机保留当前内容。",
                    "This device and another one changed the same item in different ways. Until it is resolved, this device keeps its own version."
                )
                .to_string(),
            ),
        );
    }
    let why = b
        .error
        .as_ref()
        .map(crate::core_text::clause)
        .unwrap_or_default();
    let said: Option<(&'static str, String, String)> = match b.state {
        SyncState::Unreachable => Some((
            "sync:unreachable",
            tr!("无法连接同步位置", "Sync Location Unreachable").to_string(),
            if why.is_empty() {
                tr!(
                    "恢复后自动继续，本机的修改在恢复后上传。",
                    "Syncing continues once it is reachable again; changes made on this device are uploaded then."
                )
                .to_string()
            } else {
                tr!(
                    format!("{why}。恢复后自动继续，本机的修改在恢复后上传。"),
                    format!(
                        "{why}. Syncing continues once it is reachable again; changes made on this device are uploaded then."
                    )
                )
            },
        )),
        SyncState::AuthFailed => Some((
            "sync:auth",
            tr!("同步位置拒绝访问", "Sync Location Denied Access").to_string(),
            tr!(
                "请在设置中修改同步位置的连接参数。",
                "Change the sync location's connection details in Settings."
            )
            .to_string(),
        )),
        SyncState::Locked => Some((
            "sync:locked",
            tr!(
                "同步口令已在其他设备上更改",
                "Sync Passphrase Changed on Another Device"
            )
            .to_string(),
            tr!(
                "在设置中输入新的同步口令后继续同步。",
                "Enter the new sync passphrase in Settings to continue syncing."
            )
            .to_string(),
        )),
        SyncState::TooNew => Some((
            "sync:too_new",
            tr!("同步已暂停", "Sync Paused").to_string(),
            tr!(
                "其他设备使用较新版本，更新 ThinkWatch Lite 后继续同步。",
                "Another device uses a newer version. Update ThinkWatch Lite to continue syncing."
            )
            .to_string(),
        )),
        SyncState::KeyringMissing => Some((
            "sync:keyring",
            tr!(
                "同步位置上的同步密钥不可用",
                "Sync Key at the Sync Location Unavailable"
            )
            .to_string(),
            tr!(
                "同步已暂停。在设置中重新上传本机配置，或停止同步。",
                "Syncing is paused. Upload this device's configuration again in Settings, or stop syncing."
            )
            .to_string(),
        )),
        SyncState::Emptied => Some((
            "sync:emptied",
            tr!("同步位置为空", "Sync Location Empty").to_string(),
            tr!(
                "同步已暂停。在设置中重新上传本机配置，或停止同步。",
                "Syncing is paused. Upload this device's configuration again in Settings, or stop syncing."
            )
            .to_string(),
        )),
        SyncState::Misconfigured => Some((
            "sync:misconfigured",
            tr!("同步设置无法使用", "Sync Settings Unusable").to_string(),
            if why.is_empty() {
                tr!(
                    "请在设置中修改同步位置的连接参数或出站代理。",
                    "Change the sync location's connection details or outbound proxy in Settings."
                )
                .to_string()
            } else {
                tr!(
                    format!("{why}。请在设置中修改同步位置的连接参数或出站代理。"),
                    format!(
                        "{why}. Change the sync location's connection details or outbound proxy in Settings."
                    )
                )
            },
        )),
        _ => None,
    };
    if let Some((k, title, body)) = said {
        out.insert(k, (title, body));
    }
    out
}

/// 上一次说到哪儿了。`None`：这次运行里还没说过（上一次运行留下的那几条要按现状收起）
static SAID: Mutex<Option<Said>> = Mutex::new(None);

/// 从上一份到这一份要发的几条：新开的、说法变了的开起来，不再成立的收起
pub fn changes(before: Option<&Said>, now: &Said) -> Vec<Signal> {
    let mut out = Vec::new();
    for k in KEYS {
        match (before.and_then(|b| b.get(k)), now.get(k)) {
            (prev, Some((title, body))) if prev != Some(&(title.clone(), body.clone())) => out
                .push(
                    Signal::raised(k, Level::Warning, title.clone())
                        .body(body.clone())
                        .view(SYNC_VIEW)
                        // core 已经替这几件事等过了（连不上要连续两小时）：到了就说
                        .now(),
                ),
            (_, Some(_)) => {}
            // 第一次（`before` 是空）也收：上一次运行留下的、现在已经不成立的
            (Some(_), None) => out.push(Signal::cleared(k)),
            (None, None) if before.is_none() => out.push(Signal::cleared(k)),
            (None, None) => {}
        }
    }
    out
}

/// 通知点开落在哪：设置的「同步与备份」一节
pub const SYNC_VIEW: &str = "settings:sync-backup";

fn tell(app: &tauri::AppHandle, b: &SyncView) {
    let Some(n) = app.try_state::<std::sync::Arc<notices::Notices>>() else {
        return;
    };
    let now = wanted(b);
    let signals = {
        let mut said = SAID.lock().unwrap_or_else(|e| e.into_inner());
        let s = changes(said.as_ref(), &now);
        *said = Some(now);
        s
    };
    let at = notices::now_ms();
    for s in signals {
        n.ingest(s, at);
    }
}

// ───────────────────────────────────────────── 网关密钥换了值

/// 一次只改一批：两条事件接连到时，同一个客户端的配置不在两处同时写
static REWRITING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// 这几把密钥的值被同步、恢复或导入换掉了：接管着的客户端里写着旧值，改成新值。
///
/// 和「更换密钥」是同一条路（`clients::sync_rotated`），只是新值由这里去问 core。**成功且
/// 当场生效的不说**；要重启客户端才生效的、没改成的发一条通知 —— 那是要人处理的
async fn keys_changed(app: &tauri::AppHandle, names: Vec<String>) {
    let Some(st) = app.try_state::<AppState>() else {
        return;
    };
    let _one = REWRITING.lock().await;
    let keys = match st.control.call::<tw_api::ep::Keys>(&[], &()).await {
        Ok(k) => k,
        Err(e) => {
            tracing::warn!("网关密钥换了值，但没问到密钥列表：{e:#}");
            return;
        }
    };
    for name in names {
        let owner = match crate::clients::adopted_owner(&keys, &name) {
            Ok(Some(o)) => o,
            Ok(None) => continue,
            Err(e) => {
                tracing::warn!(key = %name, "看不出这把密钥的主人还接管着没有：{}", e.text);
                continue;
            }
        };
        let fresh = match st.control.call::<tw_api::ep::KeyValue>(&[&name], &()).await {
            Ok(v) => v.key,
            Err(e) => {
                tracing::warn!(key = %name, "没问到新的密钥值：{e:#}");
                continue;
            }
        };
        let signal = match crate::clients::sync_rotated(&st, &owner, &fresh).await {
            Ok(s) if s.takes_effect == crate::wire::TakesEffect::Immediately => None,
            Ok(s) => Some(restart_needed(&s.client, &s.name)),
            Err(f) => Some(rewrite_failed(&f.client, &f.name, &f.error)),
        };
        if let (Some(s), Some(n)) = (signal, app.try_state::<std::sync::Arc<notices::Notices>>()) {
            n.ingest(s, notices::now_ms());
        }
    }
}

/// 改好了，但要重启客户端才用上新值
fn restart_needed(client: &str, name: &str) -> Signal {
    Signal::raised(
        format!("keysync:{client}"),
        Level::Warning,
        tr!(
            format!("{name} 的网关密钥已更新"),
            format!("“{name}” Gateway Key Updated")
        ),
    )
    .body(tr!(
        format!("网关密钥经同步或恢复更换，已写入 {name} 的配置。重新启动 {name} 后生效。"),
        format!(
            "The gateway key changed through sync or a restore and has been written to {name}'s configuration. Restart {name} for it to take effect."
        )
    ))
    .view("clients")
    .event()
}

/// 没改成：它配置里还是旧值，下一个请求就是 401
fn rewrite_failed(client: &str, name: &str, why: &Msg) -> Signal {
    let why = crate::core_text::clause(why);
    Signal::raised(
        format!("keysync:{client}"),
        Level::Warning,
        tr!(
            format!("未能更新 {name} 的网关密钥"),
            format!("Gateway Key Not Updated for “{name}”")
        ),
    )
    .body(tr!(
        format!("网关密钥经同步或恢复更换，但未能写入 {name} 的配置：{why}。"),
        format!(
            "The gateway key changed through sync or a restore, but it could not be written to {name}'s configuration: {why}."
        )
    ))
    .view("clients")
    .event()
}

// ───────────────────────────────────────────── 固定密钥

/// 接管着的客户端变了（文件监视、接管、还原）一阵子里只报一次
const PIN_SETTLE: Duration = Duration::from_millis(800);

static PIN_DUE: Mutex<Option<Instant>> = Mutex::new(None);

/// 过一会儿把固定密钥报给 core。接连叫好几次（文件监视一次改动报好几下）只报一次
pub fn pinned_soon(app: &tauri::AppHandle) {
    let due = Instant::now() + PIN_SETTLE;
    let first = {
        let mut g = PIN_DUE.lock().unwrap_or_else(|e| e.into_inner());
        let first = g.is_none();
        *g = Some(due);
        first
    };
    if !first {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let due = PIN_DUE
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .unwrap_or_else(Instant::now);
            let now = Instant::now();
            if due <= now {
                break;
            }
            tokio::time::sleep(due - now).await;
        }
        *PIN_DUE.lock().unwrap_or_else(|e| e.into_inner()) = None;
        if let Err(e) = report_pinned(&app).await {
            tracing::debug!("固定密钥没报上：{}", e.into_msg().text);
        }
    });
}

/// 算出此刻接管着的客户端在用的密钥，告诉 core
async fn report_pinned(app: &tauri::AppHandle) -> Out<Vec<String>> {
    let st = app
        .try_state::<AppState>()
        .ok_or_else(|| crate::error::CmdError::plain("not ready"))?;
    let keys = st
        .control
        .call::<tw_api::ep::Keys>(&[], &())
        .await
        .map_err(crate::error::text)?;
    let names = crate::clients::blocking(move || crate::clients::pinned_keys(&keys)).await?;
    // 几个 Lite 连着同一个 core 时各报各的：按这一份 Lite 的标识分开记
    let source = crate::clients::blocking(|| crate::prefs::instance_id(&crate::data_dir())).await?;
    let pins = fit_pins(source, names);
    st.control
        .call::<tw_api::ep::PinKeys>(&[], &pins)
        .await
        .map_err(crate::error::text)?;
    Ok(pins.names)
}

/// core 收固定密钥的上限（`PUT /pinned-keys`，超出是 400 `backup.pinned.*`）：来源最长 128 字节
const PIN_SOURCE_MAX: usize = 128;
/// 一次最多几把
const PIN_NAMES_MAX: usize = 1024;
/// 一个名字最长几个字节
const PIN_NAME_MAX: usize = 256;

/// 照 core 的上限收拾一遍再报：来源截到 128 字节（按字符边界），名字超长的去掉（截断之后就是
/// 另一个名字了，保护不到它），多于 1024 把的只报前面的。**都只记日志，不报错给人**：报不全
/// 只是少保护几把，而这件事本来就是后台做的
fn fit_pins(source: String, names: Vec<String>) -> tw_api::PinnedKeys {
    let mut source = source;
    if source.len() > PIN_SOURCE_MAX {
        let mut end = PIN_SOURCE_MAX;
        while !source.is_char_boundary(end) {
            end -= 1;
        }
        source.truncate(end);
        tracing::warn!("实例标识超过 {PIN_SOURCE_MAX} 字节，已截断后上报");
    }
    let before = names.len();
    let mut names: Vec<String> = names
        .into_iter()
        .filter(|n| n.len() <= PIN_NAME_MAX)
        .collect();
    if names.len() < before {
        tracing::warn!(
            "{} 把网关密钥的名字超过 {PIN_NAME_MAX} 字节，未作为固定密钥上报",
            before - names.len()
        );
    }
    if names.len() > PIN_NAMES_MAX {
        tracing::warn!(
            "接管的客户端在用 {} 把网关密钥，只上报前 {PIN_NAMES_MAX} 把",
            names.len()
        );
        names.truncate(PIN_NAMES_MAX);
    }
    tw_api::PinnedKeys { source, names }
}

/// 开启同步、加入同步之前先报一次（「使用同步数据替换本机配置」时 core 据此保留在用的密钥）
#[tauri::command]
pub async fn sync_pin_keys(app: tauri::AppHandle) -> Out<Vec<String>> {
    report_pinned(&app).await
}

// ───────────────────────────────────────────── 打开主窗口时同步一次

/// 两次之间至少隔这么久：来回切窗口不该每一下都去问同步位置
const NUDGE_EVERY: Duration = Duration::from_secs(30);

static NUDGED: Mutex<Option<Instant>> = Mutex::new(None);

/// 打开主窗口：立刻检查一次同步位置（6.5「打开 Lite 主窗口时立即检查」）。没开同步的
/// core 答「没开」，不管它
pub fn nudge(app: &tauri::AppHandle) {
    {
        let mut g = NUDGED.lock().unwrap_or_else(|e| e.into_inner());
        if g.is_some_and(|at| at.elapsed() < NUDGE_EVERY) {
            return;
        }
        *g = Some(Instant::now());
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(st) = app.try_state::<AppState>() else {
            return;
        };
        if let Err(e) = st.control.call::<tw_api::ep::SyncNow>(&[], &()).await {
            tracing::debug!("打开窗口时没同步上：{e:#}");
        }
    });
}

// ───────────────────────────────────────────── 向导里的两样

/// 选同步文件夹：系统的「选择文件夹」对话框。**只在连着本机时**：远程 core 的文件夹在
/// 服务器上，这台电脑上选出来的路径对它没有意义（界面上手填）。取消了是 `None`
#[tauri::command]
pub async fn pick_sync_folder(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AppState>,
) -> Out<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    if state.link.is_remote() {
        return Err(tr!(
            "连接远程 core 时，同步文件夹是服务器上的路径，请手动填写。",
            "With a remote core, the sync folder is a path on the server; type it in."
        )
        .into());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_parent(&window)
        .pick_folder(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx.await.map_err(|_| {
        tr!(
            "无法打开选择文件夹的对话框。",
            "The folder dialog could not be opened."
        )
    })?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| {
        tr!(
            format!("无法使用所选的文件夹：{e}"),
            format!("The chosen folder cannot be used: {e}")
        )
    })?;
    Ok(Some(path.display().to_string()))
}

/// 本设备名称的缺省值：这台电脑的名字（macOS 上是「电脑名称」，如「Mac mini」）。连着远程
/// core 时界面用连接的名字，不问这里
#[tauri::command]
pub async fn sync_device_name() -> Out<String> {
    crate::clients::blocking(computer_name).await
}

fn computer_name() -> String {
    #[cfg(target_os = "macos")]
    {
        // 系统设置 › 通用 › 关于本机 › 名称。主机名是它去掉空格的样子（`Mac-mini.local`）
        if let Ok(out) = std::process::Command::new("/usr/sbin/scutil")
            .args(["--get", "ComputerName"])
            .output()
            && out.status.success()
        {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    #[cfg(windows)]
    {
        if let Some(name) = std::env::var_os("COMPUTERNAME") {
            let name = name.to_string_lossy().trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    #[cfg(unix)]
    {
        let mut buf = [0u8; 256];
        // SAFETY: 缓冲区由这里拥有、长度如实给出；gethostname 至多写这么多字节
        let r = unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) };
        if r == 0 {
            let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
            let name = String::from_utf8_lossy(&buf[..end]).trim().to_string();
            // `Mac-mini.local` 去掉域名那一段
            let name = name.split('.').next().unwrap_or_default().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    String::from("ThinkWatch")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn brief(state: &str, conflicts: u32) -> SyncView {
        SyncView {
            state: SyncState::from_slug(state).unwrap(),
            target: None,
            encrypted: false,
            device: None,
            last_synced_ms: None,
            failing_since_ms: None,
            error: None,
            devices: vec![],
            conflicts,
            excluded: vec![],
            excluded_cascade: vec![],
            skipped: 0,
            notices: vec![],
        }
    }

    fn keys(signals: &[Signal]) -> Vec<(String, bool)> {
        signals
            .iter()
            .map(|s| (s.key.clone(), s.change == notices::Change::Raised))
            .collect()
    }

    /// 正常运转什么都不说；需要处理的才开一条，好了收起
    #[test]
    fn only_states_that_need_a_person_raise_a_notice() {
        for s in ["idle", "syncing", "off", "paused"] {
            assert!(wanted(&brief(s, 0)).is_empty(), "{s}");
        }
        let w = wanted(&brief("unreachable", 2));
        assert_eq!(
            w.keys().copied().collect::<Vec<_>>(),
            ["sync:conflict", "sync:unreachable"]
        );
        for (s, k) in [
            ("auth_failed", "sync:auth"),
            ("locked", "sync:locked"),
            ("too_new", "sync:too_new"),
            ("keyring_missing", "sync:keyring"),
            ("emptied", "sync:emptied"),
            ("misconfigured", "sync:misconfigured"),
        ] {
            assert_eq!(
                wanted(&brief(s, 0)).keys().copied().collect::<Vec<_>>(),
                [k]
            );
        }
    }

    /// 同一件事只说一次：状态再推一遍不再开；冲突数变了换一句；好了收起；第一次把上次
    /// 运行留下的也收掉
    #[test]
    fn a_state_pushed_again_is_not_raised_again() {
        let first = changes(None, &wanted(&brief("idle", 0)));
        assert_eq!(keys(&first).len(), KEYS.len());
        assert!(keys(&first).iter().all(|(_, raised)| !raised));

        let a = wanted(&brief("conflict", 2));
        let up = changes(Some(&Said::new()), &a);
        assert_eq!(keys(&up), [("sync:conflict".to_string(), true)]);
        assert_eq!(changes(Some(&a), &a).len(), 0);

        let b = wanted(&brief("conflict", 3));
        let more = changes(Some(&a), &b);
        assert_eq!(keys(&more), [("sync:conflict".to_string(), true)]);
        assert!(more[0].title.contains('3'), "{}", more[0].title);

        let gone = changes(Some(&b), &wanted(&brief("idle", 0)));
        assert_eq!(keys(&gone), [("sync:conflict".to_string(), false)]);
    }

    /// 固定密钥照 core 的上限收拾：来源按字符边界截断，超长的名字去掉，多出来的只报前面的
    #[test]
    fn pinned_keys_fit_the_limits() {
        let ok = fit_pins(
            "0123456789abcdef".into(),
            vec!["codex".into(), "default".into()],
        );
        assert_eq!(ok.source, "0123456789abcdef");
        assert_eq!(ok.names, ["codex", "default"]);
        let long_source = "源".repeat(50); // 150 字节
        let p = fit_pins(long_source, vec![]);
        assert!(p.source.len() <= PIN_SOURCE_MAX && p.source.chars().all(|c| c == '源'));
        let mut names: Vec<String> = (0..1100).map(|i| format!("k{i}")).collect();
        names.insert(3, "x".repeat(PIN_NAME_MAX + 1));
        let p = fit_pins("a".into(), names);
        assert_eq!(p.names.len(), PIN_NAMES_MAX);
        assert!(p.names.iter().all(|n| n.len() <= PIN_NAME_MAX));
        assert_eq!(p.names[3], "k3");
    }

    /// 前端的清单里有这几个同步端点（`PinKeys`、客户端偏好的两个只给 Rust 用）
    #[test]
    fn the_webview_reaches_the_sync_endpoints_but_not_the_pins() {
        let names = tw_api::ep::ALL.iter().map(|e| e.name).filter(|n| {
            n.starts_with("Sync") || matches!(*n, "PinKeys" | "GetClientPrefs" | "PutClientPrefs")
        });
        for name in names {
            let webview = crate::call::ALLOWED.contains(&name);
            let rust_only = matches!(name, "PinKeys" | "GetClientPrefs" | "PutClientPrefs");
            assert_eq!(webview, !rust_only, "{name}");
        }
    }
}
