//! 盯着配置面的变化。
//!
//! 为什么持续监控有价值，而不只是「打开页面扫一次」：
//!
//! > 你 clone 了一个看起来正常的仓库，它带着 `.claude/settings.json`。
//! > 客户端确实有信任提示，但**信任是一次性的、目录级的** —— 你点了
//! > 信任之后，该目录下的这些文件后续被改动（比如你 `git pull` 了一次）
//! > 不会重新提示。
//!
//! 所以是**首次扫描 + 变更时 diff 扫描**。而 diff 那一半才是真正值钱的：
//! **「一个用了半年的 skill 突然多了一段零宽字符」这个信号，比「这个
//! 文件里有可疑内容」强得多。**
//!
//! # 范围仍然是那几个目录
//!
//! 监听的目录集合就是 [`crate::sources`] 划定的那一批，一个不多。无界的
//! FSEvents 监听既是性能问题，也和「空闲时接近零」的目标冲突。
//!
//! **盯目录不盯文件、不递归、去抖**，和配置文件的监听是同一份（[`tw_watch`]）。

use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// 聚合窗口。一次保存会触发好几个事件（建临时文件、rename、改属性）。
pub const DEBOUNCE: Duration = Duration::from_millis(300);

pub use tw_watch::{Watch, WatchError};

/// 要盯的目录集合。
///
/// 从来源列表反推：每份文件所在的目录各盯一次，去重。**不递归** ——
/// `~/.claude/` 底下有 `projects/`、`todos/`、`shell-snapshots/` 这些
/// 每分钟都在变的东西，递归盯它等于给自己找一个永不停歇的事件源。
///
/// 代价是 `skills/<名字>/SKILL.md` 这种一层深的要单独加进来，所以这里
/// 收的是**每个来源文件自己的父目录**，而不是几个根目录。
pub fn dirs_for(sources: &[crate::sources::Source]) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for s in sources {
        if let Some(d) = s.path.parent()
            && d.is_dir()
            && seen.insert(d.to_path_buf())
        {
            out.push(d.to_path_buf());
        }
    }
    out.sort();
    out
}

/// 我们关心的文件后缀。
///
/// 这个过滤器不是优化，是**必需品**：`~/.claude.json` 的父目录是
/// `$HOME` —— 那是全机器最忙的目录之一（每个应用都在往那儿写点东西）。
/// 不过滤的话，别人写一次 `.zsh_history` 我们就重扫一遍几十个文件，
/// 而目标是「空闲时接近零」。
///
/// `jsonc` 也在里面：刚装好的 opencode 手里就是一份 `opencode.jsonc`（扫描本来就读它，
/// 见 `report::structured`），不收它的事件，那份文件改了界面不跟、可疑的新内容也不提醒
const INTERESTING: &[&str] = &["md", "json", "jsonc", "toml", "yaml", "yml"];

fn interesting(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| INTERESTING.iter().any(|x| x.eq_ignore_ascii_case(e)))
}

/// 盯住这些目录，聚合出的每一次改动发一个信号（见 [`tw_watch::watch`]）。
///
/// **只有我们关心的那几种文件算数。这一条撑着「空闲接近零」** —— `$HOME` 在
/// 监听集合里（`~/.claude.json` 的父目录就是它）。我们自己写的备份和旁文件也
/// 不算：接管一次会触发一轮扫描，那一轮又什么都发现不了。
pub fn watch(dirs: &[PathBuf]) -> Result<(Watch, tokio::sync::mpsc::Receiver<()>), WatchError> {
    tw_watch::watch(dirs, DEBOUNCE, |p| interesting(p) && !is_ours(p))
}

