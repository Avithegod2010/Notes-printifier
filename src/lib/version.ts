/** The running app version — keep in sync with public/version.json. */
export const APP_VERSION = '1.3.1-beta';

/**
 * Compare dotted versions; returns true when `remote` is NEWER than `local`.
 * Suffixes like -beta / -stable sort below the bare number.
 */
export function isNewerVersion(remote: string, local: string): boolean {
  const parse = (v: string) => {
    const [core, suffix = ''] = v.toLowerCase().split('-');
    const nums = core.split('.').map((n) => parseInt(n, 10) || 0);
    while (nums.length < 3) nums.push(0);
    return { nums, suffix };
  };
  const a = parse(remote);
  const b = parse(local);
  for (let i = 0; i < 3; i++) {
    if (a.nums[i] !== b.nums[i]) return a.nums[i] > b.nums[i];
  }
  // same numbers: bare > any suffix; otherwise alphabetical (beta < stable)
  if (a.suffix === b.suffix) return false;
  if (a.suffix === '') return true;
  if (b.suffix === '') return false;
  return a.suffix > b.suffix;
}
