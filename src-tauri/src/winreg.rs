//! 当前用户名下（HKCU）的几项注册：`thinkwatch://` 链接、系统通知的应用登记、开机自启。
//!
//! **谁运行就听谁的。**安装版和绿色版同一时间只会有一个在运行，所以每次启动都把
//! 这几项改成指向正在运行的这个 exe；清理时只删指向自己的那几项。
//!
//! - 链接：`HKCU\Software\Classes\thinkwatch`。它盖过安装程序写在 HKLM 的那一份；删掉
//!   HKCU 这一条，就回到 HKLM 的（安装版还在的话）。
//! - 开机自启：`HKCU\…\Run` 里的一个值，值名是产品名（自启插件就是这么起名的，老版本
//!   写下的那一条因此也认得）。**全机只有这一条**，开关是两份共用的：开着 = 这一项在
//!   （指向哪一份都算），而且没被 Windows 的「启动应用」关掉。
//! - 系统通知：`HKCU\Software\Classes\AppUserModelId\<AUMID>` 的名字和图标，见
//!   `notices::windows`。安装版、绿色版各登记各的 AUMID。
//!
//! **开发构建不碰注册表**（`autostart::allowed_in_this_build`）：开发机上多半还装着一份，
//! 跑一次 `tauri dev` 不该把链接和自启改指向 `target\debug\…`。
//!
//! 路径怎么比、命令行怎么拼、怎么认出「指向自己」，是下面几个纯函数，哪个平台都测；
//! 读写注册表的在 `imp` 里，只有 Windows 有，测试在 Windows 的 CI 上对着一个临时子键跑。

// 纯函数和常量在每个平台都编译，测试因此在哪都跑；真正调它们的只有 Windows
#![cfg_attr(not(windows), allow(dead_code))]

use std::path::Path;

/// 应用标识，`tauri.conf.json` 的 `identifier`。单实例的锁和窗口、系统通知的 AUMID、
/// 链接的说明都从它来。**有几处用在 Tauri 起来之前**（`single::precheck`、无界面的清理），
/// 那时没有 AppHandle 可问，所以抄一份；测试核对它和配置文件一致
pub(crate) const IDENTIFIER: &str = "app.thinkwatch.lite";

/// 产品名，`tauri.conf.json` 的 `productName`：开机自启的值名（插件取的是
/// `package_info().name`，也就是它）、系统通知上显示的名字。清理时同样没有 AppHandle
pub(crate) const PRODUCT_NAME: &str = "ThinkWatch Lite";

/// 链接的协议名
pub(crate) const SCHEME: &str = "thinkwatch";

/// 系统通知的图标，写在数据目录里。**登记里只认图片文件**，填 exe 不行
pub(crate) const NOTIFICATION_ICON: &str = "notification-icon.png";

/// 这次启动有没有登记上系统通知（见 [`notifications_registered`]）
static REGISTERED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 启动时调用：链接、开机自启（开着的话）、通知登记都改成指向正在运行的这个 exe。
/// 不是 Windows、或者是开发构建，什么都不做。
///
/// **要在挑选系统通知的投递端之前调**：那里问 [`notifications_registered`]。
pub fn claim(app: &tauri::AppHandle) {
    let _ = app;
    #[cfg(windows)]
    if crate::autostart::allowed_in_this_build() {
        match std::env::current_exe() {
            Ok(exe) => {
                let aumid = crate::notices::windows::aumid(crate::portable::is_portable());
                let ok = imp::claim(
                    &imp::Hive::user(),
                    &plain_path(&exe.to_string_lossy()),
                    &crate::data_dir(),
                    &aumid,
                );
                REGISTERED.store(ok, std::sync::atomic::Ordering::SeqCst);
            }
            Err(e) => tracing::warn!("找不到自己的路径，链接、自启、通知登记都没动：{e}"),
        }
    }
}

