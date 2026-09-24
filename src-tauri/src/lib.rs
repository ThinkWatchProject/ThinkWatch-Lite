//! ThinkWatch Lite 的 UI 侧。
//!
//! 它做三件事：起 core 并看着它、把控制面的数据搬给前端、以及在 core
//! 挂掉时悄悄修好。用户眼里这一切和 core 是**同一个程序**。

use std::path::PathBuf;
use std::sync::Arc;
use tw_api::ep;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

// 第一个声明：`tr!` 要在后面每个模块里都能用
#[macro_use]
pub mod i18n;
pub mod autostart;
pub mod call;
pub mod chatgpt;
pub mod clients;
pub mod control;
#[cfg(target_os = "macos")]
/// 从 DMG 里取出 `.app`，给更新器用。**只有 macOS 有** —— 它整个是 `hdiutil`，
/// 而发布页上那个 DMG 本来就只给那个平台。Windows 上更新器直接装 NSIS 包。
#[cfg(target_os = "macos")]
pub mod dmg;
pub mod error;
use error::{Out, text};
pub mod keys;
/// 量 webview 占多少的那个诊断工具。**只有 macOS 有**，它靠 `ps`。
///
/// **只在开发构建里。**它是回答一次性问题的测量工具，发布包不需要一个能从命令行
/// 让应用关窗、退出的开关。
#[cfg(all(target_os = "macos", debug_assertions))]
pub mod memcheck;
pub mod menubar;
pub mod notices;
pub mod prefs;
pub mod supervisor;
pub mod tally;
pub mod theme;
mod token;
pub mod update;
pub mod upstreams;
pub mod zai;

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
    /// **立刻**重收一次，不等攒够三秒：菜单刚打开、换了菜单栏的样式或界面语言
    pub menubar_now: Arc<tokio::sync::Notify>,
    /// 菜单栏要的实时数：哪些请求在跑、最近的输出速率。事件桥喂它
    pub tally: Arc<std::sync::Mutex<tally::Tally>>,
}

/// 网关那个可执行文件叫什么。
///
/// **Windows 上带 `.exe`。**`CreateProcess` 见到一个没有扩展名的路径，会去找
/// 同名的 `.exe`；所以一个就叫 `twcore` 的文件在那里根本起不来。而在那之前的
/// 每一步 —— 打包放进去、构建期校验它在不在、`locate_core` 找到它 —— 都会说
/// 一切正常，坏在最后一步，表现为界面永远停在连接页上。
///
/// 声明「包里装什么」的那份 JSON 不能分支，所以 Windows 另有一份
/// `tauri.windows.conf.json`。**它是合并进来的，不是替换**（RFC 7386 的
/// merge patch）—— 所以除了加上带 `.exe` 的那条，还要把基础配置里不带扩展名
/// 的那条显式设成 `null`。不然两条同时生效，而其中一条指着一个在那个平台上
/// 根本不存在的文件，构建期就停在「resource path doesn't exist」。
pub const CORE_EXE: &str = if cfg!(windows) {
    "twcore.exe"
} else {
    "twcore"
};

/// twcore 在哪。
///
/// 开发时它在 core 仓库的 target 里；打包后它在 app bundle 的
/// Resources 下。**两条路径都要试，而且找不到时要说清楚找过哪儿** ——
/// 「二进制不存在」是安装期最常见的失败，而默认的错误信息只会说
/// No such file or directory。
/// 打包之后，core 只可能在一个地方。
///
/// macOS 的 `.app/Contents/MacOS/<exe>` 到 `.app/Contents/Resources/`
/// 是 bundle 布局定死的关系。
///
/// **Windows 上装好的那一份，网关就在自己旁边**：NSIS 把资源放进安装目录
/// （`tauri.windows.conf.json` 把它映射成 `twcore.exe`）。「是不是装好的那
/// 一份」和自更新问的是同一件事，所以同一个判断（旁边有没有卸载程序）。
///
/// 以前这里只认 macOS 的布局，Windows 上装好的应用于是被当成开发构建，往下
/// 走到了开发那几条候选 —— 包里缺了 `twcore.exe` 的时候，它会去环境变量、
/// 工作目录、PATH 里找一个来跑，正是下面那段注释说要堵上的口子。界面上显示
/// 的路径也因此是框架给的 `\\?\C:\…` 那种写法。
fn bundled_core() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    if dir.ends_with("Contents/MacOS") {
        return Some(dir.parent()?.join("Resources").join(CORE_EXE));
    }
    #[cfg(windows)]
    if update::nsis_installed(&exe) == update::Install::Standalone {
        return Some(dir.join(CORE_EXE));
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
        anyhow::bail!(tr!(
            "安装包缺少 twcore 组件，请重新下载并安装。",
            "The app bundle is missing the twcore component. Download and install ThinkWatch Lite again."
        ));
    }

    let mut tried = Vec::new();

    // 别的平台以后会有自己的打包形态，框架这条留着 —— 它在 macOS 的
    // `.app` 里实测返回 `unknown path`，所以上面那一段不能指望它。
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join(CORE_EXE);
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
                    .join(CORE_EXE);
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
            let p = dir.join(CORE_EXE);
            if p.exists() {
                return Ok(p);
            }
        }
    }

    let searched = tried
        .iter()
        .map(|p| format!("  · {}", p.display()))
        .collect::<Vec<_>>()
        .join("\n");
    anyhow::bail!(tr!(
        format!(
            "未找到 twcore。已查找以下位置及 PATH：\n{searched}\n\n\
             可通过 THINKWATCH_CORE_BIN 指定绝对路径，或在 core 仓库中执行 \
             `cargo build -p twcore`。"
        ),
        format!(
            "twcore was not found. Searched these locations and PATH:\n{searched}\n\n\
             Set THINKWATCH_CORE_BIN to an absolute path, or run \
             `cargo build -p twcore` in the core repository."
        )
    ))
}

/// core 的状态。**不走 `call`**：这里多一步，协议版本对不上时说一句人话。
#[tauri::command]
async fn core_status(state: tauri::State<'_, AppState>) -> Out<tw_api::Status> {
    state.control.status().await.map_err(text)
}

