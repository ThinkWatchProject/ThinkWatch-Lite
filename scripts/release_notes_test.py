#!/usr/bin/env python3
"""release_notes.py 的测试，外加 `release-notes/` 下的每一份说明。

    python3 scripts/release_notes_test.py

CI 在每个 PR 上跑它：发布页的正文只在推 tag 时才写，写坏了（链接 404、说明里
混进中文）要到那时才看得见，而那时要撤回的是一个已经推上去的 tag。
"""

import pathlib
import re
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
# 不在仓库里留 __pycache__
sys.dont_write_bytecode = True

import release_notes as rn  # noqa: E402

ROOT = HERE.parent
WORKFLOW = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")

CHANGES = """## What's Changed
* Remote mode by @fylorn in https://github.com/ThinkWatchProject/ThinkWatch-Lite/pull/182


**Full Changelog**: https://github.com/ThinkWatchProject/ThinkWatch-Lite/compare/v2026.9.15...v2026.9.16"""


def notes_dir(case: unittest.TestCase, files: dict[str, str]) -> pathlib.Path:
    """一个临时的 `release-notes/`，测试结束就删。"""
    tmp = tempfile.TemporaryDirectory()
    case.addCleanup(tmp.cleanup)
    d = pathlib.Path(tmp.name)
    for name, text in files.items():
        (d / name).write_text(text, encoding="utf-8")
    return d


class Body(unittest.TestCase):
    def test_sections_come_in_order(self):
        body = rn.render("2026.9.16", CHANGES, "Remote connections.")
        order = [
            body.index("Remote connections."),
            body.index("## Downloads"),
            body.index("## Verifying a download"),
            body.index("## What's Changed"),
        ]
        self.assertEqual(order, sorted(order))
        self.assertTrue(body.startswith("Remote connections.\n\n## Downloads"))
        self.assertTrue(body.endswith("v2026.9.15...v2026.9.16\n"))

    def test_without_a_summary_it_starts_with_the_downloads(self):
        self.assertTrue(rn.render("2026.9.16", CHANGES, None).startswith("## Downloads\n"))

    def test_without_changes_there_is_no_empty_section(self):
        body = rn.render("2026.9.16", "\n", None)
        self.assertNotIn("What's Changed", body)
        self.assertTrue(body.endswith("themselves.\n"))

    def test_every_platform_links_its_file_in_this_release(self):
        body = rn.render("2026.9.16", CHANGES, None)
        links = re.findall(r"\]\((https://[^)]+)\)", body)
        base = "https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/download/v2026.9.16/"
        files = [u.removeprefix(base) for u in links if u.startswith(base)]
        self.assertEqual(
            files,
            [
                "ThinkWatch-Lite-2026.9.16-arm64.dmg",
                "ThinkWatch-Lite-2026.9.16-x64-setup.exe",
                "ThinkWatch-Lite-2026.9.16-arm64-setup.exe",
                "ThinkWatch-Lite-2026.9.16-x86_64.AppImage",
                "ThinkWatch-Lite-2026.9.16-aarch64.AppImage",
            ],
        )

    def test_the_files_are_the_ones_the_workflow_publishes(self):
        # 写 latest.json 的那一步逐个点名每个平台的文件：`平台=dist/<文件>`
        published = set(re.findall(r"=dist/(ThinkWatch-Lite-\$VERSION-[A-Za-z0-9_.-]+)\"", WORKFLOW))
        listed = {name.format(v="$VERSION") for _, name in rn.DOWNLOADS}
        self.assertEqual(len(published), 5, published)
        self.assertEqual(listed, published)

    def test_the_install_commands(self):
        body = rn.render("2026.9.16", CHANGES, None)
        self.assertIn("\nbrew install --cask thinkwatchproject/tap/thinkwatch-lite\n", body)
        self.assertIn(
            "\ncurl -fsSL https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest/download/install.sh | sh\n",
            body,
        )
        # 首版还没进 winget-pkgs，不能给一条装不上的命令
        self.assertNotIn("winget", body.lower())

    def test_the_checksum_commands_name_real_files(self):
        body = rn.render("2026.9.16", CHANGES, None)
        self.assertIn("shasum -a 256 -c ThinkWatch-Lite-2026.9.16-arm64.dmg.sha256\n", body)
        self.assertIn("sha256sum -c ThinkWatch-Lite-2026.9.16-x86_64.AppImage.sha256\n", body)
        self.assertIn(
            "(Get-FileHash .\\ThinkWatch-Lite-2026.9.16-x64-setup.exe).Hash -eq "
            "(Get-Content .\\ThinkWatch-Lite-2026.9.16-x64-setup.exe.sha256).Split()[0]\n",
            body,
        )

    def test_the_body_itself_is_english(self):
        self.assertIsNone(rn.CJK.search(rn.render("2026.9.16", CHANGES, None)))

    def test_a_malformed_version_is_refused(self):
        for bad in ["v2026.9.16", "2026.9", "0.47.0", ""]:
            with self.assertRaises(rn.NotesError, msg=bad):
                rn.render(bad, CHANGES, None)


