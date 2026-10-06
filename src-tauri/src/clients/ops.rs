//! 接管、还原、诊断：**在这台机器上做，不经过 core。**
//!
//! 这是全应用唯一会写用户其他软件配置的地方，所以形状也是刻意的：
//! **算一份改动和落盘是两步**，中间必须夹一次人的确认。一个「一步接管」的
//! 入口会顺手到没有人记得展示 diff。
//!
//! 这一层只要 core 回答两件事，都由调用方问好了递进来（[`Gateway`]）：客户端
//! 该连哪个网关，和有哪几把网关密钥。**密钥由 core 发放**（`POST /clients/{id}/key`），
//! 这里不写 config.yaml。连着的是哪个 core，这里不关心 —— 改的总是这台机器上的文件。

use std::collections::BTreeMap;
use std::path::Path;

use tw_adopt::clients::{self, Client, ModelCard};
use tw_adopt::cloud::Around;
use tw_adopt::{detect, plan};
use tw_api::ClientView;
use tw_types::{Msg, msg};

use crate::wire;

/// 接管要从 core 那里知道的两件事。
pub struct Gateway {
    /// 客户端该连的地址，形如 `http://127.0.0.1:8788`。**不是监听地址**：
    /// `0.0.0.0` 是「我在所有网卡上听」，填进客户端配置里，客户端会去连一个
    /// 不存在的主机
    pub base: String,
    /// config.yaml 里的网关密钥（`GET /keys`：明文、为谁生成的、哪把是默认的、
    /// 最后一次用在什么时候）
    pub keys: Vec<ClientView>,
}

impl Gateway {
    /// 为这个客户端留着的那把（取消接管之后它还在）
    fn key_of(&self, client: &str) -> Option<&ClientView> {
        self.keys
            .iter()
            .find(|k| k.client.as_deref() == Some(client))
    }
}

/// 能接管的客户端，带着用户为这台电脑上的它们换过的配置文件（见 [`super::locations`]）。
/// WSL 里的、测试用的临时目录，给的都是表里原样的那一份。
pub fn all(home: &Path) -> Vec<Client> {
    let moved = super::locations::moved(home);
    clients::adoptable()
        .into_iter()
        .map(|mut c| {
            c.custom_config = moved.get(c.id).and_then(|p| p.config.clone());
            c
        })
        .collect()
}

/// 认得的、能接管的那一个，带着用户指定的配置文件（见 [`all`]）。
pub fn find(id: &str, home: &Path) -> Result<Client, Msg> {
    all(home)
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| unknown(id))
}

/// 认得的客户端：能接管的，加上只能手动配置的。为它准备专用密钥之前先问这个 ——
/// core 发密钥时不认客户端，认的是这里
pub fn known(id: &str) -> bool {
    clients::adoptable().iter().any(|c| c.id == id)
        || clients::manual_only().iter().any(|m| m.id == id)
        || tw_adopt::wsl::split_key_id(id).is_some()
}

pub fn unknown(id: &str) -> Msg {
    msg!("control.client_unknown", client = id => "`{client}` is not a client we know.")
}

/// 客户端页的那一张表。
///
/// `models` 是要把模型写进配置的客户端（opencode、Pi、oh-my-pi、Grok Build、Qwen Code）和要从中
/// 挑一个默认模型的（Hermes Agent）此刻从网关问到的模型清单，按客户端 id：拿它和配置里写着的
/// 比，不一样就提示更新；手动配置的那几项也照它写。问不到的不在里面。
///
/// `backups` 是这一份的备份目录：接管着的客户端按它分出是不是这一份接管的（[`ours`]）。
pub fn list(
    home: &Path,
    backups: &Path,
    gw: &Gateway,
    models: &BTreeMap<String, Vec<ModelCard>>,
) -> wire::ClientsResponse {
    // 「使用中」的依据：**我们改了一个文件，但那个文件有没有被读到，只有请求能证明**
    // —— 而且是带着为它生成的那把密钥的请求。按请求头里自报的客户端标识算的话，
    // 一个没接管的客户端冒用那个标识就能让它显示成「使用中」
    let key_of = |id: &str| gw.key_of(id).map(|k| (k.name.clone(), k.last_seen_ms));
    // 手动配置时要写的字段按一把占位的密钥算：值本来就不回显，只要知道哪一项是密钥
    let placeholder = clients::Gateway {
        base: gw.base.clone(),
        key: Some(String::new()),
        models: Vec::new(),
    };
    let detected = all(home)
        .iter()
        .map(|c| {
            let d = detect::detect_one(c, home);
            let (key, last_seen_ms) = key_of(d.id).unzip();
            let now = models.get(d.id);
            let gw = clients::Gateway {
                models: now.cloned().unwrap_or_default(),
                ..placeholder.clone()
            };
            let manual = setup_of(c, c.manual_steps(), &gw);
            // 这一份接管着、而且两边都读得到才比：没接管的没有清单可比，问不到的
            // 不知道该是什么
            let stale = ours(&d, backups)
                && matches!(
                    (&d.models, now),
                    (Some(written), Some(now)) if c.models_stale(written, now)
                );
            let mut v = detected_view(d, backups, key, last_seen_ms.flatten(), manual, |p| {
                p.display().to_string()
            });
            v.models_stale = stale;
            v.movable = tw_adopt::locations::layout(c.id).is_some();
            v
        })
        .collect();
    let manual = clients::manual_only()
        .into_iter()
        .map(|m| {
            let (key, last_seen_ms) = key_of(m.id).unzip();
            wire::ManualClient {
                id: m.id.to_string(),
                name: m.name.to_string(),
                last_seen_ms: last_seen_ms.flatten(),
                key,
                setup: wire::ManualSetup {
                    steps: m.steps(),
                    fields: Vec::new(),
                    endpoint: m.endpoint(&placeholder),
                },
                caveat: m.caveat(),
                movable: tw_adopt::locations::layout(m.id).is_some(),
            }
        })
        .collect();
    wire::ClientsResponse {
        clients: detected,
        manual,
        keys: gw.keys.iter().map(|k| k.name.clone()).collect(),
        gateway_base: gw.base.clone(),
    }
}

/// 一个检测结果在界面上的样子。`shown` 决定路径怎么写：这台电脑上原样，WSL
/// 里的写成 WSL 终端里的样子
///
/// **`adopted_at_ms` 只给这一份接管的。**另一个 ThinkWatch Lite 接管的（[`theirs`]）标成
/// `other_instance`，界面上不给还原、也不给接管 —— 它的备份在那一份的数据目录里，
/// 从这里动它，那一份的接管记录就对不上了。
fn detected_view(
    d: detect::Detected,
    backups: &Path,
    key: Option<String>,
    last_seen_ms: Option<u64>,
    manual: wire::ManualSetup,
    shown: impl Fn(&Path) -> String,
) -> wire::DetectedClient {
    let (mine, other) = (ours(&d, backups), theirs(&d, backups));
    wire::DetectedClient {
        last_seen_ms,
        key,
        manual,
        id: d.id.to_string(),
        name: d.name.to_string(),
        path: shown(&d.path),
        real: shown(&d.real),
        installed: d.installed,
        has_config: d.has_config,
        adopted_at_ms: d.adopted_at_ms.filter(|_| mine),
        other_instance: other,
        endpoint: d.endpoint,
        shadows: d.shadows.iter().map(|p| shown(p)).collect(),
        takes_effect: d.takes_effect.into(),
        warns_when_silent: d.takes_effect.warns_when_silent(),
        verified: d.verified.into(),
        costs: d.costs,
        models_stale: false,
        models: d.models.map(|ms| ms.into_iter().map(|m| m.id).collect()),
        movable: false,
        managed: d.managed.as_ref().map(|by| {
            plan::PlanError::Managed {
                client: d.name.into(),
                by: by.clone(),
            }
            .msg()
        }),
    }
}

/// 一个 WSL 发行版里的客户端：第一批的那几个（`tw_adopt::wsl::CLIENTS`）。
///
/// 和这台电脑上的一样检测、一样给手动配置的方法，只是 home 是 WSL 里的，密钥是
/// 为 WSL 里这一份单独发的那把（`tw_adopt::wsl::key_id`）。
pub fn list_wsl(
    w: &tw_adopt::wsl::WslHome,
    backups: &Path,
    gw: &Gateway,
) -> Vec<wire::DetectedClient> {
    let placeholder = clients::Gateway {
        base: gw.base.clone(),
        key: Some(String::new()),
        models: Vec::new(),
    };
    all(&w.home)
        .iter()
        .filter(|c| tw_adopt::wsl::CLIENTS.contains(&c.id))
        .map(|c| {
            let d = detect::detect_one(c, &w.home);
            let owner = tw_adopt::wsl::key_id(c.id, w.name());
            let k = gw.key_of(&owner);
            let manual = setup_of(c, c.manual_steps_wsl(w), &placeholder);
            detected_view(
                d,
                backups,
                k.map(|k| k.name.clone()),
                k.and_then(|k| k.last_seen_ms),
                manual,
                |p| w.shown(p),
            )
        })
        .collect()
}