#[tauri::command]
async fn core_state(state: tauri::State<'_, AppState>) -> Out<String> {
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
async fn restart_core(app: tauri::AppHandle) -> Out<()> {
    restart_gateway(&app).await
}

/// 界面上的「重新启动」和菜单栏里的「重新启动网关」走的都是这里
pub(crate) async fn restart_gateway(app: &tauri::AppHandle) -> Out<()> {
    use std::sync::atomic::Ordering;
    let state = app.state::<AppState>();
    if let Some(why) = &state.core_missing {
        return Err(why.clone().into());
    }
    if state.supervising.swap(true, Ordering::SeqCst) {
        return state.supervisor.request_restart().await.map_err(text);
    }
    let sup = state.supervisor.clone();
    let flag = state.supervising.clone();
    let app = app.clone();
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
        CoreState::Failed { reason } => format!("failed:{reason}"),
    }
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
) -> Out<Dashboard> {
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
        summary: c
            .call::<ep::Summary>(&[], &window(Some(since), None))
            .await
            .map_err(text)?,
        latency: c
            .call::<ep::Latency>(&[], &tw_api::Window::default())
            .await
            .unwrap_or_default(),
        latency_by_provider: c
            .call::<ep::LatencyByProvider>(&[], &tw_api::Window::default())
            .await
            .unwrap_or_default(),
        history: c
            .call::<ep::History>(
                &[],
                &tw_api::ListQuery {
                    limit: Some(200),
                    ..Default::default()
                },
            )
            .await
            .unwrap_or_default(),
        storage: c.call::<ep::Storage>(&[], &()).await.ok(),
        // 趋势和分组。**拿不到就是空的，不该让整页失败** —— 这一页别的
        // 部分照样有用（同一条：观测层的缺失不该扩散）。
        buckets: c
            .call::<ep::CostBuckets>(
                &[],
                &tw_api::BucketQuery {
                    from_ms: Some(since),
                    to_ms: None,
                    bucket_ms: Some(bucket),
                },
            )
            .await
            .unwrap_or_default(),
        buckets_by_model: c
            .call::<ep::CostBucketsBy>(
                &[],
                &tw_api::BucketGroupQuery {
                    from_ms: Some(since),
                    to_ms: None,
                    bucket_ms: Some(bucket),
                    dim: tw_api::CostDim::Model,
                },
            )
            .await
            .unwrap_or_default(),
        // **上一个等长区间。**一个没有参照系的金额只能读，不能判断
        // ——「$4.05」是多还是少，只有和上一个七天比过才知道。
        // 拿不到就不显示那句对比，不影响这一页别的部分。
        prev: c
            .call::<ep::Summary>(&[], &window(Some(since - (now - since)), Some(since)))
            .await
            .ok(),
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

/// 一段时间窗。两端各自可缺：只给起点就是「从那时起到现在」。
fn window(from_ms: Option<i64>, to_ms: Option<i64>) -> tw_api::Window {
    tw_api::Window { from_ms, to_ms }
}

/// 攒一份诊断包，写到磁盘上，把路径交回去。
///
/// **写文件是这一侧的事，不是 core 的。**core 只负责把内容攒出来 ——
/// 「往哪儿写」是个桌面概念，而它在无头运行时根本不存在。
#[tauri::command]
async fn save_diagnostics(state: tauri::State<'_, AppState>) -> Out<String> {
    let text = state
        .control
        .call::<ep::Diagnostics>(&[], &())
        .await
        .map_err(text)?;
    let dir = data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| {
        tr!(
            format!("无法创建目录 {}：{e}", dir.display()),
            format!("The directory {} could not be created: {e}", dir.display())
        )
    })?;
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 文件名界面上看得见（「已生成：…」），所以也跟着语言走
    let path = dir.join(tr!(
        format!("诊断包-{at}.md"),
        format!("diagnostics-{at}.md")
    ));
    write_private(&path, text.as_bytes()).map_err(|e| {
        tr!(
            format!("无法写入文件 {}：{e}", path.display()),
            format!("The file {} could not be written: {e}", path.display())
        )
    })?;
    Ok(path.display().to_string())
}

/// 建的时候就是 `0600`。
///
/// 诊断包里是脱敏过的，但它仍然描述了这台机器上有哪些上游、哪些客户端 ——
/// 同机器上的其他用户没有理由读到。**不是写完再 `chmod`**：那中间有一个按
/// umask 谁都能读的窗口。同一秒里点两次会撞上同一个名字，先删掉再建，否则
/// `mode` 对已经存在的文件不生效（core 写控制面凭据是同一个做法）。
fn write_private(path: &std::path::Path, contents: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let _ = std::fs::remove_file(path);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)?.write_all(contents)
}

/// 要还原哪几个，以及各自用什么去指代。返回 `(id, 名字)`。
///
/// **对 core 说 id，对用户说名字。**core 的路由是 `/clients/{id}/restore`，
/// 而 `name` 是显示名：拿「Claude Code」去拼 URI，那个空格连请求都发不出去；
/// 拿「Zed」去发，换来的是一句「未知的客户端 Zed」。两者只有 opencode 恰好
/// 相同，所以挑错了字段，测一遍还会看到一个成功的例子。把这一步单独拎出来，
/// 就是为了让「哪个字段进地址」有地方可测。
fn restore_targets(list: &tw_api::ClientsResponse) -> Vec<(&str, &str)> {
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
async fn restore_all(state: tauri::State<'_, AppState>) -> Out<Vec<RestoreOutcome>> {
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
    use tauri_plugin_autostart::ManagerExt;
    match app.autolaunch().disable() {
        Ok(_) => log.push(tr!("已取消开机启动", "Launch at login turned off").into()),
        Err(e) => log.push(tr!(
            format!(
                "未能取消开机启动（{e}）。请在「系统设置 › 通用 › 登录项」中关闭 ThinkWatch Lite。"
            ),
            format!(
                "Launch at login could not be turned off ({e}). Turn off ThinkWatch Lite in System Settings › General › Login Items."
            )
        )),
    }
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
    log.push(
        tr!(
            "现可将应用移到废纸篓。",
            "The app can now be moved to the Trash."
        )
        .into(),
    );
    Ok(log)
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

/// 更新这件事的当前状态，一次说完。
///
/// 界面要问的从来不是「有没有新版本」一个问题，而是「我这一份是怎么装
/// 上来的、自动检查开着吗、手上有没有一个查到了还没装的版本」—— 分成几个
/// 命令去问，界面就得自己把答案拼成一句话，而拼错了没有东西会发现。
#[derive(serde::Serialize)]
struct UpdateView {
    /// 现在跑的是哪一版
    version: String,
    /// 这一份是怎么装上来的
    install: update::Install,
    /// 自动检查开着吗
    check_updates: bool,
    /// 查到了、还没装的那一版
    offer: Option<Found>,
}

fn update_view(app: &tauri::AppHandle) -> UpdateView {
    UpdateView {
        version: app.package_info().version.to_string(),
        install: update::kind(),
        check_updates: prefs::load(&data_dir()).check_updates,
        offer: app.state::<Updates>().offer.lock().unwrap().clone(),
    }
}

#[tauri::command]
fn update_state(app: tauri::AppHandle) -> UpdateView {
    update_view(&app)
}

#[tauri::command]
fn set_update_check(app: tauri::AppHandle, on: bool) -> Out<UpdateView> {
    prefs::update(&data_dir(), |p| p.check_updates = on).map_err(|e| {
        tr!(
            format!("无法保存设置：{e:#}"),
            format!("The setting could not be saved: {e:#}")
        )
    })?;
    Ok(update_view(&app))
}

/// 界面语言：现在用的、设置里选的、系统的。
///
/// 三个一起给：设置页要写成「跟随系统（简体中文）」，光有现在用的那一种
/// 说不出括号里那半句。
#[derive(serde::Serialize)]
struct LanguageView {
    current: i18n::Lang,
    /// `None` 是跟随系统
    setting: Option<i18n::Lang>,
    system: i18n::Lang,
}

fn language_view() -> LanguageView {
    LanguageView {
        current: i18n::current(),
        setting: prefs::load(&data_dir()).language,
        system: i18n::system(),
    }
}

#[tauri::command]
fn app_language() -> LanguageView {
    language_view()
}

/// 换语言。**开着的窗口当场换，托盘菜单跟着重建**，不用重启应用。
#[tauri::command]
fn set_language(app: tauri::AppHandle, setting: Option<i18n::Lang>) -> Out<LanguageView> {
    prefs::update(&data_dir(), |p| p.language = setting).map_err(|e| {
        tr!(
            format!("无法保存设置：{e:#}"),
            format!("The setting could not be saved: {e:#}")
        )
    })?;
    i18n::set(i18n::effective(setting));
    // 菜单栏的文案跟着换，不等下一个事件
    if let Some(state) = app.try_state::<AppState>() {
        state.menubar_now.notify_one();
    }
    let _ = app.emit("language-changed", i18n::current());
    Ok(language_view())
}

/// 界面外观：现在用的、设置里选的、系统的。三个一起给，理由同
/// [`LanguageView`]。
#[derive(serde::Serialize)]
struct ThemeView {
    current: theme::Theme,
    /// `None` 是跟随系统
    setting: Option<theme::Theme>,
    system: theme::Theme,
}

fn theme_view() -> ThemeView {
    let setting = prefs::load(&data_dir()).theme;
    ThemeView {
        current: theme::effective(setting),
        setting,
        system: theme::system(),
    }
}

#[tauri::command]
fn app_theme() -> ThemeView {
    theme_view()
}

/// 换外观。**当场生效** —— 换的是窗口的外观，网页里的
/// `prefers-color-scheme` 跟着翻，不用重启也不用重画。
#[tauri::command]
fn set_theme(app: tauri::AppHandle, setting: Option<theme::Theme>) -> Out<ThemeView> {
    prefs::update(&data_dir(), |p| p.theme = setting).map_err(|e| {
        tr!(
            format!("无法保存设置：{e:#}"),
            format!("The setting could not be saved: {e:#}")
        )
    })?;
    theme::apply(&app, setting);
    Ok(theme_view())
}

/// 找到的新版本。
#[derive(Clone, serde::Serialize)]
pub(crate) struct Found {
    version: String,
}

/// 更新在内存里的那点状态。
#[derive(Default)]
struct Updates {
    /// 查到了、还没装的那一版。更新窗口打开时读它，设置页也读它。
    offer: std::sync::Mutex<Option<Found>>,
    /// 正在装。**连点两下不能下载两份、替换两次。**
    installing: std::sync::atomic::AtomicBool,
}

/// 更新窗口要画的东西。
#[derive(serde::Serialize)]
struct OfferView {
    version: String,
    current: String,
    install: update::Install,
    /// Homebrew 那一档要执行的命令。**由这里给出，界面上不再写一遍** ——
    /// 两处各写一份，改了其中一处，弹窗里复制出去的就是另一条。
    command: Option<&'static str>,
}

/// 读发布页上的清单：最新的那一版比现在新吗。
///
/// 读的是一份几百字节的 JSON，不下载任何别的东西。
async fn look(app: &tauri::AppHandle) -> Result<Option<Found>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let u = app.updater().map_err(|e| e.to_string())?;
    let found = u.check().await.map_err(|e| e.to_string())?;
    Ok(found.map(|up| Found {
        version: up.version.clone(),
    }))
}

/// 从网上读一段文本。
///
/// **和更新器插件同一套 TLS。**插件在它的第一次请求之前，把 ring 装成进程
/// 默认的加密实现；这里做同样的事 —— 谁先跑到都一样，装过之后再装是空
/// 操作。
async fn fetch_text(url: &str) -> Result<String, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .user_agent("ThinkWatch-Lite")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
}

