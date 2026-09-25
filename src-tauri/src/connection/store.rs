//! 连接列表：存在应用自己的数据目录里，**不是网关的配置**。
//!
//! 界面外壳不能依赖 core —— 远程连不上时，连接列表、切换入口照样要能显示、能操作，
//! 所以它归应用自己保存（和 `prefs.rs` 同一个目录，另一个文件）。**密钥不在这里**：
//! 另存一个只有自己能读的文件（`secrets.rs`），这个文件里只有名字和地址。
//!
//! 「本机」不存：它是内置的、删不掉，列表里永远有它。

use std::path::{Path, PathBuf};

/// 设置文件，放在数据目录里
const FILE: &str = "connections.json";

/// 「本机」的 id。**远程连接的 id 不会是它**：那些是随机生成的
pub const LOCAL: &str = "local";

/// 「本机」那一条叫什么。中文一律「本机」；英文**按平台**：macOS 上是「This Mac」，
/// Windows、Linux 上是「This computer」。
///
/// 应用这一侧说到它都从这里取：连接列表、菜单栏和托盘的「连接」子菜单、连不上本机时的
/// 那一句。界面自己按语言写（`src/connection/describe.tsx` 的 `profileName`，写法和这里
/// 一样）：换语言时界面当场换，不等下一次推送
pub fn local_name() -> &'static str {
    tr!(
        "本机",
        if cfg!(target_os = "macos") {
            "This Mac"
        } else {
            "This computer"
        }
    )
}

/// 一条远程连接
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Remote {
    /// 随机生成，不随改名变。保存的密钥按它找
    pub id: String,
    pub name: String,
    /// 主机名或 IP
    pub host: String,
    /// 服务器配置里 `listen.control.remote.port` 的值
    pub port: u16,
    /// 上一次连上是什么时候（毫秒）。没连上过是 None
    pub last_connected_at: Option<u64>,
}

/// 启动时连哪个
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Startup {
    /// 上次用的那个。**出厂是它**：以服务器为主的人不用每次再切一遍
    #[default]
    Last,
    /// 永远先连本机
    Local,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Connections {
    pub remotes: Vec<Remote>,
    /// 最近一次用的连接。切换成功才改它
    pub last_used: String,
    pub startup: Startup,
}

impl Default for Connections {
    fn default() -> Self {
        Self {
            remotes: Vec::new(),
            last_used: LOCAL.to_string(),
            startup: Startup::Last,
        }
    }
}

impl Connections {
    pub fn remote(&self, id: &str) -> Option<&Remote> {
        self.remotes.iter().find(|r| r.id == id)
    }

    /// 这次启动该连哪个。上次用的那一条已经被删了，就是本机
    pub fn startup_target(&self) -> String {
        match self.startup {
            Startup::Local => LOCAL.to_string(),
            Startup::Last if self.remote(&self.last_used).is_some() => self.last_used.clone(),
            Startup::Last => LOCAL.to_string(),
        }
    }

    /// 名字有没有被别的连接用掉（大小写不分）。「本机」也算一个名字
    pub fn name_taken(&self, name: &str, except: Option<&str>) -> bool {
        let n = name.trim().to_lowercase();
        let local_names = ["本机", "this mac", "this computer", "local"];
        local_names.contains(&n.as_str())
            || self
                .remotes
                .iter()
                .any(|r| Some(r.id.as_str()) != except && r.name.trim().to_lowercase() == n)
    }
}

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

/// 读列表。**读不出来就是只有本机**：文件不在（第一次运行）和文件坏了，对用户的意义
/// 一样 —— 为一份列表让应用起不来，代价不对。密钥在另一个文件里，不会跟着丢
pub fn load(dir: &Path) -> Connections {
    std::fs::read(path(dir))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, c: &Connections) -> anyhow::Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut text = serde_json::to_vec_pretty(c)?;
    text.push(b'\n');
    // 先写临时文件再改名：写到一半断电，留下的是旧的那份而不是半份
    let tmp = dir.join(format!("{FILE}.tmp"));
    std::fs::write(&tmp, text)?;
    std::fs::rename(tmp, path(dir))?;
    Ok(())
}

