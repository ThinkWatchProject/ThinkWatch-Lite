//! 谁来做更新。
//!
//! **Homebrew 装的那一份不自己更新。**两套更新机制指向同一个 `.app` 会
//! 打架：brew 把应用移进 `/Applications`，并在 `Caskroom/<cask>/<版本>/`
//! 记下它放进去的是哪一版；应用自己把那个包换掉之后，那条记录指向的版本
//! 已经不在磁盘上了，而下一次 `brew upgrade` 会拿旧的那版盖回来 —— 用户
//! 什么都没做，被降了一级。
//!
//! 所以这里先回答「这一份是怎么装上来的」，再决定更新由谁做。判断放在
//! Rust 而不是界面上：这是一条策略，不该由一个 `if` 写在 JSX 里守着。
//!
//! **Windows 上没有 Homebrew 那一档。**winget 装的和网页下载的是同一个安装
//! 程序，已装版本记在「添加/删除程序」的注册表项里；自己更新时跑的是新版本
//! 的安装程序，它会把那一项一起改掉，所以 winget 之后看到的就是新版本，不会
//! 拿旧的盖回来。
//!
//! **Linux 上只发 AppImage，看打包时写进二进制的那个标记，不按路径猜。**打包器
//! 给 AppImage 打了补丁（`tauri::utils::platform::bundle_type()` 读的就是它），
//! 由更新器插件原地换掉那个文件。没有这个标记的都是开发构建，不自己更新。

use std::path::Path;
#[cfg(target_os = "macos")]
use std::path::PathBuf;

/// cask 的名字，也是 Caskroom 下那个目录的名字。
#[cfg(target_os = "macos")]
const CASK: &str = "thinkwatch-lite";

/// Homebrew 装在哪。
#[cfg(target_os = "macos")]
///
/// 只有这两个。cask 要求标准前缀 —— arm64 上是 `/opt/homebrew`，另一个是
/// Intel 时代的位置；自定义前缀装不了 cask，也就不会出现在这里。
const BREW_PREFIXES: [&str; 2] = ["/opt/homebrew", "/usr/local"];

/// tap 里的 cask 文件。**Homebrew 那一档以它为准，不以 latest.json 为准。**
///
/// 发版的那一刻 latest.json 就有了新版本，而 tap 要等它自己的定时任务把
/// cask 跟上。在那之前告诉 Homebrew 的用户「有新版本，去 brew upgrade」，
/// 他照做之后 brew 只会回一句已经是最新 —— 一个弹窗给出的命令，执行下去
/// 必须真的有用。
pub const CASK_URL: &str = "https://raw.githubusercontent.com/ThinkWatchProject/homebrew-tap/main/Casks/thinkwatch-lite.rb";

/// Homebrew 的用户要执行的那一条。
///
/// **前面必须有 `brew update`。**`brew upgrade` 只在距离上次更新超过
/// `HOMEBREW_AUTO_UPDATE_SECS`（默认 86400，一天）时才自己去拉 tap；在那
/// 之前本地的 tap 还是旧的，它一样会回「已经是最新」。
pub const BREW_UPGRADE: &str = "brew update && brew upgrade --cask thinkwatch-lite";

/// 这一份是怎么装上来的。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Install {
    /// Homebrew 的 cask 装的。更新走 `brew upgrade`。
    Homebrew,
    /// 手工下载解压的 `.app`（Windows 上是安装程序装的，Linux 上是 AppImage）。
    /// 这一种可以自己更新。
    Standalone,
    /// 根本不在一个 `.app` 里 —— `tauri dev`。
    Dev,
}

impl Install {
    /// 这一份能不能自己把自己换掉。
    pub fn can_self_update(self) -> bool {
        self == Install::Standalone
    }
}

/// 自己所在的 `.app`。不在一个 `.app` 里就是 `None`。
#[cfg(target_os = "macos")]
///
/// 只认 `…/Foo.app/Contents/MacOS/可执行文件` 这一种形状。**不往上找到
/// 第一个 `.app` 为止** —— 那样一个放在 `/Applications/别的.app/` 里的
/// 开发构建会被认成那个应用。
fn bundle_of(exe: &Path) -> Option<&Path> {
    let macos = exe.parent()?;
    if macos.file_name()? != "MacOS" {
        return None;
    }
    let contents = macos.parent()?;
    if contents.file_name()? != "Contents" {
        return None;
    }
    let bundle = contents.parent()?;
    bundle
        .extension()
        .is_some_and(|e| e == "app")
        .then_some(bundle)
}

