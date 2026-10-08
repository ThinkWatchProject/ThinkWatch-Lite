//! 往**别人的**配置文件里写字节。
//!
//! 这是全项目唯一会改用户其他软件配置的地方，所以它是一个统一的原语，
//! 不是每个功能各自实现一遍（规则 2）。cc-switch 在三
//! 个互不相关的功能里各写了一次「操作前自动备份」—— 那既说明三类事故
//! 都真实发生过，也说明散落实现最终一定会漏掉第四个地方。
//!
//! 一次写入要过五道：
//!
//! 1. **跟着符号链接走到真身。**直接 rename 会把 dotfile 管理器的软链
//!    换成普通文件（cc-switch #6785）—— 用户下次 `stow` 或 `chezmoi
//!    apply` 时才发现，而那时已经说不清是谁干的。
//! 2. **确认文件还是我们看过的那一份。**用户盯着 diff 想了两分钟，期间
//!    他自己在编辑器里改了 —— 这时候写下去就是覆盖。
//! 3. **语义校验**：调用方给的那个闭包重新解析新内容，和「原值 + 预期
//!    的那几处改动」比。对不上就拒绝落盘、原文件一个字节不动。
//! 4. **全文备份**，然后原子写。
//! 5. **写完再读一遍**，对不上就从备份还原回去。
//!
//! 第三道比事后备份更前置：备份是出事之后的补救，它是不让它出事。

use std::path::{Path, PathBuf};

use thiserror::Error;
use tw_types::{Msg, msg};

/// 往别人的配置文件里写的时候，哪一道没过。
///
/// **英文只写一遍**：`Display` 就是 [`ForeignError::msg`] 的原句，界面拿码去翻。
#[derive(Debug, Error)]
pub enum ForeignError {
    #[error("{}", self.msg())]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("{}", self.msg())]
    Write {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("{}", self.msg())]
    ChangedUnderUs { path: PathBuf },
    /// 里面是解析器的原话，或者「和预期的改动对不上」那一句
    #[error("{}", self.msg())]
    VerifyFailed(String),
    #[error("{}", self.msg())]
    Readback { path: PathBuf },
    #[error("{}", self.msg())]
    LinkLoop { path: PathBuf },
    /// 写到一半停下来，这个文件**没能放回原样**：它停在改过的样子上
    #[error("{}", self.msg())]
    NotRestored {
        path: PathBuf,
        backup: PathBuf,
        source: std::io::Error,
    },
    /// 写到一半停下来，这个我们新建的文件**没能删掉**
    #[error("{}", self.msg())]
    NotRemoved {
        path: PathBuf,
        source: std::io::Error,
    },
}

impl ForeignError {
    /// 给人看的那句话，带码。`Read` / `Write` 的 `detail` 是系统的原话。
    pub fn msg(&self) -> Msg {
        match self {
            ForeignError::Read { path, source } => msg!(
                "adopt.file.read_failed", path = path.display(), detail = source =>
                "{path} could not be read: {detail}"
            ),
            ForeignError::Write { path, source } => msg!(
                "adopt.file.write_failed", path = path.display(), detail = source =>
                "{path} could not be written: {detail}"
            ),
            ForeignError::ChangedUnderUs { path } => msg!(
                "adopt.file.changed", path = path.display() =>
                "{path} changed after it was confirmed, so nothing was written. Look at the \
                 change again"
            ),
            ForeignError::VerifyFailed(d) => msg!(
                "adopt.file.verify_failed", detail = d =>
                "the edited content did not pass its check, so nothing was written ({detail})"
            ),
            ForeignError::Readback { path } => msg!(
                "adopt.file.readback_mismatch", path = path.display() =>
                "what was read back after writing is not what was expected; restored from the \
                 backup: {path}"
            ),
            ForeignError::LinkLoop { path } => msg!(
                "adopt.file.link_loop", path = path.display() =>
                "too many levels of symbolic link: {path}"
            ),
            // **比让它停下来的那个原因更要紧**：文件停在改过的样子上，用户得知道
            // 是哪一个、原来的内容在哪儿
            ForeignError::NotRestored {
                path,
                backup,
                source,
            } => msg!(
                "adopt.file.not_restored", path = path.display(), backup = backup.display(),
                detail = source =>
                "writing stopped part-way, and {path} could not be put back as it was: {detail}. \
                 What it was before is in {backup}"
            ),
            ForeignError::NotRemoved { path, source } => msg!(
                "adopt.file.not_removed", path = path.display(), detail = source =>
                "writing stopped part-way, and {path}, which was created here, could not be \
                 removed again: {detail}"
            ),
        }
    }
}

/// 写完之后的交代。**每一项都要能在 UI 上说出来** —— 用户敢按「接管」
/// 的前提是相信能退回去，那就得让他看见退路在哪儿。
#[derive(Debug, Clone)]
pub struct Applied {
    /// 实际写到的路径（跟完符号链接之后）
    pub real: PathBuf,
    /// 用户点的那个路径
    pub asked: PathBuf,
    pub backup: PathBuf,
    /// 原来没有这个文件，是我们创建的。还原时要连文件一起删。
    pub created: bool,
    /// 不至于失败、但用户该知道的事。
    pub warnings: Vec<Msg>,
}

/// 跟着符号链接走到真身。
///
/// 不用 `canonicalize`：文件还不存在时它直接失败，而「第一次接管、
/// settings.json 还没有」是最常见的情况。
pub fn resolve(path: &Path) -> Result<PathBuf, ForeignError> {
    let mut cur = path.to_path_buf();
    for _ in 0..32 {
        match std::fs::symlink_metadata(&cur) {
            Ok(m) if m.file_type().is_symlink() => {
                let target = std::fs::read_link(&cur).map_err(|source| ForeignError::Read {
                    path: cur.clone(),
                    source,
                })?;
                cur = if target.is_absolute() {
                    target
                } else {
                    cur.parent().unwrap_or(Path::new(".")).join(target)
                };
            }
            _ => return Ok(cur),
        }
    }
    Err(ForeignError::LinkLoop {
        path: path.to_path_buf(),
    })
}

