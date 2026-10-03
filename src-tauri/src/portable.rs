//! 绿色版：Windows 上解压即用的 zip。
//!
//! 和安装版的区别只在三处：数据放在 exe 旁边的 `data\`（安装版在
//! `%APPDATA%\ThinkWatch`）、自更新换的是这个文件夹里的文件（不跑安装程序）、
//! twcore 只认同目录那一份。怎么认出自己是绿色版见 [`is_portable`]。
//!
//! **两份数据互不相干。**安装版和绿色版是两套独立的设置，谁也不读谁的；同一时间
//! 只能运行其中一个（见 `single`）。
//!
//! 自更新（按一次之后全自动，不弹 UAC）：更新器下载这一版的 zip、验签，网关停下
//! 之后把文件夹里的两个 exe 各自**先改名成 `<名字>.old`，再写新的** —— Windows 不让
//! 删一个正在运行的 exe，但让改它的名字。改名、写入任何一步失败都把改过的名字改
//! 回来（[`swap_in`]）。留下的 `.old` 在下次启动时删掉（[`prepare`]）。

use std::path::{Path, PathBuf};

/// 绿色版 zip 里的应用本体。和 NSIS 装进安装目录的是同一个名字，也是 Tauri 按
/// `Cargo.toml` 的包名起的那个
pub const APP_EXE: &str = "thinkwatch-lite.exe";

/// 绿色版 zip 里的网关，放在应用本体旁边（见 `gateway::bundled_core`）
pub const CORE_EXE: &str = "twcore.exe";

/// 数据目录在 exe 旁边叫什么
const DATA: &str = "data";

/// WebView2 的数据（缓存、本地存储）放在数据目录下的哪里
const WEBVIEW: &str = "webview";

/// 启动最早的一步：绿色版把数据目录定在 exe 旁边的 `data\`，并确认能写。
///
/// 写不进时弹系统对话框，然后退出进程。不是绿色版什么都不做。
/// **必须在任何线程起来之前调用**：它要改进程的环境变量（`THINKWATCH_HOME`）。
pub fn prepare() {
    if !is_portable() {
        return;
    }
    let Some(dir) = folder() else {
        return;
    };
    let data = data_dir_in(&dir);
    if let Err(e) = writable(&data) {
        tracing::error!("绿色版的数据目录写不进（{}）：{e}", data.display());
        // 设置在写不进的那个目录里，读不到；只能按系统的语言说
        crate::i18n::set(crate::i18n::system());
        crate::dialog::show(
            "ThinkWatch Lite",
            tr!("当前文件夹没有写入权限", "This folder is not writable"),
            tr!(
                "请将 ThinkWatch Lite 解压到可写入的位置后再运行。",
                "Extract ThinkWatch Lite to a writable location and run it again."
            ),
            &[tr!("确定", "OK")],
        );
        std::process::exit(1);
    }
    // **core 是子进程，继承这个变量**：界面和网关看的是同一个目录。从用户环境
    // 带给 core 的那一份变量里不含它（`supervisor::user_env::keep`），不会被盖掉。
    //
    // SAFETY: `run()` 的第一步就是这里，在 Tauri、tokio、任何插件起线程之前；`main`
    // 在这之前只装了日志订阅器，它不起线程。进程里此刻只有主线程，没有别的线程
    // 可能同时读写环境变量。
    unsafe { std::env::set_var("THINKWATCH_HOME", &data) };
    sweep(dir);
}