/// 要盯的目录，和盯着它们时哪些改动算数。**跟着来源变**：每扫一次重算一遍，变了就
/// 换一个监视（[`needs_rewatch`]）。
///
/// 只盯来源文件所在的目录（[`dirs_for`]）的话，启动之后才出现的东西永远盯不到：新装的
/// skill 是一个新目录，它的 `SKILL.md` 在一个谁都没盯着的地方；`~/.claude/skills` 本身
/// 也可能是这一刻才建出来的。所以还要盯：
///
/// - 冒出新来源的那几个目录（[`crate::sources::roots`]）：在的就盯它，skill 那种每个
///   子目录各是一份的，子目录也各盯一个（`SKILL.md` 可能晚一步才写进来）；
/// - 还不在的（那几个目录、固定位置的配置文件）：盯**离它最近的、已经在的上一层**，
///   只认通往它的那一个名字。**不越过 home 往上**，也不盯文件系统的根。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Plan {
    /// 要盯的目录，排好序、去过重
    pub dirs: Vec<PathBuf>,
    /// 这些目录里的配置文件（按后缀认，见 [`interesting`]）改了算数
    files_in: BTreeSet<PathBuf>,
    /// 这些路径出现、消失算数：那几个目录，还没有的配置文件，和通往它们的、还不在的几层
    awaited: BTreeSet<PathBuf>,
    /// 这些目录里多一个、少一个子目录算数（`skills/<名>`）
    nested: BTreeSet<PathBuf>,
}

impl Plan {
    /// `candidates` 是 [`crate::sources::candidates`]：在的和还不在的都给
    pub fn new(
        home: &Path,
        candidates: &[crate::sources::Source],
        roots: &[crate::sources::Root],
    ) -> Plan {
        let (there, missing): (Vec<_>, Vec<_>) =
            candidates.iter().cloned().partition(|s| s.path.exists());
        let mut files_in: BTreeSet<PathBuf> = dirs_for(&there).into_iter().collect();
        let mut dirs = files_in.clone();
        let mut awaited = BTreeSet::new();
        let mut nested = BTreeSet::new();
        // 还不在的：盯最近的上一层，认通往它的那几层名字
        let wait_for = |path: &Path, dirs: &mut BTreeSet<_>, awaited: &mut BTreeSet<_>| {
            let Some(above) = nearest_dir(path, home) else {
                return;
            };
            awaited.extend(
                path.ancestors()
                    .take_while(|a| *a != above)
                    .map(Path::to_path_buf),
            );
            dirs.insert(above);
        };
        for s in &missing {
            wait_for(&s.path, &mut dirs, &mut awaited);
        }
        for r in roots {
            if !r.dir.is_dir() {
                wait_for(&r.dir, &mut dirs, &mut awaited);
                continue;
            }
            // 在的也要知道它什么时候没了
            awaited.insert(r.dir.clone());
            dirs.insert(r.dir.clone());
            if r.nested {
                nested.insert(r.dir.clone());
                for sub in subdirs(&r.dir) {
                    files_in.insert(sub.clone());
                    dirs.insert(sub);
                }
            } else {
                files_in.insert(r.dir.clone());
            }
        }
        Plan {
            dirs: dirs.into_iter().collect(),
            files_in,
            awaited,
            nested,
        }
    }

    /// 这一处改动算不算数
    pub fn relevant(&self, p: &Path) -> bool {
        let parent = p.parent().map(Path::to_path_buf).unwrap_or_default();
        // skill 目录里点开头的不是 skill：访达在看过的目录里写 `.DS_Store`
        let dotted = p
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with('.'));
        (interesting(p) && !is_ours(p) && self.files_in.contains(&parent))
            || self.awaited.contains(p)
            || (self.nested.contains(&parent) && !dotted)
    }
}

/// 扫完一遍之后，此刻在盯的和该盯的对不上：要换一个监视。
pub fn needs_rewatch(watching: &Plan, wanted: &Plan) -> bool {
    watching != wanted
}

/// 照着一份 [`Plan`] 盯，聚合出的每一次改动发一个信号。
pub fn watch_plan(plan: &Plan) -> Result<(Watch, tokio::sync::mpsc::Receiver<()>), WatchError> {
    let p = plan.clone();
    tw_watch::watch(&plan.dirs, DEBOUNCE, move |path| p.relevant(path))
}

/// 离 `path` 最近的、已经在的上一层目录。在 home 底下的不越过 home 往上找；文件系统的
/// 根不算（盯它等于什么都盯）。
///
/// home 以外的（换过位置的目录）**只看上一层**：那个目录自己都不在的话，再往上找就要
/// 盯到 `/Volumes` 这种地方去 —— macOS 上盯一个目录，其实是盯它底下的一整棵树。
fn nearest_dir(path: &Path, home: &Path) -> Option<PathBuf> {
    let inside = path.starts_with(home);
    path.ancestors()
        .skip(1)
        .take(if inside { usize::MAX } else { 1 })
        .take_while(|a| a.parent().is_some() && (!inside || a.starts_with(home)))
        .find(|a| a.is_dir())
        .map(Path::to_path_buf)
}

