//! Linux system notifications: the freedesktop `org.freedesktop.Notifications`
//! service, spoken to directly over the session D-Bus.
//!
//! Spec: <https://specifications.freedesktop.org/notification/latest/protocol.html>
//! (hints: `…/hints.html`, urgency: `…/urgency-levels.html`).
//!
//! # Mapping to the bus, next to macOS and Windows
//!
//! | bus | macOS | Windows | here |
//! |---|---|---|---|
//! | identify one thing | identifier = key | tag + group hashed from the key | the server-assigned id, kept in a key ↔ id table |
//! | update in place | same identifier, `Passive` | data binding `Update`, no popup | `Notify` with `replaces_id`, urgency **low** |
//! | gone from the tray | re-post replaces it | `Update` fails → re-post with `SuppressPopup` | id unknown → `Notify` with urgency low |
//! | withdraw | `removeDelivered` | `History::Remove…` | `CloseNotification(id)` |
//! | click | delegate callback | protocol activation | `ActionInvoked(id, "default")` |
//! | window in front | delegate gives `List` only | `SuppressPopup` | urgency low |
//! | grouping | thread | group | none — the protocol has no grouping, so `thread_of` is not used |
//!
//! **Why urgency low for "quiet".** The protocol has no "into the tray without a
//! banner" flag. GNOME Shell never shows a banner for a low-urgency notification
//! (`messageTray.js` `_onNotificationRequestBanner`), and a replace resets
//! `acknowledged`, which *does* re-show the banner at any other urgency
//! (`notificationDaemon.js` `NotifyAsync`) — so an in-place count update at normal
//! urgency would interrupt the user every time. Other servers (dunst, mako) may
//! still pop low-urgency ones briefly; that is the best the protocol offers.
//!
//! **A user dismissing a notification is not "read".** `NotificationClosed` only
//! drops the id from the table (it is invalid from then on, per spec). The bus's
//! read state is untouched — exactly like macOS and Windows, which do not even get
//! told. The next update of that thing re-posts it quietly, as Windows does.
//!
//! # Why zbus directly, not `notify-rust`
//!
//! `notify-rust` (already in the tree via `tauri-plugin-notification`) opens a new
//! session connection per notification, waits for clicks per handle (one
//! `wait_for_action` future — or a blocking thread — per notification, with
//! `unwrap`s on the bus calls), cannot close an id it did not just send, and does
//! not surface `ActivationToken`. Here: **one connection, one signal stream, one
//! task**, over the same zbus 5 with the same features, so nothing new is compiled.
//!
//! # Surviving a restart
//!
//! The key ↔ id table is saved in the data directory, stamped with the boot id,
//! the login session and the notification server's unique bus name. Ids are only
//! meaningful to the server instance that handed them out, so any mismatch drops
//! the whole table — we would rather leave one stale notification up than close
//! someone else's.
//!
//! Caveat: GNOME Shell addresses `ActionInvoked` to the connection that sent the
//! notification and drops an app's notifications when that connection goes away,
//! so there a restart leaves nothing to withdraw or click. KDE and dunst broadcast
//! and keep them; that is what the table is for.
//!
//! # Window activation on Wayland
//!
//! A compositor only raises a window for a request that carries a valid
//! xdg-activation token. Servers implementing spec 1.2 send one in
//! `ActivationToken(id, token)` right before `ActionInvoked`. tao exposes no API for
//! it, but Tauri hands out the `GtkWindow`, and GTK 3's `gtk_window_set_startup_id`
//! passes the token to `xdg_activation_v1_activate` (immediately if the window is
//! mapped, otherwise when it maps — `gtkwindow.c` `gtk_window_notify_startup`,
//! `gdkwindow-wayland.c` `gdk_wayland_window_set_startup_id`). On X11 the same call
//! carries the startup-notification timestamp. A server that sends no token leaves
//! GNOME's "ThinkWatch Lite is ready" fallback.
//!
//! # No server
//!
//! No session bus, or nobody owns the name and activation fails: every call just
//! fails and is logged at debug. Nothing blocks the caller — all bus traffic is in
//! the task — and nothing panics. `SystemSink` is no fallback here: it goes through
//! the same bus. The next notification tries to connect again.

use std::collections::BTreeMap;
use std::path::Path;

use super::Level;

/// Where the key ↔ id table lives, in the data directory
pub const STORE_FILE: &str = "notice-ids-linux.json";

