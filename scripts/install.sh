#!/bin/sh
# Installs ThinkWatch Lite on Linux: downloads the AppImage for this machine's
# architecture, checks its SHA-256, puts it at ~/Applications/ThinkWatch-Lite.AppImage
# and starts it. Running it again installs the latest version over the old one.
#
#   curl -fsSL https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest/download/install.sh | sh
#
# Needs curl (or wget) and sha256sum. The app then updates itself in place.
#
# THINKWATCH_INSTALL_BASE (for testing only): where latest.json is read from,
# instead of the latest GitHub release.

set -eu

BASE=${THINKWATCH_INSTALL_BASE:-https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest/download}
DEST_DIR="${HOME:?HOME is not set}/Applications"
DEST="$DEST_DIR/ThinkWatch-Lite.AppImage"

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || die "this script installs the Linux version. Downloads for other systems: https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest"

case "$(uname -m)" in
  x86_64 | amd64) ARCH=x86_64 ;;
  aarch64 | arm64) ARCH=aarch64 ;;
  *) die "ThinkWatch Lite is available for x86_64 and aarch64 only; this machine is $(uname -m)." ;;
esac

if command -v curl > /dev/null 2>&1; then
  fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }
elif command -v wget > /dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  die "curl or wget is required."
fi
command -v sha256sum > /dev/null 2>&1 || die "sha256sum is required (package coreutils)."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

say "Reading the latest release..."
fetch "$BASE/latest.json" "$TMP/latest.json" || die "could not download $BASE/latest.json"

# Every "url" value in the manifest, one per line, then the AppImage for this
# architecture. A JSON string cannot contain a raw quote or newline, so a
# "url": "..." pair is always on one line and the value ends at the next quote.
URL=$(grep -o '"url"[[:space:]]*:[[:space:]]*"[^"]*"' "$TMP/latest.json" \
  | sed -e 's/^"url"[[:space:]]*:[[:space:]]*"//' -e 's/"$//' -e 's#\\/#/#g' \
  | grep -- "-$ARCH\.AppImage\$" || true)
[ -n "$URL" ] || die "the latest release has no AppImage for $ARCH."
[ "$(printf '%s\n' "$URL" | wc -l)" -eq 1 ] || die "the latest release lists more than one AppImage for $ARCH."

NAME=${URL##*/}
say "Downloading $NAME..."
fetch "$URL" "$TMP/$NAME" || die "could not download $URL"
fetch "$URL.sha256" "$TMP/$NAME.sha256" || die "could not download $URL.sha256"

# The .sha256 file is "<hash>  <file name>", so check it next to the download
(cd "$TMP" && sha256sum -c "$NAME.sha256" > /dev/null 2>&1) \
  || die "the SHA-256 checksum of $NAME does not match. Nothing was installed."

mkdir -p "$DEST_DIR"
chmod +x "$TMP/$NAME"
# Rename into place: a running copy keeps its file, the next start is the new one
mv -f "$TMP/$NAME" "$DEST"
say "Installed $DEST"

# The AppImage mounts itself with FUSE; the fusermount helper comes from fuse3
if [ "${APPIMAGE_EXTRACT_AND_RUN:-}" != 1 ] \
  && ! command -v fusermount3 > /dev/null 2>&1 \
  && ! command -v fusermount > /dev/null 2>&1; then
  say ""
  say "ThinkWatch Lite needs FUSE to start. Install the fuse3 package, then run $DEST:"
  say "  Debian, Ubuntu:  sudo apt install fuse3"
  say "  Fedora:          sudo dnf install fuse3"
  say "  Arch Linux:      sudo pacman -S fuse3"
  say "  openSUSE:        sudo zypper install fuse3"
  exit 0
fi

if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
  say "No graphical session was found. To start ThinkWatch Lite, run $DEST from a desktop session."
  exit 0
fi

if command -v pgrep > /dev/null 2>&1 && pgrep -x thinkwatch-lite > /dev/null 2>&1; then
  say "ThinkWatch Lite is already running. Quit it from the tray menu and start it again to use the new version."
  exit 0
fi

# Detached from this shell, so closing the terminal does not stop the app. After
# the first start it is also in the application menu.
nohup "$DEST" > /dev/null 2>&1 &
say "ThinkWatch Lite is starting. It is also in the application menu from now on."