/// 手动配置一个能接管的客户端：打开哪个文件、写哪几项、填哪个地址。
/// 写的那几项就是接管时写的那几项 —— 两条路写出来的配置一模一样。
fn setup_of(c: &Client, steps: Vec<Msg>, gw: &clients::Gateway) -> wire::ManualSetup {
    wire::ManualSetup {
        steps,
        // 另一份文件里的那几项接在后面，步骤里说了它们在哪个文件
        fields: clients::edits(c, gw)
            .iter()
            .chain(&clients::also_edits(c, gw))
            .map(|e| field(wire::FieldOp::Set, &e.path, Some(&e.value), e.secret))
            .collect(),
        endpoint: c.endpoint(gw),
    }
}

/// 一处字段改动在界面上的样子。**密钥不回显**，哪怕是打码的。
fn field(
    op: wire::FieldOp,
    path: &[String],
    value: Option<&tw_adopt::json::Val>,
    secret: bool,
) -> wire::FieldChange {
    wire::FieldChange {
        op,
        path: path.join("."),
        value: if secret {
            None
        } else {
            value.map(|v| v.to_line())
        },
        secret,
    }
}

/// 接管这个客户端时哪几项是密钥。按一把占位的密钥算 —— 只看路径。
/// 主配置和另一份文件的路径不会撞（一个以行 id 开头，一个以 `refs` 开头）。
///
/// `models` 是这次写进去的模型：Grok Build 一个模型一张表，整张表算密钥，路径跟着模型走
fn secret_paths(c: &Client, models: &[ModelCard]) -> Vec<Vec<String>> {
    let gw = clients::Gateway {
        base: String::new(),
        key: Some(String::new()),
        models: models.to_vec(),
    };
    // opencode 的两种写法（`provider` 和 v2 原生的 `providers`）的密钥路径都算进来
    let native = clients::edits_for(c, &gw, r#"{"providers": {"thinkwatch": {}}}"#);
    let mut out: Vec<Vec<String>> = clients::edits(c, &gw)
        .into_iter()
        .chain(clients::also_edits(c, &gw))
        .chain(native)
        .chain(clients::edits_for(c, &gw, ""))
        .filter(|e| e.secret)
        .map(|e| e.path)
        .collect();
    out.dedup();
    out
}

fn secret_roots(c: &Client) -> &'static [&'static str] {
    clients::also(c).map_or(&[], |a| a.secret_roots)
}

fn fields_of(p: &plan::Plan, secrets: &[Vec<String>]) -> Vec<wire::FieldChange> {
    p.targets
        .iter()
        .map(|t| match t {
            plan::Target::Set(path, v) => {
                field(wire::FieldOp::Set, path, Some(v), secrets.contains(path))
            }
            plan::Target::Remove(path) => {
                field(wire::FieldOp::Remove, path, None, secrets.contains(path))
            }
        })
        .collect()
}

/// 密钥在界面上的样子。
///
/// **界面上永远不显示真正的密钥**，diff 里也不行 —— 用户会截图这一屏
/// 来问「这样对吗」。落盘写的仍然是真值，[`wire::PlanView`] 上那两个
/// 字段的文档里写清了这一点。
const MASK: &str = "«the gateway key from config.yaml»";

/// 别的密钥在界面上的样子：用户自己的（接管时被换下来的、还原时要放回去的），
/// 和 MCP server 的环境变量、请求头
const HIDDEN: &str = "«hidden secret»";

/// 不带引号地出现在别处（哨兵注释里）时，比这还短的值不去盖：盖一个 `1` 会把整份
/// diff 里的每一个 `1` 都换掉
const SHORTEST_SECRET: usize = 8;

/// 一份改动在界面上要盖住的值。
///
/// **diff 画的是整份文件**，里面除了我们写进去的网关那把，还有用户自己的密钥
/// —— 只盖网关那把的话，其余的全都原样出现在这一屏上。
pub(crate) struct Hide {
    /// 网关的那几把，出现在哪儿都换成 [`MASK`]
    gateway: Vec<String>,
    /// 密钥字段上的值（用户自己的，也可能是网关那把），换成 [`HIDDEN`]：带引号的
    /// 整串一律换；不带引号的 —— 哨兵注释里抄着的那一份（`# was …: sk-…`）、YAML
    /// 里的裸值 —— 够长的才换
    fields: Vec<String>,
    /// **只换整个带引号的字符串**：MCP server 的环境变量和请求头。里面也会有
    /// `production` 这种平常的词，写在别处的那些不该跟着被盖住
    quoted: Vec<String>,
}

impl Hide {
    pub(crate) fn new(
        gateway: impl IntoIterator<Item = String>,
        fields: impl IntoIterator<Item = String>,
        quoted: impl IntoIterator<Item = String>,
    ) -> Hide {
        // 长的先换：一个值是另一个的一段时，先换短的会把长的拆成两截，剩下那截就漏了
        fn tidy(v: impl IntoIterator<Item = String>, shortest: usize) -> Vec<String> {
            let mut v: Vec<String> = v
                .into_iter()
                .filter(|s| s.chars().count() >= shortest)
                .collect();
            v.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
            v.dedup();
            v
        }
        Hide {
            // 空的会在每个字符之间插一遍，那不是脱敏是毁掉整份 diff
            gateway: tidy(gateway, 1),
            fields: tidy(fields, 1),
            quoted: tidy(quoted, SHORTEST_SECRET),
        }
    }

    /// 这份改动（连同另外那几份文件）要盖住的：网关的那几把、`secrets` 这几条路径上
    /// 的值、MCP server 的环境变量和请求头、Claude Code `env` 里装着凭据的变量
    fn of(p: &plan::Plan, secrets: &[Vec<String>], gateway: &[&str]) -> Hide {
        let texts = || {
            std::iter::once(p)
                .chain(&p.also)
                .flat_map(|x| x.before.iter().chain([&x.after]).map(move |t| (x, t)))
        };
        let quoted: Vec<String> = texts()
            .flat_map(|(x, t)| tw_adopt::mcp::server_secrets(x.format, t))
            .collect();
        // 用户自己的凭据：Claude Code `env` 里 `/setup-bedrock` 写下的、Grok Build 别的模型表
        // 里的 `api_key`、Qwen Code `/auth` 写在 `env` 里的…（`clients::credential_values`）。
        // 和密钥字段上的值一样，带引号的、不带引号的都换 —— YAML 里它们常常不带引号。太短的
        // 不算：盖一个 `none` 会把整份 diff 里的每一个 `"none"` 都换掉
        let creds = texts()
            .flat_map(|(x, t)| clients::credential_values(&x.client, t))
            .filter(|v| v.chars().count() >= SHORTEST_SECRET);
        Hide::new(
            gateway.iter().map(|k| k.to_string()),
            p.values_at(secrets).into_iter().chain(creds),
            quoted,
        )
    }

    pub(crate) fn apply(&self, text: &str) -> String {
        let mut out = text.to_string();
        for k in &self.gateway {
            out = out.replace(k.as_str(), MASK);
        }
        for v in &self.fields {
            out = hide_quoted(&out, v);
            if v.chars().count() >= SHORTEST_SECRET {
                out = out.replace(v.as_str(), HIDDEN);
            }
        }
        for v in &self.quoted {
            out = hide_quoted(&out, v);
        }
        out
    }
}

/// 把 `v` 作为一整个带引号的字符串出现的地方换成 [`HIDDEN`]：JSON、TOML、YAML 的双引号
/// 字符串（引号、反斜杠的转义几家一样），和单引号的那种
fn hide_quoted(text: &str, v: &str) -> String {
    let mut out = text.to_string();
    if let Ok(q) = serde_json::to_string(v) {
        out = out.replace(&q, &format!("\"{HIDDEN}\""));
    }
    out.replace(&format!("'{v}'"), &format!("'{HIDDEN}'"))
}

/// 改之前那几份原文的指纹：确认框里给人看的改动是按它们算的。
///
/// **落盘时按那一刻的文件重算一遍计划**（密钥这一刻才发、模型清单这一刻才问），所以
/// 文件要是在人看改动的这段时间里被改过 —— 客户端自己改了一项设置、用户手改了一行 ——
/// 写下去的就不是确认过的那一份，而写入那一步自己的核对（`adopt.file.changed`）只管
/// 重算和写入之间，管不到这一段。确认时界面把它原样带回来，重算出来的对不上就什么都
/// 不写（[`still_as_reviewed`]）。
///
/// 种子是**这个进程里随机的**：交给界面的是一个只在本进程里有意义的数。原文里有密钥，
/// 指纹不该能拿去和猜测的内容对照。
pub fn fingerprint<'a>(files: impl IntoIterator<Item = (&'a Path, Option<&'a [u8]>)>) -> String {
    fingerprint_with(files, std::iter::empty())
}

/// [`fingerprint`]，再加上几个字段名
fn fingerprint_with<'a>(
    files: impl IntoIterator<Item = (&'a Path, Option<&'a [u8]>)>,
    fields: impl IntoIterator<Item = &'a [String]>,
) -> String {
    use std::hash::{BuildHasher, Hash, Hasher};
    static SEED: std::sync::OnceLock<std::hash::RandomState> = std::sync::OnceLock::new();
    let mut h = SEED.get_or_init(std::hash::RandomState::new).build_hasher();
    for (path, before) in files {
        path.hash(&mut h);
        before.hash(&mut h);
    }
    for f in fields {
        f.hash(&mut h);
    }
    format!("{:016x}", h.finish())
}

