'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCw,
  ScanLine,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePrintifyStore } from '@/lib/printify-store';

export function PagesStep() {
  const pages = usePrintifyStore((s) => s.pages);
  const togglePage = usePrintifyStore((s) => s.togglePage);
  const setAllSelected = usePrintifyStore((s) => s.setAllSelected);
  const removePage = usePrintifyStore((s) => s.removePage);
  const rotatePage = usePrintifyStore((s) => s.rotatePage);
  const movePage = usePrintifyStore((s) => s.movePage);
  const skipBlankPages = usePrintifyStore((s) => s.skipBlankPages);
  const setStep = usePrintifyStore((s) => s.setStep);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [scanningBlank, setScanningBlank] = useState(false);
  const [blankMsg, setBlankMsg] = useState<string | null>(null);
  /** Last page the user acted on — target for keyboard shortcuts. */
  const [activeId, setActiveId] = useState<string | null>(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  const selectedCount = pages.filter((p) => p.selected).length;

  const onSkipBlank = useCallback(async () => {
    setScanningBlank(true);
    setBlankMsg(null);
    try {
      const n = await skipBlankPages();
      setBlankMsg(
        n > 0
          ? `Skipped ${n} blank page${n > 1 ? 's' : ''}`
          : 'No blank pages found',
      );
    } catch {
      setBlankMsg('Could not scan pages');
    } finally {
      setScanningBlank(false);
    }
  }, [skipBlankPages]);

  // Desktop keyboard shortcuts, acting on the last page the user touched.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.closest('input, textarea, select, [contenteditable]') ||
          target.isContentEditable)
      )
        return;
      if (!activeId) return;
      const list = pagesRef.current;
      const idx = list.findIndex((p) => p.id === activeId);
      if (idx < 0) return;

      const key = e.key;
      if (key === 'r' || key === 'R') {
        e.preventDefault();
        rotatePage(activeId);
      } else if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault();
        const next = list[idx + 1] ?? list[idx - 1] ?? null;
        removePage(activeId);
        setActiveId(next ? next.id : null);
      } else if (key === 'ArrowLeft') {
        e.preventDefault();
        if (idx > 0) {
          movePage(idx, idx - 1);
        }
      } else if (key === 'ArrowRight') {
        e.preventDefault();
        if (idx < list.length - 1) {
          movePage(idx, idx + 1);
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeId, rotatePage, removePage, movePage]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">
            {selectedCount} of {pages.length}
          </span>{' '}
          pages selected · tap a page to include / exclude
          <span className="hidden sm:inline"> · drag to reorder</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            disabled={scanningBlank || selectedCount === 0}
            onClick={() => void onSkipBlank()}
          >
            {scanningBlank ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <ScanLine className="mr-1.5 h-4 w-4 text-violet-300" />
            )}
            Skip blank pages
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => setAllSelected(true)}
          >
            Select all
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => setAllSelected(false)}
          >
            Clear
          </Button>
        </div>
      </div>

      {blankMsg && (
        <p className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-sm text-violet-200">
          {blankMsg}
        </p>
      )}

      <div className="pretty-scroll grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto p-1 sm:max-h-[32rem] sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {pages.map((page, index) => (
          <div
            key={page.id}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(index);
            }}
            onDragLeave={() => setOverIndex((v) => (v === index ? null : v))}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== index) movePage(dragIndex, index);
              setDragIndex(null);
              setOverIndex(null);
            }}
            className={cn(
              'touch-manipulation relative overflow-hidden rounded-xl border bg-white/[0.03] transition-all',
              page.selected
                ? 'border-primary/60 ring-2 ring-primary/40'
                : 'border-white/10 opacity-40 saturate-0',
              activeId === page.id && 'ring-1 ring-violet-300',
              overIndex === index && dragIndex !== null && 'ring-2 ring-fuchsia-400',
              dragIndex === index && 'opacity-50',
            )}
          >
            <button
              type="button"
              onClick={() => {
                setActiveId(page.id);
                togglePage(page.id);
              }}
              className="block w-full"
              aria-pressed={page.selected}
              aria-label={`Page ${index + 1} ${page.selected ? '(selected)' : '(excluded)'}`}
            >
              <img
                src={page.thumb}
                alt={`Page ${index + 1} preview`}
                className="aspect-[4/3] w-full bg-zinc-900 object-contain"
                draggable={false}
              />
            </button>

            {/* selection / order badge */}
            <div className="absolute left-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-md bg-black/70 px-1.5 text-xs font-bold text-white">
              {page.selected ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                index + 1
              )}
            </div>

            {page.rotation > 0 && (
              <div className="absolute right-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {page.rotation}°
              </div>
            )}

            {page.blank && (
              <div className="absolute bottom-1.5 right-1.5 rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold text-black">
                blank
              </div>
            )}

            {/* always-visible action bar — touch devices have no hover, so
                these controls must never hide (also a keyboard win) */}
            <div className="flex items-center justify-between gap-0.5 border-t border-white/10 bg-black/60 px-1 py-1 backdrop-blur-sm">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Move page ${index + 1} earlier`}
                disabled={index === 0}
                onClick={() => {
                  setActiveId(page.id);
                  movePage(index, index - 1);
                }}
                className="h-8 w-8 text-white/85 hover:bg-white/15 hover:text-white disabled:opacity-25"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Rotate page ${index + 1}`}
                onClick={() => {
                  setActiveId(page.id);
                  rotatePage(page.id);
                }}
                className="h-8 w-8 text-white/85 hover:bg-white/15 hover:text-white"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove page ${index + 1}`}
                onClick={() => {
                  const next = pages[index + 1] ?? pages[index - 1] ?? null;
                  setActiveId(next ? next.id : null);
                  removePage(page.id);
                }}
                className="h-8 w-8 text-white/85 hover:bg-red-600 hover:text-white"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Move page ${index + 1} later`}
                disabled={index === pages.length - 1}
                onClick={() => {
                  setActiveId(page.id);
                  movePage(index, index + 1);
                }}
                className="h-8 w-8 text-white/85 hover:bg-white/15 hover:text-white disabled:opacity-25"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <p className="hidden items-center justify-center gap-2 text-xs text-muted-foreground [@media(hover:hover)]:flex">
        <span>Shortcuts:</span>
        <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">R</kbd>
        <span>rotate</span>
        <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">Del</kbd>
        <span>remove</span>
        <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">←</kbd>
        <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">→</kbd>
        <span>move — acts on the page you tapped/clicked last</span>
      </p>

      {selectedCount === 0 && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Select at least one page to continue.
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full sm:w-auto"
          onClick={() => setStep(0)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button
          type="button"
          size="lg"
          disabled={selectedCount === 0}
          onClick={() => setStep(2)}
          className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500 sm:w-auto"
        >
          Continue <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
