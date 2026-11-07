
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
parseHouseNumber,
} from "../../../src/rules/normalization/street-safety.js";

describe("street normalization refuses unsafe address shapes", () => {
  it("parses house numbers including letter and range forms", () => {
    assert.equal(parseHouseNumber("9500 Gilman Dr"), "9500");
    assert.equal(parseHouseNumber("221B Baker St"), "221B");
    assert.equal(parseHouseNumber("Gilman Dr"), null);
  });
});
