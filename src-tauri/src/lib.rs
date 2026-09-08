//! ThinkWatch Lite 的 UI 侧。
//!
//! 它做三件事：起 core 并看着它、把控制面的数据搬给前端、以及在 core
//! 挂掉时悄悄修好。用户眼里这一切和 core 是**同一个程序**（§2.2.1）。

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{Emitter, Manager};

pub mod control;
pub mod supervisor;

use control::ControlClient;
use supervisor::{CoreState, Supervisor};

pub struct AppState {
    pub control: ControlClient,
    pub core_state: Arc<tokio::sync::Mutex<CoreState>>,
    pub supervisor: Arc<Supervisor>,
}

/// twcore 在哪。
///
/// 开发时它在 core 仓库的 target 里；打包后它在 app bundle 的
/// Resources 下。**两条路径都要试，而且找不到时要说清楚找过哪儿** ——
/// 「二进制不存在」是安装期最常见的失败，而默认的错误信息只会说
/// No such file or directory。
pub fn locate_core(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    let mut tried = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        let p = resource_dir.join("twcore");
        if p.exists() {
            return Ok(p);
        }
        tried.push(p);
    }

    // 开发时：core 是隔壁仓库
    if let Some(home) = std::env::var_os("HOME") {
        for profile in ["release", "debug"] {
            let p = PathBuf::from(&home)
                .join("Dev/thinkwatch-core/target")
                .join(profile)
                .join("twcore");
            if p.exists() {
                return Ok(p);
            }
            tried.push(p);
        }
    }

    anyhow::bail!(
        "找不到 twcore。找过这些位置：\n{}",
        tried
            .iter()
            .map(|p| format!("  · {}", p.display()))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

#[tauri::command]
async fn core_status(state: tauri::State<'_, AppState>) -> Result<tw_api::Status, String> {
    // Tauri 的 invoke 用**字符串** reject，不是 Error 对象（§9.7）——
    // 前端 `e instanceof Error` 永远是 false。所以这里返回 String，
    // 前端那边也按字符串处理。
    state.control.status().await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn core_state(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let s = state.core_state.lock().await;
    Ok(match &*s {
        CoreState::Starting => "starting".into(),
        CoreState::Running { pid } => format!("running:{pid}"),
        CoreState::Restarting { attempt, in_ms } => format!("restarting:{attempt}:{in_ms}"),
        CoreState::SafeMode => "safe_mode".into(),
        CoreState::Stopped => "stopped".into(),
    })
}

#[tauri::command]
async fn probe_upstream(
    state: tauri::State<'_, AppState>,
    base_url: String,
    key: String,
) -> Result<tw_api::ProbeResponse, String> {
    state
        .control
        .probe(&base_url, &key)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn setup_first_provider(
    state: tauri::State<'_, AppState>,
    name: String,
    base_url: String,
    key: String,
) -> Result<tw_api::SetupResponse, String> {
    let r = state
        .control
        .setup(&name, &base_url, &key)
        .await
        .map_err(|e| format!("{e:#}"))?;
    // 配置写完必须让 core 重起才生效（M2 之前没有热重载）。**不做这一步
    // 的话，用户点完「用它」会发现什么都没变** —— 而他没有任何线索知道
    // 是因为进程还端着旧配置。
    state
        .supervisor
        .request_restart()
        .await
        .map_err(|e| format!("配置写好了，但 core 没能重启：{e:#}。手动重开一次应用即可。"))?;
    Ok(r)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            core_status,
            core_state,
            probe_upstream,
            setup_first_provider
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let binary = locate_core(&handle)?;
            let socket = default_socket();
            let sup = Arc::new(Supervisor::new(binary, None));
            let core_state = sup.state_handle();

            app.manage(AppState {
                control: ControlClient::new(socket),
                core_state: core_state.clone(),
                supervisor: sup.clone(),
            });

            // 守护循环。**它跑在后台任务里而不是阻塞 setup** —— core 起
            // 不来的时候，界面必须还能打开，否则用户连错误都看不到。
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                supervise(sup, h).await;
            });

            // 事件桥：控制面的 SSE → Tauri 事件 → 前端。
            let h = handle.clone();
            let sock = default_socket();
            tauri::async_runtime::spawn(async move {
                bridge_events(sock, h).await;
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // 点红点只是关窗口，进程留在菜单栏（§7.5）。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Tauri 起不来")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                // 没有存活窗口不等于要退出 —— 那正是「关窗口留菜单栏」
                // 的状态。只有真的收到退出码才走清理。
                if code.is_none() {
                    api.prevent_exit();
                } else {
                    // core 是我们 spawn 的子进程，`kill_on_drop` 会带走它。
                    // 但显式说一句，因为这条是「一个程序」原则的另一半。
                    tracing::info!("退出，core 跟着走");
                    let _ = app.emit("app-exiting", ());
                }
            }
        });
}

/// 把控制面的事件流搬给前端。
///
/// 断线就重连，但**退避要克制**：core 重启期间 socket 必然连不上，这是
/// 预期状态而不是故障。1 秒一次的重试既不会刷屏，也不会让用户在 core
/// 恢复后还盯着一个空列表等太久。
async fn bridge_events(socket: PathBuf, app: tauri::AppHandle) {
    loop {
        let client = ControlClient::new(socket.clone());
        let a = app.clone();
        let r = client
            .subscribe_events(move |ev| {
                let _ = a.emit("core-event", &ev);
            })
            .await;
        if let Err(e) = r {
            tracing::debug!("事件流断开：{e:#}");
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
}

fn default_socket() -> PathBuf {
    std::env::var_os("THINKWATCH_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".thinkwatch")))
        .unwrap_or_else(|| PathBuf::from(".thinkwatch"))
        .join("twcore.sock")
}

/// 起、看着、它死了、按策略决定下一步。
async fn supervise(sup: Arc<Supervisor>, app: tauri::AppHandle) {
    let mut safe = false;
    loop {
        match sup.run_once(safe).await {
            Ok(true) => {
                let _ = app.emit("core-restarting", ());
                continue;
            }
            Ok(false) => {
                if safe {
                    break;
                }
                // 进安全模式：**必须打断用户并自动开窗**。这时候网关
                // 已经不转发了，他所有的 AI 客户端都在瞎。
                safe = true;
                let _ = app.emit("core-safe-mode", ());
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                continue;
            }
            Err(e) => {
                // 起不来（多半是二进制路径不对）。这不是「core 在崩」，
                // 别用重启循环去掩盖它。
                tracing::error!("core 起不来：{e:#}");
                let _ = app.emit("core-failed", format!("{e:#}"));
                break;
            }
        }
    }
}
