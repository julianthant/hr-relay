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

  it("refuses a page limit above the public maximum", () => {
    assert.throws(
      () => CrossDateSearchQuerySchema.parse({ q: "separations", limit: 51 }),
      /less than or equal to 50/,
    );
  });

  it("refuses query text above the public maximum", () => {
    assert.throws(
      () => CrossDateSearchQuerySchema.parse({ q: "x".repeat(161) }),
      /query must be at most 160 characters/,
    );
  });

  it("accepts only the facets measured in the current durable corpus", () => {
    const facets = {
      workflow: "separations",
      day: "2026-08-28",
      state: "failed",
      shape: "single",
      dryRun: true,
      priority: "interactive",
      system: "kuali",
    } as const;

    assert.deepEqual(
      CrossDateSearchQuerySchema.parse({ q: "separations", facets }).facets,
      facets,
    );
    assert.throws(
      () => CrossDateSearchQuerySchema.parse({ q: "separations", facets: { title: "unsafe" } }),
      /title/,
    );
  });
});