/// `real` 上面、`home` 以下（不含 home）的目录里，最靠近 home 的那个符号链接，
/// 连同 `real` 实际落在哪儿。[`resolve`] 只跟文件本身那一层；整个目录链过去的
/// （GNU stow：`~/.config/opencode -> ~/dotfiles/opencode`）它看不出来。
///
/// **只看 home 以下。**再往上是系统的事（Fedora Silverblue 的 `/home -> var/home`、
/// macOS 的 `/var -> private/var`）：每个文件都会命中，说了等于没说。
fn linked_dir(real: &Path, home: &Path) -> Option<(PathBuf, PathBuf)> {
    let link = real
        .ancestors()
        .skip(1)
        .take_while(|a| *a != home && a.starts_with(home))
        .filter(|a| std::fs::symlink_metadata(a).is_ok_and(|m| m.file_type().is_symlink()))
        .last()?;
    let at = std::fs::canonicalize(link)
        .ok()?
        .join(real.strip_prefix(link).ok()?);
    Some((link.to_path_buf(), at))
}

/// 现在的内容。文件不存在返回 `None` —— 和「内容是空串」是两回事，
/// 还原的时候这个区别决定了是写回空文件还是把文件删掉。
pub fn read(path: &Path) -> Result<Option<String>, ForeignError> {
    match std::fs::read_to_string(resolve(path)?) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(ForeignError::Read {
            path: path.to_path_buf(),
            source,
        }),
    }
}

/// [`read`]，不当成 UTF-8：编码由调用方自己认（`.wslconfig` 可能是 UTF-16）。
pub fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>, ForeignError> {
    match std::fs::read(resolve(path)?) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(ForeignError::Read {
            path: path.to_path_buf(),
            source,
        }),
    }
}

fn mode_of(path: &Path) -> Option<u32> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .ok()
            .map(|m| m.permissions().mode() & 0o7777)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

/// 原子写，**保留原文件的权限位**。
///
/// 不强行改成 0600：那超出了「只改 endpoint 和 key 字段」的边界。权限
/// 太松就报告给用户，让他自己决定 —— 报告是我们的职责，修改是他的权利。
///
/// `keep_mode` 是 `None` 时新文件就是临时文件生来的 `0600`（我们自己的接管记录走这条）。
pub(crate) fn write_atomic(
    real: &Path,
    text: impl AsRef<[u8]>,
    keep_mode: Option<u32>,
) -> Result<(), ForeignError> {
    let text = text.as_ref();
    // WSL 里已经在的文件**写进原文件**，不换一个新的挪过去：从 Windows 这一侧
    // 看不到也设不了 Linux 的权限位，挪过去的新文件拿的是 9P 默认给的权限
    // （通常别人也能读），用户原来的 0600 就没了，还原也回不去。原文件还是那个
    // inode，权限位原样留着。这一步不是原子的 —— 能接受的理由和
    // [`replace_in_wsl`] 最后那条退路一样：全文备份已经落盘，写完还有一次读回核对。
    if crate::wsl::is_wsl_path(real) && real.is_file() {
        return write_in_place(real, text);
    }
    let dir = real.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|source| ForeignError::Write {
        path: dir.to_path_buf(),
        source,
    })?;
    // 临时文件要和目标同一个目录，否则 rename 会跨设备失败 —— 而
    // ~/.claude 挂在别的卷上并不稀奇。
    let tmp = dir.join(format!(
        ".{}.thinkwatch-{}.tmp",
        real.file_name().and_then(|s| s.to_str()).unwrap_or("cfg"),
        std::process::id()
    ));
    // 临时文件**生来就是 0600**：里面已经是换上的网关密钥。写完再放宽成原文件
    // 的权限位（用户自己给的，`chmod` 不受 umask 影响，照原样还回去）。
    //
    // **先落盘再挪过去。**rename 是原子的，可它不管内容写没写到盘上：断电之后可能
    // 是名字已经换过来了，内容却是空的 —— 用户的配置没了，备份也救不了一个我们说
    // 「写好了」的文件。所以临时文件同步完才挪（[`write_private`]），挪完再同步一次
    // 目录，让「换过来了」这件事本身也落盘。
    let _ = std::fs::remove_file(&tmp);
    let written = write_private(&tmp, text, keep_mode)
        .map_err(|source| ForeignError::Write {
            path: tmp.clone(),
            source,
        })
        .and_then(|()| {
            replace(&tmp, real).map_err(|source| ForeignError::Write {
                path: real.to_path_buf(),
                source,
            })
        });
    // 没挪成（目标只读、被别的程序占着）就把临时文件收掉：里面是换上的网关密钥，
    // 而它就躺在用户的配置旁边 —— 那个目录可能正是一个 git 管着的 dotfiles 仓库。
    // 名字带着进程号，不收的话每失败一次就多留一份
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    } else {
        sync_dir(dir);
    }
    written
}

/// 把目录项的改动（刚挪过来的那个名字）同步到盘上。**尽力而为**：有的文件系统
/// 不让同步目录，那时内容已经落盘，差的只是这个名字，不值得为它报错。
fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(d) = std::fs::File::open(dir) {
        let _ = d.sync_all();
    }
    // Windows 上的 `MOVEFILE_WRITE_THROUGH` 已经等挪动落盘了才返回，见 [`replace`]
    #[cfg(not(unix))]
    let _ = dir;
}

#[cfg(windows)]
fn make_private(real: &Path) -> bool {
    crate::wsl::make_private(real)
}

/// 只有 Windows 上才会写到 WSL 里
#[cfg(not(windows))]
fn make_private(_: &Path) -> bool {
    false
}

/// 截断原文件再写，落盘了再返回。**不新建**：文件不在就是出错了。
fn write_in_place(real: &Path, text: impl AsRef<[u8]>) -> Result<(), ForeignError> {
    use std::io::Write;
    let w = |source| ForeignError::Write {
        path: real.to_path_buf(),
        source,
    };
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(real)
        .map_err(w)?;
    f.write_all(text.as_ref()).map_err(w)?;
    f.sync_all().map_err(w)
}

