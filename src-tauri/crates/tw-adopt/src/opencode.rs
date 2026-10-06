//! opencode 的几处特殊：两种写法、要写模型清单、按版本决定要不要重启。
//!
//! **v1 和 v2 是两个程序。**2026-09 起 v2（`opencode v2.0.x`）替换了原来的
//! 二进制，配置换了一套原生写法：`provider` 成了 `providers`、`options` 成了
//! `settings`、`npm` 成了 `package`，MCP 挪进了 `mcp.servers`。v2 仍然读 v1 的
//! 写法，静默迁移成自己的；两种写法在同一份文件里同名时，**原生的整条赢**。
//!
//! 接管写的是 v1 的写法 —— 两个版本都认。只有用户文件里已经有一条原生的
//! `providers.thinkwatch` 时改那一条：否则它会把我们写的整条盖掉，而 opencode
//! 不会说一个字（实测：v2.0.16 报「Model unavailable」）。

use std::path::{Path, PathBuf};

use crate::clients::{Edit, Gateway, ModelCard, PROVIDER_ID};
use crate::json::Val;
use crate::plan::lookup;

/// v1 写法里的包名。**不写它的话**：v1 默认也是这个包，但 v2 迁移时不补默认值，
/// 用的时候报 `Unsupported package`（实测 v2.0.16）。
pub const NPM: &str = "@ai-sdk/openai-compatible";

/// v2 原生写法里的包名：同一个包，前面带 `aisdk:`。
pub const PACKAGE: &str = "aisdk:@ai-sdk/openai-compatible";

/// provider 按哪一种写法写。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shape {
    /// `provider.thinkwatch.{npm, options}`，v1 和 v2 都认
    V1,
    /// `providers.thinkwatch.{package, settings}`，只有 v2 认
    Native,
}

impl Shape {
    fn root(self) -> &'static str {
        match self {
            Shape::V1 => "provider",
            Shape::Native => "providers",
        }
    }
    fn settings(self) -> &'static str {
        match self {
            Shape::V1 => "options",
            Shape::Native => "settings",
        }
    }
    fn package(self) -> (&'static str, &'static str) {
        match self {
            Shape::V1 => ("npm", NPM),
            Shape::Native => ("package", PACKAGE),
        }
    }
}

/// 这份配置里该改哪一种写法：已经有原生的那一条就改它，否则写 v1 的。
pub fn shape_in(text: &str) -> Shape {
    match crate::json::get(text, &["providers", PROVIDER_ID]) {
        Ok(Some(_)) => Shape::Native,
        _ => Shape::V1,
    }
}

/// 模型清单的写法：`{ "模型": { "name": "模型", 规格… } }`，规格见 [`specs`]。
///
/// **name 不留空**：opencode 的模型选择器显示的就是它，空着就是一行空白。
/// 同名的只写一次：JSON 对象里重复的键，各家解析器取哪一个说法不一。
pub fn models_val(models: &[ModelCard], shape: Shape) -> Val {
    let mut seen = std::collections::HashSet::new();
    Val::Obj(
        models
            .iter()
            .filter(|m| seen.insert(m.id.as_str()))
            .map(|m| {
                let mut fields = vec![("name".to_string(), Val::s(&m.id))];
                fields.extend(specs(m, shape));
                (m.id.clone(), Val::Obj(fields))
            })
            .collect(),
    )
}

