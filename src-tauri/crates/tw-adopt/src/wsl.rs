//! WSL 里的客户端：有哪些发行版、默认用户的 home 在哪、此刻能不能接管。
//!
//! **从 Windows 这一侧看进去，尽量不进 WSL 里跑东西。**发行版的清单在注册表里
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
//! WSL 里的客户端写的地址和 Windows 上的一样，是 `127.0.0.1` —— **网关不为 WSL
//! 另外听一张网卡**。够得着它的只有两种：WSL 1（和 Windows 共用网络），以及 WSL 2
//! 的 mirrored 网络。WSL 2 默认的 NAT 下，WSL 里的 127.0.0.1 是它自己，那时不接管，
//! 只说清楚为什么、怎么改成 mirrored（[`decide`]；`.wslconfig` 的读写见
//! [`crate::wslconfig`]）。
//!
//! 注册表、`wsl.exe` 那几段只在 Windows 上；其余是和平台无关的纯函数（passwd、
//! `wsl --version` 的输出、该怎么判断），在任何平台上都跑单测。

use std::path::{Path, PathBuf};

use tw_types::{Msg, msg};

use crate::wslconfig::NetMode;

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

/// WSL 里的一条路径拆成发行版的名字和它在发行版里的写法：
/// `\\wsl.localhost\Ubuntu\home\u\.codex\config.toml` → (`Ubuntu`, `/home/u/.codex/config.toml`)。
pub fn split_wsl_path(p: &Path) -> Option<(String, String)> {
    if !is_wsl_path(p) {
        return None;
    }
    let s = p.to_string_lossy().replace('/', "\\");
    let s = s
        .strip_prefix(r"\\?\UNC\")
        .map(|r| format!(r"\\{r}"))
        .unwrap_or(s);
    // `\\wsl.localhost\` 或 `\\wsl$\` 后面：发行版名，再后面是发行版里的路径
    let rest = s.strip_prefix(r"\\")?;
    let mut parts = rest.split('\\').filter(|x| !x.is_empty());
    parts.next()?;
    let distro = parts.next()?.to_string();
    let linux: Vec<_> = parts.collect();
    if linux.is_empty() {
        return None;
    }
    Some((distro, format!("/{}", linux.join("/"))))
}

/// 在发行版里把一个文件收成 `0600`。**不经 shell**：`wsl.exe --exec` 直接起 `chmod`，
/// 以发行版的默认用户身份（从 Windows 这一侧建的文件，主人就是他）。最多等几秒，
/// 成不成都交回去，由调用方决定要不要告诉用户。
///
/// 为什么要它：从 Windows 经 `\\wsl.localhost` 新建的文件，权限由 WSL 的 9P 服务
/// 按默认规则给（通常别人也能读），Windows 这一侧没有办法在建的时候指定 —— 而这份
/// 文件里正是网关的密钥。在 Linux 上我们新建的这种文件生来就是 `0600`，这里补上同一件事。
#[cfg(windows)]
pub fn make_private(p: &Path) -> bool {
    let Some((distro, linux)) = split_wsl_path(p) else {
        return false;
    };
    run(
        &[
            "--distribution",
            &distro,
            "--exec",
            "chmod",
            "600",
            "--",
            &linux,
        ],
        std::time::Duration::from_secs(10),
    )
    .is_some_and(|r| r.ok)
}

/// `wsl.exe` 跑完一次：退出码是不是 0，和它的输出
#[cfg(windows)]
struct Ran {
    ok: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

/// 起一次 `wsl.exe`，最多等 `limit`。起不来、等超了都是 `None`（超了的那一个杀掉）。
///
/// 不开黑窗口（`CREATE_NO_WINDOW`）；`WSL_UTF8=1` 让 `wsl.exe` 自己的话按 UTF-8 写
/// （不设就是 UTF-16LE），发行版里的程序写什么照原样转过来。输出在另外的线程里读
/// —— 管道写满了子进程就停住，等它退出的循环就永远等不到。
#[cfg(windows)]
fn run(args: &[&str], limit: std::time::Duration) -> Option<Ran> {
    use std::io::Read;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let mut child = Command::new("wsl.exe")
        .args(args)
        .env("WSL_UTF8", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
        .spawn()
        .ok()?;
    fn drain<R: Read + Send + 'static>(pipe: Option<R>) -> std::sync::mpsc::Receiver<Vec<u8>> {
        let (tx, rx) = std::sync::mpsc::channel();
        if let Some(mut pipe) = pipe {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = pipe.read_to_end(&mut buf);
                let _ = tx.send(buf);
            });
        }
        rx
    }
    let out = drain(child.stdout.take());
    let err = drain(child.stderr.take());
    let deadline = Instant::now() + limit;
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    // 进程退了，管道也就关了；万一有谁还攥着它，不为它一直等下去
    let take = |rx: std::sync::mpsc::Receiver<Vec<u8>>| {
        rx.recv_timeout(Duration::from_secs(2)).unwrap_or_default()
    };
    Some(Ran {
        ok: status.success(),
        stdout: take(out),
        stderr: take(err),
    })
}