/// 一份接管、还原计划读到的那几份原文：它自己的文件，加上同一次改动里的另外几份。
///
/// **再加上关掉的云服务商开关**（`tw_adopt::cloud`）：关哪几个除了看这几份文件，还看
/// shell 配置和用户环境。两次之间那边变了，写下去的就会多一项或少一项确认框里没有的
/// 改动 —— 这样的也当「改过了」，重新给人看
pub fn plan_fingerprint(p: &plan::Plan) -> String {
    let switches = p.targets.iter().filter_map(|t| match t {
        plan::Target::Set(path, _)
            if path.len() == 2
                && path[0] == "env"
                && tw_adopt::cloud::SWITCHES.iter().any(|(n, _)| path[1] == *n) =>
        {
            Some(path.as_slice())
        }
        _ => None,
    });
    fingerprint_with(
        std::iter::once(p)
            .chain(&p.also)
            .map(|x| (x.path.as_path(), x.before.as_deref().map(str::as_bytes))),
        switches,
    )
}

/// 落盘之前核对：重算出来的计划读到的原文，还是确认框里那一份（[`fingerprint`]）。
///
/// 界面没带（`None`）就不核对 —— 全部还原、卸载时的还原走的是没有差异可看的那条路。
pub fn still_as_reviewed(expect: Option<&str>, now: &str, client: &str) -> Result<(), Msg> {
    match expect {
        Some(e) if e != now => Err(msg!(
            "adopt.plan.stale", client = client =>
            "{client}'s configuration changed while the change was being reviewed, so \
             nothing was written. Look at the change again"
        )),
        _ => Ok(()),
    }
}

fn view(
    p: &plan::Plan,
    secrets: &[Vec<String>],
    roots: &[&str],
    gateway: &[&str],
) -> wire::PlanView {
    let hide = Hide::of(p, secrets, gateway);
    // 另一份文件里整段是密钥的那几节（dsh 凭据文件的 `refs`、`records`）整段打码
    let file = |t: &str| hide.apply(&tw_adopt::yaml::mask_under(t, roots, MASK));
    wire::PlanView {
        client: p.client.clone(),
        path: p.path.display().to_string(),
        before: p.before.as_deref().map(|t| hide.apply(t)),
        after: hide.apply(&p.after),
        notes: p.notes.clone(),
        shadows: p.shadows.iter().map(|x| x.display().to_string()).collect(),
        noop: p.is_noop(),
        carries_secret: p.carries_secret || p.also.iter().any(|a| a.carries_secret),
        fields: fields_of(p, secrets),
        key: None,
        key_created: false,
        digest: plan_fingerprint(p),
        also: p
            .also
            .iter()
            .map(|a| wire::FilePlanView {
                path: a.path.display().to_string(),
                before: a.before.as_deref().map(file),
                after: file(&a.after),
                fields: fields_of(a, secrets),
                noop: a.is_noop(),
                deletes: a.delete_file,
            })
            .collect(),
        bedrock: p.bedrock.clone().map(Into::into),
        desktop_rule: None,
    }
}

/// 没被占用的密钥名。客户端 id 本身被占了就往后编号 —— 和 core 发密钥时
/// 起的名字是同一个规则，接管确认框里说的名字才对得上落盘时建的那把
fn free_name(keys: &[ClientView], id: &str) -> String {
    let taken = |n: &str| keys.iter().any(|k| k.name == n);
    if !taken(id) {
        return id.to_string();
    }
    (2..)
        .map(|n| format!("{id}-{n}"))
        .find(|n| !taken(n))
        .unwrap_or_else(|| id.to_string())
}

/// 算一份接管改动。**不写任何东西。**
///
/// **算一份改动不该写任何东西**，所以这里不建密钥：没有为它留着的，就按默认那把
/// 算 —— diff 里的密钥本来就是打码的。落盘时写进去的是哪一把要**在确认之前说**：
/// 新建一把和沿用一把，对用户是两件事。
///
/// `models` 是这把密钥在网关上能用的模型（只有要把模型写进配置的客户端用得上，
/// 见 [`Client::writes_models`]）。
pub fn plan_adopt(
    home: &Path,
    id: &str,
    gw: &Gateway,
    models: Vec<ModelCard>,
    around: &Around,
) -> Result<wire::PlanView, Msg> {
    plan_adopt_as(home, id, id, gw, models, around)
}

/// [`plan_adopt`]，密钥归在 `owner` 名下。WSL 里的那一份用它自己的一把
/// （`tw_adopt::wsl::key_id`），不和这台电脑上的同一个客户端共用
pub fn plan_adopt_as(
    home: &Path,
    id: &str,
    owner: &str,
    gw: &Gateway,
    models: Vec<ModelCard>,
    around: &Around,
) -> Result<wire::PlanView, Msg> {
    plan_adopt_picking(home, id, owner, gw, models, around).map(|(v, _)| v)
}

/// [`plan_adopt_as`]，连同「要不要给 Claude Desktop 选模型」
/// （`tw_adopt::desktop::model_pick`）：要选的话，网关上那条规则由调用方去问 core 再算
/// （[`super::desktop_rule`]）
pub fn plan_adopt_picking(
    home: &Path,
    id: &str,
    owner: &str,
    gw: &Gateway,
    models: Vec<ModelCard>,
    around: &Around,
) -> Result<(wire::PlanView, Option<tw_adopt::desktop::ModelPick>), Msg> {
    let c = find(id, home)?;
    let (name, value, created) = key_for(gw, owner)?;
    let target = clients::Gateway {
        base: gw.base.clone(),
        key: Some(value),
        models,
    };
    let p = plan_for(&c, home, &target, around).map_err(|e| e.msg())?;
    let mut v = view(
        &p,
        &secret_paths(&c, &target.models),
        secret_roots(&c),
        target.key.as_deref().as_slice(),
    );
    v.key = Some(name);
    v.key_created = created;
    Ok((v, p.pick_model))
}

/// 接管时写进去的是哪一把：`owner` 名下留着的，没有就按默认那把算（落盘时才
/// 新建）。给出名字、值、是不是要新建
pub fn key_for(gw: &Gateway, owner: &str) -> Result<(String, String, bool), Msg> {
    Ok(match gw.key_of(owner) {
        Some(k) => (k.name.clone(), k.key.clone(), false),
        None => {
            let default = gw.keys.iter().find(|k| k.default).ok_or_else(no_keys)?;
            (free_name(&gw.keys, owner), default.key.clone(), true)
        }
    })
}

/// Claude Desktop 一次改四个文件，交给 `tw_adopt::desktop`；模型清单从 `gw.models`
/// 里挑它认的那些
fn plan_for(
    c: &Client,
    home: &Path,
    gw: &clients::Gateway,
    around: &Around,
) -> Result<plan::Plan, plan::PlanError> {
    if c.id == tw_adopt::desktop::ID {
        let ids: Vec<String> = gw.models.iter().map(|m| m.id.clone()).collect();
        tw_adopt::desktop::plan_adopt(c, home, gw, Some(&ids), around)
    } else {
        plan::plan_adopt(c, home, gw, around)
    }
}

/// 一把网关密钥都还没有：先建一把，才谈得上把客户端指向网关。和 core 发密钥时
/// 说的是同一句
fn no_keys() -> Msg {
    msg!(
        "control.no_keys" =>
        "config.yaml has no gateway key yet. Create one before pointing a client at the \
         gateway."
    )
}

/// 落盘。**用户在 diff 上点过确认之后才该到这里。**
///
/// `target` 里的密钥是 core 此刻为它发的那把（为它留着的，或者这一刻新建的）：**先有
/// 钥匙再写对方的配置** —— 反过来的话，中间那一刻对方配置里写着一把网关不认识的钥匙。
///
/// `expect` 是确认框里那份改动的 [`fingerprint`]：这中间文件被改过就什么都不写。
pub fn adopt(
    home: &Path,
    backups: &Path,
    id: &str,
    target: &clients::Gateway,
    expect: Option<&str>,
    around: &Around,
) -> Result<wire::AdoptResponse, Msg> {
    prepare_adopt(home, backups, id, target, expect, around)?.write(backups)
}

/// 核对过、还没落盘的一份接管改动（[`prepare_adopt`]）。
///
/// 接管 Claude Desktop 时，网关上那条规则要**夹在核对和落盘之间**写：先有规则再写它的
/// 配置（和「先有钥匙」同一个道理），而核对没过时一条规则都不该留下
pub struct Prepared {
    c: Client,
    plan: plan::Plan,
}

impl Prepared {
    /// 要给 Claude Desktop 选模型时，写进它配置的名称和网关列出的候选
    pub fn pick_model(&self) -> Option<&tw_adopt::desktop::ModelPick> {
        self.plan.pick_model.as_ref()
    }

