//! 接管与还原：先算出一份**可以拿给用户看的**改动，再落盘。
//!
//! 顺序是刻意的：
//!
//! ```text
//! 算改动 → 展示 diff → 用户确认 → 写回校验 → 全文备份 → 原子写 → 读回来对一遍
//! ```
//!
//! 「算改动」和「落盘」分成两个函数，是因为中间必须夹一次人的确认。
//! 一个 `adopt()` 直接把两件事做完的 API，用起来会很顺手 —— 顺手到
//! 没有人会想起要展示 diff。
//!
//! **还原（restore）和回滚（rollback）不是一回事**：还原是
//! 「把我们写的那几个字段改回去」，回滚是「拿全文备份覆盖」。卸载必须
//! 走还原 —— 拿三个月前的备份去覆盖，会把用户这期间加的 MCP server、
//! 调的权限、写的 hook 全部抹掉。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use tw_types::{Msg, msg};

use crate::clients::{Client, Edit, Format, Gateway};
use crate::cloud::{self, Around, Cloud, Where};
use crate::foreign::{self, Applied, Change, ForeignError};
use crate::json::Val;
use crate::sentinel::{self, Original, SidecarRecord, Was};

/// 接管或还原算不出来、落不了盘的原因。
///
/// **英文只写一遍**：`Display` 就是 [`PlanError::msg`] 的原句，界面拿码去翻。
#[derive(Debug, thiserror::Error)]
pub enum PlanError {
    #[error("{}", self.msg())]
    Read {
        client: String,
        source: ForeignError,
    },
    #[error("{}", self.msg())]
    Parse { client: String, msg: String },
    #[error(transparent)]
    Write(#[from] ForeignError),
    #[error("{}", self.msg())]
    ForeignSidecar {
        path: PathBuf,
        other: String,
        client: String,
    },
    #[error("{}", self.msg())]
    NoRecord { client: String, path: PathBuf },
    /// 这个客户端由组织统一管理（MDM）：本机的配置不起作用，写了也白写
    #[error("{}", self.msg())]
    Managed { client: String, by: String },
    /// 组织托管的配置打开了 Claude Code 的云服务商开关（[`crate::cloud`]）：它盖过
    /// 用户自己的配置，接管关不掉它，写了也白写
    #[error("{}", self.msg())]
    CloudManaged {
        client: String,
        name: String,
        cloud: Cloud,
        path: PathBuf,
    },
}

impl PlanError {
    /// 给人看的那句话，带码。
    pub fn msg(&self) -> Msg {
        match self {
            // **读不到的那个文件本身就是该客户端的配置**，所以直接说文件那一句：
            // 两句套在一起（「X 的配置读不出来：某文件读不出来：…」）只是把同一件
            // 事说了两遍
            PlanError::Read { client, source } => match source {
                ForeignError::Read { path, source } => msg!(
                    "adopt.plan.read_failed", client = client, path = path.display(), detail = source =>
                    "the configuration of {client} could not be read: {path}: {detail}"
                ),
                other => other.msg(),
            },
            PlanError::Parse { client, msg } => msg!(
                "adopt.plan.parse_failed", client = client, detail = msg =>
                "the configuration of {client} could not be parsed, so nothing was changed: {detail}"
            ),
            PlanError::Write(e) => e.msg(),
            PlanError::ForeignSidecar {
                path,
                other,
                client,
            } => msg!(
                "adopt.plan.foreign_record", path = path.display(), other = other, client = client =>
                "the record beside {path} belongs to {other}, not {client}, so nothing was changed"
            ),
            PlanError::Managed { client, by } => msg!(
                "adopt.plan.managed", client = client, by = by =>
                "{client} on this computer is managed by an organization ({by}), so it cannot be \
                 pointed at the gateway. Nothing was changed."
            ),
            PlanError::CloudManaged {
                client,
                name,
                cloud,
                path,
            } => {
                // 英文里是那一家的名字；参数给的是词，中文按词表说
                let label = cloud.name();
                msg!(
                    "adopt.plan.cloud_managed",
                    client = client,
                    name = name,
                    cloud = cloud.slug(),
                    path = path.display()
                    => "{path} is an organization's managed configuration, and it turns on {name}, \
                        so {client} connects to {label} directly and cannot be pointed at the \
                        gateway. Nothing was changed."
                )
            }
            PlanError::NoRecord { client, path } => msg!(
                "adopt.plan.no_record", client = client, path = path.display() =>
                "there is no record for {client}, so there is nothing to restore from. To restore \
                 by hand, look at {path}"
            ),
        }
    }
}

/// 这次改动对某条路径做了什么。写回校验的参照物就是它们叠出来的。
#[derive(Debug, Clone)]
pub enum Target {
    Set(Vec<String>, Val),
    /// **删掉**，不是「写成空串」。还原「原本没有」的字段走这条。
    Remove(Vec<String>),
}

/// 一份算好、还没落盘的改动。**UI 拿它画 diff。**
#[derive(Debug, Clone)]
pub struct Plan {
    pub client: String,
    /// 用户看到的那个路径（可能是符号链接）
    pub path: PathBuf,
    /// `None` = 这个文件本来不存在，我们会新建
    pub before: Option<String>,
    pub after: String,
    pub originals: Vec<Original>,
    /// 这次会不会把密钥写进这个文件
    pub carries_secret: bool,
    /// 接管完成那一屏要说的话：什么时候生效、有什么代价、哪些文件会遮蔽我们
    pub notes: Vec<Msg>,
    /// 优先级比我们高、会盖住这次写入的文件（#6828）
    pub shadows: Vec<PathBuf>,
    /// 这次动了哪些路径。**只有这些路径允许变** —— 写回校验拿它当白名单
    pub targets: Vec<Target>,
    /// 还原完成后要删掉的旁文件
    pub drop_sidecar: Option<PathBuf>,
    /// 还原时要把整个配置文件删掉（当初就是我们建的，而且还原后它是空的）
    pub delete_file: bool,
    /// 这个文件是什么格式。落盘时的写回校验照它解析
    pub format: Format,
    /// 同一次改动里另外那几份文件（dsh 的密钥在单独的凭据文件里）。
    ///
    /// **一起落盘、一起失败**：写到一半停下，比哪一份都没写更糟 —— 那时补丁
    /// 指着一个凭据文件里还没有的密钥名，dsh 起不来，而用户不知道为什么。
    /// Claude Desktop 一次要改四个（见 [`crate::desktop`]）。
    pub also: Vec<Plan>,
    /// 之前那次接管留下的记录（备份路径、文件是不是我们建的）。
    ///
    /// **重复接管不能覆盖它。**第二次接管时文件里的值已经是我们写的了，
    /// 照着记一遍，「原值」就变成了我们自己的地址和密钥 —— 之后的还原会
    /// 把用户还原到我们这儿，而不是还原回他原来的样子。这是最隐蔽的一
    /// 种数据丢失：每一步看起来都成功了。
    pub prior: Option<(String, bool)>,
}

impl Plan {
    /// 什么都不用改。**「已经是这样了」和「改完了」要能分开说** ——
    /// 前者不该产生备份，也不该在历史里留一条。
    pub fn is_noop(&self) -> bool {
        self.before.as_deref() == Some(self.after.as_str()) && self.also.iter().all(Plan::is_noop)
    }

