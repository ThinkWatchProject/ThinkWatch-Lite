//! WSL reachability and the listener half of a reviewed adoption transaction.
//! All stored addresses are pinned. Network changes only affect diagnostics; only
//! an explicit adoption writes a new endpoint or opens a new listener.
use std::collections::BTreeMap;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tw_adopt::wsl::{self, WslHome};
use tw_api::{ListenSave, ListenView, NicView, ep};
use tw_types::{Msg, msg};

use super::{base_url, ops};
use crate::{AppState, control::ControlClient, error::CmdError, wire};

pub static MUTATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Spec {
    pub bind: String,
    pub additional: Vec<String>,
    pub port: u16,
    pub allow_from: Vec<String>,
}
impl From<&ListenView> for Spec {
    fn from(v: &ListenView) -> Self {
        Self {
            bind: v.bind.clone(),
            additional: v.additional.clone(),
            port: v.port,
            allow_from: v.allow_from.clone(),
        }
    }
}
impl Spec {
    fn request(&self, version: String) -> ListenSave {
        ListenSave {
            bind: self.bind.clone(),
            additional: self.additional.clone(),
            port: self.port,
            allow_from: self.allow_from.clone(),
            base_version: Some(version),
        }
    }
    fn covers(&self, ip: IpAddr, nics: &[NicView]) -> bool {
        if self.bind == "loopback" {
            return ip == IpAddr::V4(std::net::Ipv4Addr::LOCALHOST);
        }
        if let Ok(primary) = self.bind.parse::<IpAddr>()
            && primary.is_loopback()
        {
            return ip == primary;
        }
        if ip == IpAddr::V4(std::net::Ipv4Addr::LOCALHOST) {
            return true;
        }
        std::iter::once(&self.bind)
            .chain(&self.additional)
            .any(|b| {
                (ip.is_ipv4() && (b == "all" || b == "0.0.0.0"))
                    || (ip.is_ipv6() && b == "::")
                    || (ip.is_loopback() && b == "loopback")
                    || b.parse::<IpAddr>() == Ok(ip)
                    || nics
                        .iter()
                        .any(|n| n.name == *b && n.addr.parse::<IpAddr>() == Ok(ip))
            })
    }
    fn allows(&self, ip: IpAddr) -> bool {
        ip.is_loopback()
            || self.allow_from.iter().any(|s| {
                s.parse::<ipnet::IpNet>().is_ok_and(|n| n.contains(&ip))
                    || s.parse::<IpAddr>() == Ok(ip)
            })
    }
    fn include(&mut self, host: IpAddr, source: IpAddr, nics: &[NicView]) {
        if !self.covers(host, nics) {
            // Pin the IP, not the NIC name: a WSL restart must not silently open a new address.
            if self.bind == "loopback" || self.bind.parse::<IpAddr>().is_ok_and(|a| a.is_loopback())
            {
                self.bind = host.to_string();
                // Inactive secondary binds stay in the restore baseline, not the enabled set.
                self.additional.clear();
            } else {
                self.additional.push(host.to_string());
            }
        }
        if !self.allows(source) {
            self.allow_from.push(format!(
                "{source}/{}",
                if source.is_ipv4() { 32 } else { 128 }
            ));
        }
    }
}

fn failed(e: impl std::fmt::Display) -> Msg {
    CmdError::plain(e.to_string()).into_msg()
}
fn unavailable(distro: &str) -> Msg {
    msg!("wsl.network_unavailable", distro = distro =>
        "Cannot identify a usable Windows gateway for WSL · {distro}. Start the distribution and check its default route. A reachability check requires curl or python3 inside WSL.")
}
fn blocked(distro: &str) -> Msg {
    msg!("wsl.probe_failed", distro = distro =>
        "WSL · {distro} could not reach this gateway after the listener was enabled. Check the Windows firewall and WSL networking. The client configuration was not changed.")
}

