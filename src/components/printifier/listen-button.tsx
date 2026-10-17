'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePrintifyStore } from '@/lib/printify-store';
import { useT, useLangStore } from '@/lib/i18n';
import { estimateSavings, loadCostProfile } from '@/lib/savings';
import { toast } from '@/hooks/use-toast';

/**
 * ListenButton — spoken receipt.
 *
 * Builds a short summary of the finished job (in the active language), sends
 * it to /api/ai/speak and plays the returned audio. The blob is cached so a
 * second tap replays instantly without re-synthesizing.
 */

function formatRupees(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function ListenButton() {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const result = usePrintifyStore((s) => s.result);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'playing'>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<{ lang: string; url: string } | null>(null);

  // stop playback when leaving the result step
  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (cacheRef.current) URL.revokeObjectURL(cacheRef.current.url);
    },
    [],
  );

  const speak = useCallback(async () => {
    if (!result) return;

    if (phase === 'playing') {
      audioRef.current?.pause();
      setPhase('idle');
      return;
    }

    // replay the cached clip for the same language — always a fresh Audio
    // element (the compiler forbids mutating objects aliased out of refs)
    const cached = cacheRef.current;
    if (cached && cached.lang === lang) {
      audioRef.current?.pause();
      const a = new Audio(cached.url);
      a.onended = () => setPhase('idle');
      audioRef.current = a;
      try {
        await a.play();
        setPhase('playing');
      } catch {
        setPhase('idle');
      }
      return;
    }

    setPhase('loading');
    try {
      const savings = estimateSavings(
        {
          inputPages: result.inputPages,
          outputPages: result.outputPages,
          inkSavedPct: result.inkSavedPct,
          beforeInkPct: result.beforeInkPct,
        },
        loadCostProfile(),
      );

      const text =
        lang === 'hi'
          ? `आपका प्रिंट तैयार है। ${result.inputPages} पन्ने ${result.outputPages} शीट में फ़िट हुए। लगभग ${Math.round(result.inkSavedPct)} प्रतिशत स्याही बची, और अनुमानित ${formatRupees(savings.rupees)} की बचत हुई। प्रिंट करने से पहले आउटपुट एक बार ज़रूर देखें।`
          : `Your print is ready. ${result.inputPages} pages were compacted onto ${result.outputPages} sheets. About ${Math.round(result.inkSavedPct)} percent of ink saved, an estimated ${formatRupees(savings.rupees)} kept in your pocket. Preview the output once before printing.`;

      const res = await fetch('/api/ai/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang, speed: 1 }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      if (!blob.type.startsWith('audio/')) throw new Error('not audio');

      if (cacheRef.current) URL.revokeObjectURL(cacheRef.current.url);
      const url = URL.createObjectURL(blob);
      cacheRef.current = { lang, url };

      const a = new Audio(url);
      a.onended = () => setPhase('idle');
      audioRef.current = a;
      void a.play();
      setPhase('playing');
    } catch {
      toast({ description: t('rs.listenFail') });
      setPhase('idle');
    }
  }, [lang, phase, result, t]);

  if (!result) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void speak()}
      disabled={phase === 'loading'}
      className="h-9 border-white/15 bg-white/5 hover:bg-white/10"
      aria-label={phase === 'playing' ? t('rs.stop') : t('rs.listen')}
    >
      {phase === 'loading' ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('rs.loading')}
        </>
      ) : phase === 'playing' ? (
        <>
          <Pause className="mr-2 h-4 w-4 text-fuchsia-300" /> {t('rs.stop')}
        </>
      ) : (
        <>
          <Volume2 className="mr-2 h-4 w-4 text-fuchsia-300" /> {t('rs.listen')}
        </>
      )}
    </Button>
  );
}