/// 清理：删掉指向 `exe` 的注册项（链接、开机自启、这一份的通知登记和图标），做了什么、
/// 哪一项没做成，各一行。**指向别处的不动**：那是另一份 ThinkWatch Lite 的。
///
/// 不是 Windows、或者是开发构建（它从不写注册表），什么都不做。
pub fn release_all(exe: &Path) -> Vec<crate::wire::UninstallStep> {
    #[cfg(windows)]
    if crate::autostart::allowed_in_this_build() {
        let aumid = crate::notices::windows::aumid(crate::portable::is_portable());
        return imp::release_all(
            &imp::Hive::user(),
            &plain_path(&exe.to_string_lossy()),
            &crate::data_dir(),
            &aumid,
        );
    }
    let _ = exe;
    Vec::new()
}

/// 系统通知登记上了没有。没登记上（开发构建、写不进注册表）就不用原生的通知，
/// 见 `notices::windows::available`
pub(crate) fn notifications_registered() -> bool {
    REGISTERED.load(std::sync::atomic::Ordering::SeqCst)
}

/// 开机自启现在开着吗：Run 里有这一项（指向哪一份都算），而且没被 Windows 关掉
#[cfg(windows)]
pub(crate) fn autostart_on() -> bool {
    imp::autostart_on(&imp::Hive::user())
}

/// 打开（写一条指向自己的）或关掉（删掉这一项）开机自启，返回之后实际的状态
#[cfg(windows)]
pub(crate) fn set_autostart(on: bool) -> Result<bool, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    imp::set_autostart(&imp::Hive::user(), &plain_path(&exe.to_string_lossy()), on)
}

/// 去掉 `\\?\` 这种前缀：`canonicalize` 给出的是带它的写法，注册表里、别的程序认的都是
/// 不带的
pub(crate) fn plain_path(p: &str) -> String {
    if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = p.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        p.to_string()
    }
}

/// 两个路径是不是同一个文件：去掉 `\\?\`、斜杠统一成反斜杠、**不分大小写**（Windows 的
/// 文件名不分）。不碰磁盘，链接、短文件名要由调用方先展开
pub(crate) fn same_path(a: &str, b: &str) -> bool {
    fn norm(p: &str) -> String {
        plain_path(p.trim()).replace('/', "\\").to_lowercase()
    }
    norm(a) == norm(b)
}

/// 一条命令行启动的是哪个程序。
///
/// 带引号的取引号里那一段。**不带引号的也得认**：老版本用自启插件写的那一条就不带，
/// 而路径里可以有空格（`C:\Program Files\…`）—— 取到后面紧跟空白或结尾的 `.exe` 为止，
/// 没有这样的 `.exe` 就取到第一个空白
pub(crate) fn command_exe(cmd: &str) -> Option<&str> {
    let cmd = cmd.trim();
    if let Some(rest) = cmd.strip_prefix('"') {
        let end = rest.find('"').unwrap_or(rest.len());
        return Some(&rest[..end]).filter(|s| !s.is_empty());
    }
    // 只把 ASCII 换成小写，字节位置不变，下标可以拿回原串用
    let lower = cmd.to_ascii_lowercase();
    let end = lower
        .match_indices(".exe")
        .map(|(i, _)| i + 4)
        .find(|&i| cmd[i..].chars().next().is_none_or(char::is_whitespace))
        .or_else(|| cmd.find(char::is_whitespace))
        .unwrap_or(cmd.len());
    Some(&cmd[..end]).filter(|s| !s.is_empty())
}

/// 这条命令行启动的是不是 `exe`
pub(crate) fn command_runs(cmd: &str, exe: &str) -> bool {
    command_exe(cmd).is_some_and(|c| same_path(c, exe))
}

/// 点开链接时执行的命令
pub(crate) fn open_command(exe: &str) -> String {
    format!("\"{exe}\" \"%1\"")
}

/// 开机自启的命令：带上标记，启动时靠它知道是开机拉起来的（见 `autostart`）
pub(crate) fn autostart_command(exe: &str) -> String {
    format!("\"{exe}\" {}", crate::autostart::AUTOSTART_FLAG)
}

#[cfg(windows)]
mod imp {
    use std::path::Path;

    use windows_registry::{CURRENT_USER, Key, Result, Type};

    use super::{
        IDENTIFIER, NOTIFICATION_ICON, PRODUCT_NAME, SCHEME, autostart_command, command_exe,
        command_runs, open_command, same_path,
    };
    use crate::wire::UninstallStep;

