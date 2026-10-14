'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePrintifyStore } from '@/lib/printify-store';

const STEPS = ['Upload', 'Arrange', 'Enhance', 'Layout', 'Finish'] as const;

export function Stepper() {
  const step = usePrintifyStore((s) => s.step);
  const setStep = usePrintifyStore((s) => s.setStep);

  return (
    <nav
      aria-label="Processing steps"
      className="pretty-scroll mb-6 overflow-x-auto pb-1 sm:mb-8"
    >
      <ol className="mx-auto flex w-max min-w-full items-center justify-center gap-1 px-1 sm:gap-2">
        {STEPS.map((label, i) => {
          const isDone = i < step;
          const isCurrent = i === step;
          const clickable = i < step && step < 4;
          return (
            <li key={label} className="flex items-center">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && setStep(i)}
                className={cn(
                  'flex items-center gap-2 rounded-full px-2 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors sm:px-3 sm:text-sm',
                  isCurrent && 'bg-primary text-primary-foreground shadow-lg shadow-primary/25',
                  isDone && 'text-primary hover:bg-primary/10 cursor-pointer',
                  !isCurrent && !isDone && 'text-muted-foreground',
                  !clickable && 'cursor-default',
                )}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold',
                    isCurrent && 'border-primary-foreground/40 bg-primary-foreground text-primary',
                    isDone && 'border-primary/50 bg-primary/15 text-primary',
                    !isCurrent && !isDone && 'border-border bg-muted/40',
                  )}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <span
                  className={cn(
                    'mx-0.5 h-px w-3 sm:mx-1 sm:w-8',
                    i < step ? 'bg-primary/60' : 'bg-border',
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