/// 写一个只给自己看的文件，**落盘了再返回**：新建时带着 `0600` 建出来，不是建完
/// 再 `chmod` —— 那中间有一个按 umask 给的 0644 窗口。`mode` 给了就在落盘之前换成
/// 它（照原文件的权限位还回去）。文件已经在的话新建时那个 `0600` 不生效，调用方
/// 要的是新文件（[`write_atomic`] 先删掉了残留的那个）。
fn write_private(path: &Path, bytes: &[u8], mode: Option<u32>) -> std::io::Result<()> {
    use std::io::Write;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    f.write_all(bytes)?;
    #[cfg(unix)]
    if let Some(m) = mode.filter(|m| *m != 0o600) {
        use std::os::unix::fs::PermissionsExt;
        f.set_permissions(std::fs::Permissions::from_mode(m))?;
    }
    #[cfg(not(unix))]
    let _ = mode;
    f.sync_all()
}

/// 把 `tmp` 挪成 `real`，**目标已经存在也照挪**。
///
/// unix 的 `rename(2)` 本来就是这个语义，所以那边直接用。
#[cfg(unix)]
fn replace(tmp: &Path, real: &Path) -> std::io::Result<()> {
    std::fs::rename(tmp, real)
}

/// Windows 上 `rename` **目标存在就失败**（`ERROR_ALREADY_EXISTS`）。
///
/// 而这个函数的每一次调用，目标都是存在的 —— 它重写的是用户已经有的那份
/// 客户端配置。也就是说接管在那个平台上从第一步就走不下去，而且报的是
/// 「文件已存在」，一句在这个语境里毫无意义的话。
///
/// **不是「先删掉再挪」。**那中间有一个窗口，窗口里用户的配置文件不存在；
/// 要是进程恰好在那一刻没了，他丢的是原文件而我们连备份都还没交代清楚。
/// `MoveFileExW` 带 `MOVEFILE_REPLACE_EXISTING` 是同一个卷上的原子替换，
/// 也就是 unix 那条 `rename` 在这里的对应物。
#[cfg(windows)]
fn replace(tmp: &Path, real: &Path) -> std::io::Result<()> {
    use crate::wide;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let (from, to) = (wide(tmp), wide(real));
    let mv = |flags| {
        // SAFETY: 两个参数都是以 NUL 结尾的 UTF-16，函数只读它们。
        if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), flags) } == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        }
    };
    // `WRITE_THROUGH`：这一次挪动落盘了再返回。改的是别人的配置文件，
    // 而「说改完了、断电之后发现没改」比「改失败」难查得多。
    let first = mv(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
    match first {
        Err(_) if crate::wsl::is_wsl_path(real) => replace_in_wsl(tmp, real, mv),
        r => r,
    }
}

/// WSL 里的文件（`\\wsl.localhost\…`）挪不过去时的退路。
///
/// 那些路径由 WSL 的 9P 文件服务器经网络重定向器提供，**不是 NTFS**：
/// `WRITE_THROUGH` 这类只对本地卷有意义的标志，重定向器可能直接拒绝。先去掉它
/// 再挪一次 —— 这仍然是原子替换，WSL 那一侧就是一次 `rename(2)`。
///
/// 还不行，就把内容写进原文件（截断再写），再删掉临时文件。**这一步不是原子的**：
/// 写到一半断电，原文件是半截。它能接受，是因为到这里全文备份已经落盘、写完还有
/// 一次读回核对（对不上就从备份写回去），而不接受的代价是 WSL 里的客户端一个都
/// 接管不了。
#[cfg(windows)]
fn replace_in_wsl(
    tmp: &Path,
    real: &Path,
    mv: impl Fn(u32) -> std::io::Result<()>,
) -> std::io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::MOVEFILE_REPLACE_EXISTING;
    if mv(MOVEFILE_REPLACE_EXISTING).is_ok() {
        return Ok(());
    }
    let bytes = std::fs::read(tmp)?;
    std::fs::write(real, bytes)?;
    let _ = std::fs::remove_file(tmp);
    Ok(())
}

/// 备份目录：`~/.thinkwatch/backups/<毫秒时间戳>-<序号>/`。
///
/// 时间戳在目录名里，所以按名字排序就是时间序 —— 不必读 mtime（备份
/// 工具会把 mtime 全改成同一天）。序号补零到固定宽度，同一毫秒里的
/// 几份也按先后排。
pub fn backup_root() -> PathBuf {
    tw_api::data::dir().join("backups")
}

/// 同一毫秒里最多几份备份。补零宽度跟着它走，超了排序就不对了。
const BACKUP_SEQ_MAX: u32 = 9999;

/// 把来源路径压成**一个**文件名，放进备份目录里。
///
/// 一眼能看出这份备份是谁的：`/Users/x/.claude/settings.json` 变成
/// `Users%x%.claude%settings.json`。
///
/// # 两种分隔符和那个冒号
///
/// 只处理 `/` 的话，Windows 上 `C:\Users\x\c.json` 原样留着反斜杠 —— 而
/// **`Path::join` 碰上一个绝对路径会把前面整个丢掉**，于是「备份目录里的
/// 那个文件」悄悄变回了用户原本那个配置文件。
///
/// 那条路上接着是 `create_new`，它报「文件已存在」——**那一声是它救了一命**：
/// 没有它，备份这一步会拿备份内容去覆盖用户自己的配置，而这个模块存在的
/// 全部理由就是不弄坏别人的文件。
///
/// 冒号也要换掉：`C:` 里那个在 Windows 的文件名中非法。
fn flat_name(real: &Path) -> String {
    real.to_string_lossy()
        .trim_start_matches(['/', '\\'])
        .replace(['/', '\\', ':'], "%")
}

/// 这个文件在 `root` 下的全部备份，旧的在前。每次改它之前都留一份，最旧的那一份
/// 就是第一次改它之前的样子
pub fn backups_of(root: &Path, real: &Path) -> Vec<PathBuf> {
    let flat = flat_name(real);
    let Ok(rd) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = rd
        .flatten()
        .map(|e| e.path().join(&flat))
        .filter(|p| p.is_file())
        .collect();
    // 目录名是 `<毫秒>-<序号>`，补零到同样宽度：按名字排就是按时间排
    out.sort();
    out
}

