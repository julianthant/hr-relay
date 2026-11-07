// Advance beyond the stored counter and floor it at current Unix seconds.
// Imported copies keep independent counters; enroll separate keys per profile.

/**
 * @param {unknown} storedCount the counter persisted for this credential
 * @param {unknown} nowSec current unix time in SECONDS
 * @returns {number} the counter to present, and to persist before presenting
 */
export function nextSignCount(storedCount, nowSec) {
  const stored = Number.isFinite(Number(storedCount)) ? Math.max(0, Math.floor(Number(storedCount))) : 0;
  const wallClock = Number.isFinite(Number(nowSec)) ? Math.max(0, Math.floor(Number(nowSec))) : 0;
  return Math.max(stored + 1, wallClock);
}
