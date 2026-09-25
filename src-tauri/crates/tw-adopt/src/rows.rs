//! 一个 YAML 列表，每一行按 `id` 定位：dsh 的 Cordis 补丁（`cordis.patch.yml`）。
//!
//! ```yaml
//! - id: llm-deepseek
//!   config:
//!     baseURL: http://127.0.0.1:8788/v1
//!     apiKeyEnv: THINKWATCH_API_KEY
//! - id: some-plugin
//!   disabled: !!js "!ctx.get('profileContext')"
//! - insert:
//!     - id: demo-mcp
//!       name: '@deepseek-ai/dsh-mcp-client'
//! ```
//!
//! 字段路径的第一段是**行的 id**，后面是行里的键：`llm-deepseek.config.baseURL`。
//! 带 `insert:` 的行是另一回事（往树里插新行，不是改已有的行），不按 id 认。
//!
//! 和 [`crate::yaml`] 同一条纪律：**只动目标那一段字节**。别的行、`!!js` 标签、
//! 注释一个字节都不碰 —— 标签原样留在原文里，因为我们根本没有重新序列化过它。
//! 每一次写完都由 [`tw_yaml`] 在内存里重新解析、核对目标之外的节点没变。

use tw_yaml::{NodeKind, PatchError, Scalar, Step};

use crate::json::Val;

#[derive(Debug, thiserror::Error)]
pub enum RErr {
    #[error("{0}")]
    Patch(#[from] PatchError),
    #[error("the top level of the file is not a list")]
    NotAList,
    #[error("more than one row has the id {0}; remove the duplicates by hand first")]
    Duplicate(String),
    #[error("{0} does not name a field of a row")]
    NoField(String),
    #[error("only scalar fields can be written, and {0} is not one")]
    NotScalar(String),
}

/// 这一行是不是「按 id 改已有的行」那一种：一个映射，有 `id`，没有 `insert`。
fn row_ids(all: &[tw_yaml::Node]) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    for n in all {
        let [Step::Index(i), Step::Key(k)] = n.path.as_slice() else {
            continue;
        };
        if k != "id" {
            continue;
        }
        let NodeKind::Scalar { value, .. } = &n.kind else {
            continue;
        };
        let inserts = all.iter().any(|m| {
            matches!(m.path.as_slice(), [Step::Index(j), Step::Key(k)] if j == i && k == "insert")
        });
        if !inserts {
            out.push((*i, value.clone()));
        }
    }
    out
}

/// 顶层的形状。**空文件、只有注释、`[]` 都算一个空列表** —— dsh 自己新建这个
/// 文件时写的就是 `[]`。
enum Top {
    /// 没有任何节点
    Empty,
    /// `[]`，字节区间
    EmptyFlow(std::ops::Range<usize>),
    /// 块式或行内的列表，里面有几行
    Rows(usize),
}

fn top(text: &str, all: &[tw_yaml::Node]) -> Result<Top, RErr> {
    let Some(root) = all.iter().find(|n| n.path.is_empty()) else {
        return Ok(Top::Empty);
    };
    if !matches!(root.kind, NodeKind::Seq) {
        return Err(RErr::NotAList);
    }
    let count = all
        .iter()
        .filter(|n| matches!(n.path.as_slice(), [Step::Index(_)]))
        .count();
    if count == 0 {
        // 空的行内列表。解析器给的区间会一路跑到下一个 token，收到 `]` 为止
        let start = root.bytes.start;
        let end = text[start..]
            .find(']')
            .map(|i| start + i + 1)
            .ok_or(RErr::NotAList)?;
        return Ok(Top::EmptyFlow(start..end));
    }
    Ok(Top::Rows(count))
}

/// 这个 id 那一行是第几行。
pub fn row_index(text: &str, id: &str) -> Result<Option<usize>, RErr> {
    let all = tw_yaml::nodes(text)?;
    top(text, &all)?;
    let hits: Vec<_> = row_ids(&all).into_iter().filter(|(_, v)| v == id).collect();
    if hits.len() > 1 {
        return Err(RErr::Duplicate(id.to_string()));
    }
    Ok(hits.first().map(|(i, _)| *i))
}

fn steps(i: usize, keys: &[&str]) -> Vec<Step> {
    std::iter::once(Step::Index(i))
        .chain(keys.iter().map(|k| Step::Key(k.to_string())))
        .collect()
}

