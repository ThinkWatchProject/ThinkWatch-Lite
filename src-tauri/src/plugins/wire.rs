//! PROVISIONAL：插件的 JS 文件是唯一的真相（约定附录 4，core v0.59.0、协议 35）之后的端点和
//! 类型，照约定手写。
//!
//! **core 发版之前只能这样**：钉着的 core v0.58.0 的 `tw_api` 里还没有它们，而且那一版的
//! `PluginView`、`PluginInspection` 读不了新的样子（设置项的 `value` 取代了 `default`，manifest
//! 多了 `on_error`）。`tw_api::Endpoint` 是公开的 trait，这里照它给每个端点写一份描述，
//! `call` 命令（`call.rs` 的 `provisional` 那一组）和原生确认的三个命令就能照常走
//! `ControlClient::call`。
//!
//! **网页能经过 `call` 走到的那两个读的端点（`Plugins`、`PluginInspect`），响应一律是
//! `serde_json::Value`**：原样转给网页，这里少写一个字段也不会把它从网页那边吞掉。原生确认
//! 的命令只读其中要用的几项（`Installed`、`Inspection`）。网页那一侧的类型在
//! `src/plugins/api.provisional.ts`。
//!
//! 接上正式版（core v0.59.0 发版之后）：
//!
//! 1. `Cargo.toml` 的 core 钉点升到 v0.59.0，`cargo update -p tw-api`（几个 core crate 一起），
//!    `scripts/fetch-core.sh` 取回同一版的 twcore；
//! 2. `call.rs` 里 `provisional: [...]` 那一组并进 core 那一组（`ep::Plugins` 等），
//!    三个 `…Confirmed` 照样不进；
//! 3. `plugins/mod.rs` 里的 `wire::X` 换成 `tw_api::ep::X`；`Installed`、`Inspection`、
//!    `Manifest`、`SettingSpec` 换成生成的 `PluginView`、`PluginInspection`、`ManifestView`、
//!    `SettingSpecView`，`PluginCreate`、`PluginSave`、`PluginRewriteRequest` 换成 `tw_api` 里的；
//! 4. `tests/control_plane.rs` 里插件那一条去掉 `#[ignore]`；
//! 5. 删掉这个文件，`cargo clippy --all-targets`：名字或形状不一样的地方会在用到它的那一处报错。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tw_api::{
    ConfigWritten, Endpoint, Format, Method, OnError, Permission, PluginApprove, PluginLoadError,
    PluginScope, PluginSource, RequestKind, SettingKind, SettingValue,
};

// ------------------------------------------------------------- 请求

/// 装一个插件：代码、ID 和开关。出错时怎么办、适用范围、设置都写在代码里
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginCreate {
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_version: Option<String>,
}

/// 保存一个插件：整份代码和开关
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginSave {
    pub source: String,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_version: Option<String>,
}

/// 按这些值改写代码里的 manifest。没有副作用
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRewriteRequest {
    pub source: String,
    pub on_error: OnError,
    pub scope: PluginScope,
    pub settings: BTreeMap<String, SettingValue>,
}

/// 改写之后的代码
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRewritten {
    pub source: String,
}

// ------------------------------------------------------------- 原生确认要读的那几项

/// `Plugins` 里的一个插件，原生确认要用的部分
#[derive(Debug, Clone, Deserialize)]
pub struct Installed {
    pub id: String,
    /// 读不出 manifest 时是 id
    pub name: String,
    pub enabled: bool,
    /// 读不出 manifest 时是空的
    pub permissions: Vec<Permission>,
    pub requests: Vec<RequestKind>,
    /// 确认过的那一份的 SHA-256
    pub sha256: String,
}

/// `PluginInspect` 的结果
#[derive(Debug, Clone, Deserialize)]
pub struct Inspection {
    pub manifest: Option<Manifest>,
    pub sha256: String,
    pub error: Option<PluginLoadError>,
}

/// 代码里的 manifest，原生确认要用的部分
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Manifest {
    pub name: String,
    pub permissions: Vec<Permission>,
    pub requests: Vec<RequestKind>,
    pub scope: PluginScope,
    pub on_error: OnError,
    pub settings_schema: Vec<SettingSpec>,
}

