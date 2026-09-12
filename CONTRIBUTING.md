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

- **macOS only.** Windows and Linux support is out of scope. The menu
  bar is rendered as a macOS bitmap, the client-detection paths are
  macOS paths, and the supervisor talks to launchd.
- **Not distributed as a build.** No signed `.app`, no installer, no
  release workflow, no auto-update. Run it from source.

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
