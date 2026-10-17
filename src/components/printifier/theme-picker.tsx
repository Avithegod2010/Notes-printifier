'use client';

import { Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useT } from '@/lib/i18n';
import { PATTERNS, THEMES, useThemeStore, type PatternId, type ThemeId } from '@/lib/theme';

/**
 * ThemePicker — select one of 6 site themes and a backdrop pattern.
 * Everything is applied instantly (CSS-var swap) and persisted per device.
 */

const THEME_NAME_KEY: Record<ThemeId, string> = {
  violet: 'th.violet',
  paper: 'th.paper',
  cyber: 'th.cyber',
  matrix: 'th.matrix',
  ember: 'th.ember',
  rose: 'th.rose',
};

const PATTERN_NAME_KEY: Record<PatternId, string> = {
  grid: 'pat.grid',
  dots: 'pat.dots',
  hex: 'pat.hex',
  weave: 'pat.weave',
  none: 'pat.none',
};

/** Tiny CSS-painted previews for the pattern chips. */
const PATTERN_PREVIEW: Record<PatternId, React.CSSProperties> = {
  grid: {
    backgroundImage:
      'linear-gradient(rgba(139,92,246,.55) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,.55) 1px, transparent 1px)',
    backgroundSize: '7px 7px',
  },
  dots: {
    backgroundImage: 'radial-gradient(rgba(139,92,246,.65) 1.1px, transparent 1.4px)',
    backgroundSize: '7px 7px',
  },
  hex: {
    backgroundImage:
      'linear-gradient(30deg, rgba(139,92,246,.5) 12%, transparent 12.5% 87.5%, rgba(139,92,246,.5) 87.5%), linear-gradient(150deg, rgba(139,92,246,.5) 12%, transparent 12.5% 87.5%, rgba(139,92,246,.5) 87.5%)',
    backgroundSize: '14px 24px',
  },
  weave: {
    backgroundImage:
      'repeating-linear-gradient(45deg, rgba(139,92,246,.55) 0 1px, transparent 1px 5px), repeating-linear-gradient(-45deg, rgba(139,92,246,.55) 0 1px, transparent 1px 5px)',
  },
  none: {},
};

export function ThemePicker() {
  const t = useT();
  const themeId = useThemeStore((s) => s.themeId);
  const pattern = useThemeStore((s) => s.pattern);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setPattern = useThemeStore((s) => s.setPattern);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={t('th.pick')}
          title={t('th.pick')}
          className="h-9 w-9 border-white/15 bg-white/5 p-0 text-muted-foreground hover:bg-white/10 hover:text-foreground"
        >
          <Palette className="h-4 w-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[21rem] rounded-2xl border-white/10 bg-popover p-4">
        <div className="mb-1 flex items-center gap-2">
          <Palette className="h-4 w-4 text-violet-300" aria-hidden="true" />
          <p className="text-sm font-bold">{t('th.pick')}</p>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t('th.pickSub')}</p>

        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((th) => {
            const active = th.id === themeId;
            return (
              <button
                key={th.id}
                type="button"
                onClick={() => setTheme(th.id)}
                aria-pressed={active}
                className={
                  'flex items-center gap-2 rounded-xl border p-2.5 text-left transition-colors ' +
                  (active
                    ? 'border-violet-400/60 bg-violet-500/10'
                    : 'border-white/10 bg-white/[0.03] hover:border-violet-500/40')
                }
              >
                <span className="flex shrink-0 -space-x-1.5">
                  {th.swatch.map((c, i) => (
                    <span
                      key={i}
                      className="inline-block h-3.5 w-3.5 rounded-full border border-white/20"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">
                  {t(THEME_NAME_KEY[th.id])}
                </span>
                {active && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>

        <p className="mb-2 mt-4 text-xs font-semibold text-muted-foreground">{t('pat.pick')}</p>
        <div className="flex flex-wrap gap-1.5">
          {PATTERNS.map((p) => {
            const active = p === pattern;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPattern(p)}
                aria-pressed={active}
                className={
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ' +
                  (active
                    ? 'border-violet-400/60 bg-violet-500/10 text-foreground'
                    : 'border-white/10 bg-white/[0.03] text-muted-foreground hover:border-violet-500/40 hover:text-foreground')
                }
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-3.5 w-3.5 shrink-0 rounded-[4px] border border-white/20 bg-white/5"
                  style={PATTERN_PREVIEW[p]}
                />
                {t(PATTERN_NAME_KEY[p])}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
