'use client';

import { useEffect, useRef } from 'react';

import { installSharedPdfReceiver } from '@/lib/shared-file';

/**
 * Receives a PDF shared into the Notes Printifier Android app
 * (share-sheet / open-with). The APK stages the file and calls
 * window.__npConsumeShared() once the page is up; this hook installs
 * that hook and forwards the fetched File to `onPdf`.
 *
 * The receiver is installed once per mount; `onPdf` is read through a
 * ref so callers may pass an inline callback without re-installing.
 */
export function useSharedPdf(onPdf: (file: File) => void): void {
  const onPdfRef = useRef(onPdf);

  useEffect(() => {
    onPdfRef.current = onPdf;
  }, [onPdf]);

  useEffect(() => {
    return installSharedPdfReceiver((file: File) => onPdfRef.current(file));
  }, []);
}
