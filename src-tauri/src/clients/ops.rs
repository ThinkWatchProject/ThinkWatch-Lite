//! 接管、还原、诊断：**在这台机器上做，不经过 core。**
//!
//! 这是全应用唯一会写用户其他软件配置的地方，所以形状也是刻意的：
//! **算一份改动和落盘是两步**，中间必须夹一次人的确认。一个「一步接管」的
//! 入口会顺手到没有人记得展示 diff。
//!
//! 这一层只要 core 回答两件事，都由调用方问好了递进来（[`Gateway`]）：客户端
//! 该连哪个网关，和有哪几把网关密钥。**密钥由 core 发放**（`POST /clients/{id}/key`），
//! 这里不写 config.yaml。连着的是哪个 core，这里不关心 —— 改的总是这台机器上的文件。

use std::path::Path;

use tw_adopt::clients::{self, Client};
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

/// 认得的、能接管的那一个。
pub fn find(id: &str) -> Result<Client, Msg> {
    clients::adoptable()
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
pub fn list(home: &Path, gw: &Gateway) -> wire::ClientsResponse {
    // 「使用中」的依据：**我们改了一个文件，但那个文件有没有被读到，只有请求能证明**
    // —— 而且是带着为它生成的那把密钥的请求。按请求头里自报的客户端标识算的话，
    // 一个没接管的客户端冒用那个标识就能让它显示成「使用中」
    let key_of = |id: &str| gw.key_of(id).map(|k| (k.name.clone(), k.last_seen_ms));
    // 手动配置时要写的字段按一把占位的密钥算：值本来就不回显，只要知道哪一项是密钥
    let placeholder = clients::Gateway {
        base: gw.base.clone(),
        key: Some(String::new()),
    };
    let detected = clients::adoptable()
        .iter()
        .map(|c| {
            let d = detect::detect_one(c, home);
            let (key, last_seen_ms) = key_of(d.id).unzip();
            let manual = setup_of(c, c.manual_steps(), &placeholder);
            detected_view(d, key, last_seen_ms.flatten(), manual, |p| {
                p.display().to_string()
            })
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
fn detected_view(
    d: detect::Detected,
    key: Option<String>,
    last_seen_ms: Option<u64>,
    manual: wire::ManualSetup,
    shown: impl Fn(&Path) -> String,
) -> wire::DetectedClient {
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
        adopted_at_ms: d.adopted_at_ms,
        endpoint: d.endpoint,
        shadows: d.shadows.iter().map(|p| shown(p)).collect(),
        takes_effect: d.takes_effect.into(),
        warns_when_silent: d.takes_effect.warns_when_silent(),
        verified: d.verified.into(),
        costs: d.costs,
    }
}

/// 一个 WSL 发行版里的客户端：第一批的那几个（`tw_adopt::wsl::CLIENTS`）。
///
/// 和这台电脑上的一样检测、一样给手动配置的方法，只是 home 是 WSL 里的，密钥是
/// 为 WSL 里这一份单独发的那把（`tw_adopt::wsl::key_id`）。
pub fn list_wsl(w: &tw_adopt::wsl::WslHome, gw: &Gateway) -> Vec<wire::DetectedClient> {
    let placeholder = clients::Gateway {
        base: gw.base.clone(),
        key: Some(String::new()),
    };
    clients::adoptable()
        .iter()
        .filter(|c| tw_adopt::wsl::CLIENTS.contains(&c.id))
        .map(|c| {
            let d = detect::detect_one(c, &w.home);
            let owner = tw_adopt::wsl::key_id(c.id, w.name());
            let k = gw.key_of(&owner);
            let manual = setup_of(c, c.manual_steps_wsl(w), &placeholder);
            detected_view(
                d,
                k.map(|k| k.name.clone()),
                k.and_then(|k| k.last_seen_ms),
                manual,
                |p| w.shown(p),
            )
        })
        .collect()
}

/// 接管着、**还指着这个网关的旧地址**的客户端：端口还是网关的端口，主机是一个
/// IP 地址，但已经不是 `base` 了。WSL 用 NAT 网络时，WSL 一重启，写进去的那个
/// 虚拟网卡地址就作废了；连着远程 core 时，还指着本机网关的也是这样。
///
/// 指着别的端口、写的是主机名的，是用户自己改的，不在里面 —— 重新指向不该把它们
/// 改回来。
pub fn stale(home: &Path, base: &str) -> Vec<Client> {
    let Some(want) = host_port(base).map(str::to_string) else {
        return Vec::new();
    };
    let port = want.rsplit_once(':').map(|(_, p)| p.to_string());
    clients::adoptable()
        .into_iter()
        .filter(|c| tw_adopt::wsl::CLIENTS.contains(&c.id))
        .filter(|c| {
            let d = detect::detect_one(c, home);
            let (Some(_), Some(e)) = (d.adopted_at_ms, d.endpoint) else {
                return false;
            };
            let Some(hp) = host_port(&e) else {
                return false;
            };
            let Some((host, p)) = hp.rsplit_once(':') else {
                return false;
            };
            hp != want
                && Some(p.to_string()) == port
                && host
                    .trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .is_ok()
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
/// 主配置和另一份文件的路径不会撞（一个以行 id 开头，一个以 `refs` 开头）
fn secret_paths(c: &Client) -> Vec<Vec<String>> {
    let gw = clients::Gateway {
        base: String::new(),
        key: Some(String::new()),
    };
    clients::edits(c, &gw)
        .into_iter()
        .chain(clients::also_edits(c, &gw))
        .filter(|e| e.secret)
        .map(|e| e.path)
        .collect()
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

fn mask(text: &str, key: Option<&str>) -> String {
    match key {
        // 空 key 会把每个字符之间都插一遍，那不是脱敏是毁掉整份 diff
        Some(k) if !k.is_empty() => text.replace(k, MASK),
        _ => text.to_string(),
    }
}

/// 另一份文件里整段是密钥的那几节（dsh 凭据文件的 `refs`、`records`）整段打码，
/// 其余照 [`mask`]
fn mask_file(text: &str, roots: &[&str], key: Option<&str>) -> String {
    mask(&tw_adopt::yaml::mask_under(text, roots, MASK), key)
}

fn view(
    p: &plan::Plan,
    secrets: &[Vec<String>],
    roots: &[&str],
    key: Option<&str>,
) -> wire::PlanView {
    wire::PlanView {
        client: p.client.clone(),
        path: p.path.display().to_string(),
        before: p.before.as_deref().map(|t| mask(t, key)),
        after: mask(&p.after, key),
        notes: p.notes.clone(),
        shadows: p.shadows.iter().map(|x| x.display().to_string()).collect(),
        noop: p.is_noop(),
        carries_secret: p.carries_secret,
        fields: fields_of(p, secrets),
        key: None,
        key_created: false,
        also: p
            .also
            .iter()
            .map(|a| wire::FilePlanView {
                path: a.path.display().to_string(),
                before: a.before.as_deref().map(|t| mask_file(t, roots, key)),
                after: mask_file(&a.after, roots, key),
                fields: fields_of(a, secrets),
                noop: a.is_noop(),
                deletes: a.delete_file,
            })
            .collect(),
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
pub fn plan_adopt(home: &Path, id: &str, gw: &Gateway) -> Result<wire::PlanView, Msg> {
    plan_adopt_as(home, id, id, gw)
}

/// [`plan_adopt`]，密钥归在 `owner` 名下。WSL 里的那一份用它自己的一把
/// （`tw_adopt::wsl::key_id`），不和这台电脑上的同一个客户端共用
pub fn plan_adopt_as(
    home: &Path,
    id: &str,
    owner: &str,
    gw: &Gateway,
) -> Result<wire::PlanView, Msg> {
    let c = find(id)?;
    let (name, value, created) = match gw.key_of(owner) {
        Some(k) => (k.name.clone(), k.key.clone(), false),
        None => {
            let default = gw.keys.iter().find(|k| k.default).ok_or_else(no_keys)?;
            (free_name(&gw.keys, owner), default.key.clone(), true)
        }
    };
    let target = clients::Gateway {
        base: gw.base.clone(),
        key: Some(value),
    };
    let p = plan::plan_adopt(&c, home, &target).map_err(|e| e.msg())?;
    let mut v = view(
        &p,
        &secret_paths(&c),
        secret_roots(&c),
        target.key.as_deref(),
    );
    v.key = Some(name);
    v.key_created = created;
    Ok(v)
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
/// `key` 是 core 此刻为它发的那把（为它留着的，或者这一刻新建的）：**先有钥匙再写
/// 对方的配置** —— 反过来的话，中间那一刻对方配置里写着一把网关不认识的钥匙。
pub fn adopt(
    home: &Path,
    backups: &Path,
    id: &str,
    base: &str,
    key: &str,
) -> Result<wire::AdoptResponse, Msg> {
    let c = find(id)?;
    let target = clients::Gateway {
        base: base.to_string(),
        key: Some(key.to_string()),
    };
    let p = plan::plan_adopt(&c, home, &target).map_err(|e| e.msg())?;
    let a = plan::apply(&c, &p, backups).map_err(|e| e.msg())?;
    Ok(wire::AdoptResponse {
        real: a.real.display().to_string(),
        backup: a.backup.display().to_string(),
        created: a.created,
        warnings: a.warnings,
        // **在接管完成那一屏说，不是等五分钟后再说**
        takes_effect: c.takes_effect.into(),
    })
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
    let c = find(id)?;
    let p = plan::plan_restore(&c, home).map_err(|e| e.msg())?;
    // 还原的 diff 里，**要打码的是用户自己的原始密钥** —— 它正要被写
    // 回去，而它比我们那把更不该出现在截图里
    let mut v = view(&p, &secret_paths(&c), secret_roots(&c), None);
    for k in keys {
        v.before = v.before.as_deref().map(|t| mask(t, Some(&k.key)));
        v.after = mask(&v.after, Some(&k.key));
        for a in &mut v.also {
            a.before = a.before.as_deref().map(|t| mask(t, Some(&k.key)));
            a.after = mask(&a.after, Some(&k.key));
        }
    }
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
pub fn restore(home: &Path, backups: &Path, id: &str) -> Result<wire::AdoptResponse, Msg> {
    let c = find(id)?;
    let p = plan::plan_restore(&c, home).map_err(|e| e.msg())?;
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
pub fn diagnose(home: &Path, id: &str) -> Result<Vec<wire::FindingView>, Msg> {
    let c = find(id)?;
    Ok(findings(detect::diagnose(&c, home, None)))
}

/// WSL 里的那一份走一遍同样的链
pub fn diagnose_wsl(w: &tw_adopt::wsl::WslHome, id: &str) -> Result<Vec<wire::FindingView>, Msg> {
    let c = find(id)?;
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

/// 此刻接管着的客户端。
pub fn adopted(home: &Path) -> Vec<Client> {
    clients::adoptable()
        .into_iter()
        .filter(|c| detect::detect_one(c, home).adopted_at_ms.is_some())
        .collect()
}

/// 此刻接管着、**配置里指着这台机器上的网关**的客户端，连同它此刻的端点。
///
/// 连着远程 core 时，它们的请求落到一个已经停了的网关上：客户端页把它们单独标出来，
/// 切换确认里说有几个，「改为指向服务器」改的也正是这几个。指着别处的（已经改过去
/// 了、或者用户自己指到了别的机器）不在里面。
pub fn adopted_on_this_machine(home: &Path) -> Vec<(Client, String)> {
    clients::adoptable()
        .into_iter()
        .filter_map(|c| {
            let d = detect::detect_one(&c, home);
            d.adopted_at_ms?;
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
/// 答得上来，core 答不上
pub fn adopted_owner(home: &Path, keys: &[ClientView], key: &str) -> Option<Client> {
    let id = keys.iter().find(|k| k.name == key)?.client.as_deref()?;
    let c = find(id).ok()?;
    detect::detect_one(&c, home).adopted_at_ms.map(|_| c)
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
/// 服务器」也是这一步，只是地址和密钥换成了那边的。
pub fn repoint(
    home: &Path,
    backups: &Path,
    c: &Client,
    base: &str,
    key: &str,
) -> Result<wire::KeySynced, wire::KeySyncFailed> {
    let target = clients::Gateway {
        base: base.to_string(),
        key: Some(key.to_string()),
    };
    plan::plan_adopt(c, home, &target)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn key(name: &str, value: &str, client: Option<&str>, default: bool) -> ClientView {
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
        let r = list(home.path(), &gw(vec![key("default", "tw-d", None, true)]));
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
            &gw(vec![key("default", "tw-d", None, true), mine]),
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
        let r = list(home.path(), &gw(vec![key("default", "tw-d", None, true)]));
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
        )
        .unwrap();
        assert_eq!(taken.key.as_deref(), Some("claude-code-2"));
        assert!(taken.key_created);
    }

    #[test]
    fn without_any_key_there_is_nothing_to_point_a_client_with() {
        let home = home_with_claude();
        let e = plan_adopt(home.path(), "claude-code", &gw(Vec::new())).unwrap_err();
        assert_eq!(e.code, "control.no_keys");
    }

    #[test]
    fn a_client_we_do_not_know_is_refused_by_name() {
        let home = tempfile::tempdir().unwrap();
        let e = plan_adopt(home.path(), "../etc", &gw(Vec::new())).unwrap_err();
        assert_eq!(e.code, "control.client_unknown");
        assert!(!known("../etc"));
        assert!(known("claude-code") && known("cursor"));
    }

    #[test]
    fn adopt_then_restore_puts_the_users_file_back_and_masks_their_key() {
        let home = home_with_claude();
        let settings = home.path().join(".claude/settings.json");
        let original = r#"{ "env": { "ANTHROPIC_BASE_URL": "https://example.com", "ANTHROPIC_AUTH_TOKEN": "users-own" } }"#;
        std::fs::write(&settings, original).unwrap();

        let a = adopt(
            home.path(),
            &backups(&home),
            "claude-code",
            "http://127.0.0.1:8788",
            "tw-new",
        )
        .unwrap();
        assert_eq!(a.takes_effect, wire::TakesEffect::Immediately);
        let written = std::fs::read_to_string(&settings).unwrap();
        assert!(written.contains("tw-new") && written.contains("127.0.0.1:8788"));
        assert!(adopted(home.path()).iter().any(|c| c.id == "claude-code"));

        let keys = vec![key("claude-code", "tw-new", Some("claude-code"), false)];
        let p = plan_restore(home.path(), "claude-code", &keys).unwrap();
        assert!(!p.before.as_deref().unwrap().contains("tw-new"));
        assert_eq!(p.key.as_deref(), Some("claude-code"));
        // 用户自己的那把正要被写回去：它也不出现在 diff 里（写的是旁文件里记下的值）
        assert!(!p.after.contains("tw-new"));

        restore(home.path(), &backups(&home), "claude-code").unwrap();
        let back: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        let want: serde_json::Value = serde_json::from_str(original).unwrap();
        assert_eq!(back, want);
        assert!(adopted(home.path()).is_empty());
    }

    #[test]
    fn restoring_something_we_never_adopted_refuses_instead_of_guessing() {
        let home = home_with_claude();
        assert!(restore(home.path(), &backups(&home), "claude-code").is_err());
    }

    /// 接管着的客户端的密钥删不得；它的主人是哪个，只有这台机器答得上来
    #[test]
    fn a_key_in_an_adopted_clients_config_is_found_by_its_owner() {
        let home = home_with_claude();
        let keys = vec![
            key("default", "tw-d", None, true),
            key("claude-code", "tw-c", Some("claude-code"), false),
        ];
        assert!(adopted_owner(home.path(), &keys, "claude-code").is_none());
        adopt(
            home.path(),
            &backups(&home),
            "claude-code",
            "http://127.0.0.1:8788",
            "tw-c",
        )
        .unwrap();
        let owner = adopted_owner(home.path(), &keys, "claude-code").unwrap();
        assert_eq!(owner.id, "claude-code");
        assert_eq!(key_used_by(owner.name).code, "control.key_used_by_client");
        assert!(adopted_owner(home.path(), &keys, "default").is_none());
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
            "http://127.0.0.1:8788",
            "tw-c",
        )
        .unwrap();
        adopt(
            home.path(),
            &backups(&home),
            "codex",
            "http://192.168.1.20:8788",
            "tw-x",
        )
        .unwrap();
        let here: Vec<_> = adopted_on_this_machine(home.path())
            .into_iter()
            .map(|(c, e)| (c.id, e))
            .collect();
        assert_eq!(
            here,
            vec![("claude-code", "http://127.0.0.1:8788".to_string())]
        );
    }

    /// 一个假的 WSL 发行版：`etc/passwd` 和默认用户的 home，Claude Code 和 Codex 都装了
    fn wsl_home() -> (tempfile::TempDir, tw_adopt::wsl::WslHome) {
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
        let (_d, w) = wsl_home();
        let mut mine = key(
            "claude-code-wsl-ubuntu",
            "tw-w",
            Some("claude-code-wsl-ubuntu"),
            false,
        );
        mine.last_seen_ms = Some(7);
        let gw = Gateway {
            base: "http://172.27.96.1:8788".into(),
            keys: vec![
                key("default", "tw-d", None, true),
                key("claude-code", "tw-c", Some("claude-code"), false),
                mine,
            ],
        };
        let r = list_wsl(&w, &gw);
        let ids: Vec<_> = r.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["claude-code", "codex"]);
        let cc = &r[0];
        assert!(cc.installed);
        assert_eq!(cc.path, "~/.claude/settings.json");
        assert_eq!(cc.key.as_deref(), Some("claude-code-wsl-ubuntu"));
        assert_eq!(cc.last_seen_ms, Some(7));
        assert_eq!(cc.manual.endpoint, "http://172.27.96.1:8788");
        assert_eq!(cc.manual.steps[0].arg("file"), "~/.claude/settings.json");
        assert_eq!(r[1].key, None);
        // 接管的方案：新建的那把叫 WSL 那一份的名字
        let p = plan_adopt_as(&w.home, "codex", "codex-wsl-ubuntu", &gw).unwrap();
        assert_eq!(p.key.as_deref(), Some("codex-wsl-ubuntu"));
        assert!(p.key_created);
        assert!(known("codex-wsl-ubuntu"));
    }

    /// WSL 重启之后：还指着网关端口上一个旧 IP 的算「旧地址」；用户自己指到
    /// 别的端口、别的主机名上的不算，重新指向不该把它们改回来
    #[test]
    fn only_clients_left_on_an_old_gateway_address_are_stale() {
        let (d, w) = wsl_home();
        let b = d.path().join("backups");
        adopt(&w.home, &b, "claude-code", "http://172.20.0.1:8788", "tw-c").unwrap();
        adopt(&w.home, &b, "codex", "http://relay.example:8788", "tw-x").unwrap();
        let ids = |base: &str| -> Vec<&str> { stale(&w.home, base).iter().map(|c| c.id).collect() };
        assert_eq!(ids("http://172.27.96.1:8788"), ["claude-code"]);
        assert!(ids("http://172.20.0.1:8788").is_empty(), "指着的就是它");
        assert!(
            ids("http://172.27.96.1:9999").is_empty(),
            "端口不同，是用户自己改的"
        );
        // 重新指向之后就不旧了
        let c = find("claude-code").unwrap();
        repoint(&w.home, &b, &c, "http://172.27.96.1:8788", "tw-c").unwrap();
        assert!(ids("http://172.27.96.1:8788").is_empty());
        // 还原回到原样：WSL 里的那一份和这台电脑上的一样能退回去
        restore(&w.home, &b, "claude-code").unwrap();
        assert!(adopted(&w.home).iter().all(|c| c.id != "claude-code"));
    }

    /// 换了密钥之后重新指一次：新值写进它的配置
    #[test]
    fn repointing_writes_the_new_key_into_the_clients_config() {
        let home = home_with_claude();
        adopt(
            home.path(),
            &backups(&home),
            "claude-code",
            "http://127.0.0.1:8788",
            "tw-old",
        )
        .unwrap();
        let c = find("claude-code").unwrap();
        let s = repoint(
            home.path(),
            &backups(&home),
            &c,
            "http://127.0.0.1:8788",
            "tw-fresh",
        )
        .unwrap();
        assert_eq!(s.client, "claude-code");
        let text = std::fs::read_to_string(home.path().join(".claude/settings.json")).unwrap();
        assert!(
            text.contains("tw-fresh") && !text.contains("tw-old"),
            "{text}"
        );
    }
}
