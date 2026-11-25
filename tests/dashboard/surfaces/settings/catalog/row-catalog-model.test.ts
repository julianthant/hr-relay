import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { parseCatalogView } from "../../../../../src/dashboard/surfaces/settings/catalog/row-catalog-model.js";

describe("catalog view routing", () => {
  it("accepts the two views and drops anything else", () => {
    assert.equal(parseCatalogView("vocabulary"), "vocabulary");
    assert.equal(parseCatalogView("selectors"), "selectors");
    assert.equal(parseCatalogView("Selectors"), undefined);
    assert.equal(parseCatalogView(""), undefined);
    assert.equal(parseCatalogView(null), undefined);
  });
});