/// 目录下的子目录
fn subdirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    rd.flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect()
}

/// 这个路径是我们自己写的吗。
fn is_ours(p: &Path) -> bool {
    p.to_str().is_some_and(|s| {
        s.contains(crate::sources::SIDECAR_MARK)
            || s.contains(".thinkwatch-")
            || s.ends_with(".tmp")
    })
}

/// 上一次看到的样子，用来算「这次新出现了什么」。
///
/// **只记指纹，不记内容。**这些文件里有用户的提示词和密钥，把它们的
/// 全文留在内存里没有任何必要。
#[derive(Debug, Default)]
pub struct Seen {
    /// 每条发现的指纹
    known: HashSet<String>,
    /// 扫过了没有。**第一次扫的结果不算「新出现」** —— 否则用户第一次
    /// 打开就会被一屏「新发现」砸中，而那些东西可能在他机器上放了半年
    primed: bool,
}

fn key(f: &crate::report::Finding) -> String {
    format!("{}|{}|{}|{}", f.path.display(), f.rule, f.line, f.excerpt)
}

impl Seen {
    /// 吃掉一次扫描结果，返回**这次新出现的那些**。
    pub fn diff(&mut self, findings: &[crate::report::Finding]) -> Vec<crate::report::Finding> {
        let fresh: Vec<_> = findings
            .iter()
            .filter(|f| !self.known.contains(&key(f)))
            .cloned()
            .collect();
        self.known = findings.iter().map(key).collect();
        if !self.primed {
            self.primed = true;
            return Vec::new();
        }
        fresh
    }
    pub fn primed(&self) -> bool {
        self.primed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::{Finding, Level};
    use crate::sources::Kind;

    fn f(path: &str, rule: &str, line: usize) -> Finding {
        Finding {
            level: Level::High,
            rule: rule.into(),
            kind: Kind::Skill,
            client: "claude-code".into(),
            path: PathBuf::from(path),
            line,
            title: tw_types::msg!("t.title" => "t"),
            detail: tw_types::msg!("t.detail" => "d"),
            excerpt: "e".into(),
        }
    }

    #[test]
    fn the_first_scan_is_not_reported_as_new() {
        // 否则用户第一次打开就会被一屏「新发现」砸中，而那些东西可能
        // 在他机器上放了半年。
        let mut seen = Seen::default();
        assert!(
            seen.diff(&[f("a", "zero_width", 1), f("b", "tag", 2)])
                .is_empty()
        );
        assert!(seen.primed());
    }

    #[test]
    fn only_what_just_appeared_is_reported() {
        // **「一个用了半年的 skill 突然多了一段零宽字符」这个信号，
        // 比「这个文件里有可疑内容」强得多。**
        let mut seen = Seen::default();
        seen.diff(&[f("a", "zero_width", 1)]);
        let fresh = seen.diff(&[f("a", "zero_width", 1), f("a", "tag", 9)]);
        assert_eq!(fresh.len(), 1);
        assert_eq!(fresh[0].rule, "tag");
    }

    #[test]
    fn something_that_disappears_and_comes_back_is_reported_again() {
        // 用户改掉了又被改回来，那是一次新的事件。
        let mut seen = Seen::default();
        seen.diff(&[f("a", "tag", 1)]);
        assert!(seen.diff(&[]).is_empty());
        assert_eq!(seen.diff(&[f("a", "tag", 1)]).len(), 1);
    }

    #[test]
    fn the_same_finding_moving_to_another_line_counts_as_new() {
        // 行号变了通常意味着文件被编辑过 —— 那正是我们想知道的时刻。
        let mut seen = Seen::default();
        seen.diff(&[f("a", "tag", 1)]);
        assert_eq!(seen.diff(&[f("a", "tag", 40)]).len(), 1);
    }

    #[test]
    fn the_seen_set_holds_no_file_contents() {
        // 这些文件里有用户的提示词和密钥。
        let mut seen = Seen::default();
        let mut secret = f("a", "tag", 1);
        secret.detail = tw_types::msg!("t.detail" => "这里有一段很私密的提示词内容");
        secret.title = tw_types::msg!("t.title" => "标题里也有私密内容");
        seen.diff(&[secret]);
        let dump = format!("{:?}", seen);
        assert!(!dump.contains("私密"), "{dump}");
    }

    #[test]
    fn our_own_files_do_not_trigger_a_rescan() {
        // 接管一次会写旁文件和备份。让它触发一轮扫描的话，那一轮什么
        // 都发现不了，纯属白烧 CPU。
        assert!(is_ours(Path::new(
            "/Users/x/.claude/settings.json.thinkwatch.json"
        )));
        assert!(is_ours(Path::new(
            "/Users/x/.claude/.settings.json.thinkwatch-123.tmp"
        )));
        assert!(!is_ours(Path::new("/Users/x/.claude/settings.json")));
        assert!(!is_ours(Path::new("/Users/x/.claude/CLAUDE.md")));
    }

    #[tokio::test]
    async fn an_edit_in_a_watched_directory_produces_one_signal() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join(".claude");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("CLAUDE.md"), "# 一\n").unwrap();

