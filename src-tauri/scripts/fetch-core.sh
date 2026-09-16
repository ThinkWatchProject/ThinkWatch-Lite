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
# 只在 `tauri build` 打包那一步跑（`beforeBundleCommand`）。日常
# `tauri dev` 不经过这里，也不需要网络：那时 `locate_core` 会在隔壁
# 仓库的 target 里找到一个。
set -euo pipefail

cd "$(dirname "$0")/.."

REPO="ThinkWatchProject/ThinkWatch-Core"
ASSET="twcore-aarch64-apple-darwin"
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
