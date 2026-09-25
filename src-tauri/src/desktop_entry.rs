//! The app's menu entry on Linux, written by the app itself on every launch.
//!
//! Linux ships as an AppImage only, and an AppImage has no install step: nothing
//! puts the app in the desktop's application menu, gives the window an icon in
//! the dock, or claims `thinkwatch://` (the sign-in callbacks). So every launch
//! of an AppImage writes, under `$XDG_DATA_HOME` (falling back to
//! `~/.local/share`):
//!
//! - `applications/<identifier>.desktop`, a visible entry whose `Exec` starts
//!   `$APPIMAGE` with `%u`, and which claims `x-scheme-handler/thinkwatch`;
//! - `icons/hicolor/256x256/apps/<identifier>.png`, referenced from `Icon=` by
//!   absolute path (the AppImage's own icons live under a mount point that
//!   changes every run).
//!
//! The entry is rewritten whenever it differs from what this launch would
//! write, which covers an AppImage that was moved or replaced by a download
//! with another file name. Then `xdg-mime default` makes it the handler for the
//! scheme, every launch, so another app that took the scheme over does not keep
//! it.
//!
//! **Why not the deep-link plugin's `register_all`.** It writes a second,
//! hidden entry (`<binary>-handler.desktop`, `NoDisplay=true`) next to this one,
//! and puts the path into `Exec` as `"{path}" %u` with no escaping, so an
//! AppImage kept under a path with `"`, `` ` ``, `$` or `\` registers a handler
//! that cannot start. One entry does both jobs here.
//!
//! The file name is the app identifier, which is also the `desktop-entry` hint
//! on notifications (`notices::linux`): GNOME attributes a notification to the
//! entry with that basename.

use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::autostart::linux::{escape_string, exec_value};

/// The scheme the sign-in callbacks use (`plugins.deep-link` in `tauri.conf.json`).
const SCHEME_MIME: &str = "x-scheme-handler/thinkwatch";
const ICON: &[u8] = include_bytes!("../icons/256x256.png");
const ICON_SUBDIR: &str = "icons/hicolor/256x256/apps";

/// Where the entry and its icon go.
pub(crate) struct Files {
    pub desktop: PathBuf,
    pub icon: PathBuf,
}

impl Files {
    /// `None` when neither `$XDG_DATA_HOME` nor `$HOME` is usable.
    pub(crate) fn for_app(app: &tauri::AppHandle) -> Option<Self> {
        let data = data_home(
            std::env::var_os("XDG_DATA_HOME").as_deref(),
            std::env::var_os("HOME").as_deref(),
        )?;
        Some(Self::under(&data, &app.config().identifier))
    }

    fn under(data: &Path, id: &str) -> Self {
        Self {
            desktop: data.join("applications").join(format!("{id}.desktop")),
            icon: data.join(ICON_SUBDIR).join(format!("{id}.png")),
        }
    }
}

/// `$XDG_DATA_HOME`, or `$HOME/.local/share`. A relative `$XDG_DATA_HOME` is
/// invalid per the XDG Base Directory Specification and is ignored.
fn data_home(
    xdg_data_home: Option<&std::ffi::OsStr>,
    home: Option<&std::ffi::OsStr>,
) -> Option<PathBuf> {
    xdg_data_home
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| {
            home.map(PathBuf::from)
                .filter(|p| p.is_absolute())
                .map(|h| h.join(".local/share"))
        })
}

/// The running AppImage file. `None` for anything else (a development build,
/// or an AppImage unpacked with `--appimage-extract`).
///
/// The bundle type comes first for the same reason as in `update::linux_kind`:
/// `$APPIMAGE` is inherited by everything an AppImage starts.
pub(crate) fn appimage() -> Option<PathBuf> {
    use tauri::utils::config::BundleType;
    if tauri::utils::platform::bundle_type() != Some(BundleType::AppImage) {
        return None;
    }
    std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
}

