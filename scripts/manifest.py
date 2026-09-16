#!/usr/bin/env python3
"""把更新包整理成发布资源，并写出 latest.json。

应用去问「有没有新版本」时读的就是这一份清单。它里面那个 URL 必须和最终
挂在 release 上的文件名一字不差 —— 所以改名和写清单在同一处做：分开两步
的话，改名规则变了而清单没跟上，表现是所有人的自动更新 404，而发布当时
一切看起来都正常。

顺带核对签名和应用信任的那把公钥是同一把。签名用的私钥来自 CI 的
secret，公钥编译在每一个已安装的实例里 —— 两者一旦不是一对，更新包能
下载、能解压，然后被每一台机器静默拒绝，而发布流水线全绿。
"""

import base64
import datetime
import json
import pathlib
import shutil
import sys

REPO = "ThinkWatchProject/ThinkWatch-Lite"
#         平台键由更新器自己拼：目标系统 + 架构。macOS 上是 darwin。
PLATFORM = "darwin-aarch64"


def key_id(minisign_block: str) -> bytes:
    """minisign 的第二行里带着密钥 ID，公钥和签名用的是同一个。"""
    return base64.b64decode(minisign_block.splitlines()[1])[2:10]


def main() -> None:
    if len(sys.argv) < 4:
        sys.exit("用法：manifest.py <版本> <bundle 目录> <输出目录> [发布说明文件]")
    version, bundle, out = sys.argv[1], pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
    notes_file = sys.argv[4] if len(sys.argv) > 4 else None

    root = pathlib.Path(__file__).resolve().parent.parent
    conf = json.loads((root / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    pubkey = base64.b64decode(conf["plugins"]["updater"]["pubkey"]).decode()

    src = bundle / "ThinkWatch Lite.app.tar.gz"
    if not src.exists():
        sys.exit(
            f"没有更新包：{src}\n"
            "tauri.conf.json 里的 bundle.createUpdaterArtifacts 关掉了，"
            "或者签名的环境变量没传进构建那一步。"
        )

    # 名字里不能有空格 —— GitHub 会把资源名里的空格换成点，而清单里的
    # URL 是发布之前写好的，对不上就是 404。
    name = f"ThinkWatch-Lite-{version}-arm64.app.tar.gz"
    out.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, out / name)
    signature = (src.with_suffix(".gz.sig")).read_text(encoding="utf-8").strip()
    (out / f"{name}.sig").write_text(signature + "\n", encoding="utf-8")

    want = key_id(pubkey)
    got = key_id(base64.b64decode(signature).decode())
    if want != got:
        sys.exit(
            "签名用的密钥不是应用信任的那把：\n"
            f"  tauri.conf.json 里的公钥  {want.hex()}\n"
            f"  更新包的签名              {got.hex()}\n"
            "这样发出去，每一台机器都会拒绝这个更新包，而这里不会有任何报错。"
        )

    manifest = {
        "version": version,
        "pub_date": datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "platforms": {
            PLATFORM: {
                "signature": signature,
                "url": f"https://github.com/{REPO}/releases/download/v{version}/{name}",
            }
        },
    }
    if notes_file:
        notes = pathlib.Path(notes_file).read_text(encoding="utf-8").strip()
        if notes:
            manifest["notes"] = notes

    (out / "latest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"{name}\n签名密钥 {got.hex()}，和应用里的公钥是同一把")


if __name__ == "__main__":
    main()