/// 一个模型的规格，按这一种写法写得下的写。网关没答的那一项不写。
///
/// **v1**（`config/provider.ts` 的 `Model`）：
///
/// - `limit: {context, output}`：两项都是必填的，只写一项整份配置读不进去。不写时两项都按
///   0 算：上下文 0 是「不知道」，**自动压缩永远不触发**；输出 0 按 32000 发。所以上下文知道、
///   输出不知道时输出写 0 —— 就是它自己不知道时的那个值。上下文不知道时整项不写：v2 读 v1
///   写法时照搬 `limit`，写一个 0 进去会盖掉它自己的默认值 200000，压缩在 v2 上也不触发了。
///   请求里的输出上限是 `min(output, 32000)`，写得再大也不会照着发
/// - `reasoning`：会不会推理，决定有没有推理档位（`variants`）
/// - 收不收图看的是 `modalities.input` 里有没有 `image`：没有的话，贴进去的图在发出去之前
///   换成一句「这个模型不收图」（`transform.ts` 的 `unsupportedParts`）。`attachment` 只是
///   同一件事的标记，一起写。**写 `modalities` 时连 `tool_call: true` 和 `output: [text]` 一起
///   写**：两项都是 v1 本来的默认值，可 v2 迁移 v1 写法时，`modalities` 一在，没写的那两项
///   就不按默认值补了（主干的 `v1/config/migrate.ts` 补成不能调工具、什么都不输出）
///
/// **原生**（v2 `schema/src/config/provider.ts`）：`limit.{context, output}` 两项各自可选；
/// `capabilities.input` 单写，没写的 `tools`、`output` 照它自己的默认值补（`mergeCapabilities`）。
/// 没有推理开关：推理档位按 `variants` 来，不写。
pub fn specs(m: &ModelCard, shape: Shape) -> Vec<(String, Val)> {
    let num = |n: u64| Val::Num(n.to_string());
    let input = |image: bool| {
        let mut v = vec![Val::s("text")];
        if image {
            v.push(Val::s("image"));
        }
        Val::Arr(v)
    };
    let (context, output) = (
        m.context_window.filter(|n| *n > 0),
        m.max_output_tokens.filter(|n| *n > 0),
    );
    let mut v = Vec::new();
    match shape {
        Shape::V1 => {
            if let Some(c) = context {
                v.push((
                    "limit".into(),
                    Val::Obj(vec![
                        ("context".into(), num(c)),
                        ("output".into(), num(output.unwrap_or(0))),
                    ]),
                ));
            }
            if let Some(b) = m.reasoning {
                v.push(("reasoning".into(), Val::Bool(b)));
            }
            if let Some(image) = m.image_input {
                v.push(("attachment".into(), Val::Bool(image)));
                v.push(("tool_call".into(), Val::Bool(true)));
                v.push((
                    "modalities".into(),
                    Val::Obj(vec![
                        ("input".into(), input(image)),
                        ("output".into(), Val::Arr(vec![Val::s("text")])),
                    ]),
                ));
            }
        }
        Shape::Native => {
            let limit: Vec<(String, Val)> = [("context", context), ("output", output)]
                .into_iter()
                .filter_map(|(k, n)| Some((k.to_string(), num(n?))))
                .collect();
            if !limit.is_empty() {
                v.push(("limit".into(), Val::Obj(limit)));
            }
            if let Some(image) = m.image_input {
                v.push((
                    "capabilities".into(),
                    Val::Obj(vec![("input".into(), input(image))]),
                ));
            }
        }
    }
    v
}

/// 接管要写的那几项。
///
/// **`models` 必须写**：v1 会把没有模型的 provider 整个删掉，v2 没有模型就无从
/// 选起。清单是网关对这把密钥答的 `GET /v1/models`，见 [`Gateway::models`]。
pub fn edits(gw: &Gateway, shape: Shape) -> Vec<Edit> {
    let at = |ks: &[&str]| {
        std::iter::once(shape.root())
            .chain(std::iter::once(PROVIDER_ID))
            .chain(ks.iter().copied())
            .map(str::to_string)
            .collect::<Vec<_>>()
    };
    let (pkg_key, pkg) = shape.package();
    let mut v = vec![
        Edit {
            path: at(&["name"]),
            value: Val::s("ThinkWatch"),
            secret: false,
        },
        Edit {
            path: at(&[pkg_key]),
            value: Val::s(pkg),
            secret: false,
        },
        Edit {
            path: at(&[shape.settings(), "baseURL"]),
            value: Val::s(format!("{}/v1", gw.base.trim_end_matches('/'))),
            secret: false,
        },
    ];
    if let Some(k) = &gw.key {
        v.push(Edit {
            path: at(&[shape.settings(), "apiKey"]),
            value: Val::s(k),
            secret: true,
        });
    }
    v.push(Edit {
        path: at(&["models"]),
        value: models_val(&gw.models, shape),
        secret: false,
    });
    v
}