#[derive(Clone)]
pub struct Target {
    pub base: String,
    pub before: Option<Spec>,
    pub after: Option<Spec>,
    pub source: Option<IpAddr>,
    pub identity: String,
    pub config_path: String,
}
impl Target {
    pub fn changed(&self) -> bool {
        self.before != self.after
    }
    pub fn digest(&self, client: &str) -> String {
        let bytes = serde_json::to_vec(&(
            client,
            &self.base,
            &self.before,
            &self.after,
            self.source,
            &self.identity,
        ))
        .unwrap();
        ops::fingerprint([(Path::new("wsl-network"), Some(bytes.as_slice()))])
    }
    pub fn attach(&self, plan: &mut wire::PlanView) {
        plan.digest = self.digest(&plan.digest);
        if !self.changed() {
            return;
        }
        let before = serde_json::to_string_pretty(&self.before).unwrap();
        let after = serde_json::to_string_pretty(&self.after).unwrap();
        plan.also.push(wire::FilePlanView {
            path: format!("{} · listen.gateway", self.config_path),
            before: Some(before),
            after,
            fields: Vec::new(),
            noop: false,
            deletes: false,
        });
        plan.noop = false;
        plan.notes.push(msg!("wsl.listener_change", address = &self.base =>
            "This adoption also enables the Windows gateway at {address}. Existing listeners and authentication are retained; only the required WSL source is added if it is not already allowed."));
    }
}

/// Discover candidates, then verify them from inside this particular distribution.
/// OS / WSL version only describes the network; it never decides eligibility.
pub async fn resolve(
    state: &AppState,
    w: &WslHome,
    preferred: Option<String>,
    owner: Option<String>,
) -> Result<Target, Msg> {
    let control = state.control.snapshot();
    let ov = control
        .call::<ep::Overview>(&[], &())
        .await
        .map_err(failed)?;
    if state.link.is_remote() {
        return Ok(Target {
            base: base_url(&super::gateway_host(state), ov.listen.port),
            before: None,
            after: None,
            source: None,
            identity: String::new(),
            config_path: String::new(),
        });
    }
    let (status, nics) = tokio::join!(
        control.call::<ep::Status>(&[], &()),
        control.call::<ep::Interfaces>(&[], &())
    );
    let status = status.map_err(failed)?;
    let nics = nics.map_err(failed)?;
    let before = Spec::from(&ov.listen);
    let distro = w.name().to_string();
    let identity = status.gateway_probe.clone();
    let port = before.port;
    let before_copy = before.clone();
    let journal = load()?;
    let version = w.distro.version;
    let config_path = status.config_path.clone();
    let probe_id = status.gateway_probe.clone();
    let found = tokio::task::spawn_blocking(move || {
        // Keep a managed endpoint when it remains usable, even after a networking mode change.
        let mut candidates = preferred.into_iter().collect::<Vec<_>>();
        candidates.push(base_url("127.0.0.1", port));
        for base in candidates {
            let Ok(url) = url::Url::parse(&base) else {
                continue;
            };
            let Some(ip) = url.host_str().and_then(|s| s.parse::<IpAddr>().ok()) else {
                continue;
            };
            if url.port_or_known_default() != Some(port)
                || (!ip.is_loopback() && !nics.iter().any(|n| n.addr == ip.to_string()))
            {
                continue;
            }
            if bound(&status.gateway_addrs, ip, port) && wsl::probe(&distro, &base, &identity) {
                let source = if ip.is_loopback() {
                    None
                } else {
                    ip.to_string()
                        .parse()
                        .ok()
                        .and_then(|ip| wsl::source(&distro, ip))
                        .map(IpAddr::V4)
                };
                let candidate = Managed {
                    base: base.clone(),
                    source,
                };
                let after = compose(
                    &journal,
                    &before_copy,
                    &nics,
                    owner.as_deref(),
                    Some(&candidate),
                );
                return Some((base, after, source));
            }
        }
        if version == 1 {
            return None;
        }
        for host in wsl::gateways(&distro) {
            // A VPN's default gateway is not necessarily an address of Windows.
            if !nics.iter().any(|n| n.addr == host.to_string()) {
                continue;
            }
            let Some(source) = wsl::source(&distro, host) else {
                continue;
            };
            let mut after = before_copy.clone();
            after.include(host.into(), source.into(), &nics);
            let base = base_url(&host.to_string(), port);
            let candidate = Managed {
                base: base.clone(),
                source: Some(IpAddr::V4(source)),
            };
            if owner.is_some() {
                after = compose(
                    &journal,
                    &before_copy,
                    &nics,
                    owner.as_deref(),
                    Some(&candidate),
                );
            }
            return Some((base, after, Some(IpAddr::V4(source))));
        }
        None
    })
    .await
    .map_err(failed)?;
    let (base, after, source) = found.ok_or_else(|| unavailable(w.name()))?;
    Ok(Target {
        base,
        before: Some(before),
        after: Some(after),
        source,
        identity: probe_id,
        config_path,
    })
}

