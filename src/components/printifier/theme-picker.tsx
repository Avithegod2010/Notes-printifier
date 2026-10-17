'use client';

import { Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useT } from '@/lib/i18n';
import { PATTERNS, THEMES, useThemeStore, type PatternId, type ThemeId } from '@/lib/theme';

/**
 * ThemePicker — select one of 12 site themes and a backdrop pattern.
 * Everything is applied instantly (CSS-var swap) and persisted per device.
 */

const THEME_NAME_KEY: Record<ThemeId, string> = {
  violet: 'th.violet',
  paper: 'th.paper',
  cyber: 'th.cyber',
  matrix: 'th.matrix',
  ember: 'th.ember',
  rose: 'th.rose',
  crimson: 'th.crimson',
  ocean: 'th.ocean',
  nord: 'th.nord',
  noir: 'th.noir',
  sand: 'th.sand',
  mint: 'th.mint',
};

const PATTERN_NAME_KEY: Record<PatternId, string> = {
  grid: 'pat.grid',
  dots: 'pat.dots',
  hex: 'pat.hex',
  weave: 'pat.weave',
  topo: 'pat.topo',
  circuit: 'pat.circuit',
  waves: 'pat.waves',
  diag: 'pat.diag',
  plus: 'pat.plus',
  none: 'pat.none',
};

/* Tiny previews for the pattern chips. Simple variants are CSS-painted;
   mask-painted variants reuse their SVG artwork with a fixed violet tint. */
const VIOLET = 'rgba(139,92,246,0.55)';
const PATTERN_PREVIEW: Record<PatternId, React.CSSProperties> = {
  grid: {
    backgroundImage: `linear-gradient(${VIOLET} 1px, transparent 1px), linear-gradient(90deg, ${VIOLET} 1px, transparent 1px)`,
    backgroundSize: '7px 7px',
  },
  dots: {
    backgroundImage: 'radial-gradient(rgba(139,92,246,.65) 1.1px, transparent 1.4px)',
    backgroundSize: '7px 7px',
  },
  hex: {
    backgroundImage: `linear-gradient(30deg, ${VIOLET} 12%, transparent 12.5% 87.5%, ${VIOLET} 87.5%), linear-gradient(150deg, ${VIOLET} 12%, transparent 12.5% 87.5%, ${VIOLET} 87.5%)`,
    backgroundSize: '14px 24px',
  },
  weave: {
    backgroundImage: `repeating-linear-gradient(45deg, ${VIOLET} 0 1px, transparent 1px 5px), repeating-linear-gradient(-45deg, ${VIOLET} 0 1px, transparent 1px 5px)`,
  },
  topo: {
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' fill='none' stroke='rgba(139,92,246,0.75)' stroke-width='1.2'%3E%3Ccircle cx='11' cy='11' r='3.5'/%3E%3Ccircle cx='11' cy='11' r='7.5'/%3E%3Ccircle cx='19' cy='18' r='2.5'/%3E%3C/svg%3E\")",
    backgroundSize: '24px 24px',
  },
  circuit: {
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' fill='none' stroke='rgba(139,92,246,0.75)' stroke-width='1.3' stroke-linecap='round'%3E%3Cpath d='M3 3h9v5h5'/%3E%3Cpath d='M21 3v9h-4'/%3E%3Cpath d='M3 21h6v-5'/%3E%3Ccircle cx='17' cy='8' r='1.2' fill='rgba(139,92,246,0.75)' stroke='none'/%3E%3Ccircle cx='9' cy='16' r='1.2' fill='rgba(139,92,246,0.75)' stroke='none'/%3E%3C/svg%3E\")",
    backgroundSize: '24px 24px',
  },
  waves: {
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' fill='none' stroke='rgba(139,92,246,0.75)' stroke-width='1.3' stroke-linecap='round'%3E%3Cpath d='M0 7 Q4 4 8 7 T16 7 T24 7'/%3E%3Cpath d='M0 17 Q4 14 8 17 T16 17 T24 17'/%3E%3C/svg%3E\")",
    backgroundSize: '24px 24px',
  },
  diag: {
    backgroundImage:
      'linear-gradient(45deg, transparent 46%, rgba(139,92,246,.55) 46% 54%, transparent 54%)',
    backgroundSize: '7px 7px',
  },
  plus: {
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='rgba(139,92,246,0.8)' stroke-width='1.4' stroke-linecap='round'%3E%3Cpath d='M6 3.5v5M3.5 6h5'/%3E%3C/svg%3E\")",
    backgroundSize: '12px 12px',
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
      <PopoverContent align="end" className="w-[23rem] rounded-2xl border-white/10 bg-popover p-4">
        <div className="mb-1 flex items-center gap-2">
          <Palette className="h-4 w-4 text-violet-300" aria-hidden="true" />
          <p className="text-sm font-bold">{t('th.pick')}</p>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t('th.pickSub')}</p>

        <div className="grid grid-cols-3 gap-1.5">
          {THEMES.map((th) => {
            const active = th.id === themeId;
            return (
              <button
                key={th.id}
                type="button"
                onClick={() => setTheme(th.id)}
                aria-pressed={active}
                title={t(THEME_NAME_KEY[th.id])}
                className={
                  'flex flex-col items-center gap-1.5 rounded-xl border px-1.5 py-2 text-center transition-colors ' +
                  (active
                    ? 'border-violet-400/60 bg-violet-500/10'
                    : 'border-white/10 bg-white/[0.03] hover:border-violet-500/40')
                }
              >
                <span className="flex -space-x-1">
                  {th.swatch.map((c, i) => (
                    <span
                      key={i}
                      className="inline-block h-3 w-3 rounded-full border border-white/20"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
                <span className="w-full truncate text-[10px] font-semibold leading-none">
                  {t(THEME_NAME_KEY[th.id])}
                </span>
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