/// 配置里此刻指向哪儿。**原生的那一条优先** —— v2 认的是它。
pub fn endpoint(text: &str) -> Option<String> {
    [Shape::Native, Shape::V1].into_iter().find_map(|s| {
        crate::json::get(text, &[s.root(), PROVIDER_ID, s.settings(), "baseURL"])
            .ok()
            .flatten()
            .map(|v| v.to_line())
    })
}

/// 配置里此刻写着的模型，连同写着的规格（见 [`specs`]）。没有那一条就是 `None`。
pub fn models_in(text: &str) -> Option<Vec<ModelCard>> {
    use crate::pi::{count_of, flag_of, image_of};
    let s = shape_in(text);
    let card = |id: String, m: &Val| {
        let image = match s {
            Shape::V1 => image_of(lookup(m, &["modalities", "input"])),
            Shape::Native => image_of(lookup(m, &["capabilities", "input"])),
        };
        ModelCard {
            id,
            context_window: count_of(lookup(m, &["limit", "context"])),
            max_output_tokens: count_of(lookup(m, &["limit", "output"])),
            reasoning: match s {
                Shape::V1 => flag_of(lookup(m, &["reasoning"])),
                Shape::Native => None,
            },
            image_input: image,
        }
    };
    match crate::json::get(text, &[s.root(), PROVIDER_ID, "models"]).ok()?? {
        Val::Obj(ms) => Some(ms.into_iter().map(|(k, m)| card(k, &m)).collect()),
        _ => Some(Vec::new()),
    }
}

/// 一份文件里会盖住我们写的那几条（两种写法都算）。
pub fn overriding(text: &str) -> Vec<String> {
    [Shape::Native, Shape::V1]
        .into_iter()
        .map(|s| [s.root(), PROVIDER_ID])
        .filter(|p| matches!(crate::json::get(text, p), Ok(Some(_))))
        .map(|p| p.join("."))
        .collect()
}

/// 一个模型写进配置再读回来的样子，见 [`crate::clients::Client::as_written`]。
///
/// 取的是两种写法都写得下的那几项（见 [`specs`]）：这里不知道文件是哪一种写法，而比的
/// 两边（[`models_in`] 读回来的、网关答的）都要过一遍它，取交集两边就对得上。代价是原生
/// 写法能单写的输出上限、v1 能写的推理开关单独变了不提示更新 —— 下一次接管照样写进去。
pub fn as_written(m: &ModelCard) -> ModelCard {
    let context_window = m.context_window.filter(|n| *n > 0);
    ModelCard {
        id: m.id.clone(),
        context_window,
        max_output_tokens: context_window.and(m.max_output_tokens.filter(|n| *n > 0)),
        reasoning: None,
        image_input: m.image_input,
    }
}

// ---------------------------------------------------------------- 版本

/// `opencode --version` 的输出里第一个 `x.y.z`。v1 打印 `1.18.32`，v2 打印
/// `opencode v2.0.16`。
pub fn parse_version(out: &str) -> Option<(u32, u32, u32)> {
    out.split(|c: char| c.is_whitespace() || c == ',')
        .map(|w| w.trim_start_matches(['v', 'V']))
        .find_map(|w| {
            let mut it = w.splitn(3, '.');
            let major = it.next()?.parse().ok()?;
            let minor = it.next()?.parse().ok()?;
            // `2.0.16-beta.1` 这种，第三段只取开头的数字
            let rest = it.next()?;
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            Some((major, minor, digits.parse().ok()?))
        })
}

/// 它通常装在哪。
///
/// **不按 PATH 找**：谁往 PATH 前面塞一个同名程序，它就跟着应用一起跑起来了
/// （同 `detect::running_since`）；何况从访达打开的应用本来就拿不到用户 shell 里的
/// PATH。这几处是官方安装脚本（v1 和 v2 都装到 `~/.opencode/bin`）、Homebrew、
/// npm 全局目录和 Scoop 放它的地方。
fn candidates(home: &Path) -> Vec<PathBuf> {
    let exe = if cfg!(windows) {
        "opencode.exe"
    } else {
        "opencode"
    };
    let mut v = vec![home.join(".opencode").join("bin").join(exe)];
    // 系统目录只在问的就是这个进程自己的 home 时才看：测试传来的临时目录底下
    // 装着什么是测试说了算，不能被开发者自己机器上装的那一份带偏
    #[cfg(not(windows))]
    if crate::paths::env_home().as_deref() == Some(home) {
        v.extend(
            [
                "/opt/homebrew/bin/opencode",
                "/usr/local/bin/opencode",
                "/usr/bin/opencode",
            ]
            .map(PathBuf::from),
        );
    }
    v.push(home.join(".local").join("bin").join(exe));
    v.push(home.join(".bun").join("bin").join(exe));
    #[cfg(windows)]
    v.push(home.join("scoop").join("shims").join(exe));
    v
}

