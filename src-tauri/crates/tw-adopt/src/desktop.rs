//! Claude Desktop：官方的「第三方推理」模式（Claude on third-party）。
//!
//! 文档：<https://claude.com/docs/third-party/claude-desktop/overview>，同目录下的
//! configuration、gateway、installation 三页。个人在自己电脑上就能用，不需要
//! MDM，也不需要 Anthropic 账号：应用里 Developer → Configure Third-Party
//! Inference → Apply Changes，写的就是下面这几个文件。
//!
//! **别的客户端改一个文件，它要改四个**：
//!
//! | 文件 | 写什么 |
//! |---|---|
//! | `Claude-3p/configLibrary/<我们的 id>.json` | 网关地址、密钥、鉴权方式、模型列表 —— 主文件 |
//! | `Claude-3p/configLibrary/_meta.json` | 在 `entries` 里登记这一份，`appliedId` 指向它 |
//! | `Claude-3p/claude_desktop_config.json` | `deploymentMode: "3p"` |
//! | `Claude/claude_desktop_config.json` | `deploymentMode: "3p"` |
//!
//! 后三个是主文件的 [`Plan::also`]，各自走同一套差异、备份、原子写和旁文件。
//! `deploymentMode` 官方文档没写，是社区验证过的键（CC Switch 两处都写）：
//! 应用启动时读它决定进哪个模式，不写的话第一次打开要在登录页自己选。
//!
//! 两个 `claude_desktop_config.json` 里还放着用户的 MCP 服务器（MCP 页改的就是
//! `Claude` 那一份），**只合并写 `deploymentMode` 这一个键**。
//!
//! 不写的两个键，CC Switch 写了：
//!
//! - `disableDeploymentModeChooser: true`。官方文档说它只是在登录页上藏起
//!   Claude.ai 登录的选项；进不进第三方模式，看的是配置里有没有推理提供方和
//!   凭据（overview 一页：「detects 3P mode at launch from the configured
//!   inference provider」）。CC Switch 从第一个提交起就写它，提交记录里没有
//!   说明为什么，也找不到不写就不生效的报告。不写，用户仍然能在登录页上
//!   选回官方登录。
//! - `coworkEgressAllowedHosts: ["*"]`。放开 Cowork 沙箱的全部外网访问 —— 这是
//!   替用户拆掉一道安全边界，和「指向网关」无关。

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use tw_types::{Msg, msg};

use crate::clients::{Client, Edit, Format, Gateway};
use crate::cloud::{Around, Cloud};
use crate::json::Val;
use crate::paths::Loc;
use crate::plan::{self, Plan, PlanError, Target};
use crate::{foreign, sentinel};

/// 它在接管表里的 id
pub const ID: &str = "claude-desktop";

/// 我们在它配置库里那一份的 id。
///
/// **固定的**：重复接管找得到上一次那一份，还原也只认它；换一台机器、重装一次
/// 都是同一个，诊断和还原不用去猜哪一份是我们的。形状照应用自己生成的那种
/// （UUID），它拿这个当文件名。
pub const PROFILE_ID: &str = "7477a7c4-1ce0-4d3a-9b1e-7477a7c40001";

/// 那一份在应用里显示的名字
pub const PROFILE_NAME: &str = "ThinkWatch";

/// 第三方推理模式的数据目录，照官方文档：macOS 在 `Application Support` 下，
/// Windows 在本地（不是漫游）的 AppData 下，Linux 跟着 XDG。
pub const THIRD_PARTY_DIR: Loc = if cfg!(windows) {
    Loc::Home("AppData/Local/Claude-3p")
} else if cfg!(target_os = "macos") {
    Loc::Home("Library/Application Support/Claude-3p")
} else {
    Loc::XdgConfig("Claude-3p")
};

/// 平常那个数据目录：放 MCP 服务器的那一份 `claude_desktop_config.json` 就在
/// 这里（见 [`crate::paths::CLAUDE_DESKTOP_CONFIG`]）。
pub const FIRST_PARTY_DIR: Loc = if cfg!(windows) {
    Loc::Home("AppData/Roaming/Claude")
} else if cfg!(target_os = "macos") {
    Loc::Home("Library/Application Support/Claude")
} else {
    Loc::XdgConfig("Claude")
};

/// 主文件：配置库里我们那一份。**文件名就是 [`PROFILE_ID`]**（测试核对两处一致）。
pub const PROFILE: Loc = if cfg!(windows) {
    Loc::Home("AppData/Local/Claude-3p/configLibrary/7477a7c4-1ce0-4d3a-9b1e-7477a7c40001.json")
} else if cfg!(target_os = "macos") {
    Loc::Home(
        "Library/Application Support/Claude-3p/configLibrary/7477a7c4-1ce0-4d3a-9b1e-7477a7c40001.json",
    )
} else {
    Loc::XdgConfig("Claude-3p/configLibrary/7477a7c4-1ce0-4d3a-9b1e-7477a7c40001.json")
};

