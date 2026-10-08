/// 标出一个消息码：原样给出那个字面量。
///
/// **表里的码都要用它包起来。**`msg!` 以外造 [`tw_types::Msg`] 的地方（接管的
/// 代价、手动配置的步骤、MCP 写不了的理由）码和句子分开存在表里，桌面端的码清单
/// 测试（`src-tauri/tests/msg_codes.rs`）靠这个记号在源码里找到它们 ——
/// 少了它，那个码就不在拿去对照译文的清单上。
macro_rules! code {
    ($c:literal) => {
        $c
    };
}

pub mod clients;
pub mod cloud;
pub mod desktop;
pub mod detect;
pub mod foreign;
pub mod grok;
pub mod hermes;
pub mod json;
pub mod locations;
pub mod mcp;
pub mod opencode;
pub mod paths;
pub mod pi;
pub mod plan;
pub mod qwen;
pub mod rows;
pub mod sentinel;
pub mod toml;
pub mod wsl;
pub mod wslconfig;
pub mod yaml;
pub mod yamlval;

/// 现在，Unix 毫秒：备份的目录名、接管记录的时刻、客户端进程起了多久
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 以 0 结尾的 UTF-16，交给 Windows 的 `…W` 函数（路径、注册表的键和值名）
#[cfg(windows)]
pub(crate) fn wide(s: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    s.as_ref().encode_wide().chain(std::iter::once(0)).collect()
}
