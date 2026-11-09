#!/usr/bin/env python3
"""Release download regressions; no network or real credentials required."""

import contextlib
import hashlib
import io
import os
import pathlib
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import fetch_linux_bundle_tools
import github_download
import install_nextest


def downloaded(command, **_kwargs):
    path = pathlib.Path(command[command.index("--output") + 1])
    path.write_bytes(b"complete artifact")
    return subprocess.CompletedProcess(command, 0, stderr=b"")


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = pathlib.Path(self.temporary.name)
        self.output = self.directory / "artifact"
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def run_download(self, **kwargs):
        github_download.download("owner/project", "v1.2.3", "binary.sha256", self.output, **kwargs)

    @patch("github_download.subprocess.run", side_effect=downloaded)
    def test_unauthenticated_local_build_uses_curl(self, run):
        self.run_download()
        self.assertEqual(self.output.read_bytes(), b"complete artifact")
        self.assertEqual(run.call_args.args[0][0], "curl")
        self.assertEqual(list(self.directory.iterdir()), [self.output])

    @patch("github_download.shutil.which", return_value="/usr/bin/gh")
    @patch("github_download.subprocess.run", side_effect=downloaded)
    def test_ci_uses_authenticated_asset_api_without_echoing_token(self, run, _which):
        os.environ["GH_TOKEN"] = "test-token-never-log"
        os.environ["GH_DEBUG"] = "api"
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            self.run_download()
        self.assertEqual(run.call_args.args[0][0:3], ["gh", "release", "download"])
        self.assertNotIn("test-token-never-log", str(run.call_args.args))
        self.assertNotIn("test-token-never-log", captured.getvalue())
        self.assertEqual(run.call_args.kwargs["env"]["GH_DEBUG"], "")

    @patch("github_download.time.sleep")
    @patch("github_download.subprocess.run")
    def test_partial_failure_is_retried_before_replacing_existing_file(self, run, sleep):
        self.output.write_bytes(b"old artifact")

        def attempt(command, **kwargs):
            if run.call_count == 1:
                pathlib.Path(command[command.index("--output") + 1]).write_bytes(b"partial")
                self.assertEqual(self.output.read_bytes(), b"old artifact")
                return subprocess.CompletedProcess(command, 22, stderr=b"HTTP 504")
            return downloaded(command, **kwargs)

        run.side_effect = attempt
        with contextlib.redirect_stdout(io.StringIO()):
            self.run_download()
        self.assertEqual(run.call_count, 2)
        self.assertEqual(self.output.read_bytes(), b"complete artifact")
        sleep.assert_called_once_with(2)

    @patch("github_download.time.sleep")
    @patch("github_download.subprocess.run")
    def test_exhausted_retries_preserve_previous_artifact_and_clean_partial_files(self, run, sleep):
        self.output.write_bytes(b"old artifact")
        run.return_value = subprocess.CompletedProcess([], 22, stderr=b"HTTP 504")
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
            self.run_download()
        self.assertEqual(run.call_count, 4)
        self.assertEqual(sleep.call_count, 3)
        self.assertEqual(self.output.read_bytes(), b"old artifact")
        self.assertEqual(list(self.directory.iterdir()), [self.output])

    @patch("github_download.time.sleep")
    @patch("github_download.subprocess.run")
    def test_empty_success_is_rejected(self, run, _sleep):
        run.return_value = subprocess.CompletedProcess([], 0, stderr=b"")
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
            self.run_download(attempts=2)
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.directory.iterdir()), [])

    @patch("github_download.time.sleep")
    @patch("github_download.subprocess.run", side_effect=subprocess.TimeoutExpired("download", 180))
    def test_timeout_is_bounded_and_cleaned_up(self, run, _sleep):
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
            self.run_download(attempts=2)
        self.assertEqual(run.call_count, 2)
        self.assertEqual(list(self.directory.iterdir()), [])

    @patch("github_download.subprocess.run")
    def test_glob_and_path_asset_names_are_rejected_before_downloading(self, run):
        for name in ("../binary", "binary*", "binary?", "[binary]", "binary/other"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                github_download.download("owner/project", "v1", name, self.output)
        run.assert_not_called()

    @patch("github_download.shutil.which", return_value="/usr/bin/gh")
    @patch("github_download.subprocess.run")
    def test_failed_authenticated_request_does_not_log_private_diagnostics(self, run, _which):
        os.environ["GITHUB_TOKEN"] = "test-token-never-log"
        run.return_value = subprocess.CompletedProcess([], 1, stderr=b"HTTP 401 test-token-never-log")
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured), self.assertRaises(RuntimeError):
            self.run_download(attempts=1)
        self.assertNotIn("test-token-never-log", captured.getvalue())
        self.assertIn("HTTP 401", captured.getvalue())
        self.assertEqual(run.call_args.args[0][0], "gh")