/// 这一份现在有没有该装的新版本。
///
/// **Homebrew 那一档问的是 tap，不是发布页。**发版那一刻 latest.json 就有
/// 了新版本，而 cask 要等 tap 的定时任务跟上；在那之前提示用户执行
/// `brew upgrade`，他照做只会看到「已经是最新」。所以那一档以 cask 里的
/// 版本为准。
async fn find(app: &tauri::AppHandle) -> Result<Option<Found>, String> {
    if update::kind() != update::Install::Homebrew {
        return look(app).await;
    }
    let current = app.package_info().version.to_string();
    let cask = fetch_text(update::CASK_URL).await?;
    let Some(version) = update::cask_version(&cask) else {
        return Err(tr!(
            "无法从 Homebrew cask 中读取版本号",
            "The version number could not be read from the Homebrew cask"
        )
        .into());
    };
    if !update::newer(version, &current) {
        return Ok(None);
    }
    Ok(Some(Found {
        version: version.to_string(),
    }))
}

const UPDATE_WINDOW: &str = "update";

/// 更新窗口有多宽。**高度跟着内容走**，宽度是定死的。
///
/// 这个数是被 Homebrew 那条命令定下来的：它要在一行里完整显示出来。一条
/// 要粘进终端去执行的命令，显示成「…upgrade --cask thinkwatc」是不行的
/// —— 用户看不全自己要执行的是什么。
const UPDATE_WIDTH: f64 = 480.0;

/// 更新窗口。
///
/// **一个单独的小窗，不是主窗口里的一个对话框。**这是菜单栏应用：查到新
/// 版本的那一刻，主窗口多半根本不存在 —— 为了说一句话把 1100×720 的整个
/// 界面拉起来，用户点完「稍后」还得再去关一次主窗口。
///
/// **建出来先不显示。**页面画好、量出内容的高度之后，由前端自己亮出来；
/// 否则会先闪一下白窗，再跳一下尺寸。
fn show_update_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(UPDATE_WINDOW) {
        w.show()?;
        w.set_focus()?;
        return Ok(());
    }
    WebviewWindowBuilder::new(app, UPDATE_WINDOW, WebviewUrl::default())
        .title(tr!("软件更新", "Software Update"))
        .initialization_script(i18n::init_script())
        // 高度先随便给一个：网页画完量出内容有多高，再由 `update_fit` 定下来
        .inner_size(UPDATE_WIDTH, 220.0)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .center()
        .visible(false)
        .build()?;
    Ok(())
}

/// 把更新窗口调成网页量出来的那么高。
///
/// **窗口有多高，不等于网页有多高。**Tauri 在 macOS 上建的是一扇
/// `FullSizeContentView` 的窗：内容视图铺满整扇窗户，标题栏盖在它上面，
/// webview 只摆在标题栏底下那一块。而 `set_size` 说的是整扇窗户
/// （`inner_size()` 和 `outer_size()` 在这里报的也是同一个数，所以标题栏
/// 有多高，从它们之间也减不出来）—— 照着网页量出来的高度设下去，网页拿到
/// 的就少了一条标题栏，内容的最后一截被窗口下沿切掉：底部留白没了，那排
/// 按钮只剩上半截。
///
/// 标题栏多高不写死 —— 各版本不一样（Tahoe 上是 32 点），没有标题栏的窗
/// 是 0。`contentLayoutRect` 给的正是没被标题栏盖住的那一块，和整扇窗户
/// 一减就是要补上的数。
#[tauri::command]
fn update_fit(window: tauri::Window, height: f64) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let w = window.clone();
        // **走 Tauri 的主线程队列，不走 GCD。**紧跟在这之后网页会把窗口
        // 亮出来，那一步排在同一条队列上；换一条队列，用户就会先看见一扇
        // 大小还没调好的窗
        window.run_on_main_thread(move || {
            let Ok(ptr) = w.ns_window() else { return };
            // SAFETY: `ns_window()` 给的是这扇窗的 NSWindow，这里在主线程上
            let ns = unsafe { &*ptr.cast::<objc2_app_kit::NSWindow>() };
            let titlebar = ns.frame().size.height - ns.contentLayoutRect().size.height;
            ns.setContentSize(objc2_foundation::NSSize::new(
                UPDATE_WIDTH,
                height + titlebar,
            ));
        })
    }
    #[cfg(not(target_os = "macos"))]
    window.set_size(tauri::LogicalSize::new(UPDATE_WIDTH, height))
}

/// 更新那条系统通知的键。点开它拉起的是更新窗口，不是主界面的某一页
pub(crate) const UPDATE_NOTICE: &str = "update";

/// 把查到的版本记下来。菜单里的「检查更新」跟着换成「安装新版本」
fn record(app: &tauri::AppHandle, found: Found) {
    *app.state::<Updates>().offer.lock().unwrap() = Some(found.clone());
    let _ = app.emit("update-found", found);
    if let Some(st) = app.try_state::<AppState>() {
        st.menubar.notify_one();
    }
}

/// 用户自己点了检查：查到了就把更新窗口拉起来 —— 他在等这个结果。
fn present(app: &tauri::AppHandle, found: Found) {
    record(app, found);
    if let Err(e) = show_update_window(app) {
        tracing::error!("更新窗口打不开：{e}");
    }
}

/// 自动检查查到了：**只发一条系统通知**，点开才拉起更新窗口。
///
/// 这一刻用户在做别的事；一扇自己冒出来、抢走焦点的窗口是打断，通知不是。
/// 选了「只在应用内」或关掉提醒的，就只剩菜单里那一项「安装新版本」和设置页。
fn notify_update(app: &tauri::AppHandle, found: Found) {
    let version = found.version.clone();
    record(app, found);
    if let Some(n) = app.try_state::<Arc<notices::Notices>>() {
        n.announce(
            UPDATE_NOTICE,
            &tr!(
                format!("ThinkWatch Lite {version} 可用"),
                format!("ThinkWatch Lite {version} Is Available")
            ),
            tr!("点按此通知进行更新。", "Click to update."),
        );
    }
}

