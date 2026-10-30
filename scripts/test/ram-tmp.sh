#!/bin/sh
# APFS RAM disk for test temp files. Prints one 0700 directory.
# The volume root stays mode 755: a group-writable ancestor is refused by credential checks.
# Usage: scripts/test/ram-tmp.sh <mebibytes>
#        scripts/test/ram-tmp.sh eject <volume>
set -eu

usage() {
  echo "usage: ram-tmp.sh <mebibytes> | ram-tmp.sh eject <volume>" >&2
  exit 2
}

if [ "${1:-}" = "eject" ]; then
  [ -n "${2:-}" ] || usage
  diskutil eject "$2"
  exit 0
fi

case "${1:-}" in
  ''|*[!0-9]*) usage ;;
esac
mb=$1
if [ "$mb" -lt 64 ] || [ "$mb" -gt 8192 ]; then
  echo "ram-tmp: size must be 64..8192 MiB" >&2
  exit 2
fi
if [ "$(uname -s)" != "Darwin" ]; then
  echo "ram-tmp: APFS RAM disks are macOS only" >&2
  exit 2
fi

sectors=$((mb * 2048))
dev=$(hdiutil attach -nomount "ram://$sectors")
dev=$(printf '%s' "$dev" | tr -d '[:space:]')
name="relay-ram-tmp-$$"
if ! diskutil erasevolume APFS "$name" "$dev" >/dev/null; then
  hdiutil detach "$dev" >/dev/null || true
  exit 1
fi
mount="/Volumes/$name"
chmod 755 "$mount"
dir="$mount/tmp"
mkdir -m 0700 "$dir"
printf '%s\n' "$dir"
