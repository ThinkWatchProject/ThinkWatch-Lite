#!/usr/bin/env python3
"""Prepare the tools used by the locked Tauri CLI before compiling Linux."""

import argparse
import pathlib

from github_download import download


def prepare(arch, directory, cli_version):
    # crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy.rs at
    # tauri-cli-v2.12.1 defines these URLs and cache names. Fail early when
    # upgrading the CLI so a stale cache mapping cannot silently be reused.
    if cli_version.strip() != "tauri-cli 2.12.1":
        raise ValueError("update Linux bundle tool mappings for this Tauri CLI version")
    if arch not in ("x86_64", "aarch64"):
        raise ValueError("unsupported Linux architecture")
    directory = pathlib.Path(directory)
    tools = [
        ("tauri-apps/binary-releases", "apprun-old", f"AppRun-{arch}", f"AppRun-{arch}"),
        ("tauri-apps/binary-releases", "linuxdeploy-07333c6",
         f"linuxdeploy-{arch}.AppImage", f"linuxdeploy-07333c6-{arch}.AppImage"),
        ("linuxdeploy/linuxdeploy-plugin-appimage", "continuous",
         f"linuxdeploy-plugin-appimage-{arch}.AppImage", "linuxdeploy-plugin-appimage.AppImage"),
    ]
    for repo, tag, asset, name in tools:
        path = directory / name
        try:
            download(repo, tag, asset, path)
        except RuntimeError:
            if name != "linuxdeploy-plugin-appimage.AppImage":
                raise
            # Tauri treats this plugin as optional too: the pinned linuxdeploy
            # contains its own output plugin and can finish without this copy.
            print("Optional AppImage plugin unavailable; retaining linuxdeploy's built-in fallback.",
                  flush=True)
            continue
        path.chmod(0o770)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("arch", choices=("x86_64", "aarch64"))
    parser.add_argument("directory", type=pathlib.Path)
    parser.add_argument("--cli-version", required=True)
    args = parser.parse_args()
    prepare(args.arch, args.directory, args.cli_version)


if __name__ == "__main__":
    main()
