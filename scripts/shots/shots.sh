#!/usr/bin/env bash
#
# 重拍产品截图：README、官网用的那一套。
#
#   pnpm shots                         # 全部：13 个场景 × 中英 × 深浅，外加菜单栏
#   pnpm shots --only overview,keys    # 只拍这几个场景（菜单栏照样重画）
#   pnpm shots --langs en --themes dark
#
# 只在 macOS 上跑：截图就是 macOS 上的样子（WKWebView 画的界面、macOS 的窗口框和
# 菜单栏）。要 Xcode 命令行工具（swiftc）、Rust，以及 src-tauri/resources/twcore
# （菜单栏那一步要编译应用本身；没有就先跑 `bash src-tauri/scripts/fetch-core.sh`）。
#
# 一步步：核对 mock 和协议对得上 → 单独构建截图页 → 在 WKWebView 里逐张拍、套窗口框
# → 用应用自己的画法画菜单栏 → 量化成仓库里放的 PNG，并给官网出 webp。
set -euo pipefail

cd "$(dirname "$0")/../.."
[ "$(uname)" = Darwin ] || { echo "截图只在 macOS 上拍" >&2; exit 1; }
command -v swiftc > /dev/null || { echo "要先装 Xcode 命令行工具：xcode-select --install" >&2; exit 1; }
[ -f src-tauri/resources/twcore ] || {
  echo "src-tauri/resources/twcore 不在。先跑 bash src-tauri/scripts/fetch-core.sh" >&2
  exit 1
}

cache=node_modules/.cache/shots
raw=$cache/raw
mkdir -p "$cache/bin"
rm -rf "$raw"

echo "· 核对 mock 的类型"
pnpm exec tsc --noEmit -p scripts/shots

echo "· 构建截图页"
pnpm exec vite build --config scripts/shots/vite.config.ts --logLevel warn

echo "· 编译截图程序"
if [ ! -x "$cache/bin/capture" ] || [ scripts/shots/capture.swift -nt "$cache/bin/capture" ]; then
  swiftc -swift-version 5 -O scripts/shots/capture.swift -o "$cache/bin/capture"
fi

echo "· 拍界面"
"$cache/bin/capture" "$cache/site" "$raw" --today "$cache/today.json" "$@"

echo "· 画菜单栏"
# 截图页定住的「现在」和今天的用量：菜单上的数、倒计时和概览、截图页是同一刻的
read -r now today < <(node -e '
  const t = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  console.log(t.now, t.tokens, t.cost_micros, t.requests, t.failed);
' "$cache/today.json")
# shellcheck disable=SC2086 # 四个数，按空格拆开正是要的
cargo run --quiet --manifest-path src-tauri/Cargo.toml --example menubar_shots -- \
  --out "$raw" --now "$now" --today $today

echo "· 收进 docs/screenshots/"
node scripts/shots/finish.mjs "$raw" docs/screenshots
