'use client';

import type { LucideIcon } from 'lucide-react';
import { Reveal } from './reveal';
import { useT } from '@/lib/i18n';

interface SectionHeadProps {
  eyebrow: string;
  title: string;
  sub?: string;
  icon?: LucideIcon;
}

/**
 * Consistent centered section heading: small gradient eyebrow chip,
 * bold title, optional muted subline.
 */
export function SectionHead({ eyebrow, title, sub, icon: Icon }: SectionHeadProps) {
  const t = useT();
  return (
    <Reveal>
      <div className="mx-auto max-w-2xl text-center">
        <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-violet-300">
          {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
          {t(eyebrow)}
        </span>
        <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t(title)}</h2>
        {sub && <p className="mt-3 text-sm text-muted-foreground sm:text-base">{t(sub)}</p>}
      </div>
    </Reveal>
  );
}
