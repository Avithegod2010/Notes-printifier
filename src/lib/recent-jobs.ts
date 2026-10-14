/**
 * "Recent conversions" — private, on-device history of the last few generated
 * PDFs (blob stored in IndexedDB; nothing ever leaves the browser).
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

const DB_NAME = 'notes-printifier';
const STORE = 'jobs';
const MAX_JOBS = 5;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
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

export type NewRecentJob = Omit<RecentJob, 'id' | 'ts'>;

/** Save a finished conversion and prune to the newest MAX_JOBS entries. */
export async function saveRecentJob(job: NewRecentJob): Promise<void> {
  try {
    const db = await openDb();
    const entry: RecentJob = {
      ...job,
      id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
  } catch {
    // history is a nice-to-have — never break the app over it
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
