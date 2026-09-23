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

# Windows 上的 Python 多半叫 `python`，没有 `python3` 这个名字
PY=$(command -v python3 || command -v python) || {
  echo "找不到 Python（python3 或 python）" >&2
  exit 1
}

REPO="ThinkWatchProject/ThinkWatch-Core"

# 装进包里的是**这次构建的目标平台**那一份。
#
# 以前这里写死 `twcore-aarch64-apple-darwin`。在 macOS 上打包时它是对的，
# 而在别处它会安静地把一个跑不了的二进制装进包里 —— 应用照样启动、照样出
# 界面，然后停在连接页上，正是引入这套校验要挡的那个 bug 换了个样子。
#
# 目标平台先看 `TARGET`（手工指定），再看 Tauri 自己交给 `beforeBuildCommand`
# 的 `TAURI_ENV_TARGET_TRIPLE`（`tauri build --target` 写了什么它就是什么），
# 都没有才按本机。**不能只按本机**：发布流水线在 x64 的机器上也可能打别的
# 架构的包，那时本机的答案就是错的那一个。
case "${TARGET:-${TAURI_ENV_TARGET_TRIPLE:-$(rustc -vV | sed -n 's/^host: //p')}}" in
  aarch64-apple-darwin)      ASSET="twcore-aarch64-apple-darwin" ;;
  x86_64-pc-windows-msvc)    ASSET="twcore-x86_64-pc-windows-msvc.exe" ;;
  aarch64-pc-windows-msvc)   ASSET="twcore-aarch64-pc-windows-msvc.exe" ;;
  *)
    echo "没有为 ${TARGET:-本机} 发布的 twcore —— 发版流水线里加一条，或者用 TARGET= 指一个有的" >&2
    exit 1
    ;;
esac
# 放进去时的名字**跟着平台走**：Windows 上要 `.exe`，否则 `CreateProcess`
# 见到没有扩展名的路径会去找同名的 `.exe` 而找不到这一个。声明装什么的那份
# 静态 JSON 也要跟着分平台，见 `tauri.windows.conf.json`。
case "$ASSET" in
  *.exe) OUT="resources/twcore.exe" ;;
  *)     OUT="resources/twcore" ;;
esac

TAG=$(
  cargo metadata --format-version 1 --manifest-path Cargo.toml 2>/dev/null \
    | "$PY" -c '
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

# 算 sha256 的命令**两个平台不同名**：macOS 带的是 shasum（一个 Perl 脚本），
# Git Bash 带的是 sha256sum。输出是同一种两列格式，有哪个用哪个。
if command -v sha256sum >/dev/null 2>&1; then
  SHA256="sha256sum"
else
  SHA256="shasum -a 256"
fi

# 校验和先下（几十字节）。已经有一份对得上的就不再拉那十四兆 —— 本地
# 反复构建和 CI 每一轮都会走到这儿。
curl -fsSL "$BASE/$ASSET.sha256" -o "$TMP/sum"
WANT_SUM=$(awk '{print $1}' "$TMP/sum")
if [ -f "$OUT" ] && [ "$($SHA256 "$OUT" | awk '{print $1}')" = "$WANT_SUM" ]; then
  echo "已经是 ${TAG} 那一份，跳过下载"
  exit 0
fi

echo "取 twcore ${TAG}"
curl -fsSL "$BASE/$ASSET" -o "$TMP/twcore"

# 校验和里记的是发布时那个文件名，换个名字就对不上 —— 在临时目录里
# 按原名核对，核完再改名放过去。
( cd "$TMP" && mv twcore "$ASSET" && $SHA256 -c sum && mv "$ASSET" twcore )

# **产物自检：它是不是这个架构的。**一个架构不对的二进制在文件列表上看不出
# 任何问题，而它会一路装进包里发出去。
#
# 只在有 `file` 的地方做。Git Bash 不一定带它，而在那边这件事发布流水线
# 已经做过了 —— 它读 PE 头里的 machine 字段，比字符串匹配还准（见 core 的
# release.yml）。所以这里**不是悄悄跳过**：那一档的检查在上游。
if command -v file >/dev/null 2>&1; then
  # **`file` 的措辞随版本变**：同一个 Windows ARM64 的 exe，有的版本写
  # `Aarch64`，有的写 `ARM64`。所以按一组写法、不分大小写地认。
  case "$ASSET" in
    *-apple-darwin)             EXPECT="arm64" ;;
    twcore-x86_64-pc-windows*)  EXPECT="x86-64" ;;
    twcore-aarch64-pc-windows*) EXPECT="aarch64|arm64" ;;
    *)                          EXPECT="" ;;
  esac
  if [ -n "$EXPECT" ] && ! file "$TMP/twcore" | grep -Eqi "$EXPECT"; then
    echo "下回来的不是 ${EXPECT} 的二进制：$(file "$TMP/twcore")" >&2
    exit 1
  fi
fi

chmod +x "$TMP/twcore"
mv "$TMP/twcore" "$OUT"
echo "已放好：${OUT}，来自 ${TAG}"