/// Which notification the server holds for each key, and which server that is.
#[derive(Debug, Default, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Table {
    /// Boot, login session and server instance the ids belong to (see [`stamp`])
    session: String,
    ids: BTreeMap<String, u32>,
}

impl Table {
    pub fn new(session: String) -> Self {
        Self {
            session,
            ids: BTreeMap::new(),
        }
    }

    /// The saved table if it belongs to `session`; otherwise an empty one for it.
    /// An unreadable file counts as empty — it must not get in the way of anything
    pub fn load(file: &Path, session: &str) -> Self {
        std::fs::read_to_string(file)
            .ok()
            .and_then(|t| serde_json::from_str::<Table>(&t).ok())
            .filter(|t| t.session == session)
            .unwrap_or_else(|| Self::new(session.to_string()))
    }

    pub fn save(&self, file: &Path) {
        let Ok(text) = serde_json::to_string(self) else {
            return;
        };
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Err(e) = std::fs::write(file, text) {
            tracing::debug!("notification id table not saved: {e}");
        }
    }

    /// Another server instance: none of the old ids mean anything to it
    pub fn rebind(&mut self, session: String) {
        self.session = session;
        self.ids.clear();
    }

    pub fn get(&self, key: &str) -> Option<u32> {
        self.ids.get(key).copied()
    }

    /// Returns whether anything changed
    pub fn set(&mut self, key: &str, id: u32) -> bool {
        self.ids.insert(key.to_string(), id) != Some(id)
    }

    pub fn take(&mut self, key: &str) -> Option<u32> {
        self.ids.remove(key)
    }

    pub fn key_of(&self, id: u32) -> Option<&str> {
        self.ids
            .iter()
            .find(|(_, v)| **v == id)
            .map(|(k, _)| k.as_str())
    }

    /// The server closed this id. Returns whether it was ours
    pub fn forget_id(&mut self, id: u32) -> bool {
        let before = self.ids.len();
        self.ids.retain(|_, v| *v != id);
        self.ids.len() != before
    }
}

/// What the ids are valid for: this boot, this login session, this server
/// instance. A unique bus name is never reused within one bus, but the bus
/// starts over each boot and each session — hence all three
pub fn stamp(boot_id: &str, login_session: &str, server: &str) -> String {
    format!("{boot_id}/{login_session}/{server}")
}

/// The `urgency` hint: 0 low, 1 normal, 2 critical. Critical ones do not expire
/// (spec, "Urgency Levels"), which is right only for "every client is blind right
/// now" — and we withdraw it the moment that is over
pub fn urgency(level: Level, quiet: bool) -> u8 {
    match (quiet, level) {
        (true, _) => 0,
        (false, Level::Critical) => 2,
        (false, _) => 1,
    }
}

/// Servers advertising `body-markup` parse the body as markup (GNOME always does).
/// Bodies carry user-chosen upstream names and error text: escape them
pub fn escape_markup(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            c => out.push(c),
        }
    }
    out
}

#[cfg(target_os = "linux")]
pub use native::NativeSink;
#[cfg(target_os = "linux")]
pub use service::{Cmd, Config, start};

#[cfg(target_os = "linux")]
mod service {
    use std::collections::HashMap;
    use std::future::Future;
    use std::path::PathBuf;
    use std::pin::Pin;

    use tokio::sync::mpsc;
    use zbus::export::futures_core::Stream;
    use zbus::zvariant::Value;
    use zbus::{Connection, MatchRule, Message, MessageStream};

    use super::{Table, escape_markup, stamp};

    pub(super) const DEST: &str = "org.freedesktop.Notifications";
    pub(super) const PATH: &str = "/org/freedesktop/Notifications";
    pub(super) const IFACE: &str = "org.freedesktop.Notifications";
    /// The action a click on the notification body invokes (spec, `ActionInvoked`)
    const DEFAULT_ACTION: &str = "default";

    /// Called with the key of a clicked notification, and the activation token
    /// if the server sent one
    pub type OnClick = Box<dyn Fn(String, Option<String>) + Send + Sync>;

    pub struct Config {
        pub app_name: String,
        /// `.desktop` basename without the extension (`desktop-entry` hint)
        pub desktop_entry: String,
        /// Absolute path, or empty
        pub icon: String,
        /// Label of the `default` action. Most servers never show it
        pub open_label: String,
        /// Where the key ↔ id table is saved; `None` keeps it in memory
        pub store: Option<PathBuf>,
        pub on_click: OnClick,
    }

