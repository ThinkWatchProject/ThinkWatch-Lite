//! WSL 里的客户端：有哪些发行版、默认用户的 home 在哪、客户端该连哪个地址。
//!
//! **从 Windows 这一侧看进去，不进 WSL 里跑东西。**发行版的清单在注册表里
//! （`HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss`），默认用户的 home 从
//! `\\wsl.localhost\<发行版>\etc\passwd` 按 `DefaultUid` 查。起一个 shell 去问
//! `echo $HOME` 也能拿到，但那要为每个发行版拉起一个进程、等它的登录脚本跑完，
//! 而 passwd 是一次文件读取。
//!
//! 拿到 home 以后，这个 crate 其余的部分照常工作：接管、差异、备份、还原都只认
//! 一个 `home`，传进去的是 UNC 路径（`\\wsl.localhost\Ubuntu\home\u`），它们就
//! 改 WSL 里的那一份。**只有给人看的路径和要人执行的命令换成 Linux 的写法**
//! （[`WslHome::shown`]、[`WslHome::linux_path`]）—— 在 WSL 的终端里，没有人会去
//! 敲一个 `\\wsl.localhost\…`。
//!
//! **访问 `\\wsl.localhost` 会把发行版唤醒。**所以这里只提供「读一个发行版」，
//! 什么时候读由调用方决定：客户端页打开时、用户要动它的时候，不在后台轮询。
//!
//! 除了注册表那一段，这里全是和平台无关的纯函数：passwd 和 `.wslconfig` 的解析、
//! 地址的选择、密钥名。它们在任何平台上都跑单测。

use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};

use tw_types::{Msg, msg};

/// 第一批在 WSL 里支持的客户端。
///
/// 两个都是终端里用的、配置跟着 home 走（`~/.claude`、`~/.codex`），而 WSL 里
/// 最常见的正是这两个。桌面客户端（Zed、Claude Desktop）装在 Windows 那一侧。
pub const CLIENTS: &[&str] = &["claude-code", "codex"];

/// 注册表里的一个发行版。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Distro {
    /// `DistributionName`：`Ubuntu`、`Debian`、`Ubuntu-22.04`
    pub name: String,
    /// `Version`：1 或 2。**WSL1 和 Windows 共用网络栈**，127.0.0.1 就是这台电脑
    pub version: u32,
    /// `DefaultUid`：`wsl` 不带 `-u` 时以谁的身份进去。没写就是 root
    pub uid: u32,
}

/// 读得到的一个发行版：它的默认用户的 home，两种写法。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WslHome {
    pub distro: Distro,
    /// 从 Windows 这一侧进去的根：`\\wsl.localhost\Ubuntu`
    pub root: PathBuf,
    /// 默认用户的 home，从 Windows 这一侧看：`\\wsl.localhost\Ubuntu\home\u`
    pub home: PathBuf,
    /// 同一个 home 在 WSL 里的写法：`/home/u`
    pub linux_home: String,
}

impl WslHome {
    /// 读这个发行版：`root` 下的 `/etc/passwd` 里，`DefaultUid` 那个用户的 home。
    ///
    /// `root` 由调用方给（[`root_of`]），测试传一个临时目录。**读不到就是读不到**，
    /// 交回一句带着原因的话 —— 客户端页在那个发行版下写「无法读取」，不卡住整页。
    pub fn read(distro: Distro, root: PathBuf) -> Result<WslHome, Msg> {
        let passwd = crate::paths::under(&root, "etc/passwd");
        let text = std::fs::read_to_string(&passwd).map_err(|e| {
            msg!(
                "wsl.unreadable", distro = &distro.name, detail = e =>
                "WSL · {distro} could not be read: {detail}"
            )
        })?;
        let linux_home = passwd_home(&text, distro.uid).ok_or_else(|| {
            msg!(
                "wsl.no_user", uid = distro.uid, distro = &distro.name =>
                "/etc/passwd in WSL · {distro} has no user with id {uid}."
            )
        })?;
        let home = crate::paths::under(&root, &linux_home);
        Ok(WslHome {
            distro,
            root,
            home,
            linux_home,
        })
    }

