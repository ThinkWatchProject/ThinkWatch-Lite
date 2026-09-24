<p align="center">
  <img src="https://img.shields.io/badge/Tauri_2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" />
  <img src="https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/License-MIT-750014?style=for-the-badge" />
  <img src="https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white" />
  <img src="https://img.shields.io/badge/Windows-0078D4?style=for-the-badge" />
</p>

# ThinkWatch Lite

**[English](README.md) | [中文](README.zh-CN.md)**

ThinkWatch Lite is a desktop app that runs a local AI API gateway from the
macOS menu bar or the Windows notification area. Claude Code, Codex and other
clients of the Anthropic, OpenAI and Gemini APIs send their requests to the
gateway, and Lite shows what each request cost, which upstream served it and
why, and what was sent along with it.

It runs on macOS 12 or later on Apple Silicon, and on Windows 10 21H2 or later
on x64 or ARM64.

## Install

| Platform | Download |
|---|---|
| macOS, Apple Silicon | `brew install --cask thinkwatchproject/tap/thinkwatch-lite`, or [`ThinkWatch-Lite-<version>-arm64.dmg`](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest) |
| Windows, x64 | [`ThinkWatch-Lite-<version>-x64-setup.exe`](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest) |
| Windows, ARM64 | [`ThinkWatch-Lite-<version>-arm64-setup.exe`](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest) |

