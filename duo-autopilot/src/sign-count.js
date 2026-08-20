// The WebAuthn signature counter this authenticator presents for one ceremony.
//
// ## Why this is not `stored + 1` (D243, 2026-08-19)
//
// A WebAuthn server treats a counter that does not ADVANCE as a cloned-key
// signal and rejects the assertion; Duo then renders a terminal "canceled or
// timed out" screen that never clears. The counter Duo compares against is
// per-CREDENTIAL and lives on ITS side — but this extension keeps its copy in
// `chrome.storage.local`, which is per BROWSER PROFILE, and one credential is
// replayed from many profiles (one per worker × system × instance × config
// fingerprint, plus every cold smoke). Those copies never see each other.
//
// `autoImportPackagedCredential` already knew this: it stamps a cold profile's
// counter to the current unix time precisely because "a unix timestamp is
// monotonic across fresh browser profiles". The sign path did not — it advanced
// by exactly one, as if the counter were private to this profile. So a cold
// profile JUMPS the shared server-side counter to `now` while every warm
// profile creeps by +1, and a warm profile that was cold-stamped earlier can
// never catch up: it is permanently one wall-clock gap behind, and every one of
// its logins is refused. That is the browser-profile "wedge" — reproduced live
// by forcing the stored counter 1 063 below Duo's observed value (60.01 s,
// refused) with nothing else changed (docs/migrations/separations.md §9.21).
//
// Flooring every ceremony at wall-clock seconds makes the presented counter
// monotonic across every profile that shares the credential, which is the
// property the shared server-side counter actually requires. `stored + 1` stays
// as the floor's floor so two ceremonies inside the same second still advance,
// and so a clock that goes backwards can never lower what we present.
//
// uint32 holds unix seconds until 2106, which is the same bound the import
// stamp already relies on.

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
