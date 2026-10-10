//! 一个在跑的请求的实时内容，搬给界面：请求详情「内容」那一页（`GET /request/{id}/live`）。
//!
//! **界面订阅、界面退订**：浮层打开在跑的那一条、看到「内容」时 `live_subscribe`，关了浮层、
//! 换了一条请求时 `live_unsubscribe`。订阅号由界面自己起（`sub`）：订阅的应答回来之前，
//! 补发的那一批可能已经到了，界面要认得出是自己的。
//!
//! 内容和 core 的事件一样走 Tauri 事件（`request-live`，一批是一条 [`LiveBatch`]），走的是
//! 当前连接：本机的 socket 和远程的加密连接是同一条路（[`ControlClient::open_live`]）。
//!
//! **不留一个没人要的任务**：
//!
//! - 请求结束（core 发 `end`、关掉流）、流断了、换了连接，读的那个任务自己收场：最后一批带上
//!   `closed`（断了的带着原因），从登记里摘掉自己
//! - 退订就地叫停它，连着 core 的那条连接跟着断开（`LiveStream` 丢掉就断）
//! - 网页重新载入过、退订没送到的，最多留 [`MAX`] 个：再订阅时最早的那个叫停 —— 而它们本来
//!   也只活到那个请求结束
//!
//! [`ControlClient::open_live`]: crate::control::ControlClient::open_live

use std::sync::Mutex;
use std::time::Duration;

use tauri::{Emitter, Manager};

use crate::AppState;
use crate::control::LiveStream;
use crate::error::{CmdError, Out};
use crate::wire::{LiveBatch, LiveClosed, LiveItem};

/// 界面听的那个事件
pub const EVENT: &str = "request-live";

/// 一批攒多久。界面一帧画一次，比一帧再长一点就够；快的模型一秒几百段，一段一条消息的话
/// 网页那一头光是收就忙不过来
const BATCH: Duration = Duration::from_millis(30);

/// 同时最多几个订阅。正常只有一个（浮层里那一条）；多出来的是退订没送到的
const MAX: usize = 4;

type Task = tauri::async_runtime::JoinHandle<()>;

/// 在读的订阅，按订阅的先后
#[derive(Default)]
pub struct LiveSubs(Mutex<Vec<(String, Task)>>);

impl LiveSubs {
    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<(String, Task)>> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// 摘掉一个，交出它的任务
    fn take(&self, sub: &str) -> Option<Task> {
        let mut all = self.lock();
        let i = all.iter().position(|(s, _)| s == sub)?;
        Some(all.remove(i).1)
    }
}

/// 订阅请求 `id` 的实时内容，号是 `sub`。
///
/// **打开了才返回**：请求已经结束（或者没有这条、是 WebSocket 的）时是 core 的那条拒绝，码是
/// `control.request_not_running` —— 界面据此去取存下的详情。打开之后内容一批一批经
/// `request-live` 来，最后一批带着 `closed`
#[tauri::command]
pub async fn live_subscribe(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: u64,
    sub: String,
) -> Out<()> {
    let client = state.control.clone();
    // 先拿着「换了连接」的通知再去打开：打开的那一会儿里换了的，读的时候头一个就看到
    let moved = client.moved();
    let stream = client.open_live(id).await?;
    let subs = app.state::<LiveSubs>();
    // **登记和起任务在同一把锁里**：任务要是立刻就读完了（请求正好结束），它摘掉自己的
    // 那一下要等这里登记完 —— 否则摘的时候还没有，登记上的就是一个已经结束的任务
    let mut all = subs.lock();
    let (a, s) = (app.clone(), sub.clone());
    let task = tauri::async_runtime::spawn(async move {
        let error = pump(&a, &s, stream, moved).await.err();
        if let Some(e) = &error {
            tracing::debug!("实时内容提前结束：{e:#}");
        }
        let _ = a.emit(
            EVENT,
            LiveBatch {
                sub: s.clone(),
                items: Vec::new(),
                closed: Some(LiveClosed {
                    error: error.map(|e| CmdError::from(e).into_msg()),
                }),
            },
        );
        if let Some(subs) = a.try_state::<LiveSubs>() {
            subs.take(&s);
        }
    });
    if let Some(i) = all.iter().position(|(s, _)| *s == sub) {
        all.remove(i).1.abort();
    }
    all.push((sub, task));
    while all.len() > MAX {
        all.remove(0).1.abort();
    }
    Ok(())
}

/// 退订。已经结束了的、不认得的号什么都不做
#[tauri::command]
pub fn live_unsubscribe(subs: tauri::State<'_, LiveSubs>, sub: String) {
    if let Some(task) = subs.take(&sub) {
        task.abort();
    }
}

/// 读到 `end`（或者流断了、换了连接）为止，一批一批交给界面。正常结束是 `Ok`：最后一批
/// 由调用方带着 `closed` 发。
///
/// **换了连接不算出错**：界面跟着换过去、整个重新取，旧的那个 core 上的这条请求不必再说什么
async fn pump(
    app: &tauri::AppHandle,
    sub: &str,
    mut stream: LiveStream,
    mut moved: tokio::sync::watch::Receiver<u64>,
) -> anyhow::Result<()> {
    let mut batch: Vec<LiveItem> = Vec::new();
    let mut due: Option<tokio::time::Instant> = None;
    let send = |items: &mut Vec<LiveItem>| {
        if items.is_empty() {
            return;
        }
        let _ = app.emit(
            EVENT,
            LiveBatch {
                sub: sub.to_string(),
                items: std::mem::take(items),
                closed: None,
            },
        );
    };
    loop {
        tokio::select! {
            // **先看换没换连接**：换了之后，旧的那个 core 的内容不该再落到界面上
            biased;
            _ = moved.changed() => {
                tracing::debug!("换了连接，实时内容不再跟");
                return Ok(());
            }
            _ = tokio::time::sleep_until(due.unwrap_or_else(tokio::time::Instant::now)), if due.is_some() => {
                send(&mut batch);
                due = None;
            }
            next = stream.next() => match next {
                Ok(Some(c)) => {
                    let end = matches!(c, tw_api::LiveContent::End(_));
                    batch.push(c.into());
                    if end {
                        send(&mut batch);
                        return Ok(());
                    }
                    due.get_or_insert_with(|| tokio::time::Instant::now() + BATCH);
                }
                Ok(None) => {
                    send(&mut batch);
                    return Ok(());
                }
                Err(e) => {
                    send(&mut batch);
                    return Err(e);
                }
            },
        }
    }
}
