//! YAML 的外科手术，靠 [`tw_yaml`] 的 span-to-patch。
//!
//! 覆盖面比 JSON 和 TOML 窄，而且是**故意**的：这里只改映射里的标量键。
//! 顶层的扁平键（Aider 的 `.aider.conf.yml`，`openai-api-base` 这类）走最
//! 早那条路：原地替换或者追加一行。嵌套的键（dsh 凭据文件里的
//! `refs.THINKWATCH_API_KEY`）交给 [`tw_yaml::insert`] / [`tw_yaml::remove_key`]
//! —— 它们缺的中间层一起补、删空了的父映射一起删，每次写完都在内存里重新解析、
//! 核对目标之外的节点一个都没变。
//!
//! Continue 那种「往 `models:` 列表里塞一个新条目」仍然不在这条路上（见
//! [`crate::clients`] 里它为什么只给指引）；按 `id` 定位列表行的是
//! [`crate::rows`]，那是 dsh 补丁文件专用的一种形状。
//!
//! **宁可少支持一个客户端，也不要写一个我们自己没把握的结构性改写。**
//! 这个文件会去改用户的配置，出错的代价不是「功能没做」而是「他的东西
//! 被弄坏了」。

use tw_yaml::{PatchError, Scalar, Step};

use crate::json::Val;