    /// 落盘
    pub fn write(self, backups: &Path) -> Result<wire::AdoptResponse, Msg> {
        let a = plan::apply(&self.c, &self.plan, backups).map_err(|e| e.msg())?;
        Ok(wire::AdoptResponse {
            real: a.real.display().to_string(),
            backup: a.backup.display().to_string(),
            created: a.created,
            warnings: a.warnings,
            // **在接管完成那一屏说，不是等五分钟后再说**
            takes_effect: self.c.takes_effect.into(),
        })
    }
}

/// [`adopt`] 的前一半：按此刻的文件重算、和确认框里那一份核对。**不写任何东西**
pub fn prepare_adopt(
    home: &Path,
    backups: &Path,
    id: &str,
    target: &clients::Gateway,
    expect: Option<&str>,
    around: &Around,
) -> Result<Prepared, Msg> {
    // 什么时候生效按装着的版本说（opencode v2 不用重启）
    let c = find(id, home)?.here(home);
    not_theirs(&c, home, backups)?;
    let plan = plan_for(&c, home, target, around).map_err(|e| e.msg())?;
    still_as_reviewed(expect, &plan_fingerprint(&plan), c.name)?;
    Ok(Prepared { c, plan })
}

/// 算一份还原改动。**不写任何东西。**
pub fn plan_restore(home: &Path, id: &str, keys: &[ClientView]) -> Result<wire::PlanView, Msg> {
    plan_restore_as(home, id, id, keys)
}

/// [`plan_restore`]，留下的那把密钥归在 `owner` 名下
pub fn plan_restore_as(
    home: &Path,
    id: &str,
    owner: &str,
    keys: &[ClientView],
) -> Result<wire::PlanView, Msg> {
    let c = find(id, home)?;
    let p = plan::plan_restore(&c, home).map_err(|e| e.msg())?;
    // 还原的 diff 里，**要打码的还有用户自己的原始密钥** —— 它正要被写
    // 回去，而它比我们那把更不该出现在截图里。`view` 按密钥字段上的值盖住它；
    // 网关那几把也是按字段盖的，core 不在、连着远程（这里拿到的密钥清单是空的、
    // 或者是别的机器上的）时照样盖得住
    let gateway: Vec<&str> = keys.iter().map(|k| k.key.as_str()).collect();
    let mut v = view(&p, &secret_paths(&c, &[]), secret_roots(&c), &gateway);
    // 还原不删密钥：说清留下的是哪一把，下次接管直接用它
    v.key = keys
        .iter()
        .find(|k| k.client.as_deref() == Some(owner))
        .map(|k| k.name.clone());
    Ok(v)
}

/// 还原。
///
/// **走的是「把我们写的那几个字段改回去」，不是「拿全文备份覆盖」**
/// —— 后者会把用户这三个月里加的 MCP server、调的权限、写的 hook 全部
/// 抹掉。不问 core：还原用不着密钥，core 不在的时候也要能退回去。
///
/// `expect` 和 [`adopt`] 的一样：确认框里那份改动的指纹，不带就不核对。
pub fn restore(
    home: &Path,
    backups: &Path,
    id: &str,
    expect: Option<&str>,
) -> Result<wire::AdoptResponse, Msg> {
    let c = find(id, home)?.here(home);
    not_theirs(&c, home, backups)?;
    let p = plan::plan_restore(&c, home).map_err(|e| e.msg())?;
    still_as_reviewed(expect, &plan_fingerprint(&p), c.name)?;
    let a = plan::apply_restore(&c, &p, backups).map_err(|e| e.msg())?;
    Ok(wire::AdoptResponse {
        real: a.real.display().to_string(),
        backup: a.backup.display().to_string(),
        created: false,
        warnings: p.notes,
        takes_effect: c.takes_effect.into(),
    })
}

/// 「我明明配了，为什么没生效」—— 走一遍优先级链。
pub fn diagnose(home: &Path, id: &str, around: &Around) -> Result<Vec<wire::FindingView>, Msg> {
    let c = find(id, home)?;
    Ok(findings(detect::diagnose(&c, home, None, around)))
}

/// WSL 里的那一份走一遍同样的链
pub fn diagnose_wsl(w: &tw_adopt::wsl::WslHome, id: &str) -> Result<Vec<wire::FindingView>, Msg> {
    let c = find(id, &w.home)?;
    Ok(findings(detect::diagnose_wsl(&c, w)))
}

fn findings(f: Vec<detect::Finding>) -> Vec<wire::FindingView> {
    f.into_iter()
        .map(|f| wire::FindingView {
            level: match f.level {
                detect::Level::Blocking => wire::FindingLevel::Blocking,
                detect::Level::Suspect => wire::FindingLevel::Suspect,
                detect::Level::Clear => wire::FindingLevel::Clear,
            },
            title: f.title,
            detail: f.detail,
            fix: f.fix,
        })
        .collect()
}

/// 这一份接管着它：接管着，而且接管时那份全文备份在这一份的备份目录 `backups` 里
/// （[`tw_adopt::foreign::is_ours`]）。
pub fn ours(d: &detect::Detected, backups: &Path) -> bool {
    d.adopted_at_ms.is_some()
        && d.backup
            .as_deref()
            .is_none_or(|b| tw_adopt::foreign::is_ours(backups, b))
}

/// 接管着它的是另一个 ThinkWatch Lite（安装版和绿色版各有一份数据目录）。**这一份
/// 不还原它、也不改它**：备份在那一份那里，接管记录也归那一份管
pub fn theirs(d: &detect::Detected, backups: &Path) -> bool {
    d.adopted_at_ms.is_some() && !ours(d, backups)
}

/// 另一个 ThinkWatch Lite 接管着它时，动它之前说的那一句
pub fn other_instance(client: &str) -> Msg {
    msg!(
        "adopt.other_instance", client = client =>
        "{client} is connected by another ThinkWatch Lite. Restore it from the ThinkWatch Lite \
         that connected it."
    )
}

/// 动之前先看一眼：另一个 ThinkWatch Lite 接管着的不动
fn not_theirs(c: &Client, home: &Path, backups: &Path) -> Result<(), Msg> {
    if theirs(&detect::detect_one(c, home), backups) {
        return Err(other_instance(c.name));
    }
    Ok(())
}

/// 此刻**这一份**接管着的客户端。
pub fn adopted(home: &Path, backups: &Path) -> Vec<Client> {
    all(home)
        .into_iter()
        .filter(|c| ours(&detect::detect_one(c, home), backups))
        .collect()
}

/// 此刻由另一个 ThinkWatch Lite 接管着的客户端（[`theirs`]）。「全部还原」跳过它们，
/// 结果里列出来
pub fn adopted_elsewhere(home: &Path, backups: &Path) -> Vec<Client> {
    all(home)
        .into_iter()
        .filter(|c| theirs(&detect::detect_one(c, home), backups))
        .collect()
}

/// 此刻接管着、**配置里指着这台机器上的网关**的客户端，连同它此刻的端点。
///
/// 连着远程 core 时，它们的请求落到一个已经停了的网关上：客户端页把它们单独标出来，
/// 切换确认里说有几个，「改为指向服务器」改的也正是这几个。指着别处的（已经改过去
/// 了、或者用户自己指到了别的机器）不在里面。
pub fn adopted_on_this_machine(home: &Path, backups: &Path) -> Vec<(Client, String)> {
    pointing_here(home, backups, all(home))
}

/// [`adopted_on_this_machine`]，WSL 里的那一份：只看第一批的那几个
/// （`tw_adopt::wsl::CLIENTS`）。本机时 WSL 里的客户端写的也是 `127.0.0.1`，
/// 指的是 Windows 上的网关
pub fn adopted_on_this_machine_wsl(
    w: &tw_adopt::wsl::WslHome,
    backups: &Path,
) -> Vec<(Client, String)> {
    pointing_here(
        &w.home,
        backups,
        all(&w.home)
            .into_iter()
            .filter(|c| tw_adopt::wsl::CLIENTS.contains(&c.id)),
    )
}

/// 另一个 ThinkWatch Lite 接管的不算：改为指向服务器也不该改它们
fn pointing_here(
    home: &Path,
    backups: &Path,
    cs: impl IntoIterator<Item = Client>,
) -> Vec<(Client, String)> {
    cs.into_iter()
        .filter_map(|c| {
            let d = detect::detect_one(&c, home);
            if !ours(&d, backups) {
                return None;
            }
            let endpoint = d.endpoint?;
            is_loopback(&endpoint).then_some((c, endpoint))
        })
        .collect()
}

/// 一个端点指的是不是这台机器：`127.0.0.1`、`localhost`、`[::1]`
pub fn is_loopback(endpoint: &str) -> bool {
    host_port(endpoint).is_some_and(|hp| {
        let host = match hp.rsplit_once(':') {
            // `[::1]:8788` 这种，方括号里才是主机
            Some((h, p)) if p.chars().all(|c| c.is_ascii_digit()) => h,
            _ => hp,
        };
        let host = host.trim_start_matches('[').trim_end_matches(']');
        host == "localhost"
            || host == "::1"
            || host
                .parse::<std::net::Ipv4Addr>()
                .is_ok_and(|a| a.is_loopback())
    })
}

