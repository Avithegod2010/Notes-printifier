/**
 * output-name.ts — smart names for the processed PDF.
 *
 * The download used to be a fixed "notes-printifier.pdf" for EVERY job, so a
 * week of use produced "notes-printifier (8).pdf", "notes-printifier (19)
 * (1).pdf"… — indistinguishable files that the browser disambiguates with
 * garbage counters. The output name now derives from the SOURCE document
 * plus the active grid, e.g.
 *
 *   "Physical Equilibrium.pdf" + 2×3 grid → "Physical Equilibrium-2x3-printified.pdf"
 *   3 merged documents                    → "My Notes-merged-3-2x2-printified.pdf"
 */

/** Longest base name we keep (OS path limits + download shelf sanity). */
const MAX_BASE = 60;

/**
 * Sanitize a source file name into a safe, human-friendly base:
 * strip the .pdf extension, replace filesystem-hostile characters, collapse
 * whitespace, and cap the length. Returns '' when nothing usable remains.
 */
function sanitizeBase(name: string): string {
  const noExt = name.replace(/\.pdf$/i, '');
  const cleaned = noExt
    .replace(/[\\/:*?"<>|]+/g, ' ') // filesystem-hostile → space
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '') // trim loose separators
    .slice(0, MAX_BASE)
    .replace(/[\s.-]+$/g, ''); // re-trim after the slice
  return cleaned;
}

/**
 * Build the output file name for a compose job.
 * `docs` are the source documents (first name leads); `rows`/`cols` the
 * active N-up grid; `outputPages` the final sheet count (kept for the
 * batch-queue-style suffix when there is no meaningful grid, e.g. 1-up).
 */
export function buildOutputName(
  docs: Array<{ name: string }>,
  rows: number,
  cols: number,
  outputPages?: number,
): string {
  const first = docs.length > 0 ? sanitizeBase(docs[0].name) : '';
  const parts: string[] = [];
  if (first) parts.push(first);
  if (docs.length > 1) parts.push(`merged-${docs.length}`);
  if (rows > 1 || cols > 1) {
    parts.push(`${Math.max(1, rows)}x${Math.max(1, cols)}`);
  } else if (outputPages && outputPages > 0) {
    parts.push(`${outputPages}p`);
  }
  parts.push('printified');
  const name = parts.join('-');
  // parts always end with 'printified', so the name is never empty — but a
  // paranoid fallback keeps the signature total.
  return name.length > 0 ? `${name}.pdf` : 'printified.pdf';
}