/// 这个 `.app` 是不是 Homebrew 放的。
#[cfg(target_os = "macos")]
///
/// **比对的是 Caskroom 里那个符号链接。**brew 把 app 移进 `/Applications`，
/// 再在 `Caskroom/<cask>/<版本>/` 留一个链接指回去；每次升级都会重写它，
/// 所以这个判断不会因为版本变了而过期。
///
/// **不去 exec `brew`。**Finder 拉起来的进程 PATH 里没有它；而且为了回答
/// 一个布尔值去跑一个 Ruby 程序，代价和失败面都不对。
fn from_homebrew(bundle: &Path, roots: &[PathBuf]) -> bool {
    // 两边都解引用之后再比。`/Applications` 本身可能是链接，Caskroom 里
    // 那一项一定是链接 —— 比路径字符串会两边都判错。
    let Ok(me) = bundle.canonicalize() else {
        return false;
    };
    roots.iter().any(|root| {
        let Ok(versions) = std::fs::read_dir(root.join("Caskroom").join(CASK)) else {
            return false;
        };
        versions.flatten().any(|v| {
            std::fs::read_dir(v.path()).is_ok_and(|apps| {
                apps.flatten()
                    .any(|a| a.path().canonicalize().is_ok_and(|p| p == me))
            })
        })
    })
}

/// 给定可执行文件和 brew 的前缀，判断这是哪一种安装。
#[cfg(target_os = "macos")]
pub fn kind_at(exe: &Path, roots: &[PathBuf]) -> Install {
    match bundle_of(exe) {
        None => Install::Dev,
        Some(b) if from_homebrew(b, roots) => Install::Homebrew,
        Some(_) => Install::Standalone,
    }
}

/// 安装程序装的，还是一个开发构建。
///
/// **看安装程序留下的卸载程序在不在旁边。**装好的那一份在安装目录里，
/// 旁边一定有 `uninstall.exe`（Tauri 的 NSIS 模板写的就是这个名字）；
/// `tauri dev` 和 `cargo build` 出来的在 `target\` 里，旁边没有。
///
/// 不看路径在不在 `Program Files` 下：用户可以把它装到任何地方，而一个
/// 放在 `Program Files` 里的开发构建也不该去替换自己。
// 判断本身和平台无关，所以在哪都测；只有 Windows 上真的拿它来用
#[cfg_attr(not(windows), allow(dead_code))]
pub fn nsis_installed(exe: &Path) -> Install {
    match exe.parent() {
        Some(dir) if dir.join("uninstall.exe").is_file() => Install::Standalone,
        _ => Install::Dev,
    }
}

/// Linux 上这一份是怎么装上来的。
///
/// **AppImage 还要看 `APPIMAGE` 在不在。**同一个打过补丁的二进制，用户用
/// `--appimage-extract` 解开之后直接跑，标记照样是 AppImage，而这时根本没有
/// 一个可以原地替换的 AppImage 文件 —— 插件会去替换正在跑的那个可执行文件。
/// 运行时（AppImage 的 runtime）挂载时才设这个变量。
///
/// deb、rpm 都不发，自己打出来的也不自己更新。
#[cfg(target_os = "linux")]
pub fn linux_kind(
    bundle: Option<tauri::utils::config::BundleType>,
    appimage: Option<&std::ffi::OsStr>,
) -> Install {
    use tauri::utils::config::BundleType;
    match bundle {
        Some(BundleType::AppImage) if appimage.is_some_and(|p| !p.is_empty()) => {
            Install::Standalone
        }
        _ => Install::Dev,
    }
}

