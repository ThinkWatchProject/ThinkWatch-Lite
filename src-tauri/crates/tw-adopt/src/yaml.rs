//! YAML 的外科手术，靠 [`tw_yaml`] 的 span-to-patch。
//!
//! 覆盖面比 JSON 和 TOML 窄，而且是**故意**的：这里只改映射里的键，不在列表里增删项。
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
//! **整个换掉一个键的值**是另一回事：oh-my-pi 的 `providers.thinkwatch.models` 是我们
//! 自己那个 provider 底下的一张清单，写的时候整张换、还原时整张拿走，不在用户的列表里插
//! 一项。这一步交给 [`tw_yaml::put`] —— core 改 config.yaml 用的就是它：只动那个键那一段，
//! 写完重新解析，核对目标读回来就是给的那一段、目标之外一个节点都没变。
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

/// 一个容器值写成零缩进的块式 YAML，交给 [`tw_yaml::put`]。空的写成 `[]` / `{}`。
///
/// ```yaml
/// - id: claude-sonnet-5
///   api: anthropic-messages
/// - id: deepseek-chat
/// ```
fn block(v: &Val) -> String {
    fn inline(v: &Val) -> String {
        match v {
            Val::Str(s) => text(s),
            Val::Num(n) => n.clone(),
            Val::Bool(b) => b.to_string(),
            Val::Null => "~".into(),
            Val::Arr(_) => "[]".into(),
            Val::Obj(_) => "{}".into(),
        }
    }
    // 一个非空的容器：一行一项
    fn lines(v: &Val) -> Vec<String> {
        let nested = |head: String, x: &Val| -> Vec<String> {
            match x {
                Val::Arr(es) if !es.is_empty() => nest(head, x),
                Val::Obj(ms) if !ms.is_empty() => nest(head, x),
                _ => vec![format!("{head} {}", inline(x))],
            }
        };
        match v {
            Val::Obj(ms) => ms
                .iter()
                .flat_map(|(k, x)| nested(format!("{}:", text(k)), x))
                .collect(),
            Val::Arr(es) => es
                .iter()
                .flat_map(|x| match x {
                    // `- id: a` 接着 `  api: b`：第一行跟在短横后面，其余缩进两格
                    Val::Obj(ms) if !ms.is_empty() => dash(lines(x)),
                    Val::Arr(es) if !es.is_empty() => dash(lines(x)),
                    _ => vec![format!("- {}", inline(x))],
                })
                .collect(),
            _ => vec![inline(v)],
        }
    }
    // `键:` 下一行起缩进两格
    fn nest(head: String, x: &Val) -> Vec<String> {
        std::iter::once(head)
            .chain(lines(x).into_iter().map(|l| format!("  {l}")))
            .collect()
    }
    fn dash(ls: Vec<String>) -> Vec<String> {
        ls.into_iter()
            .enumerate()
            .map(|(i, l)| {
                if i == 0 {
                    format!("- {l}")
                } else {
                    format!("  {l}")
                }
            })
            .collect()
    }
    match v {
        Val::Arr(es) if es.is_empty() => "[]".into(),
        Val::Obj(ms) if ms.is_empty() => "{}".into(),
        _ => lines(v).join("\n"),
    }
}

/// 一个字符串在块里的写法：一眼看得出是安全的纯量就裸写（`anthropic-messages`、
/// `http://127.0.0.1:8788`），否则加单引号，带控制字符的用双引号转义。
///
/// **宁可多加引号。**裸写错了的代价是一份意思变了的文件：`yes`、`on` 会被读成布尔，
/// `0x10` 读成数，`1:30` 读成六十进制。所以只放行字母开头、只有字母数字和 `-_./:@+`
/// 的，看起来像布尔、空值、数的一律加引号；冒号后面跟空格的，这个字符集里本来就没有。
fn text(s: &str) -> String {
    const LOOKALIKE: &[&str] = &[
        "true", "false", "yes", "no", "on", "off", "y", "n", "null", "nil",
    ];
    let plain = s.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_./:@+".contains(&b))
        && !s.ends_with(':')
        && !LOOKALIKE.contains(&s.to_ascii_lowercase().as_str())
        && s.parse::<f64>().is_err();
    if plain {
        s.to_string()
    } else if s.chars().any(char::is_control) {
        // JSON 的双引号字符串也是 YAML 的双引号字符串
        serde_json::to_string(s).unwrap_or_else(|_| format!("'{}'", s.replace('\'', "''")))
    } else {
        format!("'{}'", s.replace('\'', "''"))
    }
}

