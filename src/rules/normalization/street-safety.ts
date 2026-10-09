/** Refuse geocoder advice that changes the house number or loses a unit. */

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

/** A candidate street may replace the original ONLY when the house number is identical and every unit token the original carried survives; an empty candidate is never safe. */
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