/// 读一个字段的值（标量是字符串，容器是整段）。行或者字段不在都是 `None`。
pub fn get(text: &str, path: &[&str]) -> Result<Option<Val>, RErr> {
    let Some((id, keys)) = path.split_first() else {
        return Err(RErr::NoField(String::new()));
    };
    let Some(i) = row_index(text, id)? else {
        return Ok(None);
    };
    let rows = crate::yamlval::tree(text).map_err(to_rerr)?;
    let Some(Val::Arr(rows)) = rows else {
        return Ok(None);
    };
    let mut cur = rows.get(i);
    for k in keys {
        cur = match cur {
            Some(Val::Obj(ms)) => ms.iter().rev().find(|(mk, _)| mk == k).map(|m| &m.1),
            _ => None,
        };
    }
    Ok(cur.cloned())
}

fn to_rerr(e: crate::yaml::YErr) -> RErr {
    match e {
        crate::yaml::YErr::Patch(p) => RErr::Patch(p),
        crate::yaml::YErr::NotScalar(p) => RErr::NotScalar(p),
    }
}

fn scalar_of(path: &[&str], v: &Val) -> Result<Scalar, RErr> {
    Ok(match v {
        Val::Str(s) => Scalar::s(s),
        Val::Bool(b) => Scalar::Bool(*b),
        Val::Num(n) => Scalar::Int(n.parse().map_err(|_| RErr::NotScalar(path.join(".")))?),
        Val::Null => Scalar::Null,
        Val::Arr(_) | Val::Obj(_) => return Err(RErr::NotScalar(path.join("."))),
    })
}

/// 写一个字段。这一行已经有了就只改（或补上）这一个键，行里别的键原样留着；
/// 没有这一行就在列表末尾**追加一行**，再往里补字段。
pub fn set(text: &str, path: &[&str], v: &Val) -> Result<String, RErr> {
    let [id, keys @ ..] = path else {
        return Err(RErr::NoField(String::new()));
    };
    if keys.is_empty() {
        return Err(RErr::NoField(path.join(".")));
    }
    let value = scalar_of(path, v)?;
    let (text, i) = match row_index(text, id)? {
        Some(i) => (text.to_string(), i),
        None => add_row(text, id)?,
    };
    // 已经有的标量原地改、引号风格照原来的；没有的连同缺的中间层一起补
    Ok(tw_yaml::insert(&text, &steps(i, keys), &value)?)
}

/// 在列表末尾追加只有 `id` 的一行，返回新文本和它是第几行。
fn add_row(text: &str, id: &str) -> Result<(String, usize), RErr> {
    // id 是插件行的名字，dsh 里都是 `llm-deepseek` 这种。别的字符要引号，
    // 我们不写那样的 id —— 宁可说出来
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(RErr::NoField(id.to_string()));
    }
    let item = format!("id: {id}");
    let all = tw_yaml::nodes(text)?;
    let (out, at) = match top(text, &all)? {
        Top::Rows(n) => (tw_yaml::append(text, &[], &item)?, n),
        Top::Empty => {
            let mut out = text.to_string();
            if !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
            out.push_str(&format!("- {item}\n"));
            (out, 0)
        }
        Top::EmptyFlow(at) => {
            let mut out = String::with_capacity(text.len() + item.len() + 4);
            out.push_str(&text[..at.start]);
            out.push_str("- ");
            out.push_str(&item);
            out.push_str(&text[at.end..]);
            if !out.ends_with('\n') {
                out.push('\n');
            }
            (out, 0)
        }
    };
    // 自检：新的那一行读得回来，而且就在那个位置
    if row_index(&out, id)? != Some(at) {
        return Err(RErr::Patch(PatchError::SelfCheck(format!(
            "the row {id} does not read back after it was added"
        ))));
    }
    Ok((out, at))
}

/// 删掉一个字段；路径只有 id 一段时删掉整行。**不在就原样返回** —— 还原时
/// 先删的字段可能已经带走了空掉的父映射。
pub fn remove(text: &str, path: &[&str]) -> Result<String, RErr> {
    let [id, keys @ ..] = path else {
        return Err(RErr::NoField(String::new()));
    };
    let Some(i) = row_index(text, id)? else {
        return Ok(text.to_string());
    };
    if keys.is_empty() {
        return Ok(tw_yaml::remove(text, &[], i)?);
    }
    match tw_yaml::remove_key(text, &steps(i, keys)) {
        Ok(out) => Ok(out),
        Err(PatchError::NotFound { .. }) => Ok(text.to_string()),
        Err(e) => Err(e.into()),
    }
}

