//! WSL 里的客户端：客户端页上「WSL · <发行版>」那几组，以及它们此刻能不能接管。
//!
//! 接管、还原、诊断走的都是 [`super::ops`] 那一套，只是 home 换成 WSL 里那个
//! 用户的 home（UNC 路径，见 `tw_adopt::wsl`）。**写进去的地址和这台电脑上的
//! 客户端一样**：本机时是 `127.0.0.1`，连着远程 core 时是服务器的地址。
//!
//! 本机时，WSL 里够得着 Windows 的 `127.0.0.1` 的只有 WSL 1 和 WSL 2 的 mirrored
//! 网络。**网关不为 WSL 另外听一张网卡**，所以 WSL 2 默认的 NAT 下不接管：客户端页
//! 说明原因，给「改为 mirrored 模式」（改 `.wslconfig`，走和接管一样的差异、确认、
//! 全文备份）和「重启 WSL」。连着远程 core 时，客户端经网络去连服务器，WSL 用哪种
//! 网络都够得着。

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

use tw_adopt::wsl::{self, Distro, Wsl2, WslHome};
use tw_adopt::wslconfig::{self, NetMode};
use tw_types::{Msg, msg};

use crate::AppState;
use crate::error::CmdError;
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

fn unknown(name: &str) -> Msg {
    msg!("wsl.unknown", distro = name => "There is no WSL distribution named {distro}.")
}

/// 改 `.wslconfig`、重启 WSL 之前先认一下：这台电脑上有 WSL 发行版（不在 Windows
/// 上就没有）。界面只在 WSL 那几组里给这两个按钮
pub fn ensure_any() -> Result<(), Msg> {
    if distros().is_empty() {
        Err(msg!("wsl.none" => "There is no WSL distribution on this computer."))
    } else {
        Ok(())
    }
}

/// `%USERPROFILE%\.wslconfig`
pub fn wslconfig() -> PathBuf {
    wslconfig::path(&super::home_dir())
}

/// `.wslconfig` 此刻说的网络。**每次现读**：用户可能刚在编辑器或 WSL 设置里改过
pub fn config_mode() -> NetMode {
    wslconfig::mode_of(std::fs::read(wslconfig()).ok().as_deref())
}

/// 上一次在这里重启 WSL 的时刻。**只记在内存里**：应用重启之后就不知道了，那时
/// 「`.wslconfig` 是 mirrored、WSL 还在用 NAT」按还没重启说，多给一次重启的按钮
static RESTARTED_AT: Mutex<Option<SystemTime>> = Mutex::new(None);

/// 在这里重启过 WSL，而且是在 `.wslconfig` 最后一次改动之后
fn restarted_since_change() -> bool {
    let at = *RESTARTED_AT.lock().unwrap_or_else(|e| e.into_inner());
    let Some(at) = at else {
        return false;
    };
    std::fs::metadata(wslconfig())
        .and_then(|m| m.modified())
        .is_ok_and(|changed| at > changed)
}

/// 重启 WSL：`wsl --shutdown` 停掉所有发行版，下次启动时照 `.wslconfig` 来。
/// **阻塞**，最多一分钟
pub fn shutdown() -> Result<(), Msg> {
    wsl::shutdown().map_err(|detail| {
        msg!(
            "wsl.shutdown_failed", detail = detail =>
            "WSL could not be shut down: {detail}"
        )
    })?;
    *RESTARTED_AT.lock().unwrap_or_else(|e| e.into_inner()) = Some(SystemTime::now());
    Ok(())
}

/// 这台电脑上 WSL 2 的网络（本机时）。**会读注册表、起 `wsl.exe`**：阻塞，调用方
/// 放进 `spawn_blocking`。`probe` 是一个开着的 WSL 2 发行版：问它 WSL 此刻实际用的
/// 是哪种网络（所有 WSL 2 发行版在同一台虚拟机里，问一个就够）
pub fn wsl2(probe: Option<String>) -> Wsl2 {
    wsl::decide(
        wsl::windows_build(),
        config_mode(),
        || probe.as_deref().and_then(wsl::running_mirrored),
        wsl::wsl_version,
        restarted_since_change(),
    )
}

/// 一个发行版的网络，以及此刻能不能接管。
///
/// WSL 1 总能：它和 Windows 共用网络。连着远程 core 时也总能 —— 客户端经网络去连
/// 服务器，和 WSL 用哪种网络无关，这时只照 `.wslconfig` 说一声是哪种，不起
/// `wsl.exe`。其余的看这台电脑上 WSL 2 的情况：只有 mirrored 能。
pub fn network(
    remote: bool,
    d: &Distro,
    config: NetMode,
    wsl2: impl FnOnce() -> Wsl2,
) -> (wire::WslNetwork, bool) {
    if d.version == 1 {
        return (wire::WslNetwork::Wsl1, true);
    }
    if remote {
        let n = match config {
            NetMode::Mirrored => wire::WslNetwork::Mirrored,
            NetMode::Nat => wire::WslNetwork::Nat { wsl_version: None },
        };
        return (n, true);
    }
    let n = wire::WslNetwork::from(wsl2());
    let ok = n == wire::WslNetwork::Mirrored;
    (n, ok)
}

