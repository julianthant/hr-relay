/**
 * Reading and writing an operator's UI preference, WITHOUT losing the
 * difference between "nothing is stored" and "storage refused".
 *
 * Both outcomes usually land on the same rendered default, and that is fine —
 * a panel position is a preference, not a fact about a run. What is NOT fine is
 * a `catch` that returns the default directly: it makes a SecurityError, a
 * quota failure and a disabled store indistinguishable from a first visit, so
 * a browser where persistence is silently broken looks exactly like one where
 * the operator never chose. This module keeps the three cases apart in the
 * type, hands the caller a named reason when storage failed, and lets the
 * caller — not the accident — decide what a missing preference means.
 *
 * The default itself must be a named constant the caller owns, so "the default"
 * is a documented choice rather than a literal invented inside a catch block.
 */

export type PreferenceRead =
  | { readonly state: "stored"; readonly value: string }
  | { readonly state: "absent" }
  | { readonly state: "unavailable"; readonly reason: string };

export type PreferenceWrite =
  | { readonly state: "written" }
  | { readonly state: "unavailable"; readonly reason: string };

function reasonOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function readPreference(key: string): PreferenceRead {
  if (typeof window === "undefined") {
    return { state: "unavailable", reason: "no window (server-side render)" };
  }
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch (error: unknown) {
    return { state: "unavailable", reason: reasonOf(error) };
  }
  return raw === null ? { state: "absent" } : { state: "stored", value: raw };
}

export function writePreference(key: string, value: string): PreferenceWrite {
  if (typeof window === "undefined") {
    return { state: "unavailable", reason: "no window (server-side render)" };
  }
  try {
    window.localStorage.setItem(key, value);
  } catch (error: unknown) {
    return { state: "unavailable", reason: reasonOf(error) };
  }
  return { state: "written" };
}

/**
 * The common shape: a stored value that must be one of a closed set, with the
 * caller's own named default for every other case. A stored value OUTSIDE the
 * set is treated as absent — it is corrupt, not authoritative — and the caller
 * still gets its documented default rather than an invalid mode.
 */
export function readEnumPreference<Value extends string>(
  key: string,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  const read = readPreference(key);
  if (read.state !== "stored") return fallback;
  return (allowed as readonly string[]).includes(read.value) ? (read.value as Value) : fallback;
}
