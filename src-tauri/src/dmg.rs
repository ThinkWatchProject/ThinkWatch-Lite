//! 更新包就是发布页上那个 DMG。
//!
//! **发布页只挂 DMG**（外加它的 sha256 和 latest.json）：网页上下载的是它，
//! Homebrew 的 cask 吃的是它，应用自己更新下的也是它 —— latest.json 指向
//! 它，签名签的也是它。
//!
//! 更新器插件在 macOS 上只装 `.app.tar.gz`：把下载下来的字节当 gzip 的 tar
//! 解开，取出里面的 `.app` 换掉自己。所以这里先把 DMG 挂上，把里面的
//! `.app` 打成那样一个包，**替换这一步照旧交给插件** —— 原地换、换失败时
//! 放回旧的、没有写权限时弹管理员授权，这些它都有，而且是在真机器上装过
//! 的那一份。自己重写一遍，出错的地方正好是最不能出错的那一步：更新器
//! 坏了，装着那一版的人连修好它的版本都收不到。
//!
//! **2026.9.8 及更早的版本没有这一步**，下到 DMG 会解不开、报安装失败
//! （网关照常在跑，什么都没换）。那些版本要手动下载安装一次。

use std::path::{Path, PathBuf};
use std::process::Command;

/// 写绝对路径：不去用 PATH 上随便哪个同名程序。
const HDIUTIL: &str = "/usr/bin/hdiutil";

/// DMG 里的 `.app`，打成更新器插件认得的包。
///
/// 签名在这之前已经验过了（`Update::download` 验的是下载下来的原始字节，
/// 也就是这个 DMG），这里不再验一遍。
pub fn app_archive(dmg: &[u8]) -> Result<Vec<u8>, String> {
    let dir = tempfile::Builder::new()
        .prefix("thinkwatch-update")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let image = dir.path().join("update.dmg");
    std::fs::write(&image, dmg).map_err(|e| e.to_string())?;
    let volume = dir.path().join("volume");
    std::fs::create_dir(&volume).map_err(|e| e.to_string())?;
    // 声明在 `dir` 之后，所以先于它析构：卷卸掉了，临时目录才删得掉
    let _mounted = Mounted::attach(&image, &volume)?;
    pack(&find_app(&volume)?)
}

/// 挂着的映像。离开作用域就卸掉 —— 中途出错也一样，否则每失败一次，系统
/// 里就多一个挂着的卷。
struct Mounted<'a>(&'a Path);

impl<'a> Mounted<'a> {
    fn attach(image: &Path, at: &'a Path) -> Result<Self, String> {
        // 不出现在访达和桌面上，也不自己弹窗口
        let out = Command::new(HDIUTIL)
            .args([
                "attach",
                "-nobrowse",
                "-readonly",
                "-noautoopen",
                "-mountpoint",
            ])
            .arg(at)
            .arg(image)
            .output()
            .map_err(|e| format!("hdiutil: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "hdiutil attach: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(Self(at))
    }
}

impl Drop for Mounted<'_> {
    fn drop(&mut self) {
        let _ = Command::new(HDIUTIL)
            .args(["detach", "-force"])
            .arg(self.0)
            .output();
    }
}

/// 映像根上那一个 `.app`。
///
/// **不按名字找。**应用改名的那一版，包里的名字就和正在跑的这一份不一样；
/// 插件解包时也不看这一层叫什么。映像里另外那些（`Applications` 链接、
/// 背景图、`.DS_Store`）都不是目录形状的 `.app`。
fn find_app(volume: &Path) -> Result<PathBuf, String> {
    let apps: Vec<PathBuf> = std::fs::read_dir(volume)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "app") && p.is_dir() && !p.is_symlink())
        .collect();
    match apps.as_slice() {
        [app] => Ok(app.clone()),
        [] => Err(tr!("更新包里没有应用", "The update contains no app").into()),
        _ => Err(tr!(
            "更新包里有不止一个应用",
            "The update contains more than one app"
        )
        .into()),
    }
}

