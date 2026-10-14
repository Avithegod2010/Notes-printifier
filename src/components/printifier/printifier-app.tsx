'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  Contrast,
  Droplets,
  Eye,
  FileUp,
  Grid2x2,
  Hash,
  Leaf,
  Lock,
  Minus,
  MonitorSmartphone,
  Smartphone,
  Moon,
  Printer,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Stepper } from './stepper';
import { UploadStep } from './upload-step';
import { PagesStep } from './pages-step';
import { EnhanceStep } from './enhance-step';
import { LayoutStep } from './layout-step';
import { ResultStep } from './result-step';
import { StatsStrip } from './stats-strip';
import { Reveal } from './reveal';
import { ExampleDialog } from './example-dialog';
import { usePrintifyStore } from '@/lib/printify-store';

const FEATURES = [
  { icon: Moon, title: 'Invert Colors', desc: 'Dark slides become bright, printable pages.' },
  { icon: Contrast, title: 'Grayscale & B&W', desc: 'Strip color for maximum contrast.' },
  { icon: Droplets, title: 'Ink Saver', desc: 'Backgrounds pushed to pure white.' },
  { icon: Grid2x2, title: 'N-up Grid', desc: 'Up to 16 slides on a single sheet.' },
  { icon: Minus, title: 'Separation Lines', desc: 'Clean cut lines between slides.' },
  { icon: Hash, title: 'Page Numbers', desc: 'Numbered output for easy collating.' },
  { icon: SlidersHorizontal, title: 'Quality Control', desc: 'Balance file size vs. crispness.' },
  { icon: Lock, title: '100% Local', desc: 'PDFs never leave your browser.' },
];

