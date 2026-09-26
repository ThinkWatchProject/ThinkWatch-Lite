//! `%USERPROFILE%\.wslconfig`：WSL 2 用哪种网络，以及把它改成 mirrored。
//!
//! **照 WSL 自己的读法读**（microsoft/WSL 的 `src/shared/configfile/configfile.cpp`
//! 和 `src/windows/common/WslCoreConfig.cpp`），而不是照一个通用的 INI 解析器：
//! 这里说 mirrored、WSL 却按 NAT 起来，客户端就会被指向一个够不到的地址。
//!
//! - 节名、键名都不分大小写（`[WSL2]`、`NetworkingMode`），值也不分（`Mirrored`）；
//! - 注释是 `#`，可以写在行尾；`;` 开头的行 WSL 当成写错的一行跳过，效果一样；
//! - 值可以带双引号，引号里的 `#` 不算注释；**单引号不是引号**，是值的一部分；
//! - 节名只能是字母开头的字母和数字，`[ wsl2 ]` 这种 WSL 认不出来；
//! - `networkingMode` 在 `[wsl2]` 和旧的 `[experimental]` 下都认，两处算同一项，
//!   **写了几次的，第一次算数**，后面的 WSL 报一句「重复」、不理。值写错了的
//!   （`networkingMode=miror`）也算写过：WSL 报一句、按默认的 NAT 走；
//! - 文件是 UTF-8（带不带 BOM 都行），或者带 BOM 的 UTF-16LE。遇到不是 UTF-8 的
//!   字节，WSL 读到那里为止。
//!
//! 改的时候**只动 networkingMode 这一项**：写过的，原地换掉它的值（键名、空格、
//! 行尾注释照旧）；没写过的，加在 `[wsl2]` 那一节的第一行，没有这一节就在文件末尾
//! 加上。写在旧的 `[experimental]` 下的那一行也是原地换 —— 另在 `[wsl2]` 下加一行
//! 的话两处都在，WSL 每次启动都报一句重复，而且在前面的那一个说了算。其余的字节
//! 一个不动：换行符、BOM、编码都跟着原文件走。

use std::borrow::Cow;
use std::ops::Range;
use std::path::{Path, PathBuf};

use tw_types::{Msg, msg};

use crate::foreign;

/// `.wslconfig` 在哪：Windows 用户目录下
pub fn path(profile: &Path) -> PathBuf {
    profile.join(".wslconfig")
}

/// WSL 2 按 `.wslconfig` 用哪种网络。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetMode {
    /// `networkingMode=mirrored`：和 Windows 共用网卡，WSL 里的 127.0.0.1 就是 Windows 的
    Mirrored,
    /// 别的：没有这个文件、没写、写了 `nat`（WSL 的默认）、写错了的
    Nat,
}

/// 那一项的名字，WSL 拼出来的样子（小写比较）
const KEYS: [&str; 2] = ["wsl2.networkingmode", "experimental.networkingmode"];
const MIRRORED: &str = "mirrored";

/// 一行在 WSL 眼里是什么。
#[derive(Debug, Clone, PartialEq, Eq)]
enum Line {
    /// 空行、注释、WSL 报一句就跳过的行
    Skip,
    /// `[wsl2]`
    Section(String),
    /// 节名开了头、没写完整（`[wsl2] x`、`[wsl-2]`）：WSL 跳过这一行，但读到的
    /// 名字留在它手里，见 [`Reader`]
    BadSection(String),
    /// `键 = 值`。`span` 是值在这一行里的字节区间：引号算在里面，行尾的空白和
    /// 注释不算
    Key {
        key: String,
        value: String,
        span: Range<usize>,
    },
}

fn hspace(c: u8) -> bool {
    c == b' ' || c == b'\t'
}

