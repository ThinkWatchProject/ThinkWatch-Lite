//! 应用自己的设置。
//!
//! **不是网关的配置。**`config.yaml` 有版本、有历史、能回滚，因为改错一行
//! 会让所有客户端断流；这里只有几个开关，改了就生效，回滚没有意义。

use std::collections::BTreeMap;
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
    /// 菜单栏上显示什么：标识和数值（出厂）/ 仅标识 / 仅数值。
    ///
    /// **没写就是出厂那一档**，而不是整个设置文件读不出来、连语言和外观一起被冲回
    /// 出厂值
    #[serde(default)]
    pub menubar: crate::menubar::Style,
    /// 用户为这台电脑上的客户端换过的配置位置（接管、MCP 管理、安全扫描），按客户端 id，
    /// 只写和默认位置不一样的几项。**没写就是都在默认位置**，见 `clients::locations`
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub client_locations: BTreeMap<String, tw_adopt::locations::Places>,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            check_updates: true,
            language: None,
            theme: None,
            notices: Mode::System,
            menubar: crate::menubar::Style::Full,
            client_locations: BTreeMap::new(),
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
///
/// **一项读不懂，只有那一项按出厂值。**降级之后，新版本写下的、这一版不认识的一个
/// 值（提醒多了一档、菜单栏多了一种样式）不该把语言、外观、换过的客户端位置一起冲掉
/// —— 以前整份按一个结构体读，任何一项读不懂就全部作废，而下一次改设置时存下去的正是
/// 那一份出厂值。写法不变：旧版本读新版本写的文件、新版本读旧的，都和以前一样
pub fn load(dir: &Path) -> Prefs {
    let Ok(bytes) = std::fs::read(prefs_path(dir)) else {
        return Prefs::default();
    };
    match serde_json::from_slice(&bytes) {
        Ok(serde_json::Value::Object(fields)) => from_fields(&fields),
        Ok(_) => {
            tracing::debug!("设置文件里不是一份设置，按出厂设置");
            Prefs::default()
        }
        Err(e) => {
            tracing::debug!("设置文件读不出来，按出厂设置：{e}");
            Prefs::default()
        }
    }
}

type Fields = serde_json::Map<String, serde_json::Value>;

/// 一项一项地读。**每一项都列在这里，不用 `..Prefs::default()` 补**：加了一项设置
/// 而忘了在这里读它，编译就过不去
fn from_fields(fields: &Fields) -> Prefs {
    let d = Prefs::default();
    Prefs {
        check_updates: field(fields, "check_updates").unwrap_or(d.check_updates),
        language: field(fields, "language").unwrap_or(d.language),
        theme: field(fields, "theme").unwrap_or(d.theme),
        notices: field(fields, "notices").unwrap_or(d.notices),
        menubar: field(fields, "menubar").unwrap_or(d.menubar),
        // 一个客户端一个客户端地读：读不懂的只丢那一个
        client_locations: field::<Fields>(fields, "client_locations")
            .map(|all| {
                all.iter()
                    .filter_map(|(id, v)| {
                        Some((id.clone(), value(v, &format!("client_locations.{id}"))?))
                    })
                    .collect()
            })
            .unwrap_or(d.client_locations),
    }
}

/// 名为 `key` 的那一项。没写是 `None`，读不懂也是 `None`
fn field<T: serde::de::DeserializeOwned>(fields: &Fields, key: &str) -> Option<T> {
    value(fields.get(key)?, key)
}

fn value<T: serde::de::DeserializeOwned>(v: &serde_json::Value, what: &str) -> Option<T> {
    T::deserialize(v)
        .inspect_err(|e| tracing::debug!("设置里的「{what}」读不懂，按出厂值：{e}"))
        .ok()
}

pub fn save(dir: &Path, p: &Prefs) -> anyhow::Result<()> {
    let mut text = serde_json::to_vec_pretty(p)?;
    text.push(b'\n');
    // **整份换上去**，不在原处截断重写：写到一半退出（被杀、断电），留下的是上一份
    // 完整的设置，而不是半份 —— 半份读出来就是全部回到出厂值
    crate::atomic_file::write(&prefs_path(dir), &text)?;
    Ok(())
}

/// 改一项，其余照旧。
///
/// **不能拿一个只填了一项的 `Prefs` 去存。**那样改一个开关会把其他设置
/// 一起冲回出厂值 —— 加上语言这一项之前，存设置的地方正是这么写的。
pub fn update(dir: &Path, f: impl FnOnce(&mut Prefs)) -> anyhow::Result<Prefs> {
    // **一次只改一处。**读、改、写之间别处也在改的话，后写完的那一份会把先写的那一项
    // 冲掉 —— 改设置的命令各在各的阻塞线程上跑（[`change`]），界面上接连改两项就是两处
    // 同时在改
    static ONE_AT_A_TIME: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _one = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
    let mut p = load(dir);
    f(&mut p);
    save(dir, &p)?;
    Ok(p)
}