    const RUN: &str = r"Microsoft\Windows\CurrentVersion\Run";
    /// 「设置 › 应用 › 启动」的开关记在这里，键名和 Run 里的值名相同
    const APPROVED: &str = r"Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    /// `StartupApproved` 里「开着」的那一串（见 `autostart::approved_from_bytes`），
    /// 和自启插件写的相同
    const APPROVED_ON: [u8; 12] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    /// 要动的那一块注册表：平时是 `HKCU\Software`，测试换成它下面的一个临时子键
    pub(super) struct Hive {
        base: String,
    }

    impl Hive {
        pub(super) fn user() -> Self {
            Self {
                base: "Software".into(),
            }
        }

        #[cfg(test)]
        pub(super) fn under(base: String) -> Self {
            Self { base }
        }

        fn path(&self, sub: &str) -> String {
            format!(r"{}\{sub}", self.base)
        }

        /// 只读打开；不存在是 `None`
        fn open(&self, sub: &str) -> Result<Option<Key>> {
            absent_is_none(CURRENT_USER.open(self.path(sub)))
        }

        /// 读写打开，**不存在不建**（删值之前用：不该为了删一个值建出一个键来）
        fn open_rw(&self, sub: &str) -> Result<Option<Key>> {
            absent_is_none(CURRENT_USER.options().read().write().open(self.path(sub)))
        }

        /// 读写打开，不存在就建
        fn create(&self, sub: &str) -> Result<Key> {
            CURRENT_USER.create(self.path(sub))
        }

        fn remove_tree(&self, sub: &str) -> Result<()> {
            CURRENT_USER.remove_tree(self.path(sub))
        }
    }

    fn link_key() -> String {
        format!(r"Classes\{SCHEME}")
    }

    fn aumid_key(aumid: &str) -> String {
        format!(r"Classes\AppUserModelId\{aumid}")
    }