/// 跑一次 `--version`，最多等几秒。
fn run_version(bin: &Path) -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    let mut cmd = Command::new(bin);
    cmd.arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().ok()?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    Some(out)
}

/// 装着的 opencode 的主版本号。找不到、跑不起来就是 `None`。
///
/// **按文件记一份**：客户端页每次刷新都要问，而文件没换就不会变；换了（升级）
/// 修改时刻就变了，重新问一次。
pub fn major(home: &Path) -> Option<u32> {
    use std::sync::Mutex;
    type Seen = (PathBuf, Option<std::time::SystemTime>, Option<u32>);
    static SEEN: Mutex<Vec<Seen>> = Mutex::new(Vec::new());

    let bin = candidates(home).into_iter().find(|p| p.is_file())?;
    let mtime = std::fs::metadata(&bin).and_then(|m| m.modified()).ok();
    if let Ok(seen) = SEEN.lock()
        && let Some((_, _, v)) = seen.iter().find(|(p, t, _)| *p == bin && *t == mtime)
    {
        return *v;
    }
    // 没跑起来（正在被替换、一时拿不到）不记，下次再问
    let v = parse_version(&run_version(&bin)?).map(|(m, _, _)| m);
    if let Ok(mut seen) = SEEN.lock() {
        seen.retain(|(p, _, _)| *p != bin);
        seen.push((bin, mtime, v));
    }
    v
}

/// 它自己会重读配置，改完不用重启。
///
/// v2 有常驻的后台服务，盯着配置目录，改了就重载（实测 v2.0.16：同一个服务，
/// 改完配置下一次请求就走新的 provider）。v1 只在启动时读一次。**认不出版本就
/// 按 v1 说** —— 多提醒一句重启，比该重启的时候不说要好。
pub fn reloads_by_itself(home: &Path) -> bool {
    major(home).is_some_and(|m| m >= 2)
}

// ---------------------------------------------------------------- MCP

/// 一个 MCP server 写在哪一种写法下。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpShape {
    /// 扁平的 `mcp.<名>`，开关叫 `enabled`
    V1,
    /// `mcp.servers.<名>`，开关叫 `disabled`
    Native,
}

/// opencode 配置里的一个 MCP server。
#[derive(Debug, Clone, PartialEq)]
pub struct McpEntry {
    pub name: String,
    pub shape: McpShape,
    /// 在配置里的路径（`["mcp", "servers", 名]` 或 `["mcp", 名]`）
    pub path: Vec<String>,
    pub value: Val,
}

fn field<'a>(v: &'a Val, key: &str) -> Option<&'a Val> {
    match v {
        Val::Obj(ms) => ms.iter().find(|(k, _)| k == key).map(|(_, v)| v),
        _ => None,
    }
}

/// 这一条本身就是一个写成扁平写法的 server（名字恰好叫 `servers` 或 `timeout`）。
fn is_server_itself(v: &Val) -> bool {
    matches!(field(v, "type"), Some(Val::Str(t)) if t == "local" || t == "remote")
}

/// 只有 `{enabled}`、没有 `type` 的条目。v1 拿它开关一个在别处定义的 server；
/// v2 直接丢掉它。**它不是一个 server**，不列。
fn is_enabled_only(v: &Val) -> bool {
    field(v, "type").is_none() && matches!(field(v, "enabled"), Some(Val::Bool(_)))
}