/// 接管记录（旁文件）里那份全文备份是不是 `root` 这个备份目录里的，也就是：这个客户端
/// 是不是**这一份** ThinkWatch Lite 接管的。
///
/// 安装版和绿色版各有各的数据目录，也就各有各的备份目录；而接管记录写在客户端配置
/// 旁边，两份都看得见。记录里存的是接管那一刻备份的绝对路径（重复接管也指着第一次那份，
/// 见 `plan::apply`），按它认：
///
/// - 在 `root` 下面：这一份接管的；
/// - 不在，但 `root` 下面有同一份（`<毫秒>-<序号>/<压平的路径>`）：也是这一份的，只是数据
///   目录挪过地方 —— 绿色版的整个文件夹可以被挪走。目录名里有毫秒时间戳，两份数据目录
///   撞上同一个名字，得是同一毫秒接管了同一个文件；
/// - 都不是：另一个 ThinkWatch Lite 接管的。它的备份不在这里，还原也该由它来做。
///
/// 记录里没有备份路径的，说不上是谁的，算这一份的：照旧能还原。
///
/// **不分大小写**：Windows 上同一个目录可能写成 `C:\Users` 或 `c:\users`。别的平台上
/// 两个只差大小写的数据目录不会同时存在。
pub fn is_ours(root: &Path, backup: &Path) -> bool {
    if backup.as_os_str().is_empty() {
        return true;
    }
    let parts = |p: &Path| -> Vec<String> {
        p.components()
            .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
            .collect()
    };
    let (r, b) = (parts(root), parts(backup));
    if b.len() > r.len() && b[..r.len()] == r[..] {
        return true;
    }
    match (
        backup.parent().and_then(|d| d.file_name()),
        backup.file_name(),
    ) {
        (Some(dir), Some(file)) => root.join(dir).join(file).is_file(),
        _ => false,
    }
}

fn backup_to(root: &Path, real: &Path, text: impl AsRef<[u8]>) -> Result<PathBuf, ForeignError> {
    backup_at(root, real, text, crate::now_ms())
}

/// 时间戳从外面传进来，测试才能稳定地造出「同一毫秒」。
fn backup_at(
    root: &Path,
    real: &Path,
    text: impl AsRef<[u8]>,
    ms: u64,
) -> Result<PathBuf, ForeignError> {
    // 目录名里带上来源路径的形状，一眼能看出这是谁的备份
    let flat = flat_name(real);
    // **备份只给自己看：目录 0700，文件 0600。**里面是原样的配置文件，也就是
    // 用户自己的 API key 和我们换上的网关密钥；按 umask 建出来的 0755 / 0644 谁都
    // 读得到。建出来就是这个权限，不是建完再收（那中间有一个窗口）；根目录是以前
    // 按默认权限建的，就收一次 —— 进不去根目录，里面那些旧备份也就读不到了
    private_dir(root, true).map_err(|source| ForeignError::Write {
        path: root.to_path_buf(),
        source,
    })?;
    #[cfg(unix)]
    if mode_of(root).is_some_and(|m| m & 0o077 != 0) {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700));
    }
    // **同一毫秒里连着接管两次，第二份备份不能盖掉第一份。**第二次备份
    // 的内容里已经是我们写的密钥了；盖掉之后还原只能找回我们的密钥，
    // 用户自己的那个就再也没有了。所以用 `create_dir`（不是 `_all`）
    // 让文件系统原子地告诉我们目录是不是已经有了，有了就换下一个序号。
    let mut seq = 0;
    let dir = loop {
        let dir = root.join(format!("{ms}-{seq:04}"));
        match private_dir(&dir, false) {
            Ok(()) => break dir,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && seq < BACKUP_SEQ_MAX => {
                seq += 1;
            }
            Err(source) => return Err(ForeignError::Write { path: dir, source }),
        }
    };
    let file = dir.join(flat);
    // 目录是刚建的，按说不会有同名文件；万一有，也宁可失败不覆盖。
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let w = |source| ForeignError::Write {
        path: file.clone(),
        source,
    };
    let mut f = opts.open(&file).map_err(w)?;
    std::io::Write::write_all(&mut f, text.as_ref()).map_err(w)?;
    // 备份是出事之后唯一的退路：配置换上去之前，它得先落盘
    f.sync_all().map_err(w)?;
    sync_dir(&dir);
    Ok(file)
}

/// 建一个只给自己用的目录（unix 上 `0700`）。`all` 连缺的上层一起建，已经在不算错。
fn private_dir(dir: &Path, all: bool) -> std::io::Result<()> {
    let mut b = std::fs::DirBuilder::new();
    b.recursive(all);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(0o700);
    }
    b.create(dir)
}

/// 一次写入的完整请求。
pub struct Change<'a> {
    pub path: &'a Path,
    /// 我们读到的原文。`None` = 那时文件不存在。
    pub before: Option<&'a str>,
    pub after: &'a str,
    /// 这次写入会不会把密钥落到这个文件里。只影响权限警告。
    pub carries_secret: bool,
}

/// [`Change`]，内容是字节：不是 UTF-8 的文件（UTF-16 的 `.wslconfig`）照原来的
/// 编码写回去。五道关一道不少，见 [`apply_bytes`]。
pub struct Bytes<'a> {
    pub path: &'a Path,
    pub before: Option<&'a [u8]>,
    pub after: &'a [u8],
    pub carries_secret: bool,
}

/// 落盘。`verify` 由调用方按格式提供 —— JSON、TOML、YAML 各有各的解析。
pub fn apply(
    ch: &Change<'_>,
    root: &Path,
    verify: impl Fn(&str) -> Result<(), String>,
) -> Result<Applied, ForeignError> {
    apply_bytes(
        &Bytes {
            path: ch.path,
            before: ch.before.map(str::as_bytes),
            after: ch.after.as_bytes(),
            carries_secret: ch.carries_secret,
        },
        root,
        |b| verify(std::str::from_utf8(b).map_err(|e| e.to_string())?),
    )
}

