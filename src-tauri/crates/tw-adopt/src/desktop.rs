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

use tw_types::{Msg, msg};

use crate::clients::{Client, Edit, Format, Gateway};
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

/// 这个模型名 Claude Desktop 收不收。
///
/// 它只认看起来像 Claude 的名字：自动发现时只留这样的，写进 `inferenceModels`
/// 的名字里只要有一个不像，**整张列表都会被拒掉**（社区报告，anthropics/claude-code
/// #56990；CC Switch 实测过的规则是 `claude-` 之后紧跟 sonnet、opus、haiku、fable
/// 之一，再跟一段版本）。所以这里取严不取宽。带 `[1m]` 的写法它也不认 ——
/// 1M 上下文在它那里是单独的一个字段。
pub fn looks_like_claude(model: &str) -> bool {
    let m = model.trim().to_ascii_lowercase();
    if m.contains("[1m]") {
        return false;
    }
    let tail = m.strip_prefix("anthropic/").unwrap_or(&m);
    let Some(tail) = tail.strip_prefix("claude-") else {
        return false;
    };
    ["sonnet-", "opus-", "haiku-", "fable-"]
        .iter()
        .any(|role| tail.strip_prefix(role).is_some_and(|rest| !rest.is_empty()))
}

/// 网关一个像 Claude 的模型都没列出来时写进去的那一个。路由里要有一条规则把它
/// 改写到上游真正在用的模型 —— 接管说明里给出那条规则。
pub const FALLBACK_MODEL: &str = "claude-sonnet-5";

// ---------------------------------------------------------------- 接管

/// 算一份接管改动。**不写任何东西。**
///
/// `models` 是网关用这把钥匙列出来的模型（`GET /v1/models`），`None` = 没问
/// 或者没问到：这时不动配置里已有的那一份模型列表。
pub fn plan_adopt(
    c: &Client,
    home: &Path,
    gw: &Gateway,
    models: Option<&[String]>,
) -> Result<Plan, PlanError> {
    plan_adopt_in(c, home, gw, models, managed(home))
}

/// [`plan_adopt`] 去掉「这台电脑是不是被托管」那一问，测试直接喂。
pub fn plan_adopt_in(
    c: &Client,
    home: &Path,
    gw: &Gateway,
    models: Option<&[String]>,
    managed: Option<String>,
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
    match models {
        Some(all) => {
            let claude: Vec<String> = all
                .iter()
                .filter(|m| looks_like_claude(m))
                .cloned()
                .collect();
            let names = if claude.is_empty() {
                notes.push(no_claude_model(all.iter().find(|m| !looks_like_claude(m))));
                vec![FALLBACK_MODEL.to_string()]
            } else {
                claude
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

    let mut main = plan::adopt_file(c.id, profile.clone(), Format::Json, &edits)?;
    main.notes = notes;
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

fn deployment_mode() -> Edit {
    Edit {
        path: vec!["deploymentMode".into()],
        value: Val::s("3p"),
        secret: false,
    }
}

/// 网关没列出像 Claude 的模型：要在路由里加一条规则，把 [`FALLBACK_MODEL`] 改写到
/// 上游真正在用的那个模型。`upstream` 是网关列出的第一个模型，拿来填示例。
fn no_claude_model(upstream: Option<&String>) -> Msg {
    let target = upstream.map_or("<model>", |s| s.as_str());
    let rule = format!(
        "{{ name: Claude Desktop, when: {{ model: {FALLBACK_MODEL} }}, set: {{ model: {target} }} }}"
    );
    msg!(
        "adopt.plan.claude_desktop.no_claude_model",
        model = FALLBACK_MODEL,
        rule = rule
        => "The gateway lists no model whose name looks like Claude, and Claude Desktop accepts no other names. {model} is written as its model; a route needs a rule that rewrites {model} to the model actually in use upstream, for example: {rule}"
    )
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

    #[test]
    fn only_names_claude_desktop_accepts_make_the_list() {
        for ok in [
            "claude-sonnet-5",
            "claude-opus-4-8",
            "claude-haiku-4-5-20251001",
            "claude-fable-5",
            "anthropic/claude-sonnet-5",
            "Claude-Sonnet-5",
        ] {
            assert!(looks_like_claude(ok), "{ok}");
        }
        for no in [
            "deepseek-chat",
            "gpt-5",
            "claude-sonnet-",
            "claude-sonnet-5[1m]",
            "claude",
            "my-claude-sonnet-5",
            "claude-3-5-sonnet-latest",
        ] {
            assert!(!looks_like_claude(no), "{no}");
        }
        assert!(looks_like_claude(FALLBACK_MODEL));
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
