
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
extractUnitTokens,
isSafeStreetReplacement,
parseHouseNumber,
} from "../../../src/rules/normalization/street-safety.js";

describe("street normalization refuses unsafe address shapes", () => {
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