/// opencode 配置里的所有 MCP server：扁平的 `mcp.<名>`、`mcp.servers.<名>`，
/// 以及两者混在一起。**同名的以 `servers` 里的为准**，和 v2 自己的做法一样。
///
/// `mcp.timeout` 是全局默认值，不是 server，跳过。
pub fn mcp_servers(root: &Val) -> Vec<McpEntry> {
    let (mut flat, native) = both_shapes(root);
    flat.retain(|f| !native.iter().any(|n| n.name == f.name));
    flat.extend(native);
    flat
}

/// 叫这个名字的 server 在配置里的所有位置：`servers` 里的和扁平的都算，
/// **两处都有就两处都给** —— 删一个 server 要两处都删，只删赢的那一处，
/// 另一处会顶上来。
pub fn mcp_paths(root: &Val, name: &str) -> Vec<Vec<String>> {
    let (flat, native) = both_shapes(root);
    native
        .into_iter()
        .chain(flat)
        .filter(|m| m.name == name)
        .map(|m| m.path)
        .collect()
}

/// 扁平的和 `servers` 里的，各自一份，还没按同名去重。
fn both_shapes(root: &Val) -> (Vec<McpEntry>, Vec<McpEntry>) {
    let Some(Val::Obj(mcp)) = field(root, "mcp") else {
        return (Vec::new(), Vec::new());
    };
    let mut flat = Vec::new();
    let mut native = Vec::new();
    for (name, v) in mcp {
        if (name == "servers" || name == "timeout") && !is_server_itself(v) {
            if name == "servers"
                && let Val::Obj(ss) = v
            {
                for (n, s) in ss {
                    if matches!(s, Val::Obj(_)) {
                        native.push(McpEntry {
                            name: n.clone(),
                            shape: McpShape::Native,
                            path: vec!["mcp".into(), "servers".into(), n.clone()],
                            value: s.clone(),
                        });
                    }
                }
            }
            continue;
        }
        if !matches!(v, Val::Obj(_)) || is_enabled_only(v) {
            continue;
        }
        flat.push(McpEntry {
            name: name.clone(),
            shape: McpShape::V1,
            path: vec!["mcp".into(), name.clone()],
            value: v.clone(),
        });
    }
    (flat, native)
}

