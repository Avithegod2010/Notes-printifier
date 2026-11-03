/**
 * "Share → Notes Printifier" — web-side receiver.
 *
 * The Android APK (MainActivity) stages a PDF shared into the app at
 * /__shared.pdf and calls window.__npConsumeShared(token) once the page is
 * up. The token is a fresh id MainActivity generates every time it stages a
 * file, so the receiver can tell a repeat nudge for an already handled share
 * apart from a nudge for a newly shared one.
 *
 * This module installs that hook: it fetches the staged file and hands it
 * to the caller as a File, ready for the ingestion pipeline. The hook stays
 * armed for the whole page lifetime — after each successful consume it is
 * immediately ready for the NEXT share, so sharing into the already-running
 * app keeps working (it is no longer deleted after the first file).
 *
 * Plain client module — no React, no server-only imports. Safe to import
 * from any client component or hook.
 */

declare global {
  interface Window {
    /** Installed by installSharedPdfReceiver; nudged by MainActivity with a per-file token. */
    __npConsumeShared?: (token?: string) => void;
    /** Guard flag so double installs don't clobber an existing receiver. */
    __npSharedReceiverInstalled?: boolean;
  }
}

/**
 * Installs the Android hook. The APK's MainActivity calls
 * window.__npConsumeShared(token) when a PDF was shared into the app.
 *
 * Returns a cleanup function that deletes the hook again (safe to call
 * from a React effect cleanup). Calling install twice without cleaning up
 * in between is a no-op that keeps the first receiver in charge.
 */
export function installSharedPdfReceiver(onPdf: (file: File) => void): () => void {
  if (typeof window === 'undefined') {
    // SSR / non-browser safety — nothing to install, nothing to clean up.
    return () => undefined;
  }

  if (window.__npSharedReceiverInstalled) {
    // Already installed (e.g. double effect invocation without cleanup) —
    // keep the existing receiver; this instance owns no hook to remove.
    return () => undefined;
  }

  window.__npSharedReceiverInstalled = true;

  let inFlight = false;
  // Token of the share that was last handed to the app. Repeat nudges for
  // the same staged file (nudge retries, onPageFinished) carry the same
  // token and are ignored — this replaces the old one-shot "delete the
  // hook" guard while still preventing the same PDF from being ingested
  // twice. The hook itself is never unset after a success, so the next
  // share (fresh token from MainActivity) is picked up too.
  let lastConsumedToken: string | null = null;

  // Self re-arming hook: nothing here makes it dead after a consume —
  // each call with a new token fetches whatever MainActivity staged last.
  window.__npConsumeShared = async (token?: string) => {
    if (token != null && token === lastConsumedToken) return; // already handled
    if (inFlight) return;
    inFlight = true;
    try {
      // ?ts= busts any cached miss from before the file was staged.
      const res = await fetch('/__shared.pdf?ts=' + Date.now());
      if (res.ok) {
        const blob = await res.blob();
        // Token-less nudges (defensive, e.g. an older MainActivity):
        // dedupe them with a sentinel so a stray repeat nudge can't
        // ingest the same file twice either.
        lastConsumedToken = token ?? 'consumed';
        onPdf(new File([blob], 'shared.pdf', { type: 'application/pdf' }));
      }
    } catch {
      // Silent — nothing staged (e.g. plain web build) or fetch failed.
      // The hook stays armed so the next nudge can retry.
    } finally {
      inFlight = false;
    }
  };

  return () => {
    delete window.__npConsumeShared;
    window.__npSharedReceiverInstalled = false;
  };
}