    #[derive(Debug)]
    pub enum Cmd {
        /// Show, or replace the one this key already has. `track: false` is an
        /// announcement: clickable, but never replaced or withdrawn
        Post {
            key: String,
            title: String,
            body: String,
            urgency: u8,
            track: bool,
        },
        Withdraw(String),
    }

    struct Live {
        conn: Connection,
        signals: MessageStream,
        /// The server's unique name. Signals from anyone else are ignored
        server: Option<String>,
        /// Whether the body is parsed as markup. Asked on the first post: asking
        /// earlier would start a server by D-Bus activation for nothing
        markup: Option<bool>,
    }

    struct Service {
        cfg: Config,
        live: Option<Live>,
        table: Table,
        /// Announcements, only so a click on one can be routed. Not saved
        announced: HashMap<u32, String>,
        /// `ActivationToken` arrives just before `ActionInvoked`
        tokens: HashMap<u32, String>,
    }

    /// The sender half, and the task to spawn. Commands run in order
    pub fn start(cfg: Config) -> (mpsc::UnboundedSender<Cmd>, impl Future<Output = ()>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let svc = Service {
            cfg,
            live: None,
            table: Table::default(),
            announced: HashMap::new(),
            tokens: HashMap::new(),
        };
        (tx, svc.run(rx))
    }

    fn boot_id() -> String {
        std::fs::read_to_string("/proc/sys/kernel/random/boot_id")
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    }

    fn login_session() -> String {
        std::env::var("XDG_SESSION_ID").unwrap_or_default()
    }

    /// Next signal, or pending forever while not connected
    async fn next_signal(live: &mut Option<Live>) -> Option<zbus::Result<Message>> {
        match live {
            Some(l) => std::future::poll_fn(|cx| Pin::new(&mut l.signals).poll_next(cx)).await,
            None => std::future::pending().await,
        }
    }

    impl Service {
        async fn run(mut self, mut rx: mpsc::UnboundedReceiver<Cmd>) {
            // Connect now, not on the first post: ids saved by the last run are
            // validated here, and their clicks and closes start flowing
            self.connect().await;
            loop {
                tokio::select! {
                    cmd = rx.recv() => match cmd {
                        Some(cmd) => self.handle(cmd).await,
                        None => break,
                    },
                    msg = next_signal(&mut self.live) => match msg {
                        Some(Ok(m)) => self.on_signal(&m),
                        Some(Err(e)) => tracing::debug!("notification signal unreadable: {e}"),
                        None => {
                            tracing::debug!("session bus connection lost");
                            self.live = None;
                        }
                    },
                }
            }
        }

        fn save(&self) {
            if let Some(f) = &self.cfg.store {
                self.table.save(f);
            }
        }

        /// Connected, or trying once. `false`: no bus — the command is dropped
        async fn connect(&mut self) -> bool {
            if self.live.is_some() {
                return true;
            }
            match self.try_connect().await {
                Ok(live) => {
                    let session = stamp(
                        &boot_id(),
                        &login_session(),
                        live.server.as_deref().unwrap_or(""),
                    );
                    self.table = match &self.cfg.store {
                        Some(f) => Table::load(f, &session),
                        None => Table::new(session),
                    };
                    self.live = Some(live);
                    true
                }
                Err(e) => {
                    tracing::debug!("no session bus for notifications: {e}");
                    false
                }
            }
        }

        async fn try_connect(&self) -> zbus::Result<Live> {
            let conn = Connection::session().await?;
            let rule = MatchRule::builder()
                .msg_type(zbus::message::Type::Signal)
                .sender(DEST)?
                .path(PATH)?
                .interface(IFACE)?
                .build();
            let signals = MessageStream::for_match_rule(rule, &conn, Some(64)).await?;
            // Who owns the name right now. Does not start the server: nobody
            // owning it just means the ids saved last time are gone with it
            let server = conn
                .call_method(
                    Some("org.freedesktop.DBus"),
                    "/org/freedesktop/DBus",
                    Some("org.freedesktop.DBus"),
                    "GetNameOwner",
                    &(DEST,),
                )
                .await
                .ok()
                .and_then(|r| r.body().deserialize::<String>().ok());
            Ok(Live {
                conn,
                signals,
                server,
                markup: None,
            })
        }

        async fn handle(&mut self, cmd: Cmd) {
            if !self.connect().await {
                return;
            }
            let r = match cmd {
                Cmd::Post {
                    key,
                    title,
                    body,
                    urgency,
                    track,
                } => self.post(key, &title, &body, urgency, track).await,
                Cmd::Withdraw(key) => self.withdraw(&key).await,
            };
            if let Err(e) = r {
                tracing::debug!("notification call failed: {e}");
                // The connection itself is gone: reconnect on the next command
                if matches!(e, zbus::Error::InputOutput(_)) {
                    self.live = None;
                }
            }
        }