class Summary(unittest.TestCase):
    def test_absent_is_none(self):
        self.assertIsNone(rn.summary("2026.9.16", notes_dir(self, {})))

    def test_read_and_trimmed(self):
        d = notes_dir(self, {"2026.9.16.md": "\nRemote connections.\n\n"})
        self.assertEqual(rn.summary("2026.9.16", d), "Remote connections.")

    def test_chinese_is_refused(self):
        for text in ["新增远程连接。", "Settings → Connection（设置）", "Remote connections，"]:
            d = notes_dir(self, {"2026.9.16.md": f"Upgrade note.\n\n{text}\n"})
            with self.assertRaises(rn.NotesError, msg=text) as e:
                rn.summary("2026.9.16", d)
            self.assertIn("第 3 行", str(e.exception))

    def test_a_top_level_heading_is_refused(self):
        d = notes_dir(self, {"2026.9.16.md": "# ThinkWatch Lite 2026.9.16\n\nText.\n"})
        with self.assertRaises(rn.NotesError):
            rn.summary("2026.9.16", d)
        # 二级标题可以
        d = notes_dir(self, {"2026.9.16.md": "## Upgrade note\n\nText.\n"})
        self.assertEqual(rn.summary("2026.9.16", d), "## Upgrade note\n\nText.")

    def test_an_empty_file_is_refused(self):
        with self.assertRaises(rn.NotesError):
            rn.summary("2026.9.16", notes_dir(self, {"2026.9.16.md": " \n\n"}))


class Committed(unittest.TestCase):
    def test_every_file_in_release_notes_renders(self):
        for path in sorted(rn.NOTES_DIR.glob("*")):
            with self.subTest(path.name):
                self.assertEqual(path.suffix, ".md")
                version = path.name.removesuffix(".md")
                self.assertRegex(version, rn.VERSION)
                text = rn.summary(version)
                self.assertTrue(rn.render(version, CHANGES, text).startswith(text))


class CommandLine(unittest.TestCase):
    def run_script(self, version: str) -> subprocess.CompletedProcess:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        changes = pathlib.Path(tmp.name) / "changes.md"
        changes.write_text(CHANGES, encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(HERE / "release_notes.py"), version, str(changes)],
            capture_output=True,
            text=True,
        )

    def test_writes_the_body_to_stdout(self):
        r = self.run_script("2099.1.1")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout
        self.assertTrue(out.startswith("## Downloads\n"))
        self.assertIn("ThinkWatch-Lite-2099.1.1-arm64.dmg", out)

    def test_a_bad_version_fails(self):
        r = self.run_script("v2099.1.1")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "")


if __name__ == "__main__":
    unittest.main()
