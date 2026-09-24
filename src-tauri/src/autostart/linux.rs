//! Launch at login on Linux: an XDG autostart entry written by the app itself.
//!
//! **The autostart plugin is not used here.** Its Linux backend (auto-launch 0.5,
//! `src/linux.rs`) writes `Exec={path} {args}` with no quoting or escaping, so an
//! AppImage kept in a directory whose path contains a space, `%`, `"`, `\`, `$` or
//! a backtick silently never starts. It also ignores `$XDG_CONFIG_HOME`, names the
//! file after the product name (`ThinkWatch Lite.desktop`), and its `is_enabled()`
//! only checks that the file exists, so it reports "on" after the user turned the
//! entry off in the desktop's startup-applications settings.
//!
//! What this module does instead:
//!
//! - writes `$XDG_CONFIG_HOME/autostart/<identifier>.desktop` (falling back to
//!   `~/.config`), with `Exec` encoded per the Desktop Entry Specification
//!   (section "The Exec key", plus the string escapes of "Possible value types");
//! - points it at `$APPIMAGE` for an AppImage (the running binary lives under a
//!   per-launch `/tmp/.mount_*` directory) and at the installed binary otherwise;
//! - treats `Hidden=true` and `X-GNOME-Autostart-enabled=false` as off, which is
//!   how GNOME and KDE record "disabled" without deleting the file;
//! - rewrites the entry on every launch when it points somewhere else (the
//!   AppImage was moved or replaced by a differently named download).
//!
//! The pure encoding and parsing functions compile on every platform so their
//! tests run wherever the test suite runs, not only on Linux.

use std::io;
use std::path::{Path, PathBuf};

/// The entry as it is written, and how to find it again.
pub struct Autostart {
    file: PathBuf,
    /// What `Exec` should start. `Err` carries the reason it is not known.
    program: Result<String, String>,
    name: String,
    icon: String,
}

impl Autostart {
    pub fn for_app(app: &tauri::AppHandle) -> Self {
        let file = autostart_dir(
            std::env::var_os("XDG_CONFIG_HOME").as_deref(),
            std::env::var_os("HOME").as_deref(),
        )
        .unwrap_or_default()
        .join(format!("{}.desktop", app.config().identifier));
        // Every launch of the AppImage installs the icon into the user's hicolor
        // theme under the identifier (`desktop_entry`), so the name resolves
        // there; a development build gets the desktop's generic icon.
        Self {
            file,
            program: program(std::env::current_exe().ok()),
            name: app.package_info().name.clone(),
            icon: app.config().identifier.clone(),
        }
    }

    /// Writes (or rewrites) the entry, switched on.
    ///
    /// **Rewrites the same file**, never adds a second one: an entry the user
    /// switched off in the desktop settings carries `Hidden=true` or
    /// `X-GNOME-Autostart-enabled=false`, and turning it back on here replaces
    /// those lines rather than leaving two entries for the same app.
    pub fn enable(&self) -> io::Result<()> {
        let program = self.program.clone().map_err(io::Error::other)?;
        // **A `%` in the program path cannot work under GNOME**, however it is
        // encoded. The spec-correct `%%` is fine for the launch itself, but GLib
        // decides whether an entry is valid by looking up the first argument of
        // the *unexpanded* `Exec` (with `%%` still in it), finds no such file and
        // drops the entry (verified with `g_desktop_app_info_new_from_filename`
        // against GLib 2.72). Refusing here beats an entry that silently never
        // starts.
        if program.contains('%') {
            return Err(io::Error::other(tr!(
                format!("路径中含有 % 时无法开机启动：{program}。请将应用移到不含 % 的目录。"),
                format!(
                    "Launch at login does not work when the path contains %: {program}. Move the app to a directory without % in its path."
                )
            )));
        }
        if self.file.as_os_str().is_empty() || !self.file.is_absolute() {
            return Err(io::Error::other(tr!(
                "未能确定自启目录（HOME 未设置）",
                "The autostart directory could not be determined (HOME is not set)"
            )));
        }
        let dir = self.file.parent().expect("the entry is inside a directory");
        std::fs::create_dir_all(dir).map_err(|e| {
            io::Error::new(
                e.kind(),
                tr!(
                    format!("无法创建目录 {}：{e}", dir.display()),
                    format!("The directory {} could not be created: {e}", dir.display())
                ),
            )
        })?;
        let contents = entry(&self.name, &program, &[super::AUTOSTART_FLAG], &self.icon);
        // Write-then-rename: a half-written entry is worse than none, because
        // the session manager would try to run whatever the truncated `Exec` says.
        let tmp = self.file.with_extension("desktop.tmp");
        std::fs::write(&tmp, contents)?;
        std::fs::rename(&tmp, &self.file).inspect_err(|_| {
            let _ = std::fs::remove_file(&tmp);
        })
    }

