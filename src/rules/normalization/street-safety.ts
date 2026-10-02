/**
 * Street-line safety primitives — the choke-point guard that stops a geocoder
 * from corrupting a house number or dropping a unit designator.
 *
 * Ported VERBATIM from the legacy repository (D93 — copy with provenance,
 * never link): `legacy:src/services/address/street.ts` at commit `0034671d`.
 * These rules are incident-hardened: on 2026-07-13 an unguarded geocoder
 * street replacement corrupted 3/3 emergency-contact records live. A
 * suggested street that would change the house number, or lose a unit token
 * the operator's form carried, is REFUSED as advice — a plausible street on
 * the wrong building is exactly the silent-wrong-value failure this tree
 * bans.
 */

export function parseHouseNumber(street: string | null | undefined): string | null {
  const match = /^\s*(\d+[A-Za-z]?(?:[-–]\d+[A-Za-z]?)?)(?=\s|$)/u.exec(street ?? "");
  const captured = match?.[1];
  return captured === undefined ? null : captured;
}

const UNIT_KEYWORDS =
  "apt|apartment|unit|ste|suite|fl|floor|rm|room|bldg|building|lot|spc|trlr|trailer";
const UNIT_PATTERN = new RegExp(String.raw`(?:\b(?:${UNIT_KEYWORDS})\b\.?\s*#?\s*[\w-]+|#\s*[\w-]+)`, "giu");

export function extractUnitTokens(street: string | null | undefined): string[] {
  const matches = (street ?? "").match(UNIT_PATTERN) ?? [];
  return matches.map((token) => token.replace(/[.\s#]+/gu, "").toLowerCase());
}

/**
 * A candidate street may replace the original ONLY when the house number is
 * identical and every unit token the original carried survives. An empty
 * candidate is never safe.
 */
export function isSafeStreetReplacement(
  original: string | null | undefined,
  candidate: string | null | undefined,
): boolean {
  const trimmed = (candidate ?? "").trim();
  if (trimmed === "") return false;
  if (parseHouseNumber(original) !== parseHouseNumber(trimmed)) return false;
  const candidateUnits = new Set(extractUnitTokens(trimmed));
  return extractUnitTokens(original).every((token) => candidateUnits.has(token));
}