/// 这一份是不是绿色版：Windows、正式构建、旁边没有卸载程序（见
/// [`crate::update::windows_kind`]）。
///
/// 答案在进程的一生里不会变，问一次记下来。
pub fn is_portable() -> bool {
    #[cfg(windows)]
    {
        static PORTABLE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        *PORTABLE.get_or_init(|| crate::update::kind() == crate::update::Install::Portable)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// 绿色版的 WebView2 数据目录（`data\webview`）。不是绿色版时是 `None`，窗口用框架的默认位置。
///
/// 默认位置是 `%LOCALAPPDATA%\<identifier>\EBWebView`，和安装版共用、而且不在这个
/// 文件夹里 —— 删掉文件夹之后它还留在机器上。
pub fn webview_data_dir() -> Option<PathBuf> {
    if !is_portable() {
        return None;
    }
    Some(data_dir_in(&folder()?).join(WEBVIEW))
}

/// 自更新时更新器在 latest.json 里找的键：`windows-x86_64-portable` 或
/// `windows-aarch64-portable`。
///
/// **不指定的话插件按打包标记找。**zip 里的 exe 就是安装程序里的那一个，标记是
/// NSIS，插件会找到 `windows-<架构>-nsis` 或 `windows-<架构>` —— 那是安装程序。
pub fn updater_target() -> String {
    target_for(std::env::consts::ARCH)
}

fn target_for(arch: &str) -> String {
    format!("windows-{arch}-portable")
}

/// exe 所在的文件夹
fn folder() -> Option<PathBuf> {
    Some(std::env::current_exe().ok()?.parent()?.to_path_buf())
}

fn data_dir_in(folder: &Path) -> PathBuf {
    folder.join(DATA)
}

/// 建出数据目录，再真的写一个文件试试。
///
/// **只看能不能写，别的一概不管。**文件夹在 U 盘、OneDrive 里都照常用。看目录的
/// 权限位答不准（Windows 上是 ACL，继承、拒绝条目、管理员身份都算数），试一次最准。
fn writable(data: &Path) -> std::io::Result<()> {
    // 和安装版的数据目录一样只有本人能读：里面有 API 密钥
    crate::private_dir::create(data)?;
    let probe = data.join(format!(".write-test-{}", std::process::id()));
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&probe)
        .and_then(|mut f| std::io::Write::write_all(&mut f, b"ok"))?;
    std::fs::remove_file(&probe)
}

/// 上次自更新留下的 `.old`（见 [`swap_in`]）。
///
/// 只认自更新改出来的那两个名字，不按 `*.old` 扫：文件夹是用户的，别的
/// `.old` 不是我们放的。
fn leftovers(folder: &Path, exe_name: &std::ffi::OsStr) -> [PathBuf; 2] {
    [
        old_path(&folder.join(exe_name)),
        old_path(&folder.join(CORE_EXE)),
    ]
}

/// 删掉上次自更新留下的 `.old`，**在后台、多试几次**。
///
/// 自更新之后的第一次启动正是旧进程还没退干净的时候：重启是先拉起新进程、旧的
/// 再退出，旧 exe（现在叫 `.old`）在它退出之前删不掉。这里不等它 —— 启动不该为
/// 了删两个文件停下来；这一次没删掉的，下次启动再删，下次自更新改名之前也会先删。
///
/// 这个线程不碰环境变量，起在 `set_var` 之后。
fn sweep(folder: PathBuf) {
    let Some(name) = std::env::current_exe()
        .ok()
        .and_then(|e| e.file_name().map(|n| n.to_owned()))
    else {
        return;
    };
    let files = leftovers(&folder, &name);
    if !files.iter().any(|f| f.exists()) {
        return;
    }
    std::thread::spawn(move || {
        for _ in 0..40 {
            if remove_all(&files) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        tracing::info!("上次更新留下的旧文件这次没删掉，下次启动再删");
    });
}

/// 把这些文件都删掉（本来就不在的算删掉了）。全都不在了返回 `true`
fn remove_all(files: &[PathBuf]) -> bool {
    files.iter().all(|f| match std::fs::remove_file(f) {
        Ok(()) => true,
        Err(e) => e.kind() == std::io::ErrorKind::NotFound,
    })
}

/// `<名字>.old`
fn old_path(file: &Path) -> PathBuf {
    let mut name = file.file_name().unwrap_or_default().to_owned();
    name.push(".old");
    file.with_file_name(name)
}

/// 从更新包里取出来的两个文件。
pub struct Package {
    app: Vec<u8>,
    core: Vec<u8>,
}

/// 拆开更新包（发布页上的 `…-portable.zip`），**只认根目录下的
/// `thinkwatch-lite.exe` 和 `twcore.exe`，恰好这两个**。
///
/// 签名在这之前已经验过了（`Update::download` 验的是下载下来的原始字节，也就是
/// 这个 zip），这里看的是形状：多一个、少一个、放在子目录里，都说明这不是绿色
/// 版的包 —— 写进去之后应用就起不来了，而那时已经没有一个在跑的旧版本能把它
/// 改回来。
pub fn unpack(zip: &[u8]) -> Result<Package, String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip)).map_err(|e| {
        tr!(
            format!("无法打开更新包：{e}"),
            format!("The update package could not be opened: {e}")
        )
    })?;
    let mut names: Vec<&str> = archive.file_names().collect();
    names.sort_unstable();
    let mut want = [APP_EXE, CORE_EXE];
    want.sort_unstable();
    if names != want {
        let list = names.join(", ");
        return Err(tr!(
            format!("更新包中应恰好有 {APP_EXE} 和 {CORE_EXE} 两个文件，实际为：{list}"),
            format!(
                "The update package should hold exactly {APP_EXE} and {CORE_EXE}; it holds: {list}"
            )
        ));
    }
    let mut read = |name: &str| -> Result<Vec<u8>, String> {
        let unreadable = |e: &dyn std::fmt::Display| {
            tr!(
                format!("无法读取更新包中的 {name}：{e}"),
                format!("{name} could not be read from the update package: {e}")
            )
        };
        let mut entry = archive.by_name(name).map_err(|e| unreadable(&e))?;
        if !entry.is_file() {
            return Err(unreadable(&"not a file"));
        }
        let mut bytes = Vec::with_capacity(usize::try_from(entry.size()).unwrap_or(0));
        std::io::Read::read_to_end(&mut entry, &mut bytes).map_err(|e| unreadable(&e))?;
        // 可执行文件以 `MZ` 开头。一个空的、截断的条目在这里就拦下
        if !bytes.starts_with(b"MZ") {
            return Err(tr!(
                format!("更新包中的 {name} 不是可执行文件"),
                format!("{name} in the update package is not an executable")
            ));
        }
        Ok(bytes)
    };
    Ok(Package {
        app: read(APP_EXE)?,
        core: read(CORE_EXE)?,
    })
}