        async fn markup(&mut self) -> bool {
            let Some(live) = self.live.as_mut() else {
                return false;
            };
            if let Some(m) = live.markup {
                return m;
            }
            let caps: Vec<String> = match live
                .conn
                .call_method(Some(DEST), PATH, Some(IFACE), "GetCapabilities", &())
                .await
            {
                Ok(r) => r.body().deserialize().unwrap_or_default(),
                // Not cached: the server may just not be up yet
                Err(_) => return true,
            };
            let m = caps.iter().any(|c| c == "body-markup");
            live.markup = Some(m);
            m
        }

        async fn post(
            &mut self,
            key: String,
            title: &str,
            body: &str,
            urgency: u8,
            track: bool,
        ) -> zbus::Result<()> {
            let body = if self.markup().await {
                escape_markup(body)
            } else {
                body.to_string()
            };
            let replaces = if track {
                self.table.get(&key).unwrap_or(0)
            } else {
                0
            };
            let mut hints: HashMap<&str, Value<'_>> = HashMap::new();
            hints.insert("urgency", Value::U8(urgency));
            if !self.cfg.desktop_entry.is_empty() {
                hints.insert(
                    "desktop-entry",
                    Value::from(self.cfg.desktop_entry.as_str()),
                );
            }
            let actions = [DEFAULT_ACTION, self.cfg.open_label.as_str()];
            let Some(live) = self.live.as_mut() else {
                return Ok(());
            };
            let reply = live
                .conn
                .call_method(
                    Some(DEST),
                    PATH,
                    Some(IFACE),
                    "Notify",
                    &(
                        self.cfg.app_name.as_str(),
                        replaces,
                        self.cfg.icon.as_str(),
                        title,
                        body.as_str(),
                        &actions[..],
                        hints,
                        -1i32,
                    ),
                )
                .await?;
            let id: u32 = reply.body().deserialize()?;
            // The reply comes from the server itself: a different unique name
            // than before means it restarted (or was just activated), and every
            // id we held belongs to the old one
            let from = reply.header().sender().map(|s| s.to_string());
            if from.is_some() && from != live.server {
                live.server = from;
                self.announced.clear();
                self.tokens.clear();
                self.table.rebind(stamp(
                    &boot_id(),
                    &login_session(),
                    live.server.as_deref().unwrap_or(""),
                ));
            }
            if track {
                self.table.set(&key, id);
                self.save();
            } else {
                self.announced.insert(id, key);
            }
            Ok(())
        }

        async fn withdraw(&mut self, key: &str) -> zbus::Result<()> {
            let Some(id) = self.table.take(key) else {
                return Ok(());
            };
            self.save();
            let Some(live) = self.live.as_ref() else {
                return Ok(());
            };
            // Already gone (expired, dismissed) is an error reply per spec: fine
            match live
                .conn
                .call_method(Some(DEST), PATH, Some(IFACE), "CloseNotification", &(id,))
                .await
            {
                Err(zbus::Error::MethodError(..)) | Ok(_) => Ok(()),
                Err(e) => Err(e),
            }
        }

        fn known(&self, id: u32) -> Option<String> {
            self.table
                .key_of(id)
                .map(str::to_string)
                .or_else(|| self.announced.get(&id).cloned())
        }

        fn on_signal(&mut self, msg: &Message) {
            let hdr = msg.header();
            let Some(live) = self.live.as_ref() else {
                return;
            };
            // Anyone on the session bus can emit a signal with this interface
            let from = hdr.sender().map(|s| s.as_str());
            if from.is_none() || from != live.server.as_deref() {
                return;
            }
            let body = msg.body();
            match hdr.member().map(|m| m.as_str()) {
                Some("NotificationClosed") => {
                    let Ok((id, reason)) = body.deserialize::<(u32, u32)>() else {
                        return;
                    };
                    // 1 expired, 2 dismissed by the user, 3 closed by us. Whatever
                    // the reason, the id is dead; none of them means "read"
                    tracing::debug!("notification {id} closed ({reason})");
                    self.announced.remove(&id);
                    self.tokens.remove(&id);
                    if self.table.forget_id(id) {
                        self.save();
                    }
                }
                Some("ActivationToken") => {
                    let Ok((id, token)) = body.deserialize::<(u32, String)>() else {
                        return;
                    };
                    if self.known(id).is_some() {
                        self.tokens.insert(id, token);
                    }
                }
                Some("ActionInvoked") => {
                    let Ok((id, action)) = body.deserialize::<(u32, String)>() else {
                        return;
                    };
                    let token = self.tokens.remove(&id);
                    if action != DEFAULT_ACTION {
                        return;
                    }
                    if let Some(key) = self.known(id) {
                        (self.cfg.on_click)(key, token);
                    }
                }
                _ => {}
            }
        }
    }
}

