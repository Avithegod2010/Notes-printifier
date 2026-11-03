/**
 * Integration tests for the /api routes (items 5, 10, 12).
 *
 * These run the REAL route handlers against a REAL Prisma client pointed at
 * a throwaway SQLite database (created via `prisma db push` before the
 * suite). The DATABASE_URL must be set before the first import of
 * `@/lib/db` — hence the top-level env assignment + dynamic imports.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const TEST_DB = join(process.cwd(), 'db', 'printifier-api-test.db');
process.env.DATABASE_URL = `file:${TEST_DB}`;

const json = (body: unknown, headers?: Record<string, string>): Request =>
  new Request('http://localhost:3000/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

// Top-level setup (bun's node:test shim lacks beforeAll): create the
// throwaway schema, THEN import the routes — @/lib/db reads DATABASE_URL
// when the client is first constructed, so the env must be set first.
execSync('bunx prisma db push --skip-generate --force-reset', {
  stdio: 'pipe',
  env: process.env,
});

// The specifiers are variables on purpose: the STATIC export build moves
// src/app/api aside, and a literal dynamic import would make the build's
// typecheck fail (TS2307) even though tests never run during the build.
// Bun resolves the alias at runtime; TS only needs the handler shape.
interface RouteModule {
  POST: (req: Request, ctx?: unknown) => Promise<Response>;
  GET: (req: unknown, ctx?: unknown) => Promise<Response>;
}
const importRoute = (spec: string): Promise<RouteModule> => import(spec);

const presetsRoute = await importRoute('@/app/api/presets/route');
const presetIdRoute = await importRoute('@/app/api/presets/[id]/route');
const printsRoute = await importRoute('@/app/api/prints/route');
const cloudImportRoute = await importRoute('@/app/api/cloud-import/route');
const { NextRequest } = await import('next/server');

const cloudReq = (url: string): import('next/server').NextRequest =>
  new NextRequest(new Request(`http://localhost:3000/api/cloud-import${url}`));

describe('POST /api/presets (write validation — item 5)', () => {
  it('stores a valid preset and returns an id', async () => {
    const res = await presetsRoute.POST(
      json({ name: 'Economy v2', filters: { colorMode: 'bw', inkSaver: 60 }, layout: { rows: 3, cols: 2 } }),
    );
    assert.equal(res.status, 201);
    const body = (await res.json()) as { ok: boolean; id: string };
    assert.equal(body.ok, true);
    assert.match(body.id, /^[A-HJ-NP-Z2-9]{8}$/);
  });

  it('sanitizes hostile settings BEFORE storage', async () => {
    const res = await presetsRoute.POST(
      json({
        name: 'evil',
        filters: { colorMode: 'RAINBOW', evil: true },
        layout: { rows: 99999, customDpi: 1e9 },
      }),
    );
    assert.equal(res.status, 201);
    const { id } = (await res.json()) as { id: string };
    const get = await presetIdRoute.GET(new Request(`http://x/${id}`), {
      params: Promise.resolve({ id }),
    });
    const body = (await get.json()) as { layout: { rows: number; customDpi: number | null }; filters: Record<string, unknown> };
    assert.equal(body.layout.rows, 8); // clamped
    assert.equal(body.layout.customDpi, 300); // clamped
    assert.equal(body.filters.colorMode, 'auto'); // invalid enum → factory default
    assert.equal('evil' in body.filters, false);
  });

  it('rejects malformed bodies', async () => {
    const noName = await presetsRoute.POST(json({ filters: {}, layout: {} }));
    assert.equal(noName.status, 400);
    const noLayout = await presetsRoute.POST(json({ name: 'x', filters: {} }));
    assert.equal(noLayout.status, 400);
    const badJson = await presetsRoute.POST(
      new Request('http://x', { method: 'POST', body: 'not json' }),
    );
    assert.equal(badJson.status, 400);
  });
});

describe('GET /api/presets/[id] (read validation + expiry — items 5, 10)', () => {
  it('404s a bad id', async () => {
    const res = await presetIdRoute.GET(new Request('http://x/lowcase!'), {
      params: Promise.resolve({ id: 'lowcase!' }),
    });
    assert.equal(res.status, 400);
  });

  it('404s an unknown-but-well-formed id', async () => {
    const res = await presetIdRoute.GET(new Request('http://x/AAAAAA22'), {
      params: Promise.resolve({ id: 'AAAAAA22' }),
    });
    assert.equal(res.status, 404);
  });

  it('enforces the 30-day expiry — expired rows are invisible', async () => {
    // create one, then backdate it directly through the db client
    const created = await presetsRoute.POST(json({ name: 'old', filters: {}, layout: {} }));
    const { id } = (await created.json()) as { id: string };
    const { db } = await import('@/lib/db');
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db.presetShare.update({ where: { id }, data: { createdAt: old } });

    const res = await presetIdRoute.GET(new Request(`http://x/${id}`), {
      params: Promise.resolve({ id }),
    });
    assert.equal(res.status, 404, 'expired shares must behave exactly like unknown ids');
  });

  it('re-sanitizes on read (defense in depth)', async () => {
    const created = await presetsRoute.POST(json({ name: 'ok', filters: { inkSaver: 10 }, layout: {} }));
    const { id } = (await created.json()) as { id: string };
    // simulate a legacy/corrupted row that was stored BEFORE validation existed
    const { db } = await import('@/lib/db');
    await db.presetShare.update({
      where: { id },
      data: { data: JSON.stringify({ filters: { inkSaver: 9000 }, layout: { rows: 1e6 } }) },
    });
    const res = await presetIdRoute.GET(new Request(`http://x/${id}`), {
      params: Promise.resolve({ id }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { filters: { inkSaver: number }; layout: { rows: number } };
    assert.equal(body.filters.inkSaver, 100);
    assert.equal(body.layout.rows, 8);
  });
});

describe('POST /api/prints (fileName hash enforcement — item 12)', () => {
  const validJob = {
    fileName: 'a'.repeat(16).replace(/a/g, 'b'), // 16 hex chars
    inputPages: 41,
    outputPages: 14,
    inputBytes: 1024,
    outputBytes: 512,
    colorMode: 'auto',
    layout: '3x1',
    inkSavedPct: 30,
  };

  it('accepts a 16-hex truncated sha256 hash', async () => {
    const res = await printsRoute.POST(json(validJob));
    assert.equal(res.status, 201);
  });

  it('rejects a raw file name — titles never reach the server', async () => {
    const res = await printsRoute.POST(json({ ...validJob, fileName: 'physics-wallah-week-4.pdf' }));
    assert.equal(res.status, 400);
    const res2 = await printsRoute.POST(json({ ...validJob, fileName: 'A'.repeat(16) })); // not hex
    assert.equal(res2.status, 400);
    const res3 = await printsRoute.POST(json({ ...validJob, fileName: 'abcd' })); // too short
    assert.equal(res3.status, 400);
  });
});

describe('GET /api/cloud-import (probe + SSRF wiring)', () => {
  it('answers the probe without a url', async () => {
    const res = await cloudImportRoute.GET(cloudReq(''));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; service: string };
    assert.equal(body.service, 'import');
  });

  it('blocks loopback/SSRF targets with 400 before any fetch', async () => {
    const res = await cloudImportRoute.GET(cloudReq('?url=http%3A%2F%2F169.254.169.254%2Fmeta'));
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.ok(body.error.length > 0);
  });

  it('blocks non-http schemes', async () => {
    const res = await cloudImportRoute.GET(cloudReq('?url=file%3A%2F%2F%2Fetc%2Fpasswd'));
    assert.equal(res.status, 400);
  });
});