const CONFIG_FILE: &str = "claude_desktop_config.json";

/// 配置库的目录名。**我们的旁文件不放进去**，见 [`crate::sentinel::sidecar_path`]
pub const LIBRARY_DIR: &str = "configLibrary";

pub fn profile_path(home: &Path) -> PathBuf {
    PROFILE.resolve(home)
}

pub fn meta_path(home: &Path) -> PathBuf {
    THIRD_PARTY_DIR
        .resolve(home)
        .join(LIBRARY_DIR)
        .join("_meta.json")
}

/// 第三方推理模式那一份 `claude_desktop_config.json`
pub fn third_party_config(home: &Path) -> PathBuf {
    THIRD_PARTY_DIR.resolve(home).join(CONFIG_FILE)
}

/// 平常那一份 `claude_desktop_config.json`（MCP 页改的也是它）
pub fn first_party_config(home: &Path) -> PathBuf {
    FIRST_PARTY_DIR.resolve(home).join(CONFIG_FILE)
}

// ---------------------------------------------------------------- 组织托管

/// 这台电脑上的 Claude Desktop 是不是由组织统一管理（MDM）。是的话给出托管配置
/// 在哪。
///
/// **有托管配置时，本机的配置全部不起作用**（官方文档 configuration 一页）——
/// 这时写了也白写，还会让用户以为接好了。
pub fn managed(home: &Path) -> Option<String> {
    #[cfg(windows)]
    {
        let _ = home;
        managed_in_registry()
    }
    #[cfg(not(windows))]
    {
        let user = home.file_name().and_then(|n| n.to_str());
        managed_files(Path::new("/"), user)
            .into_iter()
            .find(|p| p.exists())
            .map(|p| p.display().to_string())
    }
}

/// 托管配置可能在的文件，接在 `root` 下面（测试传一个临时目录）。
///
/// macOS 上是描述文件推下来的偏好：先看按用户的那一份，再看整机的；Linux 上是
/// `/etc/claude-desktop/managed-settings.json`。
#[cfg(not(windows))]
pub fn managed_files(root: &Path, user: Option<&str>) -> Vec<PathBuf> {
    const PLIST: &str = "com.anthropic.claudefordesktop.plist";
    if cfg!(target_os = "macos") {
        let prefs = root.join("Library").join("Managed Preferences");
        let mut out = Vec::new();
        if let Some(u) = user.filter(|u| !u.is_empty()) {
            out.push(prefs.join(u).join(PLIST));
        }
        out.push(prefs.join(PLIST));
        out
    } else {
        vec![
            root.join("etc")
                .join("claude-desktop")
                .join("managed-settings.json"),
        ]
    }
}

/// Windows 上托管配置是组策略写进注册表的：整机的 `HKLM`，这个用户的 `HKCU`，
/// 都在 `SOFTWARE\Policies\Claude` 下。**键在就算**，里面写了什么不用看。
#[cfg(windows)]
fn managed_in_registry() -> Option<String> {
    use windows_sys::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, RegCloseKey, RegOpenKeyExW,
    };
    const SUB: &str = r"SOFTWARE\Policies\Claude";
    let wide: Vec<u16> = SUB.encode_utf16().chain(Some(0)).collect();
    let exists = |root: HKEY| {
        let mut h: HKEY = std::ptr::null_mut();
        // SAFETY: 名字以 0 结尾，出参是本地变量；打开成功才关。
        let rc = unsafe { RegOpenKeyExW(root, wide.as_ptr(), 0, KEY_READ, &mut h) };
        if rc == 0 {
            // SAFETY: 上面刚打开的，只关这一次。
            unsafe { RegCloseKey(h) };
            true
        } else {
            false
        }
    };
    if exists(HKEY_LOCAL_MACHINE) {
        Some(format!(r"HKLM\{SUB}"))
    } else if exists(HKEY_CURRENT_USER) {
        Some(format!(r"HKCU\{SUB}"))
    } else {
        None
    }
}

// ---------------------------------------------------------------- 模型

/// Claude 的几档
const TIERS: [&str; 5] = ["sonnet", "opus", "haiku", "fable", "mythos"];