#[cfg(target_os = "linux")]
mod native {
    use std::path::Path;

    use tauri::Manager;
    use tokio::sync::mpsc::UnboundedSender;

    use super::super::sink::counted_title;
    use super::super::{Level, Notice, Sink};
    use super::{Cmd, Config, STORE_FILE, start, urgency};

    /// Written next to the data so the path is stable. An AppImage has no
    /// installed icon, and its mount point changes every run
    const ICON: &[u8] = include_bytes!("../../icons/128x128.png");
    const ICON_FILE: &str = "notification-icon.png";

    fn write_icon(dir: &Path) -> String {
        let path = dir.join(ICON_FILE);
        if std::fs::read(&path).ok().as_deref() != Some(ICON) {
            let _ = std::fs::create_dir_all(dir);
            if let Err(e) = std::fs::write(&path, ICON) {
                tracing::debug!("notification icon not written: {e}");
                return String::new();
            }
        }
        path.to_string_lossy().into_owned()
    }

    /// Linux native system notifications
    pub struct NativeSink {
        app: tauri::AppHandle,
        tx: UnboundedSender<Cmd>,
    }

    impl NativeSink {
        /// Starts the D-Bus task. Never blocks and never fails: without a bus,
        /// notifications just do not appear
        pub fn new(app: tauri::AppHandle) -> Self {
            let dir = crate::data_dir();
            // Tauri's deb bundler names the entry `<productName>.desktop`
            // (tauri-bundler `linux/freedesktop/mod.rs` `generate_desktop_file`)
            let name = app.package_info().name.clone();
            let a = app.clone();
            let (tx, task) = start(Config {
                app_name: name.clone(),
                desktop_entry: name,
                icon: write_icon(&dir),
                open_label: tr!("打开", "Open").to_string(),
                store: Some(dir.join(STORE_FILE)),
                on_click: Box::new(move |key, token| clicked(&a, &key, token)),
            });
            tauri::async_runtime::spawn(task);
            Self { app, tx }
        }

        /// The window is in front: into the tray without a banner, like the other
        /// two platforms
        fn focused(&self) -> bool {
            self.app
                .get_webview_window("main")
                .and_then(|w| w.is_focused().ok())
                .unwrap_or(false)
        }

        fn post(&self, key: &str, title: String, body: &str, urgency: u8, track: bool) {
            let _ = self.tx.send(Cmd::Post {
                key: key.to_string(),
                title,
                body: body.to_string(),
                urgency,
                track,
            });
        }
    }

    impl Sink for NativeSink {
        fn show(&self, notice: &Notice) {
            let u = urgency(notice.level, self.focused());
            self.post(&notice.key, notice.title.clone(), &notice.body, u, true);
        }

        /// **Only the ones that were shown**: one held back (suppressed, app-only)
        /// must not pop up in the name of an update. Quiet: a count going from 2
        /// to 3 is no reason to interrupt again
        fn update(&self, notice: &Notice) {
            if !notice.notified {
                return;
            }
            let u = urgency(notice.level, true);
            self.post(&notice.key, counted_title(notice), &notice.body, u, true);
        }

        fn withdraw(&self, key: &str) {
            let _ = self.tx.send(Cmd::Withdraw(key.to_string()));
        }

        fn announce(&self, key: &str, title: &str, body: &str) {
            let u = urgency(Level::Warning, self.focused());
            self.post(key, title.to_string(), body, u, false);
        }
    }