/// 落盘一份字节。[`apply`] 是它的文字版。
pub fn apply_bytes(
    ch: &Bytes<'_>,
    root: &Path,
    verify: impl Fn(&[u8]) -> Result<(), String>,
) -> Result<Applied, ForeignError> {
    apply_bytes_in(ch, root, verify, crate::paths::env_home().as_deref())
}

/// [`apply_bytes`]，home 从外面给（测试传一个临时目录）：找链过去的目录找到它为止。
fn apply_bytes_in(
    ch: &Bytes<'_>,
    root: &Path,
    verify: impl Fn(&[u8]) -> Result<(), String>,
    home: Option<&Path>,
) -> Result<Applied, ForeignError> {
    let real = resolve(ch.path)?;
    let mut warnings = Vec::new();
    if real != ch.path {
        // **说出来。**用户以为自己在改 ~/.claude/settings.json，实际写
        // 的是 ~/dotfiles/claude/settings.json —— 那是个会被 git 提交
        // 的地方，而我们正要往里放一个密钥。
        warnings.push(msg!(
            "adopt.warn.symlink",
            path = ch.path.display(),
            real = real.display()
            => "{path} is a symbolic link; the file actually written is {real}."
        ));
    } else if let Some((dir, at)) = home.and_then(|h| linked_dir(&real, h)) {
        // 文件本身不是链接，它所在的目录是：GNU stow 就是这么摆的
        // （`~/.config/opencode -> ~/dotfiles/opencode`）。写进去的同样是那个
        // 会被提交的仓库，一样要说
        warnings.push(msg!(
            "adopt.warn.symlink_dir",
            path = ch.path.display(),
            dir = dir.display(),
            real = at.display()
            => "{dir} is a symbolic link, so {path} is actually written at {real}."
        ));
    }

    // 二：还是我们看过的那一份吗
    let now = match std::fs::read(&real) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(source) => {
            return Err(ForeignError::Read {
                path: real.clone(),
                source,
            });
        }
    };
    if now.as_deref() != ch.before {
        return Err(ForeignError::ChangedUnderUs { path: real });
    }
    let created = now.is_none();

    // 三：语义校验。**过不了就一个字节都不写。**
    verify(ch.after).map_err(ForeignError::VerifyFailed)?;

    // 四：备份 —— 只备份存在过的文件；本来就没有的，还原靠「删掉」
    let backup = match &now {
        Some(text) => backup_to(root, &real, text)?,
        None => backup_to(root, &real, b"")?,
    };

    let keep = mode_of(&real);
    if ch.carries_secret
        && let Some(m) = keep
        && m & 0o077 != 0
    {
        warnings.push(msg!(
            "adopt.warn.world_readable",
            path = real.display(),
            mode = format!("{m:o}")
            => "{path} is mode {mode}, so other users on this machine can read the key written into it. chmod 600 {path} tightens it."
        ));
    }

    write_atomic(&real, ch.after, keep)?;
    // WSL 里新建的、装着密钥的文件：在发行版里收成 0600（见 `wsl::make_private`）。
    // 收不成**说出来**，不当成失败 —— 配置已经写对了，只是权限要用户自己收
    if created && ch.carries_secret && crate::wsl::is_wsl_path(&real) && !make_private(&real) {
        let path = crate::wsl::split_wsl_path(&real)
            .map(|(_, p)| p)
            .unwrap_or_else(|| real.display().to_string());
        warnings.push(msg!(
            "adopt.warn.wsl_private", path = path
            => "{path} was created from Windows, so other users inside WSL may be able to read the key written into it. Run chmod 600 {path} inside WSL to tighten it."
        ));
    }

    // 五：读回来对一遍。对不上就还原 —— 我们宁可什么都没做成，也不
    // 能留下一个半截的文件。
    let back = std::fs::read(&real).map_err(|source| ForeignError::Read {
        path: real.clone(),
        source,
    })?;
    if back != ch.after {
        // 那一句说的是「已经从备份还原」：**还原不成就不能那么说**
        put_back(&real, now.as_deref(), &backup)?;
        return Err(ForeignError::Readback { path: real });
    }

    Ok(Applied {
        real,
        asked: ch.path.to_path_buf(),
        backup,
        created,
        warnings,
    })
}

