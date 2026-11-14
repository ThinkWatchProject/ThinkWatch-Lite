//! macOS 的菜单统一由一个始终保持 Accessory 的进程持有。
//!
//! 主应用开窗后变成 Regular；27.2 上它的原生菜单能收到点击，却可能不能显示在别的
//! 应用的全屏 Space 中。子进程复用 `macos` 的画法，只收快照、回传动作，不启动 Tauri、
//! 不读取用户数据、不连接 core。两根匿名管道随主进程关闭，EOF 直接结束子进程。

use std::io::{self, BufRead, Write};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use anyhow::Context;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::watch;

use super::{macos, model};
use crate::{i18n, theme};

const ARG: &str = "--menubar-helper";
const MAX_PACKET: usize = 4 * 1024 * 1024;
const RETRY: Duration = Duration::from_secs(3);

static FRAMES: OnceLock<watch::Sender<Option<Frame>>> = OnceLock::new();
static THEME: Mutex<Option<theme::Theme>> = Mutex::new(None);

/// 只传模型的输入，子进程按同一份代码产生菜单，图标和静态文案不用另造一套协议。
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Frame {
    snapshot: model::Snapshot,
    style: model::Style,
    lang: i18n::Lang,
    theme: Option<theme::Theme>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
enum Event {
    Open(bool),
    Action(model::Action),
}

pub fn install(app: &tauri::AppHandle) -> anyhow::Result<()> {
    let exe = std::env::current_exe().context("找不到菜单栏子进程的程序路径")?;
    let (tx, mut rx) = watch::channel(None);
    FRAMES
        .set(tx)
        .map_err(|_| anyhow::anyhow!("菜单栏子进程已经启动"))?;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(error) = session(&exe, &app, &mut rx).await {
                tracing::warn!(%error, "菜单栏子进程退出，稍后重建");
            }
            super::set_open(&app, false);
            // 重建时重发最新快照；菜单没开、没有请求时也能恢复，不依赖下一个业务事件。
            tokio::time::sleep(RETRY).await;
        }
    });
    Ok(())
}

pub fn present(snapshot: &model::Snapshot, style: model::Style) {
    if let Some(tx) = FRAMES.get() {
        tx.send_replace(Some(Frame {
            snapshot: snapshot.clone(),
            style,
            lang: i18n::current(),
            theme: *THEME.lock().expect("锁未中毒"),
        }));
    }
}

pub fn hide() {
    if let Some(tx) = FRAMES.get() {
        tx.send_modify(|frame| {
            if let Some(frame) = frame {
                frame.style = model::Style::Hidden;
            }
        });
    }
}

/// 初始化外观发生在 install 之前；先记住，以后的修改也立即推送，空闲时同样生效。
pub fn set_theme(theme: Option<theme::Theme>) {
    *THEME.lock().expect("锁未中毒") = theme;
    if let Some(tx) = FRAMES.get() {
        tx.send_modify(|frame| {
            if let Some(frame) = frame {
                frame.theme = theme;
            }
        });
    }
}

async fn session(
    exe: &std::path::Path,
    app: &tauri::AppHandle,
    frames: &mut watch::Receiver<Option<Frame>>,
) -> anyhow::Result<()> {
    let mut child = tokio::process::Command::new(exe)
        .arg(ARG)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()?;
    let mut input = child.stdin.take().expect("已请求 stdin 管道");
    let mut output = BufReader::new(child.stdout.take().expect("已请求 stdout 管道"));
    let write = async {
        loop {
            // 只保留最新一帧。管道暂时堵塞时不堆积过期的速度、额度和请求列表。
            let frame = frames.borrow_and_update().clone();
            if let Some(frame) = frame {
                input.write_all(&packet(&frame)?).await?;
                input.flush().await?;
            }
            if frames.changed().await.is_err() {
                return Ok::<(), anyhow::Error>(());
            }
        }
    };
    let read = async {
        while let Some(event) = read_async::<Event>(&mut output).await? {
            match event {
                Event::Open(open) => super::set_open(app, open),
                Event::Action(action) => {
                    let app = app.clone();
                    macos::on_main(move |_| super::handle(&app, action));
                }
            }
        }
        anyhow::bail!("菜单栏输出管道已关闭")
    };
    let result = tokio::select! {
        result = write => result,
        result = read => result,
        status = child.wait() => Err(anyhow::anyhow!("菜单栏进程结束：{:?}", status?)),
    };
    // 先回收这一份，才能起下一份，避免重复图标；取消任务时 kill_on_drop 兜底。
    let _ = child.kill().await;
    let _ = child.wait().await;
    result
}