    /// `paths` 上的字符串值：改之前的、改之后的，另外那几份文件里的也算。
    ///
    /// 给界面画 diff 之前打码用。密钥字段上除了网关那把，还有**用户自己的** ——
    /// 接管时被换下来的、还原时要放回去的，而画出来的是整份文件。解析不了的那一份
    /// 不算（它本来就算不出改动）
    pub fn values_at(&self, paths: &[Vec<String>]) -> Vec<String> {
        let mut out = Vec::new();
        for p in std::iter::once(self).chain(&self.also) {
            for text in p.before.iter().chain(std::iter::once(&p.after)) {
                let Ok(v) = semantic(p.format, text, &p.client) else {
                    continue;
                };
                for path in paths {
                    if let Some(Val::Str(s)) = lookup(&v, &refs(path)) {
                        out.push(s);
                    }
                }
            }
        }
        out
    }
}

fn parse_err(client: &str, e: impl std::fmt::Display) -> PlanError {
    PlanError::Parse {
        client: client.into(),
        msg: e.to_string(),
    }
}

// ---------------------------------------------------------- 三种格式的统一入口

fn semantic(fmt: Format, text: &str, client: &str) -> Result<Val, PlanError> {
    match fmt {
        Format::Json => crate::json::value(text).map_err(|e| parse_err(client, e)),
        Format::Toml => crate::toml::value(text).map_err(|e| parse_err(client, e)),
        Format::Yaml => crate::yamlval::value(text).map_err(|e| parse_err(client, e)),
        Format::Rows => crate::rows::value(text).map_err(|e| parse_err(client, e)),
    }
}

fn put(fmt: Format, text: &str, path: &[&str], v: &Val, client: &str) -> Result<String, PlanError> {
    match fmt {
        Format::Json => crate::json::set(text, path, v).map_err(|e| parse_err(client, e)),
        Format::Toml => crate::toml::set(text, path, v).map_err(|e| parse_err(client, e)),
        Format::Yaml => crate::yaml::set(text, path, v).map_err(|e| parse_err(client, e)),
        Format::Rows => crate::rows::set(text, path, v).map_err(|e| parse_err(client, e)),
    }
}

fn drop_(fmt: Format, text: &str, path: &[&str], client: &str) -> Result<String, PlanError> {
    match fmt {
        Format::Json => crate::json::remove(text, path).map_err(|e| parse_err(client, e)),
        Format::Toml => crate::toml::remove(text, path).map_err(|e| parse_err(client, e)),
        Format::Yaml => crate::yaml::remove(text, path).map_err(|e| parse_err(client, e)),
        Format::Rows => crate::rows::remove(text, path).map_err(|e| parse_err(client, e)),
    }
}

fn peek(fmt: Format, text: &str, path: &[&str], client: &str) -> Result<Option<String>, PlanError> {
    Ok(match fmt {
        Format::Json => crate::json::get(text, path)
            .map_err(|e| parse_err(client, e))?
            .map(|v| v.to_line()),
        Format::Toml => crate::toml::get(text, path)
            .map_err(|e| parse_err(client, e))?
            .map(|v| v.to_line()),
        Format::Yaml => crate::yaml::get(text, path).map_err(|e| parse_err(client, e))?,
        Format::Rows => crate::rows::get(text, path)
            .map_err(|e| parse_err(client, e))?
            .map(|v| v.to_line()),
    })
}

/// 空文件长什么样。JSON 得先有个对象，不然连插字段的地方都没有；写成两行，
/// 新建的文件里一个字段一行，和手写的一样。
fn empty(fmt: Format) -> &'static str {
    match fmt {
        Format::Json => "{\n}\n",
        Format::Toml | Format::Yaml | Format::Rows => "",
    }
}

fn refs(path: &[String]) -> Vec<&str> {
    path.iter().map(|s| s.as_str()).collect()
}

// ---------------------------------------------------------------- 接管

/// 「什么时候生效」那一句。
///
/// 码里带上 `takes_effect` 那个词，因为界面上的两句话措辞完全不同，
/// 不是同一句填不同的空。
fn takes_effect_note(c: &Client) -> Msg {
    msg!(
        "adopt.takes_effect",
        takes_effect = c.takes_effect.slug()
        => "{}", c.takes_effect.note()
    )
}

