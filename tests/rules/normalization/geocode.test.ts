
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
censusConfidence,
confidenceFromImportance,
} from "../../../src/rules/normalization/geocode.js";

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
