# Task 17-f — Share → Notes Printifier (Android share-sheet + open-with)

Agent: share-receiver
Status: DONE

## Files changed/created (only these)

| File | Change |
|---|---|
| `android/AndroidManifest.xml` | MODIFIED — `android:launchMode="singleTask"` on `.MainActivity`; two new intent-filters (ACTION_SEND + DEFAULT + mimeType `application/pdf`; ACTION_VIEW + DEFAULT + scheme `content` + mimeType `application/pdf`). versionCode/versionName untouched. |
| `android/src/com/notesprintifier/app/MainActivity.java` | MODIFIED — share-intent receiving, staging + serving of the shared PDF, web nudging. All prior behavior (bridge, chooser, external links, INJECT_JS) intact. |
| `src/lib/shared-file.ts` | NEW — `installSharedPdfReceiver(onPdf): () => void` + `window.__npConsumeShared` hook. |
| `src/hooks/use-shared-pdf.ts` | NEW — `useSharedPdf(onPdf)` hook (install/uninstall in effect). |

Nothing else touched (no i18n, no store, no printifier components, no package.json/bun.lock, no APK rebuild).

## Integration contract for the wiring agent (owner of printifier-app.tsx)

- Call `useSharedPdf(onPdf)` where `onPdf: (file: File) => void` — the file arrives as
  `new File([blob], 'shared.pdf', { type: 'application/pdf' })`. Typical wiring:
  `useSharedPdf((file) => { void usePrintifyStore.getState().addFiles([file]); })`.
- The hook installs the receiver ONCE per mount (ref-stable callback — inline arrows are fine,
  no re-install churn) and uninstalls on unmount. Double install is guarded by a window flag
  (`window.__npSharedReceiverInstalled`); StrictMode mount→cleanup→mount sequences are safe.
- On plain web (no APK) the hook is inert: `/__shared.pdf` simply 404s and the receiver stays silent.

## Android-side behavior implemented (MainActivity)

- `onCreate`: after webView setup (regardless of savedInstanceState) → `handleIntent(getIntent())`.
- `onNewIntent`: `super.onNewIntent(intent); setIntent(intent); handleIntent(intent);`
  (fires thanks to `singleTask` when the task is re-launched from a share/open-with).
- `handleIntent(Intent)`: ACTION_SEND → `EXTRA_STREAM` Uri; ACTION_VIEW → `intent.getData()`.
  Copies the content stream to `cacheDir/shared.pdf` (8 KiB buffered, streams closed in
  finally). Success → `sharedFile = dest; pendingShared = true; maybeConsumeShared();`.
  Whole body wrapped in try/catch → failure toasts "Could not open that PDF" via `runOnUiThread`.
- `maybeConsumeShared()`: if `pendingShared && webView != null` → on UI thread evaluates the
  pinned nudge `if(window.__npConsumeShared){window.__npConsumeShared();}` (inner guards
  re-checked inside the runnable).
- `shouldInterceptRequest`: BEFORE the assets branch, `GET /__shared.pdf` with
  `sharedFile != null && sharedFile.exists()` returns
  `WebResourceResponse("application/pdf", null, FileInputStream(sharedFile))` with headers
  `Access-Control-Allow-Origin: *` (same as asset branch) + `Cache-Control: no-store`.
- `onPageFinished`: after `evaluateJavascript(INJECT_JS…)` → `maybeConsumeShared()`.
- New fields: `private boolean pendingShared;` `private File sharedFile;`
- New imports: `java.io.File`, `java.io.FileInputStream`, `java.io.FileOutputStream`
  (plain `android.*`/`java.*` only — no androidx; `getParcelableExtra` cast kept for
  minSdk 24, deprecated-but-fine on 33+, build compiles with `-nowarn`).

## Verification results

- `bun run lint` → **0 errors, 7 warnings** (the pre-existing baseline; none from my files).
- `bunx tsc --noEmit` → **zero diagnostics referencing shared-file.ts / use-shared-pdf.ts**
  (remaining errors are pre-existing in preview-dialog.tsx, compose-worker.ts, compose.ts, pdfjs.ts).
- AndroidManifest.xml → well-formed (python minidom parse OK).
- **Java actually compiled**: `ecj -source 1.8 -target 1.8 -cp android-34/android.jar` over
  MainActivity.java + DownloadBridge.java → **exit 0** (syntax/type check only, to /tmp;
  no APK was built or signed).

## Known limitation (flagged to orchestrator, out of my file scope)

Cold-start share race: on a cold start opened via a share intent, Android nudges
`__npConsumeShared` at `onPageFinished`; if React hydration has not yet installed the hook,
that nudge is a silent no-op (`pendingShared` stays true and a later page load/reload
re-nudges). While-the-app-is-running shares (the common case via `singleTask` + `onNewIntent`)
always work. If cold-start misses show up in testing, the fix is a receipt-based bounded
retry in `maybeConsumeShared` (evaluateJavascript result callback) — deliberately NOT added
because the task pinned the exact nudge string with a `null` callback.
