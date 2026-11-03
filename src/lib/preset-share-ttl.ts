/**
 * preset-share-ttl.ts — shared constants + cleanup policy for the cloud
 * preset share links (F2). Links "expire in 30 days" — a promise the GET
 * route used to make without enforcing it. Cleanup runs opportunistically
 * (throttled to once per hour per server instance) from BOTH presets routes:
 * a fire-and-forget deleteMany on POST alone can be lost in a serverless
 * freeze, so every request path that can afford it takes a turn.
 */

export const PRESET_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Links created before this instant are expired. */
export function presetCutoff(now: number = Date.now()): Date {
  return new Date(now - PRESET_TTL_MS);
}

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastPruneAt = 0;

/** True at most once per hour — the caller then runs the prune fire-and-forget. */
export function shouldPrune(now: number = Date.now()): boolean {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return false;
  lastPruneAt = now;
  return true;
}