/// 认一行。行尾的 `\r` 由调用方去掉（WSL 按文本模式读，`\r\n` 到它手里就是 `\n`）。
fn classify(line: &str) -> Line {
    let b = line.as_bytes();
    let mut i = 0;
    while b.get(i).is_some_and(|&c| hspace(c)) {
        i += 1;
    }
    let Some(&first) = b.get(i) else {
        return Line::Skip;
    };
    if first == b'#' {
        return Line::Skip;
    }
    if first == b'[' {
        let start = i + 1;
        if !b.get(start).is_some_and(u8::is_ascii_alphabetic) {
            return Line::Skip;
        }
        let mut j = start;
        while b.get(j).is_some_and(u8::is_ascii_alphanumeric) {
            j += 1;
        }
        let name = line[start..j].to_string();
        if b.get(j) != Some(&b']') {
            return Line::BadSection(name);
        }
        let mut k = j + 1;
        while b.get(k).is_some_and(|&c| hspace(c)) {
            k += 1;
        }
        return match b.get(k) {
            None | Some(b'#') => Line::Section(name),
            Some(_) => Line::BadSection(name),
        };
    }
    if !first.is_ascii_alphabetic() {
        return Line::Skip;
    }
    let mut j = i;
    while b.get(j).is_some_and(u8::is_ascii_alphanumeric) {
        j += 1;
    }
    let key = line[i..j].to_string();
    while b.get(j).is_some_and(|&c| hspace(c)) {
        j += 1;
    }
    if b.get(j) != Some(&b'=') {
        return Line::Skip;
    }
    j += 1;
    while b.get(j).is_some_and(|&c| hspace(c)) {
        j += 1;
    }
    let start = j;
    let mut value = String::new();
    // WSL 的 `trimmedLength`：记到最后一个不是空白的字符为止，引号里的空白算数
    let (mut kept, mut end) = (0, start);
    let mut quoted = false;
    let mut chars = line[start..].char_indices().map(|(k, c)| (start + k, c));
    while let Some((at, c)) = chars.next() {
        let mut after = at + c.len_utf8();
        match c {
            '"' => quoted = !quoted,
            '\\' => match chars.next() {
                Some((e_at, e)) => {
                    after = e_at + e.len_utf8();
                    match e {
                        '\\' | '"' => value.push(e),
                        'b' => value.push('\u{8}'),
                        'n' => value.push('\n'),
                        't' => value.push('\t'),
                        // 别的转义 WSL 当这一行写错了
                        _ => return Line::Skip,
                    }
                }
                // 行尾的 `\` 在 WSL 里是续行，把下一行接进这个值。没有人会这样写
                // networkingMode，这里不认它：宁可当成没写，也不去猜两行拼起来是什么
                None => return Line::Skip,
            },
            '#' if !quoted => break,
            c => value.push(c),
        }
        if !(c == ' ' || c == '\t') {
            kept = value.len();
            end = after;
        }
    }
    // 引号没关上：WSL 报一句，这一行不算
    if quoted {
        return Line::Skip;
    }
    value.truncate(kept);
    Line::Key {
        key,
        value,
        span: start..end,
    }
}

/// WSL 拼键名的那两个状态：手里的名字，和当前这一节有多长。
///
/// **照抄它的做法，连它的怪处一起抄**：遇到一行键，它把手里的名字截（或用 NUL
/// 补）到节的长度，再接上 `.键名`。节名写坏了的那一行（[`Line::BadSection`]）
/// 会换掉手里的名字、却不改长度 —— 于是它后面那些键拼出来的名字谁也不认。
#[derive(Default)]
struct Reader {
    buf: Vec<u8>,
    section: usize,
}

impl Reader {
    /// 读一行。是一行键的话，交回 WSL 拼出来的完整键名（`wsl2.networkingMode`）
    fn feed(&mut self, line: &Line) -> Option<String> {
        match line {
            Line::Skip => None,
            Line::Section(name) => {
                self.buf = name.as_bytes().to_vec();
                self.section = self.buf.len();
                None
            }
            Line::BadSection(name) => {
                self.buf = name.as_bytes().to_vec();
                None
            }
            Line::Key { key, .. } => {
                self.buf.resize(self.section, 0);
                if self.section > 0 {
                    self.buf.push(b'.');
                }
                self.buf.extend_from_slice(key.as_bytes());
                Some(String::from_utf8_lossy(&self.buf).into_owned())
            }
        }
    }
}

/// 一行，和它原来的换行符（`\r\n`、`\n`，最后一行可能没有）
fn split_lines(text: &str) -> Vec<(&str, &str)> {
    let mut out = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        match rest.find('\n') {
            Some(i) => {
                let line = &rest[..i];
                match line.strip_suffix('\r') {
                    Some(l) => out.push((l, "\r\n")),
                    None => out.push((line, "\n")),
                }
                rest = &rest[i + 1..];
            }
            None => {
                out.push((rest, ""));
                rest = "";
            }
        }
    }
    out
}

/// networkingMode 那一项，WSL 认下来的那一次
#[derive(Debug, Clone)]
struct Found {
    line: usize,
    /// WSL 拼出来的键名，照文件里的写法（`WSL2.NetworkingMode`）
    field: String,
    value: String,
    span: Range<usize>,
}

/// 扫一遍：WSL 认下来的每一项（小写的键名、值），networkingMode 算数的那一次，
/// 以及第一个写对了的 `[wsl2]` 在哪一行。
struct Scan {
    settings: Vec<(String, String)>,
    found: Option<Found>,
    wsl2: Option<usize>,
}

