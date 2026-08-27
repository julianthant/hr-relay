/**
 * The Employee Search result render, judged as DATA (§9.20 item 7 → §9.28).
 *
 * The interpreter's search poll used to accept a result row on sight — the
 * moment `[role='menuitemradio']` counted above zero — and then read each
 * row's identity. WFD renders a slat in TWO digests: the `slat-container` host
 * (the row, already carrying its role) lands first, and its
 * `krn-slats-tabular-data` card — the element whose `Name` / `ID` rows ARE the
 * identity text — is transcluded a digest later. Live 2026-08-27 the gap was
 * 33–34 ms on a cold profile's first search and 9–12 ms warm (two cold
 * attempts, every search); on 2026-08-19's loaded cold profile the driver's
 * 200 ms poll landed inside it and refused the row as `""`.
 *
 * This module is the verdict, out of the Playwright closure so a fixture can
 * reach it (the D205 discipline: a decision that only a real WFD session can
 * exercise is a decision nobody can pin).
 */

/** One rendered result row, as the interpreter reads it off the DOM. */
export interface SlatRenderFact {
  /** The row's accessible name, or its text when the row has none. */
  readonly label: string;
  /** Whether the row's `krn-slats-tabular-data` card has been transcluded yet. */
  readonly hydrated: boolean;
}

/**
 * - `results`: at least one row, and every row carries its tabular-data card —
 *   the identity can be read now.
 * - `hydrating`: rows exist but at least one has no card yet — the render is
 *   mid-flight; keep polling, and refuse if the bound elapses here.
 * - `absent`: no rows at all — the sentinel logic decides.
 */
export type SearchRenderVerdict = "results" | "hydrating" | "absent";

export function judgeSearchRender(slats: readonly SlatRenderFact[]): SearchRenderVerdict {
  // Extracted verbatim from the poll: a row on sight is a result. `hydrating`
  // is declared but not yet produced — the fix lands with its RED test.
  return slats.length === 0 ? "absent" : "results";
}

/** The identity WFD renders per row: `Name <name> ID <eid>` (label/value pairs of the tabular card). */
const SLAT_IDENTITY = /^Name\s+(.+?)\s+ID\s+(\d{6,10})$/u;

/**
 * Parse a row's label into its subject, or `null` when the label does not
 * carry the identity — the caller refuses by name; this never guesses.
 */
export function parseSlatIdentity(
  label: string,
): Readonly<{ displayName: string; employeeId: string }> | null {
  const match = SLAT_IDENTITY.exec(label.replace(/\s+/gu, " ").trim());
  if (match === null) return null;
  const [, displayName = "", employeeId = ""] = match;
  return Object.freeze({ displayName, employeeId });
}
