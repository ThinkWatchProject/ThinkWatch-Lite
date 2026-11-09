#!/usr/bin/env python3
"""Install the pinned CI test runner through the authenticated asset API."""

import argparse
import hashlib
import json
import os
import pathlib
import tarfile
import tempfile

from github_download import download


def install(target, directory):
    pins = json.loads(pathlib.Path(__file__).with_name("nextest-checksums.json").read_text())
    expected = pins["sha256"][target]
    version = pins["version"]
    directory = pathlib.Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    binary = "cargo-nextest.exe" if "windows" in target else "cargo-nextest"
    with tempfile.TemporaryDirectory(prefix="nextest-", dir=directory) as temporary:
        archive = pathlib.Path(temporary) / "nextest.tar.gz"
        download("nextest-rs/nextest", f"cargo-nextest-{version}",
                 f"cargo-nextest-{version}-{target}.tar.gz", archive)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
            raise RuntimeError("nextest archive SHA-256 mismatch")
        with tarfile.open(archive, "r:gz") as bundle:
            member = bundle.getmember(binary)
            if not member.isfile():
                raise RuntimeError("nextest archive does not contain a regular executable")
            # Read only the named binary: never extract arbitrary archive paths.
            with bundle.extractfile(member) as source:
                executable = source.read()
        staged = pathlib.Path(temporary) / binary
        staged.write_bytes(executable)
        staged.chmod(0o755)
        os.replace(staged, directory / binary)
    return directory.resolve()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target")
    parser.add_argument("directory", type=pathlib.Path)
    args = parser.parse_args()
    directory = install(args.target, args.directory)
    if os.environ.get("GITHUB_PATH"):
        with open(os.environ["GITHUB_PATH"], "a", encoding="utf-8") as paths:
            paths.write(str(directory) + "\n")
    print(f"Installed checksum-verified nextest in {directory}")


if __name__ == "__main__":
    main()