/// 查到了、还没装的那一版（菜单里「安装新版本」要写版本号）
pub(crate) fn pending_update(app: &tauri::AppHandle) -> Option<String> {
    app.try_state::<Updates>()?
        .offer
        .lock()
        .ok()?
        .as_ref()
        .map(|f| f.version.clone())
}

/// 菜单里点了「安装新版本」：把更新窗口再拉起来
pub(crate) fn show_pending_update(app: &tauri::AppHandle) {
    if let Err(e) = show_update_window(app) {
        tracing::error!("更新窗口打不开：{e}");
    }
}

/// 菜单里的「检查更新…」和设置页的「立即检查」查的是同一处
pub(crate) async fn find_update(app: &tauri::AppHandle) -> Result<Option<Found>, String> {
    find(app).await
}

pub(crate) fn present_update(app: &tauri::AppHandle, found: Found) {
    present(app, found);
}

/// 「立即检查」。查到了就把更新窗口拉起来。
#[tauri::command]
async fn update_check(app: tauri::AppHandle) -> Out<Option<Found>> {
    let found = find(&app).await?;
    if let Some(f) = &found {
        present(&app, f.clone());
    }
    Ok(found)
}

/// 更新窗口打开时来读：要画的是哪一版、这一份该怎么装。
#[tauri::command]
fn update_pending(app: tauri::AppHandle) -> Option<OfferView> {
    let found = app.state::<Updates>().offer.lock().unwrap().clone()?;
    let install = update::kind();
    Some(OfferView {
        version: found.version,
        current: app.package_info().version.to_string(),
        install,
        command: (install == update::Install::Homebrew).then_some(update::BREW_UPGRADE),
    })
}

/// 把 Homebrew 的更新命令放进剪贴板。
///
/// **在 Rust 这边写，不用网页的剪贴板接口。**后者要看 webview 给不给写入
/// 权限，给不给、什么时候给，各个平台和版本不一样；被拒的时候它什么都不
/// 做 —— 而对一个「一键复制」的按钮，点了没反应是它唯一不能有的表现。
///
/// 命令由这里给出，不从界面传进来：webview 只能复制这一条，拿不到一个
/// 往剪贴板里写任意内容的口子。
#[tauri::command]
fn update_copy_command(app: tauri::AppHandle) -> Out<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(update::BREW_UPGRADE)
        .map_err(|e| e.to_string().into())
}

/// 重启之前在数据目录里留一句「从哪一版换过来的」，起来之后读它。
const UPDATED_FROM: &str = ".updated-from";

/// 等手上的请求结束，最多等多久。
///
/// 一次带长思考的回答流上一两分钟是常事；等得比这更久，多半是一直有新
/// 请求接上来 —— 那时候不重启，更新就永远不会发生，而用户按过「下载并
/// 安装」，他要的是它发生。
const DRAIN_LIMIT: std::time::Duration = std::time::Duration::from_secs(180);

/// 更新走到了哪一步。更新窗口按它换文案。
#[derive(Clone, serde::Serialize)]
#[serde(tag = "step", rename_all = "snake_case")]
enum Step {
    Downloading,
    Waiting { in_flight: usize },
    Installing,
    Restarting,
}

/// 等网关手上的请求都结束。
///
/// **重启会掐断所有还没结束的流**：一个正在吐字的 Claude Code 任务，那段
/// 输出就没了，那个请求得从头再发一次。等计数归零，重启就落在两个请求
/// 之间的空档里。
///
/// 问不到（core 不在跑、控制面没答应）就不等 —— 没有网关，也就没有要保护
/// 的请求。
async fn wait_for_quiet(app: &tauri::AppHandle, control: &ControlClient) {
    let started = std::time::Instant::now();
    let mut waited = false;
    loop {
        let s = match control.status().await {
            Ok(s) => s,
            Err(e) => {
                tracing::info!("更新：问不到网关的状态，不等（{e:#}）");
                return;
            }
        };
        if s.in_flight == 0 {
            if waited {
                tracing::info!("更新：请求都结束了，等了 {:?}", started.elapsed());
            }
            return;
        }
        if started.elapsed() >= DRAIN_LIMIT {
            tracing::warn!(
                "更新：等了 {DRAIN_LIMIT:?} 还有 {} 个请求没结束，照常重启",
                s.in_flight
            );
            return;
        }
        if !waited {
            tracing::info!(
                "更新：网关手上还有 {} 个请求，等它们结束再重启",
                s.in_flight
            );
            waited = true;
        }
        let _ = app.emit(
            "update-step",
            Step::Waiting {
                in_flight: s.in_flight,
            },
        );
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

/// 下载、等手上的请求结束、替换、重启。**按一次之后不再问任何问题。**
///
/// **Homebrew 装的一律拒绝。**理由在 `update` 模块开头。这里再挡一次，是
/// 因为这是一条策略 —— 只靠界面上那个按钮不显示来维持，等于让一次渲染的
/// 疏忽去降级用户的安装。
///
/// **先下载，再等，最后才替换。**反过来的话，磁盘上的包在等待的那几分钟
/// 里已经是新版本了 —— 这期间 core 万一退出，守护会从磁盘上拉起一个和
/// 正在运行的界面不是同一版的网关。
#[tauri::command]
async fn update_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    hub: tauri::State<'_, Updates>,
) -> Out<()> {
    use std::sync::atomic::Ordering;
    use tauri_plugin_updater::UpdaterExt;

    let install = update::kind();
    if !install.can_self_update() {
        return Err(match install {
            update::Install::Homebrew => tr!(
                format!(
                    "此应用由 Homebrew 管理，请在终端中执行：{}",
                    update::BREW_UPGRADE
                ),
                format!(
                    "This app is managed by Homebrew. Run this command in Terminal: {}",
                    update::BREW_UPGRADE
                )
            )
            .into(),
            _ => tr!(
                "开发构建不执行自动更新",
                "Development builds do not update automatically"
            )
            .into(),
        });
    }
    if hub.installing.swap(true, Ordering::SeqCst) {
        return Err(tr!("更新正在进行中", "An update is already in progress").into());
    }
    // 中途失败要把标记放回去，否则再点一次会被当成「已经在进行中」
    struct Release<'a>(&'a std::sync::atomic::AtomicBool);
    impl Drop for Release<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _release = Release(&hub.installing);

    let up = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| tr!("已是最新版本", "Already up to date").to_string())?;

    let _ = app.emit("update-step", Step::Downloading);
    let h = app.clone();
    let bytes = up
        .download(
            move |chunk, total| {
                let _ = h.emit("update-progress", (chunk, total));
            },
            || {},
        )
        .await
        .map_err(|e| tr!(format!("下载失败：{e}"), format!("Download failed: {e}")))?;
    // 发布页上只有 DMG，插件只装 `.app.tar.gz` —— 见 `dmg`。放在等请求之前：
    // 包打不开的话，不该先让用户白等几分钟
    #[cfg(target_os = "macos")]
    let bytes = tauri::async_runtime::spawn_blocking(move || dmg::app_archive(&bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| {
            tr!(
                format!("无法打开更新包：{e}"),
                format!("The update could not be opened: {e}")
            )
        })?;

    wait_for_quiet(&app, &state.control).await;

    let _ = app.emit("update-step", Step::Installing);
    // 起来之后说一声换到了哪一版。写不进去不影响更新本身。
    let marker = data_dir().join(UPDATED_FROM);
    let from = app.package_info().version.to_string();

    // **Windows 上 `install` 不回来。**插件拉起新版本的安装程序之后当场
    // `exit(0)`，排在它后面的每一步都轮不到 —— 所以标记和停 core 都得挪到
    // 它前面。停 core 在那边还是硬要求：`twcore.exe` 还在跑的话，安装程序
    // 覆盖不了一个被占用的文件。
    #[cfg(windows)]
    {
        let _ = std::fs::write(&marker, &from);
        let _ = app.emit("update-step", Step::Restarting);
        state
            .supervisor
            .stop_and_wait(std::time::Duration::from_secs(5))
            .await;
        if let Err(e) = up.install(&bytes) {
            // 最常见的是 UAC 那一下点了「否」。**把刚才做的两件事都撤回来**：
            // 不撤的话，网关就这么停着，而下次启动还会说一句没发生过的「已更新」。
            let _ = std::fs::remove_file(&marker);
            resume_after_failed_update(&app).await;
            return Err(tr!(
                format!("安装失败：{e}"),
                format!("Installation failed: {e}")
            )
            .into());
        }
        // 走到这里说明插件没有照它自己说的那样退出。那就和其他平台一样，自己重启
    }
    #[cfg(not(windows))]
    {
        up.install(&bytes).map_err(|e| {
            tr!(
                format!("安装失败：{e}"),
                format!("Installation failed: {e}")
            )
        })?;
        let _ = std::fs::write(&marker, &from);
        let _ = app.emit("update-step", Step::Restarting);
        // 先停掉 core、等它真的退出，再重启应用 —— 否则新起来的应用会先撞上
        // 旧 core 手里的锁。见 `Supervisor::stop_and_wait`。
        state
            .supervisor
            .stop_and_wait(std::time::Duration::from_secs(5))
            .await;
    }
    app.restart()
}

