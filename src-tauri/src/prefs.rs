//! 应用自己的设置。
//!
//! **不是网关的配置。**`config.yaml` 有版本、有历史、能回滚，因为改错一行
//! 会让所有客户端断流；这里只有几个开关，改了就生效，回滚没有意义。

use std::path::{Path, PathBuf};

use crate::i18n::Lang;
use crate::notices::Mode;
use crate::theme::Theme;

/// 设置文件，放在数据目录里。
const PREFS_FILE: &str = "app.json";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Prefs {
    /// 启动之后以及此后每隔一段时间，去看有没有新版本。
    ///
    /// **出厂是开的。**这个应用坐在每一个 AI 请求的必经之路上：脱敏规则、
    /// 工具调用的检查、对上游的兼容，修好一处都要用户换到那一版才生效，而
    /// 一个停在旧版本上的网关，用户自己是看不出来的。检查本身只读一份版本
    /// 清单，不带任何本机的内容；不需要的话在「设置」里关掉。
    pub check_updates: bool,
    /// 界面语言。`None` 是跟随系统。
    ///
    /// **只存用户明确选过的。**出厂不写进文件：系统语言改了，没选过的人
    /// 下次打开应该跟着变，而不是停在第一次启动时猜的那个。
    pub language: Option<Lang>,
    /// 界面外观。`None` 是跟随系统，理由同上。
    pub theme: Option<Theme>,
    /// 提醒：系统通知 / 仅在应用内 / 关闭。**只有这一个，不分类。**
    pub notices: Mode,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            check_updates: true,
            language: None,
            theme: None,
            notices: Mode::System,
        }
    }
}

fn prefs_path(dir: &Path) -> PathBuf {
    dir.join(PREFS_FILE)
}

/// 读设置。
///
/// **读不出来就按出厂设置。**文件不在（第一次运行）和文件坏了，对用户的
/// 意义是一样的；为一个开关让应用起不来，代价不对。
pub fn load(dir: &Path) -> Prefs {
    std::fs::read(prefs_path(dir))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, p: &Prefs) -> anyhow::Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut text = serde_json::to_vec_pretty(p)?;
    text.push(b'\n');
    std::fs::write(prefs_path(dir), text)?;
    Ok(())
}

/// 改一项，其余照旧。
///
/// **不能拿一个只填了一项的 `Prefs` 去存。**那样改一个开关会把其他设置
/// 一起冲回出厂值 —— 加上语言这一项之前，存设置的地方正是这么写的。
pub fn update(dir: &Path, f: impl FnOnce(&mut Prefs)) -> anyhow::Result<Prefs> {
    let mut p = load(dir);
    f(&mut p);
    save(dir, &p)?;
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "tw-prefs-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn with_no_settings_file_the_check_is_on_and_the_language_and_theme_follow_the_system() {
        let dir = tmp();
        let p = load(&dir);
        assert!(p.check_updates);
        assert_eq!(p.language, None);
        assert_eq!(p.theme, None);
        assert_eq!(p.notices, Mode::System);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// 关掉之后存得住：出厂是开的，用户写下的 `false` 必须照样被读成 `false`。
    #[test]
    fn turning_the_check_off_is_remembered() {
        let dir = tmp();
        update(&dir, |p| p.check_updates = false).unwrap();
        assert!(!load(&dir).check_updates);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// 改一项不能把另一项冲掉。
    #[test]
    fn changing_one_setting_keeps_the_others() {
        let dir = tmp();
        update(&dir, |p| p.language = Some(Lang::En)).unwrap();
        update(&dir, |p| p.check_updates = false).unwrap();
        update(&dir, |p| p.notices = Mode::Off).unwrap();
        let p = load(&dir);
        assert_eq!(p.language, Some(Lang::En));
        assert!(!p.check_updates);
        assert_eq!(p.notices, Mode::Off);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn settings_survive_a_round_trip() {
        let dir = tmp();
        let want = Prefs {
            check_updates: true,
            language: Some(Lang::Zh),
            theme: Some(Theme::Dark),
            notices: Mode::App,
        };
        save(&dir, &want).unwrap();
        assert_eq!(load(&dir), want);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// 文件坏了按出厂设置。
    #[test]
    fn a_corrupt_settings_file_falls_back_to_the_default() {
        let dir = tmp();
        std::fs::write(prefs_path(&dir), b"{ not json").unwrap();
        assert_eq!(load(&dir), Prefs::default());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
