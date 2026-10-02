//! PROVISIONAL：插件的控制面端点和类型，照 v1 约定（plugins-contract §6）手写。
//!
//! **core 发版之前只能这样**：钉着的那版 `tw_api` 里还没有它们。`tw_api::Endpoint` 是公开的
//! trait，这里照它给每个端点写一份描述（方法、路径、参数、请求和响应的类型），`call` 命令
//! 和下面的原生确认命令就能照常走 `ControlClient::call`。
//!
//! 接上正式版（core 带着这些端点发版、钉点升上去之后）：
//!
//! 1. `call.rs` 里 `provisional: [...]` 那一组挪进上面那一组（变成 `ep::Plugins` 等）；
//! 2. `plugins/mod.rs` 里的 `wire::X` 换成 `tw_api::ep::X`，请求类型换成 `tw_api` 里生成的；
//!    这里那几个只用来读响应的结构（`Inspection` 等）换成生成的类型；
//! 3. `gateway.rs` 里接 `plugin_failed` 的那一段换成 `tw_api::Event::PluginFailed`（见那里）；
//! 4. 删掉这个文件。
//!
//! **网页能经过 `call` 走到的那几个端点，响应一律是 `serde_json::Value`**：原样转给网页，
//! 这里少写一个字段也不会把它从网页那边吞掉（网页的类型在 `src/plugins/api.provisional.ts`）。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tw_api::{BaseVersion, ConfigWritten, Endpoint, Format, Method};

/// 插件申请的权限
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    System,
    Messages,
    Tools,
    Params,
    ReplyText,
    ReplyToolCalls,
}

