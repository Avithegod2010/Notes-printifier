'use client';

import { cn } from '@/lib/utils';
import type { ThemeMeta } from '@/lib/theme';

/**
 * ThemeSwatch — one clean two-tone preview of a theme: the page background
 * as the full disc and the accent color as a centered dot.
 *
 * Replaces the old confusing previews (a hard diagonal split in the welcome
 * tour and three overlapping circles in the picker/command palette) so every
 * theme reads as "background + accent" at a glance, in one consistent style.
 */
export function ThemeSwatch({
  th,
  className,
  showDot = true,
}: {
  th: Pick<ThemeMeta, 'swatch' | 'light'>;
  className?: string;
  showDot?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-flex items-center justify-center overflow-hidden rounded-full ring-1 ring-inset',
        th.light ? 'ring-black/10' : 'ring-white/15',
        className,
      )}
      style={{ background: th.swatch[0] }}
    >
      {showDot && (
        <span
          className="block h-1/3 w-1/3 rounded-full"
          style={{ background: th.swatch[2] }}
        />
      )}
    </span>
  );
}