/// 别家模型的名字片段。**照抄 Claude Desktop 2.19675.0 的原文**，它换了就整段换掉：
/// 解开 `Claude.app/Contents/Resources/app.asar`，在 `.vite/build/index.chunk-*.js` 里搜
/// `ark-code|astron`，档位表和判断函数就在它旁边。
const OTHER_VENDORS: &str = r"ark-code|astron|command-r|deepseek|doubao|gemini|gemma|glm|gpt|grok|hermes|hy3|kimi|lfm|\bling\b|llama|longcat|mimo|minimax|mistral|mixtral|moonshot|nemotron|openai|phi-|qianfan|qwen|tc-code|\bunic\b|yi-|stepfun|step-3|seed-|bytedance|hunyuan|granite|amazon\.nova|nova-|devstral|ministral|ernie|codex|arcee|trinity|abab|phi\d|\bk2\.|\bm2\.|jamba|arctic|solar|mercury|zamba|kat-coder|\bds-|dpsk";

/// JS 的正则写成 Rust 的：没有 `u` 标志的 JS 正则里，`\b` 和 `\d` 只认 ASCII，Rust 的
/// 默认认 Unicode（`é` 在 JS 里不算单词字符，`claude-éling` 要被 `\bling\b` 拦下）
fn js_regex(src: &str) -> regex::Regex {
    regex::Regex::new(&src.replace(r"\b", r"(?-u:\b)").replace(r"\d", "[0-9]"))
        .expect("Claude Desktop's model-name pattern")
}

static OTHER_VENDOR: LazyLock<regex::Regex> = LazyLock::new(|| js_regex(OTHER_VENDORS));

/// 光一个档位名、可以带版本：`sonnet`、`opus-4.8`
static BARE_TIER: LazyLock<regex::Regex> =
    LazyLock::new(|| js_regex(&format!(r"^({})(-[\d.]+)?$", TIERS.join("|"))));

/// 这个模型名 Claude Desktop 收不收。照它网关模式的规则，名字先转小写：
///
/// 1. 含 `OTHER_VENDORS` 里任一片段的**不收** —— 名字里有 Claude 也一样，
///    `claude-deepseek-v3` 不收；
/// 2. 否则光一个档位名（`BARE_TIER`）的收，名字里有 `claude`、`anthropic` 或任一档位名
///    的也收。
///
/// `inferenceModels` 里的名字它先去掉首尾空白，结尾的 `[1m]`（不分大小写）也先去掉，
/// 再按这条判断 —— `claude-sonnet-5[1m]` 是「`claude-sonnet-5`，另给一个 1M 上下文的
/// 版本」的简写。判断不过的那一条**单独去掉**并报一条配置错误，别的照用；一条都不剩
/// 就没有模型可选。网关自己列出模型（`GET /v1/models`）时它也用同一条规则筛。
pub fn looks_like_claude(model: &str) -> bool {
    let m = model.trim().to_lowercase();
    let m = match m.strip_suffix("[1m]") {
        Some(base) if !base.is_empty() => base.trim(),
        _ => m.as_str(),
    };
    if OTHER_VENDOR.is_match(m) {
        return false;
    }
    BARE_TIER.is_match(m)
        || ["claude", "anthropic"]
            .iter()
            .chain(TIERS.iter())
            .any(|w| m.contains(w))
}

/// 网关列出的模型它一个都不收时写进去的那一个（一条都不剩，它就没有模型可选）。
///
/// 它发来的请求由它密钥上的一条「指定模型」规则接住，发给接管时选的那个上游模型
/// （见 [`ModelPick`]）—— 它发什么 Claude 名称都接得住，别的客户端用这个名称不受影响。
pub const FALLBACK_MODEL: &str = "claude-sonnet-5";

/// 网关列出的模型 Claude Desktop 一个都不收：写进它配置的是 [`FALLBACK_MODEL`]，
/// 要选一个上游模型给它用。
///
/// **这里只说要选、从哪些里选**：规则加在网关上（它的密钥、它所用的路由），那是
/// 应用那一侧的事，这个 crate 只管文件。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelPick {
    /// 写进 `inferenceModels` 的那一个
    pub written: String,
    /// 网关为这把密钥列出的模型，按列出的顺序：选的那个从这里来
    pub listed: Vec<String>,
}

/// 网关为这把密钥列出的模型里，Claude Desktop 一个都不收时，要选一个给它用。
/// 有它收的就不用选（`None`）。一个都没列出时也要选，只是没得选
pub fn model_pick(listed: &[String]) -> Option<ModelPick> {
    if listed.iter().any(|m| looks_like_claude(m)) {
        return None;
    }
    Some(ModelPick {
        written: FALLBACK_MODEL.to_string(),
        listed: listed.to_vec(),
    })
}

// ---------------------------------------------------------------- 接管

