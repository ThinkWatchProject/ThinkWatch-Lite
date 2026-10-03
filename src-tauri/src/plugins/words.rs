//! 系统确认框里的话：权限说成它允许做的事、插件还处理哪几种请求、插件名去掉能骗人的
//! 字符、SHA-256 的前几位、一次改动改了什么。
//!
//! **和界面上的说法是同一套**（`src/plugins/labels.i18n.ts`）：审核窗口里看到的权限，在系统
//! 对话框里要认得出是同一样东西。改一边要改另一边。
//!
//! 这里没有平台的东西，测试在哪个平台都跑。

use tw_api::{OnError, Permission, PluginScope, RequestKind};

/// 一次确认要问的话
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ask {
    /// 窗口标题（Windows、Linux 上有；macOS 的提示框没有标题栏）
    pub title: String,
    /// 第一行，加粗的那一句
    pub message: String,
    /// 下面的正文：权限、适用范围、SHA-256
    pub detail: String,
    /// 确认按钮上的字
    pub accept: String,
    /// 按钮只有「确定 / 取消」的平台（Windows 的消息框）上，正文最后补的一句
    pub ok_hint: String,
    /// 申请了高风险的权限：图标和按钮换成警示的那一种
    pub danger: bool,
}

/// 一项权限允许做的事
pub fn permission_text(p: Permission) -> &'static str {
    match p {
        Permission::System => tr!("读取和修改系统提示词", "Read and change the system prompt"),
        Permission::Messages => tr!(
            "读取和修改对话消息中的文字和工具结果（可以向对话中加入指令）",
            "Read and change the text and tool results in conversation messages (can add instructions to the conversation)"
        ),
        Permission::Tools => tr!(
            "读取和修改工具定义（会改变模型可用的工具）",
            "Read and change tool definitions (changes which tools the model can use)"
        ),
        Permission::Params => tr!(
            "读取和修改模型名、max_tokens、温度等参数（可能改变发给上游的模型和产生的费用）",
            "Read and change the model, max_tokens, temperature and other parameters (may change the model sent upstream and what it costs)"
        ),
        Permission::ReplyText => tr!(
            "读取和修改回答中的文字",
            "Read and change the text of replies"
        ),
        Permission::ReplyToolCalls => tr!(
            "修改、删除和新增回答中的工具调用。高风险：可以改写客户端将要执行的命令和文件路径",
            "Change, remove and add tool calls in replies. High risk: can rewrite the commands and file paths a client is about to run"
        ),
    }
}

/// 一种请求在界面上的叫法
pub fn kind_text(k: RequestKind) -> &'static str {
    match k {
        RequestKind::Conversation => tr!("对话", "conversations"),
        RequestKind::Embeddings => tr!("向量化", "embeddings"),
        RequestKind::Completions => tr!("补全", "completions"),
    }
}

/// 插件除了对话还处理哪几种请求：「也处理：向量化、补全」。**只处理对话的（出厂就是
/// 这样）没有这一行**；不处理对话、只处理别的几种的，说「仅处理」
pub fn requests_line(kinds: &[RequestKind]) -> Option<String> {
    let extra: Vec<&str> = RequestKind::ALL
        .iter()
        .copied()
        .filter(|k| *k != RequestKind::Conversation && kinds.contains(k))
        .map(kind_text)
        .collect();
    if extra.is_empty() {
        return None;
    }
    let list = extra.join(tr!("、", ", "));
    Some(if kinds.contains(&RequestKind::Conversation) {
        tr!(format!("也处理：{list}"), format!("Also handles: {list}"))
    } else {
        tr!(format!("仅处理：{list}"), format!("Handles only: {list}"))
    })
}

/// 插件名放进对话框之前：**去掉能让一句话读起来和实际不一样的字符**。
///
/// 名字是插件自己写的。换行、制表这类控制字符能在对话框里伪造出「权限：无」这样的一行；
/// 双向文本的控制符（U+202E 之类）能把后面的字倒过来；零宽字符能让两个名字看起来一样。
/// 控制字符换成空格，看不见的那几类写成码位（`<U+202E>`），连续的空白并成一个，最长 64 个字。
pub fn clean_name(raw: &str) -> String {
    let joined = visible(raw);
    let short = cut(&joined, 64);
    if short.is_empty() {
        tr!("（未命名）", "(unnamed)").to_string()
    } else {
        short
    }
}