/// 打成和打包器产出的更新包一样的形状：gzip 的 tar，最上层是 `Foo.app/`。
/// 插件解包时去掉这一层，把里面的东西放回自己所在的那个 `.app`。
///
/// **不跟随符号链接**，链接原样进包。压缩取最快的一档：这个包只在内存里
/// 待几秒。
fn pack(app: &Path) -> Result<Vec<u8>, String> {
    let name = app
        .file_name()
        .ok_or_else(|| format!("{} has no file name", app.display()))?;
    let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::fast(),
    ));
    tar.follow_symlinks(false);
    tar.append_dir_all(name, app).map_err(|e| e.to_string())?;
    tar.into_inner()
        .and_then(|gz| gz.finish())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::os::unix::fs::{PermissionsExt, symlink};

    /// 一个假的 `.app`：可执行文件、普通文件、深一层的目录和一个符号链接。
    fn fake_app(root: &Path, name: &str) -> PathBuf {
        let app = root.join(name);
        std::fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
        std::fs::create_dir_all(app.join("Contents/Resources/nested")).unwrap();
        std::fs::write(app.join("Contents/Info.plist"), "<plist/>").unwrap();
        let exe = app.join("Contents/MacOS/app");
        std::fs::write(&exe, b"\xcf\xfa\xed\xfe binary").unwrap();
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(app.join("Contents/Resources/nested/data"), [7u8; 4096]).unwrap();
        symlink("nested/data", app.join("Contents/Resources/link")).unwrap();
        app
    }

    /// 解开一个更新包，**和 tauri-plugin-updater 2.11 在 macOS 上的
    /// `install_inner` 一字不差**：每一项去掉最上层那一级，放进目标目录。
    fn unpack_like_the_plugin(bytes: &[u8], into: &Path) {
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
        for entry in archive.entries().unwrap() {
            let mut entry = entry.unwrap();
            let rel: PathBuf = entry.path().unwrap().iter().skip(1).collect();
            let dst = into.join(&rel);
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            entry.unpack(&dst).unwrap();
        }
    }

    /// 目录里的每一项：相对路径 → (类型, 权限, 内容或链接目标)。
    fn tree(root: &Path) -> BTreeMap<PathBuf, (char, u32, Vec<u8>)> {
        fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<PathBuf, (char, u32, Vec<u8>)>) {
            for e in std::fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                let meta = std::fs::symlink_metadata(&p).unwrap();
                let rel = p.strip_prefix(root).unwrap().to_path_buf();
                let mode = meta.permissions().mode() & 0o777;
                if meta.file_type().is_symlink() {
                    let target = std::fs::read_link(&p).unwrap();
                    out.insert(rel, ('l', 0, target.into_os_string().into_encoded_bytes()));
                } else if meta.is_dir() {
                    out.insert(rel, ('d', mode, Vec::new()));
                    walk(root, &p, out);
                } else {
                    out.insert(rel, ('f', mode, std::fs::read(&p).unwrap()));
                }
            }
        }
        let mut out = BTreeMap::new();
        walk(root, root, &mut out);
        out
    }

    #[test]
    fn the_package_unpacks_into_the_same_app_the_way_the_plugin_unpacks_it() {
        let src = tempfile::tempdir().unwrap();
        let app = fake_app(src.path(), "Foo.app");
        let bytes = pack(&app).unwrap();

        let out = tempfile::tempdir().unwrap();
        unpack_like_the_plugin(&bytes, out.path());
        assert_eq!(tree(out.path()), tree(&app));
        // 可执行位、符号链接都还在
        let exe = out.path().join("Contents/MacOS/app");
        assert_eq!(
            std::fs::metadata(&exe).unwrap().permissions().mode() & 0o777,
            0o755
        );
        assert!(out.path().join("Contents/Resources/link").is_symlink());
    }

    #[test]
    fn the_first_entry_is_the_app_folder_like_the_bundler_writes_it() {
        let src = tempfile::tempdir().unwrap();
        let app = fake_app(src.path(), "Foo Bar.app");
        let bytes = pack(&app).unwrap();
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(&bytes[..]));
        let paths: Vec<PathBuf> = archive
            .entries()
            .unwrap()
            .map(|e| e.unwrap().path().unwrap().into_owned())
            .collect();
        assert_eq!(paths[0], Path::new("Foo Bar.app"));
        assert!(paths.iter().all(|p| p.starts_with("Foo Bar.app")));
    }

    #[test]
    fn the_app_is_the_one_folder_ending_in_app_at_the_root() {
        let vol = tempfile::tempdir().unwrap();
        fake_app(vol.path(), "ThinkWatch Lite.app");
        symlink("/Applications", vol.path().join("Applications")).unwrap();
        std::fs::write(vol.path().join(".background.tiff"), b"tiff").unwrap();
        // 叫 .app 的文件和指向目录的链接都不算
        std::fs::write(vol.path().join("readme.app"), b"not a bundle").unwrap();
        symlink(
            vol.path().join("ThinkWatch Lite.app"),
            vol.path().join("alias.app"),
        )
        .unwrap();
        assert_eq!(
            find_app(vol.path()).unwrap(),
            vol.path().join("ThinkWatch Lite.app")
        );
    }

    #[test]
    fn no_app_or_two_apps_is_refused() {
        let empty = tempfile::tempdir().unwrap();
        assert!(find_app(empty.path()).is_err());

        let two = tempfile::tempdir().unwrap();
        fake_app(two.path(), "A.app");
        fake_app(two.path(), "B.app");
        assert!(find_app(two.path()).is_err());
    }

    /// 走一遍真的 `hdiutil`：做一个 DMG，从里面取出包，解开之后和原来的
    /// `.app` 一样，而且卷已经卸掉了。
    #[test]
    fn a_real_disk_image_gives_back_the_app_inside_and_is_detached_after() {
        let staging = tempfile::tempdir().unwrap();
        let app = fake_app(staging.path(), "Foo.app");
        symlink("/Applications", staging.path().join("Applications")).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let dmg = dir.path().join("test.dmg");
        let made = Command::new(HDIUTIL)
            .args([
                "create",
                "-quiet",
                "-fs",
                "HFS+",
                "-format",
                "UDZO",
                "-volname",
                "Test",
                "-srcfolder",
            ])
            .arg(staging.path())
            .arg(&dmg)
            .status()
            .unwrap();
        assert!(made.success(), "hdiutil create failed");

        let bytes = app_archive(&std::fs::read(&dmg).unwrap()).unwrap();
        let out = tempfile::tempdir().unwrap();
        unpack_like_the_plugin(&bytes, out.path());
        assert_eq!(tree(out.path()), tree(&app));

        let info = Command::new(HDIUTIL).arg("info").output().unwrap();
        assert!(
            !String::from_utf8_lossy(&info.stdout).contains("thinkwatch-update"),
            "the image is still attached"
        );
    }

    #[test]
    fn bytes_that_are_not_a_disk_image_are_an_error_not_a_panic() {
        assert!(app_archive(b"definitely not a dmg").is_err());
    }
}