/// 算一份接管改动。**不写任何东西。**
///
/// `models` 是网关用这把钥匙列出来的模型（`GET /v1/models`），`None` = 没问
/// 或者没问到：这时不动配置里已有的那一份模型列表。
///
/// `around` 里只用得上 core 的环境：原来用的是 Bedrock 时，新建上游引用的变量网关看不看得见。
pub fn plan_adopt(
    c: &Client,
    home: &Path,
    gw: &Gateway,
    models: Option<&[String]>,
    around: &Around,
) -> Result<Plan, PlanError> {
    plan_adopt_in(c, home, gw, models, managed(home), around)
}

/// [`plan_adopt`] 去掉「这台电脑是不是被托管」那一问，测试直接喂。
pub fn plan_adopt_in(
    c: &Client,
    home: &Path,
    gw: &Gateway,
    models: Option<&[String]>,
    managed: Option<String>,
    around: &Around,
) -> Result<Plan, PlanError> {
    if let Some(by) = managed {
        return Err(PlanError::Managed {
            client: c.name.into(),
            by,
        });
    }
    let profile = profile_path(home);
    let mut edits = crate::clients::edits(c, gw);
    let mut notes: Vec<Msg> = plan::cost_notes(c).collect();
    let mut pick = None;
    match models {
        Some(all) => {
            // 它不收的名字它自己会去掉，但每一条都报一个配置错误：不写进去。带 `[1m]` 的
            // 照写 —— 网关同时列出 `X` 和 `X[1m]` 时，它在选择器里合成一个带 1M 版本的模型
            pick = model_pick(all);
            let names = match &pick {
                Some(p) => vec![p.written.clone()],
                None => all
                    .iter()
                    .filter(|m| looks_like_claude(m))
                    .cloned()
                    .collect(),
            };
            edits.push(Edit {
                path: vec!["inferenceModels".into()],
                value: Val::Arr(names.into_iter().map(Val::Str).collect()),
                secret: false,
            });
        }
        None => {
            // 不改它，但**要照样列进这次写的字段里**：旁文件按这张表记「我们写过
            // 什么」，漏掉它，还原时这一项就留在文件里了
            let text = foreign::read(&profile).ok().flatten().unwrap_or_default();
            if let Ok(Some(v)) = crate::json::get(&text, &["inferenceModels"]) {
                edits.push(Edit {
                    path: vec!["inferenceModels".into()],
                    value: v,
                    secret: false,
                });
            }
        }
    }
    if c.verified == crate::clients::Verified::FieldsOnly {
        notes.push(plan::fields_only_note(c));
    }

    // 原来正在用的那一份走的是云服务商：说一声接管期间改用我们这一份；是 Bedrock 的，
    // 按它新建上游要填的也备好
    let mut bedrock = None;
    if let Some(used) = cloud_in_use(home, around) {
        notes.push(used.note);
        notes.extend(used.more);
        bedrock = used.draft;
    }

    let mut main = plan::adopt_file(c.id, profile.clone(), Format::Json, &edits)?;
    main.notes = notes;
    main.bedrock = bedrock;
    main.pick_model = pick;
    main.also = vec![
        adopt_meta(c.id, home)?,
        plan::adopt_file(
            c.id,
            third_party_config(home),
            Format::Json,
            &[deployment_mode()],
        )?,
        plan::adopt_file(
            c.id,
            first_party_config(home),
            Format::Json,
            &[deployment_mode()],
        )?,
    ];
    Ok(main)
}

/// Claude Desktop 接管前正在用的那一份第三方推理配置走的是云服务商时，关于它要说的。
pub struct CloudInUse {
    pub cloud: Cloud,
    /// 「原来用的是它，接管期间改用我们这一份，还原时切回去」
    pub note: Msg,
    /// Bedrock 和 Mantle 才有：按它新建 Bedrock 上游要填的
    pub draft: Option<crate::cloud::BedrockDraft>,
    /// 凭据上要说的话（[`crate::cloud::claude_desktop_draft`]）
    pub more: Vec<Msg>,
}