/// 此刻从这个发行版里够不着网关（NAT 这些）。界面上本来不给接管、手动配置的按钮，
/// 这一句拦的是绕过界面的那一次
fn unreachable(distro: &str) -> Msg {
    msg!(
        "wsl.unreachable", distro = distro =>
        "The gateway on Windows cannot be reached from WSL · {distro} with its current networking."
    )
}

/// 这个发行版里的客户端要写的地址。**和这台电脑上的一样**（`http://127.0.0.1:8788`，
/// 或者服务器的）；此刻够不着网关的拒绝。会起 `wsl.exe` 问一次网络
pub async fn target(state: &AppState, w: &WslHome) -> Result<String, Msg> {
    let base = super::gateway_base(&state.control, &super::gateway_host(state))
        .await
        .map_err(CmdError::into_msg)?;
    let remote = state.link.is_remote();
    let d = w.distro.clone();
    let (_, ok) = tokio::task::spawn_blocking(move || {
        let probe = Some(d.name.clone());
        network(remote, &d, config_mode(), || wsl2(probe))
    })
    .await
    .map_err(|e| CmdError::plain(e.to_string()).into_msg())?;
    if ok {
        Ok(base)
    } else {
        Err(unreachable(w.name()))
    }
}

/// 接管确认框里 WSL 多出来的那一句：请求经由 Windows 上的网关。连着远程 core 时
/// 不说 —— 那时网关不在 Windows 上
pub fn plan_notes(client: &str, w: &WslHome, remote: bool) -> Vec<Msg> {
    if remote {
        return Vec::new();
    }
    vec![msg!(
        "wsl.via_windows", client = client, distro = w.name() =>
        "{client} in WSL · {distro} sends its requests through the gateway on Windows."
    )]
}

/// 一个发行版给人看的名字：`WSL · Ubuntu`，和客户端页上那一组的组名一样
pub fn place_name(distro: &str) -> String {
    format!("WSL · {distro}")
}

/// 给人看的客户端名字：`Claude Code (WSL · Ubuntu)`
pub fn display_name(client: &str, w: &WslHome) -> String {
    format!("{client} ({})", place_name(w.name()))
}

/// 卸载确认框里那一句要的：`.wslconfig` 此刻是 mirrored，而且是在这里改的（备份
/// 目录里有它改之前的样子）。**卸载不改回它**，这一句把这件事说在前面
pub fn kept() -> Option<wire::WslConfigKept> {
    let path = wslconfig();
    if config_mode() != NetMode::Mirrored {
        return None;
    }
    let real = tw_adopt::foreign::resolve(&path).ok()?;
    let first = tw_adopt::foreign::backups_of(&tw_adopt::foreign::backup_root(), &real)
        .into_iter()
        .next()?;
    // 第一次改之前没有这个文件：备份是空的，文件是这里新建的
    let created = std::fs::metadata(&first).is_ok_and(|m| m.len() == 0);
    Some(wire::WslConfigKept {
        path: path.display().to_string(),
        backup: (!created).then(|| first.display().to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn distro(version: u32) -> Distro {
        Distro {
            name: "Ubuntu".into(),
            version,
            uid: 1000,
        }
    }

    fn never() -> Wsl2 {
        panic!("用不着问 WSL 2 的情况")
    }

    /// WSL 1 和 Windows 共用网络，哪种情况下都能接管
    #[test]
    fn wsl1_is_always_adoptable() {
        for remote in [false, true] {
            for config in [NetMode::Nat, NetMode::Mirrored] {
                assert_eq!(
                    network(remote, &distro(1), config, never),
                    (wire::WslNetwork::Wsl1, true)
                );
            }
        }
    }

    /// 本机时 WSL 2 只有 mirrored 能接管；NAT、等重启、没能启用、Windows 或 WSL
    /// 太旧的都不能
    #[test]
    fn locally_only_mirrored_wsl2_is_adoptable() {
        let at = |s: Wsl2| network(false, &distro(2), NetMode::Mirrored, || s);
        assert_eq!(at(Wsl2::Mirrored), (wire::WslNetwork::Mirrored, true));
        for (s, want) in [
            (
                Wsl2::Nat { version: None },
                wire::WslNetwork::Nat { wsl_version: None },
            ),
            (
                Wsl2::Nat {
                    version: Some("2.3.26.0".into()),
                },
                wire::WslNetwork::Nat {
                    wsl_version: Some("2.3.26.0".into()),
                },
            ),
            (Wsl2::Restart, wire::WslNetwork::Restart),
            (Wsl2::Fallback, wire::WslNetwork::Fallback),
            (Wsl2::OldWindows, wire::WslNetwork::OldWindows),
            (
                Wsl2::OldWsl {
                    version: "1.2.5.0".into(),
                },
                wire::WslNetwork::OldWsl {
                    wsl_version: "1.2.5.0".into(),
                },
            ),
        ] {
            assert_eq!(at(s), (want, false));
        }
    }

    /// 连着远程 core：客户端经网络去连服务器，NAT 也够得着；不为此去问 WSL
    #[test]
    fn with_a_remote_core_any_network_is_adoptable() {
        assert_eq!(
            network(true, &distro(2), NetMode::Nat, never),
            (wire::WslNetwork::Nat { wsl_version: None }, true)
        );
        assert_eq!(
            network(true, &distro(2), NetMode::Mirrored, never),
            (wire::WslNetwork::Mirrored, true)
        );
    }
}
