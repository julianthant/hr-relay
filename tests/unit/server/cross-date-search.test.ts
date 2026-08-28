import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CrossDateSearchQuerySchema } from "../../../src/domain/dashboard/search.js";

describe("cross-date search query", () => {
  it("parses the bounded default query contract", () => {
    assert.deepEqual(CrossDateSearchQuerySchema.parse({ q: "separations" }), {
      q: "separations",
      scope: "all",
      facets: {},
      limit: 20,
    });
  });
});