#[derive(Debug, thiserror::Error)]
pub enum YErr {
    #[error("{0}")]
    Patch(#[from] PatchError),
    #[error("only scalar fields can be written, and {0} is not one")]
    NotScalar(String),
}

fn steps(path: &[&str]) -> Vec<Step> {
    path.iter().map(|k| Step::Key(k.to_string())).collect()
}

/// 要写的值渲染成哪种标量。**数字就写成数字**：dsh 凭据文件的 `version: 1`
/// 写成 `'1'` 是一个字符串，它会拒绝整个文件。
fn scalar(path: &[&str], v: &Val) -> Result<Scalar, YErr> {
    match v {
        Val::Str(s) => Ok(Scalar::s(s)),
        Val::Bool(b) => Ok(Scalar::Bool(*b)),
        Val::Num(n) => n
            .parse()
            .map(Scalar::Int)
            .map_err(|_| YErr::NotScalar(path.join("."))),
        Val::Null => Ok(Scalar::Null),
        Val::Arr(_) | Val::Obj(_) => Err(YErr::NotScalar(path.join("."))),
    }
}

pub fn get(text: &str, path: &[&str]) -> Result<Option<String>, YErr> {
    match tw_yaml::find(text, &steps(path)) {
        Ok(f) => Ok(Some(f.value)),
        Err(PatchError::NotFound { .. }) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// 写一个字段。已经有就原地替换，没有就**追加** —— 顶层的键追加到文件末尾，
/// 嵌套的键追加到父映射末尾。不去猜该插在哪一行之间，那样只会打乱用户自己
/// 排的顺序。
pub fn set(text: &str, path: &[&str], value: &Val) -> Result<String, YErr> {
    let v = scalar(path, value)?;
    if path.len() > 1 {
        return Ok(tw_yaml::insert(text, &steps(path), &v)?);
    }
    let step = steps(path);
    match tw_yaml::find(text, &step) {
        Ok(_) => Ok(tw_yaml::set(text, &step, &v)?),
        Err(PatchError::NotFound { .. }) => {
            let mut out = text.to_string();
            if !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
            let rendered = match &v {
                Scalar::Str(s) => format!("'{}'", s.replace('\'', "''")),
                other => other.as_yaml_text(),
            };
            out.push_str(&format!("{}: {rendered}\n", path[0]));
            Ok(out)
        }
        Err(e) => Err(e.into()),
    }
}

/// 删掉一个字段。
///
/// 顶层的键：把它那一行整行拿掉，只处理「键和值在同一行」的情形 —— 多行值
/// （块标量、嵌套映射）不碰，原样返回。我们自己写进去的永远是单行，所以还原时
/// 够用；碰上不是我们写的形状，宁可不动。嵌套的键交给 [`tw_yaml::remove_key`]。
pub fn remove(text: &str, path: &[&str]) -> Result<String, YErr> {
    if path.len() > 1 {
        return match tw_yaml::remove_key(text, &steps(path)) {
            Ok(out) => Ok(out),
            Err(PatchError::NotFound { .. }) => Ok(text.to_string()),
            Err(e) => Err(e.into()),
        };
    }
    let k = path.first().copied().unwrap_or_default();
    let found = match tw_yaml::find(text, &steps(path)) {
        Ok(f) => f,
        Err(PatchError::NotFound { .. }) => return Ok(text.to_string()),
        Err(e) => return Err(e.into()),
    };
    let line_start = text[..found.bytes.start]
        .rfind('\n')
        .map(|i| i + 1)
        .unwrap_or(0);
    let line_end = text[found.bytes.end..]
        .find('\n')
        .map(|i| found.bytes.end + i + 1)
        .unwrap_or(text.len());
    // 键必须就在这一行的开头（允许前导空白）—— 否则这是个嵌套或者
    // 多行的形状，不是我们写的那种
    if !text[line_start..found.bytes.start]
        .trim_start()
        .starts_with(k)
    {
        return Ok(text.to_string());
    }
    let mut out = String::with_capacity(text.len());
    out.push_str(&text[..line_start]);
    out.push_str(&text[line_end..]);
    Ok(out)
}

/// 把这几个顶层键底下的每个标量值都换成 `mask`，其余原样。给界面上的 diff 用：
/// dsh 的凭据文件整份都是密钥（`refs` 里是用户自己的 API key，`records` 里是
/// 登录拿到的令牌），**一个都不该出现在截图里**。
///
/// 解析不了就整份换成 `mask` —— 宁可 diff 看不清，也不把一份认不出形状的
/// 密钥文件原样摆出来。
pub fn mask_under(text: &str, roots: &[&str], mask: &str) -> String {
    let Ok(nodes) = tw_yaml::nodes(text) else {
        return mask.to_string();
    };
    let mut spans: Vec<_> = nodes
        .iter()
        .filter(|n| matches!(n.kind, tw_yaml::NodeKind::Scalar { .. }))
        .filter(|n| {
            n.path.len() > 1
                && matches!(n.path.first(), Some(Step::Key(k)) if roots.contains(&k.as_str()))
        })
        .map(|n| n.bytes.clone())
        .filter(|b| !b.is_empty())
        .collect();
    // 哨兵注释里记着的原值（`# was refs.X: …`）也是密钥
    let mut at = 0;
    for line in text.split_inclusive('\n') {
        if let Some(rest) = line.strip_prefix("# was ")
            && roots.iter().any(|r| rest.starts_with(&format!("{r}.")))
            && let Some(colon) = rest.find(": ")
        {
            let start = at + "# was ".len() + colon + 2;
            let end = at + line.trim_end_matches(['\n', '\r']).len();
            if start < end {
                spans.push(start..end);
            }
        }
        at += line.len();
    }
    spans.sort_by_key(|b| std::cmp::Reverse(b.start));
    let mut out = text.to_string();
    for b in spans {
        out.replace_range(b, mask);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_existing_field_is_replaced_in_place() {
        let src = "# 我的 aider 配置\nmodel: gpt-4o\nopenai-api-base: https://api.openai.com/v1\ndark-mode: true\n";
        let out = set(
            src,
            &["openai-api-base"],
            &Val::s("http://127.0.0.1:8080/v1"),
        )
        .unwrap();
        assert!(out.contains("# 我的 aider 配置"), "{out}");
        assert!(out.contains("dark-mode: true"), "{out}");
        assert!(out.contains("127.0.0.1:8080"), "{out}");
        assert!(!out.contains("api.openai.com"), "{out}");
    }

    #[test]
    fn a_missing_field_is_appended_rather_than_guessed_into_place() {
        let src = "model: gpt-4o\n";
        let out = set(
            src,
            &["openai-api-base"],
            &Val::s("http://127.0.0.1:8080/v1"),
        )
        .unwrap();
        assert_eq!(
            out,
            "model: gpt-4o\nopenai-api-base: 'http://127.0.0.1:8080/v1'\n"
        );
    }

    #[test]
    fn a_file_without_a_trailing_newline_still_gets_a_well_formed_line() {
        let out = set("model: gpt-4o", &["k"], &Val::s("v")).unwrap();
        assert_eq!(out, "model: gpt-4o\nk: 'v'\n");
    }

    #[test]
    fn removing_takes_the_whole_line_and_leaves_the_neighbours() {
        let src = "model: gpt-4o\nopenai-api-base: 'http://x'\ndark-mode: true\n";
        assert_eq!(
            remove(src, &["openai-api-base"]).unwrap(),
            "model: gpt-4o\ndark-mode: true\n"
        );
    }

    #[test]
    fn a_round_trip_puts_the_file_back_exactly() {
        let src = "# 注释\nmodel: gpt-4o\n";
        let with = set(src, &["openai-api-base"], &Val::s("http://x")).unwrap();
        assert_eq!(remove(&with, &["openai-api-base"]).unwrap(), src);
    }

    #[test]
    fn removing_something_absent_is_not_an_error() {
        let src = "model: gpt-4o\n";
        assert_eq!(remove(src, &["nope"]).unwrap(), src);
    }

    #[test]
    fn a_nested_key_is_added_under_its_parent_and_removed_with_it() {
        // dsh 的凭据文件：密钥是 `refs` 底下的一个键，版本号是个数字
        let src = "version: 1\n# 自己的密钥\nrefs:\n  DEEPSEEK_API_KEY: sk-mine\n";
        let out = set(src, &["refs", "THINKWATCH_API_KEY"], &Val::s("tw-k")).unwrap();
        assert_eq!(
            out,
            "version: 1\n# 自己的密钥\nrefs:\n  DEEPSEEK_API_KEY: sk-mine\n  THINKWATCH_API_KEY: tw-k\n"
        );
        assert_eq!(
            get(&out, &["refs", "THINKWATCH_API_KEY"]).unwrap(),
            Some("tw-k".into())
        );
        assert_eq!(remove(&out, &["refs", "THINKWATCH_API_KEY"]).unwrap(), src);
    }

    #[test]
    fn a_missing_parent_is_written_along_with_the_key() {
        let out = set("", &["version"], &Val::Num("1".into())).unwrap();
        assert_eq!(out, "version: 1\n", "数字不加引号，加了就是字符串");
        let out = set(&out, &["refs", "K"], &Val::s("v")).unwrap();
        assert_eq!(
            crate::yamlval::value(&out).unwrap(),
            crate::yamlval::value("version: 1\nrefs:\n  K: v\n").unwrap()
        );
        // 删掉最后一个键，空了的 `refs:` 一起走
        let back = remove(&out, &["refs", "K"]).unwrap();
        assert_eq!(back, "version: 1\n");
    }

    #[test]
    fn a_container_is_refused_out_loud_instead_of_half_done() {
        // 这一层只写标量。**说出来**，而不是写出一个我们没把握的结构。
        assert!(matches!(
            set("a: 1\n", &["a"], &Val::Obj(Vec::new())),
            Err(YErr::NotScalar(_))
        ));
    }

    #[test]
    fn multibyte_content_is_not_sliced_in_half() {
        // tw-yaml 的 marker 是按 char 数的，按它切 &str 会 panic。
        // 这个项目已经被这一类坑过三次。
        let src = "# 中文注释\n模型: 通义千问\nopenai-api-base: 'http://旧地址'\n";
        let out = set(src, &["openai-api-base"], &Val::s("http://新地址")).unwrap();
        assert!(out.contains("模型: 通义千问"), "{out}");
        assert!(out.contains("http://新地址"), "{out}");
        let back = remove(&out, &["openai-api-base"]).unwrap();
        assert_eq!(back, "# 中文注释\n模型: 通义千问\n");
    }

    #[test]
    fn a_value_with_a_quote_in_it_is_escaped() {
        let out = set("a: 1\n", &["k"], &Val::s("it's")).unwrap();
        assert_eq!(get(&out, &["k"]).unwrap(), Some("it's".to_string()));
    }

    #[test]
    fn every_value_under_the_secret_sections_is_masked() {
        let src = "# was refs.T: sk-旧\n# no version originally\nversion: 1\nrefs:\n  A: sk-一\n  B: 'sk-二'  # 注释\nrecords:\n  x/y:\n    token: t\n";
        assert_eq!(
            mask_under(src, &["refs", "records"], "***"),
            "# was refs.T: ***\n# no version originally\nversion: 1\nrefs:\n  A: ***\n  B: ***  # 注释\nrecords:\n  x/y:\n    token: ***\n"
        );
    }
}
