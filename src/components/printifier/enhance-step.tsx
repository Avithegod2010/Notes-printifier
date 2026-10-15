'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Crop,
  Droplets,
  Eraser,
  Eye,
  Loader2,
  PenLine,
  RotateCw,
  ScanText,
  Scissors,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  COLOR_MODE_LABELS,
  estimateDeskewForPage,
  inkCoverage,
  preparePageCanvas,
  resolveColorMode,
  trimCanvasMargins,
  type ColorMode,
  type AnyCanvas,
} from '@/lib/pdf/filters';
import { loadPdfDocument } from '@/lib/pdf/pdfjs';
import { renderPageToCanvas } from '@/lib/pdf/render';
import { getDocBuffer, usePrintifyStore } from '@/lib/printify-store';
import { useT } from '@/lib/i18n';
import { PresetsCard } from './presets-card';
import { PreviewDialog } from './preview-dialog';

const MODES: ColorMode[] = ['auto', 'invert', 'original', 'grayscale', 'bw'];

export function EnhanceStep() {
  const t = useT();
  const pages = usePrintifyStore((s) => s.pages);
  const filters = usePrintifyStore((s) => s.filters);
  const setFilters = usePrintifyStore((s) => s.setFilters);
  const setStep = usePrintifyStore((s) => s.setStep);

  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [inkBefore, setInkBefore] = useState(0);
  const [inkAfter, setInkAfter] = useState(0);
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  /** Estimated tilt (deg) of the preview page — measured once, then cached. */
  const [skewAngle, setSkewAngle] = useState<number | null>(null);
  const angleCache = useRef<Map<string, number>>(new Map());

  const previewPage = pages.find((p) => p.selected) ?? pages[0];

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

  const savedPct =
    inkBefore > 0.05 ? Math.max(0, Math.round(((inkBefore - inkAfter) / inkBefore) * 100)) : 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Preview */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <figure className="space-y-2">
              <figcaption className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('en.preview.before')}
                <Badge variant="outline" className="border-red-400/40 text-red-300">
                  {t('en.preview.ink', { n: Math.round(inkBefore * 100) })}
                </Badge>
              </figcaption>
              <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
                {before ? (
                  <img src={before} alt="Original page" className="w-full" />
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            </figure>
            <figure className="space-y-2">
              <figcaption className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('en.preview.after')}
                {savedPct > 0 ? (
                  <Badge className="border border-emerald-400/40 bg-emerald-500/15 text-emerald-300">
                    {t('en.preview.ink', { n: Math.round(inkAfter * 100) })}
                  </Badge>
                ) : (
                  <Badge variant="outline">—</Badge>
                )}
              </figcaption>
              <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-zinc-950">
                {after ? (
                  <img src={after} alt="Enhanced page" className="w-full" />
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
          {savedPct > 0 && (
            <p className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-center text-sm text-emerald-300">
              <Droplets className="h-4 w-4" />
              {t('en.preview.saves', { n: savedPct })}
            </p>
          )}
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
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <Wand2 className="h-4 w-4 text-violet-400" /> {t('en.title')}
            </h3>
            <RadioGroup
              value={filters.colorMode}
              onValueChange={(v) => setFilters({ colorMode: v as ColorMode })}
              className="grid grid-cols-1 gap-2"
            >
              {MODES.map((mode) => (
                <Label
                  key={mode}
                  htmlFor={`mode-${mode}`}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors',
                    filters.colorMode === mode
                      ? 'border-primary bg-primary/10'
                      : 'border-white/10 hover:border-white/25',
                  )}
                >
                  <RadioGroupItem value={mode} id={`mode-${mode}`} />
                  <span className="flex-1">
                    <span className="block text-sm font-medium">
                      {COLOR_MODE_LABELS[mode].title}
                      {mode === 'auto' && (
                        <Badge className="ml-2 border-0 bg-violet-500/20 text-[10px] text-violet-200">
                          {t('en.recommended')}
                        </Badge>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {COLOR_MODE_LABELS[mode].hint}
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <Eraser className="h-4 w-4 text-violet-400" /> {t('en.stains')}
              </h3>
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

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <Crop className="h-4 w-4 text-violet-400" /> {t('en.trim')}
              </h3>
              <Switch
                checked={filters.trimMargins}
                onCheckedChange={(v) => setFilters({ trimMargins: v })}
                aria-label={t('en.trim')}
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('en.trim.d')}</p>
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
                <PenLine className="h-4 w-4 text-violet-400" /> {t('en.pen')}
                <Badge className="ml-1 border-0 bg-fuchsia-500/20 text-[10px] text-fuchsia-200">
                  {t('en.badge.new')}
                </Badge>
              </h3>
              <Badge variant="secondary">{filters.penBoost}%</Badge>
            </div>
            <Slider
              value={[filters.penBoost]}
              onValueChange={(v) => setFilters({ penBoost: v[0] ?? 0 })}
              min={0}
              max={100}
              step={10}
              className="mt-3"
              aria-label={t('en.pen')}
            />
            <p className="mt-2 text-xs text-muted-foreground">{t('en.pen.d')}</p>
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
