#!/usr/bin/env bash
# static-export.sh — build the fully static site into .next-static/.
#
# The API routes (src/app/api) only exist on a live server, so they are moved
# aside for the export and restored afterwards (even on failure). The result
# is what android/build-apk.sh packages into the offline APK.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/src/app/api"
STASH="$(mktemp -d)"

restore() {
  if [ -d "$STASH/api" ] && [ ! -d "$API_DIR" ]; then
    mv "$STASH/api" "$API_DIR"
  fi
  rm -rf "$STASH"
}
trap restore EXIT

if [ -d "$API_DIR" ]; then
  echo "── moving API routes aside (not part of the static export)"
  mv "$API_DIR" "$STASH/api"
fi

cd "$ROOT"
echo "── STATIC_EXPORT=1 next build"
STATIC_EXPORT=1 bun x next build

echo "── done: $ROOT/.next-static"
