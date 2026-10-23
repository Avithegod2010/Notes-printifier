'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUp,
  BookmarkPlus,
  Calculator,
  Command as CommandIcon,
  FileQuestion,
  Keyboard,
  Languages,
  Leaf,
  Moon,
  Palette as PaletteIcon,
  Play,
  RotateCcw,
  Sparkles,
  Stethoscope,
  Sun,
  Upload,
  Wand2,
  Zap,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useT, useLangStore, LANGUAGES } from '@/lib/i18n';
import { usePrintifyStore } from '@/lib/printify-store';
import {
  PATTERNS,
  THEMES,
  useThemeStore,
  type PatternId,
  type ThemeId,
} from '@/lib/theme';
import { toast } from '@/hooks/use-toast';

/**
 * CommandPalette — ⌘K / Ctrl+K quick actions for power users.
 *
 * Covers the whole app from the keyboard: process & reset, section jumps,
 * all 12 themes + 10 patterns, saved presets, language and the theme flip.
 * Also hosts the "?" shortcuts help dialog.
 *
 * Opening is wired three ways: the global key listener below, a header /
 * sheet button that dispatches `printifier:palette`, and the palette item
 * inside the shortcuts help.
 */

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const SECTION_ITEMS = [
  { id: 'how', key: 'nav.how', icon: Wand2 },
  { id: 'features', key: 'nav.features', icon: Sparkles },
  { id: 'calculator', key: 'nav.calc', icon: Calculator },
  { id: 'impact', key: 'cp.impact', icon: Leaf },
  { id: 'faq', key: 'nav.faq', icon: FileQuestion },
] as const;