/// 更新没装成，把为它停掉的网关接回来。
///
/// **先等守护循环真的退干净。**`stop_and_wait` 在 core 翻成「已停止」时就
/// 返回了，而循环要再走一步才把「正在守护」放下；这之间去拉，会被当成
/// 「守护还在，重启一下」，然后因为 core 不在跑而什么也不做。
#[cfg(windows)]
async fn resume_after_failed_update(app: &tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    let state = app.state::<AppState>();
    for _ in 0..40 {
        if !state.supervising.load(Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    if let Err(e) = restart_gateway(app).await {
        tracing::error!("更新没装成，网关也没能接回来：{e}");
    }
}

/// 上一次是被更新重启的话，说一声换到了哪一版。
///
/// **只在版本真的变了时说。**标记是重启之前写下的；替换没成功、起来的
/// 还是原来那一版的话，这句话就是假的。
fn announce_update(app: &tauri::AppHandle) {
    use tauri_plugin_notification::NotificationExt;
    let marker = data_dir().join(UPDATED_FROM);
    let Ok(from) = std::fs::read_to_string(&marker) else {
        return;
    };
    let _ = std::fs::remove_file(&marker);
    let now = app.package_info().version.to_string();
    let from = from.trim();
    if from.is_empty() || from == now {
        return;
    }
    let _ = app
        .notification()
        .builder()
        .title(tr!(format!("已更新到 {now}"), format!("Updated to {now}")))
        .body(tr!(
            format!("ThinkWatch Lite 已从 {from} 更新到 {now}。"),
            format!("ThinkWatch Lite was updated from {from} to {now}.")
        ))
        .show();
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
    if !matches!(app.autolaunch().is_enabled(), Ok(true)) {
        return false;
    }
    // **插件说「开着」还不够。**Windows 的「设置 → 应用 → 启动」里关掉之后，
    // 我们在 `Run` 下那一项原封不动，而插件只看那一项在不在 —— 见
    // `autostart::disabled_by_windows`。
    //
    // 键名问 `package_info().name` 要，**和插件写进去时用的是同一个来源**
    // （它就是这么取的），不是照着猜一个。
    #[cfg(windows)]
    if autostart::disabled_by_windows(&app.package_info().name) == Some(true) {
        return false;
    }
    true
}

/// 开或关开机自启。
///
/// 返回**实际生效的状态**而不是调用方传进来的那个 —— 注册可能失败
/// (沙盒、权限、只读的 LaunchAgents 目录),那时勾选框必须弹回去。
/// 回一个 `Ok(())` 让界面自己乐观地打上勾,是这类开关最常见的骗人方式。
#[tauri::command]
fn set_autostart(app: tauri::AppHandle, on: bool) -> Out<bool> {
    if !autostart::allowed_in_this_build() {
        return Err(tr!(
            "开发构建不支持开机启动",
            "Launch at login is not available in development builds"
        )
        .into());
    }
    use tauri_plugin_autostart::ManagerExt;
    // **插件不建目录。**它把 plist 直接写进 `~/Library/LaunchAgents/`，
    // 而那个目录在一台从没注册过登录项的 Mac 上根本不存在 —— 写文件
    // 得到的是 `No such file or directory (os error 2)`，一句既不说
    // 哪个文件、也不说该怎么办的话。
    //
    // 这不是边角情况：全新系统、新建用户、以及任何 HOME 被换掉的运行
    // 环境都会撞上。所以自己先建。
    if on
        && let Some(plist) = autostart::plist_path(&app.config().identifier)
        && let Some(dir) = plist.parent()
    {
        std::fs::create_dir_all(dir).map_err(|e| {
            tr!(
                format!("无法创建目录 {}：{e}", dir.display()),
                format!("The directory {} could not be created: {e}", dir.display())
            )
        })?;
    }
    let mgr = app.autolaunch();
    let r = if on { mgr.enable() } else { mgr.disable() };
    r.map_err(|e| format!("{e}"))?;
    Ok(matches!(mgr.is_enabled(), Ok(true)))
}

pub fn run() {
    let builder = tauri::Builder::default();
    // **单实例要第一个注册**，插件自己的文档如此要求：它得在别的插件把端口、
    // socket、注册表项占上之前就判断出「已经有一个在跑」。
    //
    // macOS 不注册它：同一个 bundle 由系统保证只跑一份，点第二次 Dock 图标
    // 发的是 `RunEvent::Reopen`。别处没有这个保证 ——
    //
    // - 托盘里开着，用户又去开始菜单点一下 → 第二个进程、两个托盘图标、
    //   两个 core 抢同一把锁；
    // - `thinkwatch://` 被 shell 拉起来时（授权回调，以后还有点开通知），
    //   deep-link 要靠它把 URL 转给已经在跑的那个实例。没有它，每点一次
    //   就新起一个进程，而那个进程起来之后发现锁被占着。
    //
    // `deep-link` 这个特性让插件把第二个实例 argv 里的 URL 交回
    // `on_open_url` —— 和第一次启动走同一条路径，不是另开一条。
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        // 已经有一个在跑：把它叫到前面来。**用户点第二次，想要的是看见它**，
        // 不是被告知它已经开着。
        let _ = show_main_window(app);
    }));
    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            // LaunchAgent 模式：往 ~/Library/LaunchAgents 写一个 plist。
            // 不是 SMAppService、也不是登录项 API —— 插件在 macOS 上就是
            // 写文件（读过源码）。
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // 注册时塞这个标记，启动时靠它判断是不是开机拉起来的。
            Some(vec![autostart::AUTOSTART_FLAG]),
        ))
        .invoke_handler(tauri::generate_handler![
            call::call,
            core_status,
            core_state,
            reveal_main_window,
            restart_core,
            dashboard,
            upstreams::upstream_stats,
            notices_list,
            mark_notice_read,
            mark_all_notices_read,
            clear_notices,
            notice_mode,
            set_notice_mode,
            menubar_style,
            set_menubar_style,
            take_pending_view,
            keys::copy_key,
            keys::copy_gateway_base,
            keys::key_usage,
            chatgpt::start_chatgpt_login,
            chatgpt::reopen_chatgpt_login,
            chatgpt::copy_chatgpt_code,
            chatgpt::cancel_chatgpt_login,
            zai::start_zai_login,
            zai::reopen_zai_login,
            zai::cancel_zai_login,
            app_info,
            update_state,
            set_update_check,
            app_language,
            set_language,
            app_theme,
            set_theme,
            update_check,
            update_pending,
            update_fit,
            update_copy_command,
            update_install,
            autostart_enabled,
            set_autostart,
            restore_all,
            uninstall,
            clients::copy_client_endpoint,
            clients::reveal_client_config,
            save_diagnostics,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // **语言最先定。**托盘、通知、窗口都要用它，而它们在下面陆续出现
            let saved = prefs::load(&data_dir());
            i18n::set(i18n::effective(saved.language));
            // 外观在窗口出现之前就设好，不然会先画一帧系统那一档的颜色。
            // 跟随系统（`None`）时什么都不做：那本来就是默认行为
            if saved.theme.is_some() {
                theme::apply(&handle, saved.theme);
            }
            // **找不到 core 也要把窗口开起来。**这里原来是 `?` ——
            // 而它把「找不到一个文件」变成了「应用打不开」。
            let located = locate_core(&handle);
            // 控制面听在哪由平台决定，凭据这一次启动生成一个。**两样都只在
            // 这里定一次**，守护拿它去 spawn core，客户端拿它去连。
            let at = control_address();
            let token = token::generate();
            // 起好了没有，问控制面：`/status` 答得上来才算。半秒答不上这一次就
            // 算没答应，守护隔一会儿再问
            let ready = {
                let (at, token) = (at.clone(), token.clone());
                supervisor::probe(move || {
                    let control = ControlClient::new(at.clone(), token.clone());
                    async move {
                        control
                            .ping(std::time::Duration::from_millis(500))
                            .await
                            .is_ok()
                    }
                })
            };
            let sup = Arc::new(
                Supervisor::new(
                    located
                        .as_ref()
                        .cloned()
                        .unwrap_or_else(|_| PathBuf::from(CORE_EXE)),
                    None,
                    ready,
                    at.clone(),
                    token.clone(),
                )
                .with_user_env(),
            );
            let supervising = Arc::new(std::sync::atomic::AtomicBool::new(false));

            app.manage(Updates::default());
            // 上一次是被更新重启的话，现在说一声
            announce_update(&handle);

            // 通知总线。**判定在这里，不在界面** —— 关窗即销毁 webview
            // 系统通知：装好的应用用原生的（能原地更新、撤回、点开落到对应页面），
            // `tauri dev` 这种不在应用包里的退回插件
            #[cfg(target_os = "macos")]
            let system: Box<dyn notices::Sink> = if notices::macos::available() {
                notices::macos::install(handle.clone());
                Box::new(notices::macos::NativeSink)
            } else {
                Box::new(notices::SystemSink::new(handle.clone()))
            };
            // Windows 上「装好的」是指开始菜单里有带 AUMID 的快捷方式，见 `notices::windows`。
            // 点开走协议激活（下面的 `on_open_url`），不用在这里接回调
            #[cfg(windows)]
            let system: Box<dyn notices::Sink> = if notices::windows::available(&handle) {
                Box::new(notices::windows::NativeSink::new(handle.clone()))
            } else {
                Box::new(notices::SystemSink::new(handle.clone()))
            };
            #[cfg(not(any(target_os = "macos", windows)))]
            let system: Box<dyn notices::Sink> = Box::new(notices::SystemSink::new(handle.clone()));
            // 菜单栏在通知列表一变时要重画：它也是通知总线的一个投递端
            let menubar_wake = Arc::new(tokio::sync::Notify::new());
            let notices = notices::Notices::new(
                vec![
                    Box::new(notices::sink::AppSink::new(handle.clone())),
                    Box::new(menubar::Wake(menubar_wake.clone())),
                    system,
                ],
                Some(data_dir()),
                saved.notices,
            );
            app.manage(notices.clone());
            app.manage(AppState {
                control: ControlClient::new(at.clone(), token.clone()),
                supervisor: sup.clone(),
                core_missing: located.as_ref().err().map(|e| format!("{e:#}")),
                supervising: supervising.clone(),
                menubar: menubar_wake,
                menubar_now: Arc::new(tokio::sync::Notify::new()),
                tally: Default::default(),
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
                        if let Some(n) = h.try_state::<Arc<notices::Notices>>() {
                            n.on_core_state(&now);
                        }
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
            menubar::install(&handle)?;

            // 心跳。三信号里最慢的那条，但**唯一能抓到「活着但卡死」**
            // —— 一个死锁的进程既不退出也不关 socket，前两条信号都看
            // 不见它，而它对用户的表现和挂了一模一样。
            let h = handle.clone();
            let (at2, tok2) = (at.clone(), token.clone());
            tauri::async_runtime::spawn(async move {
                heartbeat_loop(at2, tok2, sup, h).await;
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
            #[cfg(all(target_os = "macos", debug_assertions))]
            if memcheck::requested(std::env::args()) {
                memcheck::run(handle.clone());
            }

            // `thinkwatch://` 被点开：浏览器里授权完成之后的「返回 ThinkWatch」，
            // 和 Windows 上点了一条 toast（`thinkwatch://notice/<键>`）。
            // **窗口这时可能根本不存在**（菜单栏模式下关窗即销毁）
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let h = handle.clone();
                handle.deep_link().on_open_url(move |event| {
                    let urls: Vec<String> = event.urls().iter().map(|u| u.to_string()).collect();
                    open_urls(&h, &urls);
                });
                // **被这个链接拉起来的那一次**：插件初始化时就把它发出去了，那时这里还
                // 没在听，只剩 `get_current` 里存着的一份。点一条 toast 时应用没在跑，
                // 就是这种情况。macOS 的链接在启动之后才到，这里取到的是空的
                if let Ok(Some(urls)) = handle.deep_link().get_current() {
                    let urls: Vec<String> = urls.iter().map(|u| u.to_string()).collect();
                    open_urls(&handle, &urls);
                }
            }

            // 事件桥：控制面的 SSE → Tauri 事件 → 前端。
            let h = handle.clone();
            let (at3, tok3) = (at.clone(), token.clone());
            tauri::async_runtime::spawn(async move {
                bridge_events(at3, tok3, h).await;
            });

            // 有没有新版本。**循环无条件起，开关在循环里读** —— 用户在
            // 运行中打开自动检查时，不该要求他重启应用才生效。
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                update_loop(h).await;
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
                let closing = window.label().to_string();
                let _ = window.destroy();
                // **只有最后一个窗口关掉时才退回菜单栏应用。**更新窗口关掉
                // 的时候主窗口可能还开着 —— 那时把 Dock 图标收掉，用户就没法
                // 用 ⌘Tab 切回那个窗口了。
                #[cfg(target_os = "macos")]
                if app.webview_windows().keys().all(|l| *l == closing) {
                    become_accessory(&app);
                }
                #[cfg(not(target_os = "macos"))]
                let _ = (&app, &closing);
            }
        })
        .build(tauri::generate_context!())
        .expect("Tauri 起不来")
        .run(|app, event| {
            // Dock 和 ⌘Tab 是 macOS 的概念，下面那一段只在那里有事做。
            #[cfg(not(target_os = "macos"))]
            let _ = app;
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
                }
            }
        });
}

