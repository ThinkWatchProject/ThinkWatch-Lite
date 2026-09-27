//! 开着的通知落盘。
//!
//! **为了两件事**：关窗期间发生的事，下次开窗要还在；core 或者应用重启之后，
//! 同一件事不要再说一遍（core 进程里的「已经报过」集合重启就清空了）。
//!
//! 读不出来就当作空的 —— 一份坏掉的通知记录不该挡住应用启动。
//!
//! **写是整份换上去的，而且排着队。**写到一半退出，留下的是上一份完整的记录
//! （[`crate::atomic_file`]），而不是半份 —— 半份读出来就是整个列表没了。几处同时有
//! 改动时，后写完的不会是更旧的那一份（[`Store::save`]）。

use std::path::PathBuf;
use std::sync::Mutex;

use super::Notice;

pub struct Store {
    file: PathBuf,
    /// 盘上那一份是第几份。**只往前走**
    written: Mutex<u64>,
}

impl Store {
    pub fn new(file: PathBuf) -> Self {
        Self {
            file,
            written: Mutex::new(0),
        }
    }

    pub fn load(&self) -> Vec<Notice> {
        let Ok(text) = std::fs::read_to_string(&self.file) else {
            return Vec::new();
        };
        serde_json::from_str(&text).unwrap_or_else(|e| {
            tracing::debug!("通知记录读不出来，按空的算：{e}");
            Vec::new()
        })
    }

    /// 写下第 `seq` 份。号是取这一份的时候在同一把锁里编的，号越大这一份越新。
    ///
    /// **排着队写，旧的不盖新的**：以前是各自取一份、各自去写，两处同时有改动时，
    /// 先取的那一份可能后写完 —— 更旧的列表盖掉了更新的，下次启动读到的就是它。现在
    /// 排到的时候盘上已经是更新的一份，这一份就不写了
    pub fn save(&self, seq: u64, all: &[Notice]) {
        let mut written = self.written.lock().expect("锁未中毒");
        if *written >= seq {
            return;
        }
        let Ok(text) = serde_json::to_vec(all) else {
            return;
        };
        // 写不进去只是下次重启少一份记录，不值得打断任何事
        match crate::atomic_file::write(&self.file, &text) {
            Ok(()) => *written = seq,
            Err(e) => tracing::debug!("通知记录写不进去：{e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::super::{Level, Mode, Notices, Signal};
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "tw-notice-store-{}-{name}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn notice(key: &str) -> Notice {
        Notice {
            key: key.into(),
            level: Level::Warning,
            title: key.into(),
            body: String::new(),
            view: None,
            first_at_ms: 1,
            at_ms: 1,
            count: 1,
            notified: false,
            read: false,
        }
    }

    fn keys(all: &[Notice]) -> Vec<String> {
        let mut k: Vec<String> = all.iter().map(|n| n.key.clone()).collect();
        k.sort();
        k
    }

    /// 先取的那一份后排到：它比盘上的旧，**不该盖掉**
    #[test]
    fn an_older_snapshot_never_overwrites_a_newer_one() {
        let dir = tmp("order");
        let s = Store::new(dir.join("notices.json"));
        s.save(2, &[notice("b")]);
        s.save(1, &[notice("a")]);
        assert_eq!(keys(&s.load()), ["b"]);
        s.save(3, &[notice("c")]);
        assert_eq!(keys(&Store::new(dir.join("notices.json")).load()), ["c"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// 几个线程同时往总线上报：**最后落盘的就是列表此刻的样子**，一条不少
    #[test]
    fn after_changes_from_many_threads_the_file_is_what_is_listed() {
        let dir = tmp("threads");
        let bus: Arc<Notices> = Notices::new(Vec::new(), Some(dir.clone()), Mode::App);
        std::thread::scope(|scope| {
            for t in 0..8 {
                let bus = bus.clone();
                scope.spawn(move || {
                    for i in 0..20 {
                        bus.ingest(
                            Signal::raised(format!("proxy:{t}-{i}"), Level::Warning, "x").now(),
                            1_700_000_000_000 + i,
                        );
                    }
                });
            }
        });
        let on_disk = Store::new(dir.join("notices.json")).load();
        assert_eq!(on_disk.len(), 160);
        assert_eq!(keys(&on_disk), keys(&bus.list()));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// 读不出来（写到一半的旧文件、别的东西）按空的算，不挡启动
    #[test]
    fn a_broken_file_reads_as_empty() {
        let dir = tmp("broken");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("notices.json"), "[{\"key\":\"a\",").unwrap();
        assert!(Store::new(dir.join("notices.json")).load().is_empty());
        assert!(Store::new(dir.join("missing.json")).load().is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