    /// The same path as a click on macOS or Windows, then hand the activation
    /// token to the window that path brought up
    fn clicked(app: &tauri::AppHandle, key: &str, token: Option<String>) {
        super::super::open_from_notification(app, key);
        let Some(token) = token else { return };
        // Queued behind the main-thread work `open_from_notification` scheduled,
        // so the window exists by then (mapped, or mapping when revealed)
        let label = if key == crate::updater::UPDATE_NOTICE {
            crate::updater::UPDATE_WINDOW
        } else {
            "main"
        };
        crate::window::activate_with_token(app, label, token);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!(
            "tw-linux-notices-{}-{name}-{}",
            std::process::id(),
            super::super::now_ms()
        ));
        let _ = std::fs::remove_dir_all(&d);
        d.join(STORE_FILE)
    }

    #[test]
    fn a_saved_table_comes_back_in_the_same_session() {
        let f = tmp("same");
        let mut t = Table::new(stamp("boot", "2", ":1.40"));
        assert!(t.set("upstream:甲", 7));
        assert!(!t.set("upstream:甲", 7));
        assert!(t.set("core", 9));
        t.save(&f);
        let back = Table::load(&f, &stamp("boot", "2", ":1.40"));
        assert_eq!(back, t);
        assert_eq!(back.get("upstream:甲"), Some(7));
        assert_eq!(back.key_of(9), Some("core"));
    }

    #[test]
    fn another_boot_session_or_server_drops_the_whole_table() {
        let f = tmp("other");
        let mut t = Table::new(stamp("boot", "2", ":1.40"));
        t.set("core", 9);
        t.save(&f);
        for other in [
            stamp("boot2", "2", ":1.40"),
            stamp("boot", "3", ":1.40"),
            stamp("boot", "2", ":1.41"),
            stamp("boot", "2", ""),
        ] {
            let back = Table::load(&f, &other);
            assert_eq!(back.get("core"), None);
            assert_eq!(back.session, other);
        }
    }

    #[test]
    fn a_missing_or_broken_file_is_an_empty_table() {
        let f = tmp("broken");
        assert_eq!(Table::load(&f, "s"), Table::new("s".into()));
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(&f, "{not json").unwrap();
        assert_eq!(Table::load(&f, "s"), Table::new("s".into()));
    }

    #[test]
    fn closing_an_id_forgets_only_that_key() {
        let mut t = Table::new("s".into());
        t.set("a", 1);
        t.set("b", 2);
        assert!(t.forget_id(1));
        assert!(!t.forget_id(1));
        assert!(!t.forget_id(42));
        assert_eq!(t.get("a"), None);
        assert_eq!(t.get("b"), Some(2));
        assert_eq!(t.take("b"), Some(2));
        assert_eq!(t.take("b"), None);
    }

    #[test]
    fn rebinding_to_a_new_server_forgets_every_id() {
        let mut t = Table::new("old".into());
        t.set("a", 1);
        t.rebind("new".into());
        assert_eq!(t.session, "new");
        assert_eq!(t.get("a"), None);
    }

    #[test]
    fn only_critical_is_critical_and_quiet_is_always_low() {
        assert_eq!(urgency(Level::Critical, false), 2);
        assert_eq!(urgency(Level::Warning, false), 1);
        assert_eq!(urgency(Level::Info, false), 1);
        for l in [Level::Info, Level::Warning, Level::Critical] {
            assert_eq!(urgency(l, true), 0);
        }
    }

    #[test]
    fn markup_is_escaped() {
        assert_eq!(
            escape_markup("上游 <b>a&b</b> \"x\""),
            "上游 &lt;b&gt;a&amp;b&lt;/b&gt; \"x\""
        );
    }

    /// A real round trip over D-Bus against a fake notification server. Needs a
    /// session bus nobody else serves notifications on: run under
    /// `dbus-run-session -- cargo test`. Skipped (passes) otherwise
    #[cfg(target_os = "linux")]
    #[tokio::test(flavor = "multi_thread")]
    async fn round_trip_over_dbus() {
        fake::round_trip().await;
    }

    #[cfg(target_os = "linux")]
    mod fake {
        use std::collections::HashMap;
        use std::sync::{Arc, Mutex};
        use std::time::Duration;

        use tokio::sync::mpsc;
        use zbus::message::Header;
        use zbus::zvariant::OwnedValue;

        use super::super::service::{DEST, IFACE, PATH};
        use super::super::{Cmd, Config, STORE_FILE, start};

        #[derive(Debug)]
        enum Call {
            Notify {
                replaces: u32,
                icon: String,
                title: String,
                body: String,
                actions: Vec<String>,
                urgency: Option<u8>,
                entry: Option<String>,
                sender: String,
            },
            Close(u32),
        }

        struct Server {
            next: Mutex<u32>,
            calls: mpsc::UnboundedSender<Call>,
            markup: bool,
        }

        #[zbus::interface(name = "org.freedesktop.Notifications")]
        impl Server {
            #[allow(clippy::too_many_arguments)]
            fn notify(
                &self,
                _app_name: String,
                replaces_id: u32,
                app_icon: String,
                summary: String,
                body: String,
                actions: Vec<String>,
                hints: HashMap<String, OwnedValue>,
                _timeout: i32,
                #[zbus(header)] hdr: Header<'_>,
            ) -> u32 {
                // Like GNOME: a known id is replaced, otherwise a new one
                let id = if replaces_id != 0 {
                    replaces_id
                } else {
                    let mut n = self.next.lock().unwrap();
                    *n += 1;
                    *n
                };
                let _ = self.calls.send(Call::Notify {
                    replaces: replaces_id,
                    icon: app_icon,
                    title: summary,
                    body,
                    actions,
                    urgency: hints.get("urgency").and_then(|v| u8::try_from(v).ok()),
                    entry: hints
                        .get("desktop-entry")
                        .and_then(|v| String::try_from(v.try_clone().ok()?).ok()),
                    sender: hdr.sender().map(|s| s.to_string()).unwrap_or_default(),
                });
                id
            }

            fn close_notification(&self, id: u32) {
                let _ = self.calls.send(Call::Close(id));
            }

            fn get_capabilities(&self) -> Vec<String> {
                let mut c = vec!["actions".to_string(), "body".to_string()];
                if self.markup {
                    c.push("body-markup".into());
                }
                c
            }
        }

        /// Every click the service reported: key and activation token
        type Clicks = Arc<Mutex<Vec<(String, Option<String>)>>>;

        async fn next(rx: &mut mpsc::UnboundedReceiver<Call>) -> Call {
            tokio::time::timeout(Duration::from_secs(10), rx.recv())
                .await
                .expect("the server got no call in time")
                .expect("server gone")
        }

        fn post(key: &str, title: &str, urgency: u8, track: bool) -> Cmd {
            Cmd::Post {
                key: key.into(),
                title: title.into(),
                body: "a <b> & c".into(),
                urgency,
                track,
            }
        }

        pub async fn round_trip() {
            if std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_none() {
                eprintln!("skipped: no session bus (run under dbus-run-session)");
                return;
            }
            let (calls_tx, mut calls) = mpsc::unbounded_channel();
            let server = Server {
                next: Mutex::new(0),
                calls: calls_tx,
                markup: true,
            };
            let built = async {
                zbus::connection::Builder::session()?
                    .name(DEST)?
                    .serve_at(PATH, server)?
                    .build()
                    .await
            };
            let srv = match built.await {
                Ok(c) => c,
                Err(e) => {
                    // A real desktop session already has a notification server
                    eprintln!("skipped: cannot serve {DEST} on this bus: {e}");
                    return;
                }
            };
            let dir = std::env::temp_dir().join(format!("tw-dbus-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            let store = dir.join(STORE_FILE);
            let clicks: Clicks = Arc::default();
            let spawn = |clicks: Clicks| {
                let (tx, task) = start(Config {
                    app_name: "ThinkWatch Lite".into(),
                    desktop_entry: "ThinkWatch Lite".into(),
                    icon: "/tmp/icon.png".into(),
                    open_label: "Open".into(),
                    store: Some(store.clone()),
                    on_click: Box::new(move |k, t| clicks.lock().unwrap().push((k, t))),
                });
                (tx, tokio::spawn(task))
            };
            let (tx, task) = spawn(clicks.clone());

            // show: new id, hints, default action, escaped body
            tx.send(post("upstream:甲", "t1", 1, true)).unwrap();
            let client = match next(&mut calls).await {
                Call::Notify {
                    replaces,
                    icon,
                    title,
                    body,
                    actions,
                    urgency,
                    entry,
                    sender,
                } => {
                    assert_eq!(replaces, 0);
                    assert_eq!(icon, "/tmp/icon.png");
                    assert_eq!(title, "t1");
                    assert_eq!(body, "a &lt;b&gt; &amp; c");
                    assert_eq!(actions, ["default", "Open"]);
                    assert_eq!(urgency, Some(1));
                    assert_eq!(entry.as_deref(), Some("ThinkWatch Lite"));
                    sender
                }
                c => panic!("{c:?}"),
            };

            // update: replaces the same id, quietly
            tx.send(post("upstream:甲", "t1 (2)", 0, true)).unwrap();
            match next(&mut calls).await {
                Call::Notify {
                    replaces, urgency, ..
                } => {
                    assert_eq!(replaces, 1);
                    assert_eq!(urgency, Some(0));
                }
                c => panic!("{c:?}"),
            }

            // A click, GNOME-style: token then action, addressed to the sender
            let emit = |dest: Option<&str>, member: &str, body: (u32, String)| {
                let srv = srv.clone();
                let dest = dest.map(str::to_string);
                let member = member.to_string();
                async move {
                    srv.emit_signal(dest.as_deref(), PATH, IFACE, member.as_str(), &body)
                        .await
                        .unwrap();
                }
            };
            emit(Some(&client), "ActivationToken", (1, "tok-1".into())).await;
            emit(Some(&client), "ActionInvoked", (1, "default".into())).await;
            // Not ours, and a non-default action: ignored
            emit(None, "ActionInvoked", (77, "default".into())).await;
            emit(None, "ActionInvoked", (1, "other".into())).await;
            wait_for(|| !clicks.lock().unwrap().is_empty()).await;
            assert_eq!(
                clicks.lock().unwrap().as_slice(),
                [("upstream:甲".to_string(), Some("tok-1".to_string()))]
            );

            // The user dismisses it, KDE-style broadcast: the id is dropped, so the
            // next update re-posts instead of replacing a dead id
            srv.emit_signal(
                None::<&str>,
                PATH,
                IFACE,
                "NotificationClosed",
                &(1u32, 2u32),
            )
            .await
            .unwrap();
            wait_for(|| std::fs::read_to_string(&store).is_ok_and(|s| !s.contains("upstream:甲")))
                .await;
            tx.send(post("upstream:甲", "t1 (3)", 0, true)).unwrap();
            match next(&mut calls).await {
                Call::Notify {
                    replaces, urgency, ..
                } => {
                    assert_eq!(replaces, 0);
                    assert_eq!(urgency, Some(0));
                }
                c => panic!("{c:?}"),
            }

            // An announcement: never replaces, never saved, still clickable
            tx.send(post("update", "new version", 1, false)).unwrap();
            assert!(matches!(
                next(&mut calls).await,
                Call::Notify { replaces: 0, .. }
            ));
            tx.send(post("update", "new version", 1, false)).unwrap();
            assert!(matches!(
                next(&mut calls).await,
                Call::Notify { replaces: 0, .. }
            ));
            emit(Some(&client), "ActionInvoked", (4, "default".into())).await;
            wait_for(|| clicks.lock().unwrap().len() == 2).await;
            assert_eq!(clicks.lock().unwrap()[1], ("update".to_string(), None));
            assert!(!std::fs::read_to_string(&store).unwrap().contains("update"));

            // Restart: the id saved by the last run is withdrawn by the next one
            drop(tx);
            task.await.unwrap();
            let (tx, task) = spawn(clicks.clone());
            tx.send(Cmd::Withdraw("upstream:甲".into())).unwrap();
            assert!(matches!(next(&mut calls).await, Call::Close(2)));
            // Withdrawing what is not open calls nothing
            tx.send(Cmd::Withdraw("upstream:甲".into())).unwrap();
            tx.send(post("core", "c", 2, true)).unwrap();
            match next(&mut calls).await {
                Call::Notify { title, urgency, .. } => {
                    assert_eq!(title, "c");
                    assert_eq!(urgency, Some(2));
                }
                c => panic!("{c:?}"),
            }
            drop(tx);
            task.await.unwrap();

            // Another server instance (restarted daemon): the saved table is dropped
            srv.release_name(DEST).await.unwrap();
            drop(srv);
            let (calls_tx, mut calls) = mpsc::unbounded_channel();
            let srv = zbus::connection::Builder::session()
                .unwrap()
                .name(DEST)
                .unwrap()
                .serve_at(
                    PATH,
                    Server {
                        next: Mutex::new(100),
                        calls: calls_tx,
                        markup: false,
                    },
                )
                .unwrap()
                .build()
                .await
                .unwrap();
            let (tx, task) = spawn(clicks.clone());
            tx.send(Cmd::Withdraw("core".into())).unwrap();
            tx.send(post("core", "again", 2, true)).unwrap();
            match next(&mut calls).await {
                Call::Notify { replaces, body, .. } => {
                    // Nothing closed first, nothing replaced; no markup, no escaping
                    assert_eq!(replaces, 0);
                    assert_eq!(body, "a <b> & c");
                }
                c => panic!("{c:?}"),
            }
            drop(tx);
            task.await.unwrap();
            drop(srv);
            let _ = std::fs::remove_dir_all(&dir);
        }

        async fn wait_for(cond: impl Fn() -> bool) {
            for _ in 0..200 {
                if cond() {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            panic!("timed out");
        }
    }
}
