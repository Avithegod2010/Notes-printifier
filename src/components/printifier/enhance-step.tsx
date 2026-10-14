'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Crop, Droplets, Eraser, Loader2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { applyFilters, COLOR_MODE_LABELS, inkCoverage, trimCanvasMargins, type ColorMode } from '@/lib/pdf/filters';
import { loadPdfDocument } from '@/lib/pdf/pdfjs';
import { renderPageToCanvas } from '@/lib/pdf/render';
import { getDocBuffer, usePrintifyStore } from '@/lib/printify-store';

const MODES: ColorMode[] = ['original', 'invert', 'grayscale', 'bw'];

export function EnhanceStep() {
  const pages = usePrintifyStore((s) => s.pages);
  const filters = usePrintifyStore((s) => s.filters);
  const setFilters = usePrintifyStore((s) => s.setFilters);
  const setStep = usePrintifyStore((s) => s.setStep);

  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [inkBefore, setInkBefore] = useState(0);
  const [inkAfter, setInkAfter] = useState(0);
  const [busy, setBusy] = useState(false);

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
        let canvas = await renderPageToCanvas(doc, previewPage.pageNumber, {
          targetWidth: 620,
          extraRotation: previewPage.rotation,
        });
        if (cancelled) return;
        setBefore(canvas.toDataURL('image/jpeg', 0.72));
        setInkBefore(inkCoverage(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data));
        applyFilters(canvas, filters);
        if (cancelled) return;
        // Ink is measured BEFORE trimming: cropping white margins raises the
        // dark-pixel fraction without saving ink — trim saves paper instead.
        setInkAfter(inkCoverage(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data));
        if (filters.trimMargins) {
          const trimmed = trimCanvasMargins(canvas);
          if (trimmed !== canvas) canvas = trimmed;
        }
        if (cancelled) return;
        setAfter(canvas.toDataURL('image/jpeg', 0.72));
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
                Before
                <Badge variant="outline" className="border-red-400/40 text-red-300">
                  ~{Math.round(inkBefore * 100)}% ink
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
                After
                {savedPct > 0 ? (
                  <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-400/40">
                    ~{Math.round(inkAfter * 100)}% ink
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
              This filter combo reduces ink coverage by about {savedPct}% on this page
            </p>
          )}
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Preview shows the first selected page — filters apply to every page.
          </p>
        </div>

        {/* Controls */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              <Wand2 className="h-4 w-4 text-violet-400" /> Color mode
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
                      {mode === 'invert' && (
                        <Badge className="ml-2 bg-violet-500/20 text-violet-200 border-0 text-[10px]">
                          Recommended
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
                <Eraser className="h-4 w-4 text-violet-400" /> Stain cleanup
              </h3>
              <Switch
                checked={filters.cleanStains}
                onCheckedChange={(v) => setFilters({ cleanStains: v })}
                aria-label="Remove background stains"
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {filters.colorMode === 'invert'
                ? 'Recommended — clears the blue/cyan cast that dark brown & navy slide backgrounds pick up when inverted, plus inverted red key fills. Handwriting and diagrams stay.'
                : 'Wipes out light-blue watercolor marks between slides and the cyan fills behind question numbers & answer keys, while keeping handwriting, diagrams and text. Recommended for white-background notes.'}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <Crop className="h-4 w-4 text-violet-400" /> Trim margins
              </h3>
              <Switch
                checked={filters.trimMargins}
                onCheckedChange={(v) => setFilters({ trimMargins: v })}
                aria-label="Trim page margins"
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Auto-crops empty borders so content fills each grid cell — bigger,
              more readable text on the same paper. Worth it when stacking 3+
              slides per sheet.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <Droplets className="h-4 w-4 text-violet-400" /> Ink saver
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
              aria-label="Ink saver strength"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Pushes light backgrounds to pure white so your printer skips them.
              40–60 works great for dark slides.
            </p>
          </div>
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
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={() => setStep(3)}
          className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500 sm:w-auto"
        >
          Continue <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
