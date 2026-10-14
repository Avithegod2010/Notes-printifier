/**
 * "Share → Notes Printifier" — web-side receiver.
 *
 * The Android APK (MainActivity) stages a PDF shared into the app at
 * /__shared.pdf and calls window.__npConsumeShared() once the page is up.
 * This module installs that hook: it fetches the staged file and hands it
 * to the caller as a File, ready for the ingestion pipeline.
 *
 * Plain client module — no React, no server-only imports. Safe to import
 * from any client component or hook.
 */

declare global {
  interface Window {
    /** Installed by installSharedPdfReceiver; nudged by MainActivity. */
    __npConsumeShared?: () => void;
    /** Guard flag so double installs don't clobber an existing receiver. */
    __npSharedReceiverInstalled?: boolean;
  }
}

/**
 * Installs the Android hook. The APK's MainActivity calls
 * window.__npConsumeShared() when a PDF was shared into the app.
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

  window.__npConsumeShared = async () => {
    try {
      // ?ts= busts any cached miss from before the file was staged.
      const res = await fetch('/__shared.pdf?ts=' + Date.now());
      if (!res.ok) return;
      const blob = await res.blob();
      const file = new File([blob], 'shared.pdf', { type: 'application/pdf' });
      onPdf(file);
    } catch {
      // Silent — nothing staged (e.g. plain web build) or fetch failed.
    }
  };

  return () => {
    delete window.__npConsumeShared;
    window.__npSharedReceiverInstalled = false;
  };
}