/// 一个设置项，`value` 是写在代码里的值
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct SettingSpec {
    pub key: String,
    pub kind: SettingKind,
    pub label: String,
    pub value: SettingValue,
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

        /// 这里描述的每个端点：名字、方法、路径（测试核对用）
        pub const ALL: &[(&str, Method, &str)] = &[$((stringify!($name), Method::$method, $path)),*];
    };
}

endpoints! {
    // 网页能经过 `call` 走到的（`call.rs` 的 `provisional` 那一组）
    Plugins: Get "/plugins" [] () => Value;
    PluginInspect: Post "/plugins/inspect" [] PluginSource => Value;
    PluginRewrite: Post "/plugins/rewrite" [] PluginRewriteRequest => PluginRewritten;
    CreatePlugin: Post "/plugins" [] PluginCreate => ConfigWritten;
    SavePlugin: Put "/plugins/{id}" ["id"] PluginSave => ConfigWritten;
    // **网页走不到的三个**：只有 `plugins` 里的原生确认命令调它们（约定附录 4 §3）
    CreatePluginConfirmed: Post "/plugins/confirmed" [] PluginCreate => ConfigWritten;
    SavePluginConfirmed: Put "/plugins/{id}/confirmed" ["id"] PluginSave => ConfigWritten;
    ApprovePluginFileConfirmed: Post "/plugins/{id}/approve/confirmed" ["id"] PluginApprove => ConfigWritten;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_paths_and_methods_are_the_contracts() {
        assert_eq!(
            (SavePlugin::METHOD, SavePlugin::PATH, SavePlugin::PARAMS),
            (Method::Put, "/plugins/{id}", &["id"][..])
        );
        assert_eq!(
            (SavePluginConfirmed::METHOD, SavePluginConfirmed::PATH),
            (Method::Put, "/plugins/{id}/confirmed")
        );
        assert_eq!(
            (CreatePluginConfirmed::METHOD, CreatePluginConfirmed::PATH),
            (Method::Post, "/plugins/confirmed")
        );
        assert_eq!(
            tw_api::fill(ApprovePluginFileConfirmed::PATH, &[("id", "add date")]),
            "/plugins/add%20date/approve/confirmed"
        );
        assert_eq!(
            (PluginRewrite::METHOD, PluginRewrite::PATH),
            (Method::Post, "/plugins/rewrite")
        );
    }

    /// 新的 manifest 读得出来：设置项带 `value`，有 `on_error`；读不出 manifest 的插件
    /// 权限是空的
    #[test]
    fn the_new_shapes_read() {
        let i: Inspection = serde_json::from_value(serde_json::json!({
            "manifest": {
                "name": "Answer in a chosen language", "description": null,
                "permissions": ["system"], "requests": ["conversation"],
                "scope": { "clients": [], "models": ["claude-*"], "upstreams": [] },
                "reply_mode": "block", "on_error": "skip",
                "settings_schema": [{ "key": "language", "kind": "string", "label": "Answer language", "value": "English" }],
                "hooks": { "request": true, "reply_text": false, "tool_call": false }
            },
            "sha256": "aa",
            "error": null
        }))
        .unwrap();
        let m = i.manifest.unwrap();
        assert_eq!(m.on_error, OnError::Skip);
        assert_eq!(
            m.settings_schema[0].value,
            SettingValue::String("English".into())
        );
        let p: Installed = serde_json::from_value(serde_json::json!({
            "id": "legacy", "name": "legacy", "description": null, "enabled": false,
            "on_error": "reject", "permissions": [], "requests": ["conversation"],
            "scope": { "clients": [], "models": [], "upstreams": [] }, "reply_mode": "block",
            "settings_schema": [], "sha256": "bb", "status": { "kind": "disabled" },
            "stats": { "calls": 0, "changed": 0, "rejected": 0, "errors": 0, "avg_cpu_us": 0, "last_error": null }
        }))
        .unwrap();
        assert!(p.permissions.is_empty());
    }
}