pub fn get(text: &str, path: &[&str]) -> Result<Option<String>, YErr> {
    match tw_yaml::find(text, &steps(path)) {
        Ok(f) => Ok(Some(f.value)),
        Err(PatchError::NotFound { .. }) => Ok(None),
        // 一个容器（清单、映射）：给它的单行写法。接管记原值时要它 —— 原来就有一张同名
        // 清单的话，那是要还回去的东西
        Err(PatchError::NotScalar(_)) => {
            Ok(crate::plan::lookup(&crate::yamlval::value(text)?, path).map(|v| v.to_line()))
        }
        Err(e) => Err(e.into()),
    }
}

/// 写一个字段。已经有就原地替换，没有就**追加** —— 顶层的键追加到文件末尾，
/// 嵌套的键追加到父映射末尾。不去猜该插在哪一行之间，那样只会打乱用户自己
/// 排的顺序。
///
/// 值是一个容器的，整个换掉那个键的值（见开头那段），渲染见 [`block`]。
pub fn set(text: &str, path: &[&str], value: &Val) -> Result<String, YErr> {
    // 一个节点都没有的文件（空的、只有注释）：tw_yaml 找不到可以往里插的根。嵌套的键整段
    // 从顶层写出来，接在原文后面 —— oh-my-pi 的 `models.yml` 新建时第一项就是
    // `providers.thinkwatch.baseUrl`
    if path.len() > 1 && crate::yamlval::tree(text)?.is_none() {
        let nested = path
            .iter()
            .rev()
            .fold(value.clone(), |v, k| Val::Obj(vec![(k.to_string(), v)]));
        let mut out = text.to_string();
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&block(&nested));
        out.push('\n');
        return Ok(out);
    }
    if let Val::Arr(_) | Val::Obj(_) = value {
        let rendered = block(value);
        let put = if rendered.contains('\n') {
            tw_yaml::Put::Block(&rendered)
        } else {
            tw_yaml::Put::Inline(&rendered)
        };
        return Ok(tw_yaml::put(text, &steps(path), put)?);
    }
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
        return Ok(remove_nested(text, &steps(path))?);
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

/// 删掉一个嵌套的键。**不在就原样返回** —— 还原时先删的字段可能已经带走了
/// 空掉的父映射。
///
/// [`tw_yaml::remove_key`] 只认块式映射；键在行内映射里（`refs: {K: v}`）时它
/// 报「不在」，可键明明在 —— 照原样返回的话，还原就永远过不了写回校验，我们的
/// 密钥也一直留在文件里。而这正是我们自己写出来的形状：往 `refs: {}` 里补键，
/// `tw_yaml::insert` 写的就是 `refs: {K: v}`。这种情形在这里把那一项连同它的逗号
/// 摘掉，再核对其余节点一个没变。
pub(crate) fn remove_nested(text: &str, path: &[Step]) -> Result<String, PatchError> {
    match tw_yaml::remove_key(text, path) {
        Ok(out) => Ok(out),
        Err(PatchError::NotFound(why)) => match remove_from_flow(text, path)? {
            Some(out) => Ok(out),
            // 真的不在
            None if tw_yaml::find(text, path).is_err() => Ok(text.to_string()),
            None => Err(PatchError::NotFound(why)),
        },
        Err(e) => Err(e),
    }
}