/// 一个设置的值写成一小段：**只取第一行**，最长 40 个字，处理方式同 [`clean_name`]。
/// 后面还有字（下一行、超长）的接「…」；空的明说
fn clean_value(raw: &str) -> String {
    let mut lines = raw.lines().filter(|l| !l.trim().is_empty());
    let Some(first) = lines.next() else {
        return tr!("（空）", "(empty)").to_string();
    };
    let shown = cut(&visible(first), 40);
    if lines.next().is_some() && !shown.ends_with('…') {
        format!("{shown}…")
    } else {
        shown
    }
}

/// 控制字符换成空格，看不见的写成码位，连续的空白并成一个
fn visible(raw: &str) -> String {
    let mut out = String::new();
    for c in raw.chars() {
        if c.is_control() {
            out.push(' ');
        } else if invisible(c) {
            out.push_str(&format!("<U+{:04X}>", c as u32));
        } else {
            out.push(c);
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 最长 `max` 个字，多出来的写成「…」
fn cut(s: &str, max: usize) -> String {
    let mut chars = s.chars();
    let short: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{short}…")
    } else {
        short
    }
}

/// 看不见、却会改变一段字读法的字符：零宽、双向文本的控制符、BOM
fn invisible(c: char) -> bool {
    matches!(c as u32, 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064 | 0x2066..=0x2069 | 0xFEFF)
}

/// SHA-256 的前 16 位，四个一组。审核窗口里写的是同一段，对得上就是同一份代码
pub fn sha_prefix(hex: &str) -> String {
    let head: Vec<char> = hex.chars().take(16).collect();
    head.chunks(4)
        .map(|c| c.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join(" ")
}

/// 按约定的顺序列出权限；`previous` 给了的话，这一版新增的标出来
fn permission_lines(perms: &[Permission], previous: Option<&[Permission]>) -> String {
    let mut lines = Vec::new();
    for &p in Permission::ALL {
        if !perms.contains(&p) {
            continue;
        }
        let added = previous.is_some_and(|prev| !prev.contains(&p));
        let mark = if added {
            tr!("（新增）", " (new)")
        } else {
            ""
        };
        lines.push(format!("• {}{mark}", permission_text(p)));
    }
    if lines.is_empty() {
        lines.push(format!("• {}", tr!("未申请任何权限", "No permissions")));
    }
    lines.join("\n")
}

/// 「此插件可以：」下面的那一段：每项权限一行，处理的不止对话时再加一行
fn abilities(
    perms: &[Permission],
    previous: Option<&[Permission]>,
    kinds: &[RequestKind],
) -> String {
    let mut out = permission_lines(perms, previous);
    if let Some(line) = requests_line(kinds) {
        out.push('\n');
        out.push_str(&line);
    }
    out
}

/// 适用范围的一项
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScopePart {
    Clients,
    Models,
    Upstreams,
}

impl ScopePart {
    pub const ALL: [ScopePart; 3] = [ScopePart::Clients, ScopePart::Models, ScopePart::Upstreams];

    fn text(self) -> &'static str {
        match self {
            ScopePart::Clients => tr!("客户端", "clients"),
            ScopePart::Models => tr!("模型", "models"),
            ScopePart::Upstreams => tr!("上游", "upstreams"),
        }
    }

    pub fn of(self, scope: &PluginScope) -> &[String] {
        match self {
            ScopePart::Clients => &scope.clients,
            ScopePart::Models => &scope.models,
            ScopePart::Upstreams => &scope.upstreams,
        }
    }
}

/// 一张名单写成一段：通配原样，去掉能骗人的字符。空的是「全部」
fn list_text(list: &[String]) -> String {
    if list.is_empty() {
        return tr!("全部", "all").to_string();
    }
    let names: Vec<String> = list.iter().map(|x| clean_name(x)).collect();
    names.join(tr!("、", ", "))
}

/// 适用范围写成一行。什么都没限的是「全部请求」
fn scope_line(scope: &PluginScope) -> String {
    let parts: Vec<String> = ScopePart::ALL
        .into_iter()
        .filter(|p| !p.of(scope).is_empty())
        .map(|p| format!("{} {}", p.text(), list_text(p.of(scope))))
        .collect();
    if parts.is_empty() {
        tr!("全部请求", "all requests").to_string()
    } else {
        parts.join(tr!("；", "; "))
    }
}

fn check_line() -> &'static str {
    tr!(
        "请核对 SHA-256 与应用中显示的一致。",
        "Check that the SHA-256 matches the one shown in the app."
    )
}

/// 安装一个新插件
pub fn install(
    name: &str,
    perms: &[Permission],
    kinds: &[RequestKind],
    scope: &PluginScope,
    sha256: &str,
) -> Ask {
    let name = clean_name(name);
    let can = abilities(perms, None, kinds);
    let detail = tr!(
        format!(
            "此插件可以：\n{can}\n\n适用范围：{}\nSHA-256：{}\n\n{}",
            scope_line(scope),
            sha_prefix(sha256),
            check_line()
        ),
        format!(
            "This plugin can:\n{can}\n\nApplies to: {}\nSHA-256: {}\n\n{}",
            scope_line(scope),
            sha_prefix(sha256),
            check_line()
        )
    );
    Ask {
        title: tr!("安装插件", "Install Plugin").to_string(),
        message: tr!(
            format!("安装插件「{name}」"),
            format!("Install Plugin “{name}”")
        ),
        detail,
        accept: tr!("安装", "Install").to_string(),
        ok_hint: tr!(
            "选择「确定」安装此插件。",
            "Choose OK to install the plugin."
        )
        .to_string(),
        danger: perms.contains(&Permission::ReplyToolCalls),
    }
}

/// 改了代码之后插件改了名字：正文第一行说出新名字。标题里写的是**现在装着的那个名字**
/// —— 用户点开的是它，新代码自称什么由它自己说
fn renamed(current: &str, next: &str) -> String {
    if current == next {
        return String::new();
    }
    tr!(
        format!("新代码中的名称：「{next}」\n\n"),
        format!("Name in the new code: “{next}”\n\n")
    )
}

/// 确认一个插件磁盘上变了的文件。`name`：现在装着的那个的名字；`new_name`、`perms`、`kinds`：
/// 改过的文件里的；`previous`：原来那一版申请的权限（读不出来是 `None`，就不标新增）；
/// `from` / `to` 是确认过的和现在的 SHA-256
pub fn approve(
    name: &str,
    new_name: &str,
    perms: &[Permission],
    kinds: &[RequestKind],
    previous: Option<&[Permission]>,
    from: &str,
    to: &str,
) -> Ask {
    let (name, new_name) = (clean_name(name), clean_name(new_name));
    let renamed = renamed(&name, &new_name);
    let can = abilities(perms, previous, kinds);
    let detail = tr!(
        format!(
            "{renamed}更改后的文件可以：\n{can}\n\nSHA-256：{} → {}\n\n{}",
            sha_prefix(from),
            sha_prefix(to),
            check_line()
        ),
        format!(
            "{renamed}The changed file can:\n{can}\n\nSHA-256: {} → {}\n\n{}",
            sha_prefix(from),
            sha_prefix(to),
            check_line()
        )
    );
    Ask {
        title: tr!("确认文件更改", "Approve File Changes").to_string(),
        message: tr!(
            format!("确认插件「{name}」的文件更改"),
            format!("Approve the Changed File of Plugin “{name}”")
        ),
        detail,
        accept: tr!("确认", "Approve").to_string(),
        ok_hint: tr!("选择「确定」确认更改。", "Choose OK to approve the change.").to_string(),
        danger: perms.contains(&Permission::ReplyToolCalls),
    }
}

/// 一次保存里的一项。值都已经写成给人看的样子（[`setting_value`]）
#[derive(Debug, Clone, PartialEq)]
pub enum Change {
    TurnOn,
    TurnOff,
    /// 改了代码（不只是出错时、范围、设置的值）：确认过的和新的 SHA-256
    Code {
        from: String,
        to: String,
    },
    OnError {
        from: OnError,
        to: OnError,
    },
    Scope {
        part: ScopePart,
        from: Vec<String>,
        to: Vec<String>,
    },
    Setting {
        label: String,
        from: String,
        to: String,
    },
}

/// 一个设置的值写给人看：开关是「开 / 关」，数照原样，字只取一小段
pub fn setting_value(v: &tw_api::SettingValue) -> String {
    match v {
        tw_api::SettingValue::Bool(true) => tr!("开", "on").to_string(),
        tw_api::SettingValue::Bool(false) => tr!("关", "off").to_string(),
        tw_api::SettingValue::Number(n) if n.fract() == 0.0 && n.abs() < 1e15 => {
            format!("{}", *n as i64)
        }
        tw_api::SettingValue::Number(n) => format!("{n}"),
        tw_api::SettingValue::String(s) => clean_value(s),
    }
}

fn on_error_text(o: OnError) -> &'static str {
    match o {
        OnError::Reject => tr!("拒绝这次请求", "Reject the request"),
        OnError::Skip => tr!("跳过此插件", "Skip this plugin"),
    }
}