/// 不是自己的、要在启动时清掉的 AppImage 环境变量。
///
/// AppImage 的运行时挂载时设 `APPIMAGE`、`APPDIR`，而环境变量会一路继承：
/// 从一个 AppImage 里的终端、启动器拉起来的开发构建，手里拿着的是**别人的**
/// 这两个值。Tauri 却照单全收（`Env::default` 读这两个，只打一条警告）：
/// `restart()` 重启的是 `$APPIMAGE` 指的那个文件，`resource_dir()` 在自己的
/// 资源目录不在时改看 `$APPDIR` —— 更新完重启，起来的就可能是另一个程序。
/// 子进程（twcore）也会继承它们。
///
/// 只有打包标记说自己是 AppImage 时，这两个值才是运行时给自己设的。
#[cfg(target_os = "linux")]
pub fn foreign_appimage_vars(
    bundle: Option<tauri::utils::config::BundleType>,
) -> &'static [&'static str] {
    if bundle == Some(tauri::utils::config::BundleType::AppImage) {
        &[]
    } else {
        &["APPIMAGE", "APPDIR"]
    }
}

/// 这一份是怎么装上来的。
pub fn kind() -> Install {
    // Linux 上不看路径：答案在打包时已经写进二进制里了（见 `linux_kind`）
    #[cfg(target_os = "linux")]
    {
        linux_kind(
            tauri::utils::platform::bundle_type(),
            std::env::var_os("APPIMAGE").as_deref(),
        )
    }
    #[cfg(not(target_os = "linux"))]
    {
        // 连自己在哪都答不上来时当作 `Dev` —— 那一档不自己更新。**不确定的
        // 时候不要动用户装好的那一份。**
        let Ok(exe) = std::env::current_exe() else {
            return Install::Dev;
        };
        #[cfg(windows)]
        {
            nsis_installed(&exe)
        }
        #[cfg(target_os = "macos")]
        {
            kind_at(&exe, &BREW_PREFIXES.map(PathBuf::from))
        }
    }
}

/// 发布页。自动更新装不上时，从这里手动下载新版本。
#[cfg(target_os = "linux")]
const RELEASES_URL: &str = "https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest";

/// 插件替换 AppImage 失败时的那一句。
///
/// 替换的做法是把原文件改名挪走、在原处写新的，所以 AppImage 所在的目录必须
/// 可写，而且插件要在同一个文件系统上找到一个临时目录。放在 `/opt` 这类
/// 只有 root 能写的地方时，两个条件都不满足 —— 这不是重试能解决的，说清楚
/// 去哪下载。
#[cfg(target_os = "linux")]
pub fn appimage_failure(e: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error;
    let location = match e {
        Error::TempDirNotOnSameMountPoint => true,
        Error::Io(io) => matches!(
            io.kind(),
            std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::ReadOnlyFilesystem
        ),
        _ => false,
    };
    if location {
        tr!(
            format!("无法写入 AppImage 所在的位置，更新未安装。新版本可从 {RELEASES_URL} 下载。"),
            format!(
                "The location of the AppImage is not writable, so the update was not installed. The new version can be downloaded from {RELEASES_URL}."
            )
        )
    } else {
        tr!(
            format!("安装失败：{e}"),
            format!("Installation failed: {e}")
        )
    }
}

/// 从 cask 文件里读出版本号。
///
/// 只认 `version "x"` 这一种写法。`version :latest` 之类不带具体版本的
/// 写法读出来是 `None` —— 那种 cask 没法比新旧，也就不该弹窗。
pub fn cask_version(text: &str) -> Option<&str> {
    text.lines().find_map(|l| {
        let rest = l.trim_start().strip_prefix("version \"")?;
        rest.split('"').next().filter(|v| !v.is_empty())
    })
}