/// 行内映射里的一项：摘掉它和它的逗号。不是行内映射里的键就是 `None`。
fn remove_from_flow(text: &str, path: &[Step]) -> Result<Option<String>, PatchError> {
    let Some((Step::Key(key), parent)) = path.split_last() else {
        return Ok(None);
    };
    let all = tw_yaml::nodes(text)?;
    if !all.iter().any(|n| n.path == path) {
        return Ok(None);
    }
    let Some(pn) = all.iter().find(|n| n.path == parent) else {
        return Ok(None);
    };
    if !matches!(pn.kind, tw_yaml::NodeKind::Map) || pn.anchored {
        return Ok(None);
    }
    let open = pn.bytes.start;
    if text.as_bytes().get(open) != Some(&b'{') {
        return Ok(None);
    }
    let Some(close) = flow_close(text, open) else {
        return Ok(None);
    };
    // 花括号里按顶层的逗号切成一项一项
    let inner = open + 1..close;
    let mut items = Vec::new();
    let (mut depth, mut quote, mut from) = (0i32, None::<u8>, inner.start);
    let b = text.as_bytes();
    let mut i = inner.start;
    while i < inner.end {
        let c = b[i];
        match quote {
            Some(q) if c == b'\\' && q == b'"' => i += 1,
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None => match c {
                b'"' | b'\'' => quote = Some(c),
                b'{' | b'[' => depth += 1,
                b'}' | b']' => depth -= 1,
                b',' if depth == 0 => {
                    items.push(from..i);
                    from = i + 1;
                }
                _ => {}
            },
        }
        i += 1;
    }
    items.push(from..inner.end);
    let name = |r: &std::ops::Range<usize>| {
        let seg = &text[r.clone()];
        let k = seg.split(':').next().unwrap_or_default().trim();
        k.trim_matches(|c| c == '"' || c == '\'').to_string()
    };
    let hits: Vec<usize> = (0..items.len())
        .filter(|&j| name(&items[j]) == *key)
        .collect();
    let [j] = hits.as_slice() else {
        return Ok(None);
    };
    let j = *j;
    // 这一项连同一侧的逗号：不是最后一项就带走后面那个，是最后一项就带走前面那个
    let cut = if items.len() == 1 {
        items[j].clone()
    } else if j + 1 < items.len() {
        items[j].start..items[j + 1].start
    } else {
        // 最后一项后面的空白是 `}` 前面那段，留给它
        let seg = &text[items[j].clone()];
        items[j - 1].end..items[j].start + seg.trim_end().len()
    };
    let mut out = String::with_capacity(text.len());
    out.push_str(&text[..cut.start]);
    out.push_str(&text[cut.end..]);
    if items.len() == 1 {
        // 只剩空白就收成 `{}`，和我们补键之前一样
        let o = open;
        let c = out[o..].find('}').map(|x| o + x).unwrap_or(o);
        if out[o + 1..c].trim().is_empty() {
            out.replace_range(o..=c, "{}");
        }
    }
    // 自检：目标之外的节点一个没变
    let keep = |ns: Vec<tw_yaml::Node>| -> Vec<(Vec<Step>, tw_yaml::NodeKind)> {
        ns.into_iter()
            .filter(|n| !n.path.starts_with(path))
            .map(|n| (n.path, n.kind))
            .collect()
    };
    if keep(tw_yaml::nodes(&out)?) != keep(all) {
        return Err(PatchError::SelfCheck(format!(
            "{} could not be taken out of its inline mapping cleanly",
            tw_yaml::show(path)
        )));
    }
    Ok(Some(out))
}