/// 把包里的两个文件换进这个文件夹：应用本体换掉正在运行的这个 exe，网关换掉
/// 旁边的 `twcore.exe`。调用之前网关要已经停下。
///
/// 换的是**正在运行的那个路径**，不管它叫什么：用户给 exe 改过名，重启拉起的
/// 也还是这个名字（`restart` 跑的是进程启动时的路径）。
pub fn install(package: Package) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let core = exe
        .parent()
        .ok_or_else(|| "the executable has no parent folder".to_string())?
        .join(CORE_EXE);
    swap_in(&[(exe, &package.app), (core, &package.core)])
}

/// 一个已经改了名、可能已经写了新内容的文件。回滚时照它改回去
struct Moved {
    target: PathBuf,
    /// 原来的文件改名成了什么。原来就没有这个文件时是 `None`
    old: Option<PathBuf>,
}

/// 把每个文件**先改名成 `<名字>.old`、再在原处写新的**；任何一步失败，就把
/// 已经动过的全部改回来。
///
/// **不直接覆盖**：正在运行的 exe（应用本体自己，以及万一没停下来的网关）在
/// Windows 上删不掉、也写不了，但能改名 —— 改了名的旧文件照常运行到进程退出，
/// 新文件写在它腾出来的名字上，下次启动就是新版本。
///
/// 上次留下的 `.old` 先删掉（那时它已经不在运行了）；删不掉就不往下走。
///
/// 不依赖 `AppHandle`，测试直接调它。
pub fn swap_in(files: &[(PathBuf, &[u8])]) -> Result<(), String> {
    let mut moved: Vec<Moved> = Vec::new();
    for (target, bytes) in files {
        if let Err(e) = swap_one(target, bytes, &mut moved) {
            let e = tr!(
                format!("无法替换 {}：{e}", target.display()),
                format!("{} could not be replaced: {e}", target.display())
            );
            return Err(match roll_back(&moved) {
                Ok(()) => e,
                Err(r) => {
                    tracing::error!("更新没换成，改回原来的文件也失败了：{r}");
                    tr!(
                        format!("{e}；未能还原原来的文件：{r}"),
                        format!("{e}; the previous files could not be restored: {r}")
                    )
                }
            });
        }
    }
    Ok(())
}

