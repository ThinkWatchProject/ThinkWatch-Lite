//! WSL 里的客户端：客户端页上「WSL · <发行版>」那几组，以及它们该连哪个地址。
//!
//! 接管、还原、诊断走的都是 [`super::ops`] 那一套，只是 home 换成 WSL 里那个
//! 用户的 home（UNC 路径，见 `tw_adopt::wsl`）。这里多出来的是**地址**：
//!
//! - WSL1、mirrored 模式：和 Windows 共用网络，写 127.0.0.1；
//! - NAT 模式（WSL2 的默认）：WSL 里的 127.0.0.1 是它自己，要写 WSL 虚拟网卡在
//!   Windows 这一侧的地址，**而且网关要在那张网卡上听**。监听要改的，接管的确认
//!   框里说出来，确认之后才改（[`ListenChange`]）；
//! - 连着远程 core：写服务器的地址，和这台电脑上的客户端一样。
//!
//! NAT 模式下那张网卡的地址会随 WSL 重启而变。变了之后，接管着的客户端还指着
//! 旧地址：列表里把它们标出来（[`super::ops::stale`]），用户点一下就重新指向。

use std::path::Path;

use tw_adopt::wsl::{self, Distro, NetMode, Reach, WslHome};
use tw_api::ep;
use tw_types::{Msg, msg};

use crate::AppState;
use crate::control::ControlClient;
use crate::error::{Out, text};
use crate::wire;

