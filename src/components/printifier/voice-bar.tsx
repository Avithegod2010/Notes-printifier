'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePrintifyStore } from '@/lib/printify-store';
import { useT } from '@/lib/i18n';
import { toast } from '@/hooks/use-toast';

/**
 * VoiceBar — speak your print settings.
 *
 * Records a short clip with MediaRecorder, sends it to /api/ai/transcribe
 * (ASR), then parses the transcript for intents (EN + Hindi keywords) and
 * applies them as settings patches. Nothing is stored anywhere.
 */

type Phase = 'idle' | 'recording' | 'processing';

interface Parsed {
  label: string;
  filters?: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

/** Deterministic intent parsing over the transcript — EN + HI keyword hits. */
function parseVoiceCommand(raw: string): Parsed[] {
  const s = raw.toLowerCase();
  const out: Parsed[] = [];
  const hit = (re: RegExp) => re.test(s);

  const grid = (rows: number, cols: number, label: string): Parsed => ({
    label,
    layout: { rows, cols, booklet: false },
  });

  if (hit(/\b(16|sixteen|सोलह)\s*(up|per|प्रति)?/)) out.push(grid(4, 4, '16-up'));
  else if (hit(/\b(9|nine|नौ)\s*(up|per|प्रति)?/)) out.push(grid(3, 3, '9-up'));
  else if (hit(/\b(6|six|छह|चह)\s*(up|per|प्रति)?/)) out.push(grid(2, 3, '6-up'));
  else if (hit(/\b(4|four|चार)\s*(up|per|प्रति)?/)) out.push(grid(2, 2, '4-up'));
  else if (hit(/\b(2|two|दो)\s*(up|per|प्रति)?/)) out.push(grid(1, 2, '2-up'));

  if (hit(/black\s*(and|&)\s*white|\bb&b\b|\bbw\b|\bकाला\b.*सफेद|काला-सफ़ेद/))
    out.push({ label: 'B&W', filters: { colorMode: 'bw' } });
  else if (hit(/gr(a|e)y\s*scale|greyscale|ग्रेस्केल|ग्रे/))
    out.push({ label: 'Grayscale', filters: { colorMode: 'grayscale' } });
  else if (hit(/invert|उलट|उल्ट/))
    out.push({ label: 'Invert', filters: { colorMode: 'invert' } });
  else if (hit(/original|keep color|रंग रख|मूल/))
    out.push({ label: 'Original', filters: { colorMode: 'original' } });
  else if (hit(/\bsmart\b|\bauto\b|स्मार्ट/))
    out.push({ label: 'Smart', filters: { colorMode: 'auto' } });

  if (hit(/save ink|ink sav|ink bachao|स्याही बच|इंक सेव/))
    out.push({ label: 'Ink saver 60', filters: { inkSaver: 60 } });
  if (hit(/booklet|बुकलेट/)) out.push({ label: 'Booklet', layout: { booklet: true } });
  if (hit(/searchable|ocr|सर्च/)) out.push({ label: 'Searchable OCR', filters: { searchable: true } });
  if (hit(/stain|daag|दाग/)) out.push({ label: 'Stain cleanup', filters: { cleanStains: true } });
  if (hit(/trim|margin|किनार/)) out.push({ label: 'Trim margins', filters: { trimMargins: true } });
  if (hit(/pen boost|handwriting|likhawat|हस्तलेखन|लिखावट/))
    out.push({ label: 'Handwriting boost', filters: { penBoost: 45 } });
  if (hit(/deskew|straighten|straight|सीधा|seedha/))
    out.push({ label: 'Auto deskew', filters: { deskew: true } });
  if (hit(/high quality|sharper|best quality|उच्च गुणवत्ता|साफ़/))
    out.push({ label: 'High quality', layout: { quality: 'high' } });
  if (hit(/cover (page|sheet)|title page|कवर/))
    out.push({ label: 'Cover page', layout: { coverSheet: true } });

  return out;
}

export function VoiceBar() {
  const t = useT();
  const step = usePrintifyStore((s) => s.step);
  const processing = usePrintifyStore((s) => s.processing);
  const setFilters = usePrintifyStore((s) => s.setFilters);
  const setLayout = usePrintifyStore((s) => s.setLayout);

  const [phase, setPhase] = useState<Phase>('idle');
  const [supported, setSupported] = useState(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== 'undefined' &&
        typeof MediaRecorder !== 'undefined' &&
        !!navigator.mediaDevices?.getUserMedia,
    );
    return () => {
      // safety: never leave a recorder running after unmount
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  const transcribeAndApply = useCallback(
    async (blob: Blob) => {
      setPhase('processing');
      try {
        const b64 = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
          fr.onerror = () => reject(new Error('read failed'));
          fr.readAsDataURL(blob);
        });
        const res = await fetch('/api/ai/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: b64, mime: blob.type }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { ok: boolean; text?: string };
        const text = (data.text ?? '').trim();
        if (!text) {
          toast({ description: t('vc.fail') });
          return;
        }
        const cmds = parseVoiceCommand(text);
        if (cmds.length === 0) {
          toast({ description: t('vc.heard', { n: text }) });
          return;
        }
        const f: Record<string, unknown> = {};
        const l: Record<string, unknown> = {};
        for (const c of cmds) Object.assign(f, c.filters ?? {});
        for (const c of cmds) Object.assign(l, c.layout ?? {});
        if (Object.keys(f).length) setFilters(f as Parameters<typeof setFilters>[0]);
        if (Object.keys(l).length) setLayout(l as Parameters<typeof setLayout>[0]);
        toast({ description: t('vc.applied', { n: cmds.map((c) => c.label).join(' · ') }) });
      } catch {
        toast({ description: t('vc.fail') });
      } finally {
        setPhase('idle');
      }
    },
    [setFilters, setLayout, t],
  );

  const start = useCallback(async () => {
    if (phase !== 'idle') return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      chunks.current = [];
      const rec = new MediaRecorder(s);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        s.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
        if (blob.size > 1000) void transcribeAndApply(blob);
        else setPhase('idle');
      };
      recorder.current = rec;
      rec.start();
      setPhase('recording');
    } catch {
      toast({ description: t('vc.nomic') });
      setPhase('idle');
    }
  }, [phase, t, transcribeAndApply]);

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    else setPhase('idle');
  }, []);

  // Hide on the upload/result steps and while a job runs.
  if (step < 1 || step > 3 || processing) return null;

  if (!supported) return null;

  return (
    <div className="mt-3 flex items-center justify-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={phase === 'recording' ? 'default' : 'outline'}
        onClick={phase === 'recording' ? stop : () => void start()}
        className={
          phase === 'recording'
            ? 'h-8 animate-pulse bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white'
            : 'h-8 border-white/15 bg-white/5 text-xs hover:bg-white/10'
        }
        aria-label={phase === 'recording' ? t('vc.stop') : t('vc.start')}
      >
        {phase === 'processing' ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {t('vc.processing')}
          </>
        ) : phase === 'recording' ? (
          <>
            <MicOff className="mr-1.5 h-3.5 w-3.5" /> {t('vc.stop')}
          </>
        ) : (
          <>
            <Mic className="mr-1.5 h-3.5 w-3.5 text-violet-300" /> {t('vc.start')}
          </>
        )}
      </Button>
      <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex">
        <Volume2 className="h-3 w-3" aria-hidden="true" /> {t('vc.hint')}
      </span>
    </div>
  );
}
