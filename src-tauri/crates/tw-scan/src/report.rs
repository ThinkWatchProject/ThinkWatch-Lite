//! 扫一遍，把看到的和担心的分开说。
//!
//! 两个消费者共用这一份结果：
//!
//! | | 安全 | 清单 |
//! |---|---|---|
//! | 要的是 | 告警 | 此刻的真实状态 |
//! | 存哪 | 进 `data.db`，要有历史 | **只在内存** |
//!
//! 所以这里只负责「扫出来是什么」，**不写任何文件**，也不决定存不存。
//!
//! # 只报告，不自动删除
//!
//! 这一条写死。误报删掉用户的正常配置比漏报还糟 —— 它会摧毁
//! 信任，然后用户关掉整个功能，连真正有用的那些告警一起关掉。这个模块
//! 里没有任何一处会删东西，有测试盯着。

use std::path::PathBuf;

use tw_adopt::json::Val;
use tw_types::{Msg, msg};

use crate::sources::{self, Source};
use tw_guard::hidden;
use tw_guard::tools::rules::Rules;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    /// 高危：发系统通知，托盘挂角标
    High,
    Medium,
    Low,
}

impl Level {
    pub fn slug(&self) -> &'static str {
        match self {
            Level::High => "high",
            Level::Medium => "medium",
            Level::Low => "low",
        }
    }
}

/// 一条发现。
#[derive(Debug, Clone)]
pub struct Finding {
    pub level: Level,
    /// 哪条规则命中的（`zero_width` / `curl-pipe-sh` / …）
    pub rule: String,
    pub kind: sources::Kind,
    pub client: String,
    pub path: PathBuf,
    /// 第几行，从 1 开始。**要能定位到行**
    pub line: usize,
    /// **带码。**这一屏要用界面自己的语言说出来；英文原句是给命令行
    /// 和不认识这个码的客户端的退路。参数里给的都是词表里的词
    /// （`kind` / `rule` / `what`），不是拼好的句子 —— 句子两边各写各的
    pub title: Msg,
    /// 为什么它值得看一眼
    pub detail: Msg,
    /// 命中的那一行。不可见字符已经换成可见记号
    pub excerpt: String,
    /// 这条发现说的是什么，**和它在文件里的位置无关**：远端 MCP 是服务器名和地址，
    /// 规则命中是命中的那一段，藏起来的字符是那一行，skill 是它的名字。
    ///
    /// 「是不是新出现的」按它认（[`crate::watch::Seen`]），不按行号：文件上面多一行、
    /// 少一行，下面的每一条都会挪位置，按行号认就会把早就看过的整批再报一遍
    pub subject: String,
}

/// 一个 MCP server 在某个客户端里的样子。
///
/// **有两种形态，而它们的风险不是一回事** —— 本机跑一个二进制，和把
/// 上下文发到别人的服务器上。本机这台机器上两种都有，是实扫出来的，
/// 不是设想的。
#[derive(Debug, Clone, PartialEq)]
pub struct McpServer {
    pub name: String,
    pub client: String,
    /// 要执行的程序。远端型的这里是空
    pub command: String,
    pub args: Vec<String>,
    /// 远端型：它的地址。**用到它的时候，相关上下文会发到这台服务器**
    pub url: Option<String>,
    /// 它会读哪些环境变量名。**只有名字，没有值** —— 值里常常就是密钥
    pub env_keys: Vec<String>,
    /// 配置里写着 `enabled = false`。
    ///
    /// 关掉的照样列出来（它还在配置里，一次编辑就能打开），但**告警要
    /// 降一级** —— 对一个当前跑不起来的东西喊高危，是狼来了。
    pub enabled: bool,
    pub source: PathBuf,
}

impl McpServer {
    /// 判断「同名不同配置」用的指纹（矩阵上要标记号）。
    pub fn shape(&self) -> String {
        match &self.url {
            Some(u) => format!("remote {u}"),
            None => format!("{} {}", self.command, self.args.join(" ")),
        }
    }
    /// 远端型，而且不在本机。
    pub fn is_third_party(&self) -> bool {
        self.url.as_deref().is_some_and(|u| !is_local(u))
    }
}

/// 地址指着本机。**按主机名比，不按子串**：`https://localhost.evil.example/` 不是本机，
/// `https://evil.example/?r=http://127.0.0.1` 也不是 —— 子串比的话，这两个都被当成
/// 本机，远程 server 的提醒就没了
fn is_local(url: &str) -> bool {
    let Some((_, rest)) = url.split_once("://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let host_port = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let host = match host_port.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or_default(),
        None => host_port.split(':').next().unwrap_or_default(),
    };
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback() || ip.is_unspecified())
}