    /// Where the entry lives, for telling the user which file to delete when
    /// [`Self::disable`] could not.
    pub fn file(&self) -> &Path {
        &self.file
    }

    pub fn disable(&self) -> io::Result<()> {
        match std::fs::remove_file(&self.file) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    }

    /// On = the file exists **and** the desktop has not switched it off.
    pub fn is_enabled(&self) -> io::Result<bool> {
        match std::fs::read_to_string(&self.file) {
            Ok(c) => Ok(!disabled_by_desktop(&c)),
            // Deleted by the user (or never written): off, which is correct.
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// The entry is on but starts something other than this app: rewrite it.
    ///
    /// Same failure mode as the macOS plist path check: nothing happens at the
    /// next login while the settings page says launch at login is on. On Linux
    /// the usual trigger is an AppImage that was moved, or replaced by a newly
    /// downloaded one with the version in its file name.
    pub fn repair(&self) {
        let Ok(program) = &self.program else { return };
        let Ok(contents) = std::fs::read_to_string(&self.file) else {
            return;
        };
        if disabled_by_desktop(&contents) {
            return;
        }
        let current = value(&contents, "Exec").and_then(exec_program);
        if current.as_deref() == Some(program.as_str()) {
            return;
        }
        tracing::warn!(
            entry = %self.file.display(),
            was = ?current,
            now = %program,
            "autostart entry points elsewhere (moved AppImage?), rewriting it"
        );
        if let Err(e) = self.enable() {
            tracing::error!("rewriting the autostart entry failed: {e}");
        }
    }
}

/// What the entry should start.
///
/// **Asks the bundle type, not the environment alone.** `$APPIMAGE` is inherited
/// by everything an AppImage starts, so a development build launched from, say,
/// an AppImage terminal emulator would see someone else's `$APPIMAGE`. The bundle
/// type is patched into the binary by the bundler, so it cannot be inherited.
fn program(exe: Option<PathBuf>) -> Result<String, String> {
    use tauri::utils::config::BundleType;
    let path = if tauri::utils::platform::bundle_type() == Some(BundleType::AppImage) {
        std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .ok_or_else(|| {
                tr!(
                    "未能确定 AppImage 文件的位置（APPIMAGE 未设置）",
                    "The location of the AppImage file could not be determined (APPIMAGE is not set)"
                )
                .to_string()
            })?
    } else {
        exe.ok_or_else(|| {
            tr!(
                "未能确定应用程序的位置",
                "The location of the application could not be determined"
            )
            .to_string()
        })?
    };
    path.into_os_string().into_string().map_err(|p| {
        tr!(
            format!("应用程序路径不是有效的 UTF-8：{}", p.to_string_lossy()),
            format!(
                "The application path is not valid UTF-8: {}",
                p.to_string_lossy()
            )
        )
    })
}

/// `$XDG_CONFIG_HOME/autostart`, or `$HOME/.config/autostart`.
///
/// Per the XDG Base Directory Specification a relative `$XDG_CONFIG_HOME` is
/// invalid and must be ignored, the same as an empty one.
fn autostart_dir(
    xdg_config_home: Option<&std::ffi::OsStr>,
    home: Option<&std::ffi::OsStr>,
) -> Option<PathBuf> {
    let config = xdg_config_home
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| {
            home.map(PathBuf::from)
                .filter(|p| p.is_absolute())
                .map(|h| h.join(".config"))
        })?;
    Some(config.join("autostart"))
}

/// The whole file.
///
/// - `NoDisplay=false`: GNOME's startup-applications list hides `NoDisplay=true`
///   entries, which would leave the user no way to see or switch it off there.
/// - `X-GNOME-Autostart-enabled=true` is written explicitly so re-enabling an
///   entry GNOME switched off reads as on to every tool, not only to us.
/// - No `Version`: it is optional, and desktop-file-utils 0.26 (Ubuntu 22.04)
///   rejects `Version=1.5` as unknown. Same as the menu entry (`desktop_entry`).
fn entry(name: &str, program: &str, args: &[&str], icon: &str) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name={}\n\
         Exec={}\n\
         Icon={}\n\
         Terminal=false\n\
         NoDisplay=false\n\
         X-GNOME-Autostart-enabled=true\n",
        escape_string(name),
        exec_value(program, args),
        escape_string(icon),
    )
}

