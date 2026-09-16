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

Two decisions are settled and not up for a PR:

- **macOS first.** Windows and Linux come after the macOS version is
  done, so PRs adding them won't be merged yet. The menu
  bar is rendered as a macOS bitmap, the client-detection paths are
  macOS paths, and the supervisor talks to launchd.
- **Apple Silicon only, and unsigned.** The release pipeline produces one
  artifact: an arm64 `.app` in a zip, ad-hoc signed, with the gateway inside
  it. A universal binary for Intel and a Developer ID signature are both
  ongoing costs nobody has taken on — so a PR that adds the notarization step
  without the account behind it can't be merged, and neither can one that
  makes the build fall back to whatever architecture the machine happens to
  be, which ships a file some users can download and cannot open.

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

## Before you open the PR

```bash
pnpm typecheck
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

Apple Silicon only, and the bundle is neither signed nor notarized. On
macOS 15 and later a downloaded copy has to be cleared once:

    xattr -dr com.apple.quarantine "/Applications/ThinkWatch Lite.app"

That flag is set by whatever downloaded the file. An update fetched by
the app itself never carries it, so this is a one-time step rather than
one per release.