/// `http://127.0.0.1:8788/v1` → `127.0.0.1:8788`
pub fn host_port(endpoint: &str) -> Option<&str> {
    let rest = endpoint.split_once("://").map_or(endpoint, |(_, r)| r);
    let hp = rest.split(['/', '?', '#']).next()?;
    (!hp.is_empty()).then_some(hp)
}

/// 这把密钥是为某个客户端生成的，而那个客户端此刻正被接管着吗。返回那个客户端。
///
/// 接管状态在对方配置旁边的记录里，读它要走文件系统 —— 所以这件事只有这台机器
/// 答得上来，core 答不上。
///
/// 只算**这一份**接管着的：另一个 ThinkWatch Lite 接管的，配置里写的是那一份的密钥，
/// 删、换这一份的密钥都碍不着它
pub fn adopted_owner(
    home: &Path,
    backups: &Path,
    keys: &[ClientView],
    key: &str,
) -> Option<Client> {
    let id = keys.iter().find(|k| k.name == key)?.client.as_deref()?;
    let c = find(id, home).ok()?;
    ours(&detect::detect_one(&c, home), backups).then_some(c)
}

/// 接管着的这个客户端里还写着这把密钥：先还原它，才能删这把密钥。和 core 以前
/// 说的是同一句
pub fn key_used_by(client: &str) -> Msg {
    msg!(
        "control.key_used_by_client", client = client =>
        "{client} is pointed at the gateway and has this key in its configuration. \
         Restore it before deleting the key."
    )
}

/// 把一个接管着的客户端重新指一次：换一个网关地址、或者换一把密钥。
///
/// 更换密钥之后的同步走这里；从本机切到远程 core 时「把已接管的客户端一起改为指向
/// 服务器」也是这一步，只是地址和密钥换成了那边的。走的是接管那一套：算出改动、写之前
/// 全文备份，接管记录里的原值不变，还原照样回到接管之前。
pub fn repoint(
    home: &Path,
    backups: &Path,
    c: &Client,
    base: &str,
    key: &str,
    models: Vec<ModelCard>,
    around: &Around,
) -> Result<wire::KeySynced, wire::KeySyncFailed> {
    let c = &c.clone().here(home);
    if let Err(error) = not_theirs(c, home, backups) {
        return Err(wire::KeySyncFailed {
            client: c.id.to_string(),
            name: c.name.to_string(),
            error,
        });
    }
    let target = clients::Gateway {
        base: base.to_string(),
        key: Some(key.to_string()),
        models,
    };
    // **和接管走同一个入口**（[`plan_for`]）：Claude Desktop 一次改四个文件、模型清单
    // 从 `models` 里挑，按单个文件的通用那一套算的话，它的模型列表和另外几份都不跟着换
    plan_for(c, home, &target, around)
        .and_then(|p| plan::apply(c, &p, backups))
        .map(|a| wire::KeySynced {
            client: c.id.to_string(),
            name: c.name.to_string(),
            takes_effect: c.takes_effect.into(),
            backup: a.backup.display().to_string(),
        })
        .map_err(|e| wire::KeySyncFailed {
            client: c.id.to_string(),
            name: c.name.to_string(),
            error: e.msg(),
        })
}