/// 改一处，其余照旧
pub fn update<T>(dir: &Path, f: impl FnOnce(&mut Connections) -> T) -> anyhow::Result<T> {
    let mut c = load(dir);
    let out = f(&mut c);
    save(dir, &c)?;
    Ok(out)
}

/// 新连接的 id：16 个十六进制字符
pub fn new_id() -> String {
    let mut b = [0u8; 8];
    rand::fill(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("tw-conns-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn remote(id: &str, name: &str) -> Remote {
        Remote {
            id: id.into(),
            name: name.into(),
            host: "192.168.1.20".into(),
            port: 8789,
            last_connected_at: None,
        }
    }

    #[test]
    fn with_no_file_there_is_only_this_mac() {
        let dir = tmp("none");
        let c = load(&dir);
        assert!(c.remotes.is_empty());
        assert_eq!(c.startup_target(), LOCAL);
    }

    #[test]
    fn a_corrupt_file_falls_back_to_this_mac() {
        let dir = tmp("corrupt");
        std::fs::write(path(&dir), b"{ nope").unwrap();
        assert_eq!(load(&dir), Connections::default());
    }

    #[test]
    fn the_list_survives_a_round_trip() {
        let dir = tmp("trip");
        let want = Connections {
            remotes: vec![remote("a1", "home-server")],
            last_used: "a1".into(),
            startup: Startup::Last,
        };
        save(&dir, &want).unwrap();
        assert_eq!(load(&dir), want);
    }

    /// 出厂是「上次使用的连接」；上次那一条删掉了，就回到本机
    #[test]
    fn startup_follows_the_last_used_connection_while_it_exists() {
        let mut c = Connections {
            remotes: vec![remote("a1", "home-server")],
            last_used: "a1".into(),
            startup: Startup::default(),
        };
        assert_eq!(c.startup_target(), "a1");
        c.startup = Startup::Local;
        assert_eq!(c.startup_target(), LOCAL);
        c.startup = Startup::Last;
        c.remotes.clear();
        assert_eq!(c.startup_target(), LOCAL);
    }

    #[test]
    fn names_are_unique_and_this_mac_is_taken() {
        let c = Connections {
            remotes: vec![remote("a1", "home-server")],
            ..Default::default()
        };
        assert!(c.name_taken("Home-Server ", None));
        assert!(
            !c.name_taken("home-server", Some("a1")),
            "改自己的名字不算重名"
        );
        assert!(c.name_taken("本机", None));
        assert!(!c.name_taken("office-nas", None));
    }

    /// 英文按平台叫：Windows、Linux 上写「This Mac」是错的。叫什么都不能被远程连接拿去用
    #[test]
    fn the_local_connection_is_named_for_this_platform() {
        use crate::i18n::{Lang, with_lang};
        assert_eq!(with_lang(Lang::Zh, local_name), "本机");
        let en = with_lang(Lang::En, local_name);
        #[cfg(target_os = "macos")]
        assert_eq!(en, "This Mac");
        #[cfg(not(target_os = "macos"))]
        assert_eq!(en, "This computer");
        for name in ["本机", en] {
            assert!(Connections::default().name_taken(name, None), "{name}");
        }
    }

    /// 密钥永远不进这个文件
    #[test]
    fn the_file_has_no_key_field() {
        let text = serde_json::to_string(&Connections {
            remotes: vec![remote("a1", "x")],
            ..Default::default()
        })
        .unwrap();
        assert!(!text.contains("key"), "{text}");
    }

    #[test]
    fn ids_are_random_and_never_local() {
        let (a, b) = (new_id(), new_id());
        assert_eq!(a.len(), 16);
        assert_ne!(a, b);
        assert_ne!(a, LOCAL);
    }
}
