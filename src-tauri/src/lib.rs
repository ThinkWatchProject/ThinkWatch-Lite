//! ThinkWatch Lite 的 UI 侧。
//!
//! 它做三件事：起 core 并看着它、把控制面的数据搬给前端、以及在 core
//! 挂掉时悄悄修好。用户眼里这一切和 core 是**同一个程序**。

use std::path::PathBuf;
use std::sync::Arc;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub mod autostart;
pub mod control;
pub mod memcheck;
pub mod menubar;
pub mod supervisor;

use control::ControlClient;
use supervisor::{CoreState, Supervisor};

pub struct AppState {
    pub control: ControlClient,
    pub supervisor: Arc<Supervisor>,
    /// 连 twcore 都没找到时，那句话。
    ///
    /// **找不到不该让应用起不来。**在此之前这里是 `locate_core(&handle)?`
    /// —— `setup` 返回 Err 会让 Tauri 中止启动，**窗口根本不开**，用户
    /// 看到的是「点了没反应」。而这正是最需要把话说清楚的一种失败：
    /// 消息里写着找过哪些路径。
    pub core_missing: Option<String>,
    /// 守护循环还在跑吗。
    ///
    /// 它会退出：安全模式下的 core 也退了，或者 core 根本起不来。
    /// 退了之后没人再拉它 —— 界面上那个「重新启动」要能把它接回来，
    /// 而**不能接出第二条循环**。
    pub supervising: Arc<std::sync::atomic::AtomicBool>,
    /// 菜单栏该重新收一次数了。
    ///
    /// **菜单栏原来是每秒醒一次的**，而它每醒一次就走两趟控制面（额度、
    /// 汇总）。那两个数字只在请求落地或者额度头出现之后才会变 —— 也就是
    /// 说，一台闲着的机器上每秒两次往返问到的全是上一次的同一个答案，
    /// 而菜单栏是这个应用唯一常驻的东西。
    ///
    /// 现在由事件叫醒。`Notify` 攒一个许可，所以一串请求只会换来一次
    /// 重收，不是一串。
    pub menubar: Arc<tokio::sync::Notify>,
}

/// twcore 在哪。
///
/// 开发时它在 core 仓库的 target 里；打包后它在 app bundle 的
/// Resources 下。**两条路径都要试，而且找不到时要说清楚找过哪儿** ——
/// 「二进制不存在」是安装期最常见的失败，而默认的错误信息只会说
/// No such file or directory。
/// 打包之后，core 只可能在一个地方。
///
/// macOS 的 `.app/Contents/MacOS/<exe>` 到 `.app/Contents/Resources/`
/// 是 bundle 布局定死的关系。别的平台还没有打包形态，到时候各自回答。
fn bundled_core() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    if dir.ends_with("Contents/MacOS") {
        return Some(dir.parent()?.join("Resources").join("twcore"));
    }
    None
}