/// The whole file.
///
/// - `StartupWMClass` is the main binary's name: GTK takes the X11 `WM_CLASS`
///   and the Wayland `app_id` from the program name (argv[0]) because the app
///   does not set a GTK application id (`enableGTKAppId` is off). The desktop
///   uses it to put the window under this entry in the dock.
/// - `%u` hands a `thinkwatch://` URL to the app; without a field code GLib
///   appends `%f`, which drops URLs that are not local files.
/// - No `Version`: it is optional, every key here is in the 1.0 spec, and
///   desktop-file-utils 0.26 (Ubuntu 22.04) rejects `Version=1.5` as unknown.
fn entry(name: &str, program: &str, icon: &str, wm_class: &str) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name={}\n\
         Exec={} %u\n\
         Icon={}\n\
         Terminal=false\n\
         Categories=Development;\n\
         MimeType={SCHEME_MIME};\n\
         StartupWMClass={}\n",
        escape_string(name),
        exec_value(program, &[]),
        escape_string(icon),
        escape_string(wm_class),
    )
}

/// Writes `contents` unless the file already holds exactly that. `Ok(true)`
/// when it wrote. Write-then-rename, so a reader never sees half a file.
fn write_if_changed(path: &Path, contents: &[u8]) -> io::Result<bool> {
    if std::fs::read(path).ok().as_deref() == Some(contents) {
        return Ok(false);
    }
    std::fs::create_dir_all(path.parent().expect("a file inside a directory"))?;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, contents)?;
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })?;
    Ok(true)
}

/// Runs a helper and reports how it went, for the log only.
fn run(program: &str, args: &[&std::ffi::OsStr]) {
    match Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(out) if out.status.success() => {}
        Ok(out) => tracing::warn!(
            "{program} failed ({}): {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ),
        Err(e) => tracing::warn!("{program} could not be run: {e}"),
    }
}

/// Writes (or refreshes) the entry and the icon, and claims `thinkwatch://`.
///
/// Only for an AppImage; a development build has no stable program path to
/// point an entry at. Runs on a thread of its own: it starts two external
/// commands, which should not hold up startup. Failures are logged and
/// otherwise ignored.
pub(crate) fn integrate(app: &tauri::AppHandle) {
    let Some(program) = appimage() else { return };
    let Some(files) = Files::for_app(app) else {
        tracing::warn!("desktop entry not written: neither XDG_DATA_HOME nor HOME is set");
        return;
    };
    let name = app.package_info().name.clone();
    let wm_class = std::env::current_exe()
        .ok()
        .and_then(|e| e.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "thinkwatch-lite".to_string());
    std::thread::spawn(move || {
        let Some(program) = program.to_str() else {
            tracing::warn!("desktop entry not written: the AppImage path is not valid UTF-8");
            return;
        };
        // GLib validates an entry by looking up the first argument of the
        // *unexpanded* `Exec`, where `%` is still written `%%`, and drops the
        // entry (see `Autostart::enable`)
        if program.contains('%') {
            tracing::warn!("desktop entry not written: the AppImage path contains %: {program}");
            return;
        }
        if let Err(e) = write_if_changed(&files.icon, ICON) {
            tracing::warn!("icon not written to {}: {e}", files.icon.display());
        }
        let Some(icon) = files.icon.to_str() else {
            tracing::warn!("desktop entry not written: the data directory is not valid UTF-8");
            return;
        };
        let contents = entry(&name, program, icon, &wm_class);
        match write_if_changed(&files.desktop, contents.as_bytes()) {
            Ok(true) => {
                tracing::info!("desktop entry written: {}", files.desktop.display());
                // Refreshes the MIME cache the scheme lookup reads. Missing on
                // some systems; the desktop then rescans on its own
                if let Some(dir) = files.desktop.parent() {
                    run("update-desktop-database", &[dir.as_os_str()]);
                }
            }
            Ok(false) => {}
            Err(e) => {
                tracing::warn!(
                    "desktop entry not written to {}: {e}",
                    files.desktop.display()
                );
                return;
            }
        }
        if let Some(file) = files.desktop.file_name() {
            run(
                "xdg-mime",
                &["default".as_ref(), file, std::ffi::OsStr::new(SCHEME_MIME)],
            );
        }
    });
}

/// Removes the entry and the icon (the in-app uninstall), as lines for the
/// uninstall log: nothing when there was nothing to remove (a development
/// build), one line per file that could not be removed.
pub(crate) fn remove(app: &tauri::AppHandle) -> Vec<crate::wire::UninstallStep> {
    Files::for_app(app).map(|f| f.remove()).unwrap_or_default()
}