class LinuxToolTests(unittest.TestCase):
    def test_tools_match_tauri_cache_names_for_both_architectures(self):
        for arch in ("x86_64", "aarch64"):
            with self.subTest(arch=arch), tempfile.TemporaryDirectory() as temporary:
                def fake_download(_repo, _tag, _asset, output):
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_bytes(b"tool")

                with patch("fetch_linux_bundle_tools.download", side_effect=fake_download) as download:
                    fetch_linux_bundle_tools.prepare(arch, temporary, "tauri-cli 2.12.1")
                root = pathlib.Path(temporary)
                self.assertEqual({p.name for p in root.iterdir()}, {
                    f"AppRun-{arch}", f"linuxdeploy-07333c6-{arch}.AppImage",
                    f"runtime-{arch}", "linuxdeploy-plugin-appimage.AppImage",
                })
                self.assertEqual(download.call_count, 4)
                self.assertTrue(all(p.stat().st_mode & 0o100 for p in root.iterdir()))

    @patch("fetch_linux_bundle_tools.download")
    def test_cli_upgrade_requires_reviewing_tool_mapping(self, download):
        with self.assertRaises(ValueError):
            fetch_linux_bundle_tools.prepare("aarch64", "/unused", "tauri-cli 2.13.0")
        download.assert_not_called()

    def test_optional_plugin_failure_keeps_required_tools_available(self):
        with tempfile.TemporaryDirectory() as temporary:
            def fake_download(_repo, _tag, asset, output):
                if asset.startswith("linuxdeploy-plugin-appimage-"):
                    raise RuntimeError("download unavailable")
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(b"tool")

            with patch("fetch_linux_bundle_tools.download", side_effect=fake_download), \
                    contextlib.redirect_stdout(io.StringIO()):
                fetch_linux_bundle_tools.prepare("aarch64", temporary, "tauri-cli 2.12.1")
            self.assertEqual(len(list(pathlib.Path(temporary).iterdir())), 3)


class NextestTests(unittest.TestCase):
    @staticmethod
    def archive(symlink=False):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz") as archive:
            binary = tarfile.TarInfo("cargo-nextest")
            if symlink:
                binary.type = tarfile.SYMTYPE
                binary.linkname = "../outside"
                archive.addfile(binary)
            else:
                binary.size = 4
                archive.addfile(binary, io.BytesIO(b"tool"))
            unrelated = tarfile.TarInfo("../outside")
            unrelated.size = 3
            archive.addfile(unrelated, io.BytesIO(b"bad"))
        return output.getvalue()

    def run_install(self, root, data, digest=None):
        pins = {"version": "0.9.146", "sha256": {"test": digest or hashlib.sha256(data).hexdigest()}}

        def fake_download(_repo, _tag, _asset, output):
            output.write_bytes(data)

        with patch("install_nextest.download", side_effect=fake_download), \
                patch("install_nextest.json.loads", return_value=pins):
            return install_nextest.install("test", root)

    def test_verified_archive_extracts_only_named_regular_executable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "nextest"
            self.run_install(root, self.archive())
            self.assertEqual(list(root.iterdir()), [root / "cargo-nextest"])
            self.assertEqual((root / "cargo-nextest").read_bytes(), b"tool")
            self.assertFalse((pathlib.Path(temporary) / "outside").exists())

    def test_checksum_failure_preserves_existing_test_runner(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / "cargo-nextest").write_bytes(b"old")
            with self.assertRaisesRegex(RuntimeError, "SHA-256 mismatch"):
                self.run_install(root, self.archive(), "0" * 64)
            self.assertEqual((root / "cargo-nextest").read_bytes(), b"old")
            self.assertEqual(list(root.iterdir()), [root / "cargo-nextest"])

    def test_executable_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary) / "nextest"
            with self.assertRaisesRegex(RuntimeError, "regular executable"):
                self.run_install(root, self.archive(symlink=True))
            self.assertEqual(list(root.iterdir()), [])
            self.assertFalse((pathlib.Path(temporary) / "outside").exists())


if __name__ == "__main__":
    unittest.main()