/// 心跳循环。
async fn heartbeat_loop(
    at: tw_api::control::Address,
    token: String,
    sup: Arc<Supervisor>,
    app: tauri::AppHandle,
) {
    use supervisor::{HealthTracker, Verdict, health};
    let client = ControlClient::new(at, token);
    let mut tracker = HealthTracker::new();

    loop {
        tokio::time::sleep(health::INTERVAL).await;

        // 只在 core 应该在跑的时候探。启动中、重启中、安全模式下探测
        // 失败是**预期的**，把它算进连续失败会让守护自己制造重启循环。
        // 「运行中」是控制面答应了之后才报的，这时候探不到就是真的没回话
        if !matches!(sup.state(), CoreState::Running { .. }) {
            tracker.reset();
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
                // 自己好了的一次卡顿不打断人（和偶发崩溃一个待遇），但在提醒列表里
                // 留一条：用户那几秒看到的失败，要有地方说得清是为什么
                if let Some(n) = app.try_state::<Arc<notices::Notices>>() {
                    n.ingest(notices::rules::wedged(), notices::now_ms());
                }
                if let Err(e) = sup.report_wedged().await {
                    tracing::debug!("换掉卡死的 core 失败：{e:#}");
                }
                // 杀完就清零，等它重起来再重新计数。
                tracker.reset();
            }
        }
    }
}