pub fn bound(addrs: &[String], ip: IpAddr, port: u16) -> bool {
    addrs
        .iter()
        .filter_map(|s| s.parse::<SocketAddr>().ok())
        .any(|a| {
            a.port() == port
                && (a.ip() == ip || (a.ip().is_unspecified() && a.is_ipv4() == ip.is_ipv4()))
        })
}

/// Check configured AND actually bound sockets. A stale socket retained by Core after
/// a rejected config change does not make the new configuration look successful.
pub async fn reachable(control: &ControlClient, distro: &str, base: &str) -> bool {
    let Ok(s) = control.call::<ep::Status>(&[], &()).await else {
        return false;
    };
    let Ok(ov) = control.call::<ep::Overview>(&[], &()).await else {
        return false;
    };
    let Ok(nics) = control.call::<ep::Interfaces>(&[], &()).await else {
        return false;
    };
    let Ok(u) = url::Url::parse(base) else {
        return false;
    };
    let Some(ip) = u.host_str().and_then(|s| s.parse::<IpAddr>().ok()) else {
        return false;
    };
    let Some(port) = u.port_or_known_default() else {
        return false;
    };
    let spec = Spec::from(&ov.listen);
    if port != spec.port || !spec.covers(ip, &nics) || !bound(&s.gateway_addrs, ip, port) {
        return false;
    }
    let distro = distro.to_string();
    let base = base.to_string();
    tokio::task::spawn_blocking(move || {
        if !ip.is_loopback() {
            let IpAddr::V4(host) = ip else {
                return false;
            };
            let Some(source) = wsl::source(&distro, host) else {
                return false;
            };
            if !spec.allows(source.into()) {
                return false;
            }
        }
        wsl::probe(&distro, &base, &s.gateway_probe)
    })
    .await
    .unwrap_or(false)
}

async fn write(control: &ControlClient, before: &Spec, after: &Spec) -> Result<String, Msg> {
    let ov = control
        .call::<ep::Overview>(&[], &())
        .await
        .map_err(failed)?;
    ops::still_as_reviewed(
        Some(&serde_json::to_string(before).unwrap()),
        &serde_json::to_string(&Spec::from(&ov.listen)).unwrap(),
        "WSL gateway",
    )?;
    Ok(control
        .call::<ep::SaveListen>(&[], &after.request(ov.config_version))
        .await
        .map_err(failed)?
        .version)
}

/// Persist ownership before opening listeners. A crash can leave a conservative
/// record but never an unowned listener. Cleanup requires an explicit restore.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Journal {
    baseline: Option<Spec>,
    expected: Option<Spec>,
    pub clients: BTreeMap<String, Managed>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Managed {
    pub base: String,
    pub source: Option<IpAddr>,
}
fn compose(
    j: &Journal,
    current: &Spec,
    nics: &[NicView],
    exclude: Option<&str>,
    add: Option<&Managed>,
) -> Spec {
    let owned = j.expected.as_ref() == Some(current);
    let mut after = if owned {
        j.baseline.clone().unwrap_or_else(|| current.clone())
    } else {
        current.clone()
    };
    if owned {
        for (owner, m) in &j.clients {
            if Some(owner.as_str()) != exclude {
                include_managed(&mut after, m, nics);
            }
        }
    }
    if let Some(m) = add {
        include_managed(&mut after, m, nics);
    }
    after
}
fn include_managed(spec: &mut Spec, m: &Managed, nics: &[NicView]) {
    if let Some(source) = m.source
        && let Ok(u) = url::Url::parse(&m.base)
        && let Some(host) = u.host_str().and_then(|s| s.parse::<IpAddr>().ok())
        && !host.is_loopback()
        && nics.iter().any(|n| n.addr == host.to_string())
    {
        spec.include(host, source, nics);
    }
}

