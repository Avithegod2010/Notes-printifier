'use client';

/**
 * use-global-keys.ts — Keyboard-first pass 2.
 *
 * Global single-key shortcuts for the whole pipeline (desktop power users):
 *   O            open the file picker (upload step)
 *   Enter        continue — advances to the next step / starts processing
 *   ← / →        step through the wizard (never into the result step —
 *                that is reachable only by actually processing)
 *   P            print the finished PDF (result step)
 *
 * Rules that keep these safe:
 *  - never fires while typing in an input / textarea / select / editor
 *  - never fires while any Radix overlay (dialog, sheet, popover, select,
 *    command palette) is open — those own the keyboard
 *  - arrows yield to the arrange grid's per-page move shortcuts (they
 *    preventDefault when a page is active)
 *  - never fires mid-processing
 */

import { useEffect } from 'react';
import { usePrintifyStore } from '@/lib/printify-store';

/** Any open Radix overlay that should own the keyboard. */
function overlayOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"], [data-radix-popper-content-wrapper], [role="menu"], [role="listbox"], [data-dropzone-open]',
    ),
  );
}

function typingInField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return Boolean(
    el.closest?.('input, textarea, select, [contenteditable]') || el.isContentEditable,
  );
}

export function useGlobalKeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.defaultPrevented) return; // a feature widget already handled it
      if (typingInField(e.target)) return;

      const s = usePrintifyStore.getState();
      const key = e.key;

      // O — open file picker (upload step only; UploadStep owns the input)
      if (key === 'o' || key === 'O') {
        if (s.step === 0 && !s.loadingDocs && !s.processing && !overlayOpen()) {
          e.preventDefault();
          window.dispatchEvent(new Event('printifier:open'));
        }
        return;
      }

      // P — print the finished PDF
      if (key === 'p' || key === 'P') {
        if (s.step === 4 && s.result && !s.processing && !overlayOpen()) {
          e.preventDefault();
          window.dispatchEvent(new Event('printifier:print'));
        }
        return;
      }

      if (overlayOpen()) return;

      // Enter — primary action ("continue") for the current step
      if (key === 'Enter') {
        if (s.processing) return;
        if (s.step === 0 && s.pages.length > 0 && !s.loadingDocs) {
          e.preventDefault();
          s.setStep(1);
        } else if (s.step === 1 && s.pages.some((p) => p.selected)) {
          e.preventDefault();
          s.setStep(2);
        } else if (s.step === 2) {
          e.preventDefault();
          s.setStep(3);
        } else if (s.step === 3 && s.pages.some((p) => p.selected)) {
          e.preventDefault();
          void s.process();
        }
        return;
      }

      // Arrow keys — step through the wizard (steps 0–3 only)
      if (key === 'ArrowRight') {
        if (s.processing || s.step >= 3) return;
        // step 0→1 needs a document; 1→2 needs a selection
        if (s.step === 0 && s.pages.length === 0) return;
        if (s.step === 1 && !s.pages.some((p) => p.selected)) return;
        e.preventDefault();
        s.setStep(s.step + 1);
      } else if (key === 'ArrowLeft') {
        if (s.processing || s.step <= 0 || s.step > 3) return;
        e.preventDefault();
        s.setStep(s.step - 1);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