The [Lite page](https://thinkwat.ch/lite#install) has one-click downloads of
the latest version and picks the Windows architecture for you. The gateway,
[ThinkWatch Core](https://github.com/ThinkWatchProject/ThinkWatch-Core), ships
inside the app; nothing else needs to be installed.

### macOS

```bash
brew install --cask thinkwatchproject/tap/thinkwatch-lite
```

A disk image is also available from the
[latest release](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest):
download `ThinkWatch-Lite-<version>-arm64.dmg`, check it against the sha256
published beside it, and drag ThinkWatch Lite into Applications. The app is
**not signed by a registered Apple developer**, so macOS quarantines a
downloaded copy and refuses to open it until the attribute is removed:

```bash
xattr -dr com.apple.quarantine "/Applications/ThinkWatch Lite.app"
```

The same can be done without a terminal: after the first refused launch,
choose Open Anyway in System Settings › Privacy & Security. Removing that
attribute is the only thing
[the cask](https://github.com/ThinkWatchProject/homebrew-tap) does beyond
copying the app out of the disk image.

### Windows

Download the installer for the machine's architecture from the
[latest release](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest):
`ThinkWatch-Lite-<version>-x64-setup.exe` for most PCs, or
`ThinkWatch-Lite-<version>-arm64-setup.exe` for a PC with an ARM processor.
Check it against the sha256 published beside it:

```powershell
Get-FileHash .\ThinkWatch-Lite-<version>-x64-setup.exe
```

The installer sets the app up for all users in Program Files, so Windows asks
for administrator permission. It requires Windows 10 21H2 or later; WebView2, which
Windows 11 already includes, is downloaded during installation if it is
missing.

The installer is **not code-signed**, and no certificate will be bought.
Running a downloaded copy brings up SmartScreen's full-screen warning,
"Windows protected your PC". Choose **More info**, then **Run anyway**.

Once installed, the app lives in the notification area. Data is kept in
`%APPDATA%\ThinkWatch`.

## Features

### Usage and cost

Tokens, cost and requests over any period, broken down by model, with the cache
hit rate, the net savings from caching and latency percentiles per model.
Measured costs, estimated costs and unpriced requests are reported separately
and never added together. Subscription accounts such as a ChatGPT sign-in are
priced by the price sheet like any other upstream, and an upstream such as a
local model can be set to free. Every request records the price sheet and the
date of the prices it was costed with.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-en-dark.png">
  <img src="docs/screenshots/overview-en-light.png" alt="The usage overview: tokens, cost and requests, a 24-hour trend stacked by model, the leaderboard by model and the cache hit rate">
</picture>

### Routing and failover

Routing rules send requests to an upstream or a group of upstreams by model,
key, token count, tools, images and other properties. Every request records
the rule it matched, the group it went through and each attempt with its
status and duration.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/requests-en-dark.png">
  <img src="docs/screenshots/requests-en-light.png" alt="The traffic page with a request open: the primary upstream answered 529, the request moved to openrouter, and Anthropic Messages was converted to OpenAI Chat Completions">
</picture>

A dry run evaluates the rules for a given request and shows where it would go
and why, without sending anything and without incurring any cost.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dry-run-en-dark.png">
  <img src="docs/screenshots/dry-run-en-light.png" alt="A routing dry run: the first two rules did not match and say why, the third one did, and the request goes to a group that tries two upstreams in order">
</picture>

### Upstreams

API keys, a ChatGPT account signed in from the app (with its usage limits and
reset times), relays such as OpenRouter, and local models. When a client and an
upstream speak different API formats, requests are converted between Anthropic
Messages, OpenAI Chat Completions, OpenAI Responses and Gemini, and the fields
that cannot be carried over are listed. Upstreams can be reached through an
outbound proxy and priced with a custom price sheet.

API keys and header values can be written as `${NAME}` to read a system
environment variable. On macOS these come from the login shell, so variables
exported in `~/.zshrc` and similar files apply; on Windows they are the
environment variables configured in system settings. After a variable changes,
reopening the app picks it up. Proxy variables such as `HTTPS_PROXY`, and
`PATH`, are not read.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/upstreams-en-dark.png">
  <img src="docs/screenshots/upstreams-en-light.png" alt="The upstream list: API-key upstreams, a ChatGPT account on Plus with 34% of its 5-hour quota used, OpenRouter through a proxy, DeepSeek, Gemini and a local Ollama, each with its 24-hour requests, cost and time to first byte">
</picture>

### Security

- **Outbound redaction** replaces keys, private keys and connection strings
  before a request leaves, and restores them in the response.
- **Tool-call inspection** cuts off the response stream when an upstream returns
  a tool call carrying a command that would grant code execution.

Both apply to every upstream and run in Off, Observe or Enforce mode, starting
in Observe. The Security page lists every rule: built-in rules can be turned off
one at a time, custom rules are regular expressions, and any rule can be tried
on a sample first. Everything the two protections catch is kept in a log.

### MCP

The MCP page shows the MCP servers each client has configured side by side, and
copies a server to another client or removes it, showing the change before
anything is written. It also lists skills and hooks, and scans client
configuration files for hidden characters, injected instructions and dangerous
commands.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/findings-en-dark.png">
  <img src="docs/screenshots/findings-en-light.png" alt="The findings page: a hook that downloads and runs a remote script, zero-width characters hidden in a skill, an upstream whose share of high-risk responses is rising, and the MCP servers each client has configured">
</picture>

### Client setup

Claude Code, Codex, opencode, Zed and Aider can be pointed at the gateway
from the app. The change is shown as a diff before anything is written, the
original file is backed up, only the endpoint and key fields change, and the
change can be restored at any time. Cursor, Continue and Gemini CLI come with
step-by-step instructions.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/clients-en-dark.png">
  <img src="docs/screenshots/clients-en-light.png" alt="The clients page: Claude Code and Codex pointed at the gateway and already serving requests, opencode not yet pointed at it, and the clients that have to be set up by hand">
</picture>

### Menu bar and notifications

The menu bar shows today's tokens over today's cost; the numbers turn orange
when a quota is nearly used up and red when it is. Settings can reduce it to the
icon or to the numbers. Clicking it opens a native menu with the gateway's
state, unread notices, each subscription account's quota and reset time, today's
usage and the requests in progress, plus common actions: switching a manually
selected upstream, copying the gateway address or the default key, undoing the
last configuration change and checking for updates, all without opening the main
window. System notifications report when the gateway stops forwarding, a
subscription quota runs out or a credential stops working; an unreachable
upstream, which a fallback usually covers, is only listed in the app. Notices as
a whole can be set to system notifications, in-app only, or off. Marking a
notice as read stops the bell from counting it; the notice stays in the list
until the problem behind it clears or the list is cleared.

On Windows the icon sits in the notification area. Hovering over it shows the
gateway's state and today's tokens and cost; a left click opens the main
window, and a right click opens the same menu, with quota bars written out as
text. Notices arrive as native Windows notifications.

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/menubar-cost-dark.png">
    <img src="docs/screenshots/menubar-cost-light.png" alt="Menu bar item: today's cost $24.72, output at 47 tokens per second" width="210">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/menubar-quota-dark.png">
    <img src="docs/screenshots/menubar-quota-light.png" alt="Menu bar item: 34% of the subscription quota used, resets in 2 hours" width="210">
  </picture>
</p>

## Updates

The app looks for a new version shortly after it starts and once a day after
that, reading a small manifest and nothing else. It can be turned off in
Settings.

When there is one, a small window says so, and what happens next depends on how
the app was installed.

**Downloaded from the releases page on macOS:** one press on the install
button does the rest. The app downloads the update, verifies it against a key
compiled into itself, waits for the requests the gateway is serving to
finish — up to three minutes — then replaces itself and restarts. A Claude
Code task in the middle of a response is not cut off to make room for the
update.

**On Windows:** the same single press. The app downloads the new installer,
verifies it against the key compiled into itself, waits for the requests in
flight to finish in the same way, then runs the installer, and the new version
starts once it is done. The app is installed for all users, so Windows asks for
administrator permission at every update; declining leaves the current version
running.

**Installed with Homebrew:** the window gives the command to copy, and the app
never replaces itself. Homebrew records which version it put in
`/Applications`; an app that overwrote it would be written back over by the
next `brew upgrade`. The window only appears once the tap carries the new
version, so the command always has something to install:

```bash
brew update && brew upgrade --cask thinkwatch-lite
```

`brew update` comes first because `brew upgrade` refreshes taps at most once a
day on its own.

## Build from source

```bash
pnpm install
pnpm tauri dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the checks to run before opening a
pull request.

## Layout

```
src/              React 19 + Tailwind 4 frontend
src-tauri/        Tauri 2 shell: supervises core, renders the menu bar
```

The gateway itself lives in ThinkWatch Core; this repository holds no routing,
forwarding, or accounting logic. It talks to core over a unix socket on macOS,
and over a loopback port on Windows; both carry a per-launch credential.

## License

MIT. See [LICENSE](LICENSE).
