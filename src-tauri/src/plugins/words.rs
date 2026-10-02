//! 原生确认对话框里的话：权限说成它允许做的事、插件名去掉能骗人的字符、SHA-256 的前几位。
//!
//! **和界面上的说法是同一套**（`src/plugins/labels.i18n.ts`）：审核窗口里看到的权限，在系统
//! 对话框里要认得出是同一样东西。改一边要改另一边。
//!
//! 这里没有平台的东西，测试在哪个平台都跑。

use super::wire::{Permission, PluginScope};

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
            "读取和修改模型名、max_tokens、温度等参数（可能改变处理请求的上游和产生的费用）",
            "Read and change the model, max_tokens, temperature and other parameters (may change which upstream serves the request and what it costs)"
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

/// 插件名放进对话框之前：**去掉能让一句话读起来和实际不一样的字符**。
///
/// 名字是插件自己写的。换行、制表这类控制字符能在对话框里伪造出「权限：无」这样的一行；
/// 双向文本的控制符（U+202E 之类）能把后面的字倒过来；零宽字符能让两个名字看起来一样。
/// 控制字符换成空格，看不见的那几类写成码位（`<U+202E>`），连续的空白并成一个，最长 64 个字。
pub fn clean_name(raw: &str) -> String {
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
    let joined = out.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = joined.chars();
    let short: String = chars.by_ref().take(64).collect();
    if chars.next().is_some() {
        format!("{short}…")
    } else if short.is_empty() {
        tr!("（未命名）", "(unnamed)").to_string()
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
    for p in Permission::ALL {
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

/// 适用范围写成一行。什么都没限的是「全部请求」
fn scope_line(scope: &PluginScope) -> String {
    let sep = tr!("、", ", ");
    let parts: Vec<String> = [
        (tr!("客户端", "clients"), &scope.clients),
        (tr!("模型", "models"), &scope.models),
        (tr!("上游", "upstreams"), &scope.upstreams),
    ]
    .into_iter()
    .filter(|(_, list)| !list.is_empty())
    .map(|(what, list)| {
        let names: Vec<String> = list.iter().map(|x| clean_name(x)).collect();
        tr!(
            format!("{what} {}", names.join(sep)),
            format!("{what} {}", names.join(sep))
        )
    })
    .collect();
    if parts.is_empty() {
        tr!("全部请求", "all requests").to_string()
    } else {
        parts.join(tr!("；", "; "))
    }
}

fn check_line() -> &'static str {
    tr!(
        "请核对 SHA-256 与审核窗口中显示的一致。",
        "Check that the SHA-256 matches the one shown in the review window."
    )
}

/// 安装一个新插件
pub fn install(name: &str, perms: &[Permission], scope: &PluginScope, sha256: &str) -> Ask {
    let name = clean_name(name);
    let detail = tr!(
        format!(
            "此插件可以：\n{}\n\n适用范围：{}\nSHA-256：{}\n\n{}",
            permission_lines(perms, None),
            scope_line(scope),
            sha_prefix(sha256),
            check_line()
        ),
        format!(
            "This plugin can:\n{}\n\nApplies to: {}\nSHA-256: {}\n\n{}",
            permission_lines(perms, None),
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

/// 换了代码之后插件改了名字：正文第一行说出新名字。标题里写的是**现在装着的那个名字**
/// —— 用户点开的是它，换上来的代码自称什么由它自己说
fn renamed(current: &str, next: &str) -> String {
    if current == next {
        return String::new();
    }
    tr!(
        format!("新代码中的名称：「{next}」\n\n"),
        format!("Name in the new code: “{next}”\n\n")
    )
}

/// 更换一个插件的代码。`name`：现在装着的那个的名字；`new_name`、`perms`：新代码里的；
/// `previous`：原来那一版申请的权限
pub fn replace(
    name: &str,
    new_name: &str,
    perms: &[Permission],
    previous: &[Permission],
    sha256: &str,
) -> Ask {
    let (name, new_name) = (clean_name(name), clean_name(new_name));
    let renamed = renamed(&name, &new_name);
    let detail = tr!(
        format!(
            "{renamed}新的代码可以：\n{}\n\nSHA-256：{}\n\n{}",
            permission_lines(perms, Some(previous)),
            sha_prefix(sha256),
            check_line()
        ),
        format!(
            "{renamed}The new code can:\n{}\n\nSHA-256: {}\n\n{}",
            permission_lines(perms, Some(previous)),
            sha_prefix(sha256),
            check_line()
        )
    );
    Ask {
        title: tr!("更换插件代码", "Replace Plugin Code").to_string(),
        message: tr!(
            format!("更换插件「{name}」的代码"),
            format!("Replace the Code of Plugin “{name}”")
        ),
        detail,
        accept: tr!("更换", "Replace").to_string(),
        ok_hint: tr!("选择「确定」更换代码。", "Choose OK to replace the code.").to_string(),
        danger: perms.contains(&Permission::ReplyToolCalls),
    }
}

/// 确认一个插件变了的文件。参数同 [`replace`]，`from` / `to` 是确认过的和现在的 SHA-256
pub fn approve(
    name: &str,
    new_name: &str,
    perms: &[Permission],
    previous: &[Permission],
    from: &str,
    to: &str,
) -> Ask {
    let (name, new_name) = (clean_name(name), clean_name(new_name));
    let renamed = renamed(&name, &new_name);
    let detail = tr!(
        format!(
            "{renamed}更改后的文件可以：\n{}\n\nSHA-256：{} → {}\n\n{}",
            permission_lines(perms, Some(previous)),
            sha_prefix(from),
            sha_prefix(to),
            check_line()
        ),
        format!(
            "{renamed}The changed file can:\n{}\n\nSHA-256: {} → {}\n\n{}",
            permission_lines(perms, Some(previous)),
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
    }

    #[test]
    fn a_new_permission_in_a_changed_file_is_marked() {
        let a = approve(
            "p",
            "p",
            &[Permission::System, Permission::Params],
            &[Permission::System],
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

    #[test]
    fn new_code_under_another_name_says_so() {
        let same = replace(
            "附加日期",
            "附加日期",
            &[Permission::System],
            &[Permission::System],
            "aa",
        );
        let other = replace(
            "附加日期",
            "清空系统提示",
            &[Permission::System],
            &[Permission::System],
            "aa",
        );
        // 标题是装着的那个名字，新名字写在正文里
        assert!(other.message.contains("附加日期"), "{}", other.message);
        assert!(other.detail.contains("清空系统提示"), "{}", other.detail);
        assert!(!same.detail.contains("附加日期"), "{}", same.detail);
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
}
