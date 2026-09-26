//! 远程连接的控制面密钥：存在这台电脑的数据目录里，一个只有自己能读的文件。
//!
//! **不用系统钥匙串。**macOS 上钥匙串会为这一项弹框要登录密码（未签名的应用每次
//! 更新之后还会再问），为一把随时能在服务器上重新抄一遍的密钥打断用户不值得；三个
//! 平台各有一套钥匙串接口，也意味着三条各自出错、各自没人测的路。现在只有一条：
//! 数据目录（unix `0700`、Windows 受保护的 DACL，见 `crate::private_dir`）里的一个
//! `0600` 文件 —— 和 config.yaml 里明文的上游 API key 是同一个保护等级。
//!
//! **另放一个文件，不写进 `connections.json`**：那份列表时常被改写（上次连接的时刻、
//! 上次用的是哪条），界面要的连接列表也从它来；密钥单独放，改列表的每一次写入都碰
//! 不到它，读列表的代码也拿不到它。编辑对话框要回填时按连接 id 单独取一次
//! （`connection_key`），原值给界面，由界面默认隐藏。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const FILE: &str = "connection-keys.json";

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

/// 用户粘进来的那一串整理成密钥：去掉首尾空白、统一成小写。**不是 64 位十六进制就不收**
/// —— 服务器那边也只认这种，收下一把短的只会在连接时换来一句「密钥不正确」
pub fn normalize(raw: &str) -> Option<String> {
    let k = raw.trim().to_ascii_lowercase();
    (k.len() == 64 && k.chars().all(|c| c.is_ascii_hexdigit())).then_some(k)
}

/// 连接 id → 密钥。**文件不在就是空的**：还没添加过远程连接
fn read_all(dir: &Path) -> anyhow::Result<BTreeMap<String, String>> {
    match std::fs::read(path(dir)) {
        Ok(b) => Ok(serde_json::from_slice(&b)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(e) => Err(e.into()),
    }
}

/// 整份写回。**从建出来那一刻就是 `0600`**：先写一个同样 `0600` 的临时文件，再改名
/// 换上去 —— 不是写完再 `chmod`（中间有一个按 umask 谁都能读的窗口），写到一半断电
/// 留下的也是旧的那份
fn write_all(dir: &Path, keys: &BTreeMap<String, String>) -> anyhow::Result<()> {
    use std::io::Write;
    crate::private_dir::create(dir)?;
    let tmp = dir.join(format!("{FILE}.tmp"));
    let _ = std::fs::remove_file(&tmp);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&tmp)?;
    let mut text = serde_json::to_vec_pretty(keys)?;
    text.push(b'\n');
    f.write_all(&text)?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, path(dir))?;
    Ok(())
}

pub fn store(dir: &Path, id: &str, key: &str) -> anyhow::Result<()> {
    let mut all = read_all(dir)?;
    all.insert(id.to_string(), key.to_string());
    write_all(dir, &all)
}

pub fn load(dir: &Path, id: &str) -> anyhow::Result<String> {
    read_all(dir)?
        .remove(id)
        .ok_or_else(|| anyhow::anyhow!("no key is saved for connection {id}"))
}

/// 删掉这一条。**本来就没有不算错**
pub fn remove(dir: &Path, id: &str) -> anyhow::Result<()> {
    let mut all = read_all(dir)?;
    if all.remove(id).is_some() {
        write_all(dir, &all)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("tw-secrets-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn only_64_hex_characters_are_a_key() {
        let k = "9F2C".repeat(16);
        assert_eq!(normalize(&format!("  {k}\n")), Some(k.to_ascii_lowercase()));
        assert_eq!(normalize("abc"), None);
        assert_eq!(normalize(&"g".repeat(64)), None);
        assert_eq!(normalize(&"a".repeat(65)), None);
    }

    #[test]
    fn keys_are_stored_per_connection_and_removed() {
        let dir = tmp("trip");
        store(&dir, "a1", &"a".repeat(64)).unwrap();
        store(&dir, "b2", &"b".repeat(64)).unwrap();
        store(&dir, "a1", &"c".repeat(64)).unwrap();
        assert_eq!(load(&dir, "a1").unwrap(), "c".repeat(64));
        assert_eq!(load(&dir, "b2").unwrap(), "b".repeat(64));
        remove(&dir, "a1").unwrap();
        assert!(load(&dir, "a1").is_err());
        remove(&dir, "a1").unwrap();
        assert_eq!(load(&dir, "b2").unwrap(), "b".repeat(64));
    }

    /// 文件和（新建的）目录都只给自己
    #[cfg(unix)]
    #[test]
    fn the_file_is_private_from_the_start() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tmp("mode").join("data");
        store(&dir, "a1", &"a".repeat(64)).unwrap();
        store(&dir, "a2", &"b".repeat(64)).unwrap();
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&path(&dir)), 0o600);
        assert_eq!(mode(&dir), 0o700);
        assert!(!dir.join(format!("{FILE}.tmp")).exists());
    }

    /// 连接列表那份文件里没有密钥：两份分开放
    #[test]
    fn the_list_file_never_sees_a_key() {
        let dir = tmp("apart");
        store(&dir, "a1", &"e".repeat(64)).unwrap();
        crate::connection::store::save(&dir, &crate::connection::store::Connections::default())
            .unwrap();
        let list = std::fs::read_to_string(dir.join("connections.json")).unwrap();
        assert!(!list.contains(&"e".repeat(64)));
    }
}
