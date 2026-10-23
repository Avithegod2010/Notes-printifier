'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Sparkles, Stethoscope, Wand2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePrintifyStore } from '@/lib/printify-store';
import { useT, useLangStore } from '@/lib/i18n';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { HAS_SERVER_API } from '@/lib/server-api';
import { showServerFeature } from '@/components/printifier/server-feature';
import { OcrBench } from '@/components/printifier/ocr-bench-card';

/**
 * DoctorCard — "AI Print Doctor".
 *
 * Sends the document shape + current settings to /api/ai/doctor (no document
 * content ever leaves the device — only the file NAME, page count and the
 * settings blob) and renders the advice with a one-tap "Apply suggestion"
 * that patches filters/layout through the existing preset pipeline.
 *
 * Also listens for `printifier:doctor-ask` so ⌘K can trigger a consult.
 */

type Goal = 'balanced' | 'ink' | 'pages' | 'readability';

interface DoctorResponse {
  ok: boolean;
  source: 'ai' | 'heuristic';
  title: string;
  summary: string;
  tips: string[];
  patch: {
    filters?: Record<string, unknown>;
    layout?: Record<string, unknown>;
  };
}

const GOALS: Goal[] = ['balanced', 'ink', 'pages', 'readability'];

export function DoctorCard() {
  const t = useT();
  const docs = usePrintifyStore((s) => s.docs);
  const pages = usePrintifyStore((s) => s.pages);
  const filters = usePrintifyStore((s) => s.filters);
  const layout = usePrintifyStore((s) => s.layout);
  const applyPresetData = usePrintifyStore((s) => s.applyPresetData);

  const [goal, setGoal] = useState<Goal>('balanced');
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState<DoctorResponse | null>(null);
  const [applied, setApplied] = useState(false);
  const reqId = useRef(0);

  const ask = useCallback(async () => {
    if (busy) return;
    // Static build (GitHub Pages / APK): no server behind the AI doctor —
    // explain instead of firing a doomed request.
    if (!HAS_SERVER_API) {
      showServerFeature(t('dr.title'));
      return;
    }
    setBusy(true);
    setApplied(false);
    const id = ++reqId.current;
    try {
      const res = await fetch('/api/ai/doctor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lang: useLangStore.getState().lang,
          goal,
          doc: {
            name: docs.map((d) => d.name).join(', ').slice(0, 120) || 'notes.pdf',
            pages: pages.filter((p) => p.selected).length || pages.length,
            bytes: docs.reduce((s, d) => s + d.size, 0),
          },
          settings: {
            colorMode: filters.colorMode,
            inkSaver: filters.inkSaver,
            cleanStains: filters.cleanStains,
            trimMargins: filters.trimMargins,
            penBoost: filters.penBoost,
            searchable: filters.searchable,
            deskew: filters.deskew ?? false,
            logoStrip: filters.headerTrim ?? 0,
            rows: layout.rows,
            cols: layout.cols,
            pageSize: layout.pageSize,
            orientation: layout.orientation,
            quality: layout.quality,
            booklet: layout.booklet,
            duplexPad: layout.duplexPad,
            slideNumbers: layout.slideNumbers ?? false,
            noteLines: layout.noteLines ?? false,
            coverSheet: layout.coverSheet ?? false,
            sizeTargetMB: layout.sizeTargetMB ?? null,
          },
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as DoctorResponse;
      if (id !== reqId.current) return; // stale response
      if (data && data.ok) setAdvice(data);
      else throw new Error('bad payload');
    } catch {
      if (id === reqId.current) toast({ description: t('dr.fail') });
    } finally {
      if (id === reqId.current) setBusy(false);
    }
  }, [busy, docs, filters, goal, layout, pages, t]);

  // ⌘K "Ask the Print Doctor" — run a consult from the palette.
  useEffect(() => {
    const onAsk = () => void ask();
    window.addEventListener('printifier:doctor-ask', onAsk);
    return () => window.removeEventListener('printifier:doctor-ask', onAsk);
  }, [ask]);

  const apply = () => {
    if (!advice?.patch) return;
    applyPresetData(
      advice.patch.filters as Parameters<typeof applyPresetData>[0],
      advice.patch.layout as Parameters<typeof applyPresetData>[1],
    );
    setApplied(true);
    toast({ description: t('dr.applied') });
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Stethoscope className="h-4 w-4 text-fuchsia-300" /> {t('dr.title')}
          <Badge className="border-0 bg-fuchsia-500/20 text-[10px] text-fuchsia-200">
            {t('en.badge.new')}
          </Badge>
        </h3>
        {/* goal chips */}
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('dr.goal')}>
          {GOALS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGoal(g)}
              aria-pressed={goal === g}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors',
                goal === g
                  ? 'border-fuchsia-400/60 bg-fuchsia-500/15 text-foreground'
                  : 'border-white/10 bg-white/[0.03] text-muted-foreground hover:border-fuchsia-500/40 hover:text-foreground',
              )}
            >
              {t(`dr.goal.${g}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('dr.sub')}</p>

      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || docs.length === 0}
        onClick={() => void ask()}
        className="mt-3 border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-100 hover:bg-fuchsia-500/20"
      >
        {busy ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('dr.thinking')}
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4 text-fuchsia-300" />
            {advice ? t('dr.again') : t('dr.ask')}
          </>
        )}
      </Button>

      {advice && !busy && (
        <div
          role="status"
          className="mt-3 rounded-xl border border-fuchsia-400/25 bg-fuchsia-500/[0.06] p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold text-foreground">{advice.title}</p>
            {advice.source === 'heuristic' && (
              <Badge variant="outline" className="shrink-0 border-white/15 text-[10px] text-muted-foreground">
                {t('dr.offline')}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{advice.summary}</p>
          {advice.tips.length > 0 && (
            <ul className="mt-2 space-y-1">
              {advice.tips.map((tip, i) => (
                <li key={i} className="flex gap-1.5 text-xs leading-relaxed">
                  <Wand2 className="mt-0.5 h-3 w-3 shrink-0 text-fuchsia-300" aria-hidden="true" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            size="sm"
            onClick={apply}
            className="mt-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500"
          >
            {applied ? (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5" /> {t('dr.applied')}
              </>
            ) : (
              t('dr.apply')
            )}
          </Button>
        </div>
      )}

      {/* OCR accuracy benchmark — the same page through PSM 3 AND PSM 6,
          printed right here so users see why the recognition-mode switch
          exists (and one tap adopts the winner). */}
      <OcrBench />
    </div>
  );
}
