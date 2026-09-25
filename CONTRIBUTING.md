# Contributing to ThinkWatch Lite

## Open PRs against `dev`

```bash
gh pr create --base dev --head your-branch
```

`main` is the release line; `dev` is where routine work lands. GitHub
pre-fills a new PR's base with the repo's default branch, which is
`main`, so **the default is not the one you want**. If you already
opened against `main`, click *Edit* next to the PR title and change the
base — the commits and the discussion carry over. A bot will remind you.

## Scope, so you don't build something that gets declined

These decisions are settled and not up for a PR:

- **macOS, Windows and Linux, from one tag.** Every release tag produces
  five files for people to install, each with the gateway inside it and a
  sha256 beside it: an arm64 disk image for macOS, an x64 and an arm64
  installer for Windows, and an x86_64 and an aarch64 AppImage for Linux.
- **macOS: Apple Silicon only, and not signed by Apple.** The macOS
  artifact is an arm64 `.app` in a disk image, signed with the project's
  own self-signed certificate. That certificate does not satisfy Gatekeeper; it
  exists so that every release has the same signer, which is what lets
  Homebrew upgrade the app without warning that the signer changed. A
  universal binary for Intel and a Developer ID signature are both ongoing
  costs nobody has taken on — so a PR that adds the notarization step
  without the account behind it can't be merged, and neither can one that
  makes the build fall back to whatever architecture the machine happens to
  be, which ships a file some users can download and cannot open.
- **Windows: not code-signed.** The installers carry no Authenticode
  signature, and no certificate will be bought, so SmartScreen warns when
  a downloaded installer is first run. Updates are verified against the
  key compiled into the app, the same as on macOS.
- **Linux: the AppImage only.** No deb, rpm, Flatpak or Snap. The
  sandboxed formats cannot start the bundled `twcore` or edit client
  configuration such as `~/.claude`, and the AppImage updates itself
  without a password. Builds target glibc 2.35 (Ubuntu 22.04) and
  WebKitGTK 4.1.