#[derive(Debug, Clone, PartialEq)]
pub struct SkillEntry {
    pub name: String,
    pub client: String,
    pub path: PathBuf,
    /// frontmatter 里声明的工具权限
    pub allowed_tools: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HookEntry {
    pub client: String,
    /// `PostToolUse` 之类
    pub event: String,
    pub command: String,
    pub source: PathBuf,
    /// 这条命令在 `source` 的第几行（1 起），找不到是 0（见 [`command_line`]）。
    ///
    /// 发现按文件和行记：清单上的一行要知道哪些发现是它的，就得知道自己在哪一行。
    /// 按摘录里有没有这条命令去认的话，隐藏字符那一类对不上 —— 它的摘录把不可见字符
    /// 换成了可见记号，偏偏藏在命令里的零宽字符最该挂到这一行上
    pub line: usize,
}

#[derive(Debug, Default)]
pub struct Report {
    pub mcp: Vec<McpServer>,
    pub skills: Vec<SkillEntry>,
    pub hooks: Vec<HookEntry>,
    pub findings: Vec<Finding>,
    /// 读不动的文件。**说出来** —— 一个悄悄跳过了半数文件的扫描比不扫
    /// 更糟，因为它会给人一种「查过了」的错觉
    pub unreadable: Vec<String>,
}

/// 一份要扫的文件最多读多大。宽到装得下攒了很久的 `~/.claude.json`
const MAX_SCAN_BYTES: u64 = 32 << 20;

/// 读一份要扫的文件。**只读普通文件，而且有上限**：一条指向 `/dev/zero` 的链接会一直
/// 读下去、一个命名管道会一直等下去，启动时的那一次扫描就卡在那里。读不了的由调用方
/// 记进 `unreadable`，照样说出来
fn read(p: &std::path::Path) -> Option<String> {
    let meta = std::fs::metadata(p).ok()?;
    if !meta.is_file() || meta.len() > MAX_SCAN_BYTES {
        return None;
    }
    std::fs::read_to_string(p).ok()
}

/// 把 JSON / TOML 读成同一种值。两种格式各有各的解析器，但清单和扫描
/// 只关心结构。
///
/// **`.jsonc` 也要认**：刚装好的 opencode 手里就是一份 `opencode.jsonc`，不认它
/// 等于没扫 opencode。注释和尾逗号 JSON 那个解析器本来就放过。
fn parse_any(src: &Source, text: &str) -> Option<Val> {
    match src.path.extension().and_then(|e| e.to_str()) {
        Some("toml") => tw_adopt::toml::value(text).ok(),
        Some("json" | "jsonc") => tw_adopt::json::value(text).ok(),
        // dsh 的补丁是一张插件行的列表，MCP server 是其中的一种行。摊成
        // `mcpServers` 的形状，后面和别家走同一条路
        Some("yml") if src.client == "dsh" => match src.kind {
            sources::Kind::Mcp => tw_adopt::rows::mcp_servers(text).ok(),
            _ => None,
        },
        // Hermes Agent 的 config.yaml：`mcp_servers` 和别家的 `mcpServers` 是同一种形状
        Some("yml" | "yaml") => yaml_value(text),
        _ => None,
    }
}

/// 一份 YAML 读成同一种值。**标量按 YAML 自己的类型读**：`enabled: false` 是布尔 ——
/// 读成字符串的话，关掉的 server 会被当成开着的，跟着报一遍。
///
/// 严格的解析器不收的文件（同一层里写了两遍的键，Hermes 用的 PyYAML 照收、后写的赢），
/// 退回 tw-yaml 那一种只认结构的读法：标量都是字符串，server 照样列得出来
fn yaml_value(text: &str) -> Option<Val> {
    fn val(v: &serde_yaml_ng::Value) -> Val {
        use serde_yaml_ng::Value as Y;
        match v {
            Y::Null => Val::Null,
            Y::Bool(b) => Val::Bool(*b),
            Y::Number(n) => Val::Num(n.to_string()),
            Y::String(s) => Val::Str(s.clone()),
            Y::Sequence(xs) => Val::Arr(xs.iter().map(val).collect()),
            Y::Mapping(m) => Val::Obj(
                m.iter()
                    .map(|(k, v)| {
                        let k = match val(k) {
                            Val::Str(s) => s,
                            other => other.to_line(),
                        };
                        (k, val(v))
                    })
                    .collect(),
            ),
            Y::Tagged(t) => val(&t.value),
        }
    }
    match serde_yaml_ng::from_str::<serde_yaml_ng::Value>(text) {
        Ok(v) => Some(val(&v)),
        Err(_) => tw_adopt::yamlval::value(text).ok(),
    }
}

fn obj<'a>(v: &'a Val, key: &str) -> Option<&'a Vec<(String, Val)>> {
    let Val::Obj(ms) = v else { return None };
    match &ms.iter().find(|(k, _)| k == key)?.1 {
        Val::Obj(inner) => Some(inner),
        _ => None,
    }
}