fn journal_path() -> PathBuf {
    crate::data_dir().join("wsl-adoption.json")
}
pub fn load() -> Result<Journal, Msg> {
    read(&journal_path())
}
fn read(path: &Path) -> Result<Journal, Msg> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(failed),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Journal::default()),
        Err(e) => Err(failed(e)),
    }
}
fn save(j: &Journal) -> Result<(), Msg> {
    crate::atomic_file::write(
        &journal_path(),
        &serde_json::to_vec_pretty(j).map_err(failed)?,
    )
    .map_err(failed)
}
pub fn preferred(owner: &str) -> Result<Option<String>, Msg> {
    Ok(load()?.clients.get(owner).map(|c| c.base.clone()))
}
pub fn is_managed_endpoint(backups: &Path, owner: &str, endpoint: &str) -> bool {
    read(
        &backups
            .parent()
            .unwrap_or(backups)
            .join("wsl-adoption.json"),
    )
    .ok()
    .and_then(|j| j.clients.get(owner).cloned())
    .is_some_and(|m| super::ops::host_port(&m.base) == super::ops::host_port(endpoint))
}

pub struct Applied {
    old: Journal,
    written: Option<String>,
    target: Target,
}
pub async fn apply(
    control: &ControlClient,
    distro: &str,
    owner: &str,
    target: Target,
) -> Result<Applied, Msg> {
    let old = load()?;
    let mut next = old.clone();
    if let Some(before) = &target.before {
        if next.expected.as_ref() != Some(before) {
            // Settings were independently changed. They now belong to the user.
            next.baseline = Some(before.clone());
        }
        next.expected = target.after.clone();
        next.clients.insert(
            owner.to_string(),
            Managed {
                base: target.base.clone(),
                source: target.source,
            },
        );
        save(&next)?;
    }
    let written = if target.changed() {
        match write(
            control,
            target.before.as_ref().unwrap(),
            target.after.as_ref().unwrap(),
        )
        .await
        {
            Ok(version) => Some(version),
            Err(e) => {
                save(&old)?;
                return Err(e);
            }
        }
    } else {
        None
    };
    let applied = Applied {
        old,
        written,
        target,
    };
    if applied.target.before.is_some() {
        let mut ready = false;
        for _ in 0..10 {
            if reachable(control, distro, &applied.target.base).await {
                ready = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        if !ready {
            let error = blocked(distro);
            return match applied.rollback(control).await {
                Ok(()) => Err(error),
                Err(e) => Err(e),
            };
        }
    }
    Ok(applied)
}
impl Applied {
    pub async fn rollback(self, control: &ControlClient) -> Result<(), Msg> {
        if let Some(version) = self.written {
            // CAS guards every config field, not only listeners. Never undo another edit.
            let req = self.target.before.as_ref().unwrap().request(version);
            control.call::<ep::SaveListen>(&[], &req).await.map_err(|e|
                msg!("wsl.rollback_failed", detail = e.to_string() =>
                    "The WSL adoption failed, but its listener change could not be rolled back because settings changed or became unavailable: {detail}. Review gateway listening settings; the ownership record was retained."))?;
        }
        save(&self.old)
    }
}

/// Explicit restore only. Restore the baseline once the last managed client is
/// released, and only while the complete listen settings still match our record.
pub async fn release(control: &ControlClient, owner: &str) -> Result<(), Msg> {
    let mut j = load()?;
    if j.clients.remove(owner).is_none() {
        return Ok(());
    }
    if let (Some(expected), Some(_)) = (&j.expected, &j.baseline) {
        let ov = control
            .call::<ep::Overview>(&[], &())
            .await
            .map_err(failed)?;
        let current = Spec::from(&ov.listen);
        if current == *expected {
            let nics = control
                .call::<ep::Interfaces>(&[], &())
                .await
                .map_err(failed)?;
            let after = compose(&j, &current, &nics, None, None);
            if current != after {
                write(control, &current, &after).await?;
            }
            j.expected = Some(after);
        } else {
            // An independent listener edit transfers ownership to the user.
            j.baseline = None;
            j.expected = None;
        }
    }
    if j.clients.is_empty() {
        j.baseline = None;
        j.expected = None;
    }
    save(&j)
}

pub async fn restore_target(
    control: &ControlClient,
    local: bool,
    owner: &str,
) -> Result<Option<Target>, Msg> {
    if !local {
        return Ok(None);
    }
    let mut j = load()?;
    if j.clients.remove(owner).is_none() {
        return Ok(None);
    }
    let ov = control
        .call::<ep::Overview>(&[], &())
        .await
        .map_err(failed)?;
    let nics = control
        .call::<ep::Interfaces>(&[], &())
        .await
        .map_err(failed)?;
    let before = Spec::from(&ov.listen);
    let after = compose(&j, &before, &nics, None, None);
    Ok(Some(Target {
        base: String::new(),
        before: Some(before),
        after: Some(after),
        source: None,
        identity: String::new(),
        config_path: String::from("config.yaml"),
    }))
}

pub fn attach_restore(target: &Target, plan: &mut wire::PlanView) {
    let notes = plan.notes.len();
    target.attach(plan);
    plan.notes.truncate(notes);
    if target.changed() {
        plan.notes.push(msg!("wsl.listener_restore" =>
        "Unused listener and source rules added by Lite will also be removed. Independently changed settings are retained."));
    }
}

/// Runs even with the window closed. No configuration writes and no VM startup.
#[cfg(windows)]
pub fn watch(handle: &tauri::AppHandle, notices: std::sync::Arc<crate::notices::Notices>) {
    use crate::notices::{Level, Signal};
    use tauri::Manager;
    let handle = handle.clone();
    tauri::async_runtime::spawn(async move {
        let mut previous: std::collections::BTreeSet<_> = notices
            .list()
            .into_iter()
            .filter(|n| n.key.starts_with("wsl:"))
            .map(|n| n.key)
            .collect();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            let state = handle.state::<AppState>();
            let journal = match load() {
                Ok(j) => j,
                Err(e) => {
                    tracing::warn!("WSL adoption records: {}", e.text);
                    continue;
                }
            };
            let mut active = std::collections::BTreeSet::new();
            if !state.link.is_remote() && !journal.clients.is_empty() {
                let running = tokio::task::spawn_blocking(wsl::running_distros)
                    .await
                    .unwrap_or_default();
                let mut checked = BTreeMap::new();
                for (owner, m) in journal.clients {
                    let Some((_, distro)) = wsl::split_key_id(&owner) else {
                        continue;
                    };
                    if !running.iter().any(|d| d == distro) {
                        continue;
                    }
                    let key = format!("wsl:{owner}");
                    let ok = match checked.get(&(distro.to_string(), m.base.clone())) {
                        Some(ok) => *ok,
                        None => {
                            let ok = reachable(&state.control, distro, &m.base).await;
                            checked.insert((distro.to_string(), m.base.clone()), ok);
                            ok
                        }
                    };
                    if !ok {
                        active.insert(key.clone());
                        notices.ingest(Signal::raised(key, Level::Warning,
                            tr!("WSL 客户端无法连接网关", "WSL Gateway Unavailable"))
                            .body(tr!(format!("WSL · {distro} 的网关地址或监听已不可达。原配置已保留，请到客户端页检查并确认重新接管。"),
                                format!("The managed gateway for WSL · {distro} is unavailable. Configuration is preserved. Review the listener and reconnect from Clients to apply any address changes.")))
                            .view("clients"), crate::notices::now_ms());
                    }
                }
            }
            for key in previous.difference(&active) {
                notices.ingest(Signal::cleared(key), crate::notices::now_ms());
            }
            previous = active;
        }
    });
}

/// Preview the impact without opening WSL, reading client configs, or recognizing
/// manual setups. Used before GUI listener changes, including source-range changes.
#[tauri::command]
pub async fn wsl_listen_impact(
    state: tauri::State<'_, AppState>,
    listen: ListenSave,
) -> Result<Vec<String>, CmdError> {
    if state.link.is_remote() {
        return Ok(Vec::new());
    }
    let nics = state
        .control
        .call::<ep::Interfaces>(&[], &())
        .await
        .map_err(failed)?;
    let spec = Spec {
        bind: listen.bind,
        additional: listen.additional,
        port: listen.port,
        allow_from: listen.allow_from,
    };
    let j = load()?;
    Ok(j.clients
        .into_iter()
        .filter(|(_, m)| {
            let Ok(u) = url::Url::parse(&m.base) else {
                return true;
            };
            let Some(ip) = u.host_str().and_then(|s| s.parse::<IpAddr>().ok()) else {
                return true;
            };
            u.port_or_known_default() != Some(spec.port)
                || !spec.covers(ip, &nics)
                || m.source.is_some_and(|s| !spec.allows(s))
        })
        .filter_map(|(owner, _)| {
            wsl::split_key_id(&owner).map(|(id, distro)| format!("WSL · {distro} · {id}"))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nat_additions_preserve_lan_and_limit_new_sources() {
        let mut s = Spec {
            bind: "192.168.1.5".into(),
            additional: vec![],
            port: 8788,
            allow_from: vec!["192.168.1.0/24".into()],
        };
        s.include(
            "172.23.80.1".parse().unwrap(),
            "172.23.84.2".parse().unwrap(),
            &[],
        );
        assert_eq!(s.bind, "192.168.1.5");
        assert_eq!(s.additional, ["172.23.80.1"]);
        assert_eq!(s.allow_from, ["192.168.1.0/24", "172.23.84.2/32"]);
        assert!(!s.allows("172.23.84.3".parse().unwrap()));
        assert!(s.covers("127.0.0.1".parse().unwrap(), &[]));
    }
    #[test]
    fn wildcard_binding_and_exact_source_rules_are_reused() {
        let mut s = Spec {
            bind: "all".into(),
            additional: vec![],
            port: 8788,
            allow_from: vec!["172.16.0.0/12".into()],
        };
        let old = s.clone();
        s.include(
            "172.23.80.1".parse().unwrap(),
            "172.23.84.2".parse().unwrap(),
            &[],
        );
        assert_eq!(s, old);
        assert!(!bound(
            &["127.0.0.1:8788".into()],
            "172.23.80.1".parse().unwrap(),
            8788
        ));
    }
    fn baseline() -> Spec {
        Spec {
            bind: "loopback".into(),
            additional: vec![],
            port: 8788,
            allow_from: vec![],
        }
    }
    fn nic(ip: &str) -> NicView {
        NicView {
            name: "vEthernet (WSL)".into(),
            addr: ip.into(),
            loopback: false,
        }
    }
    fn managed(host: &str, source: &str) -> Managed {
        Managed {
            base: format!("http://{host}:8788"),
            source: Some(source.parse().unwrap()),
        }
    }
    #[test]
    fn shared_listener_is_kept_until_its_last_owner_is_restored() {
        let base = baseline();
        let nics = [nic("172.23.80.1")];
        let a = managed("172.23.80.1", "172.23.84.2");
        let mut expected = base.clone();
        include_managed(&mut expected, &a, &nics);
        let mut j = Journal {
            baseline: Some(base.clone()),
            expected: Some(expected.clone()),
            clients: BTreeMap::from([("codex".into(), a.clone()), ("claude".into(), a)]),
        };
        j.clients.remove("codex");
        assert_eq!(compose(&j, &expected, &nics, None, None), expected);
        j.clients.clear();
        assert_eq!(compose(&j, &expected, &nics, None, None), base);
    }
    #[test]
    fn explicit_readoption_prunes_obsolete_owned_addresses_but_preserves_user_changes() {
        let base = baseline();
        let old = managed("172.23.80.1", "172.23.84.2");
        let mut expected = base.clone();
        include_managed(&mut expected, &old, &[nic("172.23.80.1")]);
        let j = Journal {
            baseline: Some(base),
            expected: Some(expected.clone()),
            clients: BTreeMap::from([("codex".into(), old.clone()), ("claude".into(), old)]),
        };
        let new = managed("172.24.80.1", "172.24.84.3");
        let after = compose(
            &j,
            &expected,
            &[nic("172.24.80.1")],
            Some("codex"),
            Some(&new),
        );
        assert_eq!(after.bind, "172.24.80.1");
        assert!(after.additional.is_empty());
        assert_eq!(after.allow_from, ["172.24.84.3/32"]);
        // Independently edited settings are the new baseline and are not removed.
        let mut user = expected.clone();
        user.port = 9999;
        assert_eq!(compose(&j, &user, &[], None, None), user);
    }
    #[test]
    fn network_digest_covers_address_source_and_listener_settings() {
        let t = Target {
            base: "http://172.23.80.1:8788".into(),
            before: Some(baseline()),
            after: Some(baseline()),
            source: None,
            identity: "public-id".into(),
            config_path: "config.yaml".into(),
        };
        let original = t.digest("client-snapshot");
        let mut changed = t.clone();
        changed.source = Some("172.23.84.2".parse().unwrap());
        assert_ne!(original, changed.digest("client-snapshot"));
        changed = t.clone();
        changed.after.as_mut().unwrap().port = 9999;
        assert_ne!(original, changed.digest("client-snapshot"));
        changed = t;
        changed.base = "http://172.24.80.1:8788".into();
        assert_ne!(original, changed.digest("client-snapshot"));
    }
}