/// 从 `{` 开始，找到配对的 `}`。认引号里的括号。
fn flow_close(text: &str, open: usize) -> Option<usize> {
    let b = text.as_bytes();
    let (mut depth, mut quote) = (0i32, None::<u8>);
    let mut i = open;
    while i < b.len() {
        let c = b[i];
        match quote {
            Some(q) if c == b'\\' && q == b'"' => i += 1,
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None => match c {
                b'"' | b'\'' => quote = Some(c),
                b'{' | b'[' => depth += 1,
                b'}' | b']' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(i);
                    }
                }
                _ => {}
            },
        }
        i += 1;
    }
    None
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

    /// oh-my-pi 的模型清单：整张写在我们自己那个键底下，还原时整张拿走，别的一个字节不动
    #[test]
    fn a_list_is_written_as_a_whole_value_and_taken_away_with_its_key() {
        let src = "# 我的 provider\nproviders:\n  mine:\n    apiKey: '!op read x'  # 注释\n";
        let models = Val::Arr(vec![
            Val::Obj(vec![
                ("id".into(), Val::s("claude-sonnet-5")),
                ("api".into(), Val::s("anthropic-messages")),
                ("baseUrl".into(), Val::s("http://127.0.0.1:8788")),
            ]),
            Val::Obj(vec![("id".into(), Val::s("deepseek-chat"))]),
        ]);
        let path = ["providers", "thinkwatch", "models"];
        let out = set(src, &path, &models).unwrap();
        assert!(out.starts_with(src), "{out}");
        assert!(
            out.ends_with(
                "  thinkwatch:\n    models:\n      - id: claude-sonnet-5\n        api: anthropic-messages\n        baseUrl: http://127.0.0.1:8788\n      - id: deepseek-chat\n"
            ),
            "{out}"
        );
        assert_eq!(
            crate::plan::lookup(&crate::yamlval::value(&out).unwrap(), &path),
            Some(models.clone())
        );
        // 已经有了就整张换掉；读的时候给单行的写法
        let again = set(&out, &path, &Val::Arr(vec![])).unwrap();
        assert!(again.contains("models: []"), "{again}");
        assert_eq!(get(&out, &path).unwrap(), Some(models.to_line()));
        // 拿走它，空了的 `thinkwatch:` 一起走
        assert_eq!(remove(&out, &path).unwrap(), src);
    }

    /// 空文件、只有注释的文件里写一个嵌套的键：整段从顶层写出来，删掉又回到原样
    #[test]
    fn a_nested_key_goes_into_an_empty_file_too() {
        for src in ["", "# 只有注释\n", "# 没有换行"] {
            let out = set(
                src,
                &["providers", "thinkwatch", "baseUrl"],
                &Val::s("http://h:1/v1"),
            )
            .unwrap();
            assert_eq!(
                get(&out, &["providers", "thinkwatch", "baseUrl"])
                    .unwrap()
                    .as_deref(),
                Some("http://h:1/v1"),
                "{out}"
            );
            let out = set(
                &out,
                &["providers", "thinkwatch", "api"],
                &Val::s("openai-completions"),
            )
            .unwrap();
            let back = remove(&out, &["providers", "thinkwatch", "api"]).unwrap();
            let back = remove(&back, &["providers", "thinkwatch", "baseUrl"]).unwrap();
            assert_eq!(crate::yamlval::tree(&back).unwrap(), None, "{back}");
            assert!(back.starts_with(src.trim_end()), "{back}");
        }
    }

    /// 裸写会变意思的字符串一律加引号
    #[test]
    fn a_string_that_would_read_as_something_else_is_quoted() {
        for (s, want) in [
            ("anthropic-messages", "anthropic-messages"),
            ("http://127.0.0.1:8788/v1", "http://127.0.0.1:8788/v1"),
            ("openai/gpt-5", "openai/gpt-5"),
            ("yes", "'yes'"),
            ("On", "'On'"),
            ("null", "'null'"),
            ("1:30", "'1:30'"),
            ("0x10", "'0x10'"),
            ("nan", "'nan'"),
            ("inf", "'inf'"),
            ("-dash", "'-dash'"),
            ("a: b", "'a: b'"),
            ("it's", "'it''s'"),
            ("", "''"),
            ("a\nb", "\"a\\nb\""),
        ] {
            assert_eq!(text(s), want, "{s:?}");
            // 读回来还是这个字符串
            let doc = format!("k: {}\n", text(s));
            assert_eq!(get(&doc, &["k"]).unwrap().as_deref(), Some(s), "{doc}");
        }
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

    /// 往 `refs: {}` 里补的键写成行内的 `refs: {K: v}`：还原要能把它摘回去，
    /// 不然写回校验永远过不了，密钥也一直留在文件里
    #[test]
    fn a_key_added_to_an_inline_mapping_comes_back_out() {
        for t in [
            "version: 1\nrefs: {}\n",
            "version: 1\nrefs: {A: x}\nrecords: {}\n",
            "refs: { 'A': \"a,}\" }\n",
        ] {
            let with = set(t, &["refs", "K"], &Val::s("v")).unwrap();
            assert!(with.contains("K: v"), "{with}");
            assert_eq!(remove(&with, &["refs", "K"]).unwrap(), t);
        }
        // 用户自己的那一项照样摘得掉，别的不动
        assert_eq!(
            remove("refs: {A: x, B: y}\n", &["refs", "A"]).unwrap(),
            "refs: { B: y}\n"
        );
        assert_eq!(
            remove("refs: {A: x}\n", &["refs", "B"]).unwrap(),
            "refs: {A: x}\n"
        );
    }
}