fn change_line(c: &Change) -> String {
    match c {
        Change::TurnOn => tr!("启用此插件", "Turn on the plugin").to_string(),
        Change::TurnOff => tr!("停用此插件", "Turn off the plugin").to_string(),
        Change::Code { from, to } => tr!(
            format!(
                "修改代码（SHA-256：{} → {}）",
                sha_prefix(from),
                sha_prefix(to)
            ),
            format!(
                "Change the code (SHA-256: {} → {})",
                sha_prefix(from),
                sha_prefix(to)
            )
        ),
        Change::OnError { from, to } => tr!(
            format!("出错时：{} → {}", on_error_text(*from), on_error_text(*to)),
            format!(
                "On error: {} → {}",
                on_error_text(*from),
                on_error_text(*to)
            )
        ),
        Change::Scope { part, from, to } => tr!(
            format!(
                "适用范围（{}）：{} → {}",
                part.text(),
                list_text(from),
                list_text(to)
            ),
            format!(
                "Applies to ({}): {} → {}",
                part.text(),
                list_text(from),
                list_text(to)
            )
        ),
        Change::Setting { label, from, to } => {
            let label = clean_name(label);
            tr!(
                format!("设置「{label}」：{from} → {to}"),
                format!("Setting “{label}”: {from} → {to}")
            )
        }
    }
}

