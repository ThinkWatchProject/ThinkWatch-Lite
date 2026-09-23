#!/usr/bin/env python3
"""给这一版的安装包写出 latest.json。

应用去问「有没有新版本」时读的就是这一份清单，下载的是它指向的那个文件
—— 和网页上给人下载的是同一个：macOS 上是 DMG（应用怎么从 DMG 更新自己，
见 `src-tauri/src/dmg.rs`），Windows 上是 NSIS 安装程序，更新器直接跑它。

用法：manifest.py <版本> <发布说明文件> <平台>=<文件> [<平台>=<文件> ...]

清单里的 URL 必须和最终挂在 release 上的文件名一字不差，所以文件名不在
这里拼：文件的路径由调用方传进来，URL 用的就是它的名字。两处各拼一遍的
话，哪天改了一处，表现是所有人的自动更新 404，而发布当时一切看起来都
正常。

顺带核对签名和应用信任的那把公钥是同一把。签名用的私钥来自 CI 的
secret，公钥编译在每一个已安装的实例里 —— 两者一旦不是一对，文件下得
下来，然后被每一台机器静默拒绝，而发布流水线全绿。
"""

import base64
import datetime
import json
import pathlib
import sys

REPO = "ThinkWatchProject/ThinkWatch-Lite"
# 平台键由更新器自己拼：目标系统 + 架构（macOS 上叫 darwin）。**只收这几个**
# —— 拼错一个字母，那个平台的用户就永远问不到新版本，而清单看起来完好。
PLATFORMS = {"darwin-aarch64", "windows-x86_64", "windows-aarch64"}


def key_id(minisign_block: str) -> bytes:
    """minisign 的第二行里带着密钥 ID，公钥和签名用的是同一个。"""
    return base64.b64decode(minisign_block.splitlines()[1])[2:10]


def entry(path: pathlib.Path, version: str, want: bytes) -> dict:
    """一个平台那一项：签名和下载地址。"""
    # 名字里不能有空格 —— GitHub 会把资源名里的空格换成点，而清单里的
    # URL 是发布之前写好的，对不上就是 404。
    if " " in path.name:
        sys.exit(f"文件名里有空格：{path.name}")
    if not path.exists():
        sys.exit(f"没有这个文件：{path}")
    sig = path.with_name(path.name + ".sig")
    if not sig.exists():
        sys.exit(
            f"没有签名：{sig}\n"
            "签名那一步没跑，或者私钥的环境变量没传进那一步。"
        )
    signature = sig.read_text(encoding="utf-8").strip()

    got = key_id(base64.b64decode(signature).decode())
    if want != got:
        sys.exit(
            f"{path.name} 签名用的密钥不是应用信任的那把：\n"
            f"  tauri.conf.json 里的公钥  {want.hex()}\n"
            f"  这个文件的签名            {got.hex()}\n"
            "这样发出去，每一台机器都会拒绝这个更新，而这里不会有任何报错。"
        )
    return {
        "signature": signature,
        "url": f"https://github.com/{REPO}/releases/download/v{version}/{path.name}",
    }


def main() -> None:
    if len(sys.argv) < 4:
        sys.exit("用法：manifest.py <版本> <发布说明文件> <平台>=<文件> [...]")
    version, notes_file, pairs = sys.argv[1], sys.argv[2], sys.argv[3:]

    root = pathlib.Path(__file__).resolve().parent.parent
    conf = json.loads((root / "src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    want = key_id(base64.b64decode(conf["plugins"]["updater"]["pubkey"]).decode())

    platforms = {}
    for pair in pairs:
        platform, _, file = pair.partition("=")
        if platform not in PLATFORMS or not file:
            sys.exit(f"不认识的平台或写法：{pair}（要的是 <平台>=<文件>，平台是 {sorted(PLATFORMS)} 之一）")
        if platform in platforms:
            sys.exit(f"{platform} 给了两次")
        platforms[platform] = entry(pathlib.Path(file), version, want)
    # **少一个平台就不发。**缺掉的那个平台上，已经装好的每一份都会停在旧版本，
    # 而发布页上看起来一切正常
    missing = PLATFORMS - platforms.keys()
    if missing:
        sys.exit(f"这一版缺了这些平台：{sorted(missing)}")

    manifest = {
        "version": version,
        "pub_date": datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "platforms": platforms,
    }
    notes = pathlib.Path(notes_file).read_text(encoding="utf-8").strip()
    if notes:
        manifest["notes"] = notes

    out = pathlib.Path(pairs[0].partition("=")[2]).parent / "latest.json"
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for p, e in sorted(platforms.items()):
        print(f"{p:18} {e['url'].rsplit('/', 1)[1]}")
    print(f"签名密钥 {want.hex()}，和应用里的公钥是同一把")


if __name__ == "__main__":
    main()