/// `candidate` 比 `current` 新吗。
///
/// **按语义化版本比，不按字符串比** —— 按字符串，2026.9.10 比 2026.9.9 旧。
/// 任何一边解析不了都算「不新」：拿不准的时候不弹窗。
pub fn newer(candidate: &str, current: &str) -> bool {
    match (
        semver::Version::parse(candidate),
        semver::Version::parse(current),
    ) {
        (Ok(a), Ok(b)) => a > b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 只有上面那两个 macOS 专有的测试用它 —— 跟着它们一起分平台，
    /// 否则在别处是一段没人调的死代码。
    #[cfg(target_os = "macos")]
    fn tmp() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "tw-update-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn only_the_one_shape_counts_as_a_bundle() {
        assert_eq!(
            bundle_of(Path::new("/Applications/Foo.app/Contents/MacOS/foo")),
            Some(Path::new("/Applications/Foo.app"))
        );
        // `cargo run` 出来的那个，不在任何包里
        assert_eq!(bundle_of(Path::new("/x/target/release/foo")), None);
        // **形状对不上就不认。**往上找到第一个 `.app` 为止的写法，会把一个
        // 放在别人包里的开发构建认成那个应用。
        assert_eq!(
            bundle_of(Path::new("/Applications/Foo.app/Contents/Helpers/foo")),
            None
        );
        assert_eq!(
            bundle_of(Path::new("/Applications/Foo/Contents/MacOS/foo")),
            None
        );
    }

    /// 这条是这个模块存在的理由：认错了就会去替换一个 brew 管着的 `.app`。
    /// **只在 macOS 上跑**：符号链接、`.app` 布局、Homebrew 的 Caskroom
    /// 都是那个平台的东西。Windows 上不用分 winget：它装的和网页下载的是同一个
    /// 安装程序，认的是旁边的卸载程序（`nsis_installed`，测试在下面）。
    #[cfg(target_os = "macos")]
    #[test]
    fn a_caskroom_link_pointing_here_means_homebrew_put_it_here() {
        let root = tmp();
        let apps = root.join("Applications");
        let bundle = apps.join("ThinkWatch Lite.app");
        std::fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
        let exe = bundle.join("Contents/MacOS/thinkwatch-lite");
        std::fs::write(&exe, b"").unwrap();

        let prefix = root.join("opt/homebrew");
        let versioned = prefix.join("Caskroom").join(CASK).join("2026.9.0");
        std::fs::create_dir_all(&versioned).unwrap();

        // 还没有那条链接 —— 这时候它是手工装的
        assert_eq!(
            kind_at(&exe, std::slice::from_ref(&prefix)),
            Install::Standalone
        );
        assert!(kind_at(&exe, std::slice::from_ref(&prefix)).can_self_update());

        std::os::unix::fs::symlink(&bundle, versioned.join("ThinkWatch Lite.app")).unwrap();
        assert_eq!(
            kind_at(&exe, std::slice::from_ref(&prefix)),
            Install::Homebrew
        );
        assert!(!kind_at(&exe, std::slice::from_ref(&prefix)).can_self_update());

        std::fs::remove_dir_all(&root).unwrap();
    }

    /// 别人的 cask 里有个同名链接，指向的却是另一个包 —— 不算。
    #[cfg(target_os = "macos")]
    #[test]
    fn a_link_to_a_different_bundle_does_not_count() {
        let root = tmp();
        let mine = root.join("Applications/ThinkWatch Lite.app");
        std::fs::create_dir_all(mine.join("Contents/MacOS")).unwrap();
        let exe = mine.join("Contents/MacOS/thinkwatch-lite");
        std::fs::write(&exe, b"").unwrap();

        let other = root.join("elsewhere/ThinkWatch Lite.app");
        std::fs::create_dir_all(&other).unwrap();

        let prefix = root.join("opt/homebrew");
        let versioned = prefix.join("Caskroom").join(CASK).join("2026.9.0");
        std::fs::create_dir_all(&versioned).unwrap();
        std::os::unix::fs::symlink(&other, versioned.join("ThinkWatch Lite.app")).unwrap();

        assert_eq!(
            kind_at(&exe, std::slice::from_ref(&prefix)),
            Install::Standalone
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// 装好的那一份旁边有卸载程序，开发构建旁边没有。
    #[test]
    fn an_installed_copy_sits_next_to_its_uninstaller() {
        let root = std::env::temp_dir().join(format!(
            "tw-nsis-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join("ThinkWatch Lite");
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("thinkwatch-lite.exe");
        std::fs::write(&exe, b"").unwrap();

        assert_eq!(nsis_installed(&exe), Install::Dev);
        std::fs::write(dir.join("uninstall.exe"), b"").unwrap();
        assert_eq!(nsis_installed(&exe), Install::Standalone);
        assert!(nsis_installed(&exe).can_self_update());
        // 同名的目录不算：要的是安装程序写下的那个文件
        let other = root.join("dev");
        std::fs::create_dir_all(other.join("uninstall.exe")).unwrap();
        assert_eq!(nsis_installed(&other.join("x.exe")), Install::Dev);

        std::fs::remove_dir_all(&root).unwrap();
    }

    /// Linux 上信打包时写进去的标记，不信路径和环境变量。
    #[cfg(target_os = "linux")]
    #[test]
    fn linux_trusts_the_bundle_marker() {
        use tauri::utils::config::BundleType;
        let image = std::ffi::OsStr::new("/home/u/Apps/ThinkWatch-Lite.AppImage");
        assert_eq!(
            linux_kind(Some(BundleType::AppImage), Some(image)),
            Install::Standalone
        );
        // `--appimage-extract` 解开之后直接跑：没有一个可以原地替换的文件
        assert_eq!(linux_kind(Some(BundleType::AppImage), None), Install::Dev);
        assert_eq!(
            linux_kind(Some(BundleType::AppImage), Some(std::ffi::OsStr::new(""))),
            Install::Dev
        );
        // 不发 deb、rpm；自己打出来的也不自己更新
        assert_eq!(linux_kind(Some(BundleType::Deb), None), Install::Dev);
        assert_eq!(linux_kind(Some(BundleType::Rpm), None), Install::Dev);
        // `cargo run` 的构建没有标记。环境里有个 APPIMAGE 也不算
        assert_eq!(linux_kind(None, Some(image)), Install::Dev);
    }

    /// 只有 AppImage 留着这两个变量；别的构建一律清掉，restart 不会跑去
    /// 一个继承来的 `$APPIMAGE`。
    #[cfg(target_os = "linux")]
    #[test]
    fn only_an_appimage_keeps_the_appimage_variables() {
        use tauri::utils::config::BundleType;
        assert!(foreign_appimage_vars(Some(BundleType::AppImage)).is_empty());
        for bundle in [Some(BundleType::Deb), Some(BundleType::Rpm), None] {
            assert_eq!(foreign_appimage_vars(bundle), ["APPIMAGE", "APPDIR"]);
        }
    }

    /// 放在只有 root 能写的目录里，是「换个地方」的问题，不是「再试一次」。
    #[cfg(target_os = "linux")]
    #[test]
    fn an_unwritable_appimage_location_says_where_to_download() {
        use tauri_plugin_updater::Error;
        let denied = Error::Io(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        assert!(appimage_failure(&denied).contains(RELEASES_URL));
        assert!(appimage_failure(&Error::TempDirNotOnSameMountPoint).contains(RELEASES_URL));
        assert!(!appimage_failure(&Error::BinaryNotFoundInArchive).contains(RELEASES_URL));
    }

    /// 读的是 tap 里真实的那份 cask —— 格式变了，这条先红。
    #[test]
    fn the_version_comes_out_of_a_real_cask() {
        let cask = r#"cask "thinkwatch-lite" do
  version "2026.9.2"
  sha256 "bccc9014b1b1df1fb4e33fa5534f1ccb7c431ac41a1b415aa932090c4dfd0cf4"

  url "https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/download/v#{version}/ThinkWatch-Lite-#{version}-arm64.dmg"
end
"#;
        assert_eq!(cask_version(cask), Some("2026.9.2"));
        assert_eq!(
            cask_version("cask \"x\" do\n  version :latest\nend\n"),
            None
        );
        assert_eq!(cask_version(""), None);
    }

    #[test]
    fn versions_compare_as_numbers_not_as_text() {
        assert!(newer("2026.9.10", "2026.9.9"), "按字符串比会判反");
        assert!(newer("2026.10.0", "2026.9.9"));
        assert!(!newer("2026.9.2", "2026.9.2"));
        assert!(!newer("2026.9.1", "2026.9.2"));
        // 拿不准就当不新 —— 不为一个读不懂的版本号弹窗
        assert!(!newer("latest", "2026.9.2"));
        assert!(!newer("2026.9.3", "not-a-version"));
    }

    /// 本地的 tap 可能是一天前的，没有 `brew update` 的话，这条命令会回
    /// 「已经是最新」—— 而弹窗刚说有新版本。
    #[test]
    fn the_brew_command_refreshes_the_tap_first() {
        assert!(BREW_UPGRADE.starts_with("brew update && "));
        assert!(BREW_UPGRADE.ends_with("brew upgrade --cask thinkwatch-lite"));
    }
}
