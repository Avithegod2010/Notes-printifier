'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  BookOpen,
  Contrast,
  Droplets,
  Eye,
  FileUp,
  Globe,
  Grid2x2,
  Hash,
  Languages,
  Leaf,
  Lock,
  Menu,
  Minus,
  MonitorSmartphone,
  PenLine,
  Printer,
  ScanText,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Smartphone,
  FlaskConical,
  Moon,
  Sun,
  Type,
  WifiOff,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSharedPdf } from '@/hooks/use-shared-pdf';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet';
import { Stepper } from './stepper';
import { UploadStep } from './upload-step';
import { PagesStep } from './pages-step';
import { EnhanceStep } from './enhance-step';
import { LayoutStep } from './layout-step';
import { ResultStep } from './result-step';
import { InstallButton } from '@/components/install-prompt';
import { StatsStrip } from './stats-strip';
import { LabsPopover } from './labs-popover';
import { Reveal } from './reveal';
import { ExampleDialog } from './example-dialog';
import { UpdateBanner } from './update-banner';
import { ScrollProgress, BackToTop } from './site-chrome';
import { SectionHead } from './section-head';
import { DynamicBackground } from './dynamic-background';
import { SavingsCalculator } from './savings-calculator';
import { UseCases } from './use-cases';
import { usePrintifyStore } from '@/lib/printify-store';
import { useLangStore, useT } from '@/lib/i18n';
import { useThemeStore } from '@/lib/theme';
import { APP_VERSION } from '@/lib/version';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';

const FAQ_KEYS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const NAV_SECTIONS = [
  { id: 'how', key: 'nav.how' },
  { id: 'features', key: 'nav.features' },
  { id: 'calculator', key: 'nav.calc' },
  { id: 'faq', key: 'nav.faq' },
] as const;

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Highlights the nav item of the section currently in view. */
function useActiveSection(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setActive(
            entry.isIntersecting
              ? entry.target.id
              : (prev) => (prev === entry.target.id ? null : prev),
          );
        }
      },
      { rootMargin: '-25% 0px -65% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-600/30">
        <Printer className="h-4.5 w-4.5 text-white" aria-hidden="true" />
      </div>
      <div className="leading-tight">
        <p className="text-[15px] font-extrabold tracking-tight sm:text-lg">Notes Printifier</p>
        <p className="hidden text-[11px] text-muted-foreground sm:block">
          Save paper. Save ink. Print smarter.
        </p>
      </div>
    </div>
  );
}

function LangToggle() {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label="Language / भाषा"
      onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}
      className="h-9 border-white/15 bg-white/5 px-2.5 text-sm font-semibold text-muted-foreground hover:bg-white/10 hover:text-foreground sm:px-3"
    >
      <Languages className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">{t('nav.lang')}</span>
    </Button>
  );
}

function ThemeToggle() {
  const t = useT();
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const isLight = theme === 'light';

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={t('th.toggle')}
      title={t('th.toggle')}
      onClick={toggle}
      className="h-9 w-9 border-white/15 bg-white/5 p-0 text-muted-foreground hover:bg-white/10 hover:text-foreground"
    >
      {isLight ? (
        <Moon className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Sun className="h-4 w-4" aria-hidden="true" />
      )}
    </Button>
  );
}

function SheetThemeRow() {
  const t = useT();
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);

  return (
    <SheetClose asChild>
      <Button
        type="button"
        variant="outline"
        className="border-white/15 bg-white/5 hover:bg-white/10"
        onClick={toggle}
      >
        {theme === 'light' ? (
          <Moon className="mr-2 h-4 w-4" />
        ) : (
          <Sun className="mr-2 h-4 w-4" />
        )}
        {t('th.toggle')}
      </Button>
    </SheetClose>
  );
}

