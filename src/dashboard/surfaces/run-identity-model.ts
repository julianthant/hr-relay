/**
 * The fingerprint cut for the eye
 *
 * It lives beside `run-identity.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */

const FINGERPRINT_PREFIX = 8;

/** the served fingerprint, at chip length — the full hash stays in the ⓘ */
export function shortFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, FINGERPRINT_PREFIX);
}