/// 接管前正在用的那一份配置（`_meta.json` 的 `appliedId`）走的是不是云服务商。**正在用的
/// 已经是我们这一份时**（重复接管），看接管记录里 `appliedId` 原来指着谁。
///
/// 网关那一种（`inferenceProvider: "gateway"`，比如 CC Switch 写的）和直连 Claude API 的不算：
/// 接管换掉它们不会让谁绕开网关。
pub fn cloud_in_use(home: &Path, around: &Around) -> Option<CloudInUse> {
    let meta_file = meta_path(home);
    let meta = std::fs::read_to_string(&meta_file).ok()?;
    let applied = crate::json::get(&meta, &["appliedId"])
        .ok()
        .flatten()?
        .as_str()?
        .to_string();
    let id = if applied == PROFILE_ID {
        match prior_was(ID, &meta_file, "appliedId")? {
            sentinel::Was::Value(v) => v,
            _ => return None,
        }
    } else {
        applied
    };
    // 文件名就是它的 id：带路径的不认
    if id.is_empty() || id.contains(['/', '\\']) || id.contains("..") {
        return None;
    }
    let path = THIRD_PARTY_DIR
        .resolve(home)
        .join(LIBRARY_DIR)
        .join(format!("{id}.json"));
    let text = std::fs::read_to_string(&path).ok()?;
    let provider = crate::json::get(&text, &["inferenceProvider"])
        .ok()
        .flatten()?;
    let cloud = match provider.as_str()? {
        "bedrock" => Cloud::Bedrock,
        "mantle" => Cloud::Mantle,
        "vertex" => Cloud::Vertex,
        "foundry" => Cloud::Foundry,
        _ => return None,
    };
    let name = entries_of(ID, &meta)
        .ok()
        .and_then(|es| {
            es.iter()
                .find(|e| entry_id(e) == Some(id.as_str()))
                .and_then(|e| match e {
                    Val::Obj(ms) => ms
                        .iter()
                        .find(|(k, _)| k == "name")
                        .and_then(|(_, v)| v.as_str().map(str::to_string)),
                    _ => None,
                })
        })
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| id.clone());
    // 英文里是那一家的名字；参数给的是词，中文按词表说
    let label = cloud.name();
    let note = msg!(
        "adopt.plan.claude_desktop.was_cloud", name = name.clone(), cloud = cloud.slug()
        => "Claude Desktop uses {label} through the configuration {name}. While it points at the \
            gateway, the ThinkWatch configuration is used instead; restoring switches back to {name}."
    );
    let (draft, more) = if cloud.is_bedrock() {
        let (d, m) = crate::cloud::claude_desktop_draft(home, &path, &text, cloud, around);
        (Some(d), m)
    } else {
        (None, Vec::new())
    };
    Some(CloudInUse {
        cloud,
        note,
        draft,
        more,
    })
}

fn deployment_mode() -> Edit {
    Edit {
        path: vec!["deploymentMode".into()],
        value: Val::s("3p"),
        secret: false,
    }
}

/// 我们那一份在 `entries` 里长什么样
fn entry() -> Val {
    Val::Obj(vec![
        ("id".into(), Val::s(PROFILE_ID)),
        ("name".into(), Val::s(PROFILE_NAME)),
    ])
}

fn is_ours(e: &Val) -> bool {
    matches!(e, Val::Obj(ms) if ms.iter().any(|(k, v)| k == "id" && v.as_str() == Some(PROFILE_ID)))
}

fn entry_id(e: &Val) -> Option<&str> {
    match e {
        Val::Obj(ms) => ms.iter().find(|(k, _)| k == "id")?.1.as_str(),
        _ => None,
    }
}

/// `_meta.json` 里的 `entries`。没有就是空的；**有但不是列表就不碰** —— 那是
/// 一份我们不认得的格式，猜着改只会弄坏它。
fn entries_of(client: &str, text: &str) -> Result<Vec<Val>, PlanError> {
    match crate::json::get(text, &["entries"]) {
        Ok(None) => Ok(Vec::new()),
        Ok(Some(Val::Arr(es))) => Ok(es),
        Ok(Some(_)) => Err(PlanError::Parse {
            client: client.into(),
            msg: "`entries` in _meta.json is not a list".into(),
        }),
        Err(e) => Err(PlanError::Parse {
            client: client.into(),
            msg: e.to_string(),
        }),
    }
}