fn s(v: &Val, key: &str) -> Option<String> {
    let Val::Obj(ms) = v else { return None };
    ms.iter()
        .find(|(k, _)| k == key)?
        .1
        .as_str()
        .map(|x| x.to_string())
}

fn strings(v: &Val, key: &str) -> Vec<String> {
    let Val::Obj(ms) = v else { return Vec::new() };
    match ms.iter().find(|(k, _)| k == key).map(|(_, v)| v) {
        Some(Val::Arr(es)) => es.iter().map(|e| e.to_line()).collect(),
        _ => Vec::new(),
    }
}

/// 各客户端把 MCP 段放在不同的键下面，里面的形状（`command` / `args` /
/// `env`）是一致的。**opencode 例外**，见 [`opencode_mcp`]。
const MCP_KEYS: &[&str] = &["mcpServers", "mcp_servers", "context_servers"];

/// opencode 的 MCP：扁平的 `mcp.<名>`、v2 的 `mcp.servers.<名>`，或者两者混在
/// 一起。`command` 是连参数一起的字符串数组，环境变量的键叫 `environment`，
/// 开关按写法是 `enabled` 或 `disabled`。
fn opencode_mcp(src: &Source, v: &Val) -> Vec<McpServer> {
    tw_adopt::opencode::mcp_servers(v)
        .into_iter()
        .map(|m| {
            let mut cmd = m.command().into_iter();
            McpServer {
                client: src.client.to_string(),
                command: cmd.next().unwrap_or_default(),
                args: cmd.collect(),
                url: m.url(),
                env_keys: m.env_keys(),
                enabled: m.enabled(),
                source: src.path.clone(),
                name: m.name,
            }
        })
        .collect()
}

fn mcp_from(src: &Source, v: &Val) -> Vec<McpServer> {
    let mut out = if src.client == "opencode" {
        opencode_mcp(src, v)
    } else {
        Vec::new()
    };
    for key in MCP_KEYS {
        let Some(servers) = obj(v, key) else { continue };
        for (name, cfg) in servers {
            out.push(server(src, name.clone(), cfg));
        }
    }
    // oh-my-pi 的 `mcp.json` 顶层还有两张名单：`disabledServers` 里的不管条目自己怎么写都
    // 关着，`enabledServers` 里的哪怕条目写了 `enabled: false` 也开着；两张都有的，关着赢
    if src.client == "omp" {
        let (off, on) = (strings(v, "disabledServers"), strings(v, "enabledServers"));
        for m in &mut out {
            if off.contains(&m.name) {
                m.enabled = false;
            } else if on.contains(&m.name) {
                m.enabled = true;
            }
        }
    }
    out.sort_by(|a, b| (&a.name, &a.client).cmp(&(&b.name, &b.client)));
    out
}

/// 一个 `command` / `args` / `env` 形状的 server。
fn server(src: &Source, name: String, cfg: &Val) -> McpServer {
    McpServer {
        name,
        client: src.client.to_string(),
        command: s(cfg, "command").unwrap_or_default(),
        args: strings(cfg, "args"),
        // agy 的远程 server 写 `serverUrl`（也认 `url`）；Qwen Code 的 streamable HTTP 写
        // `httpUrl`
        url: s(cfg, "url")
            .or_else(|| s(cfg, "serverUrl"))
            .or_else(|| s(cfg, "httpUrl")),
        // **只取键名，不取值。**值里常常就是密钥本身
        env_keys: match obj(cfg, "env") {
            Some(e) => e.iter().map(|(k, _)| k.clone()).collect(),
            None => Vec::new(),
        },
        // 没写就是开着 —— 各家的默认都是这样。关掉的写法有两种：
        // `enabled: false`，以及 agy 的 `disabled: true`
        enabled: !matches!(
            cfg,
            Val::Obj(ms) if ms.iter().any(|(k, v)| {
                (k == "enabled" && *v == Val::Bool(false))
                    || (k == "disabled" && *v == Val::Bool(true))
            })
        ),
        source: src.path.clone(),
    }
}

/// Claude Code 按项目配的 MCP server：`~/.claude.json` 里 `projects.<项目路径>.mcpServers`。
/// 在那个项目里打开 Claude Code，它们和用户级的一样会跑起来，所以一样要扫。
///
/// **只进发现，不进清单**：MCP 页的矩阵一行一个名字、一列一个客户端，复制和移除改的是
/// 用户级那一段（`mcpServers`）。项目里的列进去，点它改到的会是用户级的同名那一个，
/// 或者什么都改不到。名字后面带上项目，发现里说得出是哪一个项目的。
fn project_mcp(src: &Source, v: &Val) -> Vec<McpServer> {
    if src.client != "claude-code" {
        return Vec::new();
    }
    let Some(projects) = obj(v, "projects") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (project, cfg) in projects {
        let Some(servers) = obj(cfg, "mcpServers") else {
            continue;
        };
        for (name, s) in servers {
            out.push(server(src, format!("{name} ({project})"), s));
        }
    }
    out
}

