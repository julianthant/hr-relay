/**
 * Deterministic contact-normalization rules (doc 06 §4.2) — the pure half of
 * legacy's `normalize-contact.ts`, ported with provenance (D93):
 * `legacy:src/services/llm/normalize-contact.ts` at commit `0034671d` and
 * `legacy:src/services/address/format.ts` at commit `ab9ab5ab`.
 *
 * Every rule here is ADVICE with a named rule id — the caller records a
 * `NormalizationChange` per applied rule and the review gate shows
 * before/after/source. A rule that cannot decide answers `null`/`undefined`
 * honestly rather than guessing; nothing in this module reaches a provider.
 *
 * Deliberately NOT ported: the LLM relationship fallback and the LLM
 * address-splitter (provider concerns; the `ai` advice arm lands with 2i's
 * advisory producer), and legacy's display phone format `(XXX) XXX-XXXX` —
 * this tree's canonical phone is the digits themselves
 * (`CANONICAL_FIELDS.cellPhone`, `PhoneDigitsSchema`); wire formatting
 * belongs to the consuming workflow's UCPath entry step.
 */
import { z } from "zod";

/** The closed rule vocabulary; a change names exactly the rule that made it. */
export const NormalizationRuleIdSchema = z.enum([
  "phone-digits",
  "state-usps-code",
  "zip-five-or-nine",
  "relationship-canonical",
  "country-alias",
]);
export type NormalizationRuleId = z.infer<typeof NormalizationRuleIdSchema>;

/* ── country (format.ts @ ab9ab5ab) ──────────────────────────────────────── */

const US_ALIASES = new Set(["us", "usa", "u.s.", "u.s.a.", "united states", "united states of america"]);

const COUNTRY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  china: "CN", "people's republic of china": "CN", prc: "CN",
  "united kingdom": "GB", uk: "GB", "great britain": "GB", england: "GB",
  canada: "CA", mexico: "MX", india: "IN", "south korea": "KR", korea: "KR",
  japan: "JP", taiwan: "TW", germany: "DE", france: "FR", australia: "AU",
  brazil: "BR", philippines: "PH", vietnam: "VN",
});

export function normalizeCountryHint(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (/^[A-Za-z]{2}$/u.test(trimmed)) return trimmed.toUpperCase();
  const alias = COUNTRY_ALIASES[trimmed.toLowerCase()];
  if (alias !== undefined) return alias;
  return trimmed;
}

/** Absent country reads as US — legacy's rule for domestic HR paper. */
export function isUsCountry(country: string | null | undefined): boolean {
  if (country === null || country === undefined || country.trim() === "") return true;
  const normalized = normalizeCountryHint(country);
  if (normalized === null) return true;
  if (normalized.length === 2) return normalized.toUpperCase() === "US";
  return US_ALIASES.has(normalized.toLowerCase());
}

/**
 * US-shaped ZIP/state fallback when no explicit country is present. The
 * absence checks are explicit (never `?? ""`): an absent field and an empty
 * field both mean "this fact was not given", and the distinction stays
 * visible in the code.
 */
export function isLikelyUsAddress(input: Readonly<{
  country?: string | null;
  zip?: string | null;
  state?: string | null;
}>): boolean {
  if (input.country !== null && input.country !== undefined && input.country.trim() !== "") {
    return isUsCountry(input.country);
  }
  if (input.zip !== null && input.zip !== undefined
    && /^\d{5}(\d{4})?$/u.test(input.zip.replace(/\D/gu, ""))) {
    return true;
  }
  return input.state !== null && input.state !== undefined && /^[A-Za-z]{2}$/u.test(input.state.trim());
}

/* ── phone (normalize-contact.ts @ 0034671d, digits-canonical variant) ───── */

/**
 * Legacy's digit extraction with the leading-1 strip, WITHOUT the display
 * formatting: a 10-digit US number (after dropping a leading country 1) or
 * an 11–15 digit international number is returned as bare digits; anything
 * else is `null` — never a guessed number.
 */
export function normalizePhoneDigitsRule(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  let digits = raw.trim().replace(/\D/gu, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length === 10) return digits;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/* ── US state (normalize-contact.ts @ 0034671d) ──────────────────────────── */

const US_STATES: Readonly<Record<string, string>> = Object.freeze({
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC",
});

export function normalizeUsStateRule(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (/^[A-Za-z]{2}$/u.test(trimmed)) return trimmed.toUpperCase();
  const mapped = US_STATES[trimmed.toLowerCase()];
  return mapped === undefined ? null : mapped;
}

/* ── ZIP (normalize-contact.ts @ 0034671d) ───────────────────────────────── */

export function normalizeZipRule(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = raw.trim().replace(/[^\d-]/gu, "");
  if (/^\d{5}$/u.test(digits)) return digits;
  if (/^\d{5}-\d{4}$/u.test(digits)) return digits;
  const bare = digits.replace(/\D/gu, "");
  if (bare.length === 9) return `${bare.slice(0, 5)}-${bare.slice(5)}`;
  return null;
}

/* ── relationship (normalize-contact.ts @ 0034671d) ──────────────────────── */

export const CanonicalRelationshipSchema = z.enum([
  "Spouse", "Partner", "Parent", "Child", "Sibling", "Grandparent",
  "Grandchild", "Relative", "Friend", "Guardian", "Other",
]);
export type CanonicalRelationship = z.infer<typeof CanonicalRelationshipSchema>;

const RELATIONSHIP_RULES: Readonly<Record<string, CanonicalRelationship>> = Object.freeze({
  spouse: "Spouse", husband: "Spouse", wife: "Spouse", "significant other": "Partner",
  partner: "Partner", boyfriend: "Partner", girlfriend: "Partner", fiance: "Partner", fiancee: "Partner",
  mother: "Parent", father: "Parent", mom: "Parent", dad: "Parent", parent: "Parent", mum: "Parent",
  son: "Child", daughter: "Child", child: "Child", kid: "Child",
  brother: "Sibling", sister: "Sibling", sibling: "Sibling", bro: "Sibling", sis: "Sibling",
  grandmother: "Grandparent", grandfather: "Grandparent", grandma: "Grandparent",
  grandpa: "Grandparent", grandparent: "Grandparent",
  grandson: "Grandchild", granddaughter: "Grandchild", grandchild: "Grandchild",
  aunt: "Relative", uncle: "Relative", cousin: "Relative", niece: "Relative",
  nephew: "Relative", "in-law": "Relative", relative: "Relative",
  friend: "Friend", roommate: "Friend", neighbor: "Friend",
  guardian: "Guardian", other: "Other",
});

/**
 * Rule-table canonicalization only — the LLM fallback did not port. The
 * in-law check runs BEFORE the substring pass (legacy's own comment: without
 * it "mother-in-law" collapses to Parent). `null` means the table cannot
 * decide, which the caller surfaces as `ambiguous` — never a guess.
 */
export function canonicalizeRelationshipRule(raw: string | null | undefined): CanonicalRelationship | null {
  if (raw === null || raw === undefined) return null;
  const lowered = raw.trim().toLowerCase();
  if (lowered === "") return null;
  if (lowered.includes("in-law") || lowered.includes("in law")) return "Relative";
  const exact = RELATIONSHIP_RULES[lowered];
  if (exact !== undefined) return exact;
  for (const [keyword, canonical] of Object.entries(RELATIONSHIP_RULES)) {
    if (lowered.includes(keyword)) return canonical;
  }
  return null;
}