/// 在配置库里登记我们那一份，并让它成为正在用的那一份。
///
/// **别的条目原样留着**：用户自己在应用里建的、CC Switch 写的，都不动；我们只
/// 在 `entries` 末尾追加自己那一条（已经在了就不加），再把 `appliedId` 指过来。
/// 追加走 [`crate::json::push`]，原有条目的字节一个不动，还原时摘掉这一条就是原文。
fn adopt_meta(client: &str, home: &Path) -> Result<Plan, PlanError> {
    let path = meta_path(home);
    let mut p = plan::adopt_file(
        client,
        path.clone(),
        Format::Json,
        &[Edit {
            path: vec!["appliedId".into()],
            value: Val::s(PROFILE_ID),
            secret: false,
        }],
    )?;
    let before = p.before.clone().unwrap_or_else(|| "{}\n".into());
    let mut entries = entries_of(client, &before)?;

    // `entries` 原来是什么样：重复接管时以第一次的记录为准
    let field = vec!["entries".to_string()];
    let was = prior_was(client, &path, "entries").unwrap_or_else(|| {
        match crate::json::get(&before, &["entries"]).ok().flatten() {
            None => sentinel::Was::Missing,
            Some(v) => sentinel::Was::Value(v.to_line()),
        }
    });
    // 重复接管时，`adopt_file` 已经把上一次记下的 `entries` 带过来了（它不在这次写的
    // 字段里）：**换掉那一条**，不是再记一条 —— 否则每接管一次，记录里就多一份
    p.originals.retain(|o| o.path != field);
    p.originals.push(sentinel::Original::new(&field, was));

    if !entries.iter().any(is_ours) {
        entries.push(entry());
        p.after =
            crate::json::push(&p.after, &["entries"], &entry()).map_err(|e| PlanError::Parse {
                client: client.into(),
                msg: e.to_string(),
            })?;
    }
    p.targets.push(Target::Set(field, Val::Arr(entries)));
    Ok(p)
}

/// 上一次接管时记下的某个字段的原值（这个文件接管过的话）
fn prior_was(client: &str, path: &Path, field: &str) -> Option<sentinel::Was> {
    let real = foreign::resolve(path).ok()?;
    let rec: sentinel::SidecarRecord =
        serde_json::from_str(&std::fs::read_to_string(sentinel::sidecar_path(&real)).ok()?).ok()?;
    if rec.client != client {
        return None;
    }
    let f = rec.originals.into_iter().find(|f| f.field == field)?;
    Some(match (f.was.as_str(), f.value) {
        ("missing", _) => sentinel::Was::Missing,
        (_, Some(v)) => sentinel::Was::Value(v),
        (_, None) => sentinel::Was::Missing,
    })
}

// ---------------------------------------------------------------- 还原

/// 算一份还原改动。**不写任何东西。**
///
/// 四个文件倒着来：先把两处 `deploymentMode` 改回去，再从 `_meta.json` 里摘掉
/// 我们那一条，最后删掉我们那一份配置（主文件，[`crate::plan::apply_restore`]
/// 最后才落它）。
pub fn plan_restore(c: &Client, home: &Path) -> Result<Plan, PlanError> {
    let mut main = plan::restore_file_plan(c.id, profile_path(home), Format::Json)?;
    main.notes.insert(0, restart_note(c));
    let mut also = Vec::new();
    for p in [first_party_config(home), third_party_config(home)] {
        match plan::restore_file_plan(c.id, p, Format::Json) {
            Ok(r) => also.push(r),
            // 这一处当初没写成（或者记录已经被删了）：没什么可还原的
            Err(PlanError::NoRecord { .. }) => {}
            Err(e) => return Err(e),
        }
    }
    if let Some(m) = restore_meta(c.id, home)? {
        also.push(m);
    }
    main.also = also;
    Ok(main)
}

/// 「要完全退出再打开」那一句：接管的代价里第一条就是它，还原时也照样要说
fn restart_note(c: &Client) -> Msg {
    plan::cost_notes(c)
        .next()
        .unwrap_or_else(|| msg!("adopt.cost.claude_desktop.restart" => "Claude Desktop has to be quit completely and opened again."))
}

