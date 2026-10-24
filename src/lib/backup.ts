/**
 * backup.ts — full-device backup for everything Printifier keeps locally:
 * user presets + impact meter + history metadata in ONE JSON file.
 *
 * 100% client-side, aligned with the privacy story: the backup NEVER
 * contains PDF bytes (history output blobs and original source files are
 * deliberately excluded — a backup is kilobytes, not megabytes). Restored
 * history rows show their stats; download/re-print for those rows stays
 * unavailable because the files themselves aren't in the backup.
 *
 * Preset-only sharing keeps its own smaller format (presets.ts
 * serializePresets/mergeImportedPresets) — a backup file is accepted by the
 * preset importer too (same presets array shape), but not vice versa.
 */

import { loadPresets, mergeImportedPresets, type Preset } from './presets';
import {
  loadInkStats,
  loadJobLog,
  saveInkStats,
  saveJobLog,
  type InkStats,
} from './ink-stats';
import { listRecentJobs, restoreRecentJobMeta, downloadBlob } from './recent-jobs';

export const BACKUP_SCHEMA = 1;

/** History row without the output blob — exactly what a backup carries. */
export interface BackupJobMeta {
  id: string;
  ts: number;
  name: string;
  inputPages: number;
  outputPages: number;
  outputBytes: number;
  inkSavedPct: number;
  colorMode: string;
  layout: string;
}

export interface BackupPayload {
  app: 'notes-printifier';
  kind: 'printifier-backup';
  schema: number;
  exportedAt: string;
  presets: Preset[];
  ink: InkStats;
  jobLog: number[];
  jobs: BackupJobMeta[];
}

export interface BackupReport {
  presets: number;
  jobs: number;
  statsRestored: boolean;
  skippedJobs: number;
}

/** Gather everything from localStorage + IndexedDB into one payload. */
export async function buildBackup(): Promise<BackupPayload> {
  let jobs: BackupJobMeta[] = [];
  try {
    const rows = await listRecentJobs();
    jobs = rows.map(({ blob: _blob, ...meta }) => meta);
  } catch {
    jobs = [];
  }
  return {
    app: 'notes-printifier',
    kind: 'printifier-backup',
    schema: BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    presets: loadPresets(),
    ink: loadInkStats(),
    jobLog: loadJobLog(),
    jobs,
  };
}

/** printifier-backup-2026-10-24.json */
export function backupFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `printifier-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

/** Build the payload and hand the JSON file to the browser's downloader. */
export async function downloadBackup(): Promise<void> {
  const payload = await buildBackup();
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  downloadBlob(blob, backupFileName());
}

function sanitizeInk(raw: unknown): InkStats | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Partial<InkStats>;
  const num = (v: unknown) => Math.max(0, Number(v) || 0);
  return {
    jobs: num(p.jobs),
    inputPages: num(p.inputPages),
    outputPages: num(p.outputPages),
    sheetsSaved: num(p.sheetsSaved),
    rupees: num(p.rupees),
    ts: num(p.ts),
  };
}

/**
 * Parse a backup file and restore everything it holds:
 *  - presets merged with collision-safe name suffixing (presets.ts)
 *  - impact totals restored only when the backup is newer/bigger
 *  - job log restored when the backup logged more jobs
 *  - history metadata restored row-by-row (no blobs — see file header)
 * Throws Error('bad-backup') when the file isn't a Printifier backup.
 */
export async function applyBackup(text: string): Promise<BackupReport> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('bad-backup');
  }
  const payload = data as Partial<BackupPayload> | null;
  if (
    !payload ||
    payload.app !== 'notes-printifier' ||
    (payload.kind !== 'printifier-backup' && payload.kind !== 'presets')
  ) {
    throw new Error('bad-backup');
  }

  // Presets — reuse the collision-safe merger. Accepts both backup files
  // and plain preset-share files (kind: 'presets').
  let presets = 0;
  if (Array.isArray(payload.presets) && payload.presets.length > 0) {
    presets = mergeImportedPresets(JSON.stringify(payload.presets));
  }

  let statsRestored = false;
  if (payload.kind === 'printifier-backup') {
    // Impact totals — newest wins, sanitized.
    const inc = sanitizeInk(payload.ink);
    if (inc) {
      const cur = loadInkStats();
      if (inc.ts >= cur.ts || inc.jobs > cur.jobs) {
        saveInkStats(inc);
        statsRestored = true;
      }
    }
    // Job log — the longer history wins (log is append-only by week).
    const incLog = Array.isArray(payload.jobLog)
      ? payload.jobLog.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    if (incLog.length > loadJobLog().length) {
      saveJobLog(incLog);
      statsRestored = true;
    }
  }

  // History metadata rows.
  let jobs = 0;
  let skippedJobs = 0;
  if (payload.kind === 'printifier-backup' && Array.isArray(payload.jobs)) {
    for (const j of payload.jobs) {
      const row = j as Partial<BackupJobMeta>;
      if (
        typeof row?.id === 'string' &&
        row.id.length > 0 &&
        typeof row?.ts === 'number' &&
        Number.isFinite(row.ts) &&
        typeof row?.name === 'string' &&
        typeof row?.inputPages === 'number' &&
        typeof row?.outputPages === 'number'
      ) {
        const ok = await restoreRecentJobMeta({
          id: row.id,
          ts: row.ts,
          name: row.name,
          inputPages: row.inputPages,
          outputPages: row.outputPages,
          outputBytes: Math.max(0, Number(row.outputBytes) || 0),
          inkSavedPct: Math.min(100, Math.max(0, Number(row.inkSavedPct) || 0)),
          colorMode: typeof row.colorMode === 'string' ? row.colorMode : '',
          layout: typeof row.layout === 'string' ? row.layout : '',
        });
        if (ok) jobs++;
        else skippedJobs++;
      } else {
        skippedJobs++;
      }
    }
  }

  return { presets, jobs, statsRestored, skippedJobs };
}