/// 测试用的假机器，`super::tests`（改为指向服务器那几条）也用
#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn key(name: &str, value: &str, client: Option<&str>, default: bool) -> ClientView {
        ClientView {
            name: name.into(),
            key: value.into(),
            max_concurrent: None,
            route: None,
            allow: None,
            client: client.map(str::to_string),
            disabled: false,
            default,
            last_seen_ms: None,
            limits: vec![],
            unpriced_models: vec![],
        }
    }

    fn gw(keys: Vec<ClientView>) -> Gateway {
        Gateway {
            base: "http://127.0.0.1:8788".into(),
            keys,
        }
    }

    /// 备份放在这台假机器里，**不碰开发者自己的数据目录**
    fn backups(home: &tempfile::TempDir) -> std::path::PathBuf {
        home.path().join("backups")
    }

    /// 一台装了 Claude Code 的机器：`~/.claude/` 在，配置文件还没有
    fn home_with_claude() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join(".claude")).unwrap();
        d
    }

    #[test]
    fn listing_says_which_clients_are_here_and_which_are_only_advice() {
        let home = home_with_claude();
        let r = list(
            home.path(),
            &backups(&home),
            &gw(vec![key("default", "tw-d", None, true)]),
            &BTreeMap::new(),
        );
        let cc = r.clients.iter().find(|c| c.id == "claude-code").unwrap();
        assert!(cc.installed);
        assert_eq!(cc.adopted_at_ms, None);
        assert!(r.manual.iter().any(|m| m.id == "cursor"));
        assert_eq!(r.gateway_base, "http://127.0.0.1:8788");
        assert_eq!(r.keys, vec!["default"]);
    }

    /// 「使用中」按那把密钥算：为它生成的密钥被用过，就是它被用过
    #[test]
    fn in_use_is_read_off_the_clients_own_key() {
        let home = home_with_claude();
        let mut mine = key("claude-code", "tw-c", Some("claude-code"), false);
        mine.last_seen_ms = Some(42);
        let r = list(
            home.path(),
            &backups(&home),
            &gw(vec![key("default", "tw-d", None, true), mine]),
            &BTreeMap::new(),
        );
        let cc = r.clients.iter().find(|c| c.id == "claude-code").unwrap();
        assert_eq!(cc.key.as_deref(), Some("claude-code"));
        assert_eq!(cc.last_seen_ms, Some(42));
        let cursor = r.manual.iter().find(|m| m.id == "cursor").unwrap();
        assert_eq!(cursor.key, None);
        assert_eq!(cursor.last_seen_ms, None);
    }

    /// 手动配置给出的字段就是接管时写的那几项，密钥那一项不给值
    #[test]
    fn every_client_says_how_to_connect_it_by_hand_without_the_key() {
        let home = tempfile::tempdir().unwrap();
        let r = list(
            home.path(),
            &backups(&home),
            &gw(vec![key("default", "tw-d", None, true)]),
            &BTreeMap::new(),
        );
        let cc = r.clients.iter().find(|c| c.id == "claude-code").unwrap();
        assert!(!cc.manual.fields.is_empty());
        assert!(
            cc.manual
                .fields
                .iter()
                .any(|f| f.secret && f.value.is_none())
        );
        let json = serde_json::to_string(&r).unwrap();
        assert!(!json.contains("tw-d"), "{json}");
    }

    #[test]
    fn planning_writes_nothing_and_never_echoes_the_key() {
        let home = home_with_claude();
        let p = plan_adopt(
            home.path(),
            "claude-code",
            &gw(vec![key("default", "tw-secret-value", None, true)]),
            Vec::new(),
            &Around::default(),
        )
        .unwrap();
        assert!(!home.path().join(".claude/settings.json").exists());
        assert!(!p.after.contains("tw-secret-value"), "{}", p.after);
        assert!(p.after.contains(MASK));
        // 还没有为它留着的：确认之前就说要新建一把，叫什么
        assert_eq!(p.key.as_deref(), Some("claude-code"));
        assert!(p.key_created);
    }

    /// 为它留着一把的，接着用那一把；名字被别的占了就往后编号
    #[test]
    fn the_plan_says_which_key_goes_in_and_whether_it_is_made_now() {
        let home = home_with_claude();
        let kept = plan_adopt(
            home.path(),
            "claude-code",
            &gw(vec![
                key("default", "tw-d", None, true),
                key("mine", "tw-m", Some("claude-code"), false),
            ]),
            Vec::new(),
            &Around::default(),
        )
        .unwrap();
        assert_eq!(kept.key.as_deref(), Some("mine"));
        assert!(!kept.key_created);

        let taken = plan_adopt(
            home.path(),
            "claude-code",
            &gw(vec![
                key("default", "tw-d", None, true),
                key("claude-code", "tw-x", None, false),
            ]),
            Vec::new(),
            &Around::default(),
        )
        .unwrap();
        assert_eq!(taken.key.as_deref(), Some("claude-code-2"));
        assert!(taken.key_created);
    }

    #[test]
    fn without_any_key_there_is_nothing_to_point_a_client_with() {
        let home = home_with_claude();
        let e = plan_adopt(
            home.path(),
            "claude-code",
            &gw(Vec::new()),
            Vec::new(),
            &Around::default(),
        )
        .unwrap_err();
        assert_eq!(e.code, "control.no_keys");
    }

    #[test]
    fn a_client_we_do_not_know_is_refused_by_name() {
        let home = tempfile::tempdir().unwrap();
        let e = plan_adopt(
            home.path(),
            "../etc",
            &gw(Vec::new()),
            Vec::new(),
            &Around::default(),
        )
        .unwrap_err();
        assert_eq!(e.code, "control.client_unknown");
        assert!(!known("../etc"));
        assert!(known("claude-code") && known("cursor"));
    }

    /// `/setup-bedrock` 把 Bedrock 的 API key、访问密钥写在 settings.json 的 `env` 里：
    /// diff 画的是整份文件，它们一律打码；区域、开关这些照常显示
    #[test]
    fn aws_credentials_in_claude_codes_env_never_show_in_the_diff() {
        let home = home_with_claude();
        let settings = home.path().join(".claude/settings.json");
        std::fs::write(
            &settings,
            r#"{ "env": {
  "CLAUDE_CODE_USE_BEDROCK": "1",
  "AWS_REGION": "us-west-2",
  "AWS_BEARER_TOKEN_BEDROCK": "ABSKQmVkcm9ja0FQSUtleS1leGFtcGxl",
  "AWS_ACCESS_KEY_ID": "AKIAIOSFODNN7EXAMPLE",
  "AWS_SECRET_ACCESS_KEY": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
} }"#,
        )
        .unwrap();
        let secrets = [
            "ABSKQmVkcm9ja0FQSUtleS1leGFtcGxl",
            "AKIAIOSFODNN7EXAMPLE",
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        ];
        let p = plan_adopt(
            home.path(),
            "claude-code",
            &gw(vec![key("default", "tw-new", None, true)]),
            Vec::new(),
            &Around::default(),
        )
        .unwrap();
        for text in [p.before.as_deref().unwrap(), p.after.as_str()] {
            for s in secrets {
                assert!(!text.contains(s), "{s} shows in:\n{text}");
            }
            assert!(text.contains("us-west-2"), "{text}");
        }
        assert!(
            p.after.contains("\"CLAUDE_CODE_USE_BEDROCK\": \"\""),
            "{}",
            p.after
        );
        assert!(
            p.fields
                .iter()
                .any(|f| f.path == "env.CLAUDE_CODE_USE_BEDROCK" && f.value.as_deref() == Some("")),
            "{:?}",
            p.fields
        );
        // 交给界面的整份（说明、新建上游的草稿）里也没有：草稿里只有变量引用
        let sent = serde_json::to_string(&p).unwrap();
        for s in secrets {
            assert!(!sent.contains(s), "{s} goes to the UI:\n{sent}");
        }
        assert!(
            matches!(&p.bedrock, Some(d) if d.region == "us-west-2"
                && matches!(&d.auth, wire::DraftAuth::Key { key } if key == "${AWS_BEARER_TOKEN_BEDROCK}")),
            "{:?}",
            p.bedrock
        );

        adopt(
            home.path(),
            &backups(&home),
            "claude-code",
            &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-new", Vec::new()),
            Some(&p.digest),
            &Around::default(),
        )
        .unwrap();
        let r = plan_restore(home.path(), "claude-code", &[]).unwrap();
        for text in [r.before.as_deref().unwrap(), r.after.as_str()] {
            for s in secrets {
                assert!(!text.contains(s), "{s} shows in:\n{text}");
            }
        }
    }

    /// Grok Build 一个模型一张表，整张表算密钥：字段列表里不给值，diff 里网关那把打码；
    /// 用户自己那张表里发给别家的 `api_key`、Qwen Code `/auth` 写在 `env` 里的密钥，diff 里
    /// 同样看不到
    #[test]
    fn grok_and_qwen_diffs_show_no_key_of_anyone() {
        let home = tempfile::tempdir().unwrap();
        let grok = tw_adopt::paths::GROK_CONFIG.resolve(home.path());
        std::fs::create_dir_all(grok.parent().unwrap()).unwrap();
        std::fs::write(
            &grok,
            "[model.mine]\nmodel = \"x\"\nbase_url = \"https://api.example.com/v1\"\napi_key = \"sk-mine-0123456789\"\n",
        )
        .unwrap();
        let qwen = tw_adopt::paths::QWEN_SETTINGS.resolve(home.path());
        std::fs::create_dir_all(qwen.parent().unwrap()).unwrap();
        std::fs::write(
            &qwen,
            r#"{ "env": { "DASHSCOPE_API_KEY": "sk-dash-0123456789" } }"#,
        )
        .unwrap();
        let g = gw(vec![key("default", "tw-secret-value", None, true)]);
        let models: Vec<ModelCard> = vec!["claude-sonnet-5".into(), "gpt-5.5".into()];
        for (id, theirs) in [
            ("grok-build", "sk-mine-0123456789"),
            ("qwen-code", "sk-dash-0123456789"),
        ] {
            let p = plan_adopt(home.path(), id, &g, models.clone(), &Around::default()).unwrap();
            for text in [p.before.as_deref().unwrap(), p.after.as_str()] {
                assert!(!text.contains(theirs), "{id}: {text}");
                assert!(!text.contains("tw-secret-value"), "{id}: {text}");
            }
            assert!(p.after.contains(MASK), "{id}: {}", p.after);
            let sent = serde_json::to_string(&p).unwrap();
            assert!(!sent.contains("tw-secret-value"), "{id}: {sent}");
        }
        let p = plan_adopt(home.path(), "grok-build", &g, models, &Around::default()).unwrap();
        let table = p
            .fields
            .iter()
            .find(|f| f.path == "model.thinkwatch/gpt-5.5")
            .expect("一个模型一张表");
        assert!(table.secret && table.value.is_none(), "{table:?}");
        assert!(
            p.fields
                .iter()
                .any(|f| f.path == "models.default" && f.value.is_some()),
            "{:?}",
            p.fields
        );
    }

    /// 关哪几个开关还看 shell 配置和用户环境：确认框和落盘之间那边变了，写下去的就会多
    /// 一项确认框里没有的改动 —— 当成「改过了」，什么都不写
    #[test]
    fn a_switch_that_appears_after_the_review_stops_the_write() {
        let home = home_with_claude();
        let settings = home.path().join(".claude/settings.json");
        std::fs::write(&settings, "{}\n").unwrap();
        let g = gw(vec![key("default", "tw-new", None, true)]);
        let reviewed = plan_adopt(
            home.path(),
            "claude-code",
            &g,
            Vec::new(),
            &Around::default(),
        )
        .unwrap();
        let later = Around {
            env: [("CLAUDE_CODE_USE_BEDROCK".to_string(), "1".to_string())].into(),
            ..Default::default()
        };
        let e = adopt(
            home.path(),
            &backups(&home),
            "claude-code",
            &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-new", Vec::new()),
            Some(&reviewed.digest),
            &later,
        )
        .unwrap_err();
        assert_eq!(e.code, "adopt.plan.stale");
        assert_eq!(std::fs::read_to_string(&settings).unwrap(), "{}\n");
    }

    #[test]
    fn adopt_then_restore_puts_the_users_file_back_and_masks_their_key() {
        let home = home_with_claude();
        let settings = home.path().join(".claude/settings.json");
        let original = r#"{ "env": { "ANTHROPIC_BASE_URL": "https://example.com", "ANTHROPIC_AUTH_TOKEN": "users-own" } }"#;
        std::fs::write(&settings, original).unwrap();

        // 接管的 diff：被换下来的是用户自己的那把，改之前那一栏里也不能有它
        let p = plan_adopt(
            home.path(),
            "claude-code",
            &gw(vec![key("default", "tw-new", None, true)]),
            Vec::new(),
            &Around::default(),
        )
        .unwrap();
        let before = p.before.as_deref().unwrap();
        assert!(!before.contains("users-own"), "{before}");
        assert!(before.contains(HIDDEN), "{before}");
        assert!(
            p.after.contains(MASK) && !p.after.contains("tw-new"),
            "{}",
            p.after
        );
        // 不是密钥的照常显示
        assert!(before.contains("https://example.com"), "{before}");

        let a = adopt(
            home.path(),
            &backups(&home),
            "claude-code",
            &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-new", Vec::new()),
            None,
            &Around::default(),
        )
        .unwrap();
        assert_eq!(a.takes_effect, wire::TakesEffect::Immediately);
        let written = std::fs::read_to_string(&settings).unwrap();
        assert!(written.contains("tw-new") && written.contains("127.0.0.1:8788"));
        assert!(
            adopted(home.path(), &backups(&home))
                .iter()
                .any(|c| c.id == "claude-code")
        );

        let keys = vec![key("claude-code", "tw-new", Some("claude-code"), false)];
        let p = plan_restore(home.path(), "claude-code", &keys).unwrap();
        assert!(!p.before.as_deref().unwrap().contains("tw-new"));
        assert_eq!(p.key.as_deref(), Some("claude-code"));
        // 用户自己的那把正要被写回去：它也不出现在 diff 里
        assert!(!p.after.contains("tw-new"));
        assert!(!p.after.contains("users-own"), "{}", p.after);
        // core 不在（拿不到密钥清单）时，网关那把照样盖得住：它在密钥字段上
        let offline = plan_restore(home.path(), "claude-code", &[]).unwrap();
        assert!(!offline.before.as_deref().unwrap().contains("tw-new"));
        assert!(!offline.after.contains("users-own"), "{}", offline.after);

        restore(home.path(), &backups(&home), "claude-code", None).unwrap();
        let back: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        let want: serde_json::Value = serde_json::from_str(original).unwrap();
        assert_eq!(back, want);
        assert!(adopted(home.path(), &backups(&home)).is_empty());
    }

    /// opencode 的模型清单跟网关对不上了才提示更新；顺序不算，没接管的不提示
    #[test]
    fn a_stale_opencode_model_list_is_flagged_on_the_listing() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".config/opencode")).unwrap();
        let keys = vec![key("opencode", "tw-o", Some("opencode"), false)];
        let now = |ms: &[&str]| {
            BTreeMap::from([(
                "opencode".to_string(),
                ms.iter().map(|m| ModelCard::named(*m)).collect::<Vec<_>>(),
            )])
        };
        let stale = |models: &BTreeMap<String, Vec<ModelCard>>| {
            list(home.path(), &backups(&home), &gw(keys.clone()), models)
                .clients
                .into_iter()
                .find(|c| c.id == "opencode")
                .unwrap()
                .models_stale
        };
        assert!(!stale(&now(&["a"])), "没接管的没有清单可比");

        adopt(
            home.path(),
            &backups(&home),
            "opencode",
            &tw_adopt::clients::Gateway::keyed(
                "http://127.0.0.1:8788",
                "tw-o",
                vec!["a".into(), "b".into()],
            ),
            None,
            &Around::default(),
        )
        .unwrap();
        assert!(!stale(&now(&["b", "a"])));
        assert!(stale(&now(&["a", "b", "c"])));
        assert!(!stale(&BTreeMap::new()), "问不到网关就不说");

        // 手动配置那一栏照网关此刻答的写
        let r = list(
            home.path(),
            &backups(&home),
            &gw(keys.clone()),
            &now(&["m1"]),
        );
        let oc = r.clients.iter().find(|c| c.id == "opencode").unwrap();
        assert!(
            oc.manual
                .fields
                .iter()
                .any(|f| f.path == "provider.thinkwatch.models"
                    && f.value.as_deref() == Some("{m1: {name: m1}}")),
            "{:?}",
            oc.manual.fields
        );
    }

    /// Pi 和 oh-my-pi 也把模型写进配置：清单跟网关对不上了一样提示更新；diff 里看不到密钥
    #[test]
    fn a_stale_pi_or_omp_model_list_is_flagged_too() {
        for id in ["pi", "omp"] {
            let home = tempfile::tempdir().unwrap();
            let keys = vec![key(id, "tw-p", Some(id), false)];
            let now = |ms: &[&str]| {
                BTreeMap::from([(
                    id.to_string(),
                    ms.iter().map(|m| ModelCard::named(*m)).collect::<Vec<_>>(),
                )])
            };
            let stale = |models: &BTreeMap<String, Vec<ModelCard>>| {
                list(home.path(), &backups(&home), &gw(keys.clone()), models)
                    .clients
                    .into_iter()
                    .find(|c| c.id == id)
                    .unwrap()
                    .models_stale
            };
            let target = tw_adopt::clients::Gateway::keyed(
                "http://127.0.0.1:8788",
                "tw-p",
                vec!["claude-a".into(), "b".into()],
            );
            let v = plan_adopt(
                home.path(),
                id,
                &gw(keys.clone()),
                target.models.clone(),
                &Around::default(),
            )
            .unwrap();
            assert!(!v.after.contains("tw-p"), "{id}：{}", v.after);
            assert!(
                v.fields.iter().any(|f| f.secret && f.value.is_none()),
                "{id}"
            );
            adopt(
                home.path(),
                &backups(&home),
                id,
                &target,
                None,
                &Around::default(),
            )
            .unwrap();
            assert!(!stale(&now(&["b", "claude-a"])), "{id}");
            assert!(stale(&now(&["claude-a"])), "{id}");
        }
    }

    /// 别处的 home（WSL 里的、测试的临时目录）不带用户指定的配置文件：那份设置只管
    /// 这台电脑上的
    #[test]
    fn a_home_other_than_this_computers_gets_the_default_files() {
        let home = home_with_claude();
        assert!(all(home.path()).iter().all(|c| c.custom_config.is_none()));
    }

    #[test]
    fn restoring_something_we_never_adopted_refuses_instead_of_guessing() {
        let home = home_with_claude();
        assert!(restore(home.path(), &backups(&home), "claude-code", None).is_err());
    }

    /// 接管着的客户端的密钥删不得；它的主人是哪个，只有这台机器答得上来
    #[test]
    fn a_key_in_an_adopted_clients_config_is_found_by_its_owner() {
        let home = home_with_claude();
        let keys = vec![
            key("default", "tw-d", None, true),
            key("claude-code", "tw-c", Some("claude-code"), false),
        ];
        assert!(adopted_owner(home.path(), &backups(&home), &keys, "claude-code").is_none());
        adopt(
            home.path(),
            &backups(&home),
            "claude-code",
            &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-c", Vec::new()),
            None,
            &Around::default(),
        )
        .unwrap();
        let owner = adopted_owner(home.path(), &backups(&home), &keys, "claude-code").unwrap();
        assert_eq!(owner.id, "claude-code");
        assert_eq!(key_used_by(owner.name).code, "control.key_used_by_client");
        assert!(adopted_owner(home.path(), &backups(&home), &keys, "default").is_none());
    }

    #[test]
    fn a_loopback_endpoint_is_this_machine_and_a_server_is_not() {
        for e in [
            "http://127.0.0.1:8788",
            "http://127.0.0.1:8788/v1",
            "http://localhost:8788/v1",
            "http://[::1]:8788",
        ] {
            assert!(is_loopback(e), "{e}");
        }
        for e in [
            "http://192.168.1.20:8788/v1",
            "http://nas.local:8788",
            "",
            "http://",
        ] {
            assert!(!is_loopback(e), "{e}");
        }
        assert_eq!(
            host_port("http://127.0.0.1:8788/v1"),
            Some("127.0.0.1:8788")
        );
    }

    /// 接管着、指着本机网关的才算；指到了服务器上的不算
    #[test]
    fn only_clients_pointing_at_this_machine_count() {
        let home = home_with_claude();
        std::fs::create_dir_all(home.path().join(".codex")).unwrap();
        adopt(
            home.path(),
            &backups(&home),
            "claude-code",
            &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-c", Vec::new()),
            None,
            &Around::default(),
        )
        .unwrap();
        adopt(
            home.path(),
            &backups(&home),
            "codex",
            &tw_adopt::clients::Gateway::keyed("http://192.168.1.20:8788", "tw-x", Vec::new()),
            None,
            &Around::default(),
        )
        .unwrap();
        let here: Vec<_> = adopted_on_this_machine(home.path(), &backups(&home))
            .into_iter()
            .map(|(c, e)| (c.id, e))
            .collect();
        assert_eq!(
            here,
            vec![("claude-code", "http://127.0.0.1:8788".to_string())]
        );
    }

    /// 一个假的 WSL 发行版：`etc/passwd` 和默认用户的 home，Claude Code 和 Codex 都装了
    pub(crate) fn wsl_home() -> (tempfile::TempDir, tw_adopt::wsl::WslHome) {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("Ubuntu");
        std::fs::create_dir_all(root.join("etc")).unwrap();
        std::fs::write(
            root.join("etc/passwd"),
            "u:x:1000:1000::/home/u:/bin/bash\n",
        )
        .unwrap();
        std::fs::create_dir_all(root.join("home/u/.claude")).unwrap();
        std::fs::create_dir_all(root.join("home/u/.codex")).unwrap();
        std::fs::create_dir_all(root.join("home/u/.config/zed")).unwrap();
        let w = tw_adopt::wsl::WslHome::read(
            tw_adopt::wsl::Distro {
                name: "Ubuntu".into(),
                version: 2,
                uid: 1000,
            },
            root,
        )
        .unwrap();
        (d, w)
    }

    /// WSL 里只列第一批的那两个；路径写成 WSL 里的样子；密钥认的是为 WSL 里
    /// 这一份发的那把，不是这台电脑上同一个客户端的那把
    #[test]
    fn a_wsl_distro_lists_its_own_copies_with_their_own_keys() {
        let (d, w) = wsl_home();
        let b = d.path().join("backups");
        let mut mine = key(
            "claude-code-wsl-ubuntu",
            "tw-w",
            Some("claude-code-wsl-ubuntu"),
            false,
        );
        mine.last_seen_ms = Some(7);
        let gw = Gateway {
            base: "http://127.0.0.1:8788".into(),
            keys: vec![
                key("default", "tw-d", None, true),
                key("claude-code", "tw-c", Some("claude-code"), false),
                mine,
            ],
        };
        let r = list_wsl(&w, &b, &gw);
        let ids: Vec<_> = r.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["claude-code", "codex"]);
        let cc = &r[0];
        assert!(cc.installed);
        assert_eq!(cc.path, "~/.claude/settings.json");
        assert_eq!(cc.key.as_deref(), Some("claude-code-wsl-ubuntu"));
        assert_eq!(cc.last_seen_ms, Some(7));
        // 手动配置给的地址和这台电脑上的一样
        assert_eq!(cc.manual.endpoint, "http://127.0.0.1:8788");
        assert_eq!(cc.manual.steps[0].arg("file"), "~/.claude/settings.json");
        assert_eq!(r[1].key, None);
        // 接管的方案：新建的那把叫 WSL 那一份的名字
        let p = plan_adopt_as(
            &w.home,
            "codex",
            "codex-wsl-ubuntu",
            &gw,
            Vec::new(),
            &Around::default(),
        )
        .unwrap();
        assert_eq!(p.key.as_deref(), Some("codex-wsl-ubuntu"));
        assert!(p.key_created);
        assert!(known("codex-wsl-ubuntu"));
    }

    /// WSL 1 和 mirrored 下，WSL 里的客户端写的就是 `127.0.0.1`，和这台电脑上的一样
    /// （地址由 `wsl::target` 给，它交回的就是这台电脑的那一个）；还原回到原样
    #[test]
    fn a_wsl_copy_is_pointed_at_127_0_0_1_and_restored_to_what_it_was() {
        let (d, w) = wsl_home();
        let b = d.path().join("backups");
        let settings = w.home.join(".claude").join("settings.json");
        let original =
            r#"{ "model": "opus", "env": { "ANTHROPIC_BASE_URL": "https://api.anthropic.com" } }"#;
        std::fs::write(&settings, original).unwrap();
        let config = w.home.join(".codex").join("config.toml");
        std::fs::write(&config, "model = \"gpt-5\"\n").unwrap();

        adopt(
            &w.home,
            &b,
            "claude-code",
            &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-c", Vec::new()),
            None,
            &Around::default(),
        )
        .unwrap();
        adopt(
            &w.home,
            &b,
            "codex",
            &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-x", Vec::new()),
            None,
            &Around::default(),
        )
        .unwrap();
        let listed = list_wsl(
            &w,
            &b,
            &Gateway {
                base: "http://127.0.0.1:8788".into(),
                keys: Vec::new(),
            },
        );
        for c in &listed {
            let e = c.endpoint.as_deref().unwrap_or_default();
            assert!(e.starts_with("http://127.0.0.1:8788"), "{}: {e}", c.id);
            assert!(is_loopback(e));
        }

        restore(&w.home, &b, "claude-code", None).unwrap();
        restore(&w.home, &b, "codex", None).unwrap();
        let back: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        let want: serde_json::Value = serde_json::from_str(original).unwrap();
        assert_eq!(back, want);
        assert!(adopted(&w.home, &b).is_empty());
    }

    /// 按 NAT 的做法接管过的（指着 WSL 虚拟网卡的地址）不迁移：列出来的就是它
    /// 此刻指着的地址（界面据此标成未生效），照样能还原
    #[test]
    fn a_copy_adopted_the_old_nat_way_is_listed_as_is_and_can_be_restored() {
        let (d, w) = wsl_home();
        let b = d.path().join("backups");
        adopt(
            &w.home,
            &b,
            "claude-code",
            &tw_adopt::clients::Gateway::keyed("http://172.27.96.1:8788", "tw-c", Vec::new()),
            None,
            &Around::default(),
        )
        .unwrap();
        let gw = Gateway {
            base: "http://127.0.0.1:8788".into(),
            keys: Vec::new(),
        };
        let cc = list_wsl(&w, &b, &gw)
            .into_iter()
            .find(|c| c.id == "claude-code")
            .unwrap();
        assert!(cc.adopted_at_ms.is_some());
        assert_eq!(cc.endpoint.as_deref(), Some("http://172.27.96.1:8788"));
        restore(&w.home, &b, "claude-code", None).unwrap();
        assert!(adopted(&w.home, &b).is_empty());
    }

    /// 换了密钥之后重新指一次：新值写进它的配置
    #[test]
    fn repointing_writes_the_new_key_into_the_clients_config() {
        let home = home_with_claude();
        adopt(
            home.path(),
            &backups(&home),
            "claude-code",
            &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-old", Vec::new()),
            None,
            &Around::default(),
        )
        .unwrap();
        let c = find("claude-code", home.path()).unwrap();
        let s = repoint(
            home.path(),
            &backups(&home),
            &c,
            "http://127.0.0.1:8788",
            "tw-fresh",
            Vec::new(),
            &Around::default(),
        )
        .unwrap();
        assert_eq!(s.client, "claude-code");
        let text = std::fs::read_to_string(home.path().join(".claude/settings.json")).unwrap();
        assert!(
            text.contains("tw-fresh") && !text.contains("tw-old"),
            "{text}"
        );
    }

    /// 重新指向 Claude Desktop：**模型列表按新网关此刻答的换**，和接管同一个入口。
    /// 按单个文件的通用那一套算的话，列表还是旧网关那一份
    #[test]
    fn repointing_claude_desktop_rewrites_its_model_list_too() {
        let home = tempfile::tempdir().unwrap();
        if tw_adopt::desktop::managed(home.path()).is_some() {
            // 这台跑测试的机器上的 Claude Desktop 由组织托管：接管本来就会被拒
            return;
        }
        let first = tw_adopt::desktop::first_party_config(home.path());
        std::fs::create_dir_all(first.parent().unwrap()).unwrap();
        std::fs::write(&first, "{\n  \"globalShortcut\": \"Alt+Space\"\n}\n").unwrap();
        let base = "http://127.0.0.1:8788";
        let id = tw_adopt::desktop::ID;
        adopt(
            home.path(),
            &backups(&home),
            id,
            &tw_adopt::clients::Gateway::keyed(base, "tw-old", vec!["claude-sonnet-5".into()]),
            None,
            &Around::default(),
        )
        .unwrap();
        let c = find(id, home.path()).unwrap();
        repoint(
            home.path(),
            &backups(&home),
            &c,
            "http://10.0.0.2:8788",
            "tw-fresh",
            vec!["claude-opus-5".into(), "gpt-5".into()],
            &Around::default(),
        )
        .unwrap();
        let profile: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(tw_adopt::desktop::profile_path(home.path())).unwrap(),
        )
        .unwrap();
        assert_eq!(profile["inferenceGatewayApiKey"], "tw-fresh");
        assert_eq!(
            profile["inferenceModels"],
            serde_json::json!(["claude-opus-5"])
        );
    }

    /// 同一份原文同一个指纹；原文、路径、有没有这个文件，任何一样不同都不同
    #[test]
    fn the_fingerprint_follows_every_file_the_plan_read() {
        let a = Path::new("/h/a.json");
        let b = Path::new("/h/b.json");
        let f = |xs: &[(&Path, Option<&[u8]>)]| fingerprint(xs.iter().copied());
        assert_eq!(f(&[(a, Some(b"x"))]), f(&[(a, Some(b"x"))]));
        assert_ne!(f(&[(a, Some(b"x"))]), f(&[(a, Some(b"y"))]));
        assert_ne!(f(&[(a, Some(b"x"))]), f(&[(b, Some(b"x"))]));
        assert_ne!(f(&[(a, None)]), f(&[(a, Some(b""))]));
        assert_ne!(
            f(&[(a, Some(b"x"))]),
            f(&[(a, Some(b"x")), (b, None)]),
            "多一份文件也算"
        );
    }

    /// 看着差异的时候文件被改了：**什么都不写**，按此刻的文件重算的那一份才写得进去
    #[test]
    fn a_file_changed_while_its_diff_was_shown_is_not_written() {
        let home = home_with_claude();
        let settings = home.path().join(".claude/settings.json");
        std::fs::write(&settings, "{\n  \"model\": \"opus\"\n}\n").unwrap();
        let g = gw(vec![key("default", "tw-d", None, true)]);
        let shown = plan_adopt(
            home.path(),
            "claude-code",
            &g,
            Vec::new(),
            &Around::default(),
        )
        .unwrap();

        // 客户端自己在这时改了一项设置
        let changed = "{\n  \"model\": \"sonnet\"\n}\n";
        std::fs::write(&settings, changed).unwrap();
        let adopt_now = |expect: &str| {
            adopt(
                home.path(),
                &backups(&home),
                "claude-code",
                &tw_adopt::clients::Gateway::keyed("http://127.0.0.1:8788", "tw-d", Vec::new()),
                Some(expect),
                &Around::default(),
            )
        };
        let e = adopt_now(&shown.digest).unwrap_err();
        assert_eq!(e.code, "adopt.plan.stale");
        assert_eq!(std::fs::read_to_string(&settings).unwrap(), changed);
        assert!(adopted(home.path(), &backups(&home)).is_empty());

        // 重新算一份给人看，照那一份就写得进去
        let again = plan_adopt(
            home.path(),
            "claude-code",
            &g,
            Vec::new(),
            &Around::default(),
        )
        .unwrap();
        assert_ne!(again.digest, shown.digest);
        adopt_now(&again.digest).unwrap();
        assert_eq!(adopted(home.path(), &backups(&home)).len(), 1);

        // 还原也一样
        let shown = plan_restore(home.path(), "claude-code", &[]).unwrap();
        let edited = std::fs::read_to_string(&settings)
            .unwrap()
            .replace("sonnet", "haiku");
        std::fs::write(&settings, &edited).unwrap();
        let e = restore(
            home.path(),
            &backups(&home),
            "claude-code",
            Some(&shown.digest),
        )
        .unwrap_err();
        assert_eq!(e.code, "adopt.plan.stale");
        assert_eq!(std::fs::read_to_string(&settings).unwrap(), edited);
        let again = plan_restore(home.path(), "claude-code", &[]).unwrap();
        restore(
            home.path(),
            &backups(&home),
            "claude-code",
            Some(&again.digest),
        )
        .unwrap();
        assert!(adopted(home.path(), &backups(&home)).is_empty());
    }
}