    /// 一条 UNC 路径在 WSL 里的写法：`\\wsl.localhost\Ubuntu\home\u\.bashrc` →
    /// `/home/u/.bashrc`。不在这个发行版里的原样给出。
    pub fn linux_path(&self, p: &Path) -> String {
        match p.strip_prefix(&self.root) {
            Ok(rel) => {
                let parts: Vec<_> = rel
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy().into_owned())
                    .collect();
                format!("/{}", parts.join("/"))
            }
            Err(_) => p.display().to_string(),
        }
    }

    /// 给人看的写法：home 底下的写成 `~/.claude/settings.json`，其余的写 Linux 路径。
    pub fn shown(&self, p: &Path) -> String {
        let linux = self.linux_path(p);
        let home = self.linux_home.trim_end_matches('/');
        match linux.strip_prefix(home) {
            Some(rest) if rest.starts_with('/') && !home.is_empty() => format!("~{rest}"),
            _ => linux,
        }
    }

    /// 这个发行版的管理策略文件：`/etc/claude-code/managed-settings.json`。
    /// Claude Code 在 WSL 里认的是 Linux 的那个位置。
    pub fn managed_settings(&self) -> PathBuf {
        crate::paths::under(&self.root, "etc/claude-code/managed-settings.json")
    }

    /// 界面上这一组的名字里用的那一段，也是密钥名里的那一段（[`key_id`]）
    pub fn name(&self) -> &str {
        &self.distro.name
    }
}

/// 从 Windows 这一侧进入一个发行版的根。
///
/// `\\wsl.localhost\` 是 Windows 11 和 Windows 10 21H2 以后的写法；更早的只认
/// `\\wsl$\`。两个都试，先新的。**这一步已经会唤醒发行版**（问一次路径在不在就够了）。
#[cfg(windows)]
pub fn root_of(name: &str) -> PathBuf {
    let new = PathBuf::from(format!(r"\\wsl.localhost\{name}"));
    if new.exists() {
        return new;
    }
    let old = PathBuf::from(format!(r"\\wsl$\{name}"));
    if old.exists() { old } else { new }
}

