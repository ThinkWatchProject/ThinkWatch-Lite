//! 控制面的凭据，这一次启动用的那一个。
//!
//! # 为什么由这一侧生成
//!
//! 桌面端**自己 spawn core，从不接管已经在跑的**。所以「这一次的凭据是什么」
//! 由这边说了算，core 从环境变量里接（[`tw_api::control::TOKEN_ENV`]）。
//!
//! **走环境变量，不走 argv** —— Windows 上任意同用户进程都看得见别人的命令行。
//! **也不落盘**：core 手工启动时才需要那个文件，而这条路上没有人要读它。
//!
//! # 为什么每次启动换一个
//!
//! 它只需要活到这一对进程结束。留着不会更安全，只会多一份要保管的东西。
//!
//! # 为什么需要它
//!
//! macOS 上控制面是一个 `0700` 的 unix socket，权限是文件系统给的。Windows
//! 上没有对等物，那里控制面落在回环端口上，而本机任意进程都连得上一个回环
//! 端口、连上之后也问不出对端是谁。**那个平台上这个 token 是唯一的门。**
//! 两边走同一条路，因为只在一个平台上生效的防线没人日常测。

/// 生成这一次启动用的凭据：32 字节随机数，写成十六进制。
pub fn generate() -> String {
    let mut bytes = [0u8; 32];
    rand::fill(&mut bytes);
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write;
        let _ = write!(out, "{b:02x}");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_is_64_hex_characters_and_never_the_same_twice() {
        let a = generate();
        let b = generate();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b, "每次启动该换一个");
    }
}
