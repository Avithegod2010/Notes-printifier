# Versioning & Release Strategy — Notes Printifier

The project runs **two release lines from one codebase**:

| Line | Audience | Where | Cadence |
|---|---|---|---|
| **Stable** | Beginners — "it just works, never breaks" | `stable` branch, tag `v1.0.0-stable`, `public/printifier-stable.apk` | Bugfixes only, explicit releases |
| **Dev / Beta** | You + anyone who opts in | `main` branch, `public/printifier.apk` | Continuous — new features land here first |

## The rules

1. **New/experimental features go behind Labs.** Anything risky or unfinished
   ships as a Labs switch (`src/lib/labs.ts` + `src/components/printifier/labs-popover.tsx`).
   Labs is OFF by default → beginners always see the stable experience even on `main`.
2. **Stable never moves by accident.** It only changes when YOU cut a release
   (below). The `stable` branch and the archived `printifier-stable.apk` are
   frozen artifacts.
3. **Promotion, not divergence.** When a Labs feature proves itself, flip its
   default to on, then cut a new stable release. Features move one way:
   `main → stable`.

## Cutting a new STABLE release (e.g. v1.1.0)

```bash
git checkout main                       # start from the reviewed dev state
# … final QA pass …
git checkout stable
git merge --ff-only main                # or merge selectively / cherry-pick
git tag v1.1.0-stable
# rebuild the static export + stable APK from THIS branch:
STATIC_EXPORT=1 bun x next build
bash android/build-apk.sh stable        # manifest versions = release versions
# archive it so it can never be overwritten by dev builds:
cp public/printifier-stable.apk public/releases/printifier-v1.1.0.apk
git add -A && git commit -m "Release v1.1.0-stable" && git checkout main
```

Releasing a **bugfix** to stable without taking new features:
`git checkout stable && git cherry-pick <fix-commit> …` then rebuild as above.

## Building the BETA APK (dev channel)

```bash
# after landing features on main:
STATIC_EXPORT=1 bun x next build
BETA_VERSION_CODE=3 BETA_VERSION_NAME=1.2.0-beta bash android/build-apk.sh beta
```

Always bump `BETA_VERSION_CODE` — Android refuses "updates" that don't
increase it. Same package + same signing key means installing the beta
**upgrades** the installed stable app (and vice-versa only if the versionCode
is higher).

## Static export for the APKs

`STATIC_EXPORT=1 bun x next build` produces the fully static site in
`.next-static/` (the API route is moved aside automatically is NOT needed —
the export build simply excludes `src/app/api`; run the build with the route
moved out if Next complains). The WebView serves these files locally, so the
app is 100% offline.

## When you get real hosting (Vercel / Netlify / any static host)

- Deploy the `stable` branch → the beginner-facing URL (or Play Store).
- Deploy `main` → the beta URL. Same repo, two deployments, no forks.
- The APK signing key lives at `android/printifier.keystore` — **gitignored,
  never commit it**. Its password is read from `android/signing.local`
  (also gitignored; one line: `KS_PASS=…`) or the `KS_PASS` env var.
  **Back the keystore file up somewhere safe** — losing it means users must
  uninstall/reinstall to update. For a Play Store release, generate a fresh
  upload key and never commit it publicly.

## Signing-key history

- **2026-10-14** — the original keystore was lost while rebuilding the git
  history for the first public release (it had been committed to the old,
  discarded history and was removed with it). A new key was generated with
  the same alias (`printifier`). **Already-installed APKs cannot auto-update:
  uninstall once, then install the new build.** The keystore now lives
  untracked in `android/printifier.keystore` — back it up (see above).

## Sandbox note (this environment)

The Android SDK (`/home/z/android-sdk`) and the Java compiler
(`/home/z/tools/ecj.jar`) live OUTSIDE the project folder and this sandbox
wipes them between sessions. If `build-apk.sh` fails with "No such file or
directory", re-provision in ~1 minute:

```bash
mkdir -p /home/z/android-sdk && cd /home/z/android-sdk
curl -sSL -O https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q commandlinetools-linux-11076708_latest.zip
mkdir -p cmdline-tools/latest
mv cmdline-tools/bin cmdline-tools/lib cmdline-tools/NOTICE.txt cmdline-tools/source.properties cmdline-tools/latest/
yes | cmdline-tools/latest/bin/sdkmanager --sdk_root=/home/z/android-sdk "build-tools;34.0.0" "platforms;android-34"
mkdir -p /home/z/tools && curl -sSL -o /home/z/tools/ecj.jar \
  https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/3.36.0/ecj-3.36.0.jar
```