/// 算一份接管改动。**不写任何东西。**
///
/// `around` 是配置文件以外还要看的地方：用户环境、组织托管的配置。Claude Code 打开着的
/// 云服务商开关要从那里找（[`crate::cloud`]）。
pub fn plan_adopt(
    c: &Client,
    home: &Path,
    gw: &Gateway,
    around: &Around,
) -> Result<Plan, PlanError> {
    if c.id == crate::desktop::ID {
        return crate::desktop::plan_adopt(c, home, gw, None);
    }
    // 什么时候生效、有什么代价，按装着的版本说
    let c = &c.clone().here(home);
    let path = c.config_path(home);
    // 写哪些字段要看文件此刻的样子（opencode 有没有原生的 `providers.thinkwatch`）；
    // 读不出来的由 adopt_file 去报
    let current = foreign::read(&path).ok().flatten().unwrap_or_default();
    let mut edits = crate::clients::edits_for(c, gw, &current);
    // Claude Code 打开着的云服务商开关：接管期间在 `env` 里写成空串。托管配置打开的
    // 关不掉，写了也白写 —— 不接管
    let on = match c.id {
        "claude-code" => cloud::switches(home, &path, &current, &c.shadow_paths(home), around),
        _ => Vec::new(),
    };
    if let Some((o, by)) = on.iter().find_map(|o| match &o.at {
        Where::Managed(p) => Some((o, p)),
        _ => None,
    }) {
        return Err(PlanError::CloudManaged {
            client: c.name.into(),
            name: o.name.into(),
            cloud: o.cloud,
            path: by.clone(),
        });
    }
    edits.extend(on.iter().filter(|o| o.at.turned_off_here()).map(|o| Edit {
        path: vec!["env".into(), o.name.into()],
        value: Val::s(""),
        secret: false,
    }));
    let mut plan = adopt_file(c.id, path, c.format, &edits)?;
    if let Some(also) = crate::clients::also(c) {
        let edits = crate::clients::also_edits(c, gw);
        plan.also.push(adopt_file(
            c.id,
            also.config.resolve(home),
            also.format,
            &edits,
        )?);
    }
    plan.carries_secret |= plan.also.iter().any(|p| p.carries_secret);
    let (mut notes, shadows) = adopt_notes(c, home, gw);
    notes.extend(cloud_notes(c, home, &current, &on, around));
    plan.notes = notes;
    plan.shadows = shadows;
    Ok(plan)
}

/// 关于云服务商开关要说的话：每个开关在哪儿打开着、接管期间关掉；比 settings.json 优先
/// 的文件里打开着的，在那个目录里开的会话照样直连；走 Bedrock 的，哪些模型接管之后会用
/// Anthropic 的名字向网关要 —— 路由里得有规则把它们改写到 Bedrock 上。
fn cloud_notes(
    c: &Client,
    home: &Path,
    settings: &str,
    on: &[cloud::On],
    around: &Around,
) -> Vec<Msg> {
    let mut out = Vec::new();
    for o in on {
        let (name, slug) = (o.name, o.cloud.slug());
        // 英文里是那一家的名字；参数给的是词，中文按词表说
        let label = o.cloud.name();
        out.push(match &o.at {
            Where::Settings(p) => msg!(
                "adopt.plan.cloud_off.settings",
                client = c.name,
                name = name,
                cloud = slug,
                path = p.display()
                => "{path} turns on {name}, so {client} connects to {label} directly. It is turned \
                    off while {client} points at the gateway, and turned back on when it is restored."
            ),
            Where::Shell { path, line } => msg!(
                "adopt.plan.cloud_off.shell",
                client = c.name,
                name = name,
                cloud = slug,
                path = path.display(),
                line = line
                => "{path} exports {name} on line {line}, so {client} connects to {label} directly. \
                    It is turned off while {client} points at the gateway, and turned back on when it \
                    is restored."
            ),
            Where::Environment => msg!(
                "adopt.plan.cloud_off.env",
                client = c.name,
                name = name,
                cloud = slug
                => "The environment sets {name}, so {client} connects to {label} directly. It is \
                    turned off while {client} points at the gateway, and turned back on when it is \
                    restored."
            ),
            Where::Above(p) => msg!(
                "adopt.plan.cloud_above",
                client = c.name,
                name = name,
                cloud = slug,
                path = p.display()
                => "{path} turns on {name} and takes precedence over what is written here, so \
                    {client} started in that directory still connects to {label} directly."
            ),
            // 托管配置打开的已经拒绝了，走不到这里
            Where::Managed(_) => continue,
        });
    }
    if on
        .iter()
        .any(|o| o.cloud.is_bedrock() && o.at.turned_off_here())
    {
        let names = cloud::unpinned_models(home, settings, around);
        if !names.is_empty() {
            out.push(msg!(
                "adopt.plan.cloud_models",
                client = c.name,
                names = names.join(", ")
                => "No Bedrock model is set in {names}, so for those models {client} asks the \
                    gateway by Anthropic's model names; a routing rule has to rewrite those names to \
                    a Bedrock model."
            ));
        }
    }
    out
}

/// 接管完成那一屏要说的话（什么时候生效、有什么代价、查证到什么程度），和
/// 优先级比我们高、此刻在的那些文件。
pub(crate) fn adopt_notes(c: &Client, home: &Path, gw: &Gateway) -> (Vec<Msg>, Vec<PathBuf>) {
    let mut notes = vec![takes_effect_note(c)];
    notes.extend(cost_notes(c));
    // 一个模型都没写进去：opencode 里不会出现网关的模型。**在确认之前说**，
    // 而不是让用户接管完了在模型列表里找不到
    if c.writes_models && gw.models.is_empty() {
        notes.push(msg!(
            "adopt.plan.no_models", client = c.name =>
            "The gateway has no model available to this key yet, so no ThinkWatch model \
             shows up in {client}. Once models are available, update the model list on the \
             Clients page."
        ));
    }
    if c.verified == crate::clients::Verified::FieldsOnly {
        notes.push(fields_only_note(c));
    }

    let shadows = c.live_shadows(home);
    if !shadows.is_empty() {
        notes.push(msg!(
            "adopt.plan.shadowed",
            paths = shadows
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
            => "{paths} was found, and it takes precedence over what was written here, so a setting of the same name there wins."
        ));
    }
    (notes, shadows)
}

/// 接管的代价，每条一句
pub(crate) fn cost_notes(c: &Client) -> impl Iterator<Item = Msg> + '_ {
    c.costs.iter().map(|(code, text)| Msg {
        code: (*code).into(),
        args: BTreeMap::new(),
        text: (*text).into(),
    })
}

pub(crate) fn fields_only_note(c: &Client) -> Msg {
    msg!(
        "adopt.plan.fields_only"
        => "{} Do not take it as working until the first request arrives.",
        c.verified.note()
    )
}

