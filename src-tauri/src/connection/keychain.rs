//! 远程连接的控制面密钥：放进系统的钥匙串。
//!
//! macOS 是钥匙串，Windows 是凭据管理器，Linux 是 Secret Service（GNOME 钥匙串、
//! KWallet）。**不进设置文件，也不交给界面**：界面只在添加、更换时把用户粘进来的那一串
//! 递过来一次，之后再也拿不回去 —— 编辑对话框里显示的是「已保存在钥匙串中」。

/// 钥匙串里这一项归谁
const SERVICE: &str = "ThinkWatch Lite";

fn entry(id: &str) -> anyhow::Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, &format!("control-key:{id}"))?)
}

/// 用户粘进来的那一串整理成密钥：去掉首尾空白、统一成小写。**不是 64 位十六进制就不收**
/// —— 服务器那边也只认这种，收下一把短的只会在连接时换来一句「密钥不正确」
pub fn normalize(raw: &str) -> Option<String> {
    let k = raw.trim().to_ascii_lowercase();
    (k.len() == 64 && k.chars().all(|c| c.is_ascii_hexdigit())).then_some(k)
}

pub fn store(id: &str, key: &str) -> anyhow::Result<()> {
    entry(id)?.set_password(key)?;
    Ok(())
}

pub fn load(id: &str) -> anyhow::Result<String> {
    Ok(entry(id)?.get_password()?)
}

/// 删掉这一项。**本来就没有不算错**：连接删了，钥匙串那边早被用户清过也无妨
pub fn remove(id: &str) -> anyhow::Result<()> {
    match entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_64_hex_characters_are_a_key() {
        let k = "9F2C".repeat(16);
        assert_eq!(normalize(&format!("  {k}\n")), Some(k.to_ascii_lowercase()));
        assert_eq!(normalize("abc"), None);
        assert_eq!(normalize(&"g".repeat(64)), None);
        assert_eq!(normalize(&"a".repeat(65)), None);
    }
}