        let (_w, mut rx) = watch(std::slice::from_ref(&dir)).unwrap();
        std::fs::write(dir.join("CLAUDE.md"), "# 二\n").unwrap();
        // 超时和通道关了都不算：要的是真收到一个信号
        assert!(
            matches!(
                tokio::time::timeout(Duration::from_secs(5), rx.recv()).await,
                Ok(Some(()))
            ),
            "没收到信号"
        );
    }

    #[tokio::test]
    async fn writing_an_unrelated_file_in_a_watched_directory_stays_quiet() {
        // **这一条撑着「空闲时 CPU 接近零」。**`$HOME` 在监听集合里
        // （`~/.claude.json` 的父目录就是它），而那是全机器最忙的目录
        // 之一 —— 别人写一次 `.zsh_history` 我们就重扫几十个文件的话，
        // 这个功能会变成一个后台耗电器。
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().to_path_buf();
        let (_w, mut rx) = watch(std::slice::from_ref(&dir)).unwrap();

        std::fs::write(dir.join(".zsh_history"), "别人的东西\n").unwrap();
        std::fs::write(dir.join("settings.json.thinkwatch.json"), "{}").unwrap();
        std::fs::write(dir.join("x.sock"), "").unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(1200), rx.recv())
                .await
                .is_err(),
            "被无关文件吵醒了"
        );

        // 而我们关心的那种照样能叫醒它
        std::fs::write(dir.join("CLAUDE.md"), "# 改了\n").unwrap();
        // 超时和通道关了都不算：要的是真收到一个信号
        assert!(
            matches!(
                tokio::time::timeout(Duration::from_secs(5), rx.recv()).await,
                Ok(Some(()))
            ),
            "该醒的时候没醒"
        );
    }

    #[tokio::test]
    async fn a_directory_we_do_not_watch_stays_quiet() {
        // 范围就是范围。全盘监听既是性能问题，也和「空闲接近零」冲突。
        let d = tempfile::tempdir().unwrap();
        let watched = d.path().join("watched");
        let other = d.path().join("other");
        std::fs::create_dir_all(&watched).unwrap();
        std::fs::create_dir_all(&other).unwrap();

        let (_w, mut rx) = watch(&[watched]).unwrap();
        std::fs::write(other.join("x.md"), "改了别处\n").unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(1200), rx.recv())
                .await
                .is_err(),
            "盯了不该盯的目录"
        );
    }

    #[test]
    fn the_watched_directories_come_from_the_source_list_and_nowhere_else() {
        let d = tempfile::tempdir().unwrap();
        let home = d.path();
        std::fs::create_dir_all(home.join(".claude/skills/x")).unwrap();
        std::fs::write(home.join(".claude/settings.json"), "{}").unwrap();
        std::fs::write(home.join(".claude/skills/x/SKILL.md"), "---\n---\n").unwrap();

        let dirs = dirs_for(&crate::sources::user_level(home, &Default::default()));
        assert!(dirs.contains(&home.join(".claude")));
        // 一层深的 skill 目录要各自被盯到 —— 我们不递归
        assert!(dirs.contains(&home.join(".claude/skills/x")));
        assert!(
            !dirs.contains(&home.to_path_buf()),
            "不该盯整个 home：{dirs:?}"
        );
    }

    fn plan_for(home: &Path) -> Plan {
        let moved = Default::default();
        Plan::new(
            home,
            &crate::sources::candidates(home, &moved),
            &crate::sources::roots(home, &moved),
        )
    }

    /// 新来源冒出来的地方，**还不在的也盯着**：盯最近的上一层，只认通往它的名字。
    /// 同一个目录里别的东西照旧不算，也不越过 home 往上盯
    #[test]
    fn places_new_sources_appear_in_are_watched_before_they_exist() {
        let d = tempfile::tempdir().unwrap();
        let home = d.path();
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        std::fs::write(home.join(".claude/settings.json"), "{}").unwrap();
        let plan = plan_for(home);

        assert!(plan.dirs.contains(&home.join(".claude")), "{:?}", plan.dirs);
        for p in [".claude/skills", ".claude/commands", ".claude/agents"] {
            assert!(plan.relevant(&home.join(p)), "{p}");
        }
        // 还没有的 CLAUDE.md 一写就算数
        assert!(plan.relevant(&home.join(".claude/CLAUDE.md")));
        // `~/.claude/` 底下每分钟都在变的那些不算
        assert!(!plan.relevant(&home.join(".claude/projects")));
        assert!(!plan.relevant(&home.join(".claude/todos")));

        // 整个还没装的客户端：盯 home，只认它的那个名字
        assert!(plan.dirs.contains(&home.to_path_buf()), "{:?}", plan.dirs);
        assert!(plan.relevant(&home.join(".codex")));
        assert!(plan.relevant(&home.join(".gemini")));
        assert!(!plan.relevant(&home.join(".zsh_history")));
        assert!(
            !plan.relevant(&home.join("notes.md")),
            "home 里别的配置文件不算"
        );
        assert!(
            plan.dirs.iter().all(|d| d.starts_with(home)),
            "越过 home 往上盯了：{:?}",
            plan.dirs
        );
    }

    /// skill 那种每个子目录各是一份的：子目录各盯一个，`SKILL.md` 晚一步才写进来也看得见；
    /// 再多一个子目录也算数
    #[test]
    fn each_skill_folder_is_watched_even_before_its_skill_md_is_written() {
        let d = tempfile::tempdir().unwrap();
        let home = d.path();
        std::fs::create_dir_all(home.join(".claude/skills/写了一半")).unwrap();
        let before = plan_for(home);
        assert!(before.dirs.contains(&home.join(".claude/skills")));
        assert!(before.dirs.contains(&home.join(".claude/skills/写了一半")));
        assert!(before.relevant(&home.join(".claude/skills/写了一半/SKILL.md")));
        assert!(before.relevant(&home.join(".claude/skills/又一个")));
        assert!(!before.relevant(&home.join(".claude/skills/.DS_Store")));

        // 什么都没变就不换监视；多了一个目录就换
        assert!(!needs_rewatch(&before, &plan_for(home)));
        std::fs::create_dir_all(home.join(".claude/skills/又一个")).unwrap();
        let after = plan_for(home);
        assert!(needs_rewatch(&before, &after));
        assert!(after.dirs.contains(&home.join(".claude/skills/又一个")));
    }

    /// 往上找盯哪一层：home 底下的找到 home 为止；别处的只看上一层；根从来不盯
    #[test]
    fn the_folder_watched_for_a_missing_one_stays_close() {
        let d = tempfile::tempdir().unwrap();
        let home = d.path().join("home");
        let elsewhere = d.path().join("work");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&elsewhere).unwrap();
        assert_eq!(
            nearest_dir(&home.join(".gemini/config/skills"), &home),
            Some(home.clone())
        );
        // 换到 home 以外的：上一层在就盯它，不在就不再往上找
        assert_eq!(
            nearest_dir(&elsewhere.join("skills"), &home),
            Some(elsewhere.clone())
        );
        assert_eq!(nearest_dir(&elsewhere.join("gone/skills"), &home), None);
        assert_eq!(nearest_dir(Path::new("/nope"), &home), None);
    }

    #[tokio::test]
    async fn a_new_skill_folder_produces_a_signal() {
        let d = tempfile::tempdir().unwrap();
        let home = d.path();
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        std::fs::write(home.join(".claude/settings.json"), "{}").unwrap();
        let (_w, mut rx) = watch_plan(&plan_for(home)).unwrap();
        std::fs::create_dir_all(home.join(".claude/skills/新的")).unwrap();
        assert!(
            matches!(
                tokio::time::timeout(Duration::from_secs(5), rx.recv()).await,
                Ok(Some(()))
            ),
            "新装的 skill 没叫醒它"
        );
    }
}