const FAQS = [
  {
    q: 'Are my files uploaded to a server?',
    a: 'No. Everything — parsing, filters and PDF generation — runs locally in your browser. Your notes never leave your device, and it works even if you go offline after loading the page.',
  },
  {
    q: 'How much paper and ink can I actually save?',
    a: 'Typical dark-background lecture slides shrink by 60–85% ink with Invert + Ink Saver, and stacking 3–4 slides per sheet cuts paper by 60–75%. Your exact numbers are shown after processing.',
  },
  {
    q: 'Which PDFs work best?',
    a: 'Dark-themed lecture decks (Physics Wallah style), scanned notes and text-heavy presentations. For clean white handouts, try Grayscale or B&W with a 30–50% Ink Saver instead of Invert.',
  },
  {
    q: 'Does it work on any device?',
    a: 'Yes — phone, tablet, laptop or desktop. The whole tool runs in any modern browser (Chrome, Safari, Edge, Firefox) with nothing to install. Big files take a little longer on older phones, so keep the tab open while it processes.',
  },
  {
    q: 'Why does the inline preview look blank on my iPhone?',
    a: 'iOS Safari cannot display PDFs inside the page. Tap "Open" to view the PDF in a full tab, or just tap "Download" — the file itself is complete and prints perfectly.',
  },
  {
    q: 'Is the output PDF searchable or re-editable?',
    a: 'The output is a high-quality image-based PDF (each page is rendered, filtered and re-composed), which is exactly what makes the ink and paper savings possible. Page numbers and separators are real vector elements.',
  },
  {
    q: 'Is there an Android app?',
    a: 'Yes! Download the APK from the link in the footer and install it (allow "install from unknown sources" when asked). It is the exact same tool, packaged as a real app — it works fully offline, and PDFs you download are saved straight to your phone.',
  },
];

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0b0a10]/80 backdrop-blur-xl">
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
          {[
            { id: 'how', label: 'How it works' },
            { id: 'features', label: 'Features' },
            { id: 'faq', label: 'FAQ' },
          ].map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => scrollToId(l.id)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              {l.label}
            </button>
          ))}
        </nav>

        <Button
          type="button"
          size="sm"
          onClick={() => scrollToId('app')}
          className="h-9 bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500"
        >
          <FileUp className="mr-1.5 h-4 w-4" /> Start
        </Button>
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
            <Zap className="mr-1.5 h-3.5 w-3.5" /> Instant, in-browser
          </Badge>
          <Badge variant="outline" className="border-white/15 bg-white/5">
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> No uploads · No login
          </Badge>
          <Badge variant="outline" className="border-white/15 bg-white/5">
            <MonitorSmartphone className="mr-1.5 h-3.5 w-3.5" /> Works on any device
          </Badge>
        </motion.div>

        <motion.h1
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={reduce ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.08 }}
          className="text-4xl font-extrabold tracking-tight sm:text-6xl"
        >
          Make Your Lecture Notes{' '}
          <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
            Print-Ready
          </span>
        </motion.h1>

        <motion.p
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={reduce ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.16 }}
          className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg"
        >
          Turn lecture notes into printable notes by reducing ink and pages —
          perfect for exam-time printing.
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
            <FileUp className="mr-2 h-5 w-5" /> Process a PDF
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={() => setExampleOpen(true)}
            className="h-12 w-full border-white/15 bg-white/5 px-6 text-base hover:bg-white/10 sm:w-auto"
          >
            <Eye className="mr-2 h-5 w-5" /> See a real example
          </Button>
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={reduce ? undefined : { opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <button
            type="button"
            onClick={() => scrollToId('how')}
            className="mt-1 rounded-md text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            or see how it works
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
            <p className="mt-2 text-xs text-muted-foreground">41 dark slides · 41 sheets</p>
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
            <p className="mt-2 text-xs font-medium text-emerald-300">
              3 slides/sheet · 14 bright pages
            </p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: '1',
      title: 'Upload your PDFs',
      desc: 'Drop one or many lecture PDFs. Pages load instantly as previews — nothing is uploaded to a server.',
    },
    {
      n: '2',
      title: 'Pick, enhance & lay out',
      desc: 'Keep only the pages you need, invert dark slides to white, then stack up to 16 slides per sheet.',
    },
    {
      n: '3',
      title: 'Download & print',
      desc: 'Get a bright, compact, numbered PDF ready for your printer — with stats on paper and ink saved.',
    },
  ];

  return (
    <section id="how" aria-label="How it works" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14">
      <Reveal>
        <h2 className="text-center text-3xl font-extrabold tracking-tight">How It Works</h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Three steps, about a minute — no account required.
        </p>
      </Reveal>
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
  return (
    <section id="features" aria-label="Features" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-14">
      <Reveal>
        <h2 className="text-center text-3xl font-extrabold tracking-tight">
          Everything a student needs
        </h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Inspired by the tools you love — rebuilt for the web, completely free.
        </p>
      </Reveal>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 4) * 0.07}>
            <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-center transition-colors hover:border-violet-500/40 hover:bg-violet-500/5">
              <f.icon className="mx-auto mb-2 h-6 w-6 text-violet-400" aria-hidden="true" />
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
  return (
    <section id="faq" aria-label="Frequently asked questions" className="mx-auto max-w-3xl scroll-mt-20 px-4 pb-4">
      <Reveal>
        <h2 className="text-center text-3xl font-extrabold tracking-tight">FAQ</h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Everything you might wonder before hitting print.
        </p>
        <Accordion
          type="single"
          collapsible
          className="mt-8 space-y-3 [&>[data-state]]:border-0"
        >
          {FAQS.map((f) => (
            <AccordionItem
              key={f.q}
              value={f.q}
              className="border-b-0 rounded-2xl border border-white/10 bg-white/[0.03] px-4 transition-colors data-[state=open]:border-violet-500/40 sm:px-5"
            >
              <AccordionTrigger className="py-4 text-left text-sm font-semibold hover:no-underline sm:text-base [&>svg]:text-violet-300">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="pb-4 text-sm leading-relaxed text-muted-foreground">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-white/5 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-xs text-muted-foreground sm:flex-row">
        <p>© {new Date().getFullYear()} Notes Printifier — built for students, by students.</p>
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-4">
          <a
            href="/printifier.apk"
            download="notes-printifier.apk"
            className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1.5 font-semibold text-violet-200 transition-colors hover:bg-violet-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Smartphone className="h-3.5 w-3.5" /> Get the Android app (.apk)
          </a>
          <p className="flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" /> All processing happens locally in your browser
          </p>
        </div>
      </div>
    </footer>
  );
}

export function PrintifierApp() {
  const step = usePrintifyStore((s) => s.step);

  return (
    <div className="flex min-h-screen flex-col bg-[#0b0a10] text-foreground">
      <Header />
      <main className="flex-1">
        <Hero />

        <section id="app" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-8">
          <Reveal>
            <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-4 shadow-2xl shadow-black/40 sm:p-6 lg:p-8">
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
        <FaqSection />
        <StatsStrip />
      </main>
      <Footer />
    </div>
  );
}