fn packet(value: &impl Serialize) -> io::Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec(value)?;
    bytes.push(b'\n');
    if bytes.len() > MAX_PACKET {
        return Err(io::Error::other("菜单栏消息过大"));
    }
    Ok(bytes)
}

fn decode<T: DeserializeOwned>(bytes: &[u8]) -> io::Result<Option<T>> {
    if bytes.is_empty() {
        return Ok(None);
    }
    if bytes.len() > MAX_PACKET || bytes.last() != Some(&b'\n') {
        return Err(io::Error::other("菜单栏消息过大或不完整"));
    }
    serde_json::from_slice(bytes)
        .map(Some)
        .map_err(io::Error::other)
}

fn read_sync<T: DeserializeOwned>(reader: &mut impl BufRead) -> io::Result<Option<T>> {
    let mut bytes = Vec::new();
    std::io::Read::take(reader, (MAX_PACKET + 1) as u64).read_until(b'\n', &mut bytes)?;
    decode(&bytes)
}

async fn read_async<T: DeserializeOwned>(
    reader: &mut (impl AsyncBufRead + Unpin),
) -> io::Result<Option<T>> {
    let mut bytes = Vec::new();
    reader
        .take((MAX_PACKET + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .await?;
    decode(&bytes)
}

/// 在 main 的最前面调用。只有这个参数进入辅助模式，不初始化主应用的任何服务。
pub fn run_if_requested() -> bool {
    if std::env::args_os().nth(1).as_deref() != Some(std::ffi::OsStr::new(ARG)) {
        return false;
    }
    run_child();
    true
}

fn send(event: &Event) {
    let result = packet(event).and_then(|bytes| {
        let mut out = io::stdout().lock();
        out.write_all(&bytes)?;
        out.flush()
    });
    if result.is_err() {
        std::process::exit(0);
    }
}

/// AppKit 暂时忙时，只留最新一帧，最多往主队列投递一个任务。
#[derive(Default)]
struct Inbox {
    latest: Option<Frame>,
    queued: bool,
}

impl Inbox {
    fn replace(&mut self, frame: Frame) -> bool {
        self.latest = Some(frame);
        !std::mem::replace(&mut self.queued, true)
    }

    fn take(&mut self) -> Option<Frame> {
        self.queued = false;
        self.latest.take()
    }
}

fn run_child() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};

    let mtm = MainThreadMarker::new().expect("菜单栏子进程在主线程启动");
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    macos::install(
        mtm,
        |action| send(&Event::Action(action)),
        |open| send(&Event::Open(open)),
    );

    static INBOX: Mutex<Inbox> = Mutex::new(Inbox {
        latest: None,
        queued: false,
    });
    std::thread::spawn(|| {
        let mut input = io::stdin().lock();
        loop {
            match read_sync::<Frame>(&mut input) {
                Ok(Some(frame)) => {
                    let schedule = INBOX.lock().expect("锁未中毒").replace(frame);
                    if schedule {
                        macos::on_main(|mtm| {
                            let frame = INBOX.lock().expect("锁未中毒").take();
                            if let Some(frame) = frame {
                                apply_frame(mtm, frame);
                            }
                        });
                    }
                }
                // 父进程正常退出、崩溃或被杀都会关闭管道；即使菜单正在跟踪也立即退出。
                Ok(None) => std::process::exit(0),
                Err(error) => {
                    eprintln!("菜单栏输入失败：{error}");
                    std::process::exit(1);
                }
            }
        }
    });
    app.run();
}

fn apply_frame(mtm: objc2::MainThreadMarker, frame: Frame) {
    use objc2_app_kit::{
        NSAppearance, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSApplication,
    };
    i18n::set(frame.lang);
    thread_local! {
        // 第一帧也要设；之后只在设置变动时改外观，不随速度每秒重复设置。
        static APPLIED: std::cell::Cell<Option<Option<theme::Theme>>> = const { std::cell::Cell::new(None) };
    }
    let changed = APPLIED.with(|applied| applied.replace(Some(frame.theme)) != Some(frame.theme));
    if changed {
        let appearance = frame.theme.and_then(|theme| {
            // AppKit 导出的只读名称；None 继续跟随系统外观。
            let name = unsafe {
                match theme {
                    theme::Theme::Light => NSAppearanceNameAqua,
                    theme::Theme::Dark => NSAppearanceNameDarkAqua,
                }
            };
            NSAppearance::appearanceNamed(name)
        });
        NSApplication::sharedApplication(mtm).setAppearance(appearance.as_deref());
    }
    let (bar, rows) = model::build(&frame.snapshot, frame.style);
    macos::apply(mtm, &bar, &rows);
}

#[cfg(test)]
mod tests;
