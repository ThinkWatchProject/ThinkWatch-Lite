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

use std::path::{Path, PathBuf};

/// cask 的名字，也是 Caskroom 下那个目录的名字。
const CASK: &str = "thinkwatch-lite";

/// Homebrew 装在哪。
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

/// 同一个版本被「稍后」之后，隔多久再提。
pub const REMIND_AFTER: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

/// 应用自己的设置文件，放在数据目录里。
///
/// **不是网关的配置。**`config.yaml` 有版本、有历史、能回滚，因为改错一行
/// 会让所有客户端断流；这里只有几个开关，改了就生效，回滚没有意义。
const PREFS_FILE: &str = "app.json";

/// 这一份是怎么装上来的。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Install {
    /// Homebrew 的 cask 装的。更新走 `brew upgrade`。
    Homebrew,
    /// 手工下载解压的 `.app`。这一种可以自己更新。
    Standalone,
    /// 根本不在一个 `.app` 里 —— `tauri dev`。
    Dev,
}

impl Install {
    /// 这一份能不能自己把自己换掉。
    pub fn can_self_update(self) -> bool {
        matches!(self, Install::Standalone)
    }
}

/// 自己所在的 `.app`。不在一个 `.app` 里就是 `None`。
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
pub fn kind_at(exe: &Path, roots: &[PathBuf]) -> Install {
    match bundle_of(exe) {
        None => Install::Dev,
        Some(b) if from_homebrew(b, roots) => Install::Homebrew,
        Some(_) => Install::Standalone,
    }
}

/// 这一份是怎么装上来的。
pub fn kind() -> Install {
    // 连自己在哪都答不上来时当作 `Dev` —— 那一档不自己更新。**不确定的
    // 时候不要动用户的 `.app`。**
    let Ok(exe) = std::env::current_exe() else {
        return Install::Dev;
    };
    kind_at(&exe, &BREW_PREFIXES.map(PathBuf::from))
}

/// 应用自己的设置。
///
/// 缺字段时取 [`Prefs::default`] 里的值，不是类型的零值 —— 对一个布尔来说
/// 两者恰好相反。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct Prefs {
    /// 启动之后以及此后每隔一段时间，去看有没有新版本。
    ///
    /// **出厂是开的。**这个应用坐在每一个 AI 请求的必经之路上：脱敏规则、
    /// 工具调用的检查、对上游的兼容，修好一处都要用户换到那一版才生效，而
    /// 一个停在旧版本上的网关，用户自己是看不出来的。检查本身只读一份版本
    /// 清单，不带任何本机的内容；不需要的话在「设置」里关掉。
    pub check_updates: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            check_updates: true,
        }
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

/// 上一次弹窗是为哪个版本、在什么时候。
#[derive(Debug, Clone)]
pub struct Prompted {
    pub version: String,
    pub at: std::time::Instant,
}

/// 这一次该不该把更新窗口推到用户面前。
///
/// **新版本立刻提，同一个版本一天最多一次。**用户点过「稍后」，六小时后
/// 下一轮检查又把同一个窗口推到他面前，那是在跟他较劲；而一直不再提，
/// 一个开着几周不重启的菜单栏应用就永远停在旧版本上。
pub fn due(last: Option<&Prompted>, version: &str, now: std::time::Instant) -> bool {
    match last {
        None => true,
        Some(p) if p.version != version => true,
        Some(p) => now.saturating_duration_since(p.at) >= REMIND_AFTER,
    }
}

fn prefs_path(dir: &Path) -> PathBuf {
    dir.join(PREFS_FILE)
}

/// 读设置。
///
/// **读不出来就按出厂设置。**文件不在（第一次运行）和文件坏了，对用户的
/// 意义是一样的；为一个开关让应用起不来，代价不对。
pub fn load_prefs(dir: &Path) -> Prefs {
    std::fs::read(prefs_path(dir))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save_prefs(dir: &Path, p: &Prefs) -> anyhow::Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut text = serde_json::to_vec_pretty(p)?;
    text.push(b'\n');
    std::fs::write(prefs_path(dir), text)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn with_no_settings_file_the_check_is_on() {
        let dir = tmp();
        assert!(load_prefs(&dir).check_updates);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// 关掉之后存得住。**这一条防的是 `#[serde(default)]` 的一个坑**：
    /// 默认值改成开之后，缺字段时取的是 `Default` 而不是布尔的零值，而
    /// 用户写下的 `false` 必须照样被读成 `false`。
    #[test]
    fn turning_the_check_off_is_remembered() {
        let dir = tmp();
        save_prefs(
            &dir,
            &Prefs {
                check_updates: false,
            },
        )
        .unwrap();
        assert!(!load_prefs(&dir).check_updates);
        std::fs::write(prefs_path(&dir), b"{}").unwrap();
        assert!(load_prefs(&dir).check_updates, "缺字段取默认值，也就是开");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn settings_survive_a_round_trip() {
        let dir = tmp();
        let want = Prefs {
            check_updates: true,
        };
        save_prefs(&dir, &want).unwrap();
        assert_eq!(load_prefs(&dir), want);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// 文件坏了按出厂设置。
    #[test]
    fn a_corrupt_settings_file_falls_back_to_the_default() {
        let dir = tmp();
        std::fs::write(prefs_path(&dir), b"{ not json").unwrap();
        assert_eq!(load_prefs(&dir), Prefs::default());
        std::fs::remove_dir_all(&dir).unwrap();
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

    #[test]
    fn the_same_version_is_offered_at_most_once_a_day() {
        let t0 = std::time::Instant::now();
        assert!(due(None, "2026.9.3", t0), "从没提过就提");

        let last = Prompted {
            version: "2026.9.3".into(),
            at: t0,
        };
        let six_hours = t0 + std::time::Duration::from_secs(6 * 3600);
        assert!(
            !due(Some(&last), "2026.9.3", six_hours),
            "点过「稍后」，下一轮检查不再推同一个"
        );
        assert!(due(Some(&last), "2026.9.3", t0 + REMIND_AFTER));
        assert!(
            due(Some(&last), "2026.9.4", six_hours),
            "又出了一个新版本，立刻提"
        );
    }

    /// 本地的 tap 可能是一天前的，没有 `brew update` 的话，这条命令会回
    /// 「已经是最新」—— 而弹窗刚说有新版本。
    #[test]
    fn the_brew_command_refreshes_the_tap_first() {
        assert!(BREW_UPGRADE.starts_with("brew update && "));
        assert!(BREW_UPGRADE.ends_with("brew upgrade --cask thinkwatch-lite"));
    }
}
