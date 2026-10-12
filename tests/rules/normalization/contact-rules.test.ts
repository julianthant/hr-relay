
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
canonicalizeRelationshipRule,
isLikelyUsAddress,
isUsCountry,
normalizeCountryHint,
normalizePhoneDigitsRule,
normalizeUsStateRule,
normalizeZipRule,
} from "../../../src/rules/normalization/contact-rules.js";

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