/// 一份文件的接管改动：读它、记下原值、改那几个字段、放上哨兵。**不写任何东西。**
///
/// 只管这一个文件的字节和记录，接管说明由调用方补。
pub(crate) fn adopt_file(
    client: &str,
    path: PathBuf,
    fmt: Format,
    edits: &[Edit],
) -> Result<Plan, PlanError> {
    let before = foreign::read(&path).map_err(|source| PlanError::Read {
        client: client.into(),
        source,
    })?;
    let base = before.clone().unwrap_or_else(|| empty(fmt).to_string());

    // 之前接管过的话，「原值」以那一次的记录为准，不看现在文件里是什么
    // —— 现在文件里的正是我们上次写进去的。
    let real = foreign::resolve(&path)?;
    let side = sentinel::sidecar_path(&real);
    // **记录在、却读不出来或者是别人的，就不接管**，和还原一样拒绝：当成「没接管过」
    // 的话，此刻文件里的网关地址和密钥会被记成「原值」（见 [`Plan::prior`]）
    let prior_rec = match read_record(client, &side)? {
        Some(r) if r.client != client => {
            return Err(PlanError::ForeignSidecar {
                path: side,
                other: r.client,
                client: client.into(),
            });
        }
        r => r,
    };
    let prior_originals = match &prior_rec {
        Some(r) => Some(originals_from(r, fmt, client)?),
        None => None,
    };

    let mut text = base.clone();
    let mut originals = Vec::new();
    let mut carries_secret = false;

    let mut targets = Vec::new();
    for Edit {
        path: p,
        value,
        secret,
    } in edits
    {
        let r = refs(p);
        let was = match prior_originals
            .as_ref()
            .and_then(|os| os.iter().find(|o| o.path == *p))
        {
            Some(o) => o.was.clone(),
            None => match peek(fmt, &text, &r, client)? {
                None => Was::Missing,
                // 原值是密钥的话，它只进全文备份，不进旁文件
                Some(v) if *secret => Was::Secret(v),
                Some(v) => Was::Value(v),
            },
        };
        originals.push(Original::new(p, was));
        carries_secret |= secret;
        // 已经是这个值了就不碰那一段字节：JSON 的数组和对象是重新排出来的，
        // 重排一遍会换掉原来的排版 —— 重复接管也就不再是空操作
        let same = fmt == Format::Json
            && crate::json::get(&text, &r).ok().flatten().as_ref() == Some(value);
        if !same {
            text = put(fmt, &text, &r, value, client)?;
        }
        targets.push(Target::Set(p.clone(), value.clone()));
    }
    // 上一次写过、这一次不写的字段**照样记着**：它们还在文件里（opencode 两次
    // 接管之间换了写法时，v1 那一条连同密钥都还在），记录里没了，还原就不会
    // 收走它们
    if let Some(os) = prior_originals {
        for o in os {
            if !originals.iter().any(|n: &Original| n.path == o.path) {
                originals.push(o);
            }
        }
    }

    // 哨兵注释放在最前面 —— 要的是**用户打开文件就看见**。
    // 严格 JSON 装不下注释，那时只有旁文件。
    if let Some(prefix) = crate::clients::comment_prefix(fmt) {
        let block = sentinel::comment_block(prefix, &originals);
        // 重复接管不该叠一堆哨兵
        text = format!("{block}{}", sentinel::strip(&text, prefix));
    }

    Ok(Plan {
        client: client.into(),
        path,
        before,
        after: text,
        originals,
        carries_secret,
        notes: Vec::new(),
        shadows: Vec::new(),
        targets,
        drop_sidecar: None,
        delete_file: false,
        format: fmt,
        also: Vec::new(),
        prior: prior_rec.map(|r| (r.backup, r.created_file)),
    })
}

/// 从一份接管记录里还原出「原值」。密钥类的去全文备份里取。
fn originals_from(
    rec: &SidecarRecord,
    fmt: Format,
    client: &str,
) -> Result<Vec<Original>, PlanError> {
    let backed = std::fs::read_to_string(&rec.backup).ok();
    let backed_val = match &backed {
        Some(t) if t.trim().is_empty() => Some(Val::Obj(Vec::new())),
        Some(t) => Some(semantic(fmt, t, client)?),
        None => None,
    };
    Ok(rec
        .originals
        .iter()
        .map(|f| {
            let path = f.path.clone();
            let was = match f.was.as_str() {
                "missing" => Was::Missing,
                "secret" => match backed_val.as_ref().and_then(|v| lookup(v, &refs(&path))) {
                    Some(v) => Was::Secret(v.to_line()),
                    // 备份没了就拿不回来。**记成「原本没有」是错的** ——
                    // 那会让还原把一个本来有值的字段删掉，还一声不吭。
                    None => Was::Secret(String::new()),
                },
                _ => match &f.value {
                    Some(v) => Was::Value(v.clone()),
                    None => Was::Missing,
                },
            };
            Original {
                field: f.field.clone(),
                path,
                was,
            }
        })
        .collect())
}

/// 落盘。**用户确认之后才该调到这里。**
///
/// 几份文件的改动（[`Plan::also`]）一起落盘：后面哪一份失败，前面写好的都退回去。
pub fn apply(c: &Client, plan: &Plan, backup_root: &Path) -> Result<Applied, PlanError> {
    let _ = c;
    let mut done: Vec<(Applied, Option<String>)> = Vec::new();
    for p in std::iter::once(plan).chain(&plan.also) {
        match apply_file(p, backup_root) {
            Ok(a) => done.push(a),
            Err(e) => return Err(undo_all(&done).map_or(e, PlanError::Write)),
        }
    }
    let mut it = done.into_iter().map(|(a, _)| a);
    let mut first = it.next().expect("至少有主配置那一份");
    for a in it {
        first.warnings.extend(a.warnings);
    }
    Ok(first)
}

/// 把已经落盘的那几份倒着退回去。**退不回去的要说出来**，返回第一处：那时文件停在
/// 一半，用户得知道是哪一个、原来的内容在哪儿 —— 这比让它停下来的那个原因更要紧。
/// 一处退不回去也照样退别的。
fn undo_all(done: &[(Applied, Option<String>)]) -> Option<ForeignError> {
    let mut first = None;
    for (a, side) in done.iter().rev() {
        if let Err(e) = undo(a, side.as_deref()) {
            first.get_or_insert(e);
        }
    }
    first
}