/// 保存一个改得了工具调用的插件：打开它，或者改了它的代码（`SavePluginConfirmed`）。
///
/// 先写**这次改什么**，再写**它能做什么**：用户点开的是一次保存，要确认的是这一次。只是
/// 打开它的，标题和按钮都说「启用」。`name`：现在装着的那个的名字；`new_name`、`perms`、
/// `kinds`：要保存的代码里的；`previous`：确认过的那一版申请的权限（读不出来是 `None`：
/// 不标新增，按改得了工具调用对待）
pub fn save(
    name: &str,
    new_name: &str,
    perms: &[Permission],
    kinds: &[RequestKind],
    previous: Option<&[Permission]>,
    changes: &[Change],
) -> Ask {
    let (name, new_name) = (clean_name(name), clean_name(new_name));
    let only_on = changes == [Change::TurnOn];
    let code = changes.iter().any(|c| matches!(c, Change::Code { .. }));
    let renamed = if code {
        renamed(&name, &new_name)
    } else {
        String::new()
    };
    let mut lines: Vec<String> = changes
        .iter()
        .map(|c| format!("• {}", change_line(c)))
        .collect();
    if lines.is_empty() {
        // core 认为要点头、这里比不出改了什么：照实说是一次保存
        lines.push(format!("• {}", tr!("保存此插件", "Save the plugin")));
    }
    let changes_text = lines.join("\n");
    let can = abilities(perms, previous, kinds);
    let check = if code {
        format!("\n\n{}", check_line())
    } else {
        String::new()
    };
    let detail = tr!(
        format!("{renamed}本次改动：\n{changes_text}\n\n此插件可以：\n{can}{check}"),
        format!("{renamed}Changes:\n{changes_text}\n\nThis plugin can:\n{can}{check}")
    );
    Ask {
        title: tr!("确认插件改动", "Confirm Plugin Changes").to_string(),
        message: if only_on {
            tr!(
                format!("启用插件「{name}」"),
                format!("Turn On Plugin “{name}”")
            )
        } else {
            tr!(
                format!("保存插件「{name}」"),
                format!("Save Plugin “{name}”")
            )
        },
        detail,
        accept: if only_on {
            tr!("启用", "Turn On").to_string()
        } else {
            tr!("保存", "Save").to_string()
        },
        ok_hint: if only_on {
            tr!(
                "选择「确定」启用此插件。",
                "Choose OK to turn on the plugin."
            )
            .to_string()
        } else {
            tr!("选择「确定」保存改动。", "Choose OK to save the changes.").to_string()
        },
        danger: perms.contains(&Permission::ReplyToolCalls)
            || previous.is_none_or(|p| p.contains(&Permission::ReplyToolCalls)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_cannot_forge_lines_or_turn_text_around() {
        // 换行伪造出一行「权限：无」，U+202E 把后面倒过来，零宽空格藏在中间
        let raw = "日期\n\n权限：无\u{202E}txt.exe\u{200B}";
        let clean = clean_name(raw);
        assert!(!clean.contains('\n'), "{clean}");
        assert!(
            !clean.contains('\u{202E}') && !clean.contains('\u{200B}'),
            "{clean}"
        );
        assert!(
            clean.contains("<U+202E>") && clean.contains("<U+200B>"),
            "{clean}"
        );
    }

    #[test]
    fn a_long_name_is_cut_and_an_empty_one_is_named() {
        let long = "x".repeat(200);
        assert_eq!(clean_name(&long).chars().count(), 65);
        assert!(!clean_name(" \n\t").is_empty());
    }

    #[test]
    fn the_sha_prefix_is_four_groups_of_four() {
        assert_eq!(
            sha_prefix("6f1c9a0277be41d0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            "6f1c 9a02 77be 41d0"
        );
        assert_eq!(sha_prefix("abc"), "abc");
    }

    #[test]
    fn the_install_dialog_names_every_permission_and_the_hash() {
        let a = install(
            "附加当前日期",
            &[Permission::ReplyToolCalls, Permission::System],
            &[RequestKind::Conversation],
            &PluginScope::default(),
            "6f1c9a0277be41d0ffff",
        );
        // 两项都在，按约定的顺序：系统提示词在前
        let sys = a.detail.find(permission_text(Permission::System)).unwrap();
        let tools = a
            .detail
            .find(permission_text(Permission::ReplyToolCalls))
            .unwrap();
        assert!(sys < tools, "{}", a.detail);
        assert!(a.detail.contains("6f1c 9a02 77be 41d0"), "{}", a.detail);
        assert!(a.danger);
        assert!(a.message.contains("附加当前日期"));
        // 只处理对话的不多一行
        assert!(!a.detail.contains("也处理"), "{}", a.detail);
    }

    /// 处理的不止对话：三个确认框都写出来，只写多出来的那几种
    #[test]
    fn extra_request_kinds_are_named_in_every_dialog() {
        let all = [
            RequestKind::Conversation,
            RequestKind::Embeddings,
            RequestKind::Completions,
        ];
        let line = requests_line(&all).unwrap();
        assert_eq!(line, "也处理：向量化、补全");
        let perms = [Permission::Messages];
        let asks = [
            install("p", &perms, &all, &PluginScope::default(), "aa"),
            save("p", "p", &perms, &all, Some(&perms), &[Change::TurnOn]),
            approve("p", "p", &perms, &all, Some(&perms), "aa", "bb"),
        ];
        for a in &asks {
            assert!(a.detail.contains(&line), "{}", a.detail);
        }
        assert_eq!(
            requests_line(&[RequestKind::Embeddings]).as_deref(),
            Some("仅处理：向量化")
        );
        assert_eq!(requests_line(&[RequestKind::Conversation]), None);
    }

    #[test]
    fn a_new_permission_in_a_changed_file_is_marked() {
        let a = approve(
            "p",
            "p",
            &[Permission::System, Permission::Params],
            &[RequestKind::Conversation],
            Some(&[Permission::System]),
            "aaaa",
            "bbbb",
        );
        let params = a
            .detail
            .lines()
            .find(|l| l.contains(permission_text(Permission::Params)))
            .unwrap();
        let system = a
            .detail
            .lines()
            .find(|l| l.contains(permission_text(Permission::System)))
            .unwrap();
        assert_ne!(params, format!("• {}", permission_text(Permission::Params)));
        assert_eq!(system, format!("• {}", permission_text(Permission::System)));
        assert!(!a.danger);
    }

    /// 原来那一版的权限读不出来：不标新增（不知道哪一项是新的），按改得了工具调用对待
    #[test]
    fn nothing_is_marked_new_when_the_old_permissions_are_unknown() {
        let a = save(
            "p",
            "p",
            &[Permission::System],
            &[RequestKind::Conversation],
            None,
            &[Change::TurnOn],
        );
        assert!(!a.detail.contains("新增"), "{}", a.detail);
        assert!(a.danger);
    }

    #[test]
    fn new_code_under_another_name_says_so() {
        let kinds = [RequestKind::Conversation];
        let sys = [Permission::System];
        let code = [Change::Code {
            from: "aaaa".into(),
            to: "bbbb".into(),
        }];
        let same = save("附加日期", "附加日期", &sys, &kinds, Some(&sys), &code);
        let other = save("附加日期", "清空系统提示", &sys, &kinds, Some(&sys), &code);
        // 标题是装着的那个名字，新名字写在正文里
        assert!(other.message.contains("附加日期"), "{}", other.message);
        assert!(other.detail.contains("清空系统提示"), "{}", other.detail);
        assert!(!same.detail.contains("附加日期"), "{}", same.detail);
        // 改了代码：写新旧两个 SHA-256，请人核对
        assert!(same.detail.contains("aaaa → bbbb"), "{}", same.detail);
        assert!(same.detail.contains(check_line()), "{}", same.detail);
    }

    #[test]
    fn the_scope_line_says_all_when_nothing_is_limited() {
        let all = scope_line(&PluginScope::default());
        let some = scope_line(&PluginScope {
            clients: vec!["claude-code".into()],
            models: vec!["claude-*".into()],
            upstreams: vec![],
        });
        assert_ne!(all, some);
        assert!(
            some.contains("claude-code") && some.contains("claude-*"),
            "{some}"
        );
    }

    /// 只是打开它：标题、按钮都说「启用」，正文先写这次改什么、再写它能做什么
    #[test]
    fn turning_a_tool_call_plugin_on_says_what_changes_and_what_it_can_do() {
        let perms = [Permission::Messages, Permission::ReplyToolCalls];
        let kinds = [RequestKind::Conversation];
        let a = save(
            "WSL 路径转换",
            "WSL 路径转换",
            &perms,
            &kinds,
            Some(&perms),
            &[Change::TurnOn],
        );
        assert_eq!(a.message, "启用插件「WSL 路径转换」");
        assert_eq!(a.accept, "启用");
        assert!(a.danger);
        let change = a.detail.find("启用此插件").unwrap();
        let can = a
            .detail
            .find(permission_text(Permission::ReplyToolCalls))
            .unwrap();
        assert!(change < can, "{}", a.detail);
        // 没改代码：不用核对 SHA-256
        assert!(!a.detail.contains(check_line()), "{}", a.detail);
    }

    #[test]
    fn a_data_change_lists_each_change_and_the_values_stay_on_one_line() {
        let perms = [Permission::Messages, Permission::ReplyToolCalls];
        let a = save(
            "p",
            "p",
            &perms,
            &[RequestKind::Conversation],
            Some(&perms),
            &[
                Change::TurnOn,
                Change::Setting {
                    label: "替换表\n伪造的一行".into(),
                    from: setting_value(&tw_api::SettingValue::String("a=b\nc=d".into())),
                    to: setting_value(&tw_api::SettingValue::String(String::new())),
                },
                Change::Scope {
                    part: ScopePart::Models,
                    from: vec![],
                    to: vec!["deepseek*".into()],
                },
            ],
        );
        assert_eq!(a.accept, "保存");
        assert!(a.danger);
        assert!(
            a.detail
                .contains("设置「替换表 伪造的一行」：a=b… → （空）"),
            "{}",
            a.detail
        );
        assert!(
            a.detail.contains("适用范围（模型）：全部 → deepseek*"),
            "{}",
            a.detail
        );
    }

    /// 新代码多要了工具调用：标「新增」，警示的样子
    #[test]
    fn new_code_that_adds_tool_calls_is_marked() {
        let a = save(
            "p",
            "p",
            &[Permission::System, Permission::ReplyToolCalls],
            &[RequestKind::Conversation],
            Some(&[Permission::System]),
            &[Change::Code {
                from: "aa".into(),
                to: "bb".into(),
            }],
        );
        let line = a
            .detail
            .lines()
            .find(|l| l.contains(permission_text(Permission::ReplyToolCalls)))
            .unwrap();
        assert!(line.contains("新增"), "{line}");
        assert!(a.danger);
    }

    #[test]
    fn setting_values_read_like_the_form() {
        use tw_api::SettingValue::*;
        assert_eq!(setting_value(&Bool(true)), "开");
        assert_eq!(setting_value(&Number(8.0)), "8");
        assert_eq!(setting_value(&Number(2.5)), "2.5");
        assert_eq!(setting_value(&String("x".repeat(50))).chars().count(), 41);
    }
}
