/** Reading and writing an operator's UI preference, WITHOUT losing the
 * difference between "nothing is stored" and "storage refused". */

type PreferenceRead =
  | { readonly state: "stored"; readonly value: string }
  | { readonly state: "absent" }
  | { readonly state: "unavailable"; readonly reason: string };

export type PreferenceWrite =
  | { readonly state: "written" }
  | { readonly state: "unavailable"; readonly reason: string };

function reasonOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function readPreference(key: string): PreferenceRead {
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

/** Invalid local preferences use the caller’s documented default; corrupt storage is not authority. */
export function readEnumPreference<Value extends string>(
  key: string,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  const read = readPreference(key);
  if (read.state !== "stored") return fallback;
  return (allowed as readonly string[]).includes(read.value) ? (read.value as Value) : fallback;
}
