'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Palette,
  RotateCw,
  ScanLine,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { usePrintifyStore } from '@/lib/printify-store';
import { useT } from '@/lib/i18n';
import type { FilterSettings } from '@/lib/pdf/filters';

/**
 * Parse a page-range spec like "1-5, 8, 12-14" into 1-based positions.
 * Returns null when the spec contains no valid page numbers.
 */
export function parsePageSpec(spec: string, maxPage: number): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(/[,;\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const lo = Math.max(1, Math.min(a, b));
    const hi = Math.min(maxPage, Math.max(a, b));
    for (let i = lo; i <= hi; i++) out.add(i);
  }
  return out.size > 0 ? [...out].sort((x, y) => x - y) : null;
}

/**
 * Per-page color-mode override cycle — one tap walks the page through the
 * useful exceptions to the deck-wide setting ("keep slide 3 colorful, invert
 * the rest"). patch null = inherit the global Enhance settings.
 */
const OVERRIDE_CYCLE: Array<{
  patch: Partial<FilterSettings> | null;
  label: string;
}> = [
  { patch: { colorMode: 'original' }, label: 'COL' },
  { patch: { colorMode: 'invert' }, label: 'INV' },
  { patch: { colorMode: 'grayscale' }, label: 'GRAY' },
  { patch: { colorMode: 'bw' }, label: 'B&W' },
  { patch: null, label: '' },
];

function nextOverride(current: Partial<FilterSettings> | undefined) {
  const idx = current?.colorMode
    ? OVERRIDE_CYCLE.findIndex((o) => o.patch?.colorMode === current.colorMode)
    : OVERRIDE_CYCLE.length - 1; // currently off → start the cycle
  return OVERRIDE_CYCLE[(idx + 1) % OVERRIDE_CYCLE.length];
}

