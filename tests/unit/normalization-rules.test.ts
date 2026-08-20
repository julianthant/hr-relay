/**
 * Ref data-intake-and-edit-data §4.2's deterministic rules and the ported street/confidence
 * primitives, pinned against the legacy suites' own cases (match.test.ts,
 * normalize-contact.test.ts, street.test.ts, resolve.test.ts) so a drift
 * from the ported behaviour fails by name. The street-safety arms pin the
 * 2026-07-13 incident rules exactly.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  canonicalizeRelationshipRule,
  isLikelyUsAddress,
  isUsCountry,
  normalizeCountryHint,
  normalizePhoneDigitsRule,
  normalizeUsStateRule,
  normalizeZipRule,
} from "../../src/domain/normalization/contact-rules.js";
import {
  censusConfidence,
  confidenceFromImportance,
} from "../../src/domain/normalization/geocode.js";
import {
  extractUnitTokens,
  isSafeStreetReplacement,
  parseHouseNumber,
} from "../../src/domain/normalization/street-safety.js";

describe("contact rules — phone", () => {
  it("canonicalizes a US number to bare digits, dropping a leading country 1", () => {
    assert.equal(normalizePhoneDigitsRule("(858) 555-1212"), "8585551212");
    assert.equal(normalizePhoneDigitsRule("1-858-555-1212"), "8585551212");
  });
  it("keeps a plausible international number as digits", () => {
    assert.equal(normalizePhoneDigitsRule("+86 138 1234 5678"), "8613812345678");
  });
  it("refuses digit counts that are not a phone number", () => {
    assert.equal(normalizePhoneDigitsRule("12345"), null);
    assert.equal(normalizePhoneDigitsRule(""), null);
  });
});

describe("contact rules — state / zip / country / relationship", () => {
  it("maps a state name to its USPS code and uppercases a bare code", () => {
    assert.equal(normalizeUsStateRule("california"), "CA");
    assert.equal(normalizeUsStateRule("ca"), "CA");
    assert.equal(normalizeUsStateRule("District of Columbia"), "DC");
    assert.equal(normalizeUsStateRule("atlantis"), null);
  });
  it("accepts five and nine digit ZIPs, formatting ZIP+4, refusing the rest", () => {
    assert.equal(normalizeZipRule("92093"), "92093");
    assert.equal(normalizeZipRule("92093-0021"), "92093-0021");
    assert.equal(normalizeZipRule("920930021"), "92093-0021");
    assert.equal(normalizeZipRule("9209"), null);
  });
  it("normalizes country aliases and treats an absent country as US", () => {
    assert.equal(normalizeCountryHint("people's republic of china"), "CN");
    assert.equal(normalizeCountryHint("United Kingdom"), "GB");
    // The two-letter check runs BEFORE the alias table — legacy's exact order.
    assert.equal(normalizeCountryHint("uk"), "UK");
    assert.equal(isUsCountry(undefined), true);
    assert.equal(isUsCountry("U.S.A."), true);
    assert.equal(isUsCountry("Mexico"), false);
  });
  it("infers US shape from a ZIP or a two-letter state when country is absent", () => {
    assert.equal(isLikelyUsAddress({ zip: "92093" }), true);
    assert.equal(isLikelyUsAddress({ state: "CA" }), true);
    assert.equal(isLikelyUsAddress({ country: "Japan", zip: "1000001" }), false);
    assert.equal(isLikelyUsAddress({}), false);
  });
  it("canonicalizes relationships through the table, in-law before substrings", () => {
    assert.equal(canonicalizeRelationshipRule("Wife"), "Spouse");
    assert.equal(canonicalizeRelationshipRule("step-mom"), "Parent");
    assert.equal(canonicalizeRelationshipRule("mother-in-law"), "Relative");
    assert.equal(canonicalizeRelationshipRule("acquaintance from work"), null);
  });
});

describe("street safety — the 2026-07-13 incident rules", () => {
  it("parses house numbers including letter and range forms", () => {
    assert.equal(parseHouseNumber("9500 Gilman Dr"), "9500");
    assert.equal(parseHouseNumber("221B Baker St"), "221B");
    assert.equal(parseHouseNumber("Gilman Dr"), null);
  });
  it("extracts unit tokens across keyword and hash spellings", () => {
    assert.deepEqual(extractUnitTokens("9500 Gilman Dr Apt 4B"), ["apt4b"]);
    assert.deepEqual(extractUnitTokens("9500 Gilman Dr #12"), ["12"]);
  });
  it("refuses a replacement that changes the house number or drops a unit", () => {
    assert.equal(isSafeStreetReplacement("9500 Gilman Dr", "9500 Gilman Drive"), true);
    assert.equal(isSafeStreetReplacement("9500 Gilman Dr", "9600 Gilman Drive"), false);
    assert.equal(isSafeStreetReplacement("9500 Gilman Dr Apt 4B", "9500 Gilman Drive"), false);
    assert.equal(isSafeStreetReplacement("9500 Gilman Dr", ""), false);
  });
});

describe("geocode confidence — ported rules", () => {
  it("census: exact only when the matched house number is identical", () => {
    assert.equal(censusConfidence("9500 Gilman Dr", "9500 GILMAN DR, LA JOLLA, CA, 92093"), "exact");
    assert.equal(censusConfidence("9500 Gilman Dr", "9600 GILMAN DR, LA JOLLA, CA, 92093"), "approximate");
    assert.equal(censusConfidence("Gilman Dr", "GILMAN DR"), "approximate");
  });
  it("nominatim: importance tiers at 0.5 and 0.3, absent is approximate", () => {
    assert.equal(confidenceFromImportance(0.62), "exact");
    assert.equal(confidenceFromImportance(0.35), "approximate");
    assert.equal(confidenceFromImportance(0.1), "unverified");
    assert.equal(confidenceFromImportance(undefined), "approximate");
  });
});