The gateway itself — routing, forwarding, cost accounting, redaction —
lives in [ThinkWatch Core](https://github.com/ThinkWatchProject/ThinkWatch-Core).
If the behavior you want to change is on the data path, that's the
repository for it. This one is the window onto it.

## Commit messages

Conventional Commits (`fix(scope): subject`), in **English** — this is a
public repository and the history is documentation.

Say *why* in the body, not just *what*; the diff already shows what
changed. A commit explaining the reasoning behind a non-obvious choice
saves the next person from re-deriving it or "fixing" it back.

## Linux prerequisites

Building on Linux needs the WebKitGTK, AppIndicator and D-Bus development
packages. On Ubuntu or Debian, the same set CI installs:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev dbus
```

The notification tests talk to a session bus; without a desktop session, run
them under `dbus-run-session -- cargo test --manifest-path src-tauri/Cargo.toml`.

## Before you open the PR

```bash
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Warnings are errors. The toolchain is `stable`, so a newer stable than
your local one can surface lints you cannot see — `rustup update stable`
before blaming CI.

## Things this UI must not do

These are load-bearing and a PR that breaks one will be asked to change:

- **Never display a real secret**, in the UI, a diff, a log, an event,
  or a diagnostic bundle. Masking happens before it leaves the process.
- **Never present an estimate as exact.** Measured, estimated, and
  unpriced stay three separate figures. An invented precise number is
  more harmful than an honest "don't know".
- **Never delete a user's file or config without showing the diff
  first.** Every destructive action goes through our own confirmation
  UI, never a browser `confirm`.

## Building a `.app`

`pnpm tauri build` produces a self-contained bundle. The `twcore` inside
it is downloaded from a ThinkWatch-Core release and checksum-verified —
not copied out of a sibling checkout, because then "which build did we
hand out" would be a question about somebody's afternoon.

Which release is decided by the `tag` that `Cargo.lock` resolved for
`tw-api`, so the protocol mirror compiled into the app and the binary
shipped beside it always come from one core commit. To move to a newer
core: change the `tag` in `src-tauri/Cargo.toml`, `cargo update -p
tw-api`, rebuild.

`pnpm tauri dev` does not run any of this and needs no network. There,
`locate_core` finds a binary in a sibling `thinkwatch-core` checkout.

On Windows the same command produces an NSIS installer instead, and it
is not code-signed; on Linux it produces an AppImage. The macOS bundle is Apple Silicon only, and neither
signed nor notarized. On macOS 15 and later a downloaded copy has to be
cleared once:

    xattr -dr com.apple.quarantine "/Applications/ThinkWatch Lite.app"

That flag is set by whatever downloaded the file. An update fetched by
the app itself never carries it, so this is a one-time step rather than
one per release.

## Product screenshots

The images in `docs/screenshots/` — used by the READMEs and, through
`docs/screenshots/web/`, by the website — are generated by a script
rather than captured by hand, so they can be regenerated whenever the
interface changes:

```bash
pnpm shots                          # every scene, both languages, light and dark
pnpm shots --only overview,keys     # just these scenes
pnpm shots --langs en --themes dark
```

This runs on macOS only, because the images show the macOS app: the
pages are rendered by the system WKWebView, as in the app, and framed as
a macOS window. It needs the Xcode command line tools (`swiftc`) and
`src-tauri/resources/twcore`, which `bash src-tauri/scripts/fetch-core.sh`
downloads, since the menu bar images are drawn by the app's own code.

How it works, in the order `scripts/shots/shots.sh` runs it:

- **The real interface on mocked IPC.** `scripts/shots/` is a separate
  Vite entry that mounts `src/main.tsx` with every Tauri command and
  control-plane endpoint answered from fixed data. It is never part of
  the app build, and `src/index.css` keeps `scripts/` out of Tailwind's
  source scan, so the app bundle is byte-for-byte the same with or
  without it.
- **Deterministic.** The clock is fixed at Friday 2026-09-25 16:42:07
  local time and the traffic is generated from a fixed seed, so two runs
  produce the same pages. The menu bar images use the same clock: the
  page hands its fixed time to `menubar_shots` as `--now`.
- **Core's own answers.** The configuration views (upstreams, keys,
  routes, security rules, prices, dry runs) are what the pinned core
  returns for `scripts/shots/core/config.{en,zh}.yaml`, stored as JSON in
  `scripts/shots/core/{en,zh}/`. After changing those files or the core
  tag in `src-tauri/Cargo.toml`, regenerate them with
  `bash scripts/shots/core/oracle.sh <path to a ThinkWatch-Core checkout>`.
  Sentences that core or the Rust side produce carry their real message
  codes and English text, so the Chinese interface translates them
  through `src/i18n/core.zh.json` exactly as it does in the app.
- **The mock is type-checked with the app.** `pnpm typecheck`, and so
  CI, also checks `scripts/shots/`. Every Tauri command and control-plane
  endpoint handler returns the type the interface reads (from
  `src/generated/` or the page's own API module), and the stored core
  answers are checked against the core types, so a protocol change fails
  the check rather than producing pages with missing data. When a newer
  core tag changes those types, run `oracle.sh` again. At capture time, a
  command the mock does not answer, or one called without the arguments it
  expects, stops the run.
- **Scenes** are listed in `scripts/shots/scenes.ts`: which page, local or
  remote core, and what to open before the picture is taken.
  `scripts/shots/capture.swift` loads each one in an off-screen WKWebView,
  waits until the page reports it is ready with no console errors and two
  snapshots in a row are identical, and frames it. A scene with a table
  that does not fit the window stops the run instead of being captured
  with its last columns cut off; such a scene can collapse the sidebar, as
  the MCP scene does. The sidebar is shown in its solid color: the translucent
  material the app uses on macOS is drawn by the window server and cannot
  be captured off-screen.
  `src-tauri/examples/menubar_shots.rs` draws the menu bar.
  `scripts/shots/finish.mjs` writes the results.

What it writes:

| Files | What they are |
|---|---|
| `docs/screenshots/{zh,en}/<scene>-{light,dark}.png` | The window, 1100×690 points at 2×, in a macOS frame: 2360×1540 pixels, 256 colors |
| `docs/screenshots/menubar-{light,dark}.png` | The menu bar item: the mark and today's tokens and cost |
| `docs/screenshots/{zh,en}/menubar-menu-{light,dark}.png` | The menu it opens (standard items are drawn approximately) |
| `docs/screenshots/web/` | What the website uses: the dark variant as WebP at quality 85, `-en` for the English interface |