/// 从 `_meta.json` 里摘掉我们那一条。
///
/// `appliedId` 还指着我们的话：接管前指着谁、那一条还在，就指回去；不在了就指向
/// 剩下的第一条；一条都不剩（或者接管前本来就没有）就删掉这个键。已经被用户在
/// 应用里换成别的了，就不动。
fn restore_meta(client: &str, home: &Path) -> Result<Option<Plan>, PlanError> {
    let path = meta_path(home);
    let real = foreign::resolve(&path)?;
    let side = sentinel::sidecar_path(&real);
    let rec: Option<sentinel::SidecarRecord> = std::fs::read_to_string(&side)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .filter(|r: &sentinel::SidecarRecord| r.client == client);
    let before = foreign::read(&path).map_err(|source| PlanError::Read {
        client: client.into(),
        source,
    })?;
    let Some(before) = before else {
        return Ok(rec.map(|_| Plan {
            client: client.into(),
            path: path.clone(),
            before: None,
            after: String::new(),
            originals: Vec::new(),
            carries_secret: false,
            notes: Vec::new(),
            shadows: Vec::new(),
            targets: Vec::new(),
            drop_sidecar: Some(side.clone()),
            delete_file: false,
            format: Format::Json,
            also: Vec::new(),
            prior: None,
            bedrock: None,
            pick_model: None,
        }));
    };

    let was = |field: &str| {
        rec.as_ref()
            .and_then(|r| r.originals.iter().find(|f| f.field == field))
            .map(|f| (f.was.clone(), f.value.clone()))
    };
    let entries = entries_of(client, &before)?;
    let ours = entries.iter().position(is_ours);
    let rest: Vec<Val> = entries.into_iter().filter(|e| !is_ours(e)).collect();

    let parse = |e: crate::json::JErr| PlanError::Parse {
        client: client.into(),
        msg: e.to_string(),
    };
    let mut text = before.clone();
    let mut targets = Vec::new();
    if let Some(i) = ours {
        let entries_were_missing = matches!(was("entries"), Some((w, _)) if w == "missing");
        if rest.is_empty() && entries_were_missing {
            targets.push(Target::Remove(vec!["entries".into()]));
            text = crate::json::remove(&text, &["entries"]).map_err(parse)?;
        } else {
            // 只摘我们那一条，别的条目的字节不动
            targets.push(Target::Set(vec!["entries".into()], Val::Arr(rest.clone())));
            text = crate::json::remove_item(&text, &["entries"], i).map_err(parse)?;
        }
    }
    let applied = crate::json::get(&before, &["appliedId"]).ok().flatten();
    if applied.as_ref().and_then(Val::as_str) == Some(PROFILE_ID) {
        let still_there = |id: &str| rest.iter().any(|e| entry_id(e) == Some(id));
        let first = || rest.iter().find_map(entry_id).map(str::to_string);
        let back = match was("appliedId") {
            // 接管前本来就没有正在用的那一份
            Some((w, _)) if w == "missing" => None,
            Some((_, Some(v))) if still_there(&v) => Some(v),
            _ => first(),
        };
        let t = match back {
            Some(id) => Target::Set(vec!["appliedId".into()], Val::s(id)),
            None => Target::Remove(vec!["appliedId".into()]),
        };
        text = match &t {
            Target::Set(p, v) => crate::json::set(&text, &refs(p), v),
            Target::Remove(p) => crate::json::remove(&text, &refs(p)),
        }
        .map_err(parse)?;
        targets.push(t);
    }
    let created = rec.as_ref().is_some_and(|r| r.created_file);
    let delete_file =
        created && matches!(crate::json::value(&text), Ok(Val::Obj(ms)) if ms.is_empty());
    if targets.is_empty() && rec.is_none() {
        return Ok(None);
    }
    Ok(Some(Plan {
        client: client.into(),
        path,
        before: Some(before),
        after: text,
        originals: Vec::new(),
        carries_secret: false,
        notes: Vec::new(),
        shadows: Vec::new(),
        targets,
        drop_sidecar: rec.map(|_| side),
        delete_file,
        format: Format::Json,
        also: Vec::new(),
        prior: None,
        bedrock: None,
        pick_model: None,
    }))
}

fn refs(p: &[String]) -> Vec<&str> {
    p.iter().map(String::as_str).collect()
}

// ---------------------------------------------------------------- 手动配置和诊断

/// 手动配置的几步：官方的单机做法，在应用里点。
pub fn manual_steps() -> Vec<Msg> {
    vec![
        msg!(
            "adopt.manual.claude_desktop.open"
            => "In Claude Desktop, turn on Help → Troubleshooting → Enable Developer Mode, then open Developer → Configure Third-Party Inference."
        ),
        msg!(
            "adopt.manual.claude_desktop.fields"
            => "Choose the gateway provider, enter the gateway address and the key, and set the authentication scheme to x-api-key."
        ),
        msg!(
            "adopt.manual.claude_desktop.apply"
            => "Click Apply Changes, then quit Claude Desktop completely and open it again."
        ),
    ]
}

/// 此刻正在用的是不是我们那一份：`_meta.json` 的 `appliedId`。`None` = 读不出来
pub fn applied_is_ours(home: &Path) -> Option<bool> {
    let text = std::fs::read_to_string(meta_path(home)).ok()?;
    let v = crate::json::get(&text, &["appliedId"]).ok()?;
    Some(v.as_ref().and_then(Val::as_str) == Some(PROFILE_ID))
}