/** Human labels for voice/palette-applied pattern names. */
const PATTERN_KEY: Record<PatternId, string> = {
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

const THEME_KEY: Record<ThemeId, string> = {
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
  blueprint: 'th.blueprint',
  kraft: 'th.kraft',
  chai: 'th.chai',
  festive: 'th.festive',
  xerox: 'th.xerox',
  ohp: 'th.ohp',
};

function openPalette() {
  window.dispatchEvent(new CustomEvent('printifier:palette'));
}

export function CommandPalette() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // app state slices (component subscribes only while mounted — cheap)
  const step = usePrintifyStore((s) => s.step);
  const processing = usePrintifyStore((s) => s.processing);
  const presets = usePrintifyStore((s) => s.presets);
  const process = usePrintifyStore((s) => s.process);
  const reset = usePrintifyStore((s) => s.reset);
  const applyPreset = usePrintifyStore((s) => s.applyPreset);

  const themeId = useThemeStore((s) => s.themeId);
  const pattern = useThemeStore((s) => s.pattern);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setPattern = useThemeStore((s) => s.setPattern);
  const flip = useThemeStore((s) => s.flip);

  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      // Alt+T — quick light/dark flip (documented in the shortcuts help)
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        useThemeStore.getState().flip();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    const onEvt = () => setOpen(true);
    const onHelp = () => setHelpOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('printifier:palette', onEvt);
    window.addEventListener('printifier:shortcuts', onHelp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('printifier:palette', onEvt);
      window.removeEventListener('printifier:shortcuts', onHelp);
    };
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    // let the dialog close before heavy work / scrolling
    setTimeout(fn, 60);
  };

  const canProcess = step >= 1 && step <= 3 && !processing;

  const presetsItems = useMemo(() => presets.slice(0, 10), [presets]);

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <div className="sr-only">
          <h2>{t('cp.open')}</h2>
          <p>{t('cp.ph')}</p>
        </div>
        <CommandInput placeholder={t('cp.ph')} />
        <CommandList className="pretty-scroll">
          <CommandEmpty>{t('cp.none')}</CommandEmpty>

          <CommandGroup heading={t('cp.actions')}>
            <CommandItem
              value={t('cp.process')}
              disabled={!canProcess}
              onSelect={() => run(() => void process())}
            >
              <Play className="mr-2 h-4 w-4 text-emerald-400" />
              <div className="flex flex-1 flex-col">
                <span>{t('cp.process')}</span>
                <span className="text-[11px] text-muted-foreground">{t('cp.processHint')}</span>
              </div>
            </CommandItem>
            <CommandItem
              value={t('cp.upload')}
              onSelect={() =>
                run(() => {
                  scrollToId('app');
                  if (step > 0) reset();
                })
              }
            >
              <Upload className="mr-2 h-4 w-4 text-violet-300" />
              <span>{t('cp.upload')}</span>
            </CommandItem>
            <CommandItem
              value={t('cp.reset')}
              disabled={step === 0 && !processing}
              onSelect={() =>
                run(() => {
                  reset();
                  toast({ description: t('cp.resetDone') });
                })
              }
            >
              <RotateCcw className="mr-2 h-4 w-4 text-red-400" />
              <span>{t('cp.reset')}</span>
            </CommandItem>
            {step >= 2 && step <= 3 && (
              <CommandItem
                value={t('cp.doctor')}
                onSelect={() =>
                  run(() => {
                    scrollToId('app');
                    window.dispatchEvent(new CustomEvent('printifier:doctor-ask'));
                  })
                }
              >
                <Stethoscope className="mr-2 h-4 w-4 text-fuchsia-300" />
                <span>{t('cp.doctor')}</span>
              </CommandItem>
            )}
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading={t('cp.navigate')}>
            {SECTION_ITEMS.map((s) => (
              <CommandItem
                key={s.id}
                value={`${t(s.key)} ${s.id}`}
                onSelect={() => run(() => scrollToId(s.id))}
              >
                <s.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>{t(s.key)}</span>
              </CommandItem>
            ))}
            <CommandItem value={t('cp.top')} onSelect={() => run(() => window.scrollTo({ top: 0, behavior: 'smooth' }))}>
              <ArrowUp className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{t('cp.top')}</span>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading={t('cp.themes')}>
            {THEMES.map((th) => (
              <CommandItem
                key={th.id}
                value={`${t(THEME_KEY[th.id])} theme`}
                onSelect={() => run(() => setTheme(th.id))}
              >
                <span className="mr-2 flex shrink-0 -space-x-1">
                  {th.swatch.map((c, i) => (
                    <span
                      key={i}
                      className="inline-block h-3.5 w-3.5 rounded-full border border-white/25"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
                <span className="flex-1">{t(THEME_KEY[th.id])}</span>
                {themeId === th.id && <Zap className="h-3.5 w-3.5 text-violet-300" />}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading={t('cp.patterns')}>
            {PATTERNS.map((p) => (
              <CommandItem
                key={p}
                value={`${t(PATTERN_KEY[p])} pattern`}
                onSelect={() => run(() => setPattern(p))}
              >
                <PaletteIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{t(PATTERN_KEY[p])}</span>
                {pattern === p && <Zap className="h-3.5 w-3.5 text-violet-300" />}
              </CommandItem>
            ))}
          </CommandGroup>

          {presetsItems.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t('cp.presets')}>
                {presetsItems.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`${p.name} preset`}
                    onSelect={() =>
                      run(() => {
                        applyPreset(p.id);
                        toast({ description: t('cp.presetApplied', { n: p.name }) });
                      })
                    }
                  >
                    <BookmarkPlus className="mr-2 h-4 w-4 text-violet-300" />
                    <span className="flex-1 truncate">{p.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          <CommandSeparator />
          <CommandGroup heading={t('cp.settings')}>
            <CommandItem
              value={t('cp.flip')}
              onSelect={() => run(() => flip())}
            >
              {themeId && THEMES.find((x) => x.id === themeId)?.light ? (
                <Moon className="mr-2 h-4 w-4 text-muted-foreground" />
              ) : (
                <Sun className="mr-2 h-4 w-4 text-muted-foreground" />
              )}
              <span>{t('cp.flip')}</span>
              <kbd className="ml-auto rounded border border-white/15 bg-white/5 px-1.5 font-mono text-[10px]">
                ⌥T
              </kbd>
            </CommandItem>
            <CommandItem
              value={`${t('cp.lang')} language`}
              onSelect={() =>
                run(() => {
                  const idx = LANGUAGES.findIndex((l) => l.id === lang);
                  setLang(LANGUAGES[(idx + 1) % LANGUAGES.length].id);
                })
              }
            >
              <Languages className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>
                {t('cp.lang')} ·{' '}
                {LANGUAGES[(LANGUAGES.findIndex((l) => l.id === lang) + 1) % LANGUAGES.length].native}
              </span>
            </CommandItem>
            <CommandItem value={t('cp.shortcuts')} onSelect={() => { setOpen(false); setTimeout(() => setHelpOpen(true), 60); }}>
              <Keyboard className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{t('cp.shortcuts')}</span>
              <kbd className="ml-auto rounded border border-white/15 bg-white/5 px-1.5 font-mono text-[10px]">?</kbd>
            </CommandItem>
            <CommandItem
              value={t('cp.tour')}
              onSelect={() =>
                run(() => window.dispatchEvent(new CustomEvent('printifier:tour')))
              }
            >
              <Sparkles className="mr-2 h-4 w-4 text-fuchsia-300" />
              <span>{t('cp.tour')}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}

function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const rows = [
    { keys: ['Ctrl', 'K'], label: t('kb.k'), alt: ['⌘', 'K'] },
    { keys: ['Alt', 'T'], label: t('kb.flip'), alt: ['⌥', 'T'] },
    { keys: ['?'], label: t('kb.q') },
    { keys: ['Esc'], label: t('kb.esc') },
  ];
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="max-w-sm">
      <div className="px-4 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Keyboard className="h-4 w-4 text-violet-300" /> {t('kb.title')}
        </h2>
      </div>
      <CommandList className="pretty-scroll max-h-80">
        <div className="px-4 pb-4 pt-2">
          <ul className="space-y-2.5">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{r.label}</span>
                <span className="flex shrink-0 gap-1">
                  {(r.alt ?? r.keys).map((k, i) => (
                    <kbd
                      key={i}
                      className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-foreground"
                    >
                      {k}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-white/10 pt-3 text-[11px] text-muted-foreground">
            {t('pg.shortcuts')} {t('pg.scRotate')} · {t('pg.scRemove')} · {t('pg.scMove')}
          </p>
        </div>
      </CommandList>
    </CommandDialog>
  );
}

/** Small header button (desktop) — opens the palette. */
export function PaletteButton() {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t('cp.open')}
      title={t('cp.open')}
      onClick={() => openPalette()}
      className="hidden h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground lg:inline-flex"
    >
      <CommandIcon className="h-4 w-4" aria-hidden="true" />
      <kbd className="hidden font-mono text-[10px] xl:inline">⌘K</kbd>
    </button>
  );
}

/** Mobile sheet row — opens the palette. */
export function PaletteSheetRow() {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => {
        openPalette();
      }}
      className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
    >
      <CommandIcon className="h-4 w-4" aria-hidden="true" />
      {t('cp.open')}
      <kbd className="ml-auto rounded border border-white/15 bg-white/5 px-1.5 font-mono text-[10px]">⌘K</kbd>
    </button>
  );
}