impl Files {
    fn remove(&self) -> Vec<crate::wire::UninstallStep> {
        use crate::wire::UninstallStep;
        let mut log = Vec::new();
        let mut removed = false;
        for path in [&self.desktop, &self.icon] {
            match std::fs::remove_file(path) {
                Ok(()) => removed = true,
                Err(e) if e.kind() == io::ErrorKind::NotFound => {}
                Err(e) => log.push(UninstallStep::failed(tr!(
                    format!("未能删除 {}（{e}）", path.display()),
                    format!("{} could not be deleted ({e})", path.display())
                ))),
            }
        }
        if removed {
            if let Some(dir) = self.desktop.parent() {
                run("update-desktop-database", &[dir.as_os_str()]);
            }
            if log.is_empty() {
                log.push(UninstallStep::done(tr!(
                    "已移除应用菜单中的条目",
                    "The application menu entry was removed"
                )));
            }
        }
        log
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_home_follows_xdg_and_ignores_a_relative_value() {
        let os = |s: &str| std::ffi::OsString::from(s);
        assert_eq!(
            data_home(Some(&os("/x/data")), Some(&os("/home/a"))),
            Some(PathBuf::from("/x/data"))
        );
        assert_eq!(
            data_home(Some(&os("rel")), Some(&os("/home/a"))),
            Some(PathBuf::from("/home/a/.local/share"))
        );
        assert_eq!(
            data_home(Some(&os("")), Some(&os("/home/a"))),
            Some(PathBuf::from("/home/a/.local/share"))
        );
        assert_eq!(data_home(None, None), None);
        assert_eq!(data_home(None, Some(&os("rel"))), None);
    }

    #[test]
    fn files_are_named_after_the_identifier() {
        let f = Files::under(Path::new("/d"), "app.thinkwatch.lite");
        assert_eq!(
            f.desktop,
            PathBuf::from("/d/applications/app.thinkwatch.lite.desktop")
        );
        assert_eq!(
            f.icon,
            PathBuf::from("/d/icons/hicolor/256x256/apps/app.thinkwatch.lite.png")
        );
    }

    /// The path is quoted and escaped the same way as the autostart entry, and
    /// `%u` stays outside the quotes where it is a field code.
    #[test]
    fn exec_quotes_the_appimage_and_passes_the_url() {
        let e = entry(
            "ThinkWatch Lite",
            "/home/a/My $Apps/ThinkWatch-Lite.AppImage",
            "/home/a/.local/share/icons/hicolor/256x256/apps/app.thinkwatch.lite.png",
            "thinkwatch-lite",
        );
        assert!(
            e.contains("\nExec=\"/home/a/My \\\\$Apps/ThinkWatch-Lite.AppImage\" %u\n"),
            "{e}"
        );
        assert!(e.contains("\nMimeType=x-scheme-handler/thinkwatch;\n"));
        assert!(e.contains("\nStartupWMClass=thinkwatch-lite\n"));
        assert!(e.contains("\nCategories=Development;\n"));
        assert!(!e.contains("NoDisplay"));
    }

    #[test]
    fn uninstall_removes_both_files_and_says_so_once() {
        let dir = std::env::temp_dir().join(format!("tw-desktop-rm-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let f = Files::under(&dir, "app.thinkwatch.lite");
        // Nothing there (a development build): nothing to say
        assert!(f.remove().is_empty());
        write_if_changed(&f.desktop, b"[Desktop Entry]\n").unwrap();
        write_if_changed(&f.icon, ICON).unwrap();
        let out = f.remove();
        assert_eq!(out.len(), 1);
        assert!(out[0].ok, "{}", out[0].text);
        assert!(!f.desktop.exists() && !f.icon.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_unchanged_file_is_not_rewritten() {
        let dir = std::env::temp_dir().join(format!("tw-desktop-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let f = dir.join("a/b.desktop");
        assert!(write_if_changed(&f, b"one").unwrap());
        assert!(!write_if_changed(&f, b"one").unwrap());
        assert!(write_if_changed(&f, b"two").unwrap());
        assert_eq!(std::fs::read(&f).unwrap(), b"two");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
