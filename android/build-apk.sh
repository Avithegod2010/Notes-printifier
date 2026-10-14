#!/usr/bin/env bash
# build-apk.sh — packages the static export (.next-static) into a signed APK.
# Requires the Android build-tools (34.0.0) + platforms;android-34 + ecj.jar.
# Locations can be overridden: ANDROID_SDK=… ECJ_JAR=… bash android/build-apk.sh beta
#
# Signing: the keystore (android/printifier.keystore) and its password are NOT
# stored in this repo. The password is read from (in order of precedence):
#   1. $KS_PASS in the environment
#   2. android/signing.local  (gitignored — create it with one line: KS_PASS=…)
# If the keystore does not exist yet it will be generated on first build using
# $KS_PASS. Losing the keystore means users must uninstall/reinstall to update.
#
# Channels:
#   bash android/build-apk.sh beta   → public/printifier.apk        (rolling dev channel;
#                                      versionCode/Name via BETA_VERSION_CODE / BETA_VERSION_NAME,
#                                      defaults 5 / 1.3.1-beta — bump when rebuilding)
#   bash android/build-apk.sh stable → public/printifier-stable.apk (cut from the `stable`
#                                      branch only; keep BETA_* unset so manifest versions apply)
set -euo pipefail

CHANNEL="${1:-beta}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AND=$ROOT/android
SDK="${ANDROID_SDK:-/home/z/android-sdk}"
BT=$SDK/build-tools/34.0.0
PLAT=$SDK/platforms/android-34/android.jar
ECJ="${ECJ_JAR:-/home/z/tools/ecj.jar}"
KS=$AND/printifier.keystore

# ── resolve the signing password (never hardcode it here) ────
KS_PASS="${KS_PASS:-}"
if [ -z "$KS_PASS" ] && [ -f "$AND/signing.local" ]; then
  # shellcheck disable=SC1090
  . "$AND/signing.local"
fi
need_pass() {
  if [ -z "${KS_PASS:-}" ]; then
    echo "ERROR: keystore password not found." >&2
    echo "  → create android/signing.local with one line:  KS_PASS=your-password" >&2
    echo "  → or export KS_PASS before running this script." >&2
    exit 1
  fi
}

EXTRA_LINK=()
if [ "$CHANNEL" = "beta" ]; then
  BETA_VERSION_CODE="${BETA_VERSION_CODE:-5}"
  BETA_VERSION_NAME="${BETA_VERSION_NAME:-1.3.1-beta}"
  EXTRA_LINK=(--version-code "$BETA_VERSION_CODE" --version-name "$BETA_VERSION_NAME" --replace-version)
  OUT_APK="$ROOT/public/printifier.apk"
else
  OUT_APK="$ROOT/public/printifier-stable.apk"
fi

echo "── staging web assets"
rm -rf "$AND/build"
mkdir -p "$AND/build/gen" "$AND/build/obj" "$AND/build/assets/www"
cp -r "$ROOT/.next-static/." "$AND/build/assets/www/"
(
  cd "$AND/build/assets/www"
  # RSC payload files, error pages and the service worker are not needed in
  # the offline app (SW registration failing silently is already handled).
  rm -f index.txt 404.html robots.txt sw.js
  rm -rf _not-found _not-found.html
  find . -maxdepth 1 -name '*.txt' -delete
  rm -f printifier*.apk *.idsig  # never embed the APKs (or their signatures) inside themselves
)
echo "   assets: $(du -sh "$AND/build/assets/www" | cut -f1)"

echo "── aapt2 compile + link"
"$BT/aapt2" compile --dir "$AND/res" -o "$AND/build/res.zip"
"$BT/aapt2" link -o "$AND/build/base.apk" -I "$PLAT" \
  --manifest "$AND/AndroidManifest.xml" -R "$AND/build/res.zip" \
  --java "$AND/build/gen" --auto-add-overlay "${EXTRA_LINK[@]}"

echo "── compiling java (ecj)"
java -jar "$ECJ" -source 1.8 -target 1.8 -nowarn \
  -cp "$PLAT" -d "$AND/build/obj" \
  "$AND/build/gen/com/notesprintifier/app/R.java" \
  "$AND"/src/com/notesprintifier/app/*.java 2>&1 | rg -v "WARNING" || true

echo "── dex (d8)"
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --release --lib "$PLAT" \
  --min-api 24 --output "$AND/build" \
  $(find "$AND/build/obj" -name '*.class')

echo "── packaging"
cp "$AND/build/base.apk" "$AND/build/unsigned.apk"
(cd "$AND/build" && zip -q -r unsigned.apk assets && zip -q -j unsigned.apk classes.dex)

echo "── zipalign"
"$BT/zipalign" -f -p 4 "$AND/build/unsigned.apk" "$AND/build/aligned.apk"

if [ ! -f "$KS" ]; then
  need_pass
  echo "── generating signing key"
  keytool -genkeypair -keystore "$KS" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias printifier -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=Notes Printifier, OU=Apps, O=NotesPrintifier, C=IN"
fi
need_pass

echo "── signing → ${OUT_APK#$ROOT/}"
java -cp "$BT/lib/apksigner.jar" com.android.apksigner.ApkSignerTool sign \
  --ks "$KS" --ks-pass "pass:$KS_PASS" --ks-key-alias printifier \
  --out "$OUT_APK" "$AND/build/aligned.apk"

echo "── verify"
java -cp "$BT/lib/apksigner.jar" com.android.apksigner.ApkSignerTool verify --print-certs "$OUT_APK" | head -4
"$BT/aapt" dump badging "$OUT_APK" | head -6
ls -la "$OUT_APK"
echo "DONE ($CHANNEL channel)"