function Header() {
  const t = useT();
  const active = useActiveSection(NAV_SECTIONS.map((s) => s.id));
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[var(--header-bg)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Back to top"
        >
          <Logo />
        </button>

        <nav aria-label="Site" className="hidden items-center gap-1 md:flex">
          {NAV_SECTIONS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => scrollToId(l.id)}
              aria-current={active === l.id ? 'true' : undefined}
              className={cn(
                'relative rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-white/5 hover:text-foreground',
                active === l.id ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {t(l.key)}
              {active === l.id && (
                <motion.span
                  layoutId="nav-underline"
                  className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400"
                />
              )}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <InstallButton />
          <ThemeToggle />
          <LangToggle />
          <LabsPopover />
          <Button
            type="button"
            size="sm"
            onClick={() => scrollToId('app')}
            className="hidden h-9 bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500 sm:inline-flex"
          >
            <FileUp className="mr-1.5 h-4 w-4" /> {t('nav.start')}
          </Button>
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('menu.open')}
                className="h-9 w-9 border-white/15 bg-white/5 hover:bg-white/10 md:hidden"
              >
                <Menu className="h-4.5 w-4.5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 border-white/10 bg-popover">
              <SheetHeader>
                <SheetTitle>{t('menu.title')}</SheetTitle>
                <SheetDescription className="sr-only">{t('ft.tagline')}</SheetDescription>
              </SheetHeader>
              <nav aria-label="Site" className="flex flex-col gap-1 px-4">
                {NAV_SECTIONS.map((l) => (
                  <SheetClose asChild key={l.id}>
                    <button
                      type="button"
                      onClick={() => scrollToId(l.id)}
                      className="rounded-xl px-3 py-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                    >
                      {t(l.key)}
                    </button>
                  </SheetClose>
                ))}
                <SheetClose asChild>
                  <Button
                    type="button"
                    className="mt-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500"
                    onClick={() => scrollToId('app')}
                  >
                    <FileUp className="mr-1.5 h-4 w-4" /> {t('nav.start')}
                  </Button>
                </SheetClose>
                <SheetThemeRow />
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

function FloatingChip({
  children,
  className,
  delay,
  reduce,
}: {
  children: React.ReactNode;
  className?: string;
  delay: number;
  reduce: boolean | null;
}) {
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.8 }}
      animate={reduce ? undefined : { opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.5, ease: 'easeOut' }}
      className={className}
    >
      <motion.div
        animate={reduce ? undefined : { y: [0, -7, 0] }}
        transition={{ duration: 3.5 + delay, repeat: Infinity, ease: 'easeInOut', delay }}
        className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold shadow-xl backdrop-blur-md"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

function Hero() {
  const t = useT();
  const reduce = useReducedMotion();
  const [exampleOpen, setExampleOpen] = useState(false);

  return (
    <section className="relative overflow-hidden px-4 pb-14 pt-12 sm:pb-20 sm:pt-20">
      {/* decorative glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-violet-600/25 blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-40 h-72 w-72 rounded-full bg-fuchsia-600/15 blur-[100px]"
      />
      {/* subtle grid backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />

      <div className="relative mx-auto max-w-4xl text-center">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={reduce ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-5 flex flex-wrap items-center justify-center gap-2"
        >
          <Badge variant="outline" className="border-violet-400/40 bg-violet-500/10 text-violet-200">
            <Zap className="mr-1.5 h-3.5 w-3.5" /> {t('hero.badge1')}
          </Badge>
          <Badge variant="outline" className="border-white/15 bg-white/5">
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> {t('hero.badge2')}
          </Badge>
          <Badge variant="outline" className="border-white/15 bg-white/5">
            <MonitorSmartphone className="mr-1.5 h-3.5 w-3.5" /> {t('hero.badge3')}
          </Badge>
        </motion.div>

        <motion.h1
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={reduce ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.08 }}
          className="text-4xl font-extrabold tracking-tight sm:text-6xl"
        >
          {t('hero.title1')}{' '}
          <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
            {t('hero.title2')}
          </span>
        </motion.h1>

        <motion.p
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={reduce ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.16 }}
          className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg"
        >
          {t('hero.sub')}
        </motion.p>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={reduce ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.24 }}
          className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Button
            type="button"
            size="lg"
            onClick={() => scrollToId('app')}
            className="h-12 w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 text-base text-white shadow-xl shadow-violet-600/40 hover:from-violet-500 hover:to-fuchsia-500 sm:w-auto"
          >
            <FileUp className="mr-2 h-5 w-5" /> {t('hero.cta')}
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={() => setExampleOpen(true)}
            className="h-12 w-full border-white/15 bg-white/5 px-6 text-base hover:bg-white/10 sm:w-auto"
          >
            <Eye className="mr-2 h-5 w-5" /> {t('hero.example')}
          </Button>
        </motion.div>

        {/* trust row */}
        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={reduce ? undefined : { opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.34 }}
          className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground"
        >
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-violet-300" aria-hidden="true" /> {t('trust.free')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" /> {t('trust.private')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <WifiOff className="h-3.5 w-3.5 text-fuchsia-300" aria-hidden="true" /> {t('trust.offline')}
          </span>
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={reduce ? undefined : { opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <button
            type="button"
            onClick={() => scrollToId('how')}
            className="mt-4 rounded-md text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('hero.howlink')}
          </button>
        </motion.div>

        <ExampleDialog open={exampleOpen} onOpenChange={setExampleOpen} />

        {/* Before → After visual */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24 }}
          animate={reduce ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.32 }}
          className="relative mx-auto mt-14 mb-10 flex max-w-2xl items-center justify-center gap-3 sm:gap-6"
        >
          {/* floating stat chips (desktop) */}
          <FloatingChip reduce={reduce} delay={1.0} className="absolute -left-2 top-2 z-10 hidden lg:flex">
            <Droplets className="h-3.5 w-3.5 text-emerald-400" /> −80% ink
          </FloatingChip>
          <FloatingChip reduce={reduce} delay={1.25} className="absolute -top-6 right-0 z-10 hidden lg:flex">
            <Grid2x2 className="h-3.5 w-3.5 text-violet-300" /> 3× slides/sheet
          </FloatingChip>
          <FloatingChip reduce={reduce} delay={1.5} className="absolute -bottom-11 left-1/2 z-10 hidden -translate-x-1/2 lg:flex">
            <Leaf className="h-3.5 w-3.5 text-emerald-400" /> ~9 sheets saved
          </FloatingChip>

          {/* before: dark ink-heavy slide */}
          <motion.div
            animate={reduce ? undefined : { y: [0, -5, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            className="flex-1"
          >
            <div className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900 shadow-2xl">
              <div className="aspect-[16/10] w-full bg-gradient-to-br from-[#2b1d16] to-[#120b08] p-3">
                <div className="h-2.5 w-3/4 rounded bg-amber-500/70" />
                <div className="mt-2 h-1.5 w-1/2 rounded bg-white/25" />
                <div className="mt-3 h-1.5 w-2/3 rounded bg-fuchsia-400/60" />
                <div className="mt-1.5 h-1.5 w-1/2 rounded bg-emerald-400/50" />
                <div className="mt-3 h-8 w-3/4 rounded bg-white/10" />
                <div className="mt-2 h-1.5 w-2/5 rounded bg-white/20" />
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t('hero.before')}</p>
          </motion.div>

          <div className="flex flex-col items-center gap-1">
            <Sparkles className="h-5 w-5 text-violet-400" aria-hidden="true" />
            <motion.div
              animate={reduce ? undefined : { x: [0, 4, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ArrowRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </motion.div>
          </div>

          {/* after: bright compact grid page */}
          <motion.div
            animate={reduce ? undefined : { y: [0, -8, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}
            className="flex-1"
          >
            <div className="mx-auto w-4/5 overflow-hidden rounded-xl border border-white/10 bg-white p-1.5 shadow-2xl shadow-violet-900/40">
              <div className="aspect-[1/1.414] w-full space-y-1 rounded-sm bg-white p-1">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="aspect-[16/9] w-full rounded-[2px] bg-zinc-100 p-1.5">
                    <div className="h-1 w-2/3 rounded bg-zinc-400" />
                    <div className="mt-1 h-0.5 w-1/2 rounded bg-zinc-300" />
                    <div className="mt-1 h-2 w-3/4 rounded-sm bg-zinc-200" />
                  </div>
                ))}
                <p className="text-center text-[6px] leading-none text-zinc-400">1</p>
              </div>
            </div>
            <p className="mt-2 text-xs font-medium text-emerald-300">{t('hero.after')}</p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const t = useT();
  const steps = [
    { n: '1', title: t('how.s1.t'), desc: t('how.s1.d') },
    { n: '2', title: t('how.s2.t'), desc: t('how.s2.d') },
    { n: '3', title: t('how.s3.t'), desc: t('how.s3.d') },
  ];

  return (
    <section id="how" aria-label={t('how.title')} className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14">
      <SectionHead eyebrow="how.eyebrow" title="how.title" sub="how.sub" />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <Reveal key={s.n} delay={i * 0.1}>
            <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-violet-500/40">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-sm font-extrabold text-white shadow-lg shadow-violet-600/25">
                {s.n}
              </div>
              <h3 className="text-lg font-bold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function FeatureGrid() {
  const t = useT();
  const FEATURES = [
    { icon: Moon, title: t('feat.invert.t'), desc: t('feat.invert.d') },
    { icon: Contrast, title: t('feat.gray.t'), desc: t('feat.gray.d') },
    { icon: Droplets, title: t('feat.ink.t'), desc: t('feat.ink.d') },
    { icon: Grid2x2, title: t('feat.grid.t'), desc: t('feat.grid.d') },
    { icon: Minus, title: t('feat.sep.t'), desc: t('feat.sep.d') },
    { icon: Hash, title: t('feat.num.t'), desc: t('feat.num.d') },
    { icon: SlidersHorizontal, title: t('feat.quality.t'), desc: t('feat.quality.d') },
    { icon: Lock, title: t('feat.local.t'), desc: t('feat.local.d') },
    { icon: PenLine, title: t('en.pen'), desc: t('en.pen.d') },
    { icon: ScanText, title: t('en.ocr'), desc: t('en.ocr.d') },
    { icon: Sparkles, title: t('en.presets'), desc: t('en.presets.none') },
    { icon: Globe, title: t('up.cloud'), desc: t('up.cloudHint') },
    { icon: BookOpen, title: t('feat.booklet.t'), desc: t('feat.booklet.d') },
    { icon: Type, title: t('feat.wm.t'), desc: t('feat.wm.d') },
  ];

  return (
    <section id="features" aria-label={t('feat.title')} className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-14">
      <SectionHead eyebrow="feat.eyebrow" title="feat.title" sub="feat.sub" />
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 4) * 0.07}>
            <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center transition-all hover:-translate-y-0.5 hover:border-violet-500/40 hover:bg-violet-500/5">
              <span className="mx-auto mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                <f.icon className="h-5 w-5 text-violet-400" aria-hidden="true" />
              </span>
              <p className="text-sm font-semibold">{f.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{f.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function FaqSection() {
  const t = useT();
  return (
    <section id="faq" aria-label={t('faq.title')} className="mx-auto max-w-3xl scroll-mt-20 px-4 pb-4">
      <SectionHead eyebrow="faq.eyebrow" title="faq.title" sub="faq.sub" />
      <Reveal>
        <Accordion
          type="single"
          collapsible
          className="mt-8 space-y-3 [&>[data-state]]:border-0"
        >
          {FAQ_KEYS.map((n) => (
            <AccordionItem
              key={n}
              value={String(n)}
              className="border-b-0 rounded-2xl border border-white/10 bg-white/[0.03] px-4 transition-colors data-[state=open]:border-violet-500/40 sm:px-5"
            >
              <AccordionTrigger className="py-4 text-left text-sm font-semibold hover:no-underline sm:text-base [&>svg]:text-violet-300">
                {t(`faq${n}.q`)}
              </AccordionTrigger>
              <AccordionContent className="pb-4 text-sm leading-relaxed text-muted-foreground">
                {t(`faq${n}.a`)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Reveal>
    </section>
  );
}

function Footer() {
  const t = useT();
  return (
    <footer className="mt-auto border-t border-white/5 bg-white/[0.015] pt-10 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_0.8fr_1.3fr]">
        {/* brand */}
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-xs leading-relaxed text-muted-foreground">
            {t('ft.tagline')}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {t('ft.local')}
          </p>
        </div>

        {/* explore */}
        <nav aria-label={t('ft.links')}>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {t('ft.links')}
          </p>
          <ul className="space-y-2 text-sm">
            {NAV_SECTIONS.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => scrollToId(l.id)}
                  className="rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t(l.key)}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* get the app */}
        <div>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {t('ft.get')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/printifier-stable.apk"
              download="notes-printifier-stable.apk"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Smartphone className="h-3.5 w-3.5" /> {t('ft.stable')}
            </a>
            <a
              href="/printifier.apk"
              download="notes-printifier-beta.apk"
              className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1.5 font-semibold text-violet-200 transition-colors hover:bg-violet-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FlaskConical className="h-3.5 w-3.5" /> {t('ft.beta')}
            </a>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t('ft.webapp')}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">
              v{APP_VERSION}
            </span>
          </p>
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-6xl border-t border-white/5 px-4 pt-5">
        <p className="text-center text-xs text-muted-foreground">
          {t('ft.copyright', { y: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  );
}

export function PrintifierApp() {
  const t = useT();
  const step = usePrintifyStore((s) => s.step);
  const hydrateLabs = usePrintifyStore((s) => s.hydrateLabs);
  const refreshPresets = usePrintifyStore((s) => s.refreshPresets);
  const applyPresetData = usePrintifyStore((s) => s.applyPresetData);
  const addFiles = usePrintifyStore((s) => s.addFiles);
  const hydrateLang = useLangStore((s) => s.hydrate);
  const hydrateTheme = useThemeStore((s) => s.hydrate);

  // F2 — shared preset arrived via ?p=<id>
  const [sharedPreset, setSharedPreset] = useState<{
    name: string;
    filters: Record<string, unknown>;
    layout: Record<string, unknown>;
  } | null>(null);
  const [sharedBad, setSharedBad] = useState(false);

  // Android share-sheet: a PDF shared into the APK lands in the pipeline
  // automatically (no-op on the plain web — the hook is never nudged there).
  useSharedPdf((file) => {
    void addFiles([file]);
  });

  useEffect(() => {
    hydrateLabs(); // client-only, post-hydration — restores Labs prefs if enabled
    hydrateLang(); // restores English/हिन्दी choice
    hydrateTheme(); // restores light/dark choice
    refreshPresets(); // hydrate saved presets from localStorage

    // F2 — incoming preset share link (?p=<id>): fetch the recipe, strip the
    // param from the URL, and offer a one-tap apply dialog.
    try {
      const url = new URL(window.location.href);
      const pid = url.searchParams.get('p');
      if (pid && /^[A-HJ-NP-Z2-9]{8}$/i.test(pid)) {
        url.searchParams.delete('p');
        window.history.replaceState({}, '', url.toString());
        void fetch(`/api/presets/${encodeURIComponent(pid.toUpperCase())}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { name?: string; filters?: unknown; layout?: unknown } | null) => {
            if (
              data &&
              typeof data.filters === 'object' && data.filters !== null &&
              typeof data.layout === 'object' && data.layout !== null
            ) {
              setSharedPreset({
                name: typeof data.name === 'string' ? data.name : 'Preset',
                filters: data.filters as Record<string, unknown>,
                layout: data.layout as Record<string, unknown>,
              });
            } else if (data === null) {
              setSharedBad(true);
            }
          })
          .catch(() => undefined);
      }
    } catch {
      // URL parsing is best-effort
    }
  }, [hydrateLabs, hydrateLang, hydrateTheme, refreshPresets]);

  return (
    <div className="flex min-h-screen flex-col text-foreground">
      {/* ambient animated backdrop (fixed, -z-10, aria-hidden) */}
      <DynamicBackground />
      <a
        href="#app"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        {t('skip')}
      </a>
      <ScrollProgress />
      <Header />
      <main className="flex-1">
        <Hero />

        <section id="app" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-8">
          <Reveal>
            <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-4 shadow-2xl shadow-black/40 ring-1 ring-violet-500/10 sm:p-6 lg:p-8">
              <Stepper />
              {step === 0 && <UploadStep />}
              {step === 1 && <PagesStep />}
              {step === 2 && <EnhanceStep />}
              {step === 3 && <LayoutStep />}
              {step === 4 && <ResultStep />}
            </div>
          </Reveal>
        </section>

        <HowItWorks />
        <FeatureGrid />
        <SavingsCalculator />
        <UseCases />
        <FaqSection />
        <StatsStrip />
      </main>
      <Footer />
      <BackToTop />
      <UpdateBanner />

      {/* F2 — one-tap apply for an incoming shared preset */}
      <Dialog
        open={sharedPreset !== null || sharedBad}
        onOpenChange={(v) => {
          if (!v) {
            setSharedPreset(null);
            setSharedBad(false);
          }
        }}
      >
        <DialogContent className="max-w-md rounded-2xl border-white/10 bg-popover">
          <DialogHeader>
            <DialogTitle className="text-left">
              {sharedBad ? t('pr.incoming.bad') : t('pr.incomingTitle')}
            </DialogTitle>
            <DialogDescription className="text-left">
              {sharedPreset && t('pr.incomingBody', { n: sharedPreset.name })}
            </DialogDescription>
          </DialogHeader>
          {sharedPreset && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                className="flex-1 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500"
                onClick={() => {
                  applyPresetData(
                    sharedPreset.filters as Parameters<typeof applyPresetData>[0],
                    sharedPreset.layout as Parameters<typeof applyPresetData>[1],
                  );
                  toast({ description: t('pr.incoming.applied', { n: sharedPreset.name }) });
                  setSharedPreset(null);
                }}
              >
                {t('pr.incoming.apply')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setSharedPreset(null);
                }}
              >
                {t('pr.incoming.later')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