/// 这台电脑的 Windows 构建号（`22631`）。读注册表里的 `CurrentBuildNumber`，不用
/// `GetVersionEx` —— 应用清单没声明兼容哪些版本时，那个函数报的是 Windows 8。
#[cfg(windows)]
pub fn windows_build() -> Option<u32> {
    use windows_sys::Win32::System::Registry::{HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RegGetValueW};
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let key = wide(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
    let name = wide("CurrentBuildNumber");
    let mut buf = [0u16; 32];
    let mut len = std::mem::size_of_val(&buf) as u32;
    // SAFETY: 两个字符串以 NUL 结尾；缓冲区的字节数如实给出，函数保证写进去的以 NUL 结尾。
    let rc = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            key.as_ptr(),
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
    String::from_utf16_lossy(&buf[..n]).trim().parse().ok()
}

#[cfg(not(windows))]
pub fn windows_build() -> Option<u32> {
    None
}

/// 装着的 WSL 是哪一版：`wsl.exe --version` 的第一行。**问不出来就是 `None`**：
/// 系统自带的旧版 WSL 不认 `--version`，别的原因（服务没起来、超时）也可能 ——
/// 这时不下结论，由调用方在说明里提一句版本要求。
#[cfg(windows)]
pub fn wsl_version() -> Option<Version> {
    let r = run(&["--version"], std::time::Duration::from_secs(10))?;
    if !r.ok {
        return None;
    }
    parse_version(&decode_output(&r.stdout))
}

#[cfg(not(windows))]
pub fn wsl_version() -> Option<Version> {
    None
}

/// WSL 此刻实际用的是不是 mirrored 网络：在一个开着的 WSL 2 发行版里问
/// `wslinfo --networking-mode`（WSL 2.0.4 起有）。
///
/// `.wslconfig` 说的是下一次启动用什么，这里问的是现在：改完没重启、或者 WSL
/// 起来时没能用上 mirrored（它会退回 NAT），两者就不一样。问不出来是 `None`。
#[cfg(windows)]
pub fn running_mirrored(distro: &str) -> Option<bool> {
    let r = run(
        &[
            "--distribution",
            distro,
            "--exec",
            "/usr/bin/wslinfo",
            "--networking-mode",
        ],
        std::time::Duration::from_secs(10),
    )?;
    if !r.ok {
        return None;
    }
    parse_networking_mode(&r.stdout)
}

#[cfg(not(windows))]
pub fn running_mirrored(_distro: &str) -> Option<bool> {
    None
}

/// 停掉所有发行版和 WSL 2 的虚拟机（`wsl --shutdown`），下次启动时照 `.wslconfig`
/// 重新来。失败时交回 `wsl.exe` 说的那句话。
#[cfg(windows)]
pub fn shutdown() -> Result<(), String> {
    match run(&["--shutdown"], std::time::Duration::from_secs(60)) {
        Some(r) if r.ok => Ok(()),
        Some(r) => {
            let said = [decode_output(&r.stderr), decode_output(&r.stdout)]
                .into_iter()
                .map(|s| s.trim().to_string())
                .find(|s| !s.is_empty());
            Err(said.unwrap_or_else(|| "wsl.exe --shutdown failed".to_string()))
        }
        None => Err("wsl.exe --shutdown did not finish".to_string()),
    }
}

#[cfg(not(windows))]
pub fn shutdown() -> Result<(), String> {
    Err("WSL is only on Windows".to_string())
}

/// `wsl.exe` 的输出变成文字。设了 `WSL_UTF8=1` 是 UTF-8；老版本不认那个变量，写的
/// 是 UTF-16LE —— 英文字母的高字节全是 0，一看就分得出来。
pub fn decode_output(b: &[u8]) -> String {
    let b = b.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(b);
    let (b, bom16) = match b.strip_prefix(&[0xFF, 0xFE]) {
        Some(rest) => (rest, true),
        None => (b, false),
    };
    let zeros = b.iter().skip(1).step_by(2).filter(|&&c| c == 0).count();
    if bom16 || (b.len() >= 2 && zeros * 2 >= b.len() / 2) {
        let units: Vec<u16> = b
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes(*c))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(b).into_owned()
    }
}