/// twcore 在哪。
///
/// **装好的应用和开发布局走两条完全不同的路，中间没有回退。**
///
/// 装好之后只认包里那一份：找不到就是安装包坏了，说出来让人重装。
/// 开发时才去试环境变量、隔壁仓库、PATH。
///
/// 这条分界不是整洁，是安全。开发那几条候选里有
/// `<当前工作目录>/../thinkwatch-core/target/release/twcore` —— 它相对
/// 的是**进程启动时的工作目录**。把这条留在发出去的应用里，等于让
/// 「用户从哪个目录启动」决定它执行哪个二进制；而这个进程握着用户全部
/// 的 API key。同理，装好之后也不再看 `THINKWATCH_CORE_BIN` 和 PATH：
/// 让环境变量替换掉网关本体，在开发机上是便利，在用户机器上是一个口子。
pub fn locate_core(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    if let Some(inside) = bundled_core() {
        if inside.exists() {
            return Ok(inside);
        }
        // **不往下走。**这里不是「再找找别处」，是这份安装包缺东西。
        anyhow::bail!("安装包里缺少 twcore 组件。请重新下载安装一次。");
    }

    let mut tried = Vec::new();

    // 别的平台以后会有自己的打包形态，框架这条留着 —— 它在 macOS 的
    // `.app` 里实测返回 `unknown path`，所以上面那一段不能指望它。
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("twcore");
        if p.exists() {
            return Ok(p);
        }
        tried.push(p);
    }

    // 显式覆盖优先。**core 放在哪儿是开发者的选择** —— 之前这里写死了
    // 一个 $HOME 下的固定目录，那是写这段代码的那台机器的布局，换一台
    // 机器就直接失败，而失败信息会指向一个用户从没听说过的路径。
    if let Some(explicit) = std::env::var_os("THINKWATCH_CORE_BIN") {
        let p = PathBuf::from(explicit);
        if p.exists() {
            return Ok(p);
        }
        tried.push(p);
    }

    // 开发时：core 是隔壁仓库。cwd 在 `tauri dev` 下是 `src-tauri/`，
    // 直接跑 `cargo run` 时是仓库根 —— 两种都试，不假设是哪一种。
    if let Ok(cwd) = std::env::current_dir() {
        for up in ["../..", ".."] {
            for profile in ["release", "debug"] {
                let p = cwd
                    .join(up)
                    .join("thinkwatch-core/target")
                    .join(profile)
                    .join("twcore");
                if p.exists() {
                    // 相对路径能用，但报错信息和日志里出现 `../..` 很难
                    // 读，所以归一化之后再交出去。
                    return Ok(p.canonicalize().unwrap_or(p));
                }
                tried.push(p);
            }
        }
    }

    // 最后：装在 PATH 上的那个。`cargo install -p twcore` 之后就是这条。
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let p = dir.join("twcore");
            if p.exists() {
                return Ok(p);
            }
        }
    }

    anyhow::bail!(
        "找不到 twcore。找过这些位置（以及 PATH）：\n{}\n\n         用 THINKWATCH_CORE_BIN 指一个绝对路径，或者在 core 仓库里跑一次 \
         `cargo build -p twcore`。",
        tried
            .iter()
            .map(|p| format!("  · {}", p.display()))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

#[tauri::command]
async fn new_key(state: tauri::State<'_, AppState>) -> Result<String, String> {
    state.control.new_key().await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn interfaces(state: tauri::State<'_, AppState>) -> Result<Vec<tw_api::NicView>, String> {
    state
        .control
        .interfaces()
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn core_status(state: tauri::State<'_, AppState>) -> Result<tw_api::Status, String> {
    // Tauri 的 invoke 用**字符串** reject，不是 Error 对象 ——
    // 前端 `e instanceof Error` 永远是 false。所以这里返回 String，
    // 前端那边也按字符串处理。
    state.control.status().await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn core_state(state: tauri::State<'_, AppState>) -> Result<String, String> {
    // 连 core 都没找到时，守护状态说什么都没意义 —— 那句话才是答案
    if let Some(why) = &state.core_missing {
        return Ok(format!("missing:{why}"));
    }
    Ok(describe_state(&state.supervisor.state()))
}

/// 把 core 拉起来。
///
/// 两种情形：守护还在跑，那这就是一次普通的重启；守护已经退出了
/// （安全模式下的 core 也退了、或者 core 根本起不来），那要把循环接
/// 回来 —— 而**不能接出第二条**，所以用一个标志守着。
#[tauri::command]
async fn restart_core(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if let Some(why) = &state.core_missing {
        return Err(why.clone());
    }
    if state.supervising.swap(true, Ordering::SeqCst) {
        return state
            .supervisor
            .request_restart()
            .await
            .map_err(|e| format!("{e:#}"));
    }
    let sup = state.supervisor.clone();
    let flag = state.supervising.clone();
    tauri::async_runtime::spawn(async move {
        supervise(sup, app).await;
        flag.store(false, Ordering::SeqCst);
    });
    Ok(())
}

/// 守护状态说成界面认得的那个字符串。
///
/// **只有这一处。**开窗时问一次、之后每次转换推一条，两条路必须说出
/// 一模一样的话 —— 各写一遍的话，「重启中（第 3 次）」和「重启中」会
/// 在某次改动之后悄悄分岔。
fn describe_state(s: &CoreState) -> String {
    match s {
        CoreState::Starting => "starting".into(),
        CoreState::Running { pid } => format!("running:{pid}"),
        CoreState::Restarting { attempt, in_ms } => format!("restarting:{attempt}:{in_ms}"),
        CoreState::SafeMode => "safe_mode".into(),
        CoreState::Stopped => "stopped".into(),
    }
}

#[tauri::command]
async fn overview(state: tauri::State<'_, AppState>) -> Result<tw_api::Overview, String> {
    state.control.overview().await.map_err(|e| format!("{e:#}"))
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

/// L1 测速。零成本，所以不需要任何确认 —— L3 才需要。
#[tauri::command]
async fn speed_test(
    state: tauri::State<'_, AppState>,
    provider: Option<String>,
    proxy: Option<String>,
) -> Result<Vec<tw_api::L1Result>, String> {
    state
        .control
        .l1(tw_api::L1Request {
            provider,
            proxy,
            base_url: None,
        })
        .await
        .map_err(|e| format!("{e:#}"))
}

/// 今天的汇总、历史、延迟、存储状态。
///
/// **四个一起取。**界面上它们是同一块，分四次 invoke 会让那一块在几十
/// 毫秒里分四次跳变。
#[tauri::command]
async fn dashboard(
    state: tauri::State<'_, AppState>,
    // 时间窗的起点，以及趋势图一格多宽。
    //
    // **两个都由界面给，这一层不再自己算。**原来这里收的是「往前看多少
    // 毫秒」，起点是 `now - window` —— 每刷新一次就往前挪一点，于是所有
    // 格子的边界跟着挪：没有任何新请求，柱子的高低也会变，而那是「你
    // 什么时候看」造成的，不是数据。格子边界该对齐到**本地**日历（本地
    // 零点、整点），而本地时区只有界面知道。
    //
    // 另一个理由是这两个数原来在两边各算了一遍：一边算窗口，一边算格宽，
    // 而补空桶要求两边算出来的格子完全重合。对不上的表现是整张图全是零。
    since_ms: Option<i64>,
    bucket_ms: Option<i64>,
) -> Result<Dashboard, String> {
    let c = &state.control;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    // 兜底是「最近 24 小时、一小时一格」—— 界面总会把这两个值带上，
    // 这里只是不让缺参数变成一次失败。
    let since = since_ms.unwrap_or(now - 24 * 3_600_000).min(now);
    let bucket = bucket_ms.unwrap_or(3_600_000).max(60_000);
    Ok(Dashboard {
        summary: c.summary(Some(since)).await.map_err(|e| format!("{e:#}"))?,
        latency: c.latency().await.unwrap_or_default(),
        latency_by_provider: c.latency_by_provider().await.unwrap_or_default(),
        history: c.history(200).await.unwrap_or_default(),
        storage: c.storage().await.ok(),
        leaks: c.leaks().await.unwrap_or_default(),
        // 趋势和分组。**拿不到就是空的，不该让整页失败** —— 旧 core
        // 没有这两个端点，而这一页别的部分照样有用（同一条：
        // 观测层的缺失不该扩散）。
        buckets: c.cost_buckets(since, bucket).await.unwrap_or_default(),
        buckets_by_model: c
            .cost_buckets_by("model", since, bucket)
            .await
            .unwrap_or_default(),
        // **上一个等长区间。**一个没有参照系的金额只能读，不能判断
        // ——「$4.05」是多还是少，只有和上一个七天比过才知道。
        // 拿不到就不显示那句对比，不影响这一页别的部分。
        prev: c.summary_range(since - (now - since), since).await.ok(),
        since_ms: since,
    })
}

#[derive(serde::Serialize)]
pub struct Dashboard {
    summary: tw_api::Summary,
    latency: Vec<tw_api::LatencyView>,
    /// 按上游分。**和按模型分是两个问题**
    latency_by_provider: Vec<tw_api::LatencyView>,
    history: Vec<tw_api::HistoryRow>,
    /// 拿不到就是没有 —— 存储层不在的时候网关照常跑
    storage: Option<tw_api::StorageStatus>,
    /// 出站密钥检测攒下的证据（观察态）
    leaks: Vec<tw_api::LeakGroup>,
    /// 按界面给的格宽分格。**稀疏的** —— 空桶由界面补
    buckets: Vec<tw_api::CostBucket>,
    /// 同样的格子，再按模型分层。趋势图靠它把「什么时候花的」和
    /// 「花在哪个模型上」画成同一张图
    buckets_by_model: Vec<tw_api::CostBucketGroup>,
    /// 上一个等长区间的汇总。拿不到就是没有对比，不是零
    prev: Option<tw_api::Summary>,
    /// 实际用上的时间窗起点。**原样回传** —— 界面补空桶要从它数起，
    /// 而兜底路径上它不等于界面送来的那个值
    since_ms: i64,
}

#[tauri::command]
async fn request_detail(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<tw_api::RequestDetail, String> {
    state
        .control
        .request_detail(id)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// L3 测速的报价。**零成本** —— 它只是算了一下。
#[tauri::command]
async fn speed_quote(
    state: tauri::State<'_, AppState>,
    model: String,
) -> Result<tw_api::SpeedQuote, String> {
    state
        .control
        .speed_quote(model)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// 真的跑一次测速。**这一步花钱** —— 界面必须先把报价摆给用户看过。
#[tauri::command]
async fn speed_run(
    state: tauri::State<'_, AppState>,
    model: String,
) -> Result<Vec<tw_api::SpeedResult>, String> {
    state
        .control
        .speed_run(model)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// 最近的请求。**开窗时用它把实时列表填上** —— 关窗销毁了窗口，
/// 重开时前端是全新的，不填的话用户看到一片空白，而请求明明一直在跑。
#[tauri::command]
async fn recent_requests(
    state: tauri::State<'_, AppState>,
    limit: usize,
) -> Result<Vec<tw_api::HistoryRow>, String> {
    state
        .control
        .history(limit)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn get_config(state: tauri::State<'_, AppState>) -> Result<tw_api::ConfigText, String> {
    state.control.config().await.map_err(|e| format!("{e:#}"))
}

/// 改一个字段。**总是带 `base_version`** —— 用户在编辑器里改了什么，
/// 界面无从知道。
#[tauri::command]
async fn patch_config(
    state: tauri::State<'_, AppState>,
    ops: Vec<tw_api::PatchOp>,
    base_version: String,
) -> Result<tw_api::ConfigWritten, String> {
    state
        .control
        .patch_config(ops, base_version)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn put_config(
    state: tauri::State<'_, AppState>,
    text: String,
    base_version: String,
) -> Result<tw_api::ConfigWritten, String> {
    state
        .control
        .put_config(text, base_version)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// 光标落在配置的哪一段上。
/// 用户自己写的那份价格（第三层）。
#[tauri::command]
async fn pricing(state: tauri::State<'_, AppState>) -> Result<tw_api::PricingView, String> {
    state.control.pricing().await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn save_pricing(
    state: tauri::State<'_, AppState>,
    rows: Vec<tw_api::PriceRow>,
) -> Result<tw_api::PricingView, String> {
    state
        .control
        .save_pricing(rows)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// 「检查价格更新」三步走。**三个命令，不是一个** ——
/// 一个命令意味着「检查」和「写入」是同一次调用，而那正是「静默下载」
/// 的定义。
#[tauri::command]
async fn update_offer(state: tauri::State<'_, AppState>) -> Result<tw_api::UpdateOffer, String> {
    state
        .control
        .update_offer()
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn update_fetch(state: tauri::State<'_, AppState>) -> Result<tw_api::UpdatePreview, String> {
    state
        .control
        .update_fetch()
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn update_apply(
    state: tauri::State<'_, AppState>,
    token: String,
) -> Result<tw_api::PricingView, String> {
    state
        .control
        .update_apply(&token)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn config_at(
    state: tauri::State<'_, AppState>,
    offset: usize,
) -> Result<tw_api::ConfigAt, String> {
    state
        .control
        .config_at(offset)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn config_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<tw_api::ConfigVersion>, String> {
    state
        .control
        .config_history()
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn rollback_config(
    state: tauri::State<'_, AppState>,
    version: String,
) -> Result<tw_api::ConfigWritten, String> {
    state
        .control
        .rollback(version)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn mcp_targets(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<tw_api::McpTargetView>, String> {
    state
        .control
        .mcp_targets()
        .await
        .map_err(|e| format!("{e:#}"))
}

/// **算一下，不落盘。**和接管一样，中间夹着用户看 diff 的那一下。
#[tauri::command]
async fn mcp_plan(
    state: tauri::State<'_, AppState>,
    req: tw_api::McpOpRequest,
) -> Result<tw_api::PlanView, String> {
    state
        .control
        .mcp_plan(req)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn mcp_apply(
    state: tauri::State<'_, AppState>,
    req: tw_api::McpOpRequest,
) -> Result<tw_api::AdoptResponse, String> {
    state
        .control
        .mcp_apply(req)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// 攒一份诊断包，写到磁盘上，把路径交回去。
///
/// **写文件是这一侧的事，不是 core 的。**core 只负责把内容攒出来 ——
/// 「往哪儿写」是个桌面概念，而它在无头运行时根本不存在。
#[tauri::command]
async fn save_diagnostics(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let text = state
        .control
        .diagnostics()
        .await
        .map_err(|e| format!("{e:#}"))?;
    let dir = data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("建不了 {}：{e}", dir.display()))?;
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = dir.join(format!("诊断包-{at}.md"));
    std::fs::write(&path, text).map_err(|e| format!("写不了 {}：{e}", path.display()))?;
    // **0600。**里面是脱敏过的，但它仍然描述了这台机器上有哪些上游、
    // 哪些客户端 —— 同机器上的其他用户没有理由读到
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(path.display().to_string())
}

/// **算一下，不发。**和 L3 测速同一条纪律。
#[tauri::command]
async fn replay_quote(
    state: tauri::State<'_, AppState>,
    id: i64,
    provider: String,
) -> Result<tw_api::ReplayQuote, String> {
    state
        .control
        .replay_quote(id, provider)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// **这一步花钱。**
#[tauri::command]
async fn replay_run(
    state: tauri::State<'_, AppState>,
    id: i64,
    provider: String,
) -> Result<tw_api::ReplayResult, String> {
    state
        .control
        .replay_run(id, provider)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn baseline(state: tauri::State<'_, AppState>) -> Result<tw_api::BaselineResponse, String> {
    state.control.baseline().await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn sessions(state: tauri::State<'_, AppState>) -> Result<Vec<tw_api::SessionView>, String> {
    state.control.sessions().await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn session_detail(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<tw_api::SessionDetail, String> {
    state
        .control
        .session_detail(&id)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// 扫一遍客户端配置面。**只读，什么都不存**。
#[tauri::command]
async fn scan_configs(
    state: tauri::State<'_, AppState>,
    projects: Vec<String>,
) -> Result<tw_api::ScanResponse, String> {
    state
        .control
        .scan(&projects)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// 路由试算。**只算，不发任何请求。**
#[tauri::command]
async fn dry_run(
    state: tauri::State<'_, AppState>,
    req: tw_api::DryRunRequest,
) -> Result<tw_api::DryRunResult, String> {
    state
        .control
        .dry_run(req)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn list_clients(
    state: tauri::State<'_, AppState>,
) -> Result<tw_api::ClientsResponse, String> {
    state.control.clients().await.map_err(|e| format!("{e:#}"))
}

/// **算一下，不落盘。**接管和「算接管」是两个命令，中间夹着用户看
/// diff 的那一下。
#[tauri::command]
async fn plan_adopt(
    state: tauri::State<'_, AppState>,
    client: String,
    key_name: Option<String>,
) -> Result<tw_api::PlanView, String> {
    state
        .control
        .plan_adopt(client, key_name)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn adopt_client(
    state: tauri::State<'_, AppState>,
    client: String,
    key_name: Option<String>,
) -> Result<tw_api::AdoptResponse, String> {
    state
        .control
        .adopt(client, key_name)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn plan_restore(
    state: tauri::State<'_, AppState>,
    client: String,
) -> Result<tw_api::PlanView, String> {
    state
        .control
        .plan_restore(&client)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// 把所有接管过的客户端一次性还原（第二层的第二个入口）。
///
/// **这个按钮要一直看得见。**用户敢按下「接管」的前提，就是看得见退路
/// —— 藏起来的退路等于没有退路，他会在心里给接管打上「不可逆」的标签。
///
/// **一家失败不影响别家。**逐个还原、逐个记结果：五个客户端里有一个的
/// 文件被改坏了，不该让另外四个也留在接管状态。
/// 真的退出。**只有确认过的界面能调它** ——托盘那一项只是把
/// 窗口拉起来问一句。
#[tauri::command]
async fn quit_app(app: tauri::AppHandle) -> Result<(), String> {
    // 不问「要不要保留后台代理」—— 那个问题本身就暴露了内部有两个
    // 进程
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn restore_all(state: tauri::State<'_, AppState>) -> Result<Vec<RestoreOutcome>, String> {
    let list = state
        .control
        .clients()
        .await
        .map_err(|e| format!("{e:#}"))?;
    let mut out = Vec::new();
    for c in list.clients.iter().filter(|c| c.adopted_at_ms.is_some()) {
        let r = state.control.restore(&c.name).await;
        out.push(RestoreOutcome {
            client: c.name.clone(),
            ok: r.is_ok(),
            detail: match r {
                Ok(_) => "已还原".to_string(),
                Err(e) => format!("{e:#}"),
            },
        });
    }
    Ok(out)
}

#[derive(serde::Serialize)]
struct RestoreOutcome {
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
async fn uninstall(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    drop_data: bool,
) -> Result<Vec<String>, String> {
    let mut log = Vec::new();
    for r in restore_all(state).await? {
        log.push(format!("{} — {}", r.client, r.detail));
    }
    // 注销 LaunchAgent。**失败只记一句**：它不该挡住卸载，而留下一个
    // 开机自启项的后果，用户在系统设置里看得见、也删得掉
    use tauri_plugin_autostart::ManagerExt;
    match app.autolaunch().disable() {
        Ok(_) => log.push("开机自启已注销".into()),
        Err(e) => log.push(format!("开机自启没注销掉（去系统设置里删）：{e}")),
    }
    if drop_data {
        let dir = data_dir();
        match std::fs::remove_dir_all(&dir) {
            Ok(_) => log.push(format!("数据目录已删除：{}", dir.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => log.push(format!("数据目录没删掉：{}（{e}）", dir.display())),
        }
    } else {
        log.push(format!("数据留着没动：{}", data_dir().display()));
    }
    log.push("可以把应用拖进废纸篓了。".into());
    Ok(log)
}

#[tauri::command]
async fn restore_client(
    state: tauri::State<'_, AppState>,
    client: String,
) -> Result<tw_api::AdoptResponse, String> {
    state
        .control
        .restore(&client)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn diagnose_client(
    state: tauri::State<'_, AppState>,
    client: String,
) -> Result<Vec<tw_api::FindingView>, String> {
    state
        .control
        .why(&client)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// 这个应用自己的信息。
///
/// **排查时最先要问的就是这几个**：哪个版本、数据在哪、core 的二进制
/// 从哪儿找到的。之前这些散落在日志里，而用户交出一份诊断包之前根本
/// 看不到它们。
#[tauri::command]
fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "version": app.package_info().version.to_string(),
        "identifier": app.config().identifier,
        "data_dir": data_dir().display().to_string(),
        // core 二进制的实际位置。找不到的时候把错误原样给出来 ——
        // 那条错误里列着找过哪些位置，正是这时候要看的东西。
        "core_bin": match locate_core(&app) {
            Ok(p) => p.display().to_string(),
            Err(e) => format!("{e}"),
        },
    })
}

/// 开机自启现在是开着的吗。
///
/// **默认是关的,而且这不是「还没实现」,是产品决定。**一个装完就自己
/// 往登录项里写东西的工具,用户第一次发现它是在「系统设置 → 通用 →
/// 登录项」里看到一个自己没同意过的条目 —— 那一刻损失的信任,比自启
/// 省下的那点麻烦贵得多。
///
/// 所以:出厂不注册,界面上给一个勾选框,勾了才写 plist。
///
/// 开发构建里恒返回 false:`cargo tauri dev` 期间注册会把
/// `target/debug/…` 写进 plist,然后每次开机 launchd 都去启动一个可能
/// 已经被 `cargo clean` 掉的二进制。
#[tauri::command]
fn autostart_enabled(app: tauri::AppHandle) -> bool {
    if !autostart::allowed_in_this_build() {
        return false;
    }
    use tauri_plugin_autostart::ManagerExt;
    matches!(app.autolaunch().is_enabled(), Ok(true))
}

/// 开或关开机自启。
///
/// 返回**实际生效的状态**而不是调用方传进来的那个 —— 注册可能失败
/// (沙盒、权限、只读的 LaunchAgents 目录),那时勾选框必须弹回去。
/// 回一个 `Ok(())` 让界面自己乐观地打上勾,是这类开关最常见的骗人方式。
#[tauri::command]
fn set_autostart(app: tauri::AppHandle, on: bool) -> Result<bool, String> {
    if !autostart::allowed_in_this_build() {
        return Err("开发构建里不注册开机自启 —— 它会把 target/debug 下的二进制写进 plist".into());
    }
    use tauri_plugin_autostart::ManagerExt;
    // **插件不建目录。**它把 plist 直接写进 `~/Library/LaunchAgents/`，
    // 而那个目录在一台从没注册过登录项的 Mac 上根本不存在 —— 写文件
    // 得到的是 `No such file or directory (os error 2)`，一句既不说
    // 哪个文件、也不说该怎么办的话。
    //
    // 这不是边角情况：全新系统、新建用户、以及任何 HOME 被换掉的运行
    // 环境都会撞上。所以自己先建。
    if on {
        if let Some(plist) = autostart::plist_path(&app.config().identifier) {
            if let Some(dir) = plist.parent() {
                std::fs::create_dir_all(dir)
                    .map_err(|e| format!("建不了 {}：{e}", dir.display()))?;
            }
        }
    }
    let mgr = app.autolaunch();
    let r = if on { mgr.enable() } else { mgr.disable() };
    r.map_err(|e| format!("{e}"))?;
    Ok(matches!(mgr.is_enabled(), Ok(true)))
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
    // **不再重启 core。**M2 的热重载让这一步变成了纯粹的浪费 ——
    // 一次重启是两秒的断线，而配置在 `/setup` 返回之前就已经生效了
    // （它走的是和别的改动同一扇门）。
    Ok(r)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            // LaunchAgent 模式：往 ~/Library/LaunchAgents 写一个 plist。
            // 不是 SMAppService、也不是登录项 API —— 插件在 macOS 上就是
            // 写文件（读过源码）。
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // 注册时塞这个标记，启动时靠它判断是不是开机拉起来的。
            Some(vec![autostart::AUTOSTART_FLAG]),
        ))
        .invoke_handler(tauri::generate_handler![
            core_status,
            interfaces,
            new_key,
            core_state,
            restart_core,
            overview,
            probe_upstream,
            speed_test,
            dashboard,
            recent_requests,
            speed_quote,
            speed_run,
            request_detail,
            get_config,
            patch_config,
            put_config,
            config_history,
            config_at,
            pricing,
            update_offer,
            update_fetch,
            update_apply,
            save_pricing,
            rollback_config,
            setup_first_provider,
            app_info,
            autostart_enabled,
            set_autostart,
            list_clients,
            plan_adopt,
            adopt_client,
            plan_restore,
            restore_client,
            restore_all,
            quit_app,
            uninstall,
            diagnose_client,
            scan_configs,
            dry_run,
            sessions,
            session_detail,
            mcp_targets,
            mcp_plan,
            mcp_apply,
            baseline,
            replay_quote,
            replay_run,
            save_diagnostics,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // **找不到 core 也要把窗口开起来。**这里原来是 `?` ——
            // 而它把「找不到一个文件」变成了「应用打不开」。
            let located = locate_core(&handle);
            let socket = default_socket();
            let sup = Arc::new(Supervisor::new(
                located
                    .as_ref()
                    .cloned()
                    .unwrap_or_else(|_| PathBuf::from("twcore")),
                None,
            ));
            let supervising = Arc::new(std::sync::atomic::AtomicBool::new(false));

            app.manage(AppState {
                control: ControlClient::new(socket),
                supervisor: sup.clone(),
                core_missing: located.as_ref().err().map(|e| format!("{e:#}")),
                supervising: supervising.clone(),
                menubar: Arc::new(tokio::sync::Notify::new()),
            });

            // **状态变化推给界面，不要让它来问。**「core 起来没、是不是
            // 在重启、有没有进安全模式」一天变不了几次，而界面原来是每
            // 两秒问一遍的 —— 那三次 IPC 往返里绝大多数得到的是同一个
            // 答案。字符串和 `core_state` 命令走同一个函数，两条路不会
            // 说出不一样的话。
            {
                let h = handle.clone();
                let mut rx = sup.watch();
                tauri::async_runtime::spawn(async move {
                    while rx.changed().await.is_ok() {
                        let now = rx.borrow().clone();
                        let _ = h.emit("core-state", describe_state(&now));
                    }
                });
            }

            // 守护循环。**它跑在后台任务里而不是阻塞 setup** —— core 起
            // 不来的时候，界面必须还能打开，否则用户连错误都看不到。
            if located.is_ok() {
                supervising.store(true, std::sync::atomic::Ordering::SeqCst);
                let h = handle.clone();
                let sup_for_loop = sup.clone();
                let flag = supervising.clone();
                tauri::async_runtime::spawn(async move {
                    supervise(sup_for_loop, h).await;
                    flag.store(false, std::sync::atomic::Ordering::SeqCst);
                });
            } else if let Err(e) = &located {
                tracing::error!("找不到 core：{e:#}");
            }

            // 自启的路径校验。插件把 `enable()` 那一刻的绝对路径快照写
            // 进 plist，用户把 App 挪个位置就静默失效 —— 而它的
            // `is_enabled()` 只看文件在不在，仍然说「开着呢」。
            check_autostart_path(&handle);

            // 菜单栏。**在守护之前建**，这样 core 还没起来的那几秒里
            // 用户就已经看到它了 —— 开机自启时尤其重要。
            let tray = build_tray(&handle)?;
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                menubar_loop(tray, h).await;
            });

            // 心跳。三信号里最慢的那条，但**唯一能抓到「活着但卡死」**
            // —— 一个死锁的进程既不退出也不关 socket，前两条信号都看
            // 不见它，而它对用户的表现和挂了一模一样。
            let h = handle.clone();
            let sock = default_socket();
            tauri::async_runtime::spawn(async move {
                heartbeat_loop(sock, sup, h).await;
            });

            // 静默启动：开机拉起来的时候屏幕上什么都不该出现，
            // 只有菜单栏多一个图标。**图标已经在上面建好了** —— 它不等
            // core 就绪，否则用户开机后会有一段「到底启没启」的空白期。
            if autostart::launched_by_autostart(std::env::args()) {
                tracing::info!("开机自启，不开窗口");
                #[cfg(target_os = "macos")]
                become_accessory(&handle);
                maybe_notify_first_autostart(&handle);
            } else {
                show_main_window(&handle)?;
            }

            // 量 webview 占多少。**它不是一个功能，是一个回答
            // 不了就只能猜的问题的工具** —— 「关窗之后隐藏还是销毁」
            // 取决于隐藏到底放不放得掉那部分内存。
            if memcheck::requested(std::env::args()) {
                memcheck::run(handle.clone());
            }

            // 事件桥：控制面的 SSE → Tauri 事件 → 前端。
            let h = handle.clone();
            let sock = default_socket();
            tauri::async_runtime::spawn(async move {
                bridge_events(sock, h).await;
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // 点红点只是关窗口，进程留在菜单栏。macOS 上
            // 「关窗不等于退出应用」本来就是标准行为，不需要额外提示。
            //
            // **销毁窗口，不是隐藏。**这是实测出来的（那条「据此
            // 定隐藏还是销毁」）：
            //
            //   窗口没开过   107 MB
            //   窗口开着     239 MB
            //   隐藏之后     235 MB   ← 几乎没降，等三十秒也不降
            //
            // 隐藏留下的 128 MB 全是 WebKit 的三个 XPC 进程。而这是一个
            // 用户开着一整天、一天点开两三次的菜单栏应用 —— 为那两三次
            // 常驻 128 MB 不划算。销毁的代价是重开时要重新加载一次页面
            // （几百毫秒），`show_main_window` 本来就会在窗口不存在时
            // 重建它。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                let _ = window.destroy();
                #[cfg(target_os = "macos")]
                become_accessory(&app);
                #[cfg(not(target_os = "macos"))]
                let _ = &app;
            }
        })
        .build(tauri::generate_context!())
        .expect("Tauri 起不来")
        .run(|app, event| {
            // 点 Dock 图标 / 从 ⌘Tab 回来时把窗口叫回来。没有这条，一个
            // 已经隐藏窗口的菜单栏应用在 Dock 上点了没反应。
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                let _ = show_main_window(app);
            }
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

/// 心跳循环。
async fn heartbeat_loop(socket: PathBuf, sup: Arc<Supervisor>, app: tauri::AppHandle) {
    use supervisor::{HealthTracker, Verdict, health};
    let client = ControlClient::new(socket);
    let mut tracker = HealthTracker::new();
    let mut was_running = false;

    loop {
        tokio::time::sleep(health::INTERVAL).await;

        // 只在 core 应该在跑的时候探。启动中、重启中、安全模式下探测
        // 失败是**预期的**，把它算进连续失败会让守护自己制造重启循环。
        let running = matches!(sup.state(), CoreState::Running { .. });
        if !running {
            tracker.reset();
            was_running = false;
            continue;
        }
        if !was_running {
            // 刚起来。控制面 socket 可能还没建好，这一轮先不判。
            tracker.reset();
            was_running = true;
            continue;
        }

        let verdict = match client.ping(health::TIMEOUT).await {
            Ok(()) => tracker.on_ok(),
            Err(e) => {
                tracing::debug!("心跳失败：{e:#}");
                tracker.on_fail()
            }
        };
        match verdict {
            Verdict::Healthy => {}
            Verdict::Degraded { consecutive } => {
                tracing::warn!(consecutive, "core 没回心跳");
            }
            Verdict::Wedged => {
                let _ = app.emit("core-wedged", ());
                if let Err(e) = sup.report_wedged().await {
                    tracing::debug!("换掉卡死的 core 失败：{e:#}");
                }
                // 杀完就清零，等它重起来再重新计数。
                tracker.reset();
                was_running = false;
            }
        }
    }
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
                // **在客户端弹批准提示的同一瞬间弹一条通知**。
                // 这是网关位置独有的能力：只有我们同时知道「这个调用长
                // 什么样」和「它来自哪个上游」。用户看到批准提示的同时
                // 看到这条，判断质量完全不一样。
                notify_if_dangerous(&a, &ev);
                // 菜单栏上那两个数只跟这几种事件有关：花了多少（请求
                // 落地之后存储层才算得出来）、额度还剩多少。别的事件
                // 叫醒它只是让它白跑一趟。
                if matches!(
                    ev,
                    tw_api::Event::RequestFinished { .. }
                        | tw_api::Event::RequestFailed { .. }
                        | tw_api::Event::QuotaSeen { .. }
                        | tw_api::Event::ConfigReloaded { .. }
                ) && let Some(st) = a.try_state::<AppState>()
                {
                    st.menubar.notify_one();
                }
                let _ = a.emit("core-event", &ev);
            })
            .await;
        if let Err(e) = r {
            tracing::debug!("事件流断开：{e:#}");
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
}

/// 高危的工具调用要弹系统通知。
///
/// **只弹高危的。**中危和脱敏都只进界面 —— 通知的代价是用户学会忽略
/// 通知，包括那些真该看的。
fn notify_if_dangerous(app: &tauri::AppHandle, ev: &tw_api::Event) {
    use tauri_plugin_notification::NotificationExt;
    let tw_api::Event::ToolCallFlagged {
        provider,
        tool,
        why,
        excerpt,
        high,
        blocked,
        ..
    } = ev
    else {
        return;
    };
    if !high {
        return;
    }
    // 标题里就要有「哪个上游」和「哪个工具」—— 用户是在批准提示旁边
    // 扫一眼这条通知的，正文他不一定读得完
    let title = if *blocked {
        format!("已拦截 {provider} 返回的 {tool} 调用")
    } else {
        format!("{provider} 返回了一个可疑的 {tool} 调用")
    };
    let body = if *blocked {
        format!(
            "{why}
{excerpt}
这个上游标记为不受信任，响应流已切断。"
        )
    } else {
        format!(
            "{why}
{excerpt}
建议拒绝这个调用。"
        )
    };
    let _ = app.notification().builder().title(title).body(body).show();
}

/// 第一次开机自启之后提示一次「我在菜单栏这儿」，之后永不再弹。
///
/// **每次开机都弹是噪音**，而噪音的代价是用户学会忽略通知 —— 包括那些
/// 真该看的（和守护的分级告知同一条理由）。
fn maybe_notify_first_autostart(app: &tauri::AppHandle) {
    let dir = data_dir();
    let marker = dir.join(".autostart-notified");
    if marker.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(&dir);
    // 先写标记再发通知。反过来的话，发通知失败会让它每次开机都重试，
    // 而那正是我们要避免的噪音。
    if std::fs::write(&marker, "1").is_err() {
        return;
    }
    let _ = app.emit("first-autostart", ());
    tracing::info!("首次开机自启，已提示一次");
}

/// plist 里的路径还指着现在这个二进制吗。
///
/// 不一致就重新注册一次。这件事插件不做，而它的失败模式是**静默的**：
/// 开机之后什么都没发生，而设置里显示自启是开着的。
fn check_autostart_path(app: &tauri::AppHandle) {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    if !matches!(mgr.is_enabled(), Ok(true)) {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let exe = exe.display().to_string();
    let Some(plist) = autostart::plist_path(&app.config().identifier) else {
        return;
    };
    let Ok(contents) = std::fs::read_to_string(&plist) else {
        return;
    };
    if autostart::plist_path_matches(&contents, &exe) {
        return;
    }
    tracing::warn!(
        plist = %plist.display(),
        current = %exe,
        "自启的 plist 指向旧路径（App 被挪过？），重新注册"
    );
    let _ = mgr.disable();
    if let Err(e) = mgr.enable() {
        tracing::error!("重新注册自启失败：{e}");
    }
}

/// 主窗口用时才建。
///
/// **「根本不创建」不是「创建后隐藏」**：后者省不了内存也省不了
/// 启动时间，而且窗口会有一帧闪烁 —— 开机的时候屏幕上什么都不该出现。
fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("main") {
        w.show()?;
        w.set_focus()?;
        return Ok(());
    }
    let w = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("ThinkWatch Lite")
        .inner_size(1100.0, 720.0)
        .min_inner_size(820.0, 560.0)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .build()?;
    w.set_focus()?;
    // 有窗口了就该出现在 Dock 和 ⌘Tab 里
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    Ok(())
}

/// 没有窗口时退回菜单栏应用：不占 Dock、不进 ⌘Tab。
#[cfg(target_os = "macos")]
fn become_accessory(app: &tauri::AppHandle) {
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

/// 建托盘。图标先画一个「启动中」的状态。
///
/// **不在 tauri.conf.json 里配 `trayIcon`** —— 配了的话 Tauri 会自己再
/// 建一个，菜单栏上就出现两个图标。图标是运行时画出来的（两行
/// 必须自己渲染成图片），配置里那份静态图没有意义。
fn build_tray(app: &tauri::AppHandle) -> anyhow::Result<tauri::tray::TrayIcon> {
    let s = menubar::MenuBarState::default();
    let (rgba, w, h) = menubar::render_rgba(
        &s.line1(),
        &s.line2(),
        s.is_template(),
        menubar::Appearance::Dark,
    );
    // 托盘菜单。**「退出」在这里，而 ⌘Q 只隐藏窗口** —— 这个
    // 应用退出的代价很高（所有 AI 客户端立刻失联），一个手滑的 ⌘Q 不
    // 该造成那个后果。
    let menu = build_tray_menu(app, &TrayFacts::default())?;

    let tray = TrayIconBuilder::new()
        .icon(Image::new_owned(rgba, w, h))
        // 模板图靠 alpha 自动跟随菜单栏亮暗反色
        .icon_as_template(true)
        .menu(&menu)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            match id.as_str() {
                "open" => {
                    if let Err(e) = show_main_window(app) {
                        tracing::error!("开窗口失败：{e}");
                    }
                }
                "quit" => {
                    // **退出要确认**：代价是所有 AI 客户端立刻
                    // 失联，不该由一次手滑造成。托盘里没法弹对话框，
                    // 所以把窗口拉起来让他在里面确认。
                    if let Err(e) = show_main_window(app) {
                        tracing::error!("开窗口失败：{e}");
                    }
                    let _ = app.emit("ask-quit", ());
                }
                "undo" => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let Some(state) = app.try_state::<AppState>() else {
                            return;
                        };
                        // 「上一版」= 历史里的第二条（第一条是现在跑着的）
                        let hist = state.control.config_history().await;
                        let target = hist
                            .ok()
                            .and_then(|h| h.into_iter().rev().nth(1).map(|v| v.version));
                        match target {
                            Some(v) => match state.control.rollback(v.clone()).await {
                                Ok(_) => tracing::info!(%v, "从托盘撤销了上一次配置修改"),
                                Err(e) => tracing::warn!("撤销失败：{e:#}"),
                            },
                            None => tracing::info!("历史里没有上一版，没什么可撤销的"),
                        }
                    });
                }
                _ => {
                    // `组::<组名>::<provider>` —— 托盘里切 select 组
                    if let Some(rest) = id.strip_prefix("组::") {
                        let Some((g, p)) = rest.split_once("::") else {
                            return;
                        };
                        let (g, p) = (g.to_string(), p.to_string());
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let Some(state) = app.try_state::<AppState>() else {
                                return;
                            };
                            if let Err(e) = state.control.select_group(&g, &p).await {
                                tracing::warn!("切换 `{g}` 失败：{e:#}");
                            }
                        });
                    }
                }
            }
        })
        .build(app)?;
    Ok(tray)
}

/// 收一份托盘菜单要的数据。
///
/// **只在这一处读，一秒一次。**菜单事件里去读的话，用户点开菜单那一下
/// 要等一次控制面往返 —— 而菜单是要立刻弹出来的东西。
async fn collect_tray_facts(
    state: &tauri::State<'_, AppState>,
    bar: &menubar::MenuBarState,
) -> TrayFacts {
    let running = matches!(bar.status, menubar::Status::Normal);
    if !running {
        return TrayFacts {
            running: false,
            ..Default::default()
        };
    }
    let groups = state
        .control
        .overview()
        .await
        .map(|o| {
            o.groups
                .into_iter()
                // 只有 `select` 组能在托盘里切 —— 别的策略是自动决定的，
                // 给个下拉会让人以为自己在指挥它
                .filter(|g| g.kind == "手动选")
                .map(|g| (g.name, g.providers, g.selected))
                .collect()
        })
        .unwrap_or_default();
    let can_undo = state
        .control
        .config_history()
        .await
        .map(|h| h.len() >= 2)
        .unwrap_or(false);
    TrayFacts {
        running,
        cost: bar.cost_today,
        quota: bar.quota_percent,
        groups,
        can_undo,
    }
}

/// 托盘菜单要显示的东西。
///
/// **只留会影响菜单长相的那几项。**每秒重建一次菜单是浪费，而且 macOS
/// 上菜单正开着时重建会把它收起来 —— 用户点到一半菜单没了。
#[derive(Default, PartialEq, Clone)]
struct TrayFacts {
    running: bool,
    /// 今日花费。`None` = 不知道，画破折号而不是 `$0.00`
    cost: Option<f64>,
    /// 最紧张那个额度窗口用了多少（订阅账号才有）
    quota: Option<f64>,
    /// `select` 组：`(组名, 成员, 当前选中)`
    groups: Vec<(String, Vec<String>, Option<String>)>,
    /// 有没有上一版可以撤销
    can_undo: bool,
}

/// 建托盘菜单。
///
/// 菜单栏显示的是**状态**，点开才是**操作面板** —— 所以上半截是几行
/// 读不了的状态，下半截才是能点的东西。
fn build_tray_menu(app: &tauri::AppHandle, f: &TrayFacts) -> tauri::Result<Menu<tauri::Wry>> {
    use tauri::menu::{PredefinedMenuItem, Submenu};
    let head = MenuItem::with_id(
        app,
        "head",
        if f.running {
            "ThinkWatch  ● 运行中"
        } else {
            "ThinkWatch  ○ 没在跑"
        },
        // **点不动。**它是状态不是操作
        false,
        None::<&str>,
    )?;
    let money = MenuItem::with_id(
        app,
        "money",
        match (f.quota, f.cost) {
            // 订阅账号优先显示额度：「今天花了 $0.00」对他是句废话
            (Some(q), _) => format!("额度  已用 {:.0}%", q * 100.0),
            (None, Some(c)) => format!("今日  ${c:.2}"),
            // **破折号不是 0。**画一个 $0.00 是在断言「今天没花钱」
            (None, None) => "今日  —".to_string(),
        },
        false,
        None::<&str>,
    )?;
    let sep = PredefinedMenuItem::separator(app)?;
    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> =
        vec![Box::new(head), Box::new(money), Box::new(sep)];

    // `select` 组：一个子菜单一组，选中的打勾（这就是「托盘里切」）
    for (name, members, selected) in &f.groups {
        let mut subs: Vec<Box<dyn tauri::menu::IsMenuItem<tauri::Wry>>> = Vec::new();
        for m in members {
            subs.push(Box::new(tauri::menu::CheckMenuItem::with_id(
                app,
                format!("组::{name}::{m}"),
                m,
                true,
                Some(m) == selected.as_ref(),
                None::<&str>,
            )?));
        }
        let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
            subs.iter().map(|b| b.as_ref()).collect();
        items.push(Box::new(Submenu::with_items(app, name, true, &refs)?));
    }
    if !f.groups.is_empty() {
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
    }

    items.push(Box::new(MenuItem::with_id(
        app,
        "undo",
        "撤销上一次配置修改",
        // **没得撤就是灰的，不是不显示。**一个时有时无的菜单项，用户
        // 每次都要重新找它在哪儿
        f.can_undo,
        None::<&str>,
    )?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "open",
        "打开主界面",
        true,
        None::<&str>,
    )?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(
        app,
        "quit",
        "退出 ThinkWatch Lite…",
        true,
        None::<&str>,
    )?));
    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        items.iter().map(|b| b.as_ref()).collect();
    Menu::with_items(app, &refs)
}

/// 攒多久再收一次数。
///
/// 一串请求只换来一次重收，而不是一条一次。顺便给存储层留出把这一条
/// 落库的时间 —— 花费是它算出来的，事件到的那一刻还没有。
const MENUBAR_SETTLE: std::time::Duration = std::time::Duration::from_secs(3);

/// 菜单栏。**被事件叫醒，不是每秒醒一次。**
///
/// 它原来一秒一轮：每轮走两趟控制面（额度、汇总），另外每五轮再走两趟
/// 建托盘菜单。渲染那一层一直有「文字没变就不重画」的保护，但**收数据
/// 那一层没有** —— 于是一台整天闲着的机器每秒钟都在问两个几小时才会变
/// 一次的问题。菜单栏是这个应用唯一常驻的东西，它自己耗电就直接违反了
/// 「空闲时约等于不存在」。
///
/// 现在三个理由会叫醒它：请求落地、额度头出现、守护状态变了。都没发生
/// 的时候，它一次都不醒。
async fn menubar_loop(tray: tauri::tray::TrayIcon, app: tauri::AppHandle) {
    // 两路唤醒信号，在循环外拿一次就够 —— 它们和 AppState 同寿。
    let Some(wake) = app.try_state::<AppState>().map(|s| s.menubar.clone()) else {
        return;
    };
    // 守护状态自己是一路：core 起来、重启、进安全模式都要立刻反映到
    // 菜单栏上，而那和请求流没有关系。
    let Some(mut core_rx) = app.try_state::<AppState>().map(|s| s.supervisor.watch()) else {
        return;
    };

    let mut prev = menubar::MenuBarState::default();
    let mut prev_tray = TrayFacts::default();
    // 第一帧无条件画，之后靠 needs_redraw
    let mut first = true;
    loop {
        // 应用正在退出，状态已经撤了 —— 收摊，别再画了
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        let next = collect_menubar_state(&state).await;
        // 托盘菜单跟着一起更。**只在内容真的变了的时候重建** —— 而且
        // macOS 上菜单正开着时重建会把它收起来，用户点到一半菜单没了。
        let facts = collect_tray_facts(&state, &next).await;
        if first || facts != prev_tray {
            match build_tray_menu(&app, &facts) {
                Ok(m) => {
                    let _ = tray.set_menu(Some(m));
                    prev_tray = facts;
                }
                Err(e) => tracing::debug!("托盘菜单没建起来：{e}"),
            }
        }
        if first || next.needs_redraw(&prev) {
            first = false;
            draw_menubar(&tray, &next);
            prev = next;
        }

        // 等一个理由。**两路都要等** —— 只等事件的话，core 挂了之后
        // 菜单栏会停在最后那个数字上，而那正是最该说实话的时候。
        tokio::select! {
            _ = wake.notified() => {}
            _ = core_rx.changed() => {}
        }
        // 攒一下。`Notify` 只攒一个许可，所以这三秒里来多少条事件，
        // 醒来之后也只多跑一轮。
        tokio::time::sleep(MENUBAR_SETTLE).await;
    }
}

/// 把一帧画到菜单栏上。
fn draw_menubar(tray: &tauri::tray::TrayIcon, next: &menubar::MenuBarState) {
    let template = next.is_template();
    let (rgba, w, h) = menubar::render_rgba(
        &next.line1(),
        &next.line2(),
        template,
        menubar::Appearance::Dark,
    );
    let _ = tray.set_icon(Some(Image::new_owned(rgba, w, h)));
    // **模板标志要跟着状态一起切**：告警时关掉它才能上色，
    // 恢复时再打开才能重新自动适配亮暗。
    let _ = tray.set_icon_as_template(template);
}

async fn collect_menubar_state(state: &tauri::State<'_, AppState>) -> menubar::MenuBarState {
    let core = state.supervisor.state();
    let status = match core {
        CoreState::Running { .. } => menubar::Status::Normal,
        CoreState::Starting | CoreState::Restarting { .. } => menubar::Status::Starting,
        CoreState::SafeMode | CoreState::Stopped => menubar::Status::Disconnected,
    };
    if !matches!(status, menubar::Status::Normal) {
        // core 没在跑的时候，上一次的数字已经不代表现在了。**显示破折号
        // 而不是一个凝固的旧值** —— 后者会让人以为它还在更新。
        return menubar::MenuBarState {
            active: 0,
            status,
            ..Default::default()
        };
    }
    // **订阅额度优先。**有它说明这是个订阅账号，而对他「今天花了 $0.00」
    // 是句废话。按量付费的账号根本没有那些响应头。
    let quota = state.control.quota().await.unwrap_or_default();
    let tightest = quota
        .iter()
        .flat_map(|p| p.windows.iter())
        .max_by(|a, b| a.used_percent.total_cmp(&b.used_percent));

    // 花费从库里来。拿不到就是「不知道」——**画一个 $0.00 会是一个断言：
    // 今天没花钱**，而那不是我们知道的事。
    let cost_today = if tightest.is_some() {
        None
    } else {
        state
            .control
            .summary(None)
            .await
            .ok()
            // **只用实测的那部分。**把估算混进这个数字里，就是在一块
            // 用户每天扫一眼的地方假装精确。
            .map(|s| s.cost_micros_exact as f64 / 1e6)
    };

    menubar::MenuBarState {
        cost_today,
        quota_percent: tightest.map(|w| w.used_percent),
        quota_reset_in_secs: tightest.and_then(|w| w.reset_in_secs),
        quota_warning: tightest.is_some_and(|w| {
            matches!(
                w.status.as_deref(),
                Some("allowed_warning") | Some("rejected")
            )
        }),
        tokens_per_sec: None,
        active: 0,
        status,
    }
}

/// 数据目录。**只有这一处**决定它在哪 —— 写第二遍就会漂，而漂掉的那处
/// 大概率是忘了看 `THINKWATCH_HOME` 的那处（测试就是靠它隔离的）。
fn data_dir() -> PathBuf {
    std::env::var_os("THINKWATCH_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".thinkwatch")))
        .unwrap_or_else(|| PathBuf::from(".thinkwatch"))
}

fn default_socket() -> PathBuf {
    data_dir().join("twcore.sock")
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
