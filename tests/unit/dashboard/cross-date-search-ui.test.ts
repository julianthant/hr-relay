/**
 * DCR4's Top Bar search state and navigation handoff.
 *
 * These tests stay at the two operator-confirmed public seams: the control's
 * query/mode contract and the exact addressable route a result opens.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { topBarCorpusQuery } from "../../../src/dashboard/surfaces/top-bar-model.js";

describe("the Top Bar corpus search", () => {
  it("starts a bounded Separations corpus query from the typed term", () => {
    assert.deepEqual(topBarCorpusQuery("  sp-160000  "), {
      q: "sp-160000",
      scope: "all",
      facets: {
        workflow: "separations",
        shape: "single",
        dryRun: true,
      },
      limit: 20,
    });
  });
});