/// 可比较的语义值：**按 id 键起来的一张表**，行里的 `id` 本身不再重复一遍。
///
/// 这样「补一行」在语义上就是「多了一个键」，写回校验拿 [`Val::with`] 叠预期
/// 改动时和别的格式走的是同一条路。不按 id 认的行（`insert:` 那种、没有 id
/// 的）用它的位置当键，照样参与比较 —— 它们一个字节都不该变。
pub fn value(text: &str) -> Result<Val, RErr> {
    let all = tw_yaml::nodes(text)?;
    top(text, &all)?;
    let ids = row_ids(&all);
    let rows = match crate::yamlval::tree(text).map_err(to_rerr)? {
        Some(Val::Arr(rows)) => rows,
        _ => Vec::new(),
    };
    let mut out = Vec::with_capacity(rows.len());
    for (i, row) in rows.into_iter().enumerate() {
        match ids.iter().find(|(j, _)| *j == i) {
            Some((_, id)) => {
                let Val::Obj(ms) = row else { continue };
                let ms = ms.into_iter().filter(|(k, _)| k != "id").collect();
                out.push((id.clone(), Val::Obj(ms)));
            }
            None => out.push((format!("#{i}"), row)),
        }
    }
    Ok(Val::Obj(out))
}

/// dsh 的 MCP 插件名。补丁里每个 MCP server 是一行这个插件
pub const MCP_PLUGIN: &str = "@deepseek-ai/dsh-mcp-client";

/// 补丁里的 MCP server，摊成和别家一样的形状：`{ mcpServers: { 名字: {…} } }`。
///
/// 一行 `name: '@deepseek-ai/dsh-mcp-client'` 就是一个 server，`config` 里是
/// `serverName`、`transport`、`command`/`args`/`env`/`cwd` 或者 `url`/`headers`。
/// **在哪一层都认**：顶层的行、`insert:` 里插进来的行、分组里的行。行上写着
/// `disabled: true` 的算关掉（`!!js` 算出来的开关这里算不出来，当开着）。
pub fn mcp_servers(text: &str) -> Result<Val, RErr> {
    let mut out = Vec::new();
    if let Some(v) = crate::yamlval::tree(text).map_err(to_rerr)? {
        collect_mcp(&v, &mut out);
    }
    Ok(Val::Obj(vec![("mcpServers".into(), Val::Obj(out))]))
}