impl McpEntry {
    /// 要执行的整条命令（程序 + 参数）。两种写法都是字符串数组。
    pub fn command(&self) -> Vec<String> {
        match field(&self.value, "command") {
            Some(Val::Arr(es)) => es.iter().map(|e| e.to_line()).collect(),
            // 写成一个字符串的，照它原样当程序
            Some(Val::Str(s)) => vec![s.clone()],
            _ => Vec::new(),
        }
    }
    /// 远端型的地址。
    pub fn url(&self) -> Option<String> {
        field(&self.value, "url").and_then(|v| v.as_str().map(str::to_string))
    }
    /// 环境变量的名字。**只有名字，没有值** —— 值里常常就是密钥。
    pub fn env_keys(&self) -> Vec<String> {
        match field(&self.value, "environment") {
            Some(Val::Obj(ms)) => ms.iter().map(|(k, _)| k.clone()).collect(),
            _ => Vec::new(),
        }
    }
    /// 开着的。v1 看 `enabled`，v2 看 `disabled`；没写都是开着。
    pub fn enabled(&self) -> bool {
        match self.shape {
            McpShape::V1 => field(&self.value, "enabled") != Some(&Val::Bool(false)),
            McpShape::Native => field(&self.value, "disabled") != Some(&Val::Bool(true)),
        }
    }
    /// 换成别的客户端认的那种写法：本地的 `{command, args, env}`，远端的
    /// `{url, headers}`。搬到别的客户端时用。
    pub fn portable(&self) -> Val {
        let mut out = Vec::new();
        if let Some(u) = self.url() {
            out.push(("url".to_string(), Val::s(u)));
            if let Some(h) = field(&self.value, "headers") {
                out.push(("headers".to_string(), h.clone()));
            }
            return Val::Obj(out);
        }
        let mut cmd = self.command().into_iter();
        out.push((
            "command".to_string(),
            Val::s(cmd.next().unwrap_or_default()),
        ));
        let args: Vec<Val> = cmd.map(Val::Str).collect();
        if !args.is_empty() {
            out.push(("args".to_string(), Val::Arr(args)));
        }
        if let Some(e) = field(&self.value, "environment") {
            out.push(("env".to_string(), e.clone()));
        }
        Val::Obj(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gw(models: &[&str]) -> Gateway {
        Gateway {
            base: "http://127.0.0.1:8788".into(),
            key: Some("tw-k".into()),
            models: models.iter().map(|m| ModelCard::named(*m)).collect(),
        }
    }

    #[test]
    fn the_version_is_the_first_dotted_triple() {
        assert_eq!(parse_version("1.18.32\n"), Some((1, 18, 32)));
        assert_eq!(parse_version("opencode v2.0.16\n"), Some((2, 0, 16)));
        assert_eq!(parse_version("opencode v2.1.0-beta.3"), Some((2, 1, 0)));
        assert_eq!(parse_version("opencode"), None);
        assert_eq!(parse_version(""), None);
    }

    /// v1 的写法两个版本都认；已经有原生那一条的，改那一条
    #[test]
    fn the_shape_follows_what_is_already_there() {
        assert_eq!(shape_in("{}"), Shape::V1);
        assert_eq!(shape_in(r#"{"provider": {"thinkwatch": {}}}"#), Shape::V1);
        assert_eq!(
            shape_in(r#"{"providers": {"thinkwatch": {"name": "x"}}}"#),
            Shape::Native
        );
        // 别的原生 provider 不算
        assert_eq!(shape_in(r#"{"providers": {"openai": {}}}"#), Shape::V1);
    }

    #[test]
    fn every_edit_has_a_package_and_named_models() {
        let paths = |s| {
            edits(&gw(&["a", "b"]), s)
                .into_iter()
                .map(|e| (e.path.join("."), e.value, e.secret))
                .collect::<Vec<_>>()
        };
        let v1 = paths(Shape::V1);
        assert!(v1.contains(&("provider.thinkwatch.npm".into(), Val::s(NPM), false)));
        assert!(v1.contains(&(
            "provider.thinkwatch.options.baseURL".into(),
            Val::s("http://127.0.0.1:8788/v1"),
            false
        )));
        assert!(v1.contains(&(
            "provider.thinkwatch.options.apiKey".into(),
            Val::s("tw-k"),
            true
        )));
        assert!(v1.contains(&(
            "provider.thinkwatch.models".into(),
            models_val(&["a".into(), "b".into()], Shape::V1),
            false
        )));
        let native = paths(Shape::Native);
        assert!(native.contains(&(
            "providers.thinkwatch.package".into(),
            Val::s(PACKAGE),
            false
        )));
        assert!(
            native
                .iter()
                .any(|(p, _, s)| p == "providers.thinkwatch.settings.apiKey" && *s)
        );
        // name 不留空
        let Val::Obj(ms) = models_val(&["m".into()], Shape::V1) else {
            unreachable!()
        };
        assert_eq!(ms[0].1, Val::Obj(vec![("name".into(), Val::s("m"))]));
        // 同名的只写一次，先后照原样
        let Val::Obj(ms) = models_val(&["b".into(), "a".into(), "b".into()], Shape::V1) else {
            unreachable!()
        };
        let keys: Vec<_> = ms.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, ["b", "a"]);
    }

    #[test]
    fn the_endpoint_and_models_are_read_from_the_entry_v2_would_use() {
        let both = r#"{
          "provider": {"thinkwatch": {"options": {"baseURL": "http://old/v1"}, "models": {"x": {}}}},
          "providers": {"thinkwatch": {"settings": {"baseURL": "http://new/v1"}, "models": {"a": {}, "b": {}}}}
        }"#;
        assert_eq!(endpoint(both).as_deref(), Some("http://new/v1"));
        assert_eq!(models_in(both), Some(vec!["a".into(), "b".into()]));
        assert_eq!(
            overriding(both),
            vec!["providers.thinkwatch", "provider.thinkwatch"]
        );
        let v1 = r#"{"provider": {"thinkwatch": {"options": {"baseURL": "http://old/v1"}}}}"#;
        assert_eq!(endpoint(v1).as_deref(), Some("http://old/v1"));
        assert_eq!(models_in(v1), None);
        assert_eq!(models_in("{}"), None);
    }

    fn card(
        id: &str,
        context: Option<u64>,
        output: Option<u64>,
        reasoning: Option<bool>,
        image: Option<bool>,
    ) -> ModelCard {
        ModelCard {
            id: id.into(),
            context_window: context,
            max_output_tokens: output,
            reasoning,
            image_input: image,
        }
    }

    /// 把一份清单照这一种写法写进一份空配置
    fn written(models: &[ModelCard], shape: Shape) -> String {
        let gw = Gateway {
            models: models.to_vec(),
            ..gw(&[])
        };
        let base = match shape {
            Shape::V1 => "{}".to_string(),
            Shape::Native => r#"{"providers": {"thinkwatch": {}}}"#.to_string(),
        };
        edits(&gw, shape).iter().fold(base, |t, e| {
            let p: Vec<&str> = e.path.iter().map(String::as_str).collect();
            crate::json::set(&t, &p, &e.value).unwrap()
        })
    }

    #[test]
    fn v1_carries_limits_reasoning_and_image_input() {
        let full = card("m", Some(200_000), Some(64_000), Some(true), Some(true));
        let Val::Obj(ms) = models_val(std::slice::from_ref(&full), Shape::V1) else {
            unreachable!()
        };
        assert_eq!(
            ms[0].1,
            crate::json::value(
                r#"{"name": "m", "limit": {"context": 200000, "output": 64000}, "reasoning": true,
                    "attachment": true, "tool_call": true,
                    "modalities": {"input": ["text", "image"], "output": ["text"]}}"#
            )
            .unwrap()
        );
        // 不知道的不写；只知道上下文时输出写 0（它自己不知道时的值），只知道输出时整个 limit 不写
        let Val::Obj(ms) = models_val(
            &[
                card("a", None, None, None, None),
                card("b", Some(128_000), None, Some(false), Some(false)),
                card("c", None, Some(8_192), None, None),
            ],
            Shape::V1,
        ) else {
            unreachable!()
        };
        assert_eq!(ms[0].1, Val::Obj(vec![("name".into(), Val::s("a"))]));
        assert_eq!(
            ms[1].1,
            crate::json::value(
                r#"{"name": "b", "limit": {"context": 128000, "output": 0}, "reasoning": false,
                    "attachment": false, "tool_call": true,
                    "modalities": {"input": ["text"], "output": ["text"]}}"#
            )
            .unwrap()
        );
        assert_eq!(ms[2].1, Val::Obj(vec![("name".into(), Val::s("c"))]));
    }

    #[test]
    fn native_carries_what_its_schema_holds() {
        let Val::Obj(ms) = models_val(
            &[
                card("m", Some(200_000), Some(64_000), Some(true), Some(false)),
                card("o", None, Some(8_192), None, None),
            ],
            Shape::Native,
        ) else {
            unreachable!()
        };
        // 没有推理开关
        assert_eq!(
            ms[0].1,
            crate::json::value(
                r#"{"name": "m", "limit": {"context": 200000, "output": 64000},
                    "capabilities": {"input": ["text"]}}"#
            )
            .unwrap()
        );
        assert_eq!(
            ms[1].1,
            crate::json::value(r#"{"name": "o", "limit": {"output": 8192}}"#).unwrap()
        );
    }

    /// 写进去再读回来，过一遍 `as_written` 和网关答的对得上；规格变了就对不上
    #[test]
    fn specs_read_back_as_written_in_either_shape() {
        let c = crate::clients::adoptable()
            .into_iter()
            .find(|c| c.id == "opencode")
            .unwrap();
        let now = vec![
            card("full", Some(200_000), Some(64_000), Some(true), Some(true)),
            card("ctx", Some(128_000), None, None, Some(false)),
            card("out", None, Some(8_192), Some(false), None),
            card("bare", None, None, None, None),
        ];
        for shape in [Shape::V1, Shape::Native] {
            let text = written(&now, shape);
            assert_eq!(shape_in(&text), shape);
            let back = models_in(&text).unwrap();
            assert!(!c.models_stale(&back, &now), "{shape:?}: {back:?}");
            let mut changed = now.clone();
            changed[0].context_window = Some(400_000);
            assert!(c.models_stale(&back, &changed), "{shape:?}");
            let mut changed = now.clone();
            changed[1].image_input = Some(true);
            assert!(c.models_stale(&back, &changed), "{shape:?}");
        }
        let back = models_in(&written(&now, Shape::V1)).unwrap();
        assert_eq!(back[0], now[0]);
        // 输出写的是 0，读回来是不知道
        assert_eq!(back[1], now[1]);
        let back = models_in(&written(&now, Shape::Native)).unwrap();
        assert_eq!(back[2].max_output_tokens, Some(8_192));
        assert_eq!(back[0].reasoning, None);
    }

    #[test]
    fn mcp_servers_are_read_in_both_shapes_and_servers_wins() {
        let v = crate::json::value(
            r#"{
              "mcp": {
                "timeout": {"catalog": 5000},
                "toggle": {"enabled": false},
                "fs": {"type": "local", "command": ["npx", "-y", "fs"], "environment": {"TOKEN": "s"}, "enabled": false},
                "both": {"type": "local", "command": ["old"]},
                "servers": {
                  "both": {"type": "local", "command": ["new", "--x"], "disabled": false},
                  "web": {"type": "remote", "url": "https://mcp.example.com", "disabled": true}
                }
              }
            }"#,
        )
        .unwrap();
        let got = mcp_servers(&v);
        let names: Vec<_> = got.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, ["fs", "both", "web"]);
        let fs = &got[0];
        assert_eq!(fs.shape, McpShape::V1);
        assert_eq!(fs.command(), ["npx", "-y", "fs"]);
        assert_eq!(fs.env_keys(), ["TOKEN"]);
        assert!(!fs.enabled());
        let both = &got[1];
        assert_eq!(both.shape, McpShape::Native);
        assert_eq!(both.path, ["mcp", "servers", "both"]);
        assert_eq!(both.command(), ["new", "--x"]);
        assert!(both.enabled());
        let web = &got[2];
        assert_eq!(web.url().as_deref(), Some("https://mcp.example.com"));
        assert!(!web.enabled());
        assert_eq!(
            fs.portable(),
            crate::json::value(
                r#"{"command": "npx", "args": ["-y", "fs"], "env": {"TOKEN": "s"}}"#
            )
            .unwrap()
        );
    }

    #[test]
    fn removing_a_server_takes_it_from_both_places() {
        let v = crate::json::value(
            r#"{"mcp": {"x": {"type": "local", "command": ["a"]}, "servers": {"x": {"type": "local", "command": ["b"]}}}}"#,
        )
        .unwrap();
        assert_eq!(
            mcp_paths(&v, "x"),
            vec![vec!["mcp", "servers", "x"], vec!["mcp", "x"]]
        );
        assert!(mcp_paths(&v, "y").is_empty());
    }

    /// 名字恰好叫 `servers` / `timeout` 的扁平 server 照样是 server
    #[test]
    fn a_flat_server_named_servers_is_still_a_server() {
        let v = crate::json::value(
            r#"{"mcp": {"servers": {"type": "local", "command": ["x"]}, "timeout": {"type": "remote", "url": "http://h"}}}"#,
        )
        .unwrap();
        let names: Vec<_> = mcp_servers(&v).into_iter().map(|m| m.name).collect();
        assert_eq!(names, ["servers", "timeout"]);
    }

    /// 找不到它就是不知道，不是「v2」
    #[test]
    fn an_unknown_version_is_treated_as_v1() {
        let d = tempfile::tempdir().unwrap();
        assert!(!reloads_by_itself(d.path()));
    }

    #[cfg(unix)]
    #[test]
    fn the_version_is_asked_of_the_installed_binary() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let bin = d.path().join(".opencode/bin/opencode");
        std::fs::create_dir_all(bin.parent().unwrap()).unwrap();
        std::fs::write(&bin, "#!/bin/sh\necho 'opencode v2.0.16'\n").unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        // 刚写完的脚本偶尔会撞上别的测试线程 fork 时带走的写句柄（ETXTBSY），再问一次
        let got = (0..20).find_map(|_| {
            major(d.path()).or_else(|| {
                std::thread::sleep(std::time::Duration::from_millis(50));
                None
            })
        });
        assert_eq!(got, Some(2));
        assert!(reloads_by_itself(d.path()));
    }
}