/// 把一个刚写过的文件放回写之前的样子：`before` 是 `None`（原来没有这个文件）就
/// 删掉它，否则写回原文，权限位照旧。`backup` 是那份原文的全文备份，放不回去时
/// 告诉用户去哪儿找。
///
/// **放不回去要说出来**，不能当成已经放回去了：调用方接下来说的正是「已经退回去了」，
/// 而那时文件其实停在改过的样子上。已经不在了的新文件算删掉了。
pub(crate) fn put_back(
    real: &Path,
    before: Option<&[u8]>,
    backup: &Path,
) -> Result<(), ForeignError> {
    match before {
        None => match std::fs::remove_file(real) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(ForeignError::NotRemoved {
                path: real.to_path_buf(),
                source: e,
            }),
            _ => Ok(()),
        },
        Some(text) => write_atomic(real, text, mode_of(real)).map_err(|e| match e {
            ForeignError::Write { source, .. } => ForeignError::NotRestored {
                path: real.to_path_buf(),
                backup: backup.to_path_buf(),
                source,
            },
            other => other,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(_: &str) -> Result<(), String> {
        Ok(())
    }

    fn dirs() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("backups");
        (d, root)
    }

    /// **目标已经存在是常态，不是边角情况** —— 这个函数重写的就是用户
    /// 手上那份客户端配置。
    ///
    /// 在 unix 上这个测试看不出任何名堂，`rename` 本来就覆盖。它是给
    /// Windows 立的桩：那里 `rename` 遇到已存在的目标直接失败，于是接管
    /// 在第一步就断了，报的还是一句「文件已存在」。
    /// WSL 里的文件走这一条：写进原文件，权限位原样留着
    #[cfg(unix)]
    #[test]
    fn writing_in_place_keeps_the_mode() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("c.json");
        std::fs::write(&p, "before").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600)).unwrap();
        write_in_place(&p, "after").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "after");
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        // 文件不在就是出错，不替它新建一个
        assert!(write_in_place(&d.path().join("gone.json"), "x").is_err());
    }

    #[test]
    fn writing_over_a_file_that_is_already_there_works() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("c.json");
        std::fs::write(&p, "before").unwrap();
        write_atomic(&p, "after", None).expect("覆盖一个已存在的文件");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "after");
        // 临时文件没留下
        let strays: Vec<_> = std::fs::read_dir(d.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains("thinkwatch-"))
            .collect();
        assert!(strays.is_empty(), "留下了临时文件：{strays:?}");
    }

    /// 挪不过去的时候，装着网关密钥的临时文件不能留在用户的配置旁边
    #[cfg(unix)]
    #[test]
    fn a_failed_replace_leaves_no_temp_file_behind() {
        let d = tempfile::tempdir().unwrap();
        // 目标是个不空的目录：`rename` 一定失败
        let p = d.path().join("c.json");
        std::fs::create_dir(&p).unwrap();
        std::fs::write(p.join("inside"), "x").unwrap();
        assert!(write_atomic(&p, "tw-secret", None).is_err());
        let strays: Vec<_> = std::fs::read_dir(d.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains("thinkwatch-"))
            .collect();
        assert!(strays.is_empty(), "留下了临时文件：{strays:?}");
    }

    /// 建一条指向文件的符号链接。**建不了返回 `false`**：Windows 上这要
    /// 管理员或开了开发者模式，普通账号跑测试会拿到 `ERROR_PRIVILEGE_NOT_HELD`。
    /// 那是机器的限制，不是被测代码的错；CI 的 Windows 机器是管理员，会真跑。
    fn symlink_to_file(real: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        let r = std::os::unix::fs::symlink(real, link);
        #[cfg(windows)]
        let r = std::os::windows::fs::symlink_file(real, link);
        match r {
            Ok(()) => true,
            Err(e) if cfg!(windows) && e.raw_os_error() == Some(1314) => {
                eprintln!("跳过：这台机器上不能建符号链接");
                false
            }
            Err(e) => panic!("建符号链接失败：{e}"),
        }
    }

    /// `resolve` 两个平台是同一段代码（`symlink_metadata` + `read_link` 在
    /// Windows 上一样认符号链接），所以这条测试两边都跑。
    #[test]
    fn a_symlink_is_written_through_to_its_target() {
        // cc-switch #6785：直接 rename 会把 dotfile 管理器的软链换成
        // 普通文件，下次 stow 时才发现。
        let (d, root) = dirs();
        let real = d.path().join("dotfiles/settings.json");
        std::fs::create_dir_all(real.parent().unwrap()).unwrap();
        std::fs::write(&real, "old").unwrap();
        let link = d.path().join("settings.json");
        if !symlink_to_file(&real, &link) {
            return;
        }

        let a = apply(
            &Change {
                path: &link,
                before: Some("old"),
                after: "new",
                carries_secret: false,
            },
            &root,
            ok,
        )
        .unwrap();

        assert_eq!(a.real, real);
        assert!(
            std::fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink(),
            "软链被换成普通文件了"
        );
        assert_eq!(std::fs::read_to_string(&real).unwrap(), "new");
        assert!(
            a.warnings.iter().any(|w| w.text.contains("symbolic link")),
            "{:?}",
            a.warnings
        );
    }

    /// GNU stow 的摆法：文件本身不是链接，它所在的目录是
    /// （`~/.config/opencode -> ../dotfiles/opencode`）。写进去的一样是那个会被提交的
    /// 仓库，一样要说；链接留着，还是链接
    #[cfg(unix)]
    #[test]
    fn a_symlinked_folder_under_home_is_reported_like_a_symlinked_file() {
        let (d, root) = dirs();
        let home = d.path().join("home");
        let repo = home.join("dotfiles").join("opencode");
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::write(repo.join("opencode.json"), "old").unwrap();
        std::fs::create_dir_all(home.join(".config")).unwrap();
        let link = home.join(".config").join("opencode");
        std::os::unix::fs::symlink("../dotfiles/opencode", &link).unwrap();
        let path = link.join("opencode.json");
        let write = |before: &'static [u8], after: &'static [u8], home: &Path| {
            let ch = Bytes {
                path: &path,
                before: Some(before),
                after,
                carries_secret: false,
            };
            apply_bytes_in(&ch, &root, |_| Ok(()), Some(home)).unwrap()
        };

        let a = write(b"old", b"new", &home);
        assert_eq!(
            std::fs::read_to_string(repo.join("opencode.json")).unwrap(),
            "new"
        );
        assert!(std::fs::symlink_metadata(&link).unwrap().is_symlink());
        let w = a
            .warnings
            .iter()
            .find(|w| w.code == "adopt.warn.symlink_dir")
            .unwrap_or_else(|| panic!("没说目录是链接：{:?}", a.warnings));
        assert_eq!(w.arg("dir"), link.display().to_string());
        let at = repo.canonicalize().unwrap().join("opencode.json");
        assert_eq!(w.arg("real"), at.display().to_string());

        // home 自己、home 上面的链接不归我们说（`/home -> var/home` 那种）
        let a = write(b"new", b"newer", &link);
        assert!(a.warnings.is_empty(), "{:?}", a.warnings);
    }

    #[test]
    fn a_file_edited_while_the_user_was_reading_the_diff_is_not_overwritten() {
        let (d, root) = dirs();
        let p = d.path().join("c.json");
        std::fs::write(&p, "他刚刚自己改的").unwrap();
        let e = apply(
            &Change {
                path: &p,
                before: Some("我们两分钟前读到的"),
                after: "新的",
                carries_secret: false,
            },
            &root,
            ok,
        )
        .unwrap_err();
        assert!(matches!(e, ForeignError::ChangedUnderUs { .. }), "{e}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "他刚刚自己改的");
    }

    #[test]
    fn failing_the_semantic_check_leaves_the_original_untouched() {
        // 这道在备份之前 —— 备份是出事之后的补救，它是不让它出事。
        let (d, root) = dirs();
        let p = d.path().join("c.json");
        std::fs::write(&p, "原样").unwrap();
        let e = apply(
            &Change {
                path: &p,
                before: Some("原样"),
                after: "坏的",
                carries_secret: false,
            },
            &root,
            |_| Err("多出来一个字段".into()),
        )
        .unwrap_err();
        assert!(matches!(e, ForeignError::VerifyFailed(_)), "{e}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "原样");
        assert!(!root.exists(), "校验都没过就不该留下备份");
    }

    #[test]
    fn the_backup_holds_what_was_there_before() {
        let (d, root) = dirs();
        let p = d.path().join("c.json");
        std::fs::write(&p, "三个月的设置").unwrap();
        let a = apply(
            &Change {
                path: &p,
                before: Some("三个月的设置"),
                after: "接管之后",
                carries_secret: false,
            },
            &root,
            ok,
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(&a.backup).unwrap(), "三个月的设置");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "接管之后");
        assert!(!a.created);
    }

    /// **压出来的必须是一个文件名，不是一条路径。**
    ///
    /// 这个测试在 macOS 上就能抓到那个 Windows 的 bug：那里的分隔符是反斜杠，
    /// 只换 `/` 的话它们原样留着，而一个还带着分隔符的「文件名」`join` 上去
    /// 就不再落在备份目录里 —— Windows 上更狠，绝对路径会让 `join` 把前面
    /// 整个丢掉，于是那个路径指回了用户自己的配置文件。
    #[test]
    fn a_source_path_is_flattened_into_a_single_name() {
        for p in [
            "/Users/x/.claude/settings.json",
            "C:\\Users\\x\\.claude\\settings.json",
            "\\\\server\\share\\c.json",
        ] {
            let n = flat_name(Path::new(p));
            assert!(!n.contains('/'), "{p} -> {n}");
            assert!(!n.contains('\\'), "{p} -> {n}");
            assert!(!n.contains(':'), "{p} -> {n}");
            assert!(!n.is_empty(), "{p} -> 空");
            assert!(
                !Path::new(&n).is_absolute(),
                "{p} -> {n} 还是绝对路径，join 会把备份目录丢掉"
            );
        }
        // 老样子不变：unix 的路径压出来还是原来那个名字
        assert_eq!(
            flat_name(Path::new("/Users/x/.claude/settings.json")),
            "Users%x%.claude%settings.json"
        );
    }

    #[test]
    fn two_backups_in_the_same_millisecond_do_not_overwrite_each_other() {
        // 连着接管两次时第二份备份里已经是我们的密钥；它要是盖掉第一份，
        // 用户原来的密钥就没了，还原只能还原到我们这儿。
        let (d, root) = dirs();
        let p = d.path().join("c.json");
        let first = backup_at(&root, &p, "sk-用户自己的", 1_700_000_000_000).unwrap();
        let second = backup_at(&root, &p, "tw-我们写的", 1_700_000_000_000).unwrap();

        assert_ne!(first, second);
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "sk-用户自己的");
        assert_eq!(std::fs::read_to_string(&second).unwrap(), "tw-我们写的");

        // 按名字排序仍然是时间序，跨毫秒也是
        let third = backup_at(&root, &p, "后来的", 1_700_000_000_001).unwrap();
        let mut names: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        names.sort();
        let parent = |f: &PathBuf| f.parent().unwrap().to_path_buf();
        assert_eq!(names, vec![parent(&first), parent(&second), parent(&third)]);
    }

    /// 一个文件的全部备份，旧的在前；别的文件的不算
    #[test]
    fn the_backups_of_a_file_are_listed_oldest_first() {
        let (d, root) = dirs();
        let p = d.path().join(".wslconfig");
        let other = d.path().join("c.json");
        assert!(backups_of(&root, &p).is_empty(), "还没有备份目录");
        let second = backup_at(&root, &p, "第二次", 1_700_000_000_002).unwrap();
        let first = backup_at(&root, &p, "第一次", 1_700_000_000_001).unwrap();
        backup_at(&root, &other, "别人的", 1_700_000_000_000).unwrap();
        assert_eq!(backups_of(&root, &p), vec![first, second]);
    }

    /// 接管记录里的备份在哪一份的备份目录里，就是哪一份接管的。安装版和绿色版
    /// 各有一个数据目录，同一台机器上的客户端两边都看得见
    #[test]
    fn a_backup_belongs_to_the_backup_directory_it_is_in() {
        let d = tempfile::tempdir().unwrap();
        let (mine, theirs) = (d.path().join("a/backups"), d.path().join("b/backups"));
        let p = d.path().join("settings.json");
        let b = backup_at(&mine, &p, "原来的", 1_700_000_000_000).unwrap();
        assert!(is_ours(&mine, &b));
        assert!(!is_ours(&theirs, &b), "另一份的备份目录里没有它");
        // 备份文件被删了也还是这一份的：认的是路径
        std::fs::remove_file(&b).unwrap();
        assert!(is_ours(&mine, &b));
        // 记录里没有备份路径：说不上是谁的，照旧当成这一份的
        assert!(is_ours(&theirs, Path::new("")));
    }

    /// 不分大小写：Windows 上同一个目录可能写成 `C:\Users` 或 `c:\users`
    #[test]
    fn the_backup_directory_is_compared_without_case() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("Data/backups");
        let b = d.path().join("data/BACKUPS/1700000000000-0000/x.json");
        assert!(is_ours(&root, &b));
    }

    /// 整个数据目录挪过地方（绿色版的文件夹被挪走）：记录里还是旧路径，而同一份备份
    /// 跟着到了新的目录下 —— 仍是这一份接管的
    #[test]
    fn a_moved_data_directory_still_owns_its_backups() {
        let d = tempfile::tempdir().unwrap();
        let (old, new) = (d.path().join("old/backups"), d.path().join("new/backups"));
        let p = d.path().join("settings.json");
        let b = backup_at(&old, &p, "原来的", 1_700_000_000_000).unwrap();
        std::fs::create_dir_all(d.path().join("new")).unwrap();
        std::fs::rename(&old, &new).unwrap();
        assert!(is_ours(&new, &b), "{}", b.display());
        // 另一份有自己的备份，但不是记录里的这一份
        let other = d.path().join("other/backups");
        backup_at(&other, &p, "别人那次的", 1_700_000_000_001).unwrap();
        assert!(!is_ours(&other, &b));
    }

    /// 备份里是原样的配置：用户自己的 API key、换上的网关密钥。**只给自己看**：
    /// 目录 0700、文件 0600；以前按默认权限建的根目录收一次
    #[cfg(unix)]
    #[test]
    fn backups_are_readable_only_by_their_owner() {
        use std::os::unix::fs::PermissionsExt;
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        let (d, root) = dirs();
        let p = d.path().join("c.json");
        let f = backup_at(&root, &p, "sk-用户自己的", 1_700_000_000_000).unwrap();
        assert_eq!(mode(&root), 0o700);
        assert_eq!(mode(f.parent().unwrap()), 0o700);
        assert_eq!(mode(&f), 0o600);

        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o755)).unwrap();
        backup_at(&root, &p, "tw-我们写的", 1_700_000_000_001).unwrap();
        assert_eq!(mode(&root), 0o700, "旧的根目录没收紧");
    }

    /// 写到一半要退回去、却退不回去：**说出来**（是哪个文件、原文在哪儿），不能当成
    /// 已经退回去了。已经不在了的新文件算删掉了
    #[test]
    fn a_file_that_cannot_be_put_back_is_an_error_not_a_silent_success() {
        let d = tempfile::tempdir().unwrap();
        let backup = d.path().join("backup-of-c.json");
        // 写回原文：它所在的「目录」其实是个普通文件
        let blocker = d.path().join("not-a-folder");
        std::fs::write(&blocker, "x").unwrap();
        let e = put_back(&blocker.join("c.json"), Some(b"old"), &backup).unwrap_err();
        assert!(matches!(e, ForeignError::NotRestored { .. }), "{e}");
        assert_eq!(e.msg().code, "adopt.file.not_restored");
        assert!(e.to_string().contains(&backup.display().to_string()), "{e}");
        // 删掉新建的：那儿其实是个不空的目录
        let dir = d.path().join("c.json");
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("inside"), "x").unwrap();
        let e = put_back(&dir, None, &backup).unwrap_err();
        assert!(matches!(e, ForeignError::NotRemoved { .. }), "{e}");

        assert!(put_back(&d.path().join("gone.json"), None, &backup).is_ok());
        let p = d.path().join("ok.json");
        std::fs::write(&p, "new").unwrap();
        put_back(&p, Some(b"old"), &backup).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "old");
    }

    #[test]
    fn back_to_back_real_backups_all_survive() {
        // 不注入时间戳，走真实时钟：一口气备份很多份，几乎必然撞在同一毫秒。
        let (d, root) = dirs();
        let p = d.path().join("c.json");
        let files: Vec<_> = (0..50)
            .map(|i| backup_to(&root, &p, i.to_string()).unwrap())
            .collect();
        for (i, f) in files.iter().enumerate() {
            assert_eq!(std::fs::read_to_string(f).unwrap(), i.to_string());
        }
    }

    #[test]
    fn creating_a_file_that_was_not_there_is_recorded_as_such() {
        // 「原本没有这个文件」和「原本是空文件」不一样：还原时前者要把
        // 文件删掉，后者要写回一个空文件。
        let (d, root) = dirs();
        let p = d.path().join("nested/c.json");
        let a = apply(
            &Change {
                path: &p,
                before: None,
                after: "{}",
                carries_secret: false,
            },
            &root,
            ok,
        )
        .unwrap();
        assert!(a.created);
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{}");
    }

    // **unix 专有。**Windows 没有 mode 位，「这个文件对别人也可读」那条
    // 判断在那边是 ACL 的事，是另一套。
    #[cfg(unix)]
    #[test]
    fn the_original_permissions_are_kept_and_a_loose_one_is_reported() {
        // 不擅自 chmod：那超出了「只改 endpoint 和 key 字段」的边界。
        // 报告是我们的职责，修改是他的权利。
        use std::io::Write as _;
        use std::os::unix::fs::PermissionsExt;
        let (d, root) = dirs();
        let p = d.path().join("c.json");
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(b"x").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o644)).unwrap();

        let a = apply(
            &Change {
                path: &p,
                before: Some("x"),
                after: "y",
                carries_secret: true,
            },
            &root,
            ok,
        )
        .unwrap();
        let m = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(m, 0o644, "权限被我们改了");
        assert!(
            a.warnings.iter().any(|w| w.text.contains("chmod 600")),
            "{:?}",
            a.warnings
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_tight_file_carrying_a_secret_gets_no_warning() {
        use std::os::unix::fs::PermissionsExt;
        let (d, root) = dirs();
        let p = d.path().join("c.json");
        std::fs::write(&p, "x").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600)).unwrap();
        let a = apply(
            &Change {
                path: &p,
                before: Some("x"),
                after: "y",
                carries_secret: true,
            },
            &root,
            ok,
        )
        .unwrap();
        assert!(a.warnings.is_empty(), "{:?}", a.warnings);
    }

    #[test]
    fn a_symlink_loop_is_refused_instead_of_hanging() {
        let d = tempfile::tempdir().unwrap();
        let a = d.path().join("a");
        let b = d.path().join("b");
        if !(symlink_to_file(&b, &a) && symlink_to_file(&a, &b)) {
            return;
        }
        assert!(matches!(resolve(&a), Err(ForeignError::LinkLoop { .. })));
    }

    #[test]
    fn a_relative_symlink_resolves_against_its_own_directory() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("real")).unwrap();
        let target = d.path().join("real").join("x.json");
        std::fs::write(&target, "t").unwrap();
        let link = d.path().join("x.json");
        // 用本平台的分隔符拼：Windows 上链接里存的就是这一串
        if !symlink_to_file(&Path::new("real").join("x.json"), &link) {
            return;
        }
        assert_eq!(
            std::fs::read_to_string(resolve(&link).unwrap()).unwrap(),
            "t"
        );
    }

    #[test]
    fn a_missing_file_reads_as_none_not_as_empty() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(read(&d.path().join("nope.json")).unwrap(), None);
        std::fs::write(d.path().join("empty.json"), "").unwrap();
        assert_eq!(
            read(&d.path().join("empty.json")).unwrap(),
            Some(String::new())
        );
    }
}
