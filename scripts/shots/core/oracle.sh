#!/usr/bin/env bash
#
# 重新生成截图页的「标准答案」：en/、zh/ 下那几份 JSON。
#
#   bash scripts/shots/core/oracle.sh <thinkwatch-core 的本地检出>
#
# **什么时候要跑。**改了示例配置（config.*.yaml、requests.json），或者升级了
# 钉住的 core 之后。截图页的配置类数据（上游、密钥、路由、安全规则、试算）
# 直接用这几份文件，所以它们必须是 core 真的答出来的，不是照着样子手写的。
#
# 用的是 src-tauri/Cargo.toml 钉住的那个 tag：从检出里 `git archive` 一份到临时
# 目录，放进 oracle.rs 跑一次。**不改那个检出。**要先在那边 `git fetch --tags`。
set -euo pipefail

core=${1:?用法：oracle.sh <thinkwatch-core 的本地检出>}
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
tag=$(sed -n 's/^tw-api = .*tag = "\([^"]*\)".*/\1/p' "$root/src-tauri/Cargo.toml")
[ -n "$tag" ] || { echo "src-tauri/Cargo.toml 里找不到 tw-api 的 tag" >&2; exit 1; }

src=$(mktemp -d)
trap 'rm -rf "$src"' EXIT
git -C "$core" archive "$tag" | tar -x -C "$src"
cp "$here/oracle.rs" "$src/crates/tw-control/tests/shots_oracle.rs"

# 编译产物留着，下次只重编改了的那一点
export CARGO_TARGET_DIR="$root/node_modules/.cache/shots/core-target"
for lang in en zh; do
  echo "core $tag · $lang"
  SHOTS_CONFIG="$here/config.$lang.yaml" SHOTS_REQUESTS="$here/requests.json" SHOTS_OUT="$here/$lang" \
    cargo test --manifest-path "$src/Cargo.toml" -p tw-control --test shots_oracle --quiet
done
