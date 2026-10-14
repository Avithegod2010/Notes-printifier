'use client';

import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { usePrintifyStore } from '@/lib/printify-store';
import { useT } from '@/lib/i18n';

/**
 * Labs — the experimental channel. Off by default: beginners always get the
 * stable experience. Features that are still cooking live behind these
 * switches and only affect the device that opts in.
 */
export function LabsPopover() {
  const t = useT();
  const labsRemember = usePrintifyStore((s) => s.labsRemember);
  const setLabsRemember = usePrintifyStore((s) => s.setLabsRemember);
  const labsTextRepaint = usePrintifyStore((s) => s.labsTextRepaint);
  const setLabsTextRepaint = usePrintifyStore((s) => s.setLabsTextRepaint);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label="Labs — experimental features"
          className="h-9 border-white/15 bg-white/5 px-2.5 text-sm font-semibold text-muted-foreground hover:bg-white/10 hover:text-foreground sm:px-3"
        >
          <FlaskConical className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t('labs.title')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-2xl border-white/10 bg-popover p-4">
        <div className="mb-1 flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-violet-300" aria-hidden="true" />
          <p className="text-sm font-bold">{t('labs.title')}</p>
          <span className="rounded-full border border-violet-400/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
            {t('labs.badge')}
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          {t('labs.body')}
        </p>

        <label className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-violet-500/40">
          <span className="flex-1">
            <span className="block text-xs font-semibold">{t('labs.remember')}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
              {t('labs.rememberD')}
            </span>
          </span>
          <Switch
            checked={labsRemember}
            onCheckedChange={setLabsRemember}
            aria-label="Remember my settings"
            className="mt-0.5 shrink-0 data-[state=checked]:bg-violet-600"
          />
        </label>

        <label className="mt-2 flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-violet-500/40">
          <span className="flex-1">
            <span className="block text-xs font-semibold">{t('labs.repaint')}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
              {t('labs.repaintD')}
            </span>
          </span>
          <Switch
            checked={labsTextRepaint}
            onCheckedChange={setLabsTextRepaint}
            aria-label="Text repaint — re-typeset pages as crisp text"
            className="mt-0.5 shrink-0 data-[state=checked]:bg-violet-600"
          />
        </label>

        <p className="mt-3 text-[11px] text-muted-foreground">
          {t('labs.more')}
        </p>
      </PopoverContent>
    </Popover>
  );
}
