#!/usr/bin/env bash
# static-export.sh — build the fully static site into .next-static/.
#
# The API routes (src/app/api) only exist on a live server, so they are moved
# aside for the export and restored afterwards. Hardened against the ways the
# old implementation could strand the tree:
#   - the stash lives INSIDE the repo (same filesystem → atomic mv, visible,
#     recoverable) instead of a throwaway /tmp dir;
#   - a previous crashed run (SIGKILL, dead shell) is recovered on start;
#   - a lock prevents two concurrent builds from racing the mv;
#   - restore runs on EXIT *and* on INT/TERM/HUP;
#   - NEXT_PUBLIC_STATIC=1 is set HERE so EVERY consumer of this script
#     (GitHub Pages workflow, APK release workflow, smoke build, local runs)
#     compiles server-only features out — not just whichever workflow
#     remembered to export it.
# The result is what android/build-apk.sh packages into the offline APK.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/src/app/api"
STASH="$ROOT/.next-static-api-stash"
LOCK="$ROOT/.next-static-build.lock"

restore() {
  if [ -d "$STASH/api" ] && [ ! -d "$API_DIR" ]; then
    mv "$STASH/api" "$API_DIR"
  fi
  rm -rf "$STASH"
  rmdir "$LOCK" 2>/dev/null || true
}

# Recover from a crashed previous run BEFORE taking the lock: if the API dir
# is missing but the stash has it, put it back (the previous build died
# between the mv and the restore).
if [ ! -d "$API_DIR" ] && [ -d "$STASH/api" ]; then
  echo "── recovering API routes stranded by a crashed build"
  restore
fi

# One export at a time — two concurrent builds would race the api/ mv.
if ! mkdir "$LOCK" 2>/dev/null; then
  # Steal a stale lock (crashed run without cleanup) older than 30 minutes.
  if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
    echo "── stealing stale build lock"
    rmdir "$LOCK" 2>/dev/null || rm -rf "$LOCK"
    mkdir "$LOCK"
  else
    echo "ERROR: another static export seems to be running (found $LOCK)." >&2
    echo "If that is wrong, remove the directory and retry." >&2
    exit 1
  fi
fi
# EXIT fires on normal end AND after INT/TERM handlers exit the script.
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

if [ -d "$API_DIR" ]; then
  echo "── moving API routes aside (not part of the static export)"
  mkdir -p "$STASH"
  mv "$API_DIR" "$STASH/api"
fi

cd "$ROOT"

# Compile server-only features OUT of the client bundle (HAS_SERVER_API).
# Both flags are needed: STATIC_EXPORT switches next.config to output:"export",
# NEXT_PUBLIC_STATIC is inlined into client code and DCEs the /api calls.
export STATIC_EXPORT=1
export NEXT_PUBLIC_STATIC=1

echo "── next build (static export)"
if command -v bun >/dev/null 2>&1; then
  bun x next build
else
  # README promises node+npm works too.
  npx --yes next build
fi

echo "── checking the static output contains no /api calls"
# HAS_SERVER_API is false in this build, so every guarded fetch('/api/…')
# call site is dead-code-eliminated. Any survivor means the static site
# ships a request that can only fail (GitHub Pages / APK have no server).
if grep -rqE '/api/(prints|presets|cloud-import|ai/)' .next-static/_next/static 2>/dev/null; then
  echo "ERROR: static bundle still references /api/ endpoints:" >&2
  grep -rlE '/api/(prints|presets|cloud-import|ai/)' .next-static/_next/static | head -5 >&2
  exit 1
fi

echo "── done: $ROOT/.next-static"