/// 这条路径在不在某个 WSL 发行版里：`\\wsl.localhost\…` 或 `\\wsl$\…`。
///
/// 按字符串判断，不问文件系统：写文件的那一步要据此换写法（见 `foreign::replace`），
/// 而那时不该再为一个判断去碰一次网络路径。
pub fn is_wsl_path(p: &Path) -> bool {
    let s = p.to_string_lossy().replace('/', "\\");
    let s = s
        .strip_prefix(r"\\?\UNC\")
        .map(|r| format!(r"\\{r}"))
        .unwrap_or(s);
    let lower = s.to_ascii_lowercase();
    lower.starts_with(r"\\wsl.localhost\") || lower.starts_with(r"\\wsl$\")
}

/// 注册表里登记着的发行版，按注册表里的顺序。
///
/// 每个发行版是 `Lxss` 下一个以 GUID 命名的子键，里面有 `DistributionName`、
/// `Version`、`DefaultUid`。**Docker Desktop 的两个内部发行版不算**：那里面没有
/// 用户，读它们只会把它们白白唤醒。
#[cfg(windows)]
pub fn distros() -> Vec<Distro> {
    use windows_sys::Win32::System::Registry::{
        HKEY, HKEY_CURRENT_USER, KEY_READ, RRF_RT_REG_DWORD, RRF_RT_REG_SZ, RegCloseKey,
        RegEnumKeyExW, RegGetValueW, RegOpenKeyExW,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    fn dword(key: HKEY, sub: &[u16], name: &str) -> Option<u32> {
        let name = wide(name);
        let mut v: u32 = 0;
        let mut len = std::mem::size_of::<u32>() as u32;
        // SAFETY: 两个字符串以 NUL 结尾；缓冲区是一个 u32，长度如实给出。
        let rc = unsafe {
            RegGetValueW(
                key,
                sub.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_DWORD,
                std::ptr::null_mut(),
                (&mut v as *mut u32).cast(),
                &mut len,
            )
        };
        (rc == 0).then_some(v)
    }
    fn string(key: HKEY, sub: &[u16], name: &str) -> Option<String> {
        let name = wide(name);
        let mut buf = [0u16; 512];
        let mut len = std::mem::size_of_val(&buf) as u32;
        // SAFETY: 同上；缓冲区的字节数如实给出，函数保证写进去的以 NUL 结尾。
        let rc = unsafe {
            RegGetValueW(
                key,
                sub.as_ptr(),
                name.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                buf.as_mut_ptr().cast(),
                &mut len,
            )
        };
        if rc != 0 {
            return None;
        }
        let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..n]))
    }

    let path = wide(r"Software\Microsoft\Windows\CurrentVersion\Lxss");
    let mut key: HKEY = std::ptr::null_mut();
    // SAFETY: 路径以 NUL 结尾；成功时 `key` 是一个要关掉的句柄。
    if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, KEY_READ, &mut key) } != 0 {
        return Vec::new();
    }
    let mut out = Vec::new();
    for i in 0.. {
        let mut name = [0u16; 256];
        let mut len = name.len() as u32;
        // SAFETY: 缓冲区的字符数如实给出；其余可选参数都不要。
        let rc = unsafe {
            RegEnumKeyExW(
                key,
                i,
                name.as_mut_ptr(),
                &mut len,
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if rc != 0 {
            break;
        }
        let sub: Vec<u16> = name[..len as usize]
            .iter()
            .copied()
            .chain(std::iter::once(0))
            .collect();
        let Some(dname) = string(key, &sub, "DistributionName") else {
            continue;
        };
        if is_internal(&dname) {
            continue;
        }
        out.push(Distro {
            name: dname,
            version: dword(key, &sub, "Version").unwrap_or(2),
            uid: dword(key, &sub, "DefaultUid").unwrap_or(0),
        });
    }
    // SAFETY: 上面打开的那一个句柄，只关这一次。
    unsafe { RegCloseKey(key) };
    out
}

/// 不是给人用的发行版：Docker Desktop 自己的那两个。
pub fn is_internal(name: &str) -> bool {
    name.starts_with("docker-desktop")
}

/// `/etc/passwd` 里 `uid` 那个用户的 home。
///
/// 一行七段，冒号分隔：`name:x:uid:gid:gecos:home:shell`。注释、空行、段数不对的
/// 行跳过；home 不是绝对路径的不认（那不是一个能拼进 UNC 路径的东西）。
pub fn passwd_home(text: &str, uid: u32) -> Option<String> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| {
            let f: Vec<&str> = l.split(':').collect();
            (f.len() >= 7).then_some(f)
        })
        .find(|f| f[2].parse::<u32>().ok() == Some(uid))
        .map(|f| f[5].to_string())
        .filter(|h| h.starts_with('/'))
}

/// WSL2 用哪种网络。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetMode {
    /// 默认：WSL 在一个 NAT 后面，它的 127.0.0.1 是它自己
    Nat,
    /// `networkingMode=mirrored`：和 Windows 共用网卡，127.0.0.1 连得到 Windows
    Mirrored,
}

impl NetMode {
    pub fn slug(&self) -> &'static str {
        match self {
            NetMode::Nat => "nat",
            NetMode::Mirrored => "mirrored",
        }
    }
}