/// 注册表里登记着的发行版。**只读注册表，不碰 `\\wsl.localhost`**，不会唤醒谁。
pub fn distros() -> Vec<Distro> {
    #[cfg(windows)]
    {
        wsl::distros()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// 读一个发行版。**这一步会唤醒它。**
pub fn open(d: Distro) -> Result<WslHome, Msg> {
    #[cfg(windows)]
    {
        let root = wsl::root_of(&d.name);
        WslHome::read(d, root)
    }
    #[cfg(not(windows))]
    {
        Err(unknown(&d.name))
    }
}

/// 按名字找到并读一个发行版
pub fn find(name: &str) -> Result<WslHome, Msg> {
    let d = distros()
        .into_iter()
        .find(|d| d.name == name)
        .ok_or_else(|| unknown(name))?;
    open(d)
}

/// NAT 模式下找不到 WSL 的虚拟网卡：WSL 没在跑时它不在
pub fn no_adapter() -> Msg {
    msg!(
        "wsl.no_adapter" =>
        "The WSL virtual network adapter was not found. Start WSL and look again."
    )
}

fn unknown(name: &str) -> Msg {
    msg!("wsl.unknown", distro = name => "There is no WSL distribution named {distro}.")
}

/// 这台电脑上的 `.wslconfig` 说的是哪种网络。**每次现读**：用户改了它、
/// `wsl --shutdown` 之后就是另一种了
pub fn net_mode() -> NetMode {
    let text = tw_adopt::paths::env_home()
        .and_then(|h| std::fs::read(h.join(".wslconfig")).ok())
        .and_then(|b| wsl::decode_config(&b));
    wsl::net_mode(text.as_deref())
}

/// 界面上这一组的网络说成哪一种
pub fn network(d: &Distro, mode: NetMode) -> wire::WslNetwork {
    if d.version == 1 {
        wire::WslNetwork::Wsl1
    } else {
        match mode {
            NetMode::Nat => wire::WslNetwork::Nat,
            NetMode::Mirrored => wire::WslNetwork::Mirrored,
        }
    }
}

/// 要让网关在 WSL 网卡上听，监听设置要怎么改。**确认框里照着它说**，确认之后
/// 照着它存。
#[derive(Debug, Clone)]
pub struct ListenChange {
    pub save: tw_api::ListenSave,
    /// 给人看的那几句：改成听哪张网卡、放行名单加了什么
    pub notes: Vec<Msg>,
}

/// 这个发行版里的客户端此刻该连哪儿。
pub struct Target {
    /// `http://172.27.96.1:8788`
    pub base: String,
    pub network: wire::WslNetwork,
    /// NAT 模式下 WSL 虚拟网卡：名字和地址
    pub nic: Option<(String, std::net::Ipv4Addr)>,
    /// 监听要改的话，怎么改
    pub listen: Option<ListenChange>,
    /// 此刻的监听（NAT 模式下重新指向时要原样再存一次，见 [`relisten`]）
    pub view: Option<(tw_api::ListenView, String)>,
}

/// 算出这个发行版里的客户端该连的地址。
///
/// 连着远程 core 时和这台电脑上的客户端一样，是服务器的地址。本机时按网络模式：
/// NAT 下要找到 WSL 的虚拟网卡 —— **找不到就说找不到**（WSL 没在跑时它不在），
/// 不拿一个猜的地址写进客户端。
pub async fn target(state: &AppState, w: &WslHome) -> Result<Target, Msg> {
    let mode = net_mode();
    let network = network(&w.distro, mode);
    let remote = state.link.is_remote();
    let host = super::gateway_host(state);
    let ov = state
        .control
        .call::<ep::Overview>(&[], &())
        .await
        .map_err(|e| text(e).into_msg())?;
    let port = ov.listen.port;
    if remote || wsl::reach(w.distro.version, mode) == Reach::Loopback {
        return Ok(Target {
            base: super::base_url(&host, port),
            network,
            nic: None,
            listen: None,
            view: None,
        });
    }
    let nics = state
        .control
        .call::<ep::Interfaces>(&[], &())
        .await
        .map_err(|e| text(e).into_msg())?;
    let (name, addr) = wsl::pick_nic(nics.iter().map(|n| (n.name.as_str(), n.addr.as_str())))
        .ok_or_else(no_adapter)?;
    let listen = listen_change(&ov.listen, &ov.config_version, &name, addr);
    Ok(Target {
        base: super::base_url(&addr.to_string(), port),
        network,
        listen,
        view: Some((ov.listen, ov.config_version)),
        nic: Some((name, addr)),
    })
}

/// 网关要在 WSL 网卡上听，监听设置要怎么改。不用改就是 `None`。
///
/// core 的监听是「回环，加上**一张**网卡」或者「所有网卡」：
///
/// - 只听本机：改成听 WSL 那张网卡（回环照旧听着）；
/// - 已经听着 WSL 网卡、或者所有网卡：不改监听；
/// - 听着别的网卡（局域网那一档）：改成听所有网卡 —— 换成 WSL 网卡的话，局域网
///   那一边就断了。
///
/// 监听超出本机时，放行名单要盖住 WSL 网卡的地址，没盖住就加上它的网段。
pub fn listen_change(
    view: &tw_api::ListenView,
    version: &str,
    nic: &str,
    addr: std::net::Ipv4Addr,
) -> Option<ListenChange> {
    let b = view.bind.as_str();
    let loopback = b == "loopback" || b == "::1" || b.starts_with("127.");
    let all = b == "all" || b == "0.0.0.0" || b == "::";
    let on_nic = b == nic || b == addr.to_string();
    let mut notes = Vec::new();
    let bind = if loopback {
        notes.push(msg!(
            "wsl.listen.nic", nic = nic, addr = addr =>
            "The gateway listens only on this computer at present. It will also listen on {nic} ({addr}), the adapter WSL reaches Windows through."
        ));
        nic.to_string()
    } else if all || on_nic {
        view.bind.clone()
    } else {
        notes.push(msg!(
            "wsl.listen.all", bind = b =>
            "The gateway listens on {bind} at present. It will listen on all adapters, so that WSL can reach it as well."
        ));
        "all".to_string()
    };
    let mut allow = view.allow_from.clone();
    if !allow.iter().any(|c| wsl::in_cidr(addr, c)) {
        let range = wsl::remote_range(addr);
        notes.push(msg!(
            "wsl.listen.allow", range = &range =>
            "{range} will be added to the allowed sources, so that connections from WSL are accepted."
        ));
        allow.push(range);
    }
    (!notes.is_empty()).then(|| ListenChange {
        save: tw_api::ListenSave {
            bind,
            port: view.port,
            allow_from: allow,
            base_version: Some(version.to_string()),
        },
        notes,
    })
}

/// 存一次监听。确认过的改动，或者 WSL 重启之后原样再存一次：core 存监听时会
/// 照着配置重新绑一遍，**网卡名这时现问系统**，于是换到那张网卡的新地址上。
pub async fn save_listen(control: &ControlClient, save: &tw_api::ListenSave) -> Out<()> {
    control
        .call::<ep::SaveListen>(&[], save)
        .await
        .map_err(text)?;
    Ok(())
}

/// WSL 重启之后网卡换了地址：监听绑在那张网卡上的，原样再存一次，让网关换到新
/// 地址上。没绑在它上面（所有网卡、只听本机）的用不着。
pub async fn relisten(control: &ControlClient, t: &Target) -> Out<()> {
    let (Some((view, version)), Some((nic, addr))) = (&t.view, &t.nic) else {
        return Ok(());
    };
    if view.bind != *nic && view.bind != addr.to_string() {
        return Ok(());
    }
    save_listen(
        control,
        &tw_api::ListenSave {
            bind: view.bind.clone(),
            port: view.port,
            allow_from: view.allow_from.clone(),
            base_version: Some(version.clone()),
        },
    )
    .await
}

/// 接管确认框里 WSL 多出来的几句：请求经由 Windows 上的网关；NAT 下地址会变；
/// 监听要怎么改。
pub fn plan_notes(client: &str, w: &WslHome, t: &Target) -> Vec<Msg> {
    let mut out = vec![msg!(
        "wsl.via_windows", client = client, distro = w.name() =>
        "{client} in WSL · {distro} sends its requests through the gateway on Windows."
    )];
    if let Some((_, addr)) = &t.nic {
        out.push(msg!(
            "wsl.nat_address", addr = addr =>
            "WSL uses NAT networking, so its address for Windows, {addr}, changes when WSL restarts. The client is then shown as not in effect, and one click points it at the new address."
        ));
    }
    if let Some(l) = &t.listen {
        out.extend(l.notes.iter().cloned());
    }
    out
}

/// 给人看的客户端名字：`Claude Code (WSL · Ubuntu)`
pub fn display_name(client: &str, w: &WslHome) -> String {
    format!("{client} (WSL · {})", w.name())
}

/// 防火墙里那条放行 WSL 的规则缺了时，要用户在管理员 PowerShell 里执行的命令。
/// 规则在、查不了、或者用不着（不是 NAT）都是 `None`。
pub fn firewall_hint(program: Option<&Path>, t: &Target) -> Option<String> {
    let (_, addr) = t.nic.as_ref()?;
    let program = program?;
    match rule_exists() {
        Some(false) => Some(wsl::firewall_command(program, &wsl::remote_range(*addr))),
        _ => None,
    }
}

/// 那条规则在不在。问 `netsh`：它找不到规则时退出码是 1。**问不了就不知道**
/// （`None`），不因为一次没跑起来的查询就叫用户去执行管理员命令。
#[cfg(windows)]
fn rule_exists() -> Option<bool> {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("netsh")
        .args([
            "advfirewall",
            "firewall",
            "show",
            "rule",
            &format!("name={}", wsl::FIREWALL_RULE),
        ])
        // 没有这一句，每次打开客户端页都会闪一个黑窗口
        .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
        .output()
        .ok()?;
    match out.status.code() {
        Some(0) => Some(true),
        Some(1) => Some(false),
        _ => None,
    }
}

#[cfg(not(windows))]
fn rule_exists() -> Option<bool> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn view(bind: &str, allow: &[&str]) -> tw_api::ListenView {
        tw_api::ListenView {
            bind: bind.into(),
            port: 8788,
            allow_from: allow.iter().map(|s| s.to_string()).collect(),
            default_allow_from: Vec::new(),
            exposed: bind != "loopback",
        }
    }

    const NIC: &str = "vEthernet (WSL)";
    const ADDR: Ipv4Addr = Ipv4Addr::new(172, 27, 96, 1);
    const PRIVATE: &[&str] = &["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];

    #[test]
    fn only_local_listening_moves_onto_the_wsl_adapter() {
        let c = listen_change(&view("loopback", PRIVATE), "v1", NIC, ADDR).unwrap();
        assert_eq!(c.save.bind, NIC);
        assert_eq!(c.save.port, 8788);
        assert_eq!(c.save.allow_from, PRIVATE);
        assert_eq!(c.save.base_version.as_deref(), Some("v1"));
        assert_eq!(c.notes.len(), 1);
        assert_eq!(c.notes[0].code, "wsl.listen.nic");
    }

    #[test]
    fn listening_that_already_reaches_wsl_is_left_alone() {
        for b in ["all", "0.0.0.0", NIC, "172.27.96.1"] {
            assert!(
                listen_change(&view(b, PRIVATE), "v", NIC, ADDR).is_none(),
                "{b}"
            );
        }
    }

    /// 听着局域网那张网卡的，换成所有网卡 —— 换成 WSL 网卡的话局域网就断了
    #[test]
    fn another_adapter_widens_to_all_rather_than_dropping_the_lan() {
        let c = listen_change(&view("Ethernet", PRIVATE), "v", NIC, ADDR).unwrap();
        assert_eq!(c.save.bind, "all");
        assert_eq!(c.notes[0].code, "wsl.listen.all");
    }

    #[test]
    fn the_allowed_sources_are_widened_only_when_they_miss_wsl() {
        let c = listen_change(&view("all", &["192.168.1.0/24"]), "v", NIC, ADDR).unwrap();
        assert_eq!(c.save.bind, "all");
        assert_eq!(c.save.allow_from, ["192.168.1.0/24", "172.16.0.0/12"]);
        assert_eq!(c.notes[0].code, "wsl.listen.allow");
        let odd = Ipv4Addr::new(192, 168, 50, 1);
        let c = listen_change(&view("loopback", &[]), "v", NIC, odd).unwrap();
        assert_eq!(c.save.allow_from, ["192.168.0.0/16"]);
        assert_eq!(c.notes.len(), 2);
    }

    /// 安装程序加的那条规则，和界面上查的、给出的命令是同一条
    #[test]
    fn the_installer_adds_the_rule_the_client_page_looks_for() {
        let nsh = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows/hooks.nsh"),
        )
        .unwrap();
        let (net, bits) = wsl::NAT_RANGE;
        assert!(
            nsh.contains(&format!("!define TW_WSL_RULE \"{}\"", wsl::FIREWALL_RULE)),
            "规则名对不上"
        );
        assert!(
            nsh.contains(&format!("!define TW_WSL_RANGE \"{net}/{bits}\"")),
            "网段对不上"
        );
        // 程序路径是安装目录里的那一个（tauri.windows.conf.json 把它放在那儿）
        assert!(nsh.contains(r#"program="$INSTDIR\twcore.exe""#));
        let conf = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.windows.conf.json"),
        )
        .unwrap();
        assert!(conf.contains(r#""installerHooks": "./windows/hooks.nsh""#));
        assert!(conf.contains(r#""resources/twcore.exe": "twcore.exe""#));
    }

    #[test]
    fn a_wsl1_distro_shares_the_network_whatever_wslconfig_says() {
        let d = |version| Distro {
            name: "Ubuntu".into(),
            version,
            uid: 1000,
        };
        assert_eq!(network(&d(1), NetMode::Nat), wire::WslNetwork::Wsl1);
        assert_eq!(network(&d(2), NetMode::Nat), wire::WslNetwork::Nat);
        assert_eq!(
            network(&d(2), NetMode::Mirrored),
            wire::WslNetwork::Mirrored
        );
    }
}