/// Claude Code 设置里另外几个**不经模型就执行命令**的键（设置文档里的名字）：状态栏
/// 每刷新一次跑一遍，取密钥、刷新云凭据、生成遥测请求头的脚本在要用的时候跑。和 hook
/// 一样，模型什么都没决定，命令就执行了。
///
/// 第二项说它打印出来的是不是凭据（密钥、云凭据、带鉴权的请求头）。**这几个只按规则
/// 扫，不进清单**：`"apiKeyHelper": "echo sk-…"` 是把中转站的密钥交给 Claude Code 的
/// 常见写法，清单上的命令是原样显示的，列出来就是把密钥摆在界面上
const CLAUDE_CODE_COMMANDS: &[(&[&str], bool)] = &[
    (&["statusLine", "command"], false),
    (&["apiKeyHelper"], true),
    (&["awsAuthRefresh"], false),
    (&["awsCredentialExport"], true),
    (&["otelHeadersHelper"], true),
];

/// 顺着路径往下走。
fn at<'a>(v: &'a Val, path: &[&str]) -> Option<&'a Val> {
    path.iter().try_fold(v, |cur, k| match cur {
        Val::Obj(ms) => ms.iter().find(|(mk, _)| mk == k).map(|(_, x)| x),
        _ => None,
    })
}

/// 不经模型就会执行的命令：hooks，加上几个同样会执行命令的设置 —— Claude Code 的那几个
/// （[`CLAUDE_CODE_COMMANDS`]），和 Codex 的 `notify`（每一轮结束就执行的那条命令，写成
/// argv 数组）。**和 hook 一样对待**：清单里列在 hooks 那一栏（事件就是那个键名），规则
/// 按「会被执行」扫它们。
///
/// 钩子和 MCP 写在同一份配置里的客户端：Grok Build 的 config.toml（`[hooks]`）、Qwen Code 的
/// settings.json（`hooks`）、Hermes Agent 的 config.yaml（`hooks`）。那份文件按 MCP 列在来源
/// 里，钩子也从它里面找
const HOOKS_WITH_MCP: &[&str] = &["grok-build", "qwen-code", "hermes-agent"];

/// `for_list`：给清单的。打印凭据的那几个不给（见 [`CLAUDE_CODE_COMMANDS`]），规则照扫
fn auto_commands(src: &Source, v: &Val, for_list: bool) -> Vec<HookEntry> {
    let entry = |event: &str, command: String| HookEntry {
        client: src.client.to_string(),
        event: event.to_string(),
        command,
        source: src.path.clone(),
        line: 0,
    };
    let mut out = Vec::new();
    if src.kind == sources::Kind::Mcp && HOOKS_WITH_MCP.contains(&src.client) {
        out.extend(hooks_from(src, v));
    }
    if src.kind == sources::Kind::Hooks {
        out.extend(hooks_from(src, v));
        if src.client == "claude-code" {
            for (path, prints_secret) in CLAUDE_CODE_COMMANDS {
                if let Some(Val::Str(c)) = at(v, path)
                    && !c.trim().is_empty()
                    && !(for_list && *prints_secret)
                {
                    out.push(entry(path[0], c.clone()));
                }
            }
        }
    }
    if src.client == "codex" {
        let cmd = match at(v, &["notify"]) {
            Some(Val::Arr(args)) => args.iter().map(Val::to_line).collect::<Vec<_>>().join(" "),
            Some(Val::Str(c)) => c.clone(),
            _ => String::new(),
        };
        if !cmd.trim().is_empty() {
            out.push(entry("notify", cmd));
        }
    }
    out
}

/// hooks 段里所有的 `command`。
///
/// **递归着找，不照着某一版的嵌套形状写死。**上游改了层级我们顶多多报
/// 一条，而写死的话会一条都报不出来 —— 对一个安全功能来说，这两种失败
/// 的代价差得很远。
fn commands_under(v: &Val, out: &mut Vec<String>) {
    match v {
        Val::Obj(ms) => {
            for (k, x) in ms {
                if k == "command"
                    && let Some(c) = x.as_str()
                {
                    out.push(c.to_string());
                } else {
                    commands_under(x, out);
                }
            }
        }
        Val::Arr(es) => es.iter().for_each(|e| commands_under(e, out)),
        _ => {}
    }
}

fn hooks_from(src: &Source, v: &Val) -> Vec<HookEntry> {
    let Some(hooks) = obj(v, "hooks") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (event, body) in hooks {
        let mut cmds = Vec::new();
        commands_under(body, &mut cmds);
        for c in cmds {
            out.push(HookEntry {
                client: src.client.to_string(),
                event: event.clone(),
                command: c,
                source: src.path.clone(),
                line: 0,
            });
        }
    }
    out
}