/// `%USERPROFILE%\.wslconfig` 说的是哪种网络。**文件不在、没写、写了别的，都按
/// NAT 算** —— 那是 WSL 自己的默认值。
///
/// 格式是 INI：`[wsl2]` 下的 `networkingMode`。键名不分大小写（WSL 自己就不分），
/// 值也不分；`#` 和 `;` 开头的是注释，值可以带引号。WSL 2.0.0 的预览版把它放在
/// `[experimental]` 下，那一节也认。
pub fn net_mode(wslconfig: Option<&str>) -> NetMode {
    let Some(text) = wslconfig else {
        return NetMode::Nat;
    };
    let mut section = String::new();
    let mut mode = NetMode::Nat;
    for line in text.lines() {
        let l = line.trim();
        if l.is_empty() || l.starts_with('#') || l.starts_with(';') {
            continue;
        }
        if let Some(s) = l.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            section = s.trim().to_ascii_lowercase();
            continue;
        }
        if section != "wsl2" && section != "experimental" {
            continue;
        }
        let Some((k, v)) = l.split_once('=') else {
            continue;
        };
        if !k.trim().eq_ignore_ascii_case("networkingMode") {
            continue;
        }
        // 行尾注释去掉，引号去掉
        let v = v.split(['#', ';']).next().unwrap_or("").trim();
        let v = v.trim_matches(|c| c == '"' || c == '\'');
        mode = if v.eq_ignore_ascii_case("mirrored") {
            NetMode::Mirrored
        } else {
            NetMode::Nat
        };
    }
    mode
}

/// 这个发行版里的客户端怎么够到 Windows 上的网关。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reach {
    /// 写 127.0.0.1：WSL1，或者 mirrored 模式
    Loopback,
    /// 写 WSL 虚拟网卡在 Windows 这一侧的地址：NAT 模式
    Nic,
}

pub fn reach(version: u32, mode: NetMode) -> Reach {
    if version == 1 || mode == NetMode::Mirrored {
        Reach::Loopback
    } else {
        Reach::Nic
    }
}

/// WSL 的虚拟网卡。Windows 按 FriendlyName 列出，叫 `vEthernet (WSL)`；装了
/// Hyper-V 防火墙的新版本叫 `vEthernet (WSL (Hyper-V firewall))`。两种都认。
pub fn is_wsl_nic(name: &str) -> bool {
    name.starts_with("vEthernet (WSL")
}

/// 从网卡清单里挑出 WSL 的那一张，交回它的名字和 IPv4 地址。
pub fn pick_nic<'a>(
    nics: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> Option<(String, Ipv4Addr)> {
    nics.into_iter()
        .filter(|(n, _)| is_wsl_nic(n))
        .find_map(|(n, a)| a.parse::<Ipv4Addr>().ok().map(|a| (n.to_string(), a)))
}

/// WSL 这一侧客户端的专用密钥归在谁名下：`claude-code-wsl-ubuntu-22-04`。
///
/// **每个客户端一把自己的钥匙，WSL 里的和 Windows 上的也分开**：一台电脑上两份
/// Claude Code，共用一把的话请求记录里分不出是哪一份发的，「使用中」也分不出是
/// 哪一份接上了。core 认的密钥主人只能是小写字母、数字和 `-`，发行版的名字按这个
/// 规矩折一下。
pub fn key_id(client: &str, distro: &str) -> String {
    let mut slug = String::new();
    for c in distro.chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
    }
    let slug = slug.trim_end_matches('-');
    let slug = if slug.is_empty() { "distro" } else { slug };
    let mut id = format!("{client}{WSL_SEP}{slug}");
    // core 的上限是 64
    id.truncate(64);
    id.trim_end_matches('-').to_string()
}

const WSL_SEP: &str = "-wsl-";

/// [`key_id`] 反过来：`claude-code-wsl-ubuntu` → (`claude-code`, `ubuntu`)。
/// 不是 WSL 那一侧的密钥主人就是 `None`。
pub fn split_key_id(id: &str) -> Option<(&str, &str)> {
    let (client, slug) = id.split_once(WSL_SEP)?;
    (CLIENTS.contains(&client) && !slug.is_empty()).then_some((client, slug))
}

/// 这个发行版是不是 [`key_id`] 里那一段说的那个
pub fn same_distro(distro: &str, slug: &str) -> bool {
    split_key_id(&key_id(CLIENTS[0], distro)).is_some_and(|(_, s)| s == slug)
}