/// 一个 WSL 的版本号：`2.3.26.0`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version(Vec<u32>);

/// 能用 mirrored 网络、而且认 `[wsl2]` 下 `networkingMode` 的最早一版。
///
/// mirrored 是 2.0.0 加的，那时只写在 `[experimental]` 下；2.0.5 起挪进 `[wsl2]`。
/// 我们写的是 `[wsl2]`，所以按 2.0.5 算。
pub const MIRRORED_SINCE: [u32; 3] = [2, 0, 5];

impl Version {
    /// 不低于 `min`。少写的几段按 0 算：`2.0` 就是 `2.0.0`
    pub fn at_least(&self, min: &[u32]) -> bool {
        let n = self.0.len().max(min.len());
        let at = |v: &[u32], i: usize| v.get(i).copied().unwrap_or(0);
        for i in 0..n {
            let (a, b) = (at(&self.0, i), at(min, i));
            if a != b {
                return a > b;
            }
        }
        true
    }

    pub fn supports_mirrored(&self) -> bool {
        self.at_least(&MIRRORED_SINCE)
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let parts: Vec<String> = self.0.iter().map(u32::to_string).collect();
        f.write_str(&parts.join("."))
    }
}

/// `wsl --version` 的输出里找出 WSL 的版本：**第一行里第一个 `数.数.数`**。
///
/// 那一行的说明文字跟着系统语言走（`WSL version: 2.3.26.0`、`WSL 版本: 2.3.26.0`、
/// `Version WSL : 2.3.26.0`），但每种语言里都是它排第一、说明里没有数字。后面几行
/// 是内核、WSLg 这些的版本，不看。
pub fn parse_version(text: &str) -> Option<Version> {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    let mut run = String::new();
    let mut runs = Vec::new();
    for c in line.chars().chain(std::iter::once(' ')) {
        if c.is_ascii_digit() || c == '.' {
            run.push(c);
        } else if !run.is_empty() {
            runs.push(std::mem::take(&mut run));
        }
    }
    runs.into_iter().find_map(|r| {
        let r = r.trim_matches('.');
        let parts: Vec<u32> = r
            .split('.')
            .map(str::parse)
            .collect::<Result<_, _>>()
            .ok()?;
        (parts.len() >= 3).then_some(Version(parts))
    })
}

/// `wslinfo --networking-mode` 说的是不是 mirrored。它答 `nat`、`mirrored`、
/// `consomme`、`none` 这几个词之一（WSL 1 上答 `wsl1`）；认不出来是 `None`。
pub fn parse_networking_mode(out: &[u8]) -> Option<bool> {
    let word = String::from_utf8_lossy(out).trim().to_ascii_lowercase();
    match word.as_str() {
        "mirrored" => Some(true),
        "nat" | "none" | "bridged" | "consomme" | "virtioproxy" | "wsl1" => Some(false),
        _ => None,
    }
}

/// Windows 11 22H2 的构建号：mirrored 网络从这一版起才有
pub const MIRRORED_BUILD: u32 = 22621;