/// 退回一份已经落盘的改动：文件换回原文，旁文件换回原来那一份（或者删掉）。两样
/// 都做，报先出错的那一样。
fn undo(a: &Applied, old_sidecar: Option<&str>) -> Result<(), ForeignError> {
    let file = rollback(a);
    let side = sentinel::sidecar_path(&a.real);
    let record = match old_sidecar {
        Some(t) => crate::foreign::write_atomic(&side, t.as_bytes(), None),
        None => match std::fs::remove_file(&side) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(ForeignError::Write {
                path: side,
                source: e,
            }),
            _ => Ok(()),
        },
    };
    file.and(record)
}

/// 一份文件落盘，返回结果和它之前的旁文件（退回时要用）。
fn apply_file(plan: &Plan, backup_root: &Path) -> Result<(Applied, Option<String>), PlanError> {
    let fmt = plan.format;
    let client = plan.client.clone();
    let expect = expected(plan)?;

    let applied = foreign::apply(
        &Change {
            path: &plan.path,
            before: plan.before.as_deref(),
            after: &plan.after,
            carries_secret: plan.carries_secret,
        },
        backup_root,
        |text| {
            // **写回校验**：重新解析，和「原文件 + 预期的那几处改动」比。
            // 对不上就拒绝落盘、原文件一个字节不动。
            let got = semantic(fmt, text, &client).map_err(|e| e.to_string())?;
            if got.normalized() == expect.normalized() {
                Ok(())
            } else {
                Err("the edited content is not the original plus the intended change".into())
            }
        },
    )?;

    // 旁文件在最后写，因为它要记下备份路径。**写不成就把配置也退回去**
    // —— 一次接管要么完整，要么等于没发生；只改了配置却没留下还原记录，
    // 是这里面最坏的一种半成品。
    let side = sentinel::sidecar_path(&applied.real);
    let old_side = std::fs::read_to_string(&side).ok();
    // 重复接管时，**指向第一次那份备份**。这一次的备份里装的是已经被我们
    // 改过的文件，拿它去还原等于还原到我们自己身上。
    let (backup, created) = plan
        .prior
        .clone()
        .unwrap_or_else(|| (applied.backup.display().to_string(), applied.created));
    let rec = SidecarRecord::new(&plan.client, now_ms(), &backup, created, &plan.originals);
    if let Err(e) = write_sidecar(&side, &rec) {
        // 配置也退不回去的话，说的是那一件：它停在改过的样子上，而且没有记录
        return Err(PlanError::Write(rollback(&applied).err().unwrap_or(e)));
    }
    Ok((applied, old_side))
}

/// 「原文件 + 预期的那几处改动」—— 写回校验的参照物。
fn expected(plan: &Plan) -> Result<Val, PlanError> {
    let base = plan
        .before
        .clone()
        .unwrap_or_else(|| empty(plan.format).to_string());
    let mut v = semantic(plan.format, &base, &plan.client)?;
    for t in &plan.targets {
        v = match t {
            Target::Set(p, val) => v.with(&refs(p), &as_read(plan.format, val)),
            Target::Remove(p) => v.without(&refs(p)),
        };
    }
    Ok(v)
}

/// 什么都不剩：一个空的对象（空的映射、空的表）
fn is_empty(v: &Val) -> bool {
    matches!(v, Val::Obj(ms) if ms.is_empty())
}

/// 一个值写进去之后再读出来是什么样。YAML 的语义值里标量都是字符串
/// （见 [`crate::yamlval`]），`version: 1` 读回来是 `"1"`。
fn as_read(fmt: Format, v: &Val) -> Val {
    match (fmt, v) {
        (Format::Yaml | Format::Rows, Val::Num(_) | Val::Bool(_)) => Val::s(v.to_line()),
        _ => v.clone(),
    }
}

/// 落盘一次还原。和 [`apply`] 走同一套护栏，只是最后**删掉**旁文件而不是
/// 写它 —— 还原之后不该再留下「这个文件被接管着」的痕迹。
///
/// 另外那几份文件先还原、主配置最后：中途失败时，主配置仍然完整地指着网关，
/// 而不是指着一个已经从凭据文件里删掉的密钥名。
pub fn apply_restore(c: &Client, plan: &Plan, backup_root: &Path) -> Result<Applied, PlanError> {
    let _ = c;
    let mut done: Vec<(Applied, Option<String>)> = Vec::new();
    let mut warnings = Vec::new();
    // 哪一份还原不成，前面还原了的都退回接管状态：还原一半，比哪一份都没动更难收拾。
    // 退不回去的那一份要说出来（[`undo_all`]）
    let undo_done = |done: &[(Applied, Option<String>)], e: PlanError| {
        undo_all(done).map_or(e, PlanError::Write)
    };
    for p in &plan.also {
        match restore_file(p, backup_root) {
            Ok(Some((a, side))) => {
                warnings.extend(a.warnings.iter().cloned());
                done.push((a, side));
            }
            Ok(None) => {}
            Err(e) => return Err(undo_done(&done, e)),
        }
    }
    match restore_file(plan, backup_root) {
        Ok(Some((mut a, _))) => {
            a.warnings.extend(warnings);
            Ok(a)
        }
        Ok(None) => Ok(Applied {
            real: plan.path.clone(),
            asked: plan.path.clone(),
            backup: PathBuf::new(),
            created: false,
            warnings,
        }),
        Err(e) => Err(undo_done(&done, e)),
    }
}

/// 一份文件的还原落盘，返回结果和删掉之前的旁文件（退回时要用）。
/// 文件已经不在了的，只删记录（`None`）—— 不能照着空的原文写出一个空文件。
fn restore_file(
    plan: &Plan,
    backup_root: &Path,
) -> Result<Option<(Applied, Option<String>)>, PlanError> {
    let fmt = plan.format;
    let old_side = plan
        .drop_sidecar
        .as_ref()
        .and_then(|s| std::fs::read_to_string(s).ok());
    let drop_side = || {
        if let Some(side) = &plan.drop_sidecar {
            let _ = std::fs::remove_file(side);
        }
    };
    if plan.before.is_none() {
        drop_side();
        return Ok(None);
    }
    if plan.delete_file {
        // 删之前照样先备份。**「删掉一个文件」是这里面最不可逆的动作**，
        // 它更需要那份备份，不是更不需要。
        let applied = foreign::apply(
            &Change {
                path: &plan.path,
                before: plan.before.as_deref(),
                after: plan.before.as_deref().unwrap_or(""),
                carries_secret: false,
            },
            backup_root,
            |_| Ok(()),
        )?;
        std::fs::remove_file(&applied.real).map_err(|source| ForeignError::Write {
            path: applied.real.clone(),
            source,
        })?;
        drop_side();
        return Ok(Some((applied, old_side)));
    }
    let client = plan.client.clone();
    let expect = expected(plan)?;
    let applied = foreign::apply(
        &Change {
            path: &plan.path,
            before: plan.before.as_deref(),
            after: &plan.after,
            carries_secret: false,
        },
        backup_root,
        |text| {
            let got = semantic(fmt, text, &client).map_err(|e| e.to_string())?;
            if got.normalized() == expect.normalized() {
                Ok(())
            } else {
                Err(
                    "the restored content is not the current file minus the fields written here"
                        .into(),
                )
            }
        },
    )?;
    drop_side();
    Ok(Some((applied, old_side)))
}