/// The `Exec` value, both encoding layers applied.
///
/// Desktop Entry Specification, "The Exec key": arguments containing a reserved
/// character must be quoted; inside double quotes `"`, `` ` ``, `$` and `\` are
/// escaped with a backslash; a literal `%` is written `%%` (quoted or not). Then
/// "the general escape rule for values of type string ... is applied before the
/// quoting rule", which is why a literal backslash in a quoted argument ends up as
/// four backslashes in the file. GLib rejects a string value containing an
/// unknown escape such as `\"`, so skipping the second layer does not merely
/// look wrong: the whole `Exec` key becomes unreadable.
///
/// The program path is always quoted: it is user-controlled (wherever the
/// AppImage was saved), and an always-quoted path is valid per the spec.
pub(crate) fn exec_value(program: &str, args: &[&str]) -> String {
    let mut line = quote_arg(program);
    for a in args {
        line.push(' ');
        if a.chars().any(is_reserved) {
            line.push_str(&quote_arg(a));
        } else {
            line.push_str(&a.replace('%', "%%"));
        }
    }
    escape_string(&line)
}

/// Reserved characters of "The Exec key".
fn is_reserved(c: char) -> bool {
    matches!(
        c,
        ' ' | '\t'
            | '\n'
            | '"'
            | '\''
            | '\\'
            | '>'
            | '<'
            | '~'
            | '|'
            | '&'
            | ';'
            | '$'
            | '*'
            | '?'
            | '#'
            | '('
            | ')'
            | '`'
    )
}

fn quote_arg(a: &str) -> String {
    let mut out = String::with_capacity(a.len() + 2);
    out.push('"');
    for c in a.chars() {
        match c {
            '"' | '`' | '$' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            '%' => out.push_str("%%"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// String escapes ("Possible value types"): `\s`, `\n`, `\t`, `\r`, `\\`.
///
/// `\s` is only needed for a leading space (a key file reader trims whitespace
/// after the `=`); elsewhere a space is written as is.
pub(crate) fn escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for (i, c) in s.chars().enumerate() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            ' ' if i == 0 => out.push_str("\\s"),
            _ => out.push(c),
        }
    }
    out
}

fn unescape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('s') => out.push(' '),
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some('\\') => out.push('\\'),
            // Not a valid string escape: keep it as written. This value is only
            // compared against ours, so leniency cannot make a wrong match.
            Some(o) => {
                out.push('\\');
                out.push(o);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// Splits an unescaped `Exec` value into arguments. `None` if a quote is left open.
///
/// Field codes other than `%%` are kept verbatim; only the first argument is
/// ever looked at, and a program path never is one.
fn split_exec(s: &str) -> Option<Vec<String>> {
    let mut args = Vec::new();
    let mut cur = String::new();
    let mut in_arg = false;
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        match c {
            ' ' | '\t' | '\n' => {
                if in_arg {
                    args.push(std::mem::take(&mut cur));
                    in_arg = false;
                }
            }
            '"' => {
                in_arg = true;
                loop {
                    match it.next()? {
                        '"' => break,
                        '\\' => match it.peek() {
                            Some('"' | '`' | '$' | '\\') => cur.push(it.next()?),
                            _ => cur.push('\\'),
                        },
                        '%' if it.peek() == Some(&'%') => {
                            it.next();
                            cur.push('%');
                        }
                        o => cur.push(o),
                    }
                }
            }
            '%' if it.peek() == Some(&'%') => {
                it.next();
                in_arg = true;
                cur.push('%');
            }
            o => {
                in_arg = true;
                cur.push(o);
            }
        }
    }
    if in_arg {
        args.push(cur);
    }
    Some(args)
}

/// The program an `Exec` value (as read from the file) starts.
fn exec_program(raw: &str) -> Option<String> {
    split_exec(&unescape_string(raw))?.into_iter().next()
}

/// A key's raw value in the `[Desktop Entry]` group.
///
/// Key file rules: `#` lines are comments, whitespace around `=` is ignored,
/// keys are case-sensitive, and only the `[Desktop Entry]` group counts (a
/// `[Desktop Action …]` group may repeat the same keys).
fn value<'a>(contents: &'a str, key: &str) -> Option<&'a str> {
    let mut in_entry = false;
    for line in contents.lines() {
        let line = line.trim_start();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') {
            in_entry = line.trim_end() == "[Desktop Entry]";
            continue;
        }
        if !in_entry {
            continue;
        }
        if let Some((k, v)) = line.split_once('=')
            && k.trim_end() == key
        {
            return Some(v.trim_start().trim_end_matches(['\r', ' ', '\t']));
        }
    }
    None
}

