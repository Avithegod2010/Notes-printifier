'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  IndianRupee,
  Loader2,
  Printer,
  Sparkles,
  Target,
  Type,
} from 'lucide-react';
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
  estimateOutput,
  type PageSizeOpt,
  type QualityOpt,
} from '@/lib/pdf/compose';
import { getDocBuffer, usePrintifyStore } from '@/lib/printify-store';
import { estimateSavings, formatRupees } from '@/lib/savings';
import { useT } from '@/lib/i18n';

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

function formatMB(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Estimate {
  estBytes: number;
  inkSavedPct: number;
  beforeInkPct: number;
  sampled: number;
}

export function LayoutStep() {
  const t = useT();
  const layout = usePrintifyStore((s) => s.layout);
  const setLayout = usePrintifyStore((s) => s.setLayout);
  const pages = usePrintifyStore((s) => s.pages);
  const docs = usePrintifyStore((s) => s.docs);
  const filters = usePrintifyStore((s) => s.filters);
  const setStep = usePrintifyStore((s) => s.setStep);
  const process = usePrintifyStore((s) => s.process);
  const processing = usePrintifyStore((s) => s.processing);
  const progress = usePrintifyStore((s) => s.progress);
  const processError = usePrintifyStore((s) => s.processError);

  const selected = pages.filter((p) => p.selected);
  const perPage = layout.rows * layout.cols;
  const rawEstPages = layout.booklet
    ? bookletOutputPages(selected.length)
    : estimateOutputPages(selected.length, layout);
  // mirror the compose-time duplex pad so the estimate matches the output
  const estPages =
    layout.duplexPad && !layout.booklet && rawEstPages % 2 === 1
      ? rawEstPages + 1
      : rawEstPages;
  const paperSavedPct =
    selected.length > 0 ? Math.max(0, Math.round((1 - estPages / selected.length) * 100)) : 0;

  // ---- pre-processing estimator (#7) --------------------------------------
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const estSeq = useRef(0);

  const selectedKey = useMemo(
    () => selected.map((p) => `${p.docId}:${p.pageNumber}:${p.rotation}`).join('|'),
    [selected],
  );

  useEffect(() => {
    if (selected.length === 0 || docs.length === 0) {
      setEstimate(null);
      return;
    }
    const seq = ++estSeq.current;
    setEstimating(true);
    const timer = setTimeout(async () => {
      try {
        const buffers = docs
          .map((d) => ({ id: d.id, data: getDocBuffer(d.id) }))
          .filter((b): b is { id: number; data: ArrayBuffer } => !!b.data);
        if (buffers.length === 0) throw new Error('buffers gone');
        const result = await estimateOutput({
          buffers,
          items: selected.map((p) => ({
            docId: p.docId,
            pageNumber: p.pageNumber,
            rotation: p.rotation,
          })),
          filters,
          layout: layout.booklet
            ? { ...layout, rows: 1, cols: 2, orientation: 'landscape' }
            : layout,
        });
        if (estSeq.current === seq && result) setEstimate(result);
      } catch {
        if (estSeq.current === seq) setEstimate(null);
      } finally {
        if (estSeq.current === seq) setEstimating(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [selectedKey, layout, filters]);

  const estSavings = estimate
    ? estimateSavings({
        inputPages: selected.length,
        outputPages: estPages,
        inkSavedPct: estimate.inkSavedPct,
        beforeInkPct: estimate.beforeInkPct,
      })
    : null;

  // Auto layout suggestion from the first selected page's aspect ratio.
  const suggestion = useMemo(() => {
    const first = selected[0];
    if (!first || first.heightPt === 0) return null;
    const a = first.widthPt / first.heightPt;
    if (a >= 1.5) return { rows: 3, cols: 1, label: '3 × 1' };
    if (a >= 1.0) return { rows: 2, cols: 2, label: '2 × 2' };
    return { rows: 2, cols: 1, label: '2 × 1' };
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

  // ---- print-shop budget auto-fit (#2) ------------------------------------
  // Xerox shops charge by the sheet. Type the number of sheets you can
  // afford and we walk layouts from most aggressive down until the estimate
  // fits — instant, arithmetic, no worker round-trip.
  const [budget, setBudget] = useState('');
  const [budgetMsg, setBudgetMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const BUDGET_CANDIDATES: Array<{ rows: number; cols: number; orientation: 'portrait' | 'landscape' }> = [
    { rows: 4, cols: 2, orientation: 'landscape' },
    { rows: 3, cols: 2, orientation: 'landscape' },
    { rows: 2, cols: 2, orientation: 'portrait' },
    { rows: 3, cols: 1, orientation: 'portrait' },
    { rows: 2, cols: 1, orientation: 'portrait' },
  ];

  const fitBudget = () => {
    const limit = Math.max(1, Math.floor(Number(budget) || 0));
    setBudgetMsg(null);
    if (!limit || selected.length === 0) return;
    let last = BUDGET_CANDIDATES[0];
    for (const c of BUDGET_CANDIDATES) {
      last = c;
      const perSheet = c.rows * c.cols;
      let est = Math.ceil(selected.length / perSheet);
      if (layout.duplexPad && est % 2 === 1) est += 1;
      if (est <= limit) {
        setLayout({ rows: c.rows, cols: c.cols, orientation: c.orientation });
        setBudgetMsg({
          ok: true,
          text: t('ly.budget.fit', { n: est, per: perSheet }),
        });
        return;
      }
    }
    // nothing fits — apply the most aggressive layout anyway
    setLayout({ rows: last.rows, cols: last.cols, orientation: last.orientation });
    const perSheet = last.rows * last.cols;
    let est = Math.ceil(selected.length / perSheet);
    if (layout.duplexPad && est % 2 === 1) est += 1;
    setBudgetMsg({ ok: false, text: t('ly.budget.none', { n: est, limit }) });
  };

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
              {t('ly.suggested', { label: suggestion.label })}
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => setLayout({ rows: suggestion.rows, cols: suggestion.cols })}
              className="bg-violet-600 text-white hover:bg-violet-500"
            >
              {t('en.presets.apply')}
            </Button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ly.paper')}
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
                    'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border p-2.5 text-sm font-medium transition-colors',
                    layout.pageSize === sz
                      ? 'border-primary bg-primary/10'
                      : 'border-white/10 hover:border-white/25',
                  )}
                >
                  <RadioGroupItem value={sz} id={`ps-${sz}`} className="sr-only" />
                  {sz === 'original' ? t('ly.original') : sz.toUpperCase()}
                </Label>
              ))}
            </RadioGroup>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ly.orientation')}
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
                    'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border p-2.5 text-sm font-medium transition-colors',
                    layout.orientation === o
                      ? 'border-primary bg-primary/10'
                      : 'border-white/10 hover:border-white/25',
                  )}
                >
                  <RadioGroupItem value={o} id={`or-${o}`} className="sr-only" />
                  {o === 'portrait' ? t('ly.portrait') : t('ly.landscape')}
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
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-violet-300" />
            <p className="text-sm font-medium">{t('ly.budget.title')}</p>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('ly.budget.sub')}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={budget}
              onChange={(e) => {
                setBudget(e.target.value);
                setBudgetMsg(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') fitBudget();
              }}
              placeholder={t('ly.budget.ph')}
              aria-label={t('ly.budget.title')}
              className="sm:max-w-[140px]"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!budget || selected.length === 0}
              onClick={fitBudget}
              className="shrink-0 border-violet-400/40 text-violet-200 hover:bg-violet-500/15"
            >
              {t('ly.budget.go')}
            </Button>
          </div>
          {budgetMsg && (
            <p
              role="status"
              className={cn(
                'mt-2 rounded-lg px-3 py-2 text-xs font-semibold',
                budgetMsg.ok
                  ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border border-amber-500/30 bg-amber-500/10 text-amber-300',
              )}
            >
              {budgetMsg.text}
            </p>
          )}
        </div>

        <div
          className={cn(
            'rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-opacity',
            layout.booklet && 'pointer-events-none opacity-40',
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('ly.perPage')}
            </p>
            <Badge variant="secondary">
              {layout.booklet ? t('ly.perPageN', { n: 2 }) : t('ly.perPageN', { n: perPage })}
            </Badge>
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
              <p className="mb-1.5 text-xs text-muted-foreground">{t('ly.rows')}</p>
              <Select
                value={String(layout.rows)}
                onValueChange={(v) => setLayout({ rows: Number(v) })}
              >
                <SelectTrigger aria-label={t('ly.rows')}>
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
              <p className="mb-1.5 text-xs text-muted-foreground">{t('ly.cols')}</p>
              <Select
                value={String(layout.cols)}
                onValueChange={(v) => setLayout({ cols: Number(v) })}
              >
                <SelectTrigger aria-label={t('ly.cols')}>
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

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div
            className={cn(
              'flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-opacity',
              layout.booklet && 'pointer-events-none opacity-40',
            )}
          >
            <div>
              <p className="text-sm font-medium">{t('ly.separators')}</p>
              <p className="text-xs text-muted-foreground">{t('ly.separatorsSub')}</p>
            </div>
            <Switch
              checked={layout.separators}
              onCheckedChange={(v) => setLayout({ separators: v })}
              aria-label={t('ly.separators')}
            />
          </div>
          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div>
              <p className="text-sm font-medium">{t('ly.pageNums')}</p>
              <p className="text-xs text-muted-foreground">{t('ly.pageNumsSub')}</p>
            </div>
            <Switch
              checked={layout.pageNumbers}
              onCheckedChange={(v) => setLayout({ pageNumbers: v })}
              aria-label={t('ly.pageNums')}
            />
          </div>
          <div
            className={cn(
              'flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-opacity',
              layout.booklet && 'pointer-events-none opacity-40',
            )}
          >
            <div className="pr-2">
              <p className="text-sm font-medium">{t('ly.duplexPad')}</p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                {t('ly.duplexPadSub')}
              </p>
            </div>
            <Switch
              checked={layout.duplexPad}
              onCheckedChange={(v) => setLayout({ duplexPad: v })}
              aria-label={t('ly.duplexPad')}
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
                <BookOpen className="h-4 w-4 text-violet-300" /> {t('ly.booklet')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('ly.bookletSub')}</p>
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
              aria-label={t('ly.booklet')}
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-2 flex items-center gap-2">
              <Type className="h-4 w-4 text-violet-300" />
              <p className="text-sm font-medium">{t('ly.footer')}</p>
              <span className="text-xs text-muted-foreground">{t('ly.footerOpt')}</span>
            </div>
            <Input
              value={layout.footerLabel ?? ''}
              onChange={(e) => setLayout({ footerLabel: e.target.value.slice(0, 60) })}
              placeholder={t('ly.footerPh')}
              maxLength={60}
              aria-label="Footer label printed on every sheet"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">{t('ly.footerNote')}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('ly.quality')}
          </p>
          <RadioGroup
            value={layout.quality}
            onValueChange={(v) => setLayout({ quality: v as QualityOpt })}
            className="flex flex-col gap-2 sm:flex-row"
          >
            {(
              [
                { v: 'low', t: t('ly.q.low'), d: t('ly.q.lowD') },
                { v: 'medium', t: t('ly.q.med'), d: t('ly.q.medD') },
                { v: 'high', t: t('ly.q.high'), d: t('ly.q.highD') },
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
            {t('ly.preview')}
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
                  const th = previewThumbs[i];
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
                      {th ? (
                        <img
                          src={th.thumb}
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
                {t('ly.inPages')}
              </p>
            </div>
            <div className="rounded-lg bg-primary/10 p-2">
              <p className="text-lg font-bold text-primary">{estPages}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t('ly.outPages')}
              </p>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-2">
              <p className="text-lg font-bold text-emerald-400">{paperSavedPct}%</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t('ly.paperSaved')}
              </p>
            </div>
          </div>

          {/* Pre-processing estimator (#7) */}
          {(estimating || estimate) && (
            <div className="mt-3 rounded-xl border border-violet-400/25 bg-violet-500/[0.07] p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-300">
                <IndianRupee className="h-3.5 w-3.5" /> {t('ly.estimate')}
                {estimating && <Loader2 className="h-3 w-3 animate-spin" />}
              </p>
              {estimate ? (
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  <li>{t('ly.estSize', { size: formatMB(estimate.estBytes) })}</li>
                  <li>{t('ly.estInk', { n: estimate.inkSavedPct })}</li>
                  {estSavings && estSavings.rupees > 0 && (
                    <li className="font-semibold text-emerald-300">
                      {t('ly.estCost', { rs: formatRupees(estSavings.rupees) })}
                    </li>
                  )}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t('ly.estSampling', { n: 4 })}
                </p>
              )}
            </div>
          )}
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
              {progress.ocr
                ? t('en.ocr.page', { n: progress.done, t: progress.total })
                : t('ly.processing', { d: progress.done, t: progress.total })}
            </p>
            <p className="text-[11px] text-muted-foreground">{t('ly.processingBg')}</p>
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
              <ArrowLeft className="mr-2 h-4 w-4" /> {t('up.back')}
            </Button>
            <Button
              type="button"
              size="lg"
              onClick={() => void process()}
              disabled={selected.length === 0}
              className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500 sm:w-auto"
            >
              <Printer className="mr-2 h-4 w-4" /> {t('ly.process')}
            </Button>
          </div>
        )}

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
          {layout.booklet ? t('ly.bookletNote') : t('ly.qualityNote')}
        </p>
      </div>
    </div>
  );
}