/// 两份 `claude_desktop_config.json` 里，`deploymentMode` 不是 `3p` 的那些
pub fn not_third_party(home: &Path) -> Vec<PathBuf> {
    [first_party_config(home), third_party_config(home)]
        .into_iter()
        .filter(|p| {
            let text = std::fs::read_to_string(p).unwrap_or_default();
            crate::json::get(&text, &["deploymentMode"])
                .ok()
                .flatten()
                .and_then(|v| v.as_str().map(str::to_string))
                .as_deref()
                != Some("3p")
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_profile_file_is_named_after_the_profile_id() {
        let home = Path::new("/h");
        let p = profile_path(home);
        assert_eq!(
            p.file_name().unwrap().to_str().unwrap(),
            format!("{PROFILE_ID}.json")
        );
        assert_eq!(p.parent().unwrap(), meta_path(home).parent().unwrap());
        assert!(p.starts_with(THIRD_PARTY_DIR.resolve(home)));
    }

    /// 每一个都拿 Claude Desktop 2.19675.0 自己的判断（从 app.asar 里原样取出来跑）核对过
    #[test]
    fn only_names_claude_desktop_accepts_make_the_list() {
        for ok in [
            "claude-sonnet-5",
            "claude-opus-4-8",
            "claude-haiku-4-5-20251001",
            "claude-fable-5",
            "claude-mythos-1",
            "anthropic/claude-sonnet-5",
            "Claude-Sonnet-5",
            "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
            "  claude-sonnet-5  ",
            // 1M 上下文的写法
            "claude-sonnet-5[1m]",
            "claude-opus-4-8[1M]",
            // 光一个档位名
            "sonnet",
            "Sonnet",
            "opus-4.8",
            "haiku-4.5",
            "fable",
            "mythos-1",
            // 名字里有 claude、anthropic 或档位名就收，在哪儿都行
            "claude",
            "claude-sonnet-",
            "my-claude-proxy",
            "claude-3-5-sonnet-latest",
            "anthropic-router",
            "opus-proxy",
            // `\bling\b`、`\bunic\b` 要整个词：sibling、unicorn 里的不算
            "claude-sibling",
            "claude-unicorn",
            // `\d` 只认 ASCII 数字：阿拉伯-印度数字的 3 不算
            "claude-phi\u{663}",
        ] {
            assert!(looks_like_claude(ok), "{ok}");
        }
        for no in [
            "deepseek-chat",
            "gpt-5",
            "gemini-2.5-pro",
            "qwen3-coder-plus",
            "kimi-k2",
            "glm-4.6",
            // 有别家的片段，名字里有 Claude 也不收
            "claude-deepseek-v3",
            "DeepSeek-Claude",
            "claude-gpt-proxy",
            "gpt-5-codex",
            "claude-codex",
            "anthropic/kimi-k2",
            "sonnet-qwen",
            "claude-sonnet-5-gpt[1m]",
            "claude-ling",
            "claude-unic",
            // JS 的 `\b` 只认 ASCII：é 不是单词字符，ling 前面就是词的边界
            "claude-\u{e9}ling",
            "claude-phi4",
            "claude-k2.5",
            "claude-m2.1",
            "claude-yi-34b",
            "claude-seed-2",
            "opus-ds-1",
            "claude-dpsk",
            // 什么都不像
            "[1m]",
            "",
            "   ",
        ] {
            assert!(!looks_like_claude(no), "{no}");
        }
        assert!(looks_like_claude(FALLBACK_MODEL));
    }

    fn names(xs: &[&str]) -> Vec<String> {
        xs.iter().map(|s| s.to_string()).collect()
    }

    /// 网关列出的有一个它收的，就不用选；一个都不收（或者一个都没列出）才要选，
    /// 候选是列出的全部，照列出的顺序
    #[test]
    fn a_model_is_picked_only_when_the_gateway_lists_nothing_it_accepts() {
        assert_eq!(
            model_pick(&names(&["glm-4.6", "claude-sonnet-5", "gpt-5"])),
            None
        );
        assert_eq!(model_pick(&names(&["opus-proxy"])), None);
        let p = model_pick(&names(&["glm-4.6", "claude-deepseek-v3", "kimi-k2"])).unwrap();
        assert_eq!(p.written, FALLBACK_MODEL);
        assert_eq!(
            p.listed,
            names(&["glm-4.6", "claude-deepseek-v3", "kimi-k2"])
        );
        let none = model_pick(&[]).unwrap();
        assert!(none.listed.is_empty());
    }

    #[cfg(not(windows))]
    #[test]
    fn managed_configuration_is_looked_for_where_the_docs_put_it() {
        let root = tempfile::tempdir().unwrap();
        let files = managed_files(root.path(), Some("me"));
        assert!(!files.is_empty());
        assert!(files.iter().all(|p| p.starts_with(root.path())));
        if cfg!(target_os = "macos") {
            assert!(
                files[0].ends_with("Managed Preferences/me/com.anthropic.claudefordesktop.plist")
            );
            assert!(files[1].ends_with("Managed Preferences/com.anthropic.claudefordesktop.plist"));
        } else {
            assert!(files[0].ends_with("etc/claude-desktop/managed-settings.json"));
        }
    }
}