/// 把控制面的事件流搬给前端。
///
/// 断线就重连，但**退避要克制**：core 重启期间 socket 必然连不上，这是
/// 预期状态而不是故障。1 秒一次的重试既不会刷屏，也不会让用户在 core
/// 恢复后还盯着一个空列表等太久。
///
/// **重新连上时补报一条「丢过事件」**（`EventsDropped`，条数记 0：丢了多少不知道）。
/// 断开的那一段里发生的事，事件流不会再说一遍 —— 界面和菜单栏要各自对一次账，
/// 否则那段时间里结束的请求，会一直显示成进行中。
async fn bridge_events(at: tw_api::control::Address, token: String, app: tauri::AppHandle) {
    let mut connected_before = false;
    loop {
        let client = ControlClient::new(at.clone(), token.clone());
        let opened = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (a, b, o) = (app.clone(), app.clone(), opened.clone());
        let resumed = connected_before;
        let r = client
            .subscribe_events(
                move || {
                    o.store(true, std::sync::atomic::Ordering::SeqCst);
                    if resumed {
                        let lost = tw_api::Event::EventsDropped {
                            id: 0,
                            count: 0,
                            at_ms: notices::now_ms(),
                        };
                        resync_tally(&b);
                        let _ = b.emit("core-event", &lost);
                    }
                },
                move |ev| {
                    // **在客户端弹批准提示的同一瞬间弹一条通知**。
                    // 这是网关位置独有的能力：只有我们同时知道「这个调用长
                    // 什么样」和「它来自哪个上游」。用户看到批准提示的同时
                    // 看到这条，判断质量完全不一样。
                    if let Some(n) = a.try_state::<Arc<notices::Notices>>() {
                        n.on_event(&ev);
                    }
                    if let Some(st) = a.try_state::<AppState>() {
                        if let Ok(mut t) = st.tally.lock() {
                            t.on_event(&ev, std::time::Instant::now());
                        }
                        // 菜单栏上那几个数只跟这几种事件有关：花了多少（请求
                        // 落地之后存储层才算得出来）、额度还剩多少、进行中几个。
                        // 别的事件叫醒它只是让它白跑一趟。
                        if matches!(
                            ev,
                            tw_api::Event::RequestStarted { .. }
                                | tw_api::Event::RequestFinished { .. }
                                | tw_api::Event::RequestFailed { .. }
                                | tw_api::Event::RequestCancelled { .. }
                                | tw_api::Event::QuotaSeen { .. }
                                | tw_api::Event::ConfigReloaded { .. }
                        ) {
                            st.menubar.notify_one();
                        }
                    }
                    // core 说这个订阅者掉过队：进行中的那几个按快照重数
                    if matches!(ev, tw_api::Event::EventsDropped { .. }) {
                        resync_tally(&a);
                    }
                    let _ = a.emit("core-event", &ev);
                },
            )
            .await;
        if let Err(e) = r {
            tracing::debug!("事件流断开：{e:#}");
        }
        // 接通过才算连上过：core 重启期间那几轮连不上的不算
        connected_before |= opened.load(std::sync::atomic::Ordering::SeqCst);
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
}

/// 菜单栏上「进行中几个」按 core 的快照重数一遍（`/in-flight`）。
///
/// **先开始记账再去问**：问的这会儿开始、结束的请求记在一边，快照到了一起合进去
/// （见 `Tally::finish_resync`）。
fn resync_tally(app: &tauri::AppHandle) {
    let Some(st) = app.try_state::<AppState>() else {
        return;
    };
    if let Ok(mut t) = st.tally.lock() {
        t.begin_resync();
    }
    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(st) = a.try_state::<AppState>() else {
            return;
        };
        let Ok(open) = st.control.call::<ep::InFlight>(&[], &()).await else {
            if let Ok(mut t) = st.tally.lock() {
                t.abandon_resync();
            }
            return;
        };
        let running = open.iter().filter_map(tally::Running::of);
        if let Ok(mut t) = st.tally.lock() {
            t.finish_resync(running);
        }
        st.menubar.notify_one();
    });
}

/// 第一次检查之前先等一会儿。
///
/// **不在启动那一刻查。**冷启动那几秒 CPU 和网络都在忙别的 —— 网关要起
/// 来、控制面要连上；而「有没有新版本」晚两分钟知道，没有任何损失。
const UPDATE_FIRST_LOOK: std::time::Duration = std::time::Duration::from_secs(120);

/// 此后一天查一次。**版本不会一天发好几次**，查得更勤只是多几次请求。
///
/// 点过「稍后」的版本，在下一次检查时再提 —— 也就是一天之后。
const UPDATE_EVERY: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

/// 自动检查。查到了就发一条系统通知。
///
/// **开发构建不自己去查。**每次 `tauri dev` 之后两分钟弹一个窗，写代码的
/// 人学会的只是把它关掉。「立即检查」在开发构建里照样能用。
async fn update_loop(app: tauri::AppHandle) {
    tokio::time::sleep(UPDATE_FIRST_LOOK).await;
    loop {
        // 每一轮都重读设置 —— 用户可能在跑着的时候把它关了，那时这个
        // 循环要立刻听话，而不是等到下次启动。
        if update::kind() != update::Install::Dev && prefs::load(&data_dir()).check_updates {
            match find(&app).await {
                Ok(Some(f)) => notify_update(&app, f),
                Ok(None) => {}
                // 查不到就下次再说。**不告诉用户** —— 网络不通不是他此刻
                // 要处理的事，而一句「检查更新失败」只会打断他在做的事。
                Err(e) => tracing::debug!("检查更新：{e}"),
            }
        }
        tokio::time::sleep(UPDATE_EVERY).await;
    }
}

/// 现在挂着的通知。**关窗期间发生的事也在里面** —— 判定在 Rust 侧，界面来取
#[tauri::command]
fn notices_list(notices: tauri::State<'_, Arc<notices::Notices>>) -> Vec<notices::Notice> {
    notices.list()
}

/// 用户看过了一条。**它还留在列表里**，只是铃铛不再数它
#[tauri::command]
fn mark_notice_read(notices: tauri::State<'_, Arc<notices::Notices>>, key: String) {
    notices.mark_read(&key);
}

/// 全部看过了
#[tauri::command]
fn mark_all_notices_read(notices: tauri::State<'_, Arc<notices::Notices>>) {
    notices.mark_all_read();
}

/// 清空提醒列表
#[tauri::command]
fn clear_notices(notices: tauri::State<'_, Arc<notices::Notices>>) {
    notices.clear_all();
}

/// 点通知新建的窗口挂上之后，来取要落的那一页
#[tauri::command]
fn take_pending_view() -> Option<String> {
    notices::take_pending_view()
}

/// 提醒现在是哪一档
#[tauri::command]
fn notice_mode(notices: tauri::State<'_, Arc<notices::Notices>>) -> notices::Mode {
    notices.mode()
}

/// 换一档。**先存盘再生效**：存不进去的话，界面弹回去，总线也还是原来那一档。
/// 工具栏的铃铛听 `notice-mode-changed` —— 关掉之后它不该还在那儿
#[tauri::command]
fn set_notice_mode(
    app: tauri::AppHandle,
    notices: tauri::State<'_, Arc<notices::Notices>>,
    mode: notices::Mode,
) -> Out<notices::Mode> {
    prefs::update(&data_dir(), |p| p.notices = mode).map_err(|e| {
        tr!(
            format!("无法保存设置：{e:#}"),
            format!("The setting could not be saved: {e:#}")
        )
    })?;
    notices.set_mode(mode);
    let _ = app.emit("notice-mode-changed", mode);
    Ok(mode)
}

/// 菜单栏上显示什么
#[tauri::command]
fn menubar_style() -> menubar::Style {
    menubar::style()
}