/// WSL 的 NAT 常用的网段。**core 默认的放行名单里有它**，安装程序加的防火墙规则
/// 放行的也是它。
pub const NAT_RANGE: (Ipv4Addr, u8) = (Ipv4Addr::new(172, 16, 0, 0), 12);

/// 一个 IPv4 地址在不在 `a.b.c.d/n` 里。写法不对的网段算不在。
pub fn in_cidr(addr: Ipv4Addr, cidr: &str) -> bool {
    let (net, bits) = match cidr.split_once('/') {
        Some((n, b)) => match (n.trim().parse::<Ipv4Addr>(), b.trim().parse::<u8>()) {
            (Ok(n), Ok(b)) if b <= 32 => (n, b),
            _ => return false,
        },
        None => match cidr.trim().parse::<Ipv4Addr>() {
            Ok(n) => (n, 32),
            Err(_) => return false,
        },
    };
    let mask = if bits == 0 {
        0
    } else {
        u32::MAX << (32 - u32::from(bits))
    };
    u32::from(addr) & mask == u32::from(net) & mask
}

/// 放行 WSL 要写的那个网段：WSL 虚拟网卡的地址在 172.16/12 里（绝大多数）就是
/// 它；不在（WSL 挑了 192.168.x 那种）就放行那张网卡所在的 /16。
pub fn remote_range(nic: Ipv4Addr) -> String {
    let (net, bits) = NAT_RANGE;
    if in_cidr(nic, &format!("{net}/{bits}")) {
        format!("{net}/{bits}")
    } else {
        let o = nic.octets();
        format!("{}.{}.0.0/16", o[0], o[1])
    }
}

/// 防火墙规则的名字。安装程序加的、卸载程序删的、界面上查的都是这一条。
pub const FIREWALL_RULE: &str = "ThinkWatch Lite (WSL)";

