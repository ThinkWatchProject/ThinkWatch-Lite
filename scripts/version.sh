#!/usr/bin/env bash
#
# 打印这一版的版本号，顺带确认三处写的是同一个。
#
# **版本号写在三个文件里。**`tauri.conf.json` 的那个进 `Info.plist`，
# 也就是用户和 Homebrew 看到的；`Cargo.toml` 的那个进二进制；
# `package.json` 的那个谁也不进，但它是 `pnpm` 侧唯一的版本声明，漂了
# 之后没有任何东西会报错。
#
# 三处对不上的后果在打 tag 那一刻才显形，而那时候要收回一个已经推上去
# 的 tag。所以 CI 每一轮都跑一次这个 —— 改版本号的那个 PR 上就拦住。
set -euo pipefail

cd "$(dirname "$0")/.."

# Windows 上的 Python 多半叫 `python`，没有 `python3` 这个名字
PY=$(command -v python3 || command -v python) || {
  echo "找不到 Python（python3 或 python）" >&2
  exit 1
}

read -r TAURI PKG <<EOS
$("$PY" -c '
import json
print(json.load(open("src-tauri/tauri.conf.json"))["version"],
      json.load(open("package.json"))["version"])
')
EOS
CARGO=$(awk -F'"' '/^version *= *"/ { print $2; exit }' src-tauri/Cargo.toml)

if [ "$TAURI" != "$PKG" ] || [ "$TAURI" != "$CARGO" ]; then
  cat >&2 <<MSG
版本号对不上：
  src-tauri/tauri.conf.json  $TAURI
  package.json               $PKG
  src-tauri/Cargo.toml       $CARGO
三处必须一致 —— 发布流水线用 tag 核对的是这一个数。
MSG
  exit 1
fi

echo "$TAURI"