    /// 键或值不存在算 `None`，别的错照旧
    fn absent_is_none<T>(r: Result<T>) -> Result<Option<T>> {
        match r {
            Ok(v) => Ok(Some(v)),
            // HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)
            Err(e) if e.code().0 == 0x8007_0002_u32 as i32 => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// 一个字符串值；键或值不存在是 `None`
    fn read_string(hive: &Hive, sub: &str, name: &str) -> Result<Option<String>> {
        let Some(key) = hive.open(sub)? else {
            return Ok(None);
        };
        absent_is_none(key.get_string(name))
    }

    /// 启动时的那一套。返回系统通知登记上了没有
    pub(super) fn claim(hive: &Hive, exe: &str, dir: &Path, aumid: &str) -> bool {
        if let Err(e) = claim_link(hive, exe) {
            tracing::warn!("未能把 thinkwatch:// 链接指向这个程序：{e}");
        }
        if let Err(e) = follow_autostart(hive, exe) {
            tracing::warn!("未能把开机自启指向这个程序：{e}");
        }
        match register_notifications(hive, dir, aumid) {
            Ok(()) => true,
            Err(e) => {
                tracing::warn!("未能登记系统通知，退回插件：{e}");
                false
            }
        }
    }

    /// 链接写成指向 `exe`。和安装程序写在 HKLM 的那一份同一个写法，只是位置不同
    fn claim_link(hive: &Hive, exe: &str) -> Result<()> {
        let key = hive.create(&link_key())?;
        key.set_string("", format!("URL:{IDENTIFIER} protocol"))?;
        key.set_string("URL Protocol", "")?;
        key.create("DefaultIcon")?
            .set_string("", format!("\"{exe}\",0"))?;
        key.create(r"shell\open\command")?
            .set_string("", open_command(exe))
    }

    /// 开机自启在的话，改成指向 `exe`（保留开机标记）。
    ///
    /// **被 Windows 关掉的也改**：「启动应用」里那个开关按值名记，改了命令它照样关着；
    /// 不改的话，用户之后在那里重新打开，拉起来的是另一份
    fn follow_autostart(hive: &Hive, exe: &str) -> Result<()> {
        let Some(run) = hive.open_rw(RUN)? else {
            return Ok(());
        };
        let Some(cmd) = absent_is_none(run.get_string(PRODUCT_NAME))? else {
            return Ok(());
        };
        let want = autostart_command(exe);
        if cmd != want {
            run.set_string(PRODUCT_NAME, &want)?;
            tracing::info!(from = %cmd, "开机自启改为指向这个程序");
        }
        Ok(())
    }

    /// 系统通知的名字和图标。图标从二进制里写出来。
    ///
    /// **图标写不出来，`IconUri` 也照样填这一份该有的路径**：系统找不到文件就用默认的
    /// 图标，名字照常显示；而清理时认「这份登记是不是自己的」靠的正是这个路径（见
    /// `release_notifications`）—— 不填的话，这份登记卸载时就没人认领了
    fn register_notifications(hive: &Hive, dir: &Path, aumid: &str) -> Result<()> {
        let icon = dir.join(NOTIFICATION_ICON);
        if let Err(e) = write_icon(&icon) {
            tracing::warn!(icon = %icon.display(), "通知图标写不出来，通知上用默认的图标：{e}");
        }
        let key = hive.create(&aumid_key(aumid))?;
        // 两个都写成 REG_EXPAND_SZ，和 Windows App SDK 给未打包应用登记时一样
        key.set_expand_string("DisplayName", PRODUCT_NAME)?;
        key.set_expand_string("IconUri", icon.to_string_lossy())
    }

    /// 内容没变就不重写
    fn write_icon(path: &Path) -> std::io::Result<()> {
        const PNG: &[u8] = include_bytes!("../icons/128x128.png");
        if std::fs::read(path).is_ok_and(|b| b == PNG) {
            return Ok(());
        }
        crate::atomic_file::write(path, PNG)
    }

    pub(super) fn autostart_on(hive: &Hive) -> bool {
        let present = matches!(read_string(hive, RUN, PRODUCT_NAME), Ok(Some(_)));
        present && approved(hive) != Some(false)
    }

    /// 「设置 › 应用 › 启动」里的开关：`Some(false)` = 被关掉了；`None` = 没碰过它
    fn approved(hive: &Hive) -> Option<bool> {
        let key = hive.open(APPROVED).ok()??;
        let v = key.get_value(PRODUCT_NAME).ok()?;
        if v.ty() != Type::Bytes {
            return None;
        }
        crate::autostart::approved_from_bytes(&v)
    }

    pub(super) fn set_autostart(
        hive: &Hive,
        exe: &str,
        on: bool,
    ) -> std::result::Result<bool, String> {
        let r = if on {
            enable_autostart(hive, exe)
        } else {
            disable_autostart(hive)
        };
        r.map_err(|e| e.to_string())?;
        Ok(autostart_on(hive))
    }

    fn enable_autostart(hive: &Hive, exe: &str) -> Result<()> {
        hive.create(RUN)?
            .set_string(PRODUCT_NAME, autostart_command(exe))?;
        // 在「启动应用」里被关掉过：一并打开，否则勾上之后开关自己弹回去
        if approved(hive) == Some(false) {
            hive.create(APPROVED)?
                .set_bytes(PRODUCT_NAME, Type::Bytes, &APPROVED_ON)?;
        }
        Ok(())
    }

    fn disable_autostart(hive: &Hive) -> Result<()> {
        if let Some(run) = hive.open_rw(RUN)? {
            absent_is_none(run.remove_value(PRODUCT_NAME))?;
        }
        Ok(())
    }

    pub(super) fn release_all(
        hive: &Hive,
        exe: &str,
        dir: &Path,
        aumid: &str,
    ) -> Vec<UninstallStep> {
        let mut out = Vec::new();
        release_link(hive, exe, &mut out);
        release_autostart(hive, exe, &mut out);
        release_notifications(hive, dir, aumid, &mut out);
        out
    }

    fn release_link(hive: &Hive, exe: &str, out: &mut Vec<UninstallStep>) {
        let command = read_string(hive, &format!(r"{}\shell\open\command", link_key()), "");
        let removed = match command {
            // 没有，或者指向另一份：不是这一份的，不提
            Ok(None) => return,
            Ok(Some(cmd)) if !command_runs(&cmd, exe) => return,
            Ok(Some(_)) => absent_is_none(hive.remove_tree(&link_key())).map(|_| ()),
            Err(e) => Err(e),
        };
        out.push(match removed {
            Ok(()) => UninstallStep::done(tr!(
                "已移除 thinkwatch:// 链接",
                "thinkwatch:// links unregistered"
            )),
            Err(e) => UninstallStep::failed(tr!(
                format!("未能移除 thinkwatch:// 链接（{e}）"),
                format!("thinkwatch:// links could not be unregistered ({e})")
            )),
        });
    }

    fn release_autostart(hive: &Hive, exe: &str, out: &mut Vec<UninstallStep>) {
        let removed = match read_string(hive, RUN, PRODUCT_NAME) {
            Ok(None) => return,
            Ok(Some(cmd)) if !command_runs(&cmd, exe) => {
                let other = command_exe(&cmd).unwrap_or(&cmd).to_string();
                out.push(UninstallStep::done(tr!(
                    format!("开机启动项指向 {other}，未作更改"),
                    format!("The launch-at-login entry points to {other} and was left unchanged")
                )));
                return;
            }
            Ok(Some(_)) => disable_autostart(hive).map(|()| {
                // 「启动应用」里那个开关跟着 Run 里这一项走，项没了它也不该留着
                if let Ok(Some(key)) = hive.open_rw(APPROVED) {
                    let _ = key.remove_value(PRODUCT_NAME);
                }
            }),
            Err(e) => Err(e),
        };
        out.push(match removed {
            Ok(()) => UninstallStep::done(tr!("已取消开机启动", "Launch at login turned off")),
            Err(e) => UninstallStep::failed(tr!(
                format!("未能取消开机启动（{e}）。请在「设置 › 应用 › 启动」中关闭 ThinkWatch Lite。"),
                format!(
                    "Launch at login could not be turned off ({e}). Turn off ThinkWatch Lite in Settings › Apps › Startup."
                )
            )),
        });
    }

    /// 这一份的通知登记：**图标指着这一份的数据目录才算**。两个绿色版放在不同的文件夹里
    /// 共用一个 AUMID，登记归最后启动的那一个；删掉一个不该把另一个的名字和图标也拿走
    fn release_notifications(hive: &Hive, dir: &Path, aumid: &str, out: &mut Vec<UninstallStep>) {
        let icon = dir.join(NOTIFICATION_ICON);
        let ours = matches!(
            read_string(hive, &aumid_key(aumid), "IconUri"),
            Ok(Some(uri)) if same_path(&uri, &icon.to_string_lossy())
        );
        if ours {
            // 通知中心里这一份留下的几条一并清掉：登记没了，它们就只剩一个原始的 ID
            #[cfg(not(test))]
            let _ = crate::notices::windows::toast::clear(aumid);
            out.push(match absent_is_none(hive.remove_tree(&aumid_key(aumid))) {
                Ok(_) => UninstallStep::done(tr!(
                    "已移除系统通知的登记",
                    "System notification registration removed"
                )),
                Err(e) => UninstallStep::failed(tr!(
                    format!("未能移除系统通知的登记（{e}）"),
                    format!("The system notification registration could not be removed ({e})")
                )),
            });
        }
        match std::fs::remove_file(&icon) {
            Ok(()) => {}
            // 本来就没有：从没写出来过（数据目录不在，或者那个位置不是目录）
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                ) => {}
            Err(e) => out.push(UninstallStep::failed(tr!(
                format!("未能删除通知图标：{}（{e}）", icon.display()),
                format!(
                    "The notification icon could not be deleted: {} ({e})",
                    icon.display()
                )
            ))),
        }
    }

    /// 对着 `HKCU\Software` 下面一个临时子键跑，跑完删掉；不碰这台机器真的那几项
    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::autostart::AUTOSTART_FLAG;

        struct Scratch(Hive, String);

        impl Scratch {
            fn new(name: &str) -> Self {
                let base = format!(r"Software\ThinkWatchLiteTest\{}-{name}", std::process::id());
                Self(Hive::under(base.clone()), base)
            }
        }

        impl Drop for Scratch {
            fn drop(&mut self) {
                let _ = CURRENT_USER.remove_tree(&self.1);
            }
        }

        const EXE: &str = r"C:\Program Files\ThinkWatch Lite\thinkwatch-lite.exe";
        const OTHER: &str = r"D:\Tools\ThinkWatch Lite\thinkwatch-lite.exe";

        fn command(hive: &Hive) -> Option<String> {
            read_string(hive, &format!(r"{}\shell\open\command", link_key()), "").unwrap()
        }

        fn run_entry(hive: &Hive) -> Option<String> {
            read_string(hive, RUN, PRODUCT_NAME).unwrap()
        }

        #[test]
        fn claiming_points_the_link_at_this_exe_every_time() {
            let s = Scratch::new("link");
            let dir = tempfile::tempdir().unwrap();
            assert!(claim(&s.0, OTHER, dir.path(), "a.test"));
            assert_eq!(command(&s.0).unwrap(), format!("\"{OTHER}\" \"%1\""));
            assert!(claim(&s.0, EXE, dir.path(), "a.test"));
            assert_eq!(command(&s.0).unwrap(), format!("\"{EXE}\" \"%1\""));
            let key = s.0.open(&link_key()).unwrap().unwrap();
            assert_eq!(key.get_string("URL Protocol").unwrap(), "");
            assert_eq!(
                key.get_string("").unwrap(),
                "URL:app.thinkwatch.lite protocol"
            );
            assert_eq!(
                s.0.open(&format!(r"{}\DefaultIcon", link_key()))
                    .unwrap()
                    .unwrap()
                    .get_string("")
                    .unwrap(),
                format!("\"{EXE}\",0")
            );
        }

        /// 开着就改成指向自己；**没开着不替用户打开**
        #[test]
        fn claiming_moves_autostart_only_when_it_exists() {
            let s = Scratch::new("follow");
            let dir = tempfile::tempdir().unwrap();
            claim(&s.0, EXE, dir.path(), "a.test");
            assert_eq!(run_entry(&s.0), None);

            // 老版本的插件写的：不带引号
            s.0.create(RUN)
                .unwrap()
                .set_string(PRODUCT_NAME, format!("{OTHER} {AUTOSTART_FLAG}"))
                .unwrap();
            claim(&s.0, EXE, dir.path(), "a.test");
            assert_eq!(
                run_entry(&s.0).unwrap(),
                format!("\"{EXE}\" {AUTOSTART_FLAG}")
            );
        }

        #[test]
        fn the_toggle_is_shared_and_respects_windows_settings() {
            let s = Scratch::new("toggle");
            assert!(!autostart_on(&s.0));

            // 另一份打开的也算开着
            s.0.create(RUN)
                .unwrap()
                .set_string(PRODUCT_NAME, autostart_command(OTHER))
                .unwrap();
            assert!(autostart_on(&s.0));

            // 在「启动应用」里关掉了
            s.0.create(APPROVED)
                .unwrap()
                .set_bytes(
                    PRODUCT_NAME,
                    Type::Bytes,
                    &[3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                )
                .unwrap();
            assert!(!autostart_on(&s.0));

            // 在这里打开：写指向自己的，连「启动应用」那边一起打开
            assert_eq!(set_autostart(&s.0, EXE, true), Ok(true));
            assert_eq!(run_entry(&s.0).unwrap(), autostart_command(EXE));
            assert_eq!(approved(&s.0), Some(true));

            assert_eq!(set_autostart(&s.0, EXE, false), Ok(false));
            assert_eq!(run_entry(&s.0), None);
            // 已经关着再关一次不算错
            assert_eq!(set_autostart(&s.0, EXE, false), Ok(false));
        }

        #[test]
        fn notifications_are_registered_with_a_name_and_an_image_file() {
            let s = Scratch::new("aumid");
            let dir = tempfile::tempdir().unwrap();
            assert!(claim(&s.0, EXE, dir.path(), "a.test.portable"));
            let key = s.0.open(&aumid_key("a.test.portable")).unwrap().unwrap();
            let name = key.get_value("DisplayName").unwrap();
            assert_eq!(name.ty(), Type::ExpandString);
            assert_eq!(key.get_string("DisplayName").unwrap(), "ThinkWatch Lite");
            let icon = key.get_string("IconUri").unwrap();
            assert!(same_path(
                &icon,
                &dir.path().join(NOTIFICATION_ICON).to_string_lossy()
            ));
            let png = std::fs::read(&icon).unwrap();
            assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        }

        /// 图标写不出来（这里「数据目录」其实是一个文件）：登记照样指向这一份该有的图标
        /// 路径，清理时也照样认得出是自己的
        #[test]
        fn a_missing_icon_still_leaves_a_registration_this_copy_owns() {
            let s = Scratch::new("noicon");
            let dir = tempfile::tempdir().unwrap();
            let not_a_dir = dir.path().join("data");
            std::fs::write(&not_a_dir, b"").unwrap();
            assert!(claim(&s.0, EXE, &not_a_dir, "a.test"));
            let key = s.0.open(&aumid_key("a.test")).unwrap().unwrap();
            assert!(same_path(
                &key.get_string("IconUri").unwrap(),
                &not_a_dir.join(NOTIFICATION_ICON).to_string_lossy()
            ));
            let steps = crate::i18n::with_lang(crate::i18n::Lang::Zh, || {
                release_all(&s.0, EXE, &not_a_dir, "a.test")
            });
            assert!(steps.iter().all(|s| s.ok), "{:?}", texts(&steps));
            assert!(texts(&steps).contains(&"已移除系统通知的登记".to_string()));
            assert!(s.0.open(&aumid_key("a.test")).unwrap().is_none());
        }

        /// 只删指向自己的；指向别处的留着，并且说一声开机启动还在
        #[test]
        fn releasing_removes_only_what_points_here() {
            let s = Scratch::new("release");
            let here = tempfile::tempdir().unwrap();
            let there = tempfile::tempdir().unwrap();

            // 另一份最后启动过：链接、自启、登记都是它的
            claim(&s.0, OTHER, there.path(), "a.test");
            set_autostart(&s.0, OTHER, true).unwrap();
            // 这一份的图标还在自己的数据目录里
            write_icon(&here.path().join(NOTIFICATION_ICON)).unwrap();

            let steps = crate::i18n::with_lang(crate::i18n::Lang::Zh, || {
                release_all(&s.0, EXE, here.path(), "a.test")
            });
            assert!(steps.iter().all(|s| s.ok), "{:?}", texts(&steps));
            assert_eq!(texts(&steps), [format!("开机启动项指向 {OTHER}，未作更改")]);
            assert!(command(&s.0).is_some());
            assert!(run_entry(&s.0).is_some());
            assert!(s.0.open(&aumid_key("a.test")).unwrap().is_some());
            assert!(!here.path().join(NOTIFICATION_ICON).exists());
            assert!(there.path().join(NOTIFICATION_ICON).exists());

            // 现在这一份启动过：三样都归它，清理时三样都删
            claim(&s.0, EXE, here.path(), "a.test");
            let steps = crate::i18n::with_lang(crate::i18n::Lang::Zh, || {
                release_all(&s.0, EXE, here.path(), "a.test")
            });
            assert_eq!(
                texts(&steps),
                [
                    "已移除 thinkwatch:// 链接",
                    "已取消开机启动",
                    "已移除系统通知的登记"
                ]
            );
            assert!(steps.iter().all(|s| s.ok));
            assert!(s.0.open(&link_key()).unwrap().is_none());
            assert_eq!(run_entry(&s.0), None);
            assert!(s.0.open(&aumid_key("a.test")).unwrap().is_none());
            assert!(!here.path().join(NOTIFICATION_ICON).exists());

            // 什么都没有了：再清一次什么都不说
            assert!(release_all(&s.0, EXE, here.path(), "a.test").is_empty());
        }

        fn texts(steps: &[UninstallStep]) -> Vec<String> {
            steps.iter().map(|s| s.text.clone()).collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 抄出来的两个常量和配置文件里的是同一个：单实例的锁名、通知的 AUMID、自启的值名
    /// 都靠它们和 Tauri 那一侧对上
    #[test]
    fn the_copied_constants_match_tauri_conf() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], IDENTIFIER);
        assert_eq!(conf["productName"], PRODUCT_NAME);
        assert_eq!(
            conf["plugins"]["deep-link"]["desktop"]["schemes"][0],
            SCHEME
        );
    }

