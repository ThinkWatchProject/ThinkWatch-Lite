#!/usr/bin/env python3
"""给 DMG 写出 latest.json。

应用去问「有没有新版本」时读的就是这一份清单，下载的是它指向的那个 DMG
—— 和网页上给人下载的是同一个文件（应用怎么从 DMG 更新自己，见
`src-tauri/src/dmg.rs`）。

清单里的 URL 必须和最终挂在 release 上的文件名一字不差，所以文件名不在
这里拼：DMG 的路径由调用方传进来，URL 用的就是它的名字。两处各拼一遍的
话，哪天改了一处，表现是所有人的自动更新 404，而发布当时一切看起来都
正常。

顺带核对签名和应用信任的那把公钥是同一把。签名用的私钥来自 CI 的
secret，公钥编译在每一个已安装的实例里 —— 两者一旦不是一对，DMG 下得
下来，然后被每一台机器静默拒绝，而发布流水线全绿。
"""

import base64
import datetime
import json
import pathlib
import sys

REPO = "ThinkWatchProject/ThinkWatch-Lite"
#         平台键由更新器自己拼：目标系统 + 架构。macOS 上是 darwin。
PLATFORM = "darwin-aarch64"


def key_id(minisign_block: str) -> bytes:
    """minisign 的第二行里带着密钥 ID，公钥和签名用的是同一个。"""
    return base64.b64decode(minisign_block.splitlines()[1])[2:10]


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit("用法：manifest.py <版本> <DMG> [发布说明文件]")
    version, dmg = sys.argv[1], pathlib.Path(sys.argv[2])
    notes_file = sys.argv[3] if len(sys.argv) > 3 else None

    root = pathlib.Path(__file__).resolve().parent.parent
    conf = json.loads((root / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    pubkey = base64.b64decode(conf["plugins"]["updater"]["pubkey"]).decode()

    # 名字里不能有空格 —— GitHub 会把资源名里的空格换成点，而清单里的
    # URL 是发布之前写好的，对不上就是 404。
    if " " in dmg.name:
        sys.exit(f"DMG 的名字里有空格：{dmg.name}")
    if not dmg.exists():
        sys.exit(f"没有 DMG：{dmg}")
    sig = dmg.with_name(dmg.name + ".sig")
    if not sig.exists():
        sys.exit(
            f"没有签名：{sig}\n"
            "签 DMG 的那一步没跑，或者私钥的环境变量没传进那一步。"
        )
    signature = sig.read_text(encoding="utf-8").strip()

    want = key_id(pubkey)
    got = key_id(base64.b64decode(signature).decode())
    if want != got:
        sys.exit(
            "签名用的密钥不是应用信任的那把：\n"
            f"  tauri.conf.json 里的公钥  {want.hex()}\n"
            f"  DMG 的签名                {got.hex()}\n"
            "这样发出去，每一台机器都会拒绝这个更新，而这里不会有任何报错。"
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
                "url": f"https://github.com/{REPO}/releases/download/v{version}/{dmg.name}",
            }
        },
    }
    if notes_file:
        notes = pathlib.Path(notes_file).read_text(encoding="utf-8").strip()
        if notes:
            manifest["notes"] = notes

    (dmg.parent / "latest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"{dmg.name}\n签名密钥 {got.hex()}，和应用里的公钥是同一把")


if __name__ == "__main__":
    main()