impl Permission {
    /// 约定里的顺序，也是列给人看的顺序
    pub const ALL: [Permission; 6] = [
        Permission::System,
        Permission::Messages,
        Permission::Tools,
        Permission::Params,
        Permission::ReplyText,
        Permission::ReplyToolCalls,
    ];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OnError {
    Reject,
    Skip,
}

/// 生效的适用范围。每一项是通配，空的就是全部
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginScope {
    pub clients: Vec<String>,
    pub models: Vec<String>,
    pub upstreams: Vec<String>,
}

// ------------------------------------------------------------- 请求

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginSource {
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginCreate {
    pub source: String,
    pub id: Option<String>,
    pub enabled: bool,
    pub on_error: OnError,
    pub scope: PluginScope,
    pub settings: BTreeMap<String, Value>,
    pub base_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginUpdate {
    pub enabled: bool,
    pub on_error: OnError,
    pub scope: PluginScope,
    pub settings: BTreeMap<String, Value>,
    pub base_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginSourceReplace {
    pub source: String,
    pub base_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginApprove {
    pub sha256: String,
    pub base_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginOrder {
    pub ids: Vec<String>,
    pub base_version: Option<String>,
}

/// 约定里没写 `request_id` 的类型；请求的编号在别处（`HistoryRow.id`）都是数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginTrial {
    pub request_id: u64,
}

// ------------------------------------------------------------- 只读的那几样响应

/// `PluginInspect` 的结果里原生确认要用的部分（其余照约定，这里不读）
#[derive(Debug, Clone, Deserialize)]
pub struct Inspection {
    pub manifest: Option<Manifest>,
    pub sha256: String,
    pub error: Option<InspectError>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub name: String,
    pub permissions: Vec<Permission>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InspectError {
    pub message: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

/// `PluginSourceDiff` 里确认文件变更要用的部分
#[derive(Debug, Clone, Deserialize)]
pub struct SourceView {
    pub approved_sha256: String,
    pub current: Option<String>,
    pub current_sha256: Option<String>,
}

/// `Plugins` 里一个插件，原生确认要用的部分：它原来叫什么、要了哪些权限
#[derive(Debug, Clone, Deserialize)]
pub struct Installed {
    pub id: String,
    pub name: String,
    pub permissions: Vec<Permission>,
}

// ------------------------------------------------------------- 端点

macro_rules! endpoints {
    ($($name:ident: $method:ident $path:literal [$($param:literal),*] $req:ty => $res:ty;)*) => {
        $(
            pub struct $name;
            impl Endpoint for $name {
                const METHOD: Method = Method::$method;
                const PATH: &'static str = $path;
                const PARAMS: &'static [&'static str] = &[$($param),*];
                const FORMAT: Format = Format::Json;
                const NAME: &'static str = stringify!($name);
                type Req = $req;
                type Res = $res;
            }
        )*
    };
}

endpoints! {
    // 网页能经过 `call` 走到的（`call.rs` 的 `provisional` 那一组）
    Plugins: Get "/plugins" [] () => Value;
    PluginInspect: Post "/plugins/inspect" [] PluginSource => Value;
    UpdatePlugin: Put "/plugins/{id}" ["id"] PluginUpdate => ConfigWritten;
    PluginSourceDiff: Get "/plugins/{id}/source" ["id"] () => Value;
    DeletePlugin: Delete "/plugins/{id}" ["id"] BaseVersion => ConfigWritten;
    ReorderPlugins: Put "/plugins/order" [] PluginOrder => ConfigWritten;
    TrialPlugin: Post "/plugins/{id}/trial" ["id"] PluginTrial => Value;
    PluginLogs: Get "/plugins/{id}/logs" ["id"] () => Value;
    // **网页走不到的三个**（I12）：只有 `plugins` 里的原生确认命令调它们
    CreatePlugin: Post "/plugins" [] PluginCreate => ConfigWritten;
    ReplacePluginSource: Put "/plugins/{id}/source" ["id"] PluginSourceReplace => ConfigWritten;
    ApprovePluginFile: Post "/plugins/{id}/approve" ["id"] PluginApprove => ConfigWritten;
}

/// 事件流上的 `plugin_failed`（约定 §6）。钉着的 `tw_api::Event` 认不得它，所以在那一层
/// 解析失败的事件里再按它试一次（见 `control::subscribe_events_with`）
#[derive(Debug, Clone, Deserialize)]
pub struct PluginFailed {
    pub plugin_id: String,
    pub plugin_name: String,
    /// 约定没写类型：数或者字符串都收
    pub request_id: Option<Value>,
}

impl PluginFailed {
    /// 事件流上的一条原文，是 `plugin_failed` 就解出来
    pub fn parse(raw: &Value) -> Option<Self> {
        (raw.get("kind")?.as_str()? == "plugin_failed")
            .then(|| serde_json::from_value(raw.clone()).ok())
            .flatten()
    }

    /// 请求的编号，写成一段字
    pub fn request(&self) -> Option<String> {
        match self.request_id.as_ref()? {
            Value::Number(n) => Some(n.to_string()),
            Value::String(s) if !s.is_empty() => Some(s.clone()),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_paths_and_methods_are_the_contracts() {
        assert_eq!(
            (PluginInspect::METHOD, PluginInspect::PATH),
            (Method::Post, "/plugins/inspect")
        );
        assert_eq!(UpdatePlugin::PARAMS, &["id"]);
        assert_eq!(
            (DeletePlugin::METHOD, DeletePlugin::PATH),
            (Method::Delete, "/plugins/{id}")
        );
        assert_eq!(
            (
                ReplacePluginSource::METHOD,
                ReplacePluginSource::PATH,
                ReplacePluginSource::NAME
            ),
            (Method::Put, "/plugins/{id}/source", "ReplacePluginSource")
        );
        assert_eq!(
            tw_api::fill(ApprovePluginFile::PATH, &[("id", "add date")]),
            "/plugins/add%20date/approve"
        );
    }

    #[test]
    fn permissions_are_written_like_the_contract() {
        let all: Vec<String> = Permission::ALL
            .iter()
            .map(|p| {
                serde_json::to_value(p)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(
            all,
            [
                "system",
                "messages",
                "tools",
                "params",
                "reply_text",
                "reply_tool_calls"
            ]
        );
    }

    #[test]
    fn a_plugin_failure_on_the_event_stream_is_recognised() {
        let raw = serde_json::json!({
            "kind": "plugin_failed", "plugin_id": "add-date", "plugin_name": "附加日期",
            "request_id": 50463, "message": "boom", "at_ms": 1
        });
        let f = PluginFailed::parse(&raw).unwrap();
        assert_eq!(f.plugin_id, "add-date");
        assert_eq!(f.request().as_deref(), Some("50463"));
        let other = serde_json::json!({ "kind": "config_reloaded", "version": "x" });
        assert!(PluginFailed::parse(&other).is_none());
    }
}
