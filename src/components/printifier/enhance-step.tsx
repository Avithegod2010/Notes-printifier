'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crop,
  Droplets,
  Eraser,
  Eye,
  Loader2,
  Minus,
  PenLine,
  Plus,
  RotateCw,
  ScanText,
  Scissors,
  SlidersHorizontal,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  buildErasedOverlay,
  estimateDeskewForPage,
  inkCoverage,
  preparePageCanvas,
  resolveColorMode,
  trimCanvasMargins,
  type AnyCanvas,
  type ColorMode,
} from '@/lib/pdf/filters';
import { loadPdfDocument } from '@/lib/pdf/pdfjs';
import { renderPageToCanvas } from '@/lib/pdf/render';
import { getDocBuffer, usePrintifyStore } from '@/lib/printify-store';
import { useT } from '@/lib/i18n';
import { PresetsCard } from './presets-card';
import { PreviewDialog } from './preview-dialog';

const MODES: ColorMode[] = ['auto', 'invert', 'original', 'grayscale', 'bw'];

const MODE_TITLE_KEY: Record<ColorMode, string> = {
  auto: 'en.mode.auto',
  invert: 'en.mode.invert',
  original: 'en.mode.original',
  grayscale: 'en.mode.grayscale',
  bw: 'en.mode.bw',
};

const MODE_HINT_KEY: Record<ColorMode, string> = {
  auto: 'en.mode.auto.h',
  invert: 'en.mode.invert.h',
  original: 'en.mode.original.h',
  grayscale: 'en.mode.grayscale.h',
  bw: 'en.mode.bw.h',
};

const ZOOM_STEPS = [1, 1.5, 2, 2.5, 3] as const;

/**
 * Tiny visual glyph for each color-mode tile. Pure CSS swatches keep the
 * picker square + compact; the "invert" tile gets a light "A" on a dark
 * chip so it reads as "dark slide becomes light page" at a glance.
 */
function ModeSwatch({ mode }: { mode: ColorMode }) {
  if (mode === 'invert') {
    return (
      <span
        aria-hidden
        className="flex h-7 w-full items-center justify-center rounded-md border border-white/10 bg-zinc-900"
      >
        <span className="text-[10px] font-bold leading-none text-zinc-100">A</span>
      </span>
    );
  }
  const bg: Record<Exclude<ColorMode, 'invert'>, React.CSSProperties> = {
    auto: { background: 'linear-gradient(135deg, #27272a 50%, #fafafa 50%)' },
    original: { background: 'linear-gradient(135deg, #8b5cf6, #d946ef 55%, #f59e0b)' },
    grayscale: { background: 'linear-gradient(135deg, #52525b, #d4d4d8)' },
    bw: { background: 'linear-gradient(90deg, #000 50%, #fff 50%)' },
  };
  return (
    <span
      aria-hidden
      className="block h-7 w-full rounded-md border border-white/10"
      style={bg[mode]}
    />
  );
}

