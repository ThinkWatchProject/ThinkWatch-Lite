#!/usr/bin/env python3
"""写出一版在 GitHub Release 页面上的正文。

用法：release_notes.py <版本> <更新列表文件>

正文是英文的，依次是：

1. `release-notes/<版本>.md`：这一版的说明。**可以没有**，没有就从下载表开始。
2. 下载表：每个平台一行，文件名和 release.yml 挂上去的一字不差；再给 Homebrew
   和 Linux 安装脚本的命令。
3. 怎样用 `.sha256` 核对下载的文件。
4. 第二个参数的内容：GitHub 按上一版以来合并的 PR 生成的「What's Changed」，由
   调用方用 `gh api repos/<仓库>/releases/generate-notes` 取来。拆成参数传进来，
   这个脚本就不碰网络，测试可以直接喂它。

**tag 的注解不在这里。**那段中文写进 latest.json（见 manifest.py），是给已经装上
的应用的；发布页面向从网页来下载的人。

说明文件写坏了（有中文、有一级标题、是空的）就不写正文 —— 发版流水线在这一步
停下，比发出去再改好。CI 在每个 PR 上把 `release-notes/` 下的每一份都过一遍
（release_notes_test.py），所以真到打 tag 时不该再撞上。
"""

from __future__ import annotations

import pathlib
import re
import sys

REPO = "ThinkWatchProject/ThinkWatch-Lite"
ROOT = pathlib.Path(__file__).resolve().parent.parent
NOTES_DIR = ROOT / "release-notes"

# 每个平台发的那一个文件。**和 release.yml 起的名字一字不差** ——
# release_notes_test.py 拿 release.yml 核对这张表，对不上的话发布页上的链接就是 404。
DOWNLOADS = [
    ("macOS, Apple silicon", "ThinkWatch-Lite-{v}-arm64.dmg"),
    ("Windows, x64", "ThinkWatch-Lite-{v}-x64-setup.exe"),
    ("Windows, ARM64", "ThinkWatch-Lite-{v}-arm64-setup.exe"),
    ("Linux, x86_64", "ThinkWatch-Lite-{v}-x86_64.AppImage"),
    ("Linux, aarch64", "ThinkWatch-Lite-{v}-aarch64.AppImage"),
]

BREW = "brew install --cask thinkwatchproject/tap/thinkwatch-lite"
INSTALL_SH = f"curl -fsSL https://github.com/{REPO}/releases/latest/download/install.sh | sh"

# CalVer：2026.9.16
VERSION = re.compile(r"\d{4}\.\d{1,2}\.\d+")
# 中日韩文字和全角标点（码位区间）。发布页写英文；中文的那段在 tag 上
CJK_RANGES = [(0x3000, 0x30FF), (0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF), (0xFF00, 0xFFEF)]
CJK = re.compile("[" + "".join(f"{chr(a)}-{chr(b)}" for a, b in CJK_RANGES) + "]")


class NotesError(Exception):
    pass


def summary(version: str, notes_dir: pathlib.Path = NOTES_DIR) -> str | None:
    """`release-notes/<版本>.md` 的内容；没有这个文件是 None。"""
    path = notes_dir / f"{version}.md"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    name = f"release-notes/{path.name}"
    if not text:
        raise NotesError(f"{name} 是空的：没有要说的就删掉这个文件")
    for n, line in enumerate(text.splitlines(), 1):
        if CJK.search(line):
            raise NotesError(
                f"{name} 第 {n} 行有中文：发布页写英文，中文的说明写在 tag 的注解里\n  {line}"
            )
        # 发布页的标题由流水线定（ThinkWatch Lite <版本>），正文里再来一个一级标题就重了
        if line.startswith("# "):
            raise NotesError(f"{name} 第 {n} 行是一级标题：标题由流水线写，说明里从 ## 或正文开始\n  {line}")
    return text


def render(version: str, changes: str, summary_text: str | None) -> str:
    """整份正文。`changes` 是 GitHub 生成的那段，原样接在最后。"""
    if not VERSION.fullmatch(version):
        raise NotesError(f"版本号的写法不对：{version}（要的是 2026.9.16 这样的）")
    base = f"https://github.com/{REPO}/releases/download/v{version}"
    files = [(platform, name.format(v=version)) for platform, name in DOWNLOADS]
    dmg, x64 = files[0][1], files[1][1]
    appimage = files[3][1]

    parts = []
    if summary_text:
        parts.append(summary_text)

    rows = "\n".join(f"| {platform} | [`{name}`]({base}/{name}) |" for platform, name in files)
    parts.append(
        f"""## Downloads

| Platform | File |
|---|---|
{rows}

Each file is published with a `.sha256` file beside it. `latest.json` is the manifest for in-app updates, and `install.sh` is the Linux install script.

On macOS, Homebrew installs the same disk image:

```sh
{BREW}
```

On Linux, the install script downloads the AppImage for the machine's architecture, checks its SHA-256 and installs it as `~/Applications/ThinkWatch-Lite.AppImage`:

```sh
{INSTALL_SH}
```

Both commands install the latest release. First-launch steps for each platform, such as removing the quarantine attribute from a copy downloaded on macOS, are described in the [README](https://github.com/{REPO}#install)."""
    )

    parts.append(
        f"""## Verifying a download

A `.sha256` file holds the SHA-256 of the file followed by its name. With both files in the current directory, on macOS:

```sh
shasum -a 256 -c {dmg}.sha256
```

On Linux:

```sh
sha256sum -c {appimage}.sha256
```

On Windows, in PowerShell, the following prints `True` when the installer matches:

```powershell
(Get-FileHash .\\{x64}).Hash -eq (Get-Content .\\{x64}.sha256).Split()[0]
```

The Homebrew cask and the Linux install script check the SHA-256 themselves."""
    )

    if changes.strip():
        parts.append(changes.strip())
    return "\n\n".join(parts) + "\n"


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit("用法：release_notes.py <版本> <更新列表文件>")
    version, changes_file = sys.argv[1], sys.argv[2]
    changes = pathlib.Path(changes_file).read_text(encoding="utf-8")
    try:
        sys.stdout.write(render(version, changes, summary(version)))
    except NotesError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