fn scan(lines: &[(&str, &str)]) -> Scan {
    let mut r = Reader::default();
    let mut out = Scan {
        settings: Vec::new(),
        found: None,
        wsl2: None,
    };
    for (n, (text, _)) in lines.iter().enumerate() {
        let line = classify(text);
        if let Line::Section(name) = &line
            && out.wsl2.is_none()
            && name.eq_ignore_ascii_case("wsl2")
        {
            out.wsl2 = Some(n);
        }
        let Some(full) = r.feed(&line) else {
            continue;
        };
        let Line::Key { value, span, .. } = line else {
            continue;
        };
        let lower = full.to_ascii_lowercase();
        if KEYS.contains(&lower.as_str()) && out.found.is_none() {
            out.found = Some(Found {
                line: n,
                field: full,
                value: value.clone(),
                span,
            });
        }
        out.settings.push((lower, value));
    }
    out
}

/// 按 `.wslconfig` 的文字，WSL 2 用哪种网络
pub fn mode(text: &str) -> NetMode {
    match scan(&split_lines(text)).found {
        Some(f) if f.value.eq_ignore_ascii_case(MIRRORED) => NetMode::Mirrored,
        _ => NetMode::Nat,
    }
}

/// 按 `.wslconfig` 的字节，WSL 2 用哪种网络。**文件不在就是 NAT**（WSL 的默认）。
///
/// 字节照 WSL 的读法变成文字：带 BOM 的 UTF-16LE；别的按 UTF-8，读到第一个不是
/// UTF-8 的地方为止 —— WSL 的 C 运行库读到那里就停了，后面写的它看不见。
pub fn mode_of(bytes: Option<&[u8]>) -> NetMode {
    match bytes {
        None => NetMode::Nat,
        Some(b) => mode(&as_wsl_reads(b)),
    }
}

fn as_wsl_reads(b: &[u8]) -> Cow<'_, str> {
    fn prefix(b: &[u8]) -> Cow<'_, str> {
        match std::str::from_utf8(b) {
            Ok(s) => Cow::Borrowed(s),
            Err(e) => Cow::Borrowed(std::str::from_utf8(&b[..e.valid_up_to()]).unwrap_or("")),
        }
    }
    match b {
        [0xFF, 0xFE, rest @ ..] => Cow::Owned(String::from_utf16_lossy(&units(rest))),
        [0xEF, 0xBB, 0xBF, rest @ ..] => prefix(rest),
        _ => prefix(b),
    }
}

fn units(b: &[u8]) -> Vec<u16> {
    b.as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_le_bytes(*c))
        .collect()
}

/// 这个文件是怎么编码的。**写回去时照原样**：记事本存的带 BOM，PowerShell 5 的
/// `Out-File` 和 `>` 写的是 UTF-16LE。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
}

/// 能一个字节不差地写回去的，才读成文字：UTF-8（带不带 BOM）、带 BOM 的 UTF-16LE。
///
/// 别的（本地代码页写的中文注释、没有 BOM 的 UTF-16）是 `None`：改一个字进去，
/// 要么把那几个字节弄坏，要么写在 WSL 读不到的地方。
pub fn decode(b: &[u8]) -> Option<(String, Encoding)> {
    match b {
        [0xFF, 0xFE, rest @ ..] => {
            if !rest.len().is_multiple_of(2) {
                return None;
            }
            String::from_utf16(&units(rest))
                .ok()
                .map(|s| (s, Encoding::Utf16Le))
        }
        [0xEF, 0xBB, 0xBF, rest @ ..] => std::str::from_utf8(rest)
            .ok()
            .map(|s| (s.to_string(), Encoding::Utf8Bom)),
        // NUL：没有 BOM 的 UTF-16，或者根本不是文字
        _ if b.contains(&0) => None,
        _ => std::str::from_utf8(b)
            .ok()
            .map(|s| (s.to_string(), Encoding::Utf8)),
    }
}

pub fn encode(text: &str, enc: Encoding) -> Vec<u8> {
    match enc {
        Encoding::Utf8 => text.as_bytes().to_vec(),
        Encoding::Utf8Bom => [&[0xEF, 0xBB, 0xBF][..], text.as_bytes()].concat(),
        Encoding::Utf16Le => [0xFF, 0xFE]
            .into_iter()
            .chain(text.encode_utf16().flat_map(u16::to_le_bytes))
            .collect(),
    }
}

