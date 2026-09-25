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

use crate::clients::{Edit, Gateway, PROVIDER_ID};
use crate::json::Val;

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

/// 模型清单的写法：`{ "模型": { "name": "模型" } }`。
///
/// **name 不留空**：opencode 的模型选择器显示的就是它，空着就是一行空白。
/// 同名的只写一次：JSON 对象里重复的键，各家解析器取哪一个说法不一。
pub fn models_val(models: &[String]) -> Val {
    let mut seen = std::collections::HashSet::new();
    Val::Obj(
        models
            .iter()
            .filter(|m| seen.insert(m.as_str()))
            .map(|m| (m.clone(), Val::Obj(vec![("name".into(), Val::s(m))])))
            .collect(),
    )
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
        value: models_val(&gw.models),
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

/// 配置里此刻写着的模型。没有那一条就是 `None`。
pub fn models_in(text: &str) -> Option<Vec<String>> {
    let s = shape_in(text);
    match crate::json::get(text, &[s.root(), PROVIDER_ID, "models"]).ok()?? {
        Val::Obj(ms) => Some(ms.into_iter().map(|(k, _)| k).collect()),
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

/// 模型清单跟网关此刻答的不一样了（上游或路由变了）。顺序不算。
pub fn models_stale(written: &[String], now: &[String]) -> bool {
    let mut a: Vec<_> = written.iter().collect();
    let mut b: Vec<_> = now.iter().collect();
    a.sort();
    a.dedup();
    b.sort();
    b.dedup();
    a != b
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
            models: models.iter().map(|m| m.to_string()).collect(),
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
            models_val(&["a".into(), "b".into()]),
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
        let Val::Obj(ms) = models_val(&["m".into()]) else {
            unreachable!()
        };
        assert_eq!(ms[0].1, Val::Obj(vec![("name".into(), Val::s("m"))]));
        // 同名的只写一次，先后照原样
        let Val::Obj(ms) = models_val(&["b".into(), "a".into(), "b".into()]) else {
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

    #[test]
    fn a_changed_model_list_is_stale_and_a_reordered_one_is_not() {
        let s = |xs: &[&str]| xs.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(!models_stale(&s(&["a", "b"]), &s(&["b", "a"])));
        assert!(models_stale(&s(&["a"]), &s(&["a", "b"])));
        assert!(models_stale(&s(&["a", "b"]), &s(&[])));
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
