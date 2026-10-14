'use client';

import { useMemo } from 'react';
import { ArrowLeft, BookOpen, Loader2, Printer, Sparkles, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import {
  bookletOutputPages,
  estimateOutputPages,
  type PageSizeOpt,
  type QualityOpt,
} from '@/lib/pdf/compose';
import { usePrintifyStore } from '@/lib/printify-store';

const ROWS = ['1', '2', '3', '4'];
const PRESETS: Array<{ label: string; rows: number; cols: number }> = [
  { label: '1 × 1', rows: 1, cols: 1 },
  { label: '2 × 1', rows: 2, cols: 1 },
  { label: '3 × 1', rows: 3, cols: 1 },
  { label: '2 × 2', rows: 2, cols: 2 },
  { label: '3 × 2', rows: 3, cols: 2 },
  { label: '4 × 2', rows: 4, cols: 2 },
];

const PAGE_ASPECT: Record<Exclude<PageSizeOpt, 'original'>, number> = {
  a4: 595.28 / 841.89,
  letter: 612 / 792,
};

export function LayoutStep() {
  const layout = usePrintifyStore((s) => s.layout);
  const setLayout = usePrintifyStore((s) => s.setLayout);
  const pages = usePrintifyStore((s) => s.pages);
  const setStep = usePrintifyStore((s) => s.setStep);
  const process = usePrintifyStore((s) => s.process);
  const processing = usePrintifyStore((s) => s.processing);
  const progress = usePrintifyStore((s) => s.progress);
  const processError = usePrintifyStore((s) => s.processError);

  const selected = pages.filter((p) => p.selected);
  const perPage = layout.rows * layout.cols;
  const estPages = layout.booklet
    ? bookletOutputPages(selected.length)
    : estimateOutputPages(selected.length, layout);
  const paperSavedPct =
    selected.length > 0 ? Math.max(0, Math.round((1 - estPages / selected.length) * 100)) : 0;

  // Auto layout suggestion from the first selected page's aspect ratio.
  const suggestion = useMemo(() => {
    const first = selected[0];
    if (!first || first.heightPt === 0) return null;
    const a = first.widthPt / first.heightPt;
    if (a >= 1.5) return { rows: 3, cols: 1, label: '3 slides per sheet' };
    if (a >= 1.0) return { rows: 2, cols: 2, label: '4 slides per sheet' };
    return { rows: 2, cols: 1, label: '2 pages per sheet' };
  }, [selected[0]?.id, selected[0]?.widthPt, selected[0]?.heightPt]);
  const suggestionApplies =
    !!suggestion && !layout.booklet &&
    (layout.rows !== suggestion.rows || layout.cols !== suggestion.cols);

  const aspect =
    layout.pageSize === 'original' && selected[0]
      ? selected[0].widthPt / selected[0].heightPt
      : PAGE_ASPECT[layout.pageSize];
  const previewAspect = layout.orientation === 'landscape' ? 1 / aspect : aspect;

  const previewThumbs = selected.slice(0, perPage);

  const processPct = progress
    ? Math.round((progress.done / Math.max(1, progress.total)) * 100)
    : 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      {/* Settings */}
      <div className="space-y-4">
        {suggestionApplies && suggestion && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-3">
            <p className="flex items-center gap-2 text-sm text-violet-200">
              <Sparkles className="h-4 w-4 text-violet-300" />
              Suggested for this PDF: {suggestion.label}
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => setLayout({ rows: suggestion.rows, cols: suggestion.cols })}
              className="bg-violet-600 text-white hover:bg-violet-500"
            >
              Apply
            </Button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Paper size
            </p>
            <RadioGroup
              value={layout.pageSize}
              onValueChange={(v) => setLayout({ pageSize: v as PageSizeOpt })}
              className="flex gap-2"
            >
              {(['a4', 'letter', 'original'] as const).map((sz) => (
                <Label
                  key={sz}
                  htmlFor={`ps-${sz}`}
                  className={cn(
                    'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border p-2.5 text-sm font-medium capitalize transition-colors',
                    layout.pageSize === sz
                      ? 'border-primary bg-primary/10'
                      : 'border-white/10 hover:border-white/25',
                  )}
                >
                  <RadioGroupItem value={sz} id={`ps-${sz}`} className="sr-only" />
                  {sz === 'original' ? 'Original' : sz.toUpperCase()}
                </Label>
              ))}
            </RadioGroup>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Orientation
            </p>
            <RadioGroup
              value={layout.orientation}
              onValueChange={(v) => setLayout({ orientation: v as 'portrait' | 'landscape' })}
              className="flex gap-2"
            >
              {(['portrait', 'landscape'] as const).map((o) => (
                <Label
                  key={o}
                  htmlFor={`or-${o}`}
                  className={cn(
                    'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border p-2.5 text-sm font-medium capitalize transition-colors',
                    layout.orientation === o
                      ? 'border-primary bg-primary/10'
                      : 'border-white/10 hover:border-white/25',
                  )}
                >
                  <RadioGroupItem value={o} id={`or-${o}`} className="sr-only" />
                  {o}
                </Label>
              ))}
            </RadioGroup>
          </div>
        </div>

        <div
          className={cn(
            'rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-opacity',
            layout.booklet && 'pointer-events-none opacity-40',
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Slides per page
            </p>
            <Badge variant="secondary">{layout.booklet ? 2 : perPage} per page</Badge>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLayout({ rows: p.rows, cols: p.cols })}
                className={cn(
                  'h-8',
                  layout.rows === p.rows && layout.cols === p.cols
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'text-muted-foreground',
                )}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">Rows</p>
              <Select
                value={String(layout.rows)}
                onValueChange={(v) => setLayout({ rows: Number(v) })}
              >
                <SelectTrigger aria-label="Rows">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROWS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">Columns</p>
              <Select
                value={String(layout.cols)}
                onValueChange={(v) => setLayout({ cols: Number(v) })}
              >
                <SelectTrigger aria-label="Columns">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROWS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div
            className={cn(
              'flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-opacity',
              layout.booklet && 'pointer-events-none opacity-40',
            )}
          >
            <div>
              <p className="text-sm font-medium">Separation lines</p>
              <p className="text-xs text-muted-foreground">Between slides</p>
            </div>
            <Switch
              checked={layout.separators}
              onCheckedChange={(v) => setLayout({ separators: v })}
              aria-label="Separation lines"
            />
          </div>
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div>
              <p className="text-sm font-medium">Page numbers</p>
              <p className="text-xs text-muted-foreground">At the bottom</p>
            </div>
            <Switch
              checked={layout.pageNumbers}
              onCheckedChange={(v) => setLayout({ pageNumbers: v })}
              aria-label="Page numbers"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div
            className={cn(
              'flex items-center justify-between rounded-2xl border p-4 transition-colors',
              layout.booklet
                ? 'border-violet-500/50 bg-violet-500/10'
                : 'border-white/10 bg-white/[0.03]',
            )}
          >
            <div className="pr-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <BookOpen className="h-4 w-4 text-violet-300" /> Booklet mode
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                2-up, re-ordered for fold-in-half booklets
              </p>
            </div>
            <Switch
              checked={layout.booklet}
              onCheckedChange={(v) =>
                setLayout(
                  v
                    ? { booklet: true, rows: 1, cols: 2, orientation: 'landscape' }
                    : { booklet: false },
                )
              }
              aria-label="Booklet layout"
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-2 flex items-center gap-2">
              <Type className="h-4 w-4 text-violet-300" />
              <p className="text-sm font-medium">Footer label</p>
              <span className="text-xs text-muted-foreground">(optional)</span>
            </div>
            <Input
              value={layout.footerLabel ?? ''}
              onChange={(e) => setLayout({ footerLabel: e.target.value.slice(0, 60) })}
              placeholder="e.g. PHY · L3 · Centre of Mass"
              maxLength={60}
              aria-label="Footer label printed on every sheet"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Printed small at the bottom-left of every sheet.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Output quality
          </p>
          <RadioGroup
            value={layout.quality}
            onValueChange={(v) => setLayout({ quality: v as QualityOpt })}
            className="flex flex-col gap-2 sm:flex-row"
          >
            {(
              [
                { v: 'low', t: 'Low', d: 'Smallest file · 96 DPI' },
                { v: 'medium', t: 'Medium', d: 'Balanced · 150 DPI' },
                { v: 'high', t: 'High', d: 'Crisp text · 210 DPI' },
              ] as const
            ).map((q) => (
              <Label
                key={q.v}
                htmlFor={`q-${q.v}`}
                className={cn(
                  'flex flex-1 cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors',
                  layout.quality === q.v
                    ? 'border-primary bg-primary/10'
                    : 'border-white/10 hover:border-white/25',
                )}
              >
                <RadioGroupItem value={q.v} id={`q-${q.v}`} />
                <span>
                  <span className="block text-sm font-medium">{q.t}</span>
                  <span className="block text-xs text-muted-foreground">{q.d}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </div>
      </div>

      {/* Preview + actions */}
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Layout preview
          </p>
          <div className="flex justify-center">
            <div
              className="w-full max-w-[240px] rounded-lg bg-white p-[4%] shadow-2xl"
              style={{ aspectRatio: String(previewAspect) }}
            >
              <div
                className="grid h-full w-full"
                style={{
                  gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
                  gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
                  gap: layout.separators ? '6px' : '2px',
                }}
              >
                {Array.from({ length: perPage }).map((_, i) => {
                  const t = previewThumbs[i];
                  const hasRight = i % layout.cols < layout.cols - 1 && !!previewThumbs[i + 1];
                  const hasBottom =
                    i + layout.cols < perPage && !!previewThumbs[i + layout.cols];
                  return (
                    <div
                      key={i}
                      className={cn(
                        'flex items-center justify-center overflow-hidden rounded-[2px] bg-zinc-100',
                        layout.separators && hasRight && 'border-r border-zinc-300',
                        layout.separators && hasBottom && 'border-b border-zinc-300',
                      )}
                    >
                      {t ? (
                        <img
                          src={t.thumb}
                          alt={`Slide ${i + 1} in layout preview`}
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <div className="h-full w-full rounded-[2px] bg-zinc-50" />
                      )}
                    </div>
                  );
                })}
              </div>
              {layout.pageNumbers && (
                <div className="mt-1 text-center text-[8px] leading-none text-zinc-400">
                  1
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-white/5 p-2">
              <p className="text-lg font-bold">{selected.length}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Input pages
              </p>
            </div>
            <div className="rounded-lg bg-primary/10 p-2">
              <p className="text-lg font-bold text-primary">{estPages}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Output pages
              </p>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-2">
              <p className="text-lg font-bold text-emerald-400">{paperSavedPct}%</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Paper saved
              </p>
            </div>
          </div>
        </div>

        {processError && (
          <Alert variant="destructive">
            <AlertDescription>{processError}</AlertDescription>
          </Alert>
        )}

        {processing && progress ? (
          <div className="space-y-2 rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <Progress value={processPct} className="h-2" />
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Processing page {progress.done} of {progress.total}… keep this tab open.
            </p>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full sm:w-auto"
              onClick={() => setStep(2)}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <Button
              type="button"
              size="lg"
              onClick={() => void process()}
              disabled={selected.length === 0}
              className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500 sm:w-auto"
            >
              <Printer className="mr-2 h-4 w-4" /> Process File
            </Button>
          </div>
        )}

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
          {layout.booklet
            ? 'Booklet: print 2-up duplex with “flip on short edge”, then fold — the separator line is your fold guide.'
            : 'Final PDF is generated in high quality — previews above are low-res.'}
        </p>
      </div>
    </div>
  );
}