/// 这个文件用哪种换行：有 `\r\n` 就是它；一行都没有的（空文件、新建的）也用它
/// —— 这是一个 Windows 上的文件，WSL 自己写它时也是 `\r\n`。
fn newline(text: &str) -> &'static str {
    if text.contains("\r\n") || !text.contains('\n') {
        "\r\n"
    } else {
        "\n"
    }
}

/// 把 networkingMode 改成 mirrored，交回改好的文字和改的是哪一项（`wsl2.networkingMode`）。
/// 已经是 mirrored 的原样交回。
pub fn set_mirrored(text: &str) -> (String, String) {
    fn join(ls: &[(Cow<'_, str>, &str)]) -> String {
        ls.iter().map(|(l, e)| format!("{l}{e}")).collect()
    }
    let lines = split_lines(text);
    let s = scan(&lines);
    let nl = newline(text);
    if let Some(f) = s.found {
        if f.value.eq_ignore_ascii_case(MIRRORED) {
            return (text.to_string(), f.field);
        }
        let out: Vec<(Cow<'_, str>, &str)> = lines
            .iter()
            .enumerate()
            .map(|(n, (l, e))| {
                if n != f.line {
                    return (Cow::Borrowed(*l), *e);
                }
                // 值是空的而后面紧跟着注释（`networkingMode= # x`）：留一个空格隔开
                let tail = &l[f.span.end..];
                let gap = if f.span.is_empty() && tail.starts_with('#') {
                    " "
                } else {
                    ""
                };
                (
                    Cow::Owned(format!("{}{MIRRORED}{gap}{tail}", &l[..f.span.start])),
                    *e,
                )
            })
            .collect();
        return (join(&out), f.field);
    }
    let field = "wsl2.networkingMode".to_string();
    let entry = format!("networkingMode={MIRRORED}");
    if let Some(h) = s.wsl2 {
        let mut out: Vec<(Cow<'_, str>, &str)> =
            lines.iter().map(|(l, e)| (Cow::Borrowed(*l), *e)).collect();
        // 那一节的标题是最后一行、后面没有换行：先给它补上，新加的这一行也就成了
        // 没有换行的最后一行，和原文件的写法一致
        let last = out[h].1.is_empty();
        if last {
            out[h].1 = nl;
        }
        out.insert(h + 1, (Cow::Owned(entry), if last { "" } else { nl }));
        return (join(&out), field);
    }
    let mut out = text.to_string();
    if !out.is_empty() {
        if !out.ends_with('\n') {
            out.push_str(nl);
        }
        // 和前面的内容隔一行空行
        if !out.ends_with(&format!("{nl}{nl}")) && !out.trim().is_empty() {
            out.push_str(nl);
        }
    }
    out.push_str(&format!("[wsl2]{nl}{entry}{nl}"));
    (out, field)
}

/// 写回校验：改完的文字里 networkingMode 是 mirrored，**别的每一项都和原来一样**，
/// networkingMode 本身要么原地换了值、要么是新加的那一个。
pub fn verify(before: &str, after: &str) -> Result<(), String> {
    if mode(after) != NetMode::Mirrored {
        return Err("networkingMode is not mirrored after the edit".into());
    }
    let split = |t: &str| {
        let (nm, rest): (Vec<_>, Vec<_>) = scan(&split_lines(t))
            .settings
            .into_iter()
            .partition(|(k, _)| KEYS.contains(&k.as_str()));
        (nm.len(), rest)
    };
    let (n_before, rest_before) = split(before);
    let (n_after, rest_after) = split(after);
    if rest_before != rest_after {
        return Err("a setting other than networkingMode changed".into());
    }
    if n_after != n_before.max(1) {
        return Err("networkingMode was written more than once".into());
    }
    Ok(())
}

/// 改成 mirrored 的那一份改动。**不写任何东西。**
#[derive(Debug, Clone)]
pub struct Plan {
    pub path: PathBuf,
    /// 原来的字节。`None` = 没有这个文件，要新建
    pub before: Option<Vec<u8>>,
    pub after: Vec<u8>,
    /// 给人看的那两份（BOM 不算在里面）
    pub before_text: Option<String>,
    pub after_text: String,
    /// 改的是哪一项（`wsl2.networkingMode`；写在旧位置的是 `experimental.networkingMode`）
    pub field: String,
}

impl Plan {
    /// 已经是 mirrored 了：不写，也不留备份
    pub fn is_noop(&self) -> bool {
        self.before.as_deref() == Some(self.after.as_slice())
    }
}

/// 读不成文字、不敢改的那种文件
fn undecodable(path: &Path) -> Msg {
    msg!(
        "wslconfig.encoding", path = path.display() =>
        "{path} is neither UTF-8 nor UTF-16 text, so it was left unchanged. Set networkingMode=mirrored under [wsl2] in it by hand."
    )
}

/// 算一份「改成 mirrored」的改动：读文件（跟着符号链接走），照原来的编码和换行写。
pub fn plan_mirrored(path: &Path) -> Result<Plan, Msg> {
    let before = foreign::read_bytes(path).map_err(|e| e.msg())?;
    let (text, enc) = match &before {
        None => (String::new(), Encoding::Utf8),
        Some(b) => decode(b).ok_or_else(|| undecodable(path))?,
    };
    let (after_text, field) = set_mirrored(&text);
    Ok(Plan {
        path: path.to_path_buf(),
        after: encode(&after_text, enc),
        before_text: before.as_ref().map(|_| text),
        before,
        after_text,
        field,
    })
}

/// 落盘。**用户在差异上点过确认之后才该到这里。**全文备份、原子写、读回核对都在
/// [`foreign::apply_bytes`] 里；校验按 [`verify`] 来。
pub fn apply(plan: &Plan, backups: &Path) -> Result<foreign::Applied, Msg> {
    let before = plan.before_text.clone().unwrap_or_default();
    foreign::apply_bytes(
        &foreign::Bytes {
            path: &plan.path,
            before: plan.before.as_deref(),
            after: &plan.after,
            carries_secret: false,
        },
        backups,
        |b| {
            let (after, _) =
                decode(b).ok_or("the edited content is not in the file's own encoding")?;
            verify(&before, &after)
        },
    )
    .map_err(|e| e.msg())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nat(t: &str) {
        assert_eq!(mode(t), NetMode::Nat, "{t:?}");
    }
    fn mirrored(t: &str) {
        assert_eq!(mode(t), NetMode::Mirrored, "{t:?}");
    }

    #[test]
    fn mirrored_only_when_it_says_so_under_wsl2_or_experimental() {
        mirrored("[wsl2]\nnetworkingMode=mirrored\n");
        mirrored("[wsl2]\r\nmemory=8GB\r\nnetworkingMode=mirrored\r\n");
        // 旧的写法
        mirrored("[experimental]\nnetworkingMode=mirrored");
        // 文件不在、没写、写了 NAT 或者别的，都是 NAT
        assert_eq!(mode_of(None), NetMode::Nat);
        nat("");
        nat("[wsl2]\nmemory=8GB\n");
        nat("[wsl2]\nnetworkingMode=nat\n");
        nat("[wsl2]\nnetworkingMode=NAT\n");
        nat("[wsl2]\nnetworkingMode=none\n");
        nat("[wsl2]\nnetworkingMode=miror\n");
        // 写在别的节里、写在任何节之前的，WSL 不认
        nat("[boot]\nnetworkingMode=mirrored\n");
        nat("networkingMode=mirrored\n[wsl2]\n");
        nat("[wsl2]\nnetworkingMode.x=mirrored\n");
    }

    /// 节名、键名、值都不分大小写；空白随便加
    #[test]
    fn case_and_whitespace_do_not_matter() {
        mirrored("[WSL2]\nNETWORKINGMODE=MIRRORED\n");
        mirrored("[Wsl2]\nNetworkingMode = Mirrored\n");
        mirrored("  [wsl2]  \n\t networkingMode\t=\t mirrored \t\n");
        mirrored("[EXPERIMENTAL]\nnetworkingmode=Mirrored\n");
    }

    #[test]
    fn comments_are_skipped_the_way_wsl_skips_them() {
        mirrored(
            "# 全局设置\n[wsl2] # 注释\n# networkingMode=nat\nnetworkingMode=mirrored # 新的\n",
        );
        mirrored("[wsl2]\nnetworkingMode=mirrored#紧挨着\n");
        // 注释掉的不算
        nat("[wsl2]\n# networkingMode=mirrored\n");
        nat("[wsl2]\n  #networkingMode=mirrored\n");
        // `;` 开头的行 WSL 当写错的一行跳过
        nat("[wsl2]\n; networkingMode=mirrored\n");
        mirrored("[wsl2]\n; networkingMode=nat\nnetworkingMode=mirrored\n");
        // 可是 `;` 不是行尾注释：这个值就是 `mirrored ; x`，WSL 不认
        nat("[wsl2]\nnetworkingMode=mirrored ; x\n");
    }

    #[test]
    fn quotes_are_double_quotes_only() {
        mirrored("[wsl2]\nnetworkingMode=\"mirrored\"\n");
        mirrored("[wsl2]\nnetworkingMode = \"Mirrored\" # x\n");
        // 引号里的 # 不是注释，引号里的空白算在值里
        nat("[wsl2]\nnetworkingMode=\"mirrored # x\"\n");
        nat("[wsl2]\nnetworkingMode=\" mirrored\"\n");
        // 单引号是值的一部分
        nat("[wsl2]\nnetworkingMode='mirrored'\n");
        // 引号没关上、转义写错了：这一行不算，后面的照读
        mirrored("[wsl2]\nnetworkingMode=\"nat\nnetworkingMode=mirrored\n");
        mirrored("[wsl2]\nnetworkingMode=na\\qt\nnetworkingMode=mirrored\n");
    }

    /// **第一次算数**，后面的是重复。`[wsl2]` 和 `[experimental]` 下的算同一项
    #[test]
    fn the_first_occurrence_wins() {
        nat("[wsl2]\nnetworkingMode=nat\nnetworkingMode=mirrored\n");
        mirrored("[wsl2]\nnetworkingMode=mirrored\nnetworkingMode=nat\n");
        nat("[experimental]\nnetworkingMode=nat\n[wsl2]\nnetworkingMode=mirrored\n");
        mirrored("[experimental]\nnetworkingMode=mirrored\n[wsl2]\nnetworkingMode=nat\n");
        // 写错的值也算写过：后面写对的不理
        nat("[wsl2]\nnetworkingMode=miror\nnetworkingMode=mirrored\n");
    }

    /// 节名写坏了：WSL 认不出那一节，它下面的键也跟着认不出来
    #[test]
    fn a_broken_section_header_is_not_a_section() {
        nat("[ wsl2 ]\nnetworkingMode=mirrored\n");
        nat("[wsl2] x\nnetworkingMode=mirrored\n");
        nat("[wsl-2]\nnetworkingMode=mirrored\n");
        // `[` 后面不是字母的那一行跳过，前面那一节照旧
        mirrored("[wsl2]\n[ x ]\nnetworkingMode=mirrored\n");
    }

    #[test]
    fn the_bytes_are_read_the_way_wsl_reads_them() {
        let text = "[wsl2]\r\nnetworkingMode=mirrored\r\n";
        // 记事本存的带 BOM 的 UTF-8
        let bom8 = [&[0xEF, 0xBB, 0xBF][..], text.as_bytes()].concat();
        assert_eq!(mode_of(Some(&bom8)), NetMode::Mirrored);
        // PowerShell 5 写的 UTF-16LE
        let le = encode(text, Encoding::Utf16Le);
        assert_eq!(mode_of(Some(&le)), NetMode::Mirrored);
        // UTF-16BE WSL 不认
        let mut be = vec![0xFE, 0xFF];
        be.extend(text.encode_utf16().flat_map(u16::to_be_bytes));
        assert_eq!(mode_of(Some(&be)), NetMode::Nat);
        // 不是 UTF-8 的字节：WSL 读到那里为止
        let mut gbk = b"[wsl2]\n# ".to_vec();
        gbk.extend([0xD6, 0xD0, 0xCE, 0xC4]);
        gbk.extend(b"\nnetworkingMode=mirrored\n");
        assert_eq!(mode_of(Some(&gbk)), NetMode::Nat);
        let mut after = b"[wsl2]\nnetworkingMode=mirrored\n# ".to_vec();
        after.extend([0xD6, 0xD0]);
        assert_eq!(mode_of(Some(&after)), NetMode::Mirrored);
    }

    fn set(t: &str) -> String {
        let (out, _) = set_mirrored(t);
        assert_eq!(mode(&out), NetMode::Mirrored, "{out:?}");
        verify(t, &out).unwrap_or_else(|e| panic!("{e}: {out:?}"));
        out
    }

    #[test]
    fn a_missing_file_gets_just_the_one_setting() {
        assert_eq!(set(""), "[wsl2]\r\nnetworkingMode=mirrored\r\n");
        let (_, field) = set_mirrored("");
        assert_eq!(field, "wsl2.networkingMode");
    }

    /// 只加这一行，别的一个字节不动
    #[test]
    fn the_setting_is_added_as_the_first_line_of_wsl2() {
        assert_eq!(
            set("# 全局\n[wsl2]\nmemory=8GB\n\n[experimental]\nsparseVhd=true\n"),
            "# 全局\n[wsl2]\nnetworkingMode=mirrored\nmemory=8GB\n\n[experimental]\nsparseVhd=true\n"
        );
        assert_eq!(
            set("[wsl2]\r\nmemory=8GB\r\n"),
            "[wsl2]\r\nnetworkingMode=mirrored\r\nmemory=8GB\r\n"
        );
        // 节名是最后一行、没有换行
        assert_eq!(set("[wsl2]"), "[wsl2]\r\nnetworkingMode=mirrored");
        assert_eq!(
            set("x=1\n[WSL2] # 注释"),
            "x=1\n[WSL2] # 注释\nnetworkingMode=mirrored"
        );
    }

    #[test]
    fn without_a_wsl2_section_one_is_added_at_the_end() {
        assert_eq!(
            set("[experimental]\nsparseVhd=true\n"),
            "[experimental]\nsparseVhd=true\n\n[wsl2]\nnetworkingMode=mirrored\n"
        );
        assert_eq!(
            set("[boot]\r\nsystemd=true"),
            "[boot]\r\nsystemd=true\r\n\r\n[wsl2]\r\nnetworkingMode=mirrored\r\n"
        );
        // 已经空了一行的不再多空
        assert_eq!(
            set("[general]\nx=1\n\n"),
            "[general]\nx=1\n\n[wsl2]\nnetworkingMode=mirrored\n"
        );
        // 写坏了的 `[ wsl2 ]` 不是这一节：另加一个写对的
        assert_eq!(
            set("[ wsl2 ]\nmemory=8GB\n"),
            "[ wsl2 ]\nmemory=8GB\n\n[wsl2]\nnetworkingMode=mirrored\n"
        );
    }

    /// 写过的原地换值：键名的写法、空格、引号外的注释照旧
    #[test]
    fn a_written_value_is_replaced_in_place() {
        assert_eq!(
            set("[wsl2]\nmemory=8GB\nnetworkingMode=nat\nswap=0\n"),
            "[wsl2]\nmemory=8GB\nnetworkingMode=mirrored\nswap=0\n"
        );
        assert_eq!(
            set("[WSL2]\r\n  NetworkingMode = \"NAT\"   # 默认\r\n"),
            "[WSL2]\r\n  NetworkingMode = mirrored   # 默认\r\n"
        );
        assert_eq!(
            set("[wsl2]\nnetworkingMode=\n"),
            "[wsl2]\nnetworkingMode=mirrored\n"
        );
        assert_eq!(
            set("[wsl2]\nnetworkingMode= # 空的\n"),
            "[wsl2]\nnetworkingMode= mirrored # 空的\n"
        );
        // 写错的值也是那一项
        assert_eq!(
            set("[wsl2]\nnetworkingMode=miror\n"),
            "[wsl2]\nnetworkingMode=mirrored\n"
        );
        let (_, field) = set_mirrored("[WSL2]\nNetworkingMode=nat\n");
        assert_eq!(field, "WSL2.NetworkingMode");
    }

    /// 写在旧的 `[experimental]` 下的也原地换：另加一行的话，在前面的那一个说了算，
    /// WSL 每次启动还要报一次重复
    #[test]
    fn the_legacy_experimental_setting_is_replaced_where_it_is() {
        let before = "[experimental]\nnetworkingMode=nat\n[wsl2]\nmemory=4GB\n";
        assert_eq!(
            set(before),
            "[experimental]\nnetworkingMode=mirrored\n[wsl2]\nmemory=4GB\n"
        );
        let (_, field) = set_mirrored(before);
        assert_eq!(field, "experimental.networkingMode");
        // 后面那个重复的不管：WSL 本来就不理它
        assert_eq!(
            set("[wsl2]\nnetworkingMode=nat\n[experimental]\nnetworkingMode=nat\n"),
            "[wsl2]\nnetworkingMode=mirrored\n[experimental]\nnetworkingMode=nat\n"
        );
    }

    #[test]
    fn already_mirrored_is_left_exactly_as_it_is() {
        for t in [
            "[wsl2]\nnetworkingMode=mirrored\n",
            "[experimental]\nnetworkingMode=\"Mirrored\" # x\n",
        ] {
            assert_eq!(set_mirrored(t).0, t);
        }
    }

    #[test]
    fn verification_catches_anything_else_that_changed() {
        let before = "[wsl2]\nmemory=8GB\n";
        assert!(verify(before, "[wsl2]\nnetworkingMode=mirrored\nmemory=8GB\n").is_ok());
        // 连带改了别的
        assert!(verify(before, "[wsl2]\nnetworkingMode=mirrored\nmemory=4GB\n").is_err());
        assert!(verify(before, "[wsl2]\nnetworkingMode=mirrored\n").is_err());
        // 没改成
        assert!(verify(before, "[wsl2]\nnetworkingMode=nat\nmemory=8GB\n").is_err());
        // 写了两次
        assert!(
            verify(
                before,
                "[wsl2]\nnetworkingMode=mirrored\nnetworkingMode=mirrored\nmemory=8GB\n"
            )
            .is_err()
        );
    }

    #[test]
    fn a_file_is_written_back_in_its_own_encoding() {
        for enc in [Encoding::Utf8, Encoding::Utf8Bom, Encoding::Utf16Le] {
            let text = "# 中文注释\r\n[wsl2]\r\nmemory=8GB\r\n";
            let bytes = encode(text, enc);
            let (back, e) = decode(&bytes).unwrap();
            assert_eq!((back.as_str(), e), (text, enc));
        }
        // 不敢改的：本地代码页的中文、没有 BOM 的 UTF-16、单数个字节的 UTF-16
        assert!(decode(&[b'#', b' ', 0xD6, 0xD0, b'\n']).is_none());
        let mut raw16: Vec<u8> = "[wsl2]".encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert!(decode(&raw16).is_none());
        raw16.splice(0..0, [0xFF, 0xFE, b'x']);
        assert!(decode(&raw16).is_none());
    }

    fn profile() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let file = path(d.path());
        let backups = d.path().join("backups");
        (d, file, backups)
    }

    /// 差异里给的就是会写进去的；写之前全文备份，拿备份就能一个字节不差地还原
    #[test]
    fn switching_backs_up_the_file_and_the_backup_restores_it_exactly() {
        let (_d, file, backups) = profile();
        // PowerShell 5 写的 UTF-16LE，带中文注释和 CRLF
        let original = encode(
            "# 内存\r\n[wsl2]\r\nmemory=8GB\r\nnetworkingMode=nat\r\n",
            Encoding::Utf16Le,
        );
        std::fs::write(&file, &original).unwrap();

        let p = plan_mirrored(&file).unwrap();
        assert!(!p.is_noop());
        assert_eq!(p.field, "wsl2.networkingMode");
        assert_eq!(
            p.before_text.as_deref(),
            Some("# 内存\r\n[wsl2]\r\nmemory=8GB\r\nnetworkingMode=nat\r\n")
        );
        assert_eq!(
            p.after_text,
            "# 内存\r\n[wsl2]\r\nmemory=8GB\r\nnetworkingMode=mirrored\r\n"
        );
        let a = apply(&p, &backups).unwrap();
        assert!(!a.created);
        let written = std::fs::read(&file).unwrap();
        assert_eq!(written, p.after, "差异里给的就是写进去的");
        assert_eq!(decode(&written).unwrap().1, Encoding::Utf16Le);
        assert_eq!(mode_of(Some(&written)), NetMode::Mirrored);

        // 还原：备份就是原来那份
        assert_eq!(std::fs::read(&a.backup).unwrap(), original);
        std::fs::write(&file, std::fs::read(&a.backup).unwrap()).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), original);
        assert_eq!(mode_of(Some(&original)), NetMode::Nat);

        // 再算一次就是空操作：不写、不留第二份备份
        std::fs::write(&file, &written).unwrap();
        assert!(plan_mirrored(&file).unwrap().is_noop());
    }

    #[test]
    fn a_missing_file_is_created_and_recorded_as_created() {
        let (_d, file, backups) = profile();
        let p = plan_mirrored(&file).unwrap();
        assert!(p.before.is_none() && p.before_text.is_none());
        let a = apply(&p, &backups).unwrap();
        assert!(a.created);
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "[wsl2]\r\nnetworkingMode=mirrored\r\n"
        );
        // 原来没有这个文件：备份是空的，还原就是删掉它
        assert!(std::fs::read(&a.backup).unwrap().is_empty());
    }

    /// 读不成文字的文件不动它，说清楚为什么、手动怎么改
    #[test]
    fn a_file_in_another_encoding_is_refused_untouched() {
        let (_d, file, _backups) = profile();
        let gbk = [b'#', b' ', 0xD6, 0xD0, 0xCE, 0xC4, b'\n'];
        std::fs::write(&file, gbk).unwrap();
        let e = plan_mirrored(&file).unwrap_err();
        assert_eq!(e.code, "wslconfig.encoding");
        assert!(e.text.contains("networkingMode=mirrored"), "{}", e.text);
        assert_eq!(std::fs::read(&file).unwrap(), gbk);
    }

    /// 算完之后用户又改了文件：什么都不写
    #[test]
    fn a_file_changed_after_planning_is_not_overwritten() {
        let (_d, file, backups) = profile();
        std::fs::write(&file, "[wsl2]\nmemory=8GB\n").unwrap();
        let p = plan_mirrored(&file).unwrap();
        std::fs::write(&file, "[wsl2]\nmemory=4GB\n").unwrap();
        let e = apply(&p, &backups).unwrap_err();
        assert_eq!(e.code, "adopt.file.changed");
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "[wsl2]\nmemory=4GB\n"
        );
    }
}