/// `---` 之间的 frontmatter。
///
/// **CRLF 和开头的 BOM 也认**：Git for Windows 默认按 CRLF 检出，记事本存的 UTF-8 带
/// BOM。认不出来的话 `allowed-tools` 读成空的，放得太宽的那一条就查不出来
fn frontmatter(text: &str) -> Option<String> {
    let text = text
        .strip_prefix('\u{feff}')
        .unwrap_or(text)
        .replace("\r\n", "\n");
    let rest = text.strip_prefix("---\n")?;
    let end = rest.find("\n---")?;
    Some(rest[..end].to_string())
}

fn allowed_tools(text: &str) -> Vec<String> {
    let Some(fm) = frontmatter(text) else {
        return Vec::new();
    };
    let Ok(v) = serde_yaml_ng::from_str::<serde_yaml_ng::Value>(&fm) else {
        return Vec::new();
    };
    let get = |k: &str| v.get(k).cloned();
    let raw = get("allowed-tools")
        .or_else(|| get("allowed_tools"))
        .or_else(|| get("tools"));
    match raw {
        Some(serde_yaml_ng::Value::Sequence(xs)) => xs
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect(),
        Some(serde_yaml_ng::Value::String(s)) => s
            .split(',')
            .map(|x| x.trim().to_string())
            .filter(|x| !x.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

/// 一条自动执行的命令在文件里的第几行（1 起），找不到是 0。
///
/// 配置文件里的命令是 JSON 字符串：引号、反斜杠是转义过的，原样和转义后的样子各找一次。
/// Codex 的 `notify` 是 argv 数组，拼起来的那一句不在文件里，认 `notify =` 那一行。同一条
/// 命令写了两遍的，都算第一次出现的那一行
fn command_line(text: &str, h: &HookEntry) -> usize {
    let escaped = h.command.replace('\\', "\\\\").replace('"', "\\\"");
    for needle in [h.command.as_str(), escaped.as_str()] {
        if needle.trim().is_empty() {
            continue;
        }
        let (line, _) = line_of(text, needle);
        if line > 0 {
            return line;
        }
    }
    if h.event == "notify" {
        return text
            .lines()
            .position(|l| {
                l.trim_start()
                    .strip_prefix("notify")
                    .is_some_and(|rest| rest.trim_start().starts_with('='))
            })
            .map_or(0, |i| i + 1);
    }
    0
}

fn line_of(text: &str, needle: &str) -> (usize, String) {
    for (i, l) in text.lines().enumerate() {
        if l.contains(needle) {
            return (i + 1, l.trim().to_string());
        }
    }
    (0, needle.to_string())
}

/// 一次最多拿多少字节交给 [`hidden::scan`]。
///
/// **它的代价是「命中几处 × 这一段多长」**：每命中一处，它都从行首找到行尾，再把整行
/// 换成可见的样子装进结果。一行几兆、塞满零宽字符的文件（伪造起来不难）整份交给它，
/// 启动时的那一遍扫描就停在那里，内存也跟着涨满。所以按行扫，长的行再切成这么长的
/// 几段：每一处的代价就封了顶。
const HIDDEN_PIECE: usize = 256;

/// 一份文件里最多细看多少处藏起来的字符。用完了就停，并且说出来（见 [`hidden_findings`]）。
const HIDDEN_WORK: usize = 10_000;

/// 一份文件里最多列多少条藏起来的字符。
const HIDDEN_MAX: usize = 50;

/// 摘录最多多少个字符（不可见的已经换成了记号）。
const EXCERPT_MAX: usize = 240;

/// 一份文件里藏起来的东西，**同一行、同一种只报一条**。
///
/// 纯 ASCII 的行不用看：藏起来的那几种全都不是 ASCII（零宽、标签、双向控制、私用区；
/// 同形字要有西里尔或希腊字母）。长的行切成几段扫，切在词和词之间 —— 同形字是按词认的。
///
/// **有上限，到了就停，而且说出来**：列满 [`HIDDEN_MAX`] 条，或者细看的处数用完了
/// [`HIDDEN_WORK`]，就在停下的那一行留一条「从这儿往后没有再查」。悄悄少报比不扫更糟：
/// 它会给人一种「查过了」的错觉。
fn hidden_findings(src: &Source, text: &str) -> Vec<Finding> {
    let mut out = Vec::new();
    let mut work = HIDDEN_WORK;
    for (i, line) in text.split('\n').enumerate() {
        if line.is_ascii() {
            continue;
        }
        let n = i + 1;
        let mut kinds: Vec<hidden::Kind> = Vec::new();
        for (at, piece) in pieces(line, HIDDEN_PIECE) {
            if work == 0 {
                out.push(not_all_checked(src, n, out.len()));
                return out;
            }
            let hits = hidden::scan(piece);
            work = work.saturating_sub(hits.len());
            for h in hits {
                if kinds.contains(&h.kind) {
                    continue;
                }
                if out.len() == HIDDEN_MAX {
                    out.push(not_all_checked(src, n, out.len()));
                    return out;
                }
                kinds.push(h.kind);
                let bytes = at + h.bytes.start..at + h.bytes.end;
                let excerpt =
                    if line.len() == piece.len() && h.line_text.chars().count() <= EXCERPT_MAX {
                        // 整行放得下：就是整行，和从前一样
                        h.line_text
                    } else {
                        excerpt_around(line, bytes)
                    };
                out.push(hidden_finding(src, h.kind, n, excerpt));
            }
        }
    }
    out
}

/// 一行切成不超过 `max` 字节的几段，连同每段在行里的起点。**尽量切在词和词之间**：
/// 同形字按「词」认（拉丁字母和西里尔、希腊字母混在一个词里），词被切开就认不出来了。
fn pieces(line: &str, max: usize) -> impl Iterator<Item = (usize, &str)> {
    // 词由这几套字母组成（和 `tw_guard` 认同形字时用的一样），别的字符都是词的边界
    let in_word = |c: char| c.is_ascii_alphabetic() || ('\u{0370}'..='\u{052f}').contains(&c);
    let mut at = 0;
    std::iter::from_fn(move || {
        let rest = &line[at..];
        if rest.is_empty() {
            return None;
        }
        let mut cut = rest.len().min(max);
        while !rest.is_char_boundary(cut) {
            cut -= 1;
        }
        if cut < rest.len()
            && let Some((i, c)) = rest[..cut]
                .char_indices()
                .rev()
                .take_while(|(i, _)| *i >= max / 2)
                .find(|(_, c)| !in_word(*c))
        {
            cut = i + c.len_utf8();
        }
        let piece = (at, &rest[..cut]);
        at += cut;
        Some(piece)
    })
}

/// 那一处前后一小段，不可见的换成可见记号，两头被截掉的地方加「…」
fn excerpt_around(line: &str, hit: std::ops::Range<usize>) -> String {
    const AROUND: usize = 60;
    let mut start = hit.start.saturating_sub(AROUND);
    while !line.is_char_boundary(start) {
        start -= 1;
    }
    let mut end = (hit.end + AROUND).min(line.len());
    while !line.is_char_boundary(end) {
        end += 1;
    }
    let window = &line[start..end];
    // 换成可见记号那一步在 tw_guard 里：扫这一小段，拿它给的那一行
    let shown = hidden::scan(window)
        .into_iter()
        .next()
        .map_or_else(|| window.to_string(), |h| h.line_text);
    let shown: String = shown.chars().take(EXCERPT_MAX).collect();
    let before = if start > 0 { "…" } else { "" };
    let after = if end < line.len() { "…" } else { "" };
    format!("{before}{shown}{after}")
}

fn hidden_finding(src: &Source, h: hidden::Kind, line: usize, excerpt: String) -> Finding {
    // `msg!` 会把 `what` 遮住，所以句子要用到的几段先取出来
    let (slug, why) = (h.slug(), h.why());
    let name = why.split(':').next().unwrap_or("hidden characters");
    Finding {
        // 标签字符和双向控制符在任何文本里都没有正当用途
        level: if h.smuggles() {
            Level::High
        } else {
            Level::Medium
        },
        rule: slug.to_string(),
        kind: src.kind,
        client: src.client.to_string(),
        path: src.path.clone(),
        line,
        title: msg!(
            "scan.hidden",
            kind = src.kind.slug(),
            what = slug
            => "{} contains {}",
            src.kind.label(),
            name
        ),
        // 两句之间要有一个空格 —— 中文句号自己带停顿，英文句点不带，
        // 直接接上会读成「…by the model.The content of…」
        detail: msg!(
            "scan.hidden.detail",
            kind = src.kind.slug(),
            what = slug
            => "{} {}",
            why,
            src.kind.why()
        ),
        subject: excerpt.clone(),
        excerpt,
    }
}

/// 停在第 `line` 行的那一条：藏起来的字符太多，从这儿往后没有再查
fn not_all_checked(src: &Source, line: usize, listed: usize) -> Finding {
    Finding {
        level: Level::Medium,
        rule: "hidden-not-all-checked".into(),
        kind: src.kind,
        client: src.client.to_string(),
        path: src.path.clone(),
        line,
        title: msg!(
            "scan.hidden.not_all_checked",
            kind = src.kind.slug()
            => "{} was not fully checked for hidden characters",
            src.kind.label()
        ),
        detail: msg!(
            "scan.hidden.not_all_checked.detail",
            count = listed,
            line = line
            => "It holds too many to list one by one. The first {count} are listed; from line {line} on it was not checked for them."
        ),
        excerpt: String::new(),
        // 一份文件只会有一条
        subject: String::new(),
    }
}

/// 扫一批文件。**不写任何东西。**
pub fn scan(sources: &[Source], rules: &Rules) -> Report {
    let mut r = Report::default();

    for src in sources {
        let Some(text) = read(&src.path) else {
            // 悄悄跳过比不扫更糟：它会给人一种「查过了」的错觉
            r.unreadable.push(src.path.display().to_string());
            continue;
        };

        // 一、藏起来的东西。**每一份都扫**，配置文件也不例外
        r.findings.extend(hidden_findings(src, &text));

        // 二、结构化的那几类：MCP、hooks、skill
        let parsed = parse_any(src, &text);
        if let Some(v) = &parsed {
            if src.kind == sources::Kind::Mcp {
                let listed = mcp_from(src, v);
                // 按项目配的只进发现（见 `project_mcp`）
                for m in listed.iter().chain(&project_mcp(src, v)) {
                    // **远端型不是「运行一个二进制」，而是「把上下文发
                    // 出去」。**级别定成 low：它多半是用户自己有意加的，
                    // 喊高危就是狼来了；但他有权知道有这么一条出境路径。
                    if m.is_third_party() && m.enabled {
                        let (line, excerpt) = line_of(&text, m.url.as_deref().unwrap_or(""));
                        r.findings.push(Finding {
                            level: Level::Low,
                            rule: "remote-mcp".into(),
                            kind: src.kind,
                            client: src.client.to_string(),
                            path: src.path.clone(),
                            line,
                            title: msg!("scan.mcp.remote", name = m.name.clone() => "MCP server `{name}` is remote"),
                            detail: msg!(
                                "scan.mcp.remote.detail",
                                url = m.url.clone().unwrap_or_default()
                                => "That server is at {url}, and using it sends the surrounding context there."
                            ),
                            excerpt,
                            subject: format!("{}|{}", m.name, m.url.as_deref().unwrap_or("")),
                        });
                    }
                }
                r.mcp.extend(listed);
                r.mcp
                    .sort_by(|a, b| (&a.name, &a.client).cmp(&(&b.name, &b.client)));
            }
            let mut hooks = auto_commands(src, v, true);
            for h in &mut hooks {
                h.line = command_line(&text, h);
            }
            r.hooks.extend(hooks);
        }
        if src.kind == sources::Kind::Skill {
            let name = src
                .path
                .parent()
                .and_then(|p| p.file_name())
                .map(|x| x.to_string_lossy().to_string())
                .unwrap_or_default();
            let tools = allowed_tools(&text);
            // **`*` 意味着这个 skill 能用任何工具。**它可能完全正当，
            // 但用户有权知道自己装了这么一个东西
            if tools.iter().any(|t| t == "*") {
                let (line, excerpt) = line_of(&text, "*");
                r.findings.push(Finding {
                    level: Level::Medium,
                    rule: "over-broad-tools".into(),
                    kind: src.kind,
                    client: src.client.to_string(),
                    path: src.path.clone(),
                    line,
                    title: msg!("scan.skill.all_tools", name = name.clone() => "skill `{name}` declares allowed-tools: [\"*\"]"),
                    detail: msg!("scan.skill.all_tools.detail" => "That skill may use any tool. It may well need to; it is worth confirming that it does."),
                    excerpt,
                    subject: name.clone(),
                });
            }
            r.skills.push(SkillEntry {
                name,
                client: src.client.to_string(),
                path: src.path.clone(),
                allowed_tools: tools,
            });
        }

        // 三、规则集。**指令类文件扫全文**，配置类只扫命令字段 ——
        // 拿注入规则去扫一份 JSON 会把里面正常的英文说明全报一遍。
        //
        // 每一段带着它自己是哪一类：Codex 的 `notify` 在 config.toml 里（这份文件算 MCP），
        // 可它是一条和 hook 一样不经模型就执行的命令
        let v = parsed.as_ref().unwrap_or(&Val::Null);
        let commands = || {
            auto_commands(src, v, false)
                .into_iter()
                .map(|h| (h.command, true, sources::Kind::Hooks))
        };
        let targets: Vec<(String, bool, sources::Kind)> = match src.kind {
            sources::Kind::Skill
            | sources::Kind::Command
            | sources::Kind::Agent
            | sources::Kind::Instructions => vec![(text.clone(), false, src.kind)],
            sources::Kind::Hooks => commands().collect(),
            sources::Kind::Mcp => mcp_from(src, v)
                .into_iter()
                .chain(project_mcp(src, v))
                // 关掉的那些跑不起来，规则不扫它们；它们仍然在清单里
                .filter(|m| m.enabled)
                .map(|m| {
                    (
                        format!("{} {}", m.command, m.args.join(" ")),
                        true,
                        sources::Kind::Mcp,
                    )
                })
                .chain(commands())
                .collect(),
        };
        for (hay, executes, of) in targets {
            for rule in &rules.rules {
                let Some(m) = rule.re.find(&hay) else {
                    continue;
                };
                let (line, excerpt) = line_of(&text, m.as_str());
                let subject = format!("{}|{}", of.slug(), m.as_str());
                // `msg!` 会把 `rule`、`kind` 遮住，所以句子要用到的几段先取出来
                let why = rule.why.clone();
                let name = rule.name.clone();
                let (slug, label, kind_why) = (of.slug(), of.label(), of.why());
                r.findings.push(Finding {
                    // **hook 和 MCP 里的危险命令是最高级**：它们不需要
                    // 模型参与就会被执行
                    level: if executes && rule.group == "dangerous" {
                        Level::High
                    } else {
                        Level::Medium
                    },
                    rule: rule.id.clone(),
                    kind: of,
                    client: src.client.to_string(),
                    path: src.path.clone(),
                    line,
                    title: msg!(
                        "scan.rule",
                        kind = slug,
                        rule = rule.id.clone()
                        => "{} matched rule “{}”",
                        label,
                        name
                    ),
                    detail: msg!(
                        "scan.rule.detail",
                        kind = slug,
                        rule = rule.id.clone()
                        => "{}. {}",
                        why,
                        kind_why
                    ),
                    excerpt,
                    subject,
                });
            }
        }
    }

    // 高的排前面，同级按危险度排。**界面直接按这个顺序画**
    r.findings.sort_by_key(|a| (a.level, a.kind));
    r
}

/// 同名但配置不同的 MCP server（矩阵上要标记号）。
pub fn conflicting(mcp: &[McpServer]) -> Vec<String> {
    let mut by_name: std::collections::BTreeMap<&str, Vec<String>> = Default::default();
    for m in mcp {
        by_name.entry(&m.name).or_default().push(m.shape());
    }
    by_name
        .into_iter()
        .filter(|(_, shapes)| {
            let first = &shapes[0];
            shapes.iter().any(|s| s != first)
        })
        .map(|(n, _)| n.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_means_the_host_is_this_machine_not_that_the_url_mentions_it() {
        for local in [
            "http://localhost:3000/mcp",
            "http://LOCALHOST/mcp",
            "http://127.0.0.1:8080",
            "http://127.0.0.2:8080/x",
            "http://[::1]:3000/mcp",
            "http://0.0.0.0:3000",
            "http://user:pass@localhost:3000/mcp",
        ] {
            assert!(is_local(local), "{local}");
        }
        for remote in [
            "https://mcp.example.com/mcp",
            "https://localhost.evil.example/mcp",
            "https://evil.example/?r=http://127.0.0.1",
            "https://evil.example/#http://[::1]",
            "https://127.0.0.1.evil.example/",
            "https://localhost@evil.example/",
            "localhost:3000/mcp",
        ] {
            assert!(!is_local(remote), "{remote}");
        }
    }

    /// 不是普通文件的（设备、命名管道）不读：读下去就不回来了
    #[cfg(unix)]
    #[test]
    fn only_regular_files_are_read() {
        let d = tempfile::tempdir().unwrap();
        let link = d.path().join("SKILL.md");
        std::os::unix::fs::symlink("/dev/zero", &link).unwrap();
        assert_eq!(read(&link), None);
        let file = d.path().join("ok.md");
        std::fs::write(&file, "hi").unwrap();
        assert_eq!(read(&file).as_deref(), Some("hi"));
    }

    #[test]
    fn frontmatter_is_read_with_crlf_line_ends_and_a_bom() {
        let lf = "---\nname: x\nallowed-tools: [\"*\"]\n---\n\nbody\n";
        assert_eq!(allowed_tools(lf), ["*"]);
        let crlf = lf.replace('\n', "\r\n");
        assert_eq!(allowed_tools(&crlf), ["*"]);
        assert_eq!(allowed_tools(&format!("\u{feff}{crlf}")), ["*"]);
    }

    /// 长的一行切成几段：拼回去就是原来那一行，每段不超长、不切在字符中间，
    /// 也不把一个词切成两半 —— 同形字按词认，切开了就认不出来
    #[test]
    fn a_long_line_is_cut_between_words() {
        let word = "p\u{0430}ypal"; // 第二个字母是西里尔的 а
        let line = format!("{}{word} {}", "中文和 English ".repeat(12), "x".repeat(700));
        let got: Vec<_> = pieces(&line, 64).collect();
        let joined: String = got.iter().map(|(_, p)| *p).collect();
        assert_eq!(joined, line);
        let mut at = 0;
        for (start, p) in &got {
            assert_eq!(*start, at);
            assert!(p.len() <= 64, "{p:?}");
            at += p.len();
        }
        assert!(got.iter().any(|(_, p)| p.contains(word)), "{got:?}");
        // 一行塞满一个词也切得开，只是那时只能切在字符之间
        assert!(pieces(&"я".repeat(100), 64).all(|(_, p)| p.len() <= 64));
        assert_eq!(pieces("", 64).count(), 0);
    }
}