    #[test]
    fn the_program_of_a_command_line() {
        // 带引号的：链接和这一版写的自启项
        assert_eq!(
            command_exe(r#""C:\Program Files\ThinkWatch Lite\thinkwatch-lite.exe" "%1""#),
            Some(r"C:\Program Files\ThinkWatch Lite\thinkwatch-lite.exe")
        );
        // 老版本的插件写的：不带引号，路径里有空格
        assert_eq!(
            command_exe(r"C:\Program Files\ThinkWatch Lite\thinkwatch-lite.exe --autostart"),
            Some(r"C:\Program Files\ThinkWatch Lite\thinkwatch-lite.exe")
        );
        assert_eq!(
            command_exe(r"C:\Tools\THINKWATCH-LITE.EXE"),
            Some(r"C:\Tools\THINKWATCH-LITE.EXE")
        );
        // 文件夹名里带 .exe 的不算到那里为止
        assert_eq!(
            command_exe(r"C:\a.exe.d\thinkwatch-lite.exe --autostart"),
            Some(r"C:\a.exe.d\thinkwatch-lite.exe")
        );
        // 没有 .exe：取到第一个空白
        assert_eq!(command_exe("prog --x"), Some("prog"));
        // 引号没合上：引号后面全算
        assert_eq!(command_exe(r#""C:\x y\a.exe"#), Some(r"C:\x y\a.exe"));
        assert_eq!(command_exe(""), None);
        assert_eq!(command_exe(r#""" x"#), None);
    }

    #[test]
    fn paths_compare_like_windows_does() {
        let exe = r"C:\Program Files\ThinkWatch Lite\thinkwatch-lite.exe";
        assert!(same_path(exe, exe));
        assert!(same_path(
            exe,
            r"c:\program files\thinkwatch lite\THINKWATCH-LITE.EXE"
        ));
        assert!(same_path(
            exe,
            r"\\?\C:\Program Files\ThinkWatch Lite\thinkwatch-lite.exe"
        ));
        assert!(same_path(
            exe,
            "C:/Program Files/ThinkWatch Lite/thinkwatch-lite.exe"
        ));
        assert!(!same_path(exe, r"D:\ThinkWatch Lite\thinkwatch-lite.exe"));
        // 中文路径也不分大小写地比，且不会因为非 ASCII 字符出错
        assert!(same_path(
            r"D:\工具\ThinkWatch\A.exe",
            r"d:\工具\thinkwatch\a.EXE"
        ));
        assert!(same_path(r"\\?\UNC\nas\share\a.exe", r"\\nas\share\a.exe"));
    }

    #[test]
    fn commands_point_at_the_exe_and_survive_spaces() {
        let exe = r"C:\Program Files\ThinkWatch Lite\thinkwatch-lite.exe";
        assert_eq!(
            open_command(exe),
            r#""C:\Program Files\ThinkWatch Lite\thinkwatch-lite.exe" "%1""#
        );
        assert_eq!(
            autostart_command(exe),
            r#""C:\Program Files\ThinkWatch Lite\thinkwatch-lite.exe" --autostart"#
        );
        assert!(command_runs(&open_command(exe), exe));
        assert!(command_runs(&autostart_command(exe), &exe.to_uppercase()));
        assert!(!command_runs(
            &autostart_command(exe),
            r"D:\x\thinkwatch-lite.exe"
        ));
    }

    /// 不是 Windows（或者开发构建）时清理什么都不做、什么都不说
    #[cfg(not(windows))]
    #[test]
    fn releasing_elsewhere_is_a_no_op() {
        assert!(release_all(Path::new("/x/thinkwatch-lite")).is_empty());
        assert!(!notifications_registered());
    }
}