/// 这个构建号的 Windows 能不能用 mirrored 网络（Windows 10、Windows 11 21H2 不能）
pub fn build_supports_mirrored(build: u32) -> bool {
    build >= MIRRORED_BUILD
}

/// 这台电脑上的 WSL 2 此刻能不能经由 `127.0.0.1` 够到 Windows 上的网关；不能的话，
/// 卡在哪一步 —— 界面照它说明、给对应的按钮。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Wsl2 {
    /// `.wslconfig` 设了 mirrored，WSL 也在用（问不出来时照 `.wslconfig` 算）
    Mirrored,
    /// `.wslconfig` 没设 mirrored（默认的 NAT）。`version`：查到的 WSL 版本（够新），
    /// 查不出来时是 `None` —— 说明里要提一句版本要求
    Nat { version: Option<String> },
    /// `.wslconfig` 设了 mirrored，WSL 还在用改之前的网络：重启之后生效
    Restart,
    /// 在这里重启过 WSL 了，它仍然没用上 mirrored
    Fallback,
    /// Windows 10、Windows 11 21H2：没有 mirrored 网络
    OldWindows,
    /// WSL 太旧，要先 `wsl --update`
    OldWsl { version: String },
}

/// 判断 WSL 2 的网络。
///
/// `running` 和 `version` 要起 `wsl.exe`，**用得着才问**：`.wslconfig` 设了
/// mirrored、WSL 也答 mirrored 的，版本不用再问。`restarted`：在这里重启过 WSL，
/// 而且是在 `.wslconfig` 最后一次改动之后。
pub fn decide(
    build: Option<u32>,
    config: NetMode,
    running: impl FnOnce() -> Option<bool>,
    version: impl FnOnce() -> Option<Version>,
    restarted: bool,
) -> Wsl2 {
    if build.is_some_and(|b| !build_supports_mirrored(b)) {
        return Wsl2::OldWindows;
    }
    let too_old = |v: &Option<Version>| {
        v.as_ref()
            .filter(|v| !v.supports_mirrored())
            .map(|v| Wsl2::OldWsl {
                version: v.to_string(),
            })
    };
    if config == NetMode::Mirrored {
        let now = running();
        if now == Some(true) {
            return Wsl2::Mirrored;
        }
        if let Some(old) = too_old(&version()) {
            return old;
        }
        return match now {
            Some(_) if restarted => Wsl2::Fallback,
            Some(_) => Wsl2::Restart,
            None => Wsl2::Mirrored,
        };
    }
    let v = version();
    if let Some(old) = too_old(&v) {
        return old;
    }
    Wsl2::Nat {
        version: v.map(|v| v.to_string()),
    }
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

/// 这把密钥的主人是不是这个发行版里的这个客户端。
///
/// **按那个客户端自己的 id 重算一遍再比**：[`key_id`] 截到 64 个字符，客户端名
/// 长短不一，发行版名字一长，两个客户端截出来的那一段就不一样了。
pub fn same_distro(client: &str, distro: &str, id: &str) -> bool {
    key_id(client, distro) == id
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
        assert!(same_distro(
            "claude-code",
            "Ubuntu-22.04",
            "claude-code-wsl-ubuntu-22-04"
        ));
        assert!(!same_distro(
            "claude-code",
            "Ubuntu",
            "claude-code-wsl-ubuntu-22-04"
        ));
        // 名字长到被截断：两个客户端截的地方不一样，各自认得出自己的
        let long = "Ubuntu-24.04-with-a-very-long-name-given-by-its-owner";
        for c in CLIENTS {
            assert!(same_distro(c, long, &key_id(c, long)), "{c}");
        }
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
    fn a_wsl_path_splits_into_the_distro_and_its_linux_path() {
        for p in [
            r"\\wsl.localhost\Ubuntu-22.04\home\u\.codex\config.toml",
            r"\\wsl$\Ubuntu-22.04\home\u\.codex\config.toml",
            r"\\?\UNC\wsl.localhost\Ubuntu-22.04\home\u\.codex\config.toml",
        ] {
            assert_eq!(
                split_wsl_path(Path::new(p)),
                Some((
                    "Ubuntu-22.04".to_string(),
                    "/home/u/.codex/config.toml".to_string()
                )),
                "{p}"
            );
        }
        assert_eq!(split_wsl_path(Path::new(r"\\wsl.localhost\Ubuntu")), None);
        assert_eq!(
            split_wsl_path(Path::new(r"C:\Users\u\.codex\config.toml")),
            None
        );
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

    /// 22H2（22621）起才有 mirrored：Windows 10 和 Windows 11 21H2 没有
    #[test]
    fn mirrored_needs_windows_11_22h2() {
        for b in [19041, 19045, 20348, 22000, 22620] {
            assert!(!build_supports_mirrored(b), "{b}");
        }
        for b in [22621, 22631, 26100, 27000] {
            assert!(build_supports_mirrored(b), "{b}");
        }
    }

    /// 说明文字跟着系统语言走，版本号总是第一行里的第一个 `数.数.数`
    #[test]
    fn the_wsl_version_is_the_first_version_on_the_first_line() {
        let v = |s: &str| parse_version(s).map(|v| v.to_string());
        let full = "WSL version: 2.3.26.0\r\nKernel version: 5.15.167.4-1\r\nWSLg version: 1.0.65\r\n\
                    MSRDC version: 1.2.5620\r\nDirect3D version: 1.611.1-81528511\r\n\
                    DXCore version: 10.0.26100.1-240331-1435.ge-release\r\nWindows version: 10.0.26100.2605\r\n";
        assert_eq!(v(full).as_deref(), Some("2.3.26.0"));
        for line in [
            "WSL 版本: 2.3.26.0",
            "WSL 版本： 2.3.26.0",
            "WSL 版本：2.3.26.0",
            "Version WSL : 2.3.26.0",
            "WSL バージョン: 2.3.26.0",
            "Wersja podsystemu WSL: 2.3.26.0",
        ] {
            assert_eq!(v(line).as_deref(), Some("2.3.26.0"), "{line}");
        }
        // 前面有空行、行尾有空白
        assert_eq!(
            v("\r\n  WSL version: 2.0.14.0  \r\n").as_deref(),
            Some("2.0.14.0")
        );
        // 没有版本号的（旧版 WSL 不认 --version，打出来的是用法说明）
        assert_eq!(v("Invalid command line option: --version"), None);
        assert_eq!(v(""), None);
        // 只有两段的不当版本号：WSL 的版本号总有三段以上
        assert_eq!(v("WSL 2 version 1.2"), None);
    }

    #[test]
    fn versions_compare_part_by_part() {
        let v = |s: &str| parse_version(&format!("WSL version: {s}")).unwrap();
        assert!(v("2.0.5.0").supports_mirrored());
        assert!(v("2.0.14.0").supports_mirrored());
        assert!(v("2.3.26.0").supports_mirrored());
        assert!(v("10.0.0").supports_mirrored());
        // 2.0.0 到 2.0.4 只认 [experimental] 下的写法；更早的没有 mirrored
        assert!(!v("2.0.4.0").supports_mirrored());
        assert!(!v("2.0.0").supports_mirrored());
        assert!(!v("1.2.5.0").supports_mirrored());
        assert!(!v("0.67.6.0").supports_mirrored());
        assert!(v("2.0.5").at_least(&[2, 0, 5, 0]));
    }

    /// 设了 `WSL_UTF8=1` 是 UTF-8；老版本不认它，写的是 UTF-16LE
    #[test]
    fn wsl_exe_output_is_read_in_either_encoding() {
        let text = "WSL 版本: 2.3.26.0\r\n内核版本: 5.15\r\n";
        assert_eq!(decode_output(text.as_bytes()), text);
        let le: Vec<u8> = text.encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode_output(&le), text);
        let mut bom = vec![0xFF, 0xFE];
        bom.extend(&le);
        assert_eq!(decode_output(&bom), text);
        assert_eq!(
            parse_version(&decode_output(&le)).unwrap().to_string(),
            "2.3.26.0"
        );
        assert_eq!(decode_output(b""), "");
    }

    #[test]
    fn wslinfo_says_whether_mirrored_is_running() {
        assert_eq!(parse_networking_mode(b"mirrored\n"), Some(true));
        assert_eq!(parse_networking_mode(b"Mirrored"), Some(true));
        for w in ["nat\n", "none", "consomme\n", "virtioproxy", "bridged"] {
            assert_eq!(parse_networking_mode(w.as_bytes()), Some(false), "{w}");
        }
        // 不认得的回答：不下结论
        assert_eq!(parse_networking_mode(b""), None);
        assert_eq!(parse_networking_mode(b"wslinfo: unknown option"), None);
    }

    fn ver(s: &str) -> Option<Version> {
        parse_version(&format!("WSL version: {s}"))
    }

    /// 问了不该问的就失败：用得着才起 wsl.exe
    fn never<T>() -> T {
        panic!("这一步用不着问")
    }

    #[test]
    fn mirrored_in_wslconfig_and_in_use_is_all_it_takes() {
        let s = decide(Some(22631), NetMode::Mirrored, || Some(true), never, false);
        assert_eq!(s, Wsl2::Mirrored);
        // 问不出 WSL 在用什么：照 .wslconfig 算
        let s = decide(
            Some(22631),
            NetMode::Mirrored,
            || None,
            || ver("2.3.26"),
            false,
        );
        assert_eq!(s, Wsl2::Mirrored);
        // 构建号也读不出来：一样照 .wslconfig
        assert_eq!(
            decide(None, NetMode::Mirrored, || None, || None, false),
            Wsl2::Mirrored
        );
    }

    /// NAT（没有 .wslconfig、没写、写了 nat）：不接管；版本查得到就不提，查不到要提一句
    #[test]
    fn nat_is_not_adopted_and_says_whether_the_version_is_known() {
        assert_eq!(
            decide(Some(22631), NetMode::Nat, never, || ver("2.3.26.0"), false),
            Wsl2::Nat {
                version: Some("2.3.26.0".into())
            }
        );
        assert_eq!(
            decide(Some(22631), NetMode::Nat, never, || None, false),
            Wsl2::Nat { version: None }
        );
    }

    #[test]
    fn windows_10_and_11_21h2_have_no_mirrored_networking() {
        for mode in [NetMode::Nat, NetMode::Mirrored] {
            assert_eq!(
                decide(Some(19045), mode, never, never, false),
                Wsl2::OldWindows
            );
            assert_eq!(
                decide(Some(22000), mode, never, never, true),
                Wsl2::OldWindows
            );
        }
    }

    #[test]
    fn an_old_wsl_has_to_be_updated_first() {
        assert_eq!(
            decide(Some(22631), NetMode::Nat, never, || ver("1.2.5.0"), false),
            Wsl2::OldWsl {
                version: "1.2.5.0".into()
            }
        );
        // .wslconfig 写了 mirrored，可 WSL 太旧，重启也没用
        for running in [Some(false), None] {
            assert_eq!(
                decide(
                    Some(22631),
                    NetMode::Mirrored,
                    || running,
                    || ver("2.0.4.0"),
                    true
                ),
                Wsl2::OldWsl {
                    version: "2.0.4.0".into()
                }
            );
        }
    }

    /// .wslconfig 改成了 mirrored、WSL 还在用 NAT：没重启过就是等重启；在这里重启过
    /// 还是 NAT，就是没能启用
    #[test]
    fn mirrored_in_wslconfig_but_not_in_use_waits_for_a_restart() {
        let s = |restarted| {
            decide(
                Some(22631),
                NetMode::Mirrored,
                || Some(false),
                || ver("2.3.26"),
                restarted,
            )
        };
        assert_eq!(s(false), Wsl2::Restart);
        assert_eq!(s(true), Wsl2::Fallback);
        // 版本查不出来也一样
        assert_eq!(
            decide(
                Some(22631),
                NetMode::Mirrored,
                || Some(false),
                || None,
                false
            ),
            Wsl2::Restart
        );
    }
}
