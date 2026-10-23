/**
 * confetti.ts — a dependency-free celebration burst.
 *
 * Fires when a print job finishes (if the user kept confetti on in the Theme
 * Workshop). Draws ~140 paper bits onto a temporary fixed-position canvas:
 *   - colours follow the current theme's accent + counter-accent ramps
 *   - honours prefers-reduced-motion (no-op)
 *   - self-cleans: canvas is removed after the animation ends
 */

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  shape: 'rect' | 'circle';
}

function readVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

export function fireConfetti(): void {
  try {
    if (typeof window === 'undefined' || document.hidden) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // calm-motion mode kills animations globally — respect it
    if (document.documentElement.dataset.motion === 'calm') return;

    const palette = [
      readVar('--acc-300', '#fcd34d'),
      readVar('--acc-500', '#f59e0b'),
      readVar('--accf-400', '#e879f9'),
      readVar('--accf-500', '#d946ef'),
      readVar('--acc-200', '#fde68a'),
    ].map((c) => (c.startsWith('#') || c.startsWith('rgb') ? c : `#${c}`));

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText =
      'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999;';
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.remove();
      return;
    }
    ctx.scale(dpr, dpr);

    const W = window.innerWidth;
    const H = window.innerHeight;
    const N = 140;
    const bits: Bit[] = [];
    for (let i = 0; i < N; i++) {
      // Two side cannons + one center fountain, like a proper release party.
      const origin = i % 3;
      const x = origin === 0 ? W * 0.12 : origin === 1 ? W * 0.88 : W * 0.5;
      const y = H + 12;
      const angle =
        origin === 0 ? -Math.PI / 2 + 0.42 : origin === 1 ? -Math.PI / 2 - 0.42 : -Math.PI / 2;
      const speed = 9 + Math.random() * 9;
      bits.push({
        x,
        y,
        vx: Math.cos(angle + (Math.random() - 0.5) * 0.5) * speed * (origin === 2 ? 0.55 : 1),
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.32,
        w: 5 + Math.random() * 6,
        h: 8 + Math.random() * 8,
        color: palette[i % palette.length],
        shape: Math.random() < 0.28 ? 'circle' : 'rect',
      });
    }

    const start = performance.now();
    const DURATION = 2400;

    const tick = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      for (const b of bits) {
        b.vy += 0.24; // gravity
        b.vx *= 0.992; // drag
        b.x += b.vx;
        b.y += b.vy;
        b.rot += b.vr;
        const fade = t > DURATION - 500 ? Math.max(0, (DURATION - t) / 500) : 1;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = b.color;
        if (b.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, b.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        }
        ctx.restore();
      }
      if (t < DURATION) requestAnimationFrame(tick);
      else canvas.remove();
    };
    requestAnimationFrame(tick);
  } catch {
    // confetti must never break the result step
  }
}
