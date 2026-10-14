'use client';

import { BookOpen, GraduationCap, Presentation } from 'lucide-react';
import { Reveal } from './reveal';
import { SectionHead } from './section-head';
import { useT } from '@/lib/i18n';

const CASES = [
  { icon: GraduationCap, t: 'uc.exam.t', d: 'uc.exam.d', accent: 'text-violet-400' },
  { icon: BookOpen, t: 'uc.class.t', d: 'uc.class.d', accent: 'text-fuchsia-400' },
  { icon: Presentation, t: 'uc.coach.t', d: 'uc.coach.d', accent: 'text-emerald-400' },
] as const;

/** “Who it’s for” — three persona cards. */
export function UseCases() {
  const t = useT();

  return (
    <section
      id="use-cases"
      aria-label={t('uc.title')}
      className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-14"
    >
      <SectionHead eyebrow="uc.eyebrow" title="uc.title" sub="uc.sub" />

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {CASES.map((c, i) => (
          <Reveal key={c.t} delay={i * 0.08}>
            <div className="group h-full rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition-all hover:-translate-y-1 hover:border-violet-500/40 hover:bg-white/[0.05] hover:shadow-xl hover:shadow-violet-900/20">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] transition-colors group-hover:border-violet-400/30">
                <c.icon className={`h-5.5 w-5.5 ${c.accent}`} aria-hidden="true" />
              </div>
              <h3 className="text-lg font-bold">{t(c.t)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(c.d)}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
