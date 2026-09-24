//! 命令失败时交给界面的那个东西。
//!
//! **一律是一条 [`tw_api::Msg`] 的形状（码 + 参数 + 原句），以对象交出去。**
//! 控制面的失败原样带着 core 的码，界面按码翻译；这一层自己造的失败（core
//! 不在、写不了文件）没有码，`code` 是空串，界面照 `text` 显示 —— 和前端
//! `plain()` 造出来的是同一种东西。
//!
//! 以前这里交的是字符串：控制面的失败是一段 JSON 文本，界面先看它是不是以
//! `{` 开头、再试着解析一次。那是在字符串里夹带结构，而一个结构本来可以直接
//! 交过去。

use std::collections::BTreeMap;

use crate::control::Refused;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(transparent)]
pub struct CmdError(tw_api::Msg);

/// 命令的返回值。
pub type Out<T> = Result<T, CmdError>;

impl CmdError {
    /// 一句没有码的话。
    pub fn plain(text: impl Into<String>) -> Self {
        Self(tw_api::Msg {
            code: String::new(),
            args: BTreeMap::new(),
            text: text.into(),
        })
    }
}

impl std::fmt::Display for CmdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0.text)
    }
}

/// **控制面拒绝的，交出 core 的那条原样的消息**，码不丢；别的失败连同上下文
/// 写成一句话。
impl From<anyhow::Error> for CmdError {
    fn from(e: anyhow::Error) -> Self {
        match e.downcast_ref::<Refused>() {
            Some(Refused(m)) => Self(m.clone()),
            None => Self::plain(format!("{e:#}")),
        }
    }
}

impl From<String> for CmdError {
    fn from(s: String) -> Self {
        Self::plain(s)
    }
}

impl From<&str> for CmdError {
    fn from(s: &str) -> Self {
        Self::plain(s)
    }
}

/// `.map_err(text)` 的那个 `text`：各页命令模块里的写法。
pub fn text(e: anyhow::Error) -> CmdError {
    e.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refusal_from_core_keeps_its_code_and_goes_out_as_an_object() {
        let m = tw_api::Msg {
            code: "config.edit.name_taken".into(),
            args: BTreeMap::from([("name".into(), "hk".into())]),
            text: "there is already an upstream named `hk`".into(),
        };
        let e: CmdError = anyhow::Error::new(Refused(m.clone())).into();
        let wire = serde_json::to_value(&e).unwrap();
        assert_eq!(wire["code"], "config.edit.name_taken");
        assert_eq!(wire["args"]["name"], "hk");
        assert_eq!(wire["text"], m.text);
    }

    #[test]
    fn anything_else_is_a_sentence_without_a_code() {
        let e: CmdError = anyhow::anyhow!("inner").context("outer").into();
        let wire = serde_json::to_value(&e).unwrap();
        assert_eq!(wire["code"], "");
        assert_eq!(wire["text"], "outer: inner");
        assert!(wire.get("args").is_none(), "{wire}");
    }
}
