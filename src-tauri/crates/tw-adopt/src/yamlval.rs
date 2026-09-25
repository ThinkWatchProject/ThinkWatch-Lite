//! 把一份 YAML 摊成可比较的语义值，给写回校验用。
//!
//! 标量一律读成字符串（`1` 和 `'1'` 在这里是同一个值）：校验要回答的是「除了
//! 我们点名的那几个字段，其余有没有变」，而 span 补丁本来就不碰别处的字节，
//! **结构变了的话路径本身就会变**，一样能被抓住。
//!
//! 按层级摊成嵌套的 [`Val`]，而不是「路径字符串 → 值」的一张平表：点名的字段
//! 可以在第二层（dsh 的 `refs.THINKWATCH_API_KEY`），校验拿 [`Val::with`] 叠
//! 预期改动时走的也是层级。

use tw_yaml::{NodeKind, Step};

use crate::json::Val;
use crate::yaml::YErr;

pub fn value(text: &str) -> Result<Val, YErr> {
    Ok(tree(text)?.unwrap_or(Val::Obj(Vec::new())))
}

/// 整份文档的值。空文档（只有注释）是 `None`。
pub fn tree(text: &str) -> Result<Option<Val>, YErr> {
    let mut root: Option<Val> = None;
    for n in tw_yaml::nodes(text)? {
        let v = match &n.kind {
            NodeKind::Scalar { value, .. } => Val::Str(value.clone()),
            NodeKind::Map => Val::Obj(Vec::new()),
            NodeKind::Seq => Val::Arr(Vec::new()),
            NodeKind::Alias => Val::Null,
        };
        match n.path.split_last() {
            None => root = Some(v),
            Some((last, parent)) => {
                if let Some(slot) = root.as_mut().and_then(|r| at(r, parent)) {
                    match (slot, last) {
                        (Val::Obj(ms), Step::Key(k)) => ms.push((k.clone(), v)),
                        (Val::Arr(es), Step::Index(_)) => es.push(v),
                        _ => {}
                    }
                }
            }
        }
    }
    Ok(root)
}

/// 顺着路径走到那个容器。节点按文档顺序来，父节点总在子节点之前建好。
fn at<'a>(v: &'a mut Val, path: &[Step]) -> Option<&'a mut Val> {
    let Some((head, rest)) = path.split_first() else {
        return Some(v);
    };
    let next = match (v, head) {
        (Val::Obj(ms), Step::Key(k)) => ms
            .iter_mut()
            .rev()
            .find(|(mk, _)| mk == k)
            .map(|m| &mut m.1),
        (Val::Arr(es), Step::Index(i)) => es.get_mut(*i),
        _ => None,
    }?;
    at(next, rest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_named_field_differs_after_a_patch() {
        let src = "model: gpt-4o\nopenai-api-base: 'http://old'\ndark: true\n";
        let out = crate::yaml::set(src, &["openai-api-base"], &Val::s("http://new")).unwrap();
        let expected = value(src)
            .unwrap()
            .with(&["openai-api-base"], &Val::s("http://new"));
        assert_eq!(value(&out).unwrap(), expected);
    }

    #[test]
    fn an_appended_field_shows_up_as_exactly_one_addition() {
        let src = "model: gpt-4o\n";
        let out = crate::yaml::set(src, &["openai-api-base"], &Val::s("http://new")).unwrap();
        let expected = value(src)
            .unwrap()
            .with(&["openai-api-base"], &Val::s("http://new"));
        assert_eq!(value(&out).unwrap(), expected);
    }

    #[test]
    fn nesting_and_lists_keep_their_shape() {
        let src = "refs:\n  A: '1'\nlist:\n  - x\n  - k: v\n";
        assert_eq!(
            value(src).unwrap(),
            Val::Obj(vec![
                ("refs".into(), Val::Obj(vec![("A".into(), Val::s("1"))])),
                (
                    "list".into(),
                    Val::Arr(vec![Val::s("x"), Val::Obj(vec![("k".into(), Val::s("v"))])])
                ),
            ])
        );
    }

    #[test]
    fn a_document_of_only_comments_is_empty() {
        assert_eq!(tree("# 只有注释\n").unwrap(), None);
        assert_eq!(value("").unwrap(), Val::Obj(Vec::new()));
    }
}