/// 算一份还原改动。**不写任何东西。**
///
/// 分工是刻意的：**旁文件说「我们动过哪几个字段」，全文备份说「它们原来
/// 是什么」**。所以密钥类的原值一份都不用抄进旁文件，也不会因此丢失。
pub fn plan_restore(c: &Client, home: &Path) -> Result<Plan, PlanError> {
    if c.id == crate::desktop::ID {
        return crate::desktop::plan_restore(c, home);
    }
    let c = &c.clone().here(home);
    let mut plan = restore_file_plan(c.id, c.config_path(home), c.format)?;
    plan.notes.extend(restore_cloud_notes(c, &plan));
    if let Some(also) = crate::clients::also(c) {
        // 另外那一份没有记录（接管那时还没有它、或者记录被删了）就不动它：
        // 主配置照样还原，**不因为它拦住整个还原**
        match restore_file_plan(c.id, also.config.resolve(home), also.format) {
            Ok(p) => {
                plan.notes.extend(p.notes.iter().cloned());
                plan.also.push(p);
            }
            Err(PlanError::NoRecord { .. }) => {}
            Err(e) => return Err(e),
        }
    }
    plan.notes.insert(0, takes_effect_note(c));
    Ok(plan)
}

/// 还原时关于云服务商开关要说的话：接管时关掉的那几个，改回原来的样子之后 Claude Code
/// 会不会又直连那一家（[`crate::cloud`]）。原来写着「打开」的，重新打开；原来 settings.json
/// 里没有它的（shell 里 export 的），拿掉空串之后又由环境说了算。
fn restore_cloud_notes(c: &Client, plan: &Plan) -> Vec<Msg> {
    plan.targets
        .iter()
        .filter_map(|t| {
            let (path, back) = match t {
                Target::Set(p, v) => (p, Some(v)),
                Target::Remove(p) => (p, None),
            };
            let [env, name] = path.as_slice() else {
                return None;
            };
            let &(name, cloud) = cloud::SWITCHES
                .iter()
                .find(|(n, _)| env == "env" && *n == name.as_str())?;
            let (slug, label) = (cloud.slug(), cloud.name());
            match back {
                Some(v) if cloud::val_on(v) => Some(msg!(
                    "adopt.restore.cloud_on",
                    client = c.name,
                    name = name,
                    cloud = slug
                    => "{name} is turned back on, so {client} connects to {label} directly again."
                )),
                // 改回的是一个「关着」的值：没什么要说的
                Some(_) => None,
                None => Some(msg!(
                    "adopt.restore.cloud_env",
                    client = c.name,
                    name = name,
                    cloud = slug
                    => "{name} is taken out of this file again, so the environment decides again \
                        whether {client} connects to {label} directly."
                )),
            }
        })
        .collect()
}