/// A boolean as GLib's key file reader accepts it (`true`/`1`, `false`/`0`).
fn boolean(v: &str) -> Option<bool> {
    match v {
        "true" | "1" => Some(true),
        "false" | "0" => Some(false),
        _ => None,
    }
}

/// The desktop switched the entry off without deleting it.
///
/// Same problem as `disabled_by_windows`: our file is still there, so "the file
/// exists" says on while the session manager will not start it. `Hidden=true` is
/// the spec's "treat as deleted" (KDE writes it); `X-GNOME-Autostart-enabled=false`
/// is what GNOME's startup-applications tool writes.
pub(super) fn disabled_by_desktop(contents: &str) -> bool {
    value(contents, "Hidden").and_then(boolean) == Some(true)
        || value(contents, "X-GNOME-Autostart-enabled").and_then(boolean) == Some(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Paths that break an unescaped `Exec`: every character with a rule of its own.
    ///
    /// Entries written for each of these were also launched through GLib 2.72's
    /// `GDesktopAppInfo` (what gnome-session uses) on Ubuntu 22.04: every one
    /// without a `%` started the program with exactly `[path, "--autostart"]`;
    /// the `%` ones are refused by `enable`, see there.
    const NASTY: &[&str] = &[
        "/home/a/Applications/ThinkWatch-Lite.AppImage",
        "/home/a/My Apps/ThinkWatch Lite.AppImage",
        "/home/a/100%/x.AppImage",
        "/home/a/%u/x.AppImage",
        "/home/a/say \"hi\"/x.AppImage",
        "/home/a/back\\slash/x.AppImage",
        "/home/a/$HOME/x.AppImage",
        "/home/a/`id`/x.AppImage",
        "/home/a/it's/x.AppImage",
        "/home/a/tab\there/x.AppImage",
        "/home/a/new\nline/x.AppImage",
        "/home/a/中文 目录/x.AppImage",
        "/home/a/\\\"$`%%\\/x.AppImage",
    ];

    #[test]
    fn plain_paths_are_still_quoted_and_plain_args_are_not() {
        assert_eq!(
            exec_value("/usr/bin/thinkwatch-lite", &["--autostart"]),
            "\"/usr/bin/thinkwatch-lite\" --autostart"
        );
    }

    #[test]
    fn each_special_character_gets_the_spec_encoding() {
        // space: quoting alone
        assert_eq!(exec_value("/a b", &[]), "\"/a b\"");
        // %: doubled, inside quotes too
        assert_eq!(exec_value("/100%", &[]), "\"/100%%\"");
        // " ` $: one backslash from the quoting rule, which the string rule
        // then doubles
        assert_eq!(exec_value("/\"", &[]), r#""/\\"""#);
        assert_eq!(exec_value("/`", &[]), r#""/\\`""#);
        assert_eq!(exec_value("/$", &[]), r#""/\\$""#);
        // \: the spec's "four successive backslash characters"
        assert_eq!(exec_value("/\\", &[]), r#""/\\\\""#);
        // ' needs quoting but no escape inside double quotes
        assert_eq!(exec_value("/'", &[]), "\"/'\"");
        // control characters use the string escapes
        assert_eq!(exec_value("/\t\n", &[]), r#""/\t\n""#);
    }

    #[test]
    fn args_with_reserved_characters_are_quoted_too() {
        assert_eq!(exec_value("/p", &["a b"]), "\"/p\" \"a b\"");
        assert_eq!(exec_value("/p", &["50%"]), "\"/p\" 50%%");
    }

    #[test]
    fn every_nasty_path_survives_a_round_trip() {
        for p in NASTY {
            let raw = exec_value(p, &["--autostart"]);
            assert!(
                !raw.contains('\n'),
                "a raw newline would end the key: {raw}"
            );
            assert_eq!(
                split_exec(&unescape_string(&raw)),
                Some(vec![p.to_string(), "--autostart".to_string()]),
                "{p} encoded as {raw}"
            );
            // and through the whole file
            let file = entry("ThinkWatch Lite", p, &["--autostart"], "thinkwatch-lite");
            assert_eq!(
                value(&file, "Exec").and_then(exec_program).as_deref(),
                Some(*p)
            );
        }
    }

    #[test]
    fn the_unescaped_exec_matches_what_the_spec_example_describes() {
        // After the string layer, a backslash in a quoted argument is `\\`:
        // exactly one quoting-level escape.
        assert_eq!(unescape_string(r#""/a\\\\b""#), r#""/a\\b""#);
        assert_eq!(split_exec(r#""/a\\b""#), Some(vec!["/a\\b".to_string()]));
    }

    #[test]
    fn exec_lines_written_by_other_tools_parse() {
        // unquoted, with a field code
        assert_eq!(
            exec_program("/usr/bin/thinkwatch-lite %u").as_deref(),
            Some("/usr/bin/thinkwatch-lite")
        );
        // the plugin's unescaped form, and several spaces
        assert_eq!(
            split_exec("/opt/tw   --autostart"),
            Some(vec!["/opt/tw".to_string(), "--autostart".to_string()])
        );
        // an open quote is not a program
        assert_eq!(exec_program("\"/a b"), None);
        assert_eq!(exec_program(""), None);
        // leading space escape
        assert_eq!(unescape_string("\\sx"), " x");
        assert_eq!(escape_string(" x"), "\\sx");
    }

    #[test]
    fn a_fresh_entry_is_on_and_has_the_keys_the_desktops_need() {
        let f = entry(
            "ThinkWatch Lite",
            "/usr/bin/thinkwatch-lite",
            &["--autostart"],
            "thinkwatch-lite",
        );
        assert!(!disabled_by_desktop(&f));
        assert_eq!(value(&f, "Type"), Some("Application"));
        assert_eq!(value(&f, "Terminal"), Some("false"));
        assert_eq!(value(&f, "NoDisplay"), Some("false"));
        assert_eq!(value(&f, "X-GNOME-Autostart-enabled"), Some("true"));
        assert_eq!(value(&f, "Icon"), Some("thinkwatch-lite"));
        assert_eq!(value(&f, "Name"), Some("ThinkWatch Lite"));
    }

    #[test]
    fn gnome_and_kde_switch_it_off_without_deleting_it() {
        let base = entry("T", "/p", &[], "i");
        // KDE / the spec: Hidden=true
        let kde = format!("{base}Hidden=true\n");
        assert!(disabled_by_desktop(&kde));
        // GNOME: the enabled key flipped
        let gnome = base.replace(
            "X-GNOME-Autostart-enabled=true",
            "X-GNOME-Autostart-enabled=false",
        );
        assert!(disabled_by_desktop(&gnome));
        // GLib's other spellings, and whitespace around `=`
        assert!(disabled_by_desktop("[Desktop Entry]\nHidden = 1\n"));
        assert!(disabled_by_desktop(
            "[Desktop Entry]\r\nX-GNOME-Autostart-enabled=0\r\n"
        ));
        // not switched off
        assert!(!disabled_by_desktop("[Desktop Entry]\nHidden=false\n"));
        assert!(!disabled_by_desktop("[Desktop Entry]\nHidden=True\n"));
        assert!(!disabled_by_desktop(""));
    }

    #[test]
    fn only_the_desktop_entry_group_counts() {
        let f = "# Hidden=true\n[Desktop Action x]\nHidden=true\nExec=/other\n\
                 [Desktop Entry]\nExec=\"/mine\"\n";
        assert!(!disabled_by_desktop(f));
        assert_eq!(value(f, "Exec"), Some("\"/mine\""));
        // a key that merely starts the same way is a different key
        assert_eq!(value("[Desktop Entry]\nHiddenX=true\n", "Hidden"), None);
        // localized keys are different keys
        assert_eq!(value("[Desktop Entry]\nName[zh_CN]=x\n", "Name"), None);
    }

    /// Unix paths only: `/x/cfg` is not absolute on Windows, where this never runs.
    #[cfg(unix)]
    #[test]
    fn the_autostart_directory_follows_xdg() {
        use std::ffi::OsStr;
        let d = autostart_dir(Some(OsStr::new("/x/cfg")), Some(OsStr::new("/home/a")));
        assert_eq!(d, Some(PathBuf::from("/x/cfg/autostart")));
        // unset, empty or relative XDG_CONFIG_HOME: ~/.config
        for x in [None, Some(OsStr::new("")), Some(OsStr::new("cfg"))] {
            assert_eq!(
                autostart_dir(x, Some(OsStr::new("/home/a"))),
                Some(PathBuf::from("/home/a/.config/autostart"))
            );
        }
        assert_eq!(autostart_dir(None, None), None);
    }

    /// Writes, reads back, is switched off by "GNOME", re-enabled in place, and
    /// repaired after a "move" — against a temporary directory, on any unix.
    #[cfg(unix)]
    #[test]
    fn enable_disable_and_repair_work_on_a_real_file() {
        let dir = tempdir();
        let file = dir.join("autostart/app.thinkwatch.lite.desktop");
        let at = |program: &str| Autostart {
            file: file.clone(),
            program: Ok(program.to_string()),
            name: "ThinkWatch Lite".to_string(),
            icon: "thinkwatch-lite".to_string(),
        };
        // a `%` in the path: refused, nothing written (GLib would drop the entry)
        assert!(at("/home/a/100%/x.AppImage").enable().is_err());
        assert!(!file.exists());

        let a = at("/home/a/My Apps/ThinkWatch Lite.AppImage");
        assert!(!a.is_enabled().unwrap(), "no file: off");
        a.disable().unwrap(); // removing nothing is fine
        a.enable().unwrap();
        assert!(a.is_enabled().unwrap());
        let written = std::fs::read_to_string(&file).unwrap();
        assert!(written.contains("Exec=\"/home/a/My Apps/ThinkWatch Lite.AppImage\" --autostart"));

        // switched off in the desktop settings: off, and repair leaves it alone
        std::fs::write(
            &file,
            written.replace(
                "X-GNOME-Autostart-enabled=true",
                "X-GNOME-Autostart-enabled=false",
            ),
        )
        .unwrap();
        assert!(!a.is_enabled().unwrap());
        at("/elsewhere").repair();
        assert!(std::fs::read_to_string(&file).unwrap().contains("My Apps"));
        // switched back on here: the same file, rewritten
        a.enable().unwrap();
        assert!(a.is_enabled().unwrap());
        assert_eq!(
            std::fs::read_dir(file.parent().unwrap()).unwrap().count(),
            1
        );

        // the AppImage moved: the next launch points the entry at the new place
        let moved = at("/home/a/Downloads/ThinkWatch-Lite-2026.9.20.AppImage");
        moved.repair();
        let c = std::fs::read_to_string(&file).unwrap();
        assert_eq!(
            value(&c, "Exec").and_then(exec_program).as_deref(),
            Some("/home/a/Downloads/ThinkWatch-Lite-2026.9.20.AppImage")
        );

        a.disable().unwrap();
        assert!(!file.exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    /// What desktop-file-utils thinks of the entry, for every nasty path. Skipped
    /// where `desktop-file-validate` is not installed (it is not on the CI images).
    #[cfg(unix)]
    #[test]
    fn desktop_file_validate_accepts_the_entry() {
        let dir = tempdir();
        std::fs::create_dir_all(&dir).unwrap();
        for (i, p) in NASTY.iter().filter(|p| !p.contains('%')).enumerate() {
            let file = dir.join(format!("e{i}.desktop"));
            std::fs::write(
                &file,
                entry(
                    "ThinkWatch Lite",
                    p,
                    &[super::super::AUTOSTART_FLAG],
                    "app.thinkwatch.lite",
                ),
            )
            .unwrap();
            let out = match std::process::Command::new("desktop-file-validate")
                .arg(&file)
                .output()
            {
                Ok(out) => out,
                Err(_) => {
                    eprintln!("skipped: desktop-file-validate is not installed");
                    break;
                }
            };
            assert!(
                out.status.success() && out.stdout.is_empty(),
                "{p:?}: {}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    fn tempdir() -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "tw-autostart-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
}
