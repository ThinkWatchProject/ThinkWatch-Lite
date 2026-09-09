//! 把 GUI 进程的窄 `$PATH` 换成用户 shell 里那个真的（DESIGN.md §2.4）。
//!
//! launchd 起的进程拿到的 PATH 只有 `/usr/bin:/bin:/usr/sbin:/sbin` ——
//! 没有 Homebrew、没有 nvm、没有 `~/.local/bin`。于是 §3.2 那个「用命令
//! 取凭据」的逃生舱（`op read`、`gcloud auth print-access-token`、
//! `gh auth token`）**手动启动时好使，开机自启后 command not found**。
//!
//! 这种时好时坏的 bug 最难查，而它的成因和「用户做错了什么」毫无关系。

use std::process::Command;
use std::time::{Duration, Instant};

/// launchd 给的那个。**认出它才敢去改** —— 从终端起的进程 PATH 本来就
/// 是对的，为它多 spawn 一个会执行用户 rc 文件的 shell 是纯浪费。
const LAUNCHD_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

/// 抓一次就够。**卡住比慢更糟**：一个写坏了的 rc 文件不该让应用起不来。
const TIMEOUT: Duration = Duration::from_secs(3);

/// 现在这个 PATH 是不是 launchd 那个最小集。
///
/// 只认完全相等（顺序也一样）。**宁可漏判**：判错方向的代价是每次启动
/// 都白跑一个 login shell，而漏判的代价只是 exec 凭据报一句已经说清楚
/// 原因的错。
fn looks_like_launchd(path: &str) -> bool {
    path == LAUNCHD_PATH
}

/// 跑一次 login shell，问它 PATH 是什么。
///
/// **用 `/usr/bin/env` 读，不要 `echo $PATH`** —— fish 把 PATH 存成列表，
/// `echo` 出来是空格分隔的，拿去当 PATH 用会得到一堆不存在的目录
/// （§7.14）。`env` 的输出在所有 shell 下都是 `PATH=a:b:c`。
fn ask_login_shell(shell: &str) -> Option<String> {
    let mut child = Command::new(shell)
        .args(["-l", "-c", "/usr/bin/env"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > TIMEOUT => {
                // 写坏了的 rc 文件会挂在这里。杀掉，用原来的 PATH 继续。
                let _ = child.kill();
                let _ = child.wait();
                tracing::warn!("{shell} -l 超过 {TIMEOUT:?} 没结束，PATH 保持不变");
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => return None,
        }
    }
    let out = child.wait_with_output().ok()?;
    parse_env_path(&String::from_utf8_lossy(&out.stdout))
}

/// 从 `env` 的输出里抠出 PATH 那一行。
fn parse_env_path(env_output: &str) -> Option<String> {
    // **只认行首的 `PATH=`。**`XDG_DATA_PATH=…` 之类的名字里也有 PATH，
    // 而某些变量的值本身就是多行的，一个 `contains` 会捞错东西。
    env_output
        .lines()
        .find_map(|l| l.strip_prefix("PATH="))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// 需要的话，把进程的 PATH 换成 login shell 那个。
///
/// **在 Tauri 起来之前、还是单线程的时候调**：`set_var` 在有其他线程同时
/// `getenv` 时是不安全的，而这里是整个进程唯一一个能保证没有并发的时刻。
pub fn fix_if_needed() {
    let current = std::env::var("PATH").unwrap_or_default();
    if !looks_like_launchd(&current) {
        return;
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let Some(real) = ask_login_shell(&shell) else {
        return;
    };
    if real == current {
        return;
    }
    tracing::info!("PATH 看起来是 launchd 的最小集，已换成 {shell} -l 里那个（exec 凭据要用）");
    // SAFETY: 在 Tauri 起来之前调用，此时进程还是单线程的。
    unsafe { std::env::set_var("PATH", &real) };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_exact_launchd_path_triggers_the_lookup() {
        // 从终端起的进程 PATH 本来就是对的，为它白跑一个 login shell
        // 是纯浪费 —— 而那个 shell 会执行用户的整套 rc 文件。
        assert!(looks_like_launchd(LAUNCHD_PATH));
        assert!(!looks_like_launchd("/opt/homebrew/bin:/usr/bin:/bin"));
        assert!(!looks_like_launchd(""));
        // 多一个目录就说明有人动过了，别再猜
        assert!(!looks_like_launchd("/usr/bin:/bin:/usr/sbin:/sbin:/x"));
    }

    #[test]
    fn the_path_line_is_matched_at_the_start_of_a_line() {
        // `XDG_DATA_PATH=…` 里也有 PATH，而某些变量的值本身是多行的。
        let out = "XDG_DATA_PATH=/wrong\nHOME=/Users/x\nPATH=/opt/homebrew/bin:/usr/bin\nSHELL=/bin/zsh\n";
        assert_eq!(parse_env_path(out).unwrap(), "/opt/homebrew/bin:/usr/bin");
    }

    #[test]
    fn a_multiline_variable_before_path_does_not_swallow_it() {
        let out = "FUNC=() {\n  echo PATH=/nope\n}\nPATH=/real/bin\n";
        assert_eq!(parse_env_path(out).unwrap(), "/real/bin");
    }

    #[test]
    fn no_path_line_means_no_answer_not_an_empty_path() {
        // 空字符串当 PATH 用会让**所有**外部命令都找不到 —— 比不改还糟。
        assert!(parse_env_path("HOME=/Users/x\n").is_none());
        assert!(parse_env_path("PATH=\n").is_none());
        assert!(parse_env_path("").is_none());
    }

    #[test]
    fn a_real_login_shell_answers_with_something_that_contains_bin() {
        // 这条打真实的 shell。它的价值是「$SHELL -l -c '/usr/bin/env'
        // 在这台机器的 shell 配置下到底能不能用」—— 那正是 §2.4 列为
        // 待实测的第 3 条。
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let p = ask_login_shell(&shell).expect("login shell 没给出 PATH");
        assert!(p.contains("/bin"), "{p}");
        // **fish 那个坑的判据是「有没有冒号」，不是「有没有空格」。**
        // `echo $PATH` 在 fish 下给的是空格分隔、一个冒号都没有的一行；
        // 而 `/usr/bin/env` 给的永远是冒号分隔。空格反而是正常的 ——
        // 这台机器的 PATH 里就有 `/Applications/VMware Fusion.app/...`，
        // 按空格判会把一个完全正确的 PATH 判成坏的。
        assert!(p.contains(':'), "PATH 没有冒号，多半是 fish 那个坑：{p}");
        assert!(
            p.split(':').all(|d| d.starts_with('/')),
            "PATH 里有不是绝对路径的项：{p}"
        );
    }
}