export function PagesStep() {
  const t = useT();
  const pages = usePrintifyStore((s) => s.pages);
  const togglePage = usePrintifyStore((s) => s.togglePage);
  const setAllSelected = usePrintifyStore((s) => s.setAllSelected);
  const smartPick = usePrintifyStore((s) => s.smartPick);
  const selectRange = usePrintifyStore((s) => s.selectRange);
  const selectIndices = usePrintifyStore((s) => s.selectIndices);
  const removePage = usePrintifyStore((s) => s.removePage);
  const rotatePage = usePrintifyStore((s) => s.rotatePage);
  const movePage = usePrintifyStore((s) => s.movePage);
  const skipBlankPages = usePrintifyStore((s) => s.skipBlankPages);
  const setStep = usePrintifyStore((s) => s.setStep);
  const autoRotateMixed = usePrintifyStore((s) => s.autoRotateMixed);
  const activeId = usePrintifyStore((s) => s.activePageId);
  const setActiveId = usePrintifyStore((s) => s.setActivePageId);
  const setPageOverride = usePrintifyStore((s) => s.setPageOverride);
  const clearPageOverrides = usePrintifyStore((s) => s.clearPageOverrides);
  const pageOverrides = usePrintifyStore((s) => s.pageOverrides);
  const ensureThumbs = usePrintifyStore((s) => s.ensureThumbs);

  /** Scroll container of the thumbnail grid — IntersectionObserver root. */
  const gridRef = useRef<HTMLDivElement | null>(null);

  /** Measured inner width of the scroll container — drives the virtualized
   *  column count (ResizeObserver instead of viewport breakpoints). */
  const [gridW, setGridW] = useState(0);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [scanningBlank, setScanningBlank] = useState(false);
  const [blankMsg, setBlankMsg] = useState<string | null>(null);
  /** Two-thumb range slider window (1-based, inclusive). */
  const [range, setRange] = useState<[number, number]>([1, 1]);
  /** Custom range spec input ("1-5, 8, 12-14"). */
  const [spec, setSpec] = useState('');
  const [specMsg, setSpecMsg] = useState<string | null>(null);
  const [rotateMsg, setRotateMsg] = useState<string | null>(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  const selectedCount = pages.filter((p) => p.selected).length;
  const pageCount = pages.length;
  const overrideCount = Object.keys(pageOverrides).length;

  // New document loaded (page count changed) → reset the slider to full span.
  // Adjusting state during render (React's recommended pattern) — no effect.
  const [lastCount, setLastCount] = useState(0);
  if (pageCount !== lastCount) {
    setLastCount(pageCount);
    setRange([1, Math.max(1, pageCount)]);
  }

  // --- virtualized grid ------------------------------------------------------
  // A 500-page deck used to mount every thumbnail cell at once (500 DOM
  // subtrees × 6 buttons each). The grid now windows ROWS through
  // @tanstack/react-virtual: only the visible rows (plus overscan) exist in
  // the DOM, while lazy thumbnails, drag & drop and keyboard shortcuts keep
  // working on whichever cells are currently mounted.
  const cols = gridW < 560 ? 2 : gridW < 960 ? 3 : gridW < 1240 ? 4 : 5;
  const rowCount = Math.ceil(pageCount / cols);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => gridRef.current,
    overscan: 3,
    estimateSize: () => {
      // 4:3 thumb + action bar + border, from the measured container width
      const cellW = Math.max(120, (gridW - 8 - 12 * (cols - 1)) / cols);
      return cellW * 0.75 + 46;
    },
  });

  // Track the scroll container's real width so the column count matches the
  // space actually available (CSS breakpoints only ever saw the viewport).
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setGridW(Math.round(w));
    });
    ro.observe(grid);
    return () => ro.disconnect();
  }, []);

  const applyRange = useCallback(
    (v: number[]) => {
      const lo = Math.max(1, Math.min(v[0] ?? 1, pageCount));
      const hi = Math.max(1, Math.min(v[1] ?? lo, pageCount));
      setRange([lo, hi]);
      selectRange(lo, hi);
    },
    [pageCount, selectRange],
  );

  const applySpec = useCallback(() => {
    const parsed = parsePageSpec(spec, pageCount);
    if (!parsed) {
      setSpecMsg(t('pg.rangeBad'));
      return;
    }
    selectIndices(parsed);
    setRange([parsed[0], parsed[parsed.length - 1]]);
    setSpecMsg(t('pg.rangeOk', { n: parsed.length }));
  }, [spec, pageCount, selectIndices, t]);

  const onSkipBlank = useCallback(async () => {
    setScanningBlank(true);
    setBlankMsg(null);
    try {
      const n = await skipBlankPages();
      setBlankMsg(
        n > 0
          ? t('pg.skipped', { n })
          : t('pg.noBlank'),
      );
    } catch {
      setBlankMsg(t('pg.scanFail'));
    } finally {
      setScanningBlank(false);
    }
  }, [skipBlankPages, t]);

  const onAutoRotate = useCallback(() => {
    setRotateMsg(null);
    const n = autoRotateMixed();
    setRotateMsg(n > 0 ? t('pg.autoRotateDone', { n }) : t('pg.autoRotateNone'));
  }, [autoRotateMixed, t]);

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

  // Lazy thumbnails (pdf.js render-diet): cells without a rasterized thumb
  // get one the moment they scroll into (or near) the grid viewport, so a
  // 300-page deck opens instantly instead of blocking upload on 300 renders.
  // The effect re-runs on every render — cheap querySelectorAll, and it
  // picks up newly added pages plus cells whose thumb is still pending.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const pending = Array.from(grid.querySelectorAll<HTMLElement>('[data-thumb-pending]'));
    if (pending.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const ids = entries
          .filter((e) => e.isIntersecting)
          .map((e) =>
            e.target instanceof HTMLElement ? e.target.dataset.thumbPending : undefined,
          )
          .filter((x): x is string => !!x);
        if (ids.length > 0) void ensureThumbs(ids);
      },
      { root: grid, rootMargin: '400px 0px' },
    );
    for (const el of pending) io.observe(el);
    return () => io.disconnect();
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          {/* prominent live counter — counts every selected page */}
          <span
            aria-live="polite"
            className="inline-flex items-baseline gap-1.5 rounded-xl border border-primary/40 bg-primary/15 px-3 py-1.5 shadow-sm shadow-primary/20"
          >
            <span className="text-xl font-extrabold leading-none text-primary tabular-nums">
              {selectedCount}
            </span>
            <span className="text-xs font-semibold text-muted-foreground tabular-nums">
              / {pageCount}
            </span>
          </span>
          <span className="text-sm text-muted-foreground">
            {t('pg.selected')}
            <span className="hidden sm:inline">{t('pg.dragHint')}</span>
          </span>
        </div>
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
            {t('pg.skipBlank')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            disabled={pageCount === 0}
            onClick={onAutoRotate}
            title={t('pg.autoRotateHint')}
          >
            <RotateCw className="mr-1.5 h-4 w-4 text-violet-300" />
            {t('pg.autoRotate')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => setAllSelected(true)}
          >
            {t('pg.selectAll')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => setAllSelected(false)}
          >
            {t('pg.clear')}
          </Button>
        </div>
        {/* Quick picks — one-tap bulk selection for big decks */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-muted-foreground">{t('pg.pick')}:</span>
          {(
            [
              ['all', 'pg.pick.all'],
              ['odd', 'pg.pick.odd'],
              ['even', 'pg.pick.even'],
              ['invert', 'pg.pick.invert'],
              ['last10', 'pg.pick.last'],
            ] as const
          ).map(([mode, key]) => (
            <button
              key={mode}
              type="button"
              onClick={() => smartPick(mode)}
              className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-violet-500/40 hover:text-foreground"
            >
              {t(key)}
            </button>
          ))}
        </div>
      </div>

      {overrideCount > 0 && (
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="bg-fuchsia-500/15 text-fuchsia-200"
          >
            <Palette className="mr-1.5 h-3.5 w-3.5" />
            {t('pg.tweak.count', { n: overrideCount })}
          </Badge>
          <button
            type="button"
            onClick={() => {
              clearPageOverrides();
              setRotateMsg(null);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-red-400/40 hover:text-red-300"
          >
            <X className="h-3 w-3" /> {t('pg.tweak.reset')}
          </button>
        </div>
      )}

      {/* Range slider — drag the two handles to keep only that window */}
      {pageCount > 1 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5 text-violet-300" />
              {t('pg.slider')}
            </p>
            <p className="text-xs font-semibold tabular-nums text-foreground">
              {t('pg.sliderRange', { a: range[0], b: range[1] })}
            </p>
          </div>
          <Slider
            value={[range[0], range[1]]}
            min={1}
            max={pageCount}
            step={1}
            minStepsBetweenThumbs={0}
            onValueChange={applyRange}
            aria-label={t('pg.slider')}
          />
          <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
            <span>1</span>
            <span>{Math.max(1, Math.round(pageCount / 2))}</span>
            <span>{pageCount}</span>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              value={spec}
              onChange={(e) => {
                setSpec(e.target.value);
                setSpecMsg(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySpec();
              }}
              placeholder={t('pg.customPh')}
              inputMode="numeric"
              aria-label={t('pg.custom')}
              className="h-9 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0"
              onClick={applySpec}
              disabled={pageCount === 0}
            >
              {t('pg.apply')}
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{t('pg.sliderHint')}</p>
          {specMsg && (
            <p className="mt-1.5 text-[11px] font-medium text-violet-300">{specMsg}</p>
          )}
        </div>
      )}

      {blankMsg && (
        <p className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-sm text-violet-200">
          {blankMsg}
        </p>
      )}

      {rotateMsg && (
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm text-sky-200">
          {rotateMsg}
        </p>
      )}

      <div
        ref={gridRef}
        className="pretty-scroll max-h-[60vh] overflow-y-auto p-1 sm:max-h-[44rem]"
      >
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const rowStart = virtualRow.index * cols;
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 grid w-full gap-3 pb-3"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                }}
              >
                {pages.slice(rowStart, rowStart + cols).map((page, k) => {
                  const index = rowStart + k;
                  const override: Partial<FilterSettings> | undefined = pageOverrides[page.id];
                  return (
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
              page.selected &&
                index + 1 >= Math.min(range[0], range[1]) &&
                index + 1 <= Math.max(range[0], range[1]) &&
                'ring-primary/70',
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
              {page.thumb ? (
                <img
                  src={page.thumb}
                  alt={`Page ${index + 1} preview`}
                  className="aspect-[4/3] w-full bg-zinc-900 object-contain"
                  draggable={false}
                />
              ) : (
                <div
                  data-thumb-pending={page.id}
                  className="aspect-[4/3] w-full animate-pulse bg-zinc-900"
                  role="img"
                  aria-label={`Page ${index + 1} preview loading`}
                />
              )}
            </button>

            {/* selection / order badge */}
            <div className="absolute left-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-md bg-black/70 px-1.5 text-xs font-bold text-white">
              {page.selected ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                index + 1
              )}
            </div>

            {pageOverrides[page.id]?.colorMode && (
              <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
                {page.rotation > 0 && (
                  <span className="rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {page.rotation}°
                  </span>
                )}
                <span className="rounded-md bg-fuchsia-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {OVERRIDE_CYCLE.find(
                    (o) => o.patch?.colorMode === pageOverrides[page.id]?.colorMode,
                  )?.label ?? ''}
                </span>
              </div>
            )}
            {!pageOverrides[page.id]?.colorMode && page.rotation > 0 && (
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
                aria-label={`Per-page color override for page ${index + 1}`}
                title={t('pg.tweak.hint')}
                onClick={() => {
                  setActiveId(page.id);
                  const next = nextOverride(override);
                  setPageOverride(page.id, next.patch);
                }}
                className="h-8 w-8 text-white/85 hover:bg-fuchsia-600/60 hover:text-white"
              >
                {override ? (
                  <span className="text-[9px] font-extrabold leading-none">
                    {OVERRIDE_CYCLE.find((o) => o.patch?.colorMode === override.colorMode)?.label}
                  </span>
                ) : (
                  <Palette className="h-3.5 w-3.5" />
                )}
              </Button>
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
          );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <p className="hidden items-center justify-center gap-2 text-xs text-muted-foreground [@media(hover:hover)]:flex">
        <span>{t('pg.shortcuts')}</span>
        <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">R</kbd>
        <span>{t('pg.scRotate')}</span>
        <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">Del</kbd>
        <span>{t('pg.scRemove')}</span>
        <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">←</kbd>
        <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">→</kbd>
        <span>{t('pg.scMove')}</span>
      </p>

      {selectedCount === 0 && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          {t('pg.needOne')}
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
          <ArrowLeft className="mr-2 h-4 w-4" /> {t('up.back')}
        </Button>
        <Button
          type="button"
          size="lg"
          disabled={selectedCount === 0}
          onClick={() => setStep(2)}
          className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500 sm:w-auto"
        >
          {t('up.continue')} <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
