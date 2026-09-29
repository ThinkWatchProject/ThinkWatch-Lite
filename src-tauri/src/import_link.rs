//! 导入链接：`thinkwatch://import?name=…&url=…&protocol=…&key=…&models=…`。
//!
//! 中转站、服务商把这样一条链接交给用户，点开之后应用弹出「导入上游」，预填一个
//! **新的**上游。官网的 `https://thinkwat.ch/import#<同样的参数>` 读完片段之后打开的
//! 也是这条链接。
//!
//! **每一条链接都当作恶意的来处理**：任何网页都能触发它。所以：
//!
//! - 只认这里列出的五个参数。多一个不认识的、同一个参数出现两次、编码不规整，整条作废；
//!   每一项和整条都有长度上限。
//! - 接口地址只收 `https://`（`http://` 只给本机回环地址），不带账号密码、查询串、片段；
//!   主机名一律转成 ASCII（IDN 转 punycode）给人看，防形近字。
//! - 密钥只收常见的密钥字符。**`$`、`{`、`}` 一律不收**：core 会把密钥里的 `${变量名}`
//!   换成这台机器上的环境变量（`tw_secret::expand`，`$${` 是它的转义），一条
//!   `key=${OPENAI_API_KEY}` 的链接就能把用户自己的密钥发到对方的主机上。
//! - 链接只产生一份**提议**。点「创建」之前不写配置、不发任何网络请求（不取模型列表、
//!   不检测连接：链接不该能让应用去探内网）。创建只新建一个上游，不改、不覆盖、不删已有的，
//!   也不设成默认、不加进路由。
//! - 同一时间只处理一条：对话框开着时再来的链接直接丢掉，不再把窗口拉到前面。
//! - 链接里的内容不进 shell、`open`、子进程、文件路径；界面拿到的是这里校验完的结构，
//!   保存走白名单里那个新建上游的控制面端点（`CreateProvider`）。

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tw_api::Protocol;

use crate::wire::ImportProposal;

/// 链接的前缀。主机名那一段不分大小写
pub const PREFIX: &str = "thinkwatch://import";

/// 整条链接的上限
pub const MAX_LINK: usize = 8192;
pub const MAX_NAME: usize = 64;
pub const MAX_URL: usize = 2048;
pub const MAX_KEY: usize = 512;
pub const MAX_MODEL: usize = 128;
pub const MAX_MODELS: usize = 64;

/// 对话框关掉之后这么久之内再来的链接不理：一个反复触发链接的网页不能在用户点了
/// 「取消」之后马上又把对话框弹回来
const COOLDOWN: Duration = Duration::from_secs(3);
/// 交出去之后界面一直没来取（网页没挂上）：过了这么久，下一条链接可以顶替它
const STALE: Duration = Duration::from_secs(60);

/// 链接为什么被拒。**不带链接里的内容**：写进日志的只有这个
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejected {
    NotImport,
    TooLong,
    Malformed,
    Encoding,
    UnknownParam,
    DuplicateParam,
    Empty,
    MissingUrl,
    Name,
    Url,
    Protocol,
    Key,
    Models,
}

/// 是不是一条导入链接（包括写坏了的）。是的话就只由这里处理 —— 不落到授权回调那一路，
/// 那一路会把窗口拉到前面
pub fn is_import(link: &str) -> bool {
    link.get(..PREFIX.len())
        .is_some_and(|p| p.eq_ignore_ascii_case(PREFIX))
        && matches!(
            link.as_bytes().get(PREFIX.len()),
            None | Some(b'?' | b'/' | b'#')
        )
}

/// 解析并逐项校验一条导入链接
pub fn parse(link: &str) -> Result<ImportProposal, Rejected> {
    if link.len() > MAX_LINK {
        return Err(Rejected::TooLong);
    }
    if !is_import(link) {
        return Err(Rejected::NotImport);
    }
    let rest = &link[PREFIX.len()..];
    // `thinkwatch://import?…` 和 `thinkwatch://import/?…`，别的路径、片段都不认
    let rest = rest.strip_prefix('/').unwrap_or(rest);
    let query = match rest.strip_prefix('?') {
        Some(q) => q,
        None if rest.is_empty() => return Err(Rejected::MissingUrl),
        None => return Err(Rejected::Malformed),
    };
    if query.contains('#') {
        return Err(Rejected::Malformed);
    }

    let mut name = None;
    let mut url = None;
    let mut protocol = None;
    let mut key = None;
    let mut models = None;
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').ok_or(Rejected::Malformed)?;
        let k = decode(k)?;
        let v = decode(v)?;
        let slot = match k.as_str() {
            "name" => &mut name,
            "url" => &mut url,
            "protocol" => &mut protocol,
            "key" => &mut key,
            "models" => &mut models,
            _ => return Err(Rejected::UnknownParam),
        };
        if slot.is_some() {
            return Err(Rejected::DuplicateParam);
        }
        if v.is_empty() {
            return Err(Rejected::Empty);
        }
        *slot = Some(v);
    }

    let (base_url, host) = check_url(&url.ok_or(Rejected::MissingUrl)?)?;
    Ok(ImportProposal {
        name: name.map(|n| check_name(&n)).transpose()?,
        base_url,
        host,
        protocol: protocol.map(|p| check_protocol(&p)).transpose()?,
        key: key.map(|k| check_key(&k)).transpose()?,
        models: models
            .map(|m| check_models(&m))
            .transpose()?
            .unwrap_or_default(),
    })
}

