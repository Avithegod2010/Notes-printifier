/**
 * Unit tests for the paper-edge fixes in filters.ts — the "light/dark
 * texture at the edges of pieces" class of bugs.
 *
 * Dark decks carry a warm vignette gradient at the slide edges that INVERTS
 * into a bluish-gray film (rgb ~216-242) which used to escape every rule:
 * isInvertStainPixel needs diff >= 8, paper-white needed lum >= 238 AND
 * diff <= 8, and the levels pass that hides neutral bands only runs when
 * ink saver > 0 (off by default). The background white-point snap
 * (paperSnapAnchor + BG_SNAP_TOL) must push all of it to pure white in
 * every mode while never touching ink, highlighter or dark content.
 *
 * applyFilters only needs ctx.getImageData/putImageData, so a tiny fake
 * canvas keeps these tests DOM-free and deterministic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFilters,
  defaultFilters,
  type AnyCanvas,
  type FilterSettings,
} from '../../src/lib/pdf/filters';

/** Fake 2D context over a plain pixel buffer — enough for applyFilters. */
function fakeCanvas(
  w: number,
  h: number,
  paint: (x: number, y: number) => [number, number, number],
): AnyCanvas {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  const ctx = {
    getImageData: (sx: number, sy: number, sw: number, sh: number) => {
      const out = new Uint8ClampedArray(sw * sh * 4);
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const si = ((sy + y) * w + (sx + x)) * 4;
          const di = (y * sw + x) * 4;
          out[di] = data[si];
          out[di + 1] = data[si + 1];
          out[di + 2] = data[si + 2];
          out[di + 3] = 255;
        }
      }
      return { data: out, width: sw, height: sh, colorSpace: 'srgb' };
    },
    putImageData: (img: { data: Uint8ClampedArray; width: number; height: number }) => {
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const si = (y * w + x) * 4;
          const di = (y * img.width + x) * 4;
          data[si] = img.data[di];
          data[si + 1] = img.data[di + 1];
          data[si + 2] = img.data[di + 2];
        }
      }
    },
  };
  return {
    width: w,
    height: h,
    getContext: () => ctx,
  } as unknown as AnyCanvas;
}

function px(
  c: AnyCanvas,
  x: number,
  y: number,
): [number, number, number] {
  const ctx = c.getContext('2d') as unknown as {
    getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray };
  };
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2]];
}

const isWhite = (p: [number, number, number]) =>
  p[0] === 255 && p[1] === 255 && p[2] === 255;

/** Default settings with overrides — cleanStains on, ink saver off. */
function settings(o: Partial<FilterSettings> = {}): FilterSettings {
  return { ...defaultFilters, ...o };
}