fn collect_mcp(v: &Val, out: &mut Vec<(String, Val)>) {
    match v {
        Val::Obj(ms) => {
            let field = |k: &str| ms.iter().find(|(mk, _)| mk == k).map(|(_, v)| v);
            if field("name").and_then(Val::as_str) == Some(MCP_PLUGIN)
                && let Some(Val::Obj(cfg)) = field("config")
            {
                let name = cfg
                    .iter()
                    .find(|(k, _)| k == "serverName")
                    .and_then(|(_, v)| v.as_str())
                    .or_else(|| field("id").and_then(Val::as_str))
                    .unwrap_or_default()
                    .to_string();
                let mut server = cfg.clone();
                if field("disabled").and_then(Val::as_str) == Some("true") {
                    server.push(("enabled".into(), Val::Bool(false)));
                }
                out.push((name, Val::Obj(server)));
                return;
            }
            for (_, x) in ms {
                collect_mcp(x, out);
            }
        }
        Val::Arr(es) => es.iter().for_each(|e| collect_mcp(e, out)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PATH: &[&str] = &["llm-deepseek", "config", "baseURL"];
    const KEY_ENV: &[&str] = &["llm-deepseek", "config", "apiKeyEnv"];

    fn adopt(text: &str) -> String {
        let t = set(text, PATH, &Val::s("http://127.0.0.1:8788/v1")).unwrap();
        set(&t, KEY_ENV, &Val::s("THINKWATCH_API_KEY")).unwrap()
    }

    fn restore(text: &str) -> String {
        let t = remove(text, KEY_ENV).unwrap();
        let t = remove(&t, PATH).unwrap();
        let t = remove(&t, &["llm-deepseek", "config"]).unwrap();
        remove(&t, &["llm-deepseek"]).unwrap()
    }

    #[test]
    fn a_missing_file_gets_one_row() {
        let out = adopt("");
        assert_eq!(
            out,
            "- id: llm-deepseek\n  config:\n    baseURL: http://127.0.0.1:8788/v1\n    apiKeyEnv: THINKWATCH_API_KEY\n"
        );
        assert_eq!(restore(&out), "");
    }

    #[test]
    fn the_empty_list_dsh_writes_itself_is_a_list_too() {
        let out = adopt("[]\n");
        assert_eq!(
            get(&out, PATH).unwrap(),
            Some(Val::s("http://127.0.0.1:8788/v1"))
        );
        assert!(!out.contains("[]"), "{out}");
    }

    #[test]
    fn js_tags_and_comments_and_other_rows_are_left_alone() {
        let src = "\
# 我自己的补丁
- id: fs-sandbox
  disabled: !!js \"!ctx.get('profileContext')\"  # 行尾注释

- id: bash
  config:
    shell: !!js \"process.platform === 'win32' ? 'pwsh' : 'bash'\"
- insert:
    - id: llm-deepseek
      name: '@deepseek-ai/dsh-mcp-client'
";
        let out = adopt(src);
        assert!(
            out.starts_with(src.trim_end_matches('\n')),
            "原有的每一行都原样在前面：\n{out}"
        );
        assert!(out.ends_with(
            "- id: llm-deepseek\n  config:\n    baseURL: http://127.0.0.1:8788/v1\n    apiKeyEnv: THINKWATCH_API_KEY\n"
        ), "{out}");
        // `insert:` 里那个同名的 id 不是「已有的那一行」
        assert_eq!(restore(&out), src);
    }

    #[test]
    fn an_existing_row_keeps_its_other_fields_and_comes_back_as_it_was() {
        let src = "\
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek-api-key'
  config:
    # 思考深度是我自己调的
    thinking: !!js \"({ type: 'enabled' })\"
    baseURL: https://api.deepseek.com/anthropic
- id: other
";
        let out = adopt(src);
        assert!(
            out.contains("    thinking: !!js \"({ type: 'enabled' })\"\n"),
            "{out}"
        );
        assert!(out.contains("    # 思考深度是我自己调的\n"), "{out}");
        assert!(out.contains("baseURL: http://127.0.0.1:8788/v1"), "{out}");
        assert!(out.contains("- id: other\n"), "{out}");
        let v = value(&out).unwrap();
        let expect = value(src)
            .unwrap()
            .with(PATH, &Val::s("http://127.0.0.1:8788/v1"))
            .with(KEY_ENV, &Val::s("THINKWATCH_API_KEY"));
        assert_eq!(v.normalized(), expect.normalized());
        // 还原：原来有的 baseURL 放回原值，原来没有的 apiKeyEnv 删掉
        let t = remove(&out, KEY_ENV).unwrap();
        let t = set(&t, PATH, &Val::s("https://api.deepseek.com/anthropic")).unwrap();
        assert_eq!(t, src);
    }

    #[test]
    fn a_row_without_config_gets_one_and_loses_it_again() {
        let src = "- id: llm-deepseek\n  name: x\n";
        let out = adopt(src);
        assert_eq!(
            out,
            "- id: llm-deepseek\n  name: x\n  config:\n    baseURL: http://127.0.0.1:8788/v1\n    apiKeyEnv: THINKWATCH_API_KEY\n"
        );
        let t = remove(&out, KEY_ENV).unwrap();
        let t = remove(&t, PATH).unwrap();
        assert_eq!(t, src, "删空了的 config 一起走");
    }

    #[test]
    fn duplicate_rows_are_refused_rather_than_guessed_at() {
        let src = "- id: llm-deepseek\n- id: llm-deepseek\n";
        assert!(matches!(
            set(src, PATH, &Val::s("x")),
            Err(RErr::Duplicate(_))
        ));
    }

    #[test]
    fn a_file_that_is_not_a_list_is_refused() {
        assert!(matches!(value("a: 1\n"), Err(RErr::NotAList)));
        assert!(matches!(
            set("a: 1\n", PATH, &Val::s("x")),
            Err(RErr::NotAList)
        ));
    }

    #[test]
    fn multibyte_content_is_not_sliced_in_half() {
        let src = "# 中文注释\n- id: 插件\n  config:\n    名字: 值\n";
        let out = adopt(src);
        assert!(out.starts_with(src), "{out}");
        assert_eq!(restore(&out), src);
    }

    #[test]
    fn mcp_rows_are_found_wherever_they_sit() {
        let src = "\
- id: fs
- insert:
    - id: demo-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: demo
        transport: stdio
        command: npx
        args: [-y, some-server]
        env:
          TOKEN: secret
- id: remote
  name: '@deepseek-ai/dsh-mcp-client'
  disabled: true
  config:
    transport: streamable-http
    url: https://mcp.example.com/mcp
";
        let Val::Obj(root) = mcp_servers(src).unwrap() else {
            panic!()
        };
        let Val::Obj(servers) = &root[0].1 else {
            panic!()
        };
        let names: Vec<_> = servers.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(names, ["demo", "remote"], "没写 serverName 的用行 id");
        let Val::Obj(remote) = &servers[1].1 else {
            panic!()
        };
        assert!(remote.contains(&("enabled".into(), Val::Bool(false))));
    }
}