/// 百分号解码，只解一层。`+` 是空格（和网页上的 `URLSearchParams` 一个说法）。
/// `%` 后面不是两位十六进制、解出来不是 UTF-8，整条作废
fn decode(s: &str) -> Result<String, Rejected> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' => {
                let hex = |j: usize| {
                    b.get(j)
                        .and_then(|c| (*c as char).to_digit(16))
                        .ok_or(Rejected::Encoding)
                };
                out.push((hex(i + 1)? * 16 + hex(i + 2)?) as u8);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8(out).map_err(|_| Rejected::Encoding)
}

/// 看不见、会改变显示顺序的字符：零宽字符、双向控制符。混在名称或地址里能让人看到的
/// 和实际保存的不是一回事
fn invisible(c: char) -> bool {
    matches!(c,
        '\u{00AD}' | '\u{034F}' | '\u{061C}' | '\u{115F}' | '\u{1160}' | '\u{17B4}' | '\u{17B5}'
        | '\u{180B}'..='\u{180F}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}'
        | '\u{2060}'..='\u{206F}' | '\u{3164}' | '\u{FE00}'..='\u{FE0F}' | '\u{FEFF}'
        | '\u{FFA0}' | '\u{FFF0}'..='\u{FFFF}')
}

fn unsafe_char(c: char) -> bool {
    c.is_control() || invisible(c)
}

/// 上游名称：和新建对话框里一样的名字，再严一点 —— 不带路径分隔符、控制字符、看不见的
/// 字符，首尾没有空白，不以 core 保留的 `__` 开头
fn check_name(n: &str) -> Result<String, Rejected> {
    let bad = n.chars().count() > MAX_NAME
        || n.trim() != n
        || n == "."
        || n == ".."
        || n.starts_with("__")
        || n.chars().any(|c| {
            unsafe_char(c) || matches!(c, '/' | '\\' | '$' | '{' | '}' | '<' | '>' | '"' | '`')
        });
    if bad {
        return Err(Rejected::Name);
    }
    Ok(n.to_string())
}

/// 接口地址。返回规范化之后的地址和给人看的主机
fn check_url(raw: &str) -> Result<(String, String), Rejected> {
    if raw.len() > MAX_URL
        || raw.chars().any(|c| {
            unsafe_char(c)
                || c.is_whitespace()
                || matches!(
                    c,
                    '\\' | '$'
                        | '{'
                        | '}'
                        | '%'
                        | '"'
                        | '<'
                        | '>'
                        | '`'
                        | '^'
                        | '|'
                        | '@'
                        | '#'
                        | '?'
                )
        })
    {
        return Err(Rejected::Url);
    }
    // 写全 scheme：`https:example.com` 这种 url 库会宽容地补成 `https://`，这里不宽容
    let lower = raw
        .get(..8)
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err(Rejected::Url);
    }
    let u = url::Url::parse(raw).map_err(|_| Rejected::Url)?;
    if !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err(Rejected::Url);
    }
    let host = u.host().ok_or(Rejected::Url)?;
    let loopback = match &host {
        url::Host::Domain(d) => d.eq_ignore_ascii_case("localhost"),
        url::Host::Ipv4(ip) => *ip == std::net::Ipv4Addr::LOCALHOST,
        url::Host::Ipv6(ip) => *ip == std::net::Ipv6Addr::LOCALHOST,
    };
    match u.scheme() {
        "https" => {}
        "http" if loopback => {}
        _ => return Err(Rejected::Url),
    }
    // url 库给出的主机名已经是 ASCII（IDN 转成了 punycode），IPv6 带方括号
    let host_str = u.host_str().ok_or(Rejected::Url)?;
    if host_str.is_empty() || !host_str.is_ascii() {
        return Err(Rejected::Url);
    }
    let shown = match u.port() {
        Some(p) => format!("{host_str}:{p}"),
        None => host_str.to_string(),
    };
    let base = u.as_str().trim_end_matches('/').to_string();
    if base.len() > MAX_URL {
        return Err(Rejected::Url);
    }
    Ok((base, shown))
}