describe('background white-point snap (edge film fix)', () => {
  it('inverted dark deck: neutral film at the edges snaps to pure white', () => {
    // Physics-Wallah-style deck: near-black warm background with a
    // vignette that lightens toward the edges; the "film" values here are
    // the POST-invert colours (255 - source) the pipeline actually sees.
    const c = fakeCanvas(80, 60, (x, y) => {
      if (y < 6) return [255 - 216, 255 - 231, 255 - 237]; // edge film source
      return [30, 25, 20]; // deep background
    });
    applyFilters(c, settings({ colorMode: 'invert' }), 'invert');
    assert.ok(isWhite(px(c, 40, 2)), 'film band must be pure white');
    assert.ok(isWhite(px(c, 40, 30)), 'deep background must be pure white too');
  });

  it('inverted dark deck: tinted film (diff > 8) snaps to pure white', () => {
    // rgb(223,231,234) — the measured plateau: diff 11, lum 229. It escapes
    // paper-white (lum < 238); the snap must catch it.
    const c = fakeCanvas(80, 60, (x, y) =>
      y < 6 ? [255 - 223, 255 - 231, 255 - 234] : [30, 25, 20],
    );
    applyFilters(c, settings({ colorMode: 'invert' }), 'invert');
    assert.ok(isWhite(px(c, 40, 2)), 'tinted film must be pure white');
  });

  it('inverted dark deck: ink and content never snap', () => {
    const c = fakeCanvas(80, 60, (x, y) => {
      if (x >= 60 && y < 20) return [40, 90, 200]; // blue ink (→ orange after invert)
      if (x < 20 && y >= 40) return [240, 240, 240]; // white text (→ dark)
      return [30, 25, 20];
    });
    applyFilters(c, settings({ colorMode: 'invert' }), 'invert');
    const [r, g, b] = px(c, 70, 5); // inverted blue ink
    assert.ok(!(r === 255 && g === 255 && b === 255), 'ink must not snap white');
    assert.ok(g > 120, 'ink must stay visibly coloured');
    const dark = px(c, 5, 50); // inverted white text
    assert.ok(dark[0] < 120, 'white text must invert dark, never whitened');
  });

  it('original mode: cream/yellow-tinted paper snaps to pure white', () => {
    const c = fakeCanvas(80, 60, (x, y) => {
      if (y < 6) return [250, 244, 226]; // warm scan film (diff 24)
      return [252, 248, 236]; // cream paper (diff 16)
    });
    applyFilters(c, settings({ colorMode: 'original' }), 'original');
    assert.ok(isWhite(px(c, 40, 2)), 'warm film must be pure white');
    assert.ok(isWhite(px(c, 40, 30)), 'cream paper must be pure white');
  });

  it('highlighter yellow and dark pen survive the snap', () => {
    const c = fakeCanvas(80, 60, (x, y) => {
      if (x < 20 && y < 20) return [250, 245, 150]; // highlighter yellow
      if (x >= 60 && y >= 40) return [60, 60, 70]; // dark pen
      return [240, 242, 241]; // neutral-ish film paper
    });
    applyFilters(c, settings({ colorMode: 'original' }), 'original');
    const highlighter = px(c, 5, 5);
    assert.ok(highlighter[2] < 200, 'yellow must keep its blue-channel gap');
    const pen = px(c, 70, 50);
    assert.ok(pen[0] < 150, 'dark pen must stay dark');
  });

  it('cleanStains off: film is preserved (snap is gated on the toggle)', () => {
    const c = fakeCanvas(80, 60, (x, y) =>
      y < 6 ? [255 - 223, 255 - 231, 255 - 234] : [30, 25, 20],
    );
    applyFilters(
      c,
      settings({ colorMode: 'invert', cleanStains: false }),
      'invert',
    );
    const [r] = px(c, 40, 2);
    assert.ok(r !== 255, 'film must not be whitened with the toggle off');
    assert.equal(r, 223); // 255 - 32, inverted but untouched
  });

  it('photo/collage page (no dominant paper): nothing is snapped', () => {
    // Two saturated halves + a NEUTRAL pale patch (diff 5 < 8 escapes the
    // stain rules, lum 226 < 238 escapes paper-white) that only the snap
    // could reach. With no paperish anchor it must survive untouched.
    const c = fakeCanvas(80, 60, (x, y) => {
      if (x < 40) return [200, 30, 30];
      if (y < 10) return [225, 228, 230];
      return [30, 60, 200];
    });
    applyFilters(c, settings({ colorMode: 'original' }), 'original');
    const [r, g, b] = px(c, 60, 3);
    assert.ok(r !== 255, 'no anchor → nothing snapped');
    assert.equal(r, 225);
    assert.equal(g, 228);
    assert.equal(b, 230);
  });

  it('bw mode on a dark page still prints white paper (preInvert path)', () => {
    const c = fakeCanvas(80, 60, (x, y) =>
      y < 6 ? [255 - 223, 255 - 231, 255 - 234] : [30, 25, 20],
    );
    applyFilters(c, settings({ colorMode: 'bw' }), 'bw');
    assert.ok(isWhite(px(c, 40, 30)), 'background must threshold to white');
    const film = px(c, 40, 2);
    assert.ok(film[0] === 255 || film[0] === 0, 'bw output is strictly two-level');
  });
});