/// 规则缺失时交给用户的那条命令：在管理员身份的 PowerShell 里执行。
///
/// **和安装程序加的是同一条规则**（`src-tauri/windows/hooks.nsh`）：只放行网关
/// 进程，只放行来自 WSL 网段的 TCP 入站，三种网络位置都生效 —— WSL 的虚拟网卡
/// 被 Windows 归为「公用网络」，只写专用网络的规则对它不起作用。
pub fn firewall_command(program: &Path, remote: &str) -> String {
    format!(
        "New-NetFirewallRule -DisplayName \"{FIREWALL_RULE}\" -Direction Inbound -Action Allow \
         -Protocol TCP -Program \"{}\" -RemoteAddress {remote} -Profile Any",
        program.display()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const PASSWD: &str = "\
root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
# 注释
broken:x:
nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin
u:x:1000:1000:U,,,:/home/u:/bin/bash
odd:x:1001:1001::relative/home:/bin/sh
";

    #[test]
    fn the_default_users_home_is_read_off_passwd() {
        assert_eq!(passwd_home(PASSWD, 1000).as_deref(), Some("/home/u"));
        assert_eq!(passwd_home(PASSWD, 0).as_deref(), Some("/root"));
        // 没有这个用户、home 不是绝对路径、行不完整：都不认
        assert_eq!(passwd_home(PASSWD, 4242), None);
        assert_eq!(passwd_home(PASSWD, 1001), None);
        assert_eq!(passwd_home("", 1000), None);
        // Windows 那边拷过来的文件带 \r
        assert_eq!(
            passwd_home("u:x:1000:1000::/home/u:/bin/bash\r\n", 1000).as_deref(),
            Some("/home/u")
        );
    }

    #[test]
    fn networking_mode_is_nat_unless_it_says_mirrored() {
        assert_eq!(net_mode(None), NetMode::Nat);
        assert_eq!(net_mode(Some("")), NetMode::Nat);
        assert_eq!(
            net_mode(Some("[wsl2]\nmemory=8GB\nnetworkingMode=mirrored\n")),
            NetMode::Mirrored
        );
        // 键名、值、节名都不分大小写；空格、引号、行尾注释
        assert_eq!(
            net_mode(Some("[WSL2]\r\n  NetworkingMode = \"Mirrored\" # 新的\r\n")),
            NetMode::Mirrored
        );
        // 预览版的位置
        assert_eq!(
            net_mode(Some("[experimental]\nnetworkingMode=mirrored")),
            NetMode::Mirrored
        );
        // 注释掉的、写在别的节里的、写了别的值的
        assert_eq!(
            net_mode(Some("[wsl2]\n# networkingMode=mirrored")),
            NetMode::Nat
        );
        assert_eq!(
            net_mode(Some("[boot]\nnetworkingMode=mirrored")),
            NetMode::Nat
        );
        assert_eq!(net_mode(Some("[wsl2]\nnetworkingMode=NAT")), NetMode::Nat);
        // 后写的赢
        assert_eq!(
            net_mode(Some("[wsl2]\nnetworkingMode=mirrored\nnetworkingMode=nat")),
            NetMode::Nat
        );
    }

    #[test]
    fn only_wsl2_in_nat_mode_needs_the_virtual_adapter() {
        assert_eq!(reach(1, NetMode::Nat), Reach::Loopback);
        assert_eq!(reach(1, NetMode::Mirrored), Reach::Loopback);
        assert_eq!(reach(2, NetMode::Mirrored), Reach::Loopback);
        assert_eq!(reach(2, NetMode::Nat), Reach::Nic);
    }

    #[test]
    fn the_wsl_adapter_is_picked_by_name_and_needs_an_ipv4() {
        let nics = [
            ("Ethernet", "192.168.1.20"),
            ("vEthernet (WSL)", "fe80::1"),
            ("vEthernet (WSL (Hyper-V firewall))", "172.27.96.1"),
        ];
        assert_eq!(
            pick_nic(nics),
            Some((
                "vEthernet (WSL (Hyper-V firewall))".to_string(),
                Ipv4Addr::new(172, 27, 96, 1)
            ))
        );
        assert_eq!(pick_nic([("Wi-Fi", "10.0.0.2")]), None);
        assert!(!is_wsl_nic("vEthernet (Default Switch)"));
    }

    #[test]
    fn key_owners_look_like_client_ids_to_core() {
        assert_eq!(key_id("claude-code", "Ubuntu"), "claude-code-wsl-ubuntu");
        assert_eq!(key_id("codex", "Ubuntu-22.04"), "codex-wsl-ubuntu-22-04");
        assert_eq!(key_id("codex", "My  Distro_"), "codex-wsl-my-distro");
        assert_eq!(key_id("codex", "中文"), "codex-wsl-distro");
        let long = key_id("claude-code", &"x".repeat(200));
        assert!(long.len() <= 64, "{long}");
        // core 的规矩：小写字母、数字、`-`
        for id in [
            key_id("claude-code", "Ubuntu-22.04"),
            key_id("codex", "Debian"),
        ] {
            assert!(
                id.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
                "{id}"
            );
        }
        assert_eq!(
            split_key_id("claude-code-wsl-ubuntu"),
            Some(("claude-code", "ubuntu"))
        );
        assert_eq!(split_key_id("claude-code"), None);
        assert_eq!(split_key_id("zed-wsl-ubuntu"), None, "WSL 里只支持两个");
        assert!(same_distro("Ubuntu-22.04", "ubuntu-22-04"));
        assert!(!same_distro("Ubuntu", "ubuntu-22-04"));
    }

    #[test]
    fn wsl_paths_are_told_apart_by_their_prefix() {
        for p in [
            r"\\wsl.localhost\Ubuntu\home\u\.claude\settings.json",
            r"\\WSL$\Ubuntu\home\u",
            r"\\?\UNC\wsl.localhost\Debian\root",
            "//wsl.localhost/Ubuntu/home/u",
        ] {
            assert!(is_wsl_path(Path::new(p)), "{p}");
        }
        for p in [
            r"C:\Users\u\.claude",
            r"\\nas\share\x",
            "/home/u/.claude",
            r"\\wsl.localhostx\a",
        ] {
            assert!(!is_wsl_path(Path::new(p)), "{p}");
        }
    }

    #[test]
    fn the_firewall_range_covers_the_adapter() {
        assert_eq!(remote_range(Ipv4Addr::new(172, 27, 96, 1)), "172.16.0.0/12");
        assert_eq!(
            remote_range(Ipv4Addr::new(192, 168, 50, 1)),
            "192.168.0.0/16"
        );
        assert!(in_cidr(Ipv4Addr::new(172, 31, 255, 1), "172.16.0.0/12"));
        assert!(!in_cidr(Ipv4Addr::new(172, 32, 0, 1), "172.16.0.0/12"));
        assert!(in_cidr(Ipv4Addr::new(10, 1, 2, 3), "0.0.0.0/0"));
        assert!(in_cidr(Ipv4Addr::new(10, 1, 2, 3), "10.1.2.3"));
        assert!(!in_cidr(Ipv4Addr::new(10, 1, 2, 3), "fd00::/8"));
        assert!(!in_cidr(Ipv4Addr::new(10, 1, 2, 3), "10.0.0.0/40"));
        let cmd = firewall_command(
            Path::new(r"C:\Program Files\ThinkWatch Lite\twcore.exe"),
            "172.16.0.0/12",
        );
        assert!(cmd.contains("-RemoteAddress 172.16.0.0/12"), "{cmd}");
        assert!(
            cmd.contains(r#"-Program "C:\Program Files\ThinkWatch Lite\twcore.exe""#),
            "{cmd}"
        );
        assert!(cmd.contains(FIREWALL_RULE));
    }

    /// 一个假的发行版根：`etc/passwd` 和默认用户的 home
    fn fake_root() -> (tempfile::TempDir, WslHome) {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("Ubuntu");
        std::fs::create_dir_all(root.join("etc")).unwrap();
        std::fs::create_dir_all(root.join("home/u")).unwrap();
        std::fs::write(root.join("etc/passwd"), PASSWD).unwrap();
        let h = WslHome::read(
            Distro {
                name: "Ubuntu".into(),
                version: 2,
                uid: 1000,
            },
            root,
        )
        .unwrap();
        (d, h)
    }

    #[test]
    fn a_distro_is_read_through_its_root() {
        let (_d, h) = fake_root();
        assert_eq!(h.linux_home, "/home/u");
        assert_eq!(h.home, crate::paths::under(&h.root, "home/u"));
        let settings = crate::paths::under(&h.home, ".claude/settings.json");
        assert_eq!(h.linux_path(&settings), "/home/u/.claude/settings.json");
        assert_eq!(h.shown(&settings), "~/.claude/settings.json");
        assert_eq!(
            h.shown(&h.managed_settings()),
            "/etc/claude-code/managed-settings.json"
        );
        // 另一个用户叫 /home/uu：不能被当成 ~ 底下
        let other = crate::paths::under(&h.root, "home/uu/x");
        assert_eq!(h.shown(&other), "/home/uu/x");
    }

    #[test]
    fn an_unreadable_distro_says_so_instead_of_failing_the_page() {
        let d = tempfile::tempdir().unwrap();
        let distro = Distro {
            name: "Gone".into(),
            version: 2,
            uid: 1000,
        };
        let e = WslHome::read(distro.clone(), d.path().join("Gone")).unwrap_err();
        assert_eq!(e.code, "wsl.unreadable");
        std::fs::create_dir_all(d.path().join("Root/etc")).unwrap();
        std::fs::write(
            d.path().join("Root/etc/passwd"),
            "root:x:0:0::/root:/bin/sh\n",
        )
        .unwrap();
        let e = WslHome::read(distro, d.path().join("Root")).unwrap_err();
        assert_eq!(e.code, "wsl.no_user");
    }
}