/// 协议只收这几种。ChatGPT 账号要登录、Bedrock 要 AWS 的凭据，都不是一条链接能给的
fn check_protocol(p: &str) -> Result<Protocol, Rejected> {
    match Protocol::from_slug(p) {
        Some(
            v @ (Protocol::Anthropic
            | Protocol::OpenaiChat
            | Protocol::OpenaiResponses
            | Protocol::Gemini),
        ) => Ok(v),
        _ => Err(Rejected::Protocol),
    }
}

/// 密钥：只收常见的密钥字符。没有 `$`、`{`、`}`，存进配置就是字面值，不会被展开
fn check_key(k: &str) -> Result<String, Rejected> {
    let ok = k.len() <= MAX_KEY
        && k.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.~+/=:".contains(&b));
    if !ok {
        return Err(Rejected::Key);
    }
    Ok(k.to_string())
}

/// 模型清单：逗号分隔，每一项是一个模型 ID。重复的只留一个
fn check_models(m: &str) -> Result<Vec<String>, Rejected> {
    let mut out: Vec<String> = Vec::new();
    for id in m.split(',') {
        let ok = !id.is_empty()
            && id.len() <= MAX_MODEL
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.:/@+".contains(&b));
        if !ok {
            return Err(Rejected::Models);
        }
        if !out.iter().any(|x| x == id) {
            out.push(id.to_string());
        }
    }
    if out.len() > MAX_MODELS {
        return Err(Rejected::Models);
    }
    Ok(out)
}

// ---------------------------------------------------------- 一次只处理一条

#[derive(Debug)]
enum State {
    Idle {
        closed_at: Option<Instant>,
    },
    /// 交出去了，等界面来取
    Pending {
        proposal: ImportProposal,
        at: Instant,
    },
    /// 界面取走了，对话框开着
    Open,
}

/// 同一时间最多一条提议。**对话框开着、或者刚关掉的那几秒里来的链接都丢掉**，
/// 也就不会一次次把窗口拉到前面
#[derive(Debug)]
pub struct Gate(Mutex<State>);

impl Gate {
    pub const fn new() -> Self {
        Self(Mutex::new(State::Idle { closed_at: None }))
    }

    /// 收下一份提议。收下了（要打开窗口）是 true
    pub fn offer(&self, proposal: ImportProposal, now: Instant) -> bool {
        let Ok(mut g) = self.0.lock() else {
            return false;
        };
        let free = match &*g {
            State::Idle { closed_at } => {
                closed_at.is_none_or(|t| now.saturating_duration_since(t) >= COOLDOWN)
            }
            State::Pending { at, .. } => now.saturating_duration_since(*at) >= STALE,
            State::Open => false,
        };
        if free {
            *g = State::Pending { proposal, at: now };
        }
        free
    }

    /// 界面来取。取走之后算对话框开着
    pub fn take(&self) -> Option<ImportProposal> {
        let mut g = self.0.lock().ok()?;
        match std::mem::replace(&mut *g, State::Open) {
            State::Pending { proposal, .. } => Some(proposal),
            other => {
                *g = other;
                None
            }
        }
    }

    /// 对话框关了（取消、创建完、网页重新加载、窗口被销毁）。还没取走的那一份不动
    pub fn close(&self, now: Instant) {
        if let Ok(mut g) = self.0.lock()
            && matches!(*g, State::Open)
        {
            *g = State::Idle {
                closed_at: Some(now),
            };
        }
    }
}

impl Default for Gate {
    fn default() -> Self {
        Self::new()
    }
}

static GATE: Gate = Gate::new();

/// Tauri 事件：有一份提议等着取（不带内容，内容由 `take_import_link` 取）
pub const EVENT: &str = "import-link";

/// 收到一条导入链接
pub fn receive(app: &tauri::AppHandle, link: &str) {
    let proposal = match parse(link) {
        Ok(p) => p,
        Err(why) => {
            // 链接里可能有密钥：日志只记原因
            tracing::warn!(?why, "导入链接未通过校验，已忽略");
            return;
        }
    };
    if !GATE.offer(proposal, Instant::now()) {
        tracing::info!("已有一条导入链接在处理，这一条已忽略");
        return;
    }
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        use tauri::Emitter;
        let _ = crate::window::show_main_window(&a);
        let _ = a.emit(EVENT, ());
    });
}

/// 界面取走等着的那一份提议
#[tauri::command]
pub fn take_import_link() -> Option<ImportProposal> {
    GATE.take()
}

/// 导入对话框关了。界面挂上时也调一次：网页重新加载过，之前开着的对话框已经不在了
#[tauri::command]
pub fn import_link_closed() {
    GATE.close(Instant::now());
}

/// 主窗口被销毁：开着的导入对话框跟着没了
pub fn window_destroyed() {
    GATE.close(Instant::now());
}

#[cfg(test)]
mod tests;