/// 一份文件的还原改动。**不写任何东西。**没有接管记录就是 [`PlanError::NoRecord`]。
pub(crate) fn restore_file_plan(
    client: &str,
    path: PathBuf,
    fmt: Format,
) -> Result<Plan, PlanError> {
    let real = foreign::resolve(&path)?;
    let before = foreign::read(&path).map_err(|source| PlanError::Read {
        client: client.into(),
        source,
    })?;
    let side = sentinel::sidecar_path(&real);
    let Some(rec) = read_record(client, &side)? else {
        return Err(PlanError::NoRecord {
            client: client.into(),
            path: side,
        });
    };
    if rec.client != client {
        return Err(PlanError::ForeignSidecar {
            path: side,
            other: rec.client,
            client: client.into(),
        });
    }

    let Some(mut text) = before.clone() else {
        // 文件都没了，没什么可还原的 —— 把记录删掉就行
        return Ok(Plan {
            client: client.into(),
            path,
            before,
            after: String::new(),
            originals: Vec::new(),
            carries_secret: false,
            notes: vec![
                msg!("adopt.restore.config_gone" => "The configuration file is gone; only the record was removed."),
            ],
            shadows: Vec::new(),
            targets: Vec::new(),
            drop_sidecar: Some(side),
            delete_file: false,
            format: fmt,
            also: Vec::new(),
            prior: None,
        });
    };

    // 全文备份是原值的来源。它还在的话，连密钥都能原样放回去。
    let backup = PathBuf::from(&rec.backup);
    let backed = std::fs::read_to_string(&backup).ok();
    let backed_val = match &backed {
        // 空备份 = 接管前那个文件根本不存在。**这和「备份丢了」不是一
        // 回事**：前者知道原来什么都没有，后者是不知道原来是什么。
        Some(t) if t.trim().is_empty() => Some(Val::Obj(Vec::new())),
        Some(t) => Some(semantic(fmt, t, client)?),
        None => None,
    };

    let mut notes = Vec::new();
    let mut targets = Vec::new();
    for f in &rec.originals {
        let p = f.path.clone();
        let r = refs(&p);
        let from_backup = backed_val.as_ref().and_then(|v| lookup(v, &r));
        match (f.was.as_str(), from_backup, &f.value) {
            ("missing", _, _) => targets.push(Target::Remove(p.clone())),
            (_, Some(v), _) => targets.push(Target::Set(p.clone(), v)),
            (_, None, Some(v)) => targets.push(Target::Set(p.clone(), Val::s(v))),
            ("secret", None, None) => {
                // **说出来，别假装还原成功了。**原来那儿是用户自己的
                // 密钥，备份没了我们就是拿不回来；留着我们的密钥比删掉
                // 更糟 —— 那等于卸载之后还在替他发着请求。
                targets.push(Target::Remove(p.clone()));
                notes.push(msg!(
                    "adopt.restore.secret_lost",
                    field = f.field.clone(),
                    backup = backup.display()
                    => "The original value of {field} is a secret kept only in the full backup, and {backup} is gone. The field was removed and has to be filled in again by hand."
                ));
            }
            (_, None, None) => targets.push(Target::Remove(p.clone())),
        }
    }

    // 有的字段还原之后得留下（Codex 那一段影子 OpenAI，见
    // `clients::leaves_behind`）。删它们的那几条让给写它们的那一条；它们的容器
    // 因此不空，下面也就不会被收走。
    let now = semantic(fmt, &text, client)?;
    for Edit { path: p, value, .. } in crate::clients::leaves_behind(client, &now) {
        targets.retain(|t| !matches!(t, Target::Remove(x) if p.starts_with(x)));
        targets.push(Target::Set(p, value));
    }

    // 文件里还剩别的东西就得留着的字段（dsh 凭据文件的 `version`，见
    // `clients::kept_while_in_use`）：接管时加的，照理要收走，可收走之后剩下的东西
    // 就没人认了。删它们的那几条**先放着**，等别的字段都改回去、空了的容器也收走
    // 之后再看（最后一段）
    let kept = crate::clients::kept_while_in_use(client, fmt);
    let (later, mut targets): (Vec<Target>, Vec<Target>) = targets
        .into_iter()
        .partition(|t| matches!(t, Target::Remove(x) if kept.iter().any(|k| k.starts_with(x))));

    for t in &targets {
        text = match t {
            // 已经是那个值了就不写：重写一遍可能换掉原来的写法（`version: 1`
            // 按字符串写回去会变成 `'1'`，dsh 就不认这个文件了）
            Target::Set(p, v) if peek(fmt, &text, &refs(p), client)? == Some(v.to_line()) => text,
            Target::Set(p, v) => put(fmt, &text, &refs(p), v, client)?,
            Target::Remove(p) => drop_(fmt, &text, &refs(p), client)?,
        };
    }

    // 我们凭空造出来的容器（比如原本没有的 `env`）要跟着收走，
    // 否则「还原」之后会留下一个用户从来没有过的空段落。
    //
    // **只收空了的。**接管之后用户可能往这个容器里加了自己的东西（`env` 里的另一个
    // 变量、opencode 里另一家 provider、dsh 凭据里另一条引用）：整段删掉就是替他删了
    // 配置。所以等上面那几个字段都改回去之后再看，从最深的一层往外收。
    if let Some(bv) = &backed_val {
        let mut created: Vec<Vec<String>> = rec
            .originals
            .iter()
            .flat_map(|f| (1..f.path.len()).map(|cut| f.path[..cut].to_vec()))
            .filter(|anc| lookup(bv, &refs(anc)).is_none())
            .collect();
        created.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
        created.dedup();
        for anc in created {
            if targets.iter().any(|t| match t {
                Target::Set(x, _) | Target::Remove(x) => *x == anc,
            }) {
                continue;
            }
            match lookup(&semantic(fmt, &text, client)?, &refs(&anc)) {
                // 删掉最后一个字段时容器已经跟着没了（YAML 的嵌套映射）。照样记一条：
                // 写回校验按这几条改动推算还原之后该是什么样
                None => {}
                Some(Val::Null) => text = drop_(fmt, &text, &refs(&anc), client)?,
                Some(Val::Obj(ms)) if ms.is_empty() => {
                    text = drop_(fmt, &text, &refs(&anc), client)?
                }
                // 里面有用户自己的东西：留着
                Some(_) => continue,
            }
            targets.push(Target::Remove(anc));
        }
    }

    // 先放着的那几条（`version`）：别的都改回去之后**什么都不剩才收**，文件是我们建的
    // 就照旧整个删掉；还剩东西就留着它们，留的是文件里此刻的样子，不另写一个值进去
    if !later.is_empty() {
        let rest = kept
            .iter()
            .fold(semantic(fmt, &text, client)?, |v, k| v.without(&refs(k)));
        if is_empty(&rest) {
            for t in later {
                if let Target::Remove(p) = &t {
                    text = drop_(fmt, &text, &refs(p), client)?;
                }
                targets.push(t);
            }
        }
    }
    if let Some(prefix) = crate::clients::comment_prefix(fmt) {
        text = sentinel::strip(&text, prefix);
    }

    // 当初这个文件就是我们建的，还原之后又空了 —— 那就整个删掉。
    // **只在空的时候删**：用户可能在这三个月里往里加了自己的东西，
    // 那些必须留下（卸载走还原，不是拿备份覆盖）。
    let delete_file =
        rec.created_file && matches!(semantic(fmt, &text, client)?, Val::Obj(ms) if ms.is_empty());
    if delete_file {
        notes.push(msg!("adopt.restore.file_removed" => "This file was created here, restoring leaves it empty, and it was removed with the rest."));
    }

    Ok(Plan {
        client: client.into(),
        path,
        before,
        after: text,
        originals: Vec::new(),
        carries_secret: false,
        notes,
        shadows: Vec::new(),
        targets,
        drop_sidecar: Some(side),
        delete_file,
        format: fmt,
        also: Vec::new(),
        prior: None,
    })
}

pub(crate) fn lookup(v: &Val, path: &[&str]) -> Option<Val> {
    let mut cur = v;
    for k in path {
        let Val::Obj(ms) = cur else { return None };
        cur = &ms.iter().find(|(mk, _)| mk == k)?.1;
    }
    Some(cur.clone())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 一份文件旁边的接管记录。**没有是 `None`；在却读不出来、解析不了是错**，不是「没有」。
///
/// 接管和还原都从这里读，所以两边对一份坏记录说的是同一句话（解析不了的那一句带上
/// 记录的路径：用户要去看、去删的是它，不是配置文件本身）。当成「没有」对还原来说是
/// 找不到原值，对接管来说更糟 —— 见 [`Plan::prior`]。
pub(crate) fn read_record(client: &str, side: &Path) -> Result<Option<SidecarRecord>, PlanError> {
    let text = match std::fs::read_to_string(side) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(source) => {
            return Err(PlanError::Read {
                client: client.into(),
                source: ForeignError::Read {
                    path: side.to_path_buf(),
                    source,
                },
            });
        }
    };
    serde_json::from_str(&text).map(Some).map_err(|e| {
        // 只说在哪儿、为什么，**不抄原文**：serde 的原话会把认不出的那个值带出来，
        // 而这句话一路显示到界面上（配置文件的解析错误也是这么说的）
        let why = match e.classify() {
            serde_json::error::Category::Data => "not the record written here",
            _ => "not valid JSON",
        };
        parse_err(
            client,
            format!(
                "{}: line {}, column {}: {why}",
                side.display(),
                e.line(),
                e.column()
            ),
        )
    })
}

