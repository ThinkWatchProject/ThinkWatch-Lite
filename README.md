<p align="center">
  <img src="https://img.shields.io/badge/Tauri_2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" />
  <img src="https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/License-MIT-750014?style=for-the-badge" />
  <img src="https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white" />
</p>

# ThinkWatch Lite

**[English](README.md) | [中文](README.zh-CN.md)**

**The desktop app for a local AI API gateway.** A menu-bar app that supervises
[ThinkWatch Core](https://github.com/ThinkWatchProject/ThinkWatch-Core) and puts
its config, its traffic, and what it costs you in front of you.

**macOS first, and not distributed as a build.** Other platforms come once the
macOS version is done. There is no signed `.app`, no
installer, and no release page — run it from source. That is a deliberate scope
decision, not a gap waiting to be filled.

```bash
pnpm install
pnpm tauri dev
```

## What it's for

Point Claude Code, Codex, or anything else that speaks the Anthropic or OpenAI
API at a local port, and this is the window onto what happens next:

- **What a session cost, and how much to trust that number.** Measured,
  estimated, and unpriced are three separate figures, never added together. The
  price list's snapshot date is stamped next to the total, because a number
  computed from a two-month-old price list doesn't mean what yesterday's means.
- **Where each request went and why.** The rule it matched by name, the policy
  group, and the full failover chain with a reason and a duration on every hop.
- **What went out with it.** Secrets caught heading for an untrusted upstream,
  redactions applied, tool calls that looked dangerous — with the request and
  response bodies masked before they ever reach the screen.
- **Edit the config two ways.** A form for changing a value, a CodeMirror editor
  for everything structural. Both write through the same span-patching layer, so
  editing one field changes exactly one line and leaves your comments alone.
- **50 pixels in the menu bar.** Spend today, or remaining subscription quota
  for an account that has one — rendered as a bitmap, because the menu bar
  can't fit two lines of text.

## Layout

```
src/              React 19 + Tailwind 4 frontend
src-tauri/        Tauri 2 shell: supervises core, renders the menu bar
```

The gateway itself lives in ThinkWatch Core; this repository holds no routing,
forwarding, or accounting logic. It talks to core over a unix socket.

## License

MIT. See [LICENSE](LICENSE).
