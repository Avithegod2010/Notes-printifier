/**
 * "Recent conversions" — private, on-device history of the last few generated
 * PDFs (blob stored in IndexedDB; nothing ever leaves the browser).
 *
 * v2 adds a `sources` store: for small jobs we keep the ORIGINAL uploaded
 * PDFs next to the generated one, so the history can offer a one-tap
 * "Re-printify with different settings" (sources are capped harder than
 * jobs because they are bigger).
 */

export interface RecentJob {
  id: string;
  ts: number;
  name: string;
  inputPages: number;
  outputPages: number;
  outputBytes: number;
  inkSavedPct: number;
  colorMode: string;
  layout: string;
  blob: Blob;
}

/** One original source file kept alongside a finished job. */
export interface RecentSourceFile {
  name: string;
  blob: Blob;
}

interface RecentSource {
  id: string; // same id as the finished job
  ts: number;
  files: RecentSourceFile[];
}

const DB_NAME = 'notes-printifier';
const STORE = 'jobs';
const SRC_STORE = 'sources';
const DB_VERSION = 2;
const MAX_JOBS = 10;
/** Keep original sources only for jobs whose total upload size fits this. */
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_SOURCES = 3;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!req.result.objectStoreNames.contains(SRC_STORE)) {
        req.result.createObjectStore(SRC_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB tx aborted'));
  });
}

type NewRecentJob = Omit<RecentJob, 'id' | 'ts'>;

/** Save a finished conversion, prune to the newest MAX_JOBS, return its id. */
export async function saveRecentJob(job: NewRecentJob): Promise<string> {
  try {
    const db = await openDb();
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const entry: RecentJob = {
      ...job,
      id,
      ts: Date.now(),
    };
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    // prune older entries beyond MAX_JOBS
    const getAll = tx.objectStore(STORE).getAll();
    getAll.onsuccess = () => {
      const all = (getAll.result as RecentJob[]).sort((a, b) => b.ts - a.ts);
      for (const old of all.slice(MAX_JOBS)) {
        tx.objectStore(STORE).delete(old.id);
      }
    };
    await txDone(tx);
    db.close();
    return id;
  } catch {
    // history is a nice-to-have — never break the app over it
    return '';
  }
}

/**
 * Keep the ORIGINAL files of a finished job so it can be re-run with other
 * settings. Silently skipped for big uploads (history stays lightweight).
 */
export async function saveRecentSource(
  jobId: string,
  files: RecentSourceFile[],
  totalBytes: number,
): Promise<void> {
  if (!jobId || files.length === 0 || totalBytes > MAX_SOURCE_BYTES) return;
  try {
    const db = await openDb();
    const entry: RecentSource = { id: jobId, ts: Date.now(), files };
    const tx = db.transaction(SRC_STORE, 'readwrite');
    tx.objectStore(SRC_STORE).put(entry);
    const getAll = tx.objectStore(SRC_STORE).getAll();
    getAll.onsuccess = () => {
      const all = (getAll.result as RecentSource[]).sort((a, b) => b.ts - a.ts);
      for (const old of all.slice(MAX_SOURCES)) {
        tx.objectStore(SRC_STORE).delete(old.id);
      }
    };
    await txDone(tx);
    db.close();
  } catch {
    // optional — ignore
  }
}

/** Original files for a finished job, when they were kept. */
export async function getRecentSource(jobId: string): Promise<RecentSource | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(SRC_STORE, 'readonly');
    const req = tx.objectStore(SRC_STORE).get(jobId);
    const done = txDone(tx);
    const result = await new Promise<RecentSource | null>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as RecentSource | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    await done;
    db.close();
    return result;
  } catch {
    return null;
  }
}

/** All kept sources (to know which history entries can be re-run). */
export async function listRecentSources(): Promise<RecentSource[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(SRC_STORE, 'readonly');
    const req = tx.objectStore(SRC_STORE).getAll();
    const done = txDone(tx);
    const result = await new Promise<RecentSource[]>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as RecentSource[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    await done;
    db.close();
    return result;
  } catch {
    return [];
  }
}

export async function listRecentJobs(): Promise<RecentJob[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    const done = txDone(tx);
    const result = await new Promise<RecentJob[]>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as RecentJob[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    await done;
    db.close();
    return result.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

export async function removeRecentJob(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
    db.close();
  } catch {
    // ignore
  }
}

/** Trigger a browser download for a stored blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
