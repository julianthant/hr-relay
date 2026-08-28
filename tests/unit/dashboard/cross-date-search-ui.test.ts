/**
 * DCR4's Top Bar search state and navigation handoff.
 *
 * These tests stay at the two operator-confirmed public seams: the control's
 * query/mode contract and the exact addressable route a result opens.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { routeForCrossDateSearchResult, routeToSearch } from "../../../src/dashboard/app/url-state.js";
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

describe("a cross-date search result", () => {
  it("opens its exact run in its partition rather than the current day", () => {
    const next = routeForCrossDateSearchResult(
      {
        start: false,
        day: "2026-08-28",
        archive: "archive-run",
        archiveView: "runs",
        settings: "storage",
      },
      {
        runId: "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b",
        partitionDay: "2026-08-21",
      },
    );

    assert.equal(routeToSearch(next), "?day=2026-08-21&run=3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b");
  });
});