/// 写接管记录。**原子地换上去**（临时文件 + rename，和配置文件同一条路）：写到一半
/// 断电的话，留下的是上一份完整的记录，而不是半截 —— 半截的记录读不出来，那个文件
/// 就既还原不了、也不能再接管。临时文件生来就是 `0600`，换上去之后仍然是。
fn write_sidecar(path: &Path, rec: &SidecarRecord) -> Result<(), ForeignError> {
    let text = serde_json::to_string_pretty(rec).unwrap_or_default();
    crate::foreign::write_atomic(path, text.as_bytes(), None)
}

/// 拿全文备份把一份刚写过的文件放回去（我们新建的就删掉）。放不回去是错，见
/// [`foreign::put_back`]。
fn rollback(a: &Applied) -> Result<(), ForeignError> {
    if a.created {
        return foreign::put_back(&a.real, None, &a.backup);
    }
    let text = std::fs::read(&a.backup).map_err(|source| ForeignError::NotRestored {
        path: a.real.clone(),
        backup: a.backup.clone(),
        source,
    })?;
    foreign::put_back(&a.real, Some(&text), &a.backup)
}

#[cfg(test)]
mod undoing {
    use super::*;

    /// 后面那一份失败、前面写好的要退回去：**退不回去的要说出来**（是哪一个、原文在
    /// 哪儿），而且一处退不回去，别的照样退
    #[test]
    fn a_file_that_cannot_be_undone_is_reported_and_the_rest_are_still_undone() {
        let d = tempfile::tempdir().unwrap();
        let applied = |real: &Path, backup: PathBuf, created: bool| Applied {
            real: real.to_path_buf(),
            asked: real.to_path_buf(),
            backup,
            created,
            warnings: Vec::new(),
        };
        // 改过的配置，它的全文备份却已经没了
        let stuck = d.path().join("settings.json");
        std::fs::write(&stuck, "ours").unwrap();
        // 我们新建的文件
        let created = d.path().join("credentials.yaml");
        std::fs::write(&created, "ours").unwrap();
        let done = vec![
            (applied(&stuck, d.path().join("gone"), false), None),
            (applied(&created, d.path().join("empty"), true), None),
        ];

        let e = undo_all(&done).expect("有一份退不回去，要说出来");
        assert!(
            matches!(&e, ForeignError::NotRestored { path, .. } if *path == stuck),
            "{e}"
        );
        assert!(!created.exists(), "一处退不回去，别的也不退了");
        assert_eq!(std::fs::read_to_string(&stuck).unwrap(), "ours");
        // 这时整个接管报的就是它
        assert_eq!(PlanError::Write(e).msg().code, "adopt.file.not_restored");
    }
}

#[cfg(test)]
mod msg_codes {
    use super::*;
    use crate::mcp::McpError;

    #[test]
    fn every_adopt_error_has_its_own_code() {
        let p = || PathBuf::from("/h/.claude/settings.json");
        let io = || std::io::Error::other("denied");
        let foreign = || {
            vec![
                ForeignError::Read {
                    path: p(),
                    source: io(),
                },
                ForeignError::Write {
                    path: p(),
                    source: io(),
                },
                ForeignError::ChangedUnderUs { path: p() },
                ForeignError::VerifyFailed("x".into()),
                ForeignError::Readback { path: p() },
                ForeignError::LinkLoop { path: p() },
                ForeignError::NotRestored {
                    path: p(),
                    backup: p(),
                    source: io(),
                },
                ForeignError::NotRemoved {
                    path: p(),
                    source: io(),
                },
            ]
        };
        let mut all: Vec<(Msg, String)> = foreign()
            .into_iter()
            .map(|e| (e.msg(), e.to_string()))
            .collect();
        for e in [
            PlanError::Read {
                client: "claude-code".into(),
                source: ForeignError::Read {
                    path: p(),
                    source: io(),
                },
            },
            PlanError::Parse {
                client: "claude-code".into(),
                msg: "x".into(),
            },
            PlanError::ForeignSidecar {
                path: p(),
                other: "codex".into(),
                client: "claude-code".into(),
            },
            PlanError::NoRecord {
                client: "claude-code".into(),
                path: p(),
            },
            PlanError::Managed {
                client: "Claude Desktop".into(),
                by: "/etc/claude-desktop/managed-settings.json".into(),
            },
        ] {
            all.push((e.msg(), e.to_string()));
        }
        for e in [
            McpError::UnknownClient("x".into()),
            McpError::Parse {
                client: "zed".into(),
                msg: "x".into(),
            },
            McpError::NotThere {
                client: "zed".into(),
                name: "fs".into(),
            },
        ] {
            all.push((e.msg(), e.to_string()));
        }
        let mut seen = std::collections::HashSet::new();
        for (m, display) in &all {
            assert!(m.code.starts_with("adopt."), "{m:?}");
            assert!(!m.text.is_empty() && &m.text == display, "{m:?}");
            assert!(seen.insert(m.code.clone()), "码重复了：{}", m.code);
        }
        // 包着的那几层用里面那一句的码
        let w = PlanError::Write(ForeignError::LinkLoop { path: p() });
        assert_eq!(w.msg().code, "adopt.file.link_loop");
        let r = PlanError::Read {
            client: "x".into(),
            source: ForeignError::LinkLoop { path: p() },
        };
        assert_eq!(r.msg().code, "adopt.file.link_loop");
        // 不能写的理由本来就有码，直接说它
        let e = crate::mcp::target("zed").unwrap().why_not().unwrap();
        let m = McpError::NotCopyable {
            client: "zed".into(),
            why: e.clone(),
        }
        .msg();
        assert_eq!(m, e);
    }
}
