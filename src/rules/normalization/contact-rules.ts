/** Deterministic contact normalization only. */
import { z } from "zod";
import { parseUsStateCode } from "../../models/fields/cell-coercion.js";

/** Shared field vocabulary for contact rules and normalization tasks. */
export const ContactFieldIdSchema = z.enum([
  "relationship", "cellPhone", "homePhone", "address1", "address2",
  "city", "state", "postalCode", "country",
]);
export type ContactFieldId = z.infer<typeof ContactFieldIdSchema>;

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

/** Absent country means US for domestic HR paper. */
export function isUsCountry(country: string | null | undefined): boolean {
  if (country === null || country === undefined || country.trim() === "") return true;
  const normalized = normalizeCountryHint(country);
  if (normalized === null) return true;
  if (normalized.length === 2) return normalized.toUpperCase() === "US";
  return US_ALIASES.has(normalized.toLowerCase());
}

/** US-shaped ZIP/state fallback when no explicit country is present; the absence checks are explicit, because an absent field and an empty field both mean the fact was not given. */
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

/** Digit extraction with the leading-1 strip and no display formatting: a 10-digit US number or an 11–15 digit international number, or `null` — never a guessed number. */
export function normalizePhoneDigitsRule(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  let digits = raw.trim().replace(/\D/gu, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length === 10) return digits;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/* ── US state (normalize-contact.ts @ 0034671d) ──────────────────────────── */

export function normalizeUsStateRule(raw: string | null | undefined): string | null {
  return raw === null || raw === undefined ? null : parseUsStateCode(raw);
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

/** Rule-table canonicalization only: the in-law check runs BEFORE the substring pass, and `null` means the table cannot decide, which the caller surfaces as `ambiguous`. */
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