fn swap_one(target: &Path, bytes: &[u8], moved: &mut Vec<Moved>) -> std::io::Result<()> {
    let old = old_path(target);
    match std::fs::remove_file(&old) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
        _ => {}
    }
    if target.exists() {
        std::fs::rename(target, &old)?;
        moved.push(Moved {
            target: target.to_path_buf(),
            old: Some(old),
        });
    } else {
        moved.push(Moved {
            target: target.to_path_buf(),
            old: None,
        });
    }
    // `create_new`：原来的已经挪走了，这里要是还有一个，说明有别人在同时写
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)?;
    std::io::Write::write_all(&mut f, bytes)?;
    // 写到盘上再重启：断电之后不该是一个写了一半的 exe
    f.sync_all()
}

/// 倒着把动过的文件改回去：删掉写了（或写了一半）的新文件，把 `.old` 改回原名。
///
/// 一项失败也接着还原别的，报第一个错。
fn roll_back(moved: &[Moved]) -> std::io::Result<()> {
    let mut first = None;
    for m in moved.iter().rev() {
        let restored = match std::fs::remove_file(&m.target) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => match &m.old {
                Some(old) => std::fs::rename(old, &m.target),
                None => Ok(()),
            },
        };
        if let Err(e) = restored {
            first.get_or_insert(e);
        }
    }
    first.map_or(Ok(()), Err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::{Lang, with_lang};

    /// 和 latest.json 里的键一字不差（`scripts/manifest.py` 的 `PLATFORMS`）：
    /// 拼错一个字母，绿色版就永远问不到新版本，而清单看起来完好
    #[test]
    fn the_updater_key_is_the_one_the_manifest_writes() {
        let manifest = include_str!("../../scripts/manifest.py");
        for arch in ["x86_64", "aarch64"] {
            let key = target_for(arch);
            assert!(
                manifest.contains(&format!("\"{key}\"")),
                "manifest.py 里没有 {key}"
            );
        }
        assert_eq!(target_for("x86_64"), "windows-x86_64-portable");
        assert!(updater_target().ends_with("-portable"));
    }

    #[test]
    fn the_data_lives_next_to_the_exe() {
        let folder = Path::new("D:/Tools/ThinkWatch Lite");
        assert_eq!(data_dir_in(folder), folder.join("data"));
        assert_eq!(
            data_dir_in(folder).join(WEBVIEW),
            folder.join("data").join("webview")
        );
    }

    #[test]
    fn a_writable_folder_gets_its_data_directory() {
        let dir = tempfile::tempdir().unwrap();
        let data = data_dir_in(dir.path());
        writable(&data).unwrap();
        assert!(data.is_dir());
        // 试写的文件不留下
        assert_eq!(std::fs::read_dir(&data).unwrap().count(), 0);
        // 已经在了也照样能过
        writable(&data).unwrap();
    }

    /// 只读的文件夹（解压到了 Program Files 之类的地方）
    #[cfg(unix)]
    #[test]
    fn a_read_only_folder_is_refused() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("ro");
        std::fs::create_dir(&folder).unwrap();
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o500)).unwrap();
        let refused = writable(&data_dir_in(&folder));
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o700)).unwrap();
        // root 不受权限位约束，那种环境下这条说明不了什么
        if unsafe { libc::geteuid() } != 0 {
            assert!(refused.is_err());
        }
    }

    #[test]
    fn leftovers_are_the_two_files_the_update_renamed() {
        let folder = Path::new("C:/ThinkWatch");
        assert_eq!(
            leftovers(folder, std::ffi::OsStr::new("thinkwatch-lite.exe")),
            [
                folder.join("thinkwatch-lite.exe.old"),
                folder.join("twcore.exe.old")
            ]
        );
    }

    #[test]
    fn removing_leftovers_counts_missing_files_as_removed() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.exe.old");
        std::fs::write(&a, b"x").unwrap();
        let b = dir.path().join("b.exe.old");
        assert!(remove_all(&[a.clone(), b]));
        assert!(!a.exists());
        // 删不掉的（这里是一个目录）就是没删完
        let c = dir.path().join("c.exe.old");
        std::fs::create_dir(&c).unwrap();
        assert!(!remove_all(&[c]));
    }

    fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        // 发版用 Deflate 压（release.yml），这里也用它：拆包要认得这种压缩
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, bytes) in entries {
            if name.ends_with('/') {
                w.add_directory(*name, opts).unwrap();
            } else {
                w.start_file(*name, opts).unwrap();
                w.write_all(bytes).unwrap();
            }
        }
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn a_portable_package_holds_the_two_executables() {
        let zip = zip_of(&[
            ("thinkwatch-lite.exe", b"MZ app".repeat(1000).as_slice()),
            ("twcore.exe", b"MZ core"),
        ]);
        let p = unpack(&zip).unwrap();
        assert_eq!(p.app, b"MZ app".repeat(1000));
        assert_eq!(p.core, b"MZ core");
    }

    /// 多一个、少一个、放进了子目录、不是 zip、不是可执行文件：都不装
    #[test]
    fn anything_else_is_refused_before_it_is_written() {
        let refused = [
            zip_of(&[("thinkwatch-lite.exe", b"MZ")]),
            zip_of(&[
                ("thinkwatch-lite.exe", b"MZ"),
                ("twcore.exe", b"MZ"),
                ("README.txt", b"hi"),
            ]),
            zip_of(&[
                ("ThinkWatch Lite/thinkwatch-lite.exe", b"MZ"),
                ("ThinkWatch Lite/twcore.exe", b"MZ"),
            ]),
            zip_of(&[
                ("data/", b""),
                ("thinkwatch-lite.exe", b"MZ"),
                ("twcore.exe", b"MZ"),
            ]),
            zip_of(&[("thinkwatch-lite.exe", b"MZ"), ("twcore.exe", b"")]),
            b"MZ not a zip".to_vec(),
        ];
        for (i, zip) in refused.iter().enumerate() {
            assert!(unpack(zip).is_err(), "第 {i} 个不该过");
        }
        with_lang(Lang::En, || {
            let e = unpack(&refused[2]).err().unwrap();
            assert!(
                e.contains("exactly thinkwatch-lite.exe and twcore.exe"),
                "{e}"
            );
            assert!(e.contains("ThinkWatch Lite/twcore.exe"), "{e}");
        });
    }

    /// 一个文件夹：应用本体和网关，内容是 `old`
    fn folder_with_old_copies() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join(APP_EXE);
        let core = dir.path().join(CORE_EXE);
        std::fs::write(&app, b"old app").unwrap();
        std::fs::write(&core, b"old core").unwrap();
        (dir, app, core)
    }

    #[test]
    fn both_files_are_renamed_aside_and_replaced() {
        let (_dir, app, core) = folder_with_old_copies();
        // 上次更新留下的 `.old` 先被删掉，不挡这一次
        std::fs::write(old_path(&core), b"older core").unwrap();

        swap_in(&[(app.clone(), b"new app"), (core.clone(), b"new core")]).unwrap();

        assert_eq!(std::fs::read(&app).unwrap(), b"new app");
        assert_eq!(std::fs::read(&core).unwrap(), b"new core");
        assert_eq!(std::fs::read(old_path(&app)).unwrap(), b"old app");
        assert_eq!(std::fs::read(old_path(&core)).unwrap(), b"old core");
    }

    /// 第二个写不进（目录不在）：第一个已经换好的也改回去，`.old` 不留
    #[test]
    fn a_failure_puts_every_file_back() {
        let (dir, app, core) = folder_with_old_copies();
        let nowhere = dir.path().join("missing").join(CORE_EXE);

        let e = swap_in(&[(app.clone(), b"new app"), (nowhere, b"new core")]);

        assert!(e.is_err());
        assert_eq!(std::fs::read(&app).unwrap(), b"old app");
        assert_eq!(std::fs::read(&core).unwrap(), b"old core");
        assert!(!old_path(&app).exists());
    }

    /// 上次留下的 `.old` 删不掉（这里是一个目录）：不往下走，已经动过的改回去
    #[test]
    fn a_leftover_that_cannot_be_removed_stops_the_swap() {
        let (_dir, app, core) = folder_with_old_copies();
        std::fs::create_dir(old_path(&core)).unwrap();

        assert!(swap_in(&[(app.clone(), b"new app"), (core.clone(), b"new core")]).is_err());

        assert_eq!(std::fs::read(&app).unwrap(), b"old app");
        assert_eq!(std::fs::read(&core).unwrap(), b"old core");
        assert!(!old_path(&app).exists());
    }

    /// 原来没有网关（被用户删了）：照样写进去；失败时把写进去的删掉
    #[test]
    fn a_missing_file_is_written_and_removed_again_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        let core = dir.path().join(CORE_EXE);
        swap_in(&[(core.clone(), b"new core")]).unwrap();
        assert_eq!(std::fs::read(&core).unwrap(), b"new core");
        assert!(!old_path(&core).exists());

        let fresh = dir.path().join("fresh.exe");
        let nowhere = dir.path().join("missing").join("x.exe");
        assert!(swap_in(&[(fresh.clone(), b"x"), (nowhere, b"y")]).is_err());
        assert!(!fresh.exists());
    }

    /// 给下面那条测试当「正在运行的 exe」：设了这个变量就睡半分钟，平时直接过
    #[cfg(windows)]
    #[test]
    fn sleeps_when_asked() {
        if std::env::var_os(SLEEP).is_some() {
            std::thread::sleep(std::time::Duration::from_secs(30));
        }
    }

    #[cfg(windows)]
    const SLEEP: &str = "TW_PORTABLE_TEST_SLEEP";

    /// **这条是整个自更新成立的前提**：Windows 上正在运行的 exe 能改名、腾出来
    /// 的名字上能写新文件、失败时能改回去；进程退出之后 `.old` 删得掉。
    ///
    /// 把这个测试程序自己拷两份当应用本体和网关，只跑上面那条会睡的测试，对着
    /// 它们换、回滚，再停掉进程、清理。
    #[cfg(windows)]
    #[test]
    fn running_executables_are_renamed_aside_and_put_back() {
        let original = std::fs::read(std::env::current_exe().unwrap()).unwrap();

        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join(APP_EXE);
        let core = dir.path().join(CORE_EXE);
        let mut running = Vec::new();
        for exe in [&app, &core] {
            std::fs::write(exe, &original).unwrap();
            running.push(
                std::process::Command::new(exe)
                    .args(["--exact", "portable::tests::sleeps_when_asked"])
                    .env(SLEEP, "1")
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .unwrap(),
            );
        }
        // 等它们真的把映像映射上
        std::thread::sleep(std::time::Duration::from_millis(500));

        // 失败：第二个写不进，正在运行的第一个被改名之后又改了回来
        let nowhere = dir.path().join("missing").join(CORE_EXE);
        assert!(swap_in(&[(app.clone(), b"MZ new app"), (nowhere, b"MZ new core")]).is_err());
        assert_eq!(std::fs::read(&app).unwrap(), original);
        assert!(!old_path(&app).exists());

        // 成功：两个正在运行的都挪开了，新的写在原来的名字上
        swap_in(&[(app.clone(), b"MZ new app"), (core.clone(), b"MZ new core")]).unwrap();
        assert_eq!(std::fs::read(&app).unwrap(), b"MZ new app");
        assert_eq!(std::fs::read(&core).unwrap(), b"MZ new core");
        assert_eq!(std::fs::read(old_path(&app)).unwrap(), original);
        assert_eq!(std::fs::read(old_path(&core)).unwrap(), original);

        // 还在运行的旧进程不受影响
        for p in running.iter_mut() {
            assert!(p.try_wait().unwrap().is_none(), "改名不该让进程退出");
        }
        for mut p in running {
            let _ = p.kill();
            let _ = p.wait();
        }
        // 进程退出之后，下次启动就删得掉
        let gone = leftovers(dir.path(), std::ffi::OsStr::new(APP_EXE));
        let mut removed = false;
        for _ in 0..40 {
            if remove_all(&gone) {
                removed = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        assert!(removed, "进程退出之后 .old 应当删得掉");
    }
}