/// 换一档。**先存盘再生效**，和提醒那一档一样；改完菜单栏立刻重画
#[tauri::command]
fn set_menubar_style(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    style: menubar::Style,
) -> Out<menubar::Style> {
    prefs::update(&data_dir(), |p| p.menubar = style).map_err(|e| {
        tr!(
            format!("无法保存设置：{e:#}"),
            format!("The setting could not be saved: {e:#}")
        )
    })?;
    menubar::set_style(style);
    state.menubar_now.notify_one();
    let _ = app.emit("menubar-style-changed", style);
    Ok(style)
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
    // 窗口这时没开：只有系统通知说得到
    if let Some(n) = app.try_state::<Arc<notices::Notices>>() {
        // Windows 上没有菜单栏，图标在任务栏右侧的通知区域
        #[cfg(windows)]
        let (title, body) = (
            tr!(
                "ThinkWatch 已在通知区域运行",
                "ThinkWatch Is Running in the Notification Area"
            ),
            tr!(
                "开机时已自动启动。窗口关闭后，应用仍在通知区域中运行。",
                "It started at login. When the window is closed, the app keeps running in the notification area."
            ),
        );
        #[cfg(not(windows))]
        let (title, body) = (
            tr!(
                "ThinkWatch 已在菜单栏运行",
                "ThinkWatch Is Running in the Menu Bar"
            ),
            tr!(
                "开机时已自动启动。窗口关闭后，应用仍在菜单栏中运行。",
                "It started at login. When the window is closed, the app keeps running in the menu bar."
            ),
        );
        n.announce("autostart", title, body);
    }
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

/// 分拣一批 `thinkwatch://` 链接：点开通知的落到那一条的页面，其余的交给授权回调
fn open_urls(app: &tauri::AppHandle, urls: &[String]) {
    let mut rest = Vec::new();
    for url in urls {
        match notices::key_from_url(url) {
            Some(key) => notices::open_from_notification(app, &key),
            None => rest.push(url.clone()),
        }
    }
    chatgpt::handle_return(app, &rest);
}

/// 主窗口用时才建。
///
/// **「根本不创建」不是「创建后隐藏」**：后者省不了内存也省不了
/// 启动时间，而且窗口会有一帧闪烁 —— 开机的时候屏幕上什么都不该出现。
///
/// **热启动先藏着建。**关窗即销毁 webview，所以重开窗口页面要重新加载一次。
/// 开窗时 core 已经在跑（关了再开，或者开机自启之后第一次点开），启动画面
/// 就没什么可说的了：窗口建好先不露面，首屏的数据取好了界面调
/// `reveal_main_window` 再出现 —— 一出现就是完整的界面，数字也是对的。
/// 数据迟迟不到也只等 [`WARM_REVEAL_CAP`]，之后交给那一页自己的骨架。
///
/// 冷启动（core 还没到运行中）照旧马上出现，由启动画面说网关走到了哪一步。
pub(crate) fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("main") {
        // 热启动还藏着的时候又点了一次，也是这里：不等了，直接出来
        return reveal(app, &w);
    }
    let warm = app
        .try_state::<AppState>()
        .is_some_and(|s| matches!(s.supervisor.state(), CoreState::Running { .. }));
    let b = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("ThinkWatch Lite")
        .initialization_script(format!(
            "{} window.__TW_WARM__ = {warm};",
            i18n::init_script()
        ))
        .inner_size(1100.0, 720.0)
        .min_inner_size(820.0, 560.0)
        .visible(!warm);
    // 把内容顶到标题栏里、藏掉标题：**这两样只有 macOS 有**，那里红绿灯
    // 浮在内容上，界面顶部那几处 `data-tauri-drag-region` 就是为它留的。
    // Windows 上用系统标题栏，所以那些留白按平台去掉了（见 App.tsx 里用
    // `isMac` 分开的那几处）—— 不去的话顶上会多出一条空的。
    #[cfg(target_os = "macos")]
    let b = b
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let w = b.build()?;
    if !warm {
        return reveal(app, &w);
    }
    // 保底放在这边，不交给页面：页面加载出了岔子就永远不会来叫
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(WARM_REVEAL_CAP).await;
        if let Some(w) = app.get_webview_window("main")
            && !w.is_visible().unwrap_or(true)
        {
            let _ = reveal(&app, &w);
        }
    });
    Ok(())
}

/// 热启动最多藏多久。点了之后超过这个数还没反应，会被当成没点中
const WARM_REVEAL_CAP: std::time::Duration = std::time::Duration::from_millis(300);

/// 热启动的界面首屏取好了，让窗口出现。
///
/// **已经出现了就什么都不做。**保底先到的话窗口已经在了，用户可能已经切到
/// 别的应用 —— 这时再 `set_focus` 就是抢焦点。
#[tauri::command]
fn reveal_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let Some(w) = app.get_webview_window("main") else {
        return Ok(());
    };
    if w.is_visible().unwrap_or(false) {
        return Ok(());
    }
    reveal(&app, &w).map_err(|e| e.to_string())
}

fn reveal(app: &tauri::AppHandle, w: &tauri::WebviewWindow) -> tauri::Result<()> {
    // 有窗口了就该出现在 Dock 和 ⌘Tab 里
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    w.show()?;
    w.set_focus()
}

/// 没有窗口时退回菜单栏应用：不占 Dock、不进 ⌘Tab。
#[cfg(target_os = "macos")]
fn become_accessory(app: &tauri::AppHandle) {
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

/// 数据目录。
///
/// **问契约层要，不自己算。**core 和这里必须落到同一个目录 —— 端口文件、凭据、
/// 配置都在里面。以前这里自己只看 `HOME`，Windows 上那个变量默认不存在，于是
/// 落到当前目录下的 `.thinkwatch`，而 core 在 `%APPDATA%\ThinkWatch`：界面找不到
/// 一个正在跑的网关。`THINKWATCH_HOME` 照旧最优先（测试靠它隔离）。
pub(crate) fn data_dir() -> PathBuf {
    tw_api::data::dir()
}

/// 控制面听在哪。
///
/// **问契约层要，不自己拼。**以前这里是 `data_dir().join("twcore.sock")`，
/// 而 core 那边也拼一次 —— 两份能对上只是因为那一行短到不容易写错。
/// Windows 上这个答案要分岔（那里没有 unix socket），两份各写一次就是两份
/// 会漂，而漂掉的表现是界面连不上一个正在跑的网关。
fn control_address() -> tw_api::control::Address {
    tw_api::control::Address::in_dir(&data_dir())
}

/// 起、看着、它死了、按策略决定下一步。
async fn supervise(sup: Arc<Supervisor>, app: tauri::AppHandle) {
    // 接起一条新的守护循环，意思就是要 core 跑着。之前为了退出（或者为了
    // 一次没装成的更新）停过它的话，那个「按要求停止」的记号不能留到这一条
    // 里来 —— 留着的话，这之后 core 每一次崩溃都会被当成按要求停止
    sup.resume();
    let mut safe = false;
    loop {
        // 每一次转换都随 `core-state` 推给界面（见 setup 里那一段），这里不再另发
        match sup.run_once(safe).await {
            Ok(supervisor::Next::Again) => continue,
            Ok(supervisor::Next::Stop) => break,
            Ok(supervisor::Next::SafeMode) => {
                // 进安全模式：**必须打断用户并自动开窗**。这时候网关
                // 已经不转发了，他所有的 AI 客户端都在瞎。
                safe = true;
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                continue;
            }
            Err(e) => {
                // 起不来（多半是二进制路径不对）。这不是「core 在崩」，
                // 别用重启循环去掩盖它：守护停下，状态是 `Failed`，界面上
                // 说原因、给重试
                tracing::error!("core 起不来：{e:#}");
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 诊断包从建出来那一刻就只有属主能读；同一秒再写一次也照样是 0600、内容是新的
    #[test]
    fn the_diagnostics_file_is_private_from_the_start_and_can_be_rewritten() {
        let dir = std::env::temp_dir().join(format!("tw-diag-{}", token::generate()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("diagnostics-1.md");
        write_private(&path, b"first").unwrap();
        write_private(&path, b"second").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

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