export function EnhanceStep() {
  const t = useT();
  const pages = usePrintifyStore((s) => s.pages);
  const filters = usePrintifyStore((s) => s.filters);
  const setFilters = usePrintifyStore((s) => s.setFilters);
  const setStep = usePrintifyStore((s) => s.setStep);

  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  /** F8 — rose-tinted overlay showing exactly which pixels the filters erase. */
  const [overlay, setOverlay] = useState<string | null>(null);
  const [inkBefore, setInkBefore] = useState(0);
  const [inkAfter, setInkAfter] = useState(0);
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);

  // F1 — compare wipe vs side-by-side
  const [view, setView] = useState<'side' | 'wipe'>('side');
  const [wipePos, setWipePos] = useState(50);
  const draggingRef = useRef(false);
  const wipeRef = useRef<HTMLDivElement>(null);

  // F4 — preview page picker + zoom
  const [previewIdx, setPreviewIdx] = useState(0);
  const [zoomIdx, setZoomIdx] = useState(0);
  const zoom = ZOOM_STEPS[zoomIdx];

  /** Estimated tilt (deg) of the preview page — measured once, then cached. */
  const [skewAngle, setSkewAngle] = useState<number | null>(null);
  const angleCache = useRef<Map<string, number>>(new Map());

  // F8 toggle — render the erased-pixels view instead of the clean result
  const [showErased, setShowErased] = useState(false);

  const selectedPages = pages.filter((p) => p.selected);
  const selIdx = Math.min(previewIdx, Math.max(0, selectedPages.length - 1));
  const previewPage = selectedPages[selIdx] ?? pages[0];

  useEffect(() => {
    let cancelled = false;
    if (!previewPage) return;

    const run = async () => {
      const buf = getDocBuffer(previewPage.docId);
      if (!buf) return;
      setBusy(true);
      try {
        const doc = await loadPdfDocument(buf);
        const canvas = await renderPageToCanvas(doc, previewPage.pageNumber, {
          targetWidth: 620,
          extraRotation: previewPage.rotation,
        });
        if (cancelled) return;
        setBefore(canvas.toDataURL('image/jpeg', 0.72));
        setInkBefore(inkCoverage((canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, canvas.width, canvas.height).data));
        // resolve 'auto' once so the preview shows the page's actual treatment
        const effMode = resolveColorMode(canvas as AnyCanvas, filters.colorMode);
        // Skew angle: measured on the RAW render once per page and cached, so
        // slider tweaks never re-run the search — the badge just reads it.
        if (filters.deskew) {
          const angleKey = `${previewPage.docId}:${previewPage.pageNumber}:${previewPage.rotation}`;
          const cached = angleCache.current.get(angleKey);
          if (cached !== undefined) {
            setSkewAngle(cached);
          } else {
            const a = estimateDeskewForPage(canvas as AnyCanvas);
            angleCache.current.set(angleKey, a);
            if (cancelled) return;
            setSkewAngle(a);
          }
        }
        // deskew → filters — the same chain the final pipeline runs (trim is
        // applied separately below so ink can be measured pre-trim)
        const work = preparePageCanvas(
          canvas as AnyCanvas,
          { ...filters, trimMargins: false },
          effMode,
        );
        if (cancelled) return;
        // Ink is measured BEFORE trimming: cropping white margins raises the
        // dark-pixel fraction without saving ink — trim saves paper instead.
        setInkAfter(inkCoverage((work.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D).getImageData(0, 0, work.width, work.height).data));
        let final = work;
        if (filters.trimMargins) {
          const trimmed = trimCanvasMargins(work);
          if (trimmed !== work) final = trimmed;
        }
        if (cancelled) return;
        setAfter((final as HTMLCanvasElement).toDataURL('image/jpeg', 0.72));

        // F8 overlay: normalize the raw render onto the displayed result's
        // box (trim may have changed the aspect), then diff pixel-by-pixel.
        try {
          const norm = document.createElement('canvas');
          norm.width = final.width;
          norm.height = final.height;
          const nctx = norm.getContext('2d');
          if (nctx) {
            nctx.drawImage(canvas as CanvasImageSource, 0, 0, final.width, final.height);
            setOverlay(buildErasedOverlay(norm as AnyCanvas, final as AnyCanvas));
          }
        } catch {
          setOverlay(null);
        }
      } catch (err) {
        console.error('Preview failed', err);
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [previewPage?.id, previewPage?.rotation, filters]);

  // F1 — window-level pointer tracking while the wipe handle is dragged
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const el = wipeRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setWipePos(Math.max(2, Math.min(98, ((e.clientX - r.left) / r.width) * 100)));
    };
    const up = () => {
      draggingRef.current = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const savedPct =
    inkBefore > 0.05 ? Math.max(0, Math.round(((inkBefore - inkAfter) / inkBefore) * 100)) : 0;

  // how many of the advanced toggles are active — surfaced on the collapsed header
  const activeAdv =
    (filters.cleanStains ? 1 : 0) +
    (filters.trimMargins ? 1 : 0) +
    (filters.penBoost > 0 ? 1 : 0);

  const shownAfter = showErased && overlay ? overlay : after;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Preview + compact color-mode picker */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
          {/* Toolbar: page picker (F4) · zoom (F4) · erased overlay (F8) · compare (F1) */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-7 w-7 border-white/15 bg-white/5"
                disabled={selIdx <= 0}
                onClick={() => setPreviewIdx(Math.max(0, selIdx - 1))}
                aria-label={t('pg.moveEarlier')}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Badge variant="outline" className="border-white/15 bg-white/5 text-[11px] font-medium">
                {t('en.preview.page', { n: selIdx + 1, t: Math.max(1, selectedPages.length) })}
              </Badge>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-7 w-7 border-white/15 bg-white/5"
                disabled={selIdx >= selectedPages.length - 1}
                onClick={() => setPreviewIdx(Math.min(selectedPages.length - 1, selIdx + 1))}
                aria-label={t('pg.moveLater')}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <div className="flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-1 py-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={zoomIdx === 0}
                  onClick={() => setZoomIdx((z) => Math.max(0, z - 1))}
                  aria-label={t('en.zoom.out')}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="min-w-9 text-center text-[11px] font-semibold tabular-nums">
                  {t('en.zoom.pct', { n: zoom })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={zoomIdx === ZOOM_STEPS.length - 1}
                  onClick={() => setZoomIdx((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
                  aria-label={t('en.zoom.in')}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Button
                type="button"
                variant={showErased ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  'h-7 px-2 text-[11px]',
                  showErased
                    ? 'bg-rose-500/80 text-white hover:bg-rose-500'
                    : 'border-white/15 bg-white/5 hover:bg-white/10',
                )}
                onClick={() => setShowErased((v) => !v)}
                aria-pressed={showErased}
                title={t('en.overlay.aria')}
              >
                <Eraser className="mr-1 h-3.5 w-3.5" /> {t('en.overlay')}
              </Button>
              <div className="flex overflow-hidden rounded-lg border border-white/15" role="group" aria-label={t('en.cmp.aria')}>
                <button
                  type="button"
                  aria-pressed={view === 'side'}
                  onClick={() => setView('side')}
                  className={cn(
                    'px-2 py-1 text-[11px] font-semibold transition-colors',
                    view === 'side' ? 'bg-primary/20 text-primary' : 'bg-white/5 text-muted-foreground hover:bg-white/10',
                  )}
                >
                  {t('en.cmp.side')}
                </button>
                <button
                  type="button"
                  aria-pressed={view === 'wipe'}
                  onClick={() => setView('wipe')}
                  className={cn(
                    'px-2 py-1 text-[11px] font-semibold transition-colors',
                    view === 'wipe' ? 'bg-primary/20 text-primary' : 'bg-white/5 text-muted-foreground hover:bg-white/10',
                  )}
                >
                  {t('en.cmp.wipe')}
                </button>
              </div>
            </div>
          </div>

          {view === 'side' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <figure className="space-y-2">
                <figcaption className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('en.preview.before')}
                  <Badge variant="outline" className="border-red-400/40 text-red-300">
                    {t('en.preview.ink', { n: Math.round(inkBefore * 100) })}
                  </Badge>
                </figcaption>
                <div className="pretty-scroll overflow-auto rounded-xl border border-white/10 bg-zinc-950">
                  {before ? (
                    <img
                      src={before}
                      alt="Original page"
                      className="block max-w-none"
                      style={{ width: `${zoom * 100}%` }}
                    />
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </div>
              </figure>
              <figure className="space-y-2">
                <figcaption className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {showErased ? (
                    <span className="text-rose-300">{t('en.overlay.hint')}</span>
                  ) : (
                    t('en.preview.after')
                  )}
                  {savedPct > 0 ? (
                    <Badge className="border border-emerald-400/40 bg-emerald-500/15 text-emerald-300">
                      {t('en.preview.ink', { n: Math.round(inkAfter * 100) })}
                    </Badge>
                  ) : (
                    <Badge variant="outline">—</Badge>
                  )}
                </figcaption>
                <div className="pretty-scroll relative overflow-auto rounded-xl border border-primary/30 bg-zinc-950">
                  {shownAfter ? (
                    <img
                      src={shownAfter}
                      alt={showErased ? 'Erased pixels highlighted' : 'Enhanced page'}
                      className="block max-w-none"
                      style={{ width: `${zoom * 100}%` }}
                    />
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {busy && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="h-6 w-6 animate-spin text-white" />
                    </div>
                  )}
                </div>
              </figure>
            </div>
          ) : (
            <figure className="space-y-2">
              <figcaption className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {showErased ? (
                  <span className="text-rose-300">{t('en.overlay.hint')}</span>
                ) : (
                  <span>
                    {t('en.preview.before')} ← → {t('en.preview.after')}
                  </span>
                )}
                {savedPct > 0 && (
                  <Badge className="border border-emerald-400/40 bg-emerald-500/15 text-emerald-300">
                    −{savedPct}% {t('en.ink').toLowerCase()}
                  </Badge>
                )}
              </figcaption>
              <div
                ref={wipeRef}
                className="pretty-scroll relative select-none overflow-auto rounded-xl border border-primary/30 bg-zinc-950"
              >
                {shownAfter && before ? (
                  <>
                    <img
                      src={shownAfter}
                      alt="Enhanced page"
                      className="block max-w-none"
                      style={{ width: `${zoom * 100}%` }}
                      draggable={false}
                    />
                    <img
                      src={before}
                      alt="Original page"
                      className="absolute inset-0 h-full w-full object-contain"
                      style={{ clipPath: `inset(0 ${100 - wipePos}% 0 0)` }}
                      draggable={false}
                    />
                    {/* handle */}
                    <div
                      role="slider"
                      tabIndex={0}
                      aria-label={t('en.cmp.aria')}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(wipePos)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft') {
                          e.preventDefault();
                          setWipePos((p) => Math.max(2, p - 3));
                        }
                        if (e.key === 'ArrowRight') {
                          e.preventDefault();
                          setWipePos((p) => Math.min(98, p + 3));
                        }
                      }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        draggingRef.current = true;
                      }}
                      className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize"
                      style={{ left: `${wipePos}%` }}
                    >
                      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white/90 shadow-[0_0_6px_rgba(0,0,0,0.6)]" />
                      <span className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-white/95 shadow-lg">
                        <ChevronLeft className="h-3.5 w-3.5 text-zinc-800" />
                        <ChevronRight className="h-3.5 w-3.5 text-zinc-800" />
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {busy && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                  </div>
                )}
              </div>
            </figure>
          )}

          {savedPct > 0 && (
            <p className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-center text-sm text-emerald-300">
              <Droplets className="h-4 w-4" />
              {t('en.preview.saves', { n: savedPct })}
            </p>
          )}

          {/* Compact square-tile color-mode picker — sits right under the
              preview so mode changes are immediately visible above. */}
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:p-4">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <Wand2 className="h-4 w-4 text-violet-400" /> {t('en.title')}
              </h3>
              <span className="text-[11px] leading-tight text-muted-foreground">
                {t(MODE_HINT_KEY[filters.colorMode])}
              </span>
            </div>
            <RadioGroup
              value={filters.colorMode}
              onValueChange={(v) => setFilters({ colorMode: v as ColorMode })}
              className="grid grid-cols-3 gap-2 min-[560px]:grid-cols-5"
            >
              {MODES.map((mode) => (
                <Label
                  key={mode}
                  htmlFor={`mode-${mode}`}
                  title={t(MODE_HINT_KEY[mode])}
                  className={cn(
                    'relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border p-2 transition-all',
                    filters.colorMode === mode
                      ? 'border-primary bg-primary/10 shadow-sm shadow-primary/20'
                      : 'border-white/10 hover:border-white/25 hover:bg-white/5',
                  )}
                >
                  <RadioGroupItem value={mode} id={`mode-${mode}`} className="sr-only" />
                  <ModeSwatch mode={mode} />
                  <span className="text-center text-[11px] font-medium leading-tight">
                    {t(MODE_TITLE_KEY[mode])}
                  </span>
                  {mode === 'auto' && (
                    <span
                      title={t('en.recommended')}
                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-white shadow shadow-violet-600/40"
                    >
                      <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                    </span>
                  )}
                </Label>
              ))}
            </RadioGroup>
          </div>

          <div className="mt-3 flex flex-col items-center gap-2">
            <p className="text-center text-xs text-muted-foreground">{t('en.preview.note')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-white/15 bg-white/5 hover:bg-white/10"
              disabled={!previewPage}
              onClick={() => setPreviewOpen(true)}
            >
              <Eye className="mr-1.5 h-4 w-4 text-violet-300" /> {t('en.preview.full')}
            </Button>
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <Droplets className="h-4 w-4 text-violet-400" /> {t('en.ink')}
              </h3>
              <Badge variant="secondary">{filters.inkSaver}%</Badge>
            </div>
            <Slider
              value={[filters.inkSaver]}
              onValueChange={(v) => setFilters({ inkSaver: v[0] ?? 0 })}
              min={0}
              max={90}
              step={5}
              className="mt-3"
              aria-label={t('en.ink')}
            />
            <p className="mt-2 text-xs text-muted-foreground">{t('en.ink.d')}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <RotateCw className="h-4 w-4 text-violet-400" /> {t('en.deskew')}
                {filters.deskew && skewAngle !== null && Math.abs(skewAngle) >= 1 && (
                  <Badge
                    className="ml-1 border-0 bg-amber-500/20 text-[10px] text-amber-200"
                    title={t('en.deskew.badge')}
                  >
                    {/* shows the applied correction: positive skew (content
                        droops clockwise) straightens with a −angle turn */}
                    {skewAngle > 0 ? '−' : '+'}
                    {Math.abs(skewAngle).toFixed(1)}°
                  </Badge>
                )}
              </h3>
              <Switch
                checked={filters.deskew ?? false}
                onCheckedChange={(v) => setFilters({ deskew: v })}
                aria-label={t('en.deskew')}
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('en.deskew.d')}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <Scissors className="h-4 w-4 text-violet-400" /> {t('en.logo')}
              </h3>
              <Badge variant="secondary">
                {(filters.headerTrim ?? 0) > 0
                  ? `${filters.headerTrim}%`
                  : t('en.logo.off')}
              </Badge>
            </div>
            <Slider
              value={[filters.headerTrim ?? 0]}
              onValueChange={(v) => setFilters({ headerTrim: v[0] ?? 0 })}
              min={0}
              max={25}
              step={1}
              className="mt-3"
              aria-label={t('en.logo.aria')}
            />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('en.logo.d')}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <ScanText className="h-4 w-4 text-violet-400" /> {t('en.ocr')}
                <Badge className="ml-1 border-0 bg-fuchsia-500/20 text-[10px] text-fuchsia-200">
                  {t('en.badge.new')}
                </Badge>
              </h3>
              <Switch
                checked={filters.searchable}
                onCheckedChange={(v) => setFilters({ searchable: v })}
                aria-label={t('en.ocr')}
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('en.ocr.d')}</p>
          </div>

          {/* Advanced — stain cleanup, trim margins & handwriting boost tucked
              away so the main column stays focused on the big-impact controls. */}
          <Collapsible
            open={advOpen}
            onOpenChange={setAdvOpen}
            className="rounded-2xl border border-white/10 bg-white/[0.03]"
          >
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-2xl p-5 text-left transition-colors hover:bg-white/[0.02]">
              <span>
                <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  <SlidersHorizontal className="h-4 w-4 text-violet-400" /> {t('en.adv')}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{t('en.adv.sub')}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {activeAdv > 0 && (
                  <Badge variant="secondary">{t('en.adv.on', { n: activeAdv })}</Badge>
                )}
                <ChevronDown
                  aria-hidden
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform duration-200',
                    advOpen && 'rotate-180',
                  )}
                />
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-[state=closed]:hidden">
              <div className="space-y-4 px-5 pb-5">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                      <Eraser className="h-4 w-4 text-violet-400" /> {t('en.stains')}
                    </h4>
                    <Switch
                      checked={filters.cleanStains}
                      onCheckedChange={(v) => setFilters({ cleanStains: v })}
                      aria-label={t('en.stains')}
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {filters.colorMode === 'invert'
                      ? t('en.stains.inv')
                      : t('en.stains.light')}
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                      <Crop className="h-4 w-4 text-violet-400" /> {t('en.trim')}
                    </h4>
                    <Switch
                      checked={filters.trimMargins}
                      onCheckedChange={(v) => setFilters({ trimMargins: v })}
                      aria-label={t('en.trim')}
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{t('en.trim.d')}</p>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
                      <PenLine className="h-4 w-4 text-violet-400" /> {t('en.pen')}
                      <Badge className="ml-1 border-0 bg-fuchsia-500/20 text-[10px] text-fuchsia-200">
                        {t('en.badge.new')}
                      </Badge>
                    </h4>
                    <Badge variant="secondary">{filters.penBoost}%</Badge>
                  </div>
                  <Slider
                    value={[filters.penBoost]}
                    onValueChange={(v) => setFilters({ penBoost: v[0] ?? 0 })}
                    min={0}
                    max={100}
                    step={10}
                    className="mt-1"
                    aria-label={t('en.pen')}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">{t('en.pen.d')}</p>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <PresetsCard />
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full sm:w-auto"
          onClick={() => setStep(1)}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> {t('up.back')}
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={() => setStep(3)}
          className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500 sm:w-auto"
        >
          {t('up.continue')} <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
  );
}