/// 设置页改一项（[`update`]），写不进去就说成给人看的一句。
///
/// **在阻塞线程上写。**整份换上去之前要先落盘（`atomic_file`），macOS 上一次好几毫秒；
/// 同步命令跑在主线程上，那几毫秒里整个界面都不动
pub async fn change(f: impl FnOnce(&mut Prefs) + Send + 'static) -> crate::error::Out<Prefs> {
    let saved = crate::clients::blocking(move || update(&crate::data_dir(), f)).await?;
    saved.map_err(|e| {
        crate::error::CmdError::from(tr!(
            format!("无法保存设置：{e:#}"),
            format!("The setting could not be saved: {e:#}")
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 一个空目录，测试结束（过了、没过）就删掉。拿着返回的第一项到测试结束
    fn tmp() -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::Builder::new()
            .prefix("tw-prefs-")
            .tempdir()
            .unwrap();
        let p = d.path().to_path_buf();
        (d, p)
    }

    #[test]
    fn with_no_settings_file_the_check_is_on_and_the_language_and_theme_follow_the_system() {
        let (_tmp, dir) = tmp();
        let p = load(&dir);
        assert!(p.check_updates);
        assert_eq!(p.language, None);
        assert_eq!(p.theme, None);
        assert_eq!(p.notices, Mode::System);
    }

    /// 关掉之后存得住：出厂是开的，用户写下的 `false` 必须照样被读成 `false`。
    #[test]
    fn turning_the_check_off_is_remembered() {
        let (_tmp, dir) = tmp();
        update(&dir, |p| p.check_updates = false).unwrap();
        assert!(!load(&dir).check_updates);
    }

    /// 改一项不能把另一项冲掉。
    #[test]
    fn changing_one_setting_keeps_the_others() {
        let (_tmp, dir) = tmp();
        update(&dir, |p| p.language = Some(Lang::En)).unwrap();
        update(&dir, |p| p.check_updates = false).unwrap();
        update(&dir, |p| p.notices = Mode::Off).unwrap();
        let p = load(&dir);
        assert_eq!(p.language, Some(Lang::En));
        assert!(!p.check_updates);
        assert_eq!(p.notices, Mode::Off);
    }

    /// **几处同时改也不冲掉别的**：改设置的命令各在各的阻塞线程上跑，界面上接连点两下
    /// 就是两处同时在读、改、写
    #[test]
    fn changes_made_at_the_same_time_all_stay() {
        let (_tmp, dir) = tmp();
        for _ in 0..10 {
            std::thread::scope(|s| {
                s.spawn(|| update(&dir, |p| p.language = Some(Lang::En)).unwrap());
                s.spawn(|| update(&dir, |p| p.check_updates = false).unwrap());
                s.spawn(|| update(&dir, |p| p.notices = Mode::Off).unwrap());
                s.spawn(|| update(&dir, |p| p.theme = Some(Theme::Dark)).unwrap());
            });
            let p = load(&dir);
            assert_eq!(p.language, Some(Lang::En));
            assert!(!p.check_updates);
            assert_eq!(p.notices, Mode::Off);
            assert_eq!(p.theme, Some(Theme::Dark));
            save(&dir, &Prefs::default()).unwrap();
        }
    }

    /// **每一项都不是出厂值**：哪一项没被读回来，这里就对不上
    #[test]
    fn settings_survive_a_round_trip() {
        let (_tmp, dir) = tmp();
        let want = Prefs {
            check_updates: false,
            language: Some(Lang::Zh),
            theme: Some(Theme::Dark),
            notices: Mode::App,
            menubar: crate::menubar::Style::Numbers,
            client_locations: BTreeMap::from([(
                "claude-code".to_string(),
                tw_adopt::locations::Places {
                    config: Some("/work/claude/settings.json".into()),
                    mcp: Some("/work/claude/.claude.json".into()),
                    scan: Some("/work/claude".into()),
                },
            )]),
        };
        save(&dir, &want).unwrap();
        assert_eq!(load(&dir), want);
    }

    /// 旧的设置文件里没有菜单栏这一项：**别的设置照旧**，菜单栏按出厂那一档
    #[test]
    fn a_file_without_the_menubar_setting_keeps_everything_else() {
        let (_tmp, dir) = tmp();
        std::fs::write(
            prefs_path(&dir),
            br#"{"check_updates":false,"language":"en","theme":null,"notices":"app"}"#,
        )
        .unwrap();
        let p = load(&dir);
        assert_eq!(p.language, Some(Lang::En));
        assert!(!p.check_updates);
        assert_eq!(p.menubar, crate::menubar::Style::Full);
        assert!(p.client_locations.is_empty());
    }

    /// 文件坏了按出厂设置。
    #[test]
    fn a_corrupt_settings_file_falls_back_to_the_default() {
        let (_tmp, dir) = tmp();
        std::fs::write(prefs_path(&dir), b"{ not json").unwrap();
        assert_eq!(load(&dir), Prefs::default());
        // 是 JSON，但不是一份设置
        std::fs::write(prefs_path(&dir), b"[\"en\"]").unwrap();
        assert_eq!(load(&dir), Prefs::default());
    }

    /// 降级之后：新版本写下的、这一版不认识的值（提醒多了一档、菜单栏多了一种样式、
    /// 位置换了写法），**只有那一项按出厂值**，语言、外观、别的客户端的位置照旧
    #[test]
    fn a_value_this_version_does_not_know_resets_only_that_setting() {
        let (_tmp, dir) = tmp();
        std::fs::write(
            prefs_path(&dir),
            br#"{
                "check_updates": false,
                "language": "en",
                "theme": "dark",
                "notices": "digest",
                "menubar": "compact",
                "client_locations": {
                    "claude-code": {"config": "/work/claude/settings.json"},
                    "codex": {"config": {"path": "/work/codex/config.toml"}}
                },
                "added_later": true
            }"#,
        )
        .unwrap();
        let p = load(&dir);
        assert!(!p.check_updates);
        assert_eq!(p.language, Some(Lang::En));
        assert_eq!(p.theme, Some(Theme::Dark));
        assert_eq!(p.notices, Mode::System, "不认识的那一档按出厂值");
        assert_eq!(p.menubar, crate::menubar::Style::Full);
        assert_eq!(
            p.client_locations.keys().collect::<Vec<_>>(),
            ["claude-code"],
            "读不懂的只丢那一个客户端"
        );
    }

    /// 写法没变：**旧版本（整份按一个结构体读）照样读得懂这一版写下的文件**
    #[test]
    fn what_this_version_writes_an_older_one_still_reads() {
        let (_tmp, dir) = tmp();
        update(&dir, |p| {
            p.language = Some(Lang::En);
            p.notices = Mode::App;
        })
        .unwrap();
        let strict: Prefs =
            serde_json::from_slice(&std::fs::read(prefs_path(&dir)).unwrap()).unwrap();
        assert_eq!(strict, load(&dir));
    }

    /// 类型不对的一项（手改坏的）：同样只有那一项按出厂值
    #[test]
    fn a_value_of_the_wrong_type_resets_only_that_setting() {
        let (_tmp, dir) = tmp();
        std::fs::write(
            prefs_path(&dir),
            br#"{"check_updates":"no","language":"ja","theme":1,"notices":"off","menubar":"icon"}"#,
        )
        .unwrap();
        let p = load(&dir);
        assert!(p.check_updates);
        assert_eq!(p.language, None);
        assert_eq!(p.theme, None);
        assert_eq!(p.notices, Mode::Off);
        assert_eq!(p.menubar, crate::menubar::Style::Icon);
    }

    /// 写到一半的文件（以前不是整份换上去的）：按出厂设置，不崩
    #[test]
    fn a_truncated_settings_file_falls_back_to_the_default() {
        let (_tmp, dir) = tmp();
        let full = serde_json::to_vec_pretty(&Prefs {
            language: Some(Lang::En),
            ..Prefs::default()
        })
        .unwrap();
        std::fs::write(prefs_path(&dir), &full[..full.len() / 2]).unwrap();
        assert_eq!(load(&dir), Prefs::default());
    }

    /// 存设置是**整份换上去**，不是在原处截断重写：写到一半退出，留下的是上一份完整的，
    /// 在那之前打开它的也读得到完整的上一份；临时文件不留下
    #[cfg(unix)]
    #[test]
    fn saving_replaces_the_file_instead_of_rewriting_it_in_place() {
        use std::io::Read;
        let (_tmp, dir) = tmp();
        update(&dir, |p| p.language = Some(Lang::En)).unwrap();
        let mut before = std::fs::File::open(prefs_path(&dir)).unwrap();
        update(&dir, |p| p.language = Some(Lang::Zh)).unwrap();
        let mut text = String::new();
        before.read_to_string(&mut text).unwrap();
        assert!(text.contains(r#""language": "en""#), "{text}");
        assert_eq!(load(&dir).language, Some(Lang::Zh));
        let files: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(files, [PREFS_FILE]);
    }
}
