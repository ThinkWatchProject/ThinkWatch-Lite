#!/usr/bin/env python3
"""Download a GitHub release asset atomically, with bounded retries.

CI uses gh's authenticated asset API instead of the anonymous download route.
Local builds without a GitHub token keep using curl. Callers still verify the
downloaded artifact before executing or packaging it.
"""

import argparse
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import time
import urllib.parse


def download(repo, tag, asset, output, attempts=4, timeout=180):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("expected owner/repository")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/+~-]*", tag):
        raise ValueError("invalid release tag")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+ -]*", asset):
        raise ValueError("expected a literal release asset name")
    output = pathlib.Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    authenticated = bool(os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN"))
    if authenticated and not shutil.which("gh"):
        raise RuntimeError("authenticated release downloads require GitHub CLI (gh)")
    fd, temporary = tempfile.mkstemp(prefix=output.name + ".download-", dir=output.parent)
    os.close(fd)
    temporary = pathlib.Path(temporary)
    try:
        if authenticated:
            command = ["gh", "release", "download", tag, "--repo", repo,
                       "--pattern", asset, "--output", str(temporary), "--clobber"]
        else:
            url = (f"https://github.com/{repo}/releases/download/"
                   f"{urllib.parse.quote(tag, safe='')}/{urllib.parse.quote(asset, safe='')}")
            command = ["curl", "--fail", "--silent", "--show-error", "--location",
                       "--connect-timeout", "15", "--max-time", str(timeout),
                       "--output", str(temporary), url]
        environment = dict(os.environ, GH_DEBUG="", GH_PROMPT_DISABLED="1")
        for attempt in range(1, attempts + 1):
            temporary.write_bytes(b"")
            try:
                result = subprocess.run(command, stdout=subprocess.DEVNULL,
                                        stderr=subprocess.PIPE, env=environment,
                                        timeout=timeout, check=False)
                if result.returncode == 0 and temporary.stat().st_size > 0:
                    os.replace(temporary, output)
                    return
                status = f"exit {result.returncode}"
                http = re.search(rb"HTTP(?: status:)?[ /:]+([45][0-9]{2})", result.stderr)
                if http:
                    status += f", HTTP {http.group(1).decode()}"
            except subprocess.TimeoutExpired:
                status = "timeout"
            # Do not echo HTTP diagnostics: headers and URLs may contain credentials.
            print(f"Download {repo}/{tag}/{asset}: {status} ({attempt}/{attempts})", flush=True)
            if attempt < attempts:
                time.sleep(2 ** attempt)
        raise RuntimeError(f"could not download {repo}/{tag}/{asset} after {attempts} attempts")
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo")
    parser.add_argument("tag")
    parser.add_argument("asset")
    parser.add_argument("output")
    args = parser.parse_args()
    download(args.repo, args.tag, args.asset, args.output)


if __name__ == "__main__":
    main()
