#!/usr/bin/env bash
#
# 把打包用的 twcore 取回来，放进 `resources/`。
#
# **不从隔壁仓库的 target 目录复制。**那样「发出去的包里装的是哪一版」
# 取决于那台机器当时的状态 —— 而这正是要消掉的不确定性。这里取的是
# core 的 Release 产物，并核对 sha256。
#
# **版本不在这个脚本里写死。**它从 `Cargo.lock` 解析 `tw-api` 实际
# 锁到的那个 tag —— 桌面版编译进去的是那一版的协议镜像，包里装的就
#必须是同一版的二进制。两处各写一遍就会漂。
#
# 挂在 `beforeBuildCommand` 上，**不是 `beforeBundleCommand`**。
# `tauri.conf.json` 声明 `.app` 里装着这个文件，而 Tauri 的 build
# script 在**编译期**就校验它在不在 —— 挂在打包那一步上，等于在一个
# 干净的检出里永远赶不上：编译先失败。
#
# 日常 `tauri dev` 不经过这里，也不需要网络：那时 `locate_core` 会在
# 隔壁仓库的 target 里找到一个。
set -euo pipefail

cd "$(dirname "$0")/.."

REPO="ThinkWatchProject/ThinkWatch-Core"

# 装进包里的是**这次构建的目标平台**那一份。
#
# 以前这里写死 `twcore-aarch64-apple-darwin`。在 macOS 上打包时它是对的，
# 而在别处它会安静地把一个跑不了的二进制装进包里 —— 应用照样启动、照样出
# 界面，然后停在连接页上，正是引入这套校验要挡的那个 bug 换了个样子。
#
# `--target` 由调用方给（发布流水线一定会写），没给就按本机。
case "${TARGET:-$(rustc -vV | sed -n 's/^host: //p')}" in
  aarch64-apple-darwin)      ASSET="twcore-aarch64-apple-darwin" ;;
  x86_64-pc-windows-msvc)    ASSET="twcore-x86_64-pc-windows-msvc.exe" ;;
  aarch64-pc-windows-msvc)   ASSET="twcore-aarch64-pc-windows-msvc.exe" ;;
  *)
    echo "没有为 ${TARGET:-本机} 发布的 twcore —— 发版流水线里加一条，或者用 TARGET= 指一个有的" >&2
    exit 1
    ;;
esac
# **包里那个文件的名字还是 `twcore`，两个平台一样。**
#
# Windows 上这不够：`CreateProcess` 见到一个没有扩展名的路径会去找同名的
# `.exe`，而我们这个文件就叫 `twcore`，于是找不到。那里要叫 `twcore.exe`，
# 而 `tauri.conf.json` 里声明装什么的那一行是静态 JSON，改法是加一份
# `tauri.windows.conf.json`，连同 `locate_core` 一起改。
#
# 那件事属于打包，不在这一笔里 —— 这里只负责取对文件。
OUT="resources/twcore"

TAG=$(
  cargo metadata --format-version 1 --manifest-path Cargo.toml 2>/dev/null \
    | python3 -c '
import json, re, sys
meta = json.load(sys.stdin)
for p in meta["packages"]:
    if p["name"] == "tw-api" and (p.get("source") or "").startswith("git+"):
        m = re.search(r"[?&]tag=([^&#]+)", p["source"])
        if m:
            print(m.group(1))
            sys.exit(0)
        print("NOT_A_TAG", file=sys.stderr)
        sys.exit(2)
sys.exit(3)
'
) || {
  cat >&2 <<'MSG'
取不到 tw-api 锁定的 tag。

打包用的 twcore 必须和编译进去的协议镜像来自同一个 core 版本，所以
`tw-api` 必须钉在一个 tag 上，不能是 `branch = "main"` —— 跟着分支走
意味着同一份源码今天和明天编出来的东西不一样，而包里那个二进制又是
另一个时刻的。

在 src-tauri/Cargo.toml 里改成：
  tw-api = { git = "https://github.com/ThinkWatchProject/ThinkWatch-Core.git", tag = "vX.Y.Z" }
MSG
  exit 1
}

mkdir -p resources
BASE="https://github.com/$REPO/releases/download/$TAG"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 校验和先下（几十字节）。已经有一份对得上的就不再拉那十四兆 —— 本地
# 反复构建和 CI 每一轮都会走到这儿。
curl -fsSL "$BASE/$ASSET.sha256" -o "$TMP/sum"
WANT_SUM=$(awk '{print $1}' "$TMP/sum")
if [ -f "$OUT" ] && [ "$(shasum -a 256 "$OUT" | awk '{print $1}')" = "$WANT_SUM" ]; then
  echo "已经是 ${TAG} 那一份，跳过下载"
  exit 0
fi

echo "取 twcore ${TAG}"
curl -fsSL "$BASE/$ASSET" -o "$TMP/twcore"

# 校验和里记的是发布时那个文件名，换个名字就对不上 —— 在临时目录里
# 按原名核对，核完再改名放过去。
( cd "$TMP" && mv twcore "$ASSET" && shasum -a 256 -c sum && mv "$ASSET" twcore )

# **产物自检。**一个架构不对的二进制在文件列表上看不出任何问题，而它
# 会一路装进 .app 发出去。
file "$TMP/twcore" | grep -q 'arm64' || {
  echo "下回来的不是 arm64 的二进制" >&2
  exit 1
}

chmod +x "$TMP/twcore"
mv "$TMP/twcore" "$OUT"
echo "已放好：${OUT}，来自 ${TAG}"
