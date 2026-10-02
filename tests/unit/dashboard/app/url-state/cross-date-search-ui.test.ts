/**
 * DCR4's Top Bar search state and navigation handoff.
 *
 * These tests stay at the two operator-confirmed public seams: the control's
 * query/mode contract and the exact addressable route a result opens.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { routeForCrossDateSearchResult, routeToSearch } from "../../../../../src/dashboard/app/url-state.js";
import { DashboardClientError } from "../../../../../src/dashboard/client/errors.js";
import {
  CrossDateSearchPageSchema,
  currentCorpusSearchQuery,
  type CrossDateSearchPage,
} from "../../../../../src/models/dashboard/search.js";
import {
  appendCorpusSearchPage,
  corpusSearchFailure,
} from "../../../../../src/dashboard/surfaces/day-search-model.js";

const RAW_RUN_ID = "3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";

function corpusPage(): CrossDateSearchPage {
  return CrossDateSearchPageSchema.parse({
    wireVersion: 1,
    generatedAt: "2026-08-28T16:00:00.000Z",
    snapshot: {
      authorityGeneration: 19,
      order: "match-strength/enqueued-desc/run-id-asc:v2",
      token: "dcr4-test-snapshot-token",
    },
    totalMatches: 2,
    coverage:{matched:2,subjectUnavailable:2,actorUnavailable:2,candidateLimit:10000},
    results: [{
      runId: RAW_RUN_ID,
      traceId: "sp-160000-3b8f",
      workflowId: "separations",
      registration: { state: "registered", label: "Separations", code: "sp", categoryId: "separation" },
      partitionDay: "2026-08-03",
      state: "parked-gate",
      shape: "single",
      dryRun: true,
      priority: "interactive",
      systems: ["kuali", "new-kronos", "ucpath"],
      runNumber: { state: "present", value: 42 },
      retryOf: { state: "absent", reason: "this run is not a retry" },
      enqueuedAt: "2026-08-28T16:00:00.000Z",
      endedAt: { state: "absent", reason: "this run is parked at a gate" },
      match: { field: "workflow", strength: "exact" },
      metadata: { subject:{state:"unavailable",reason:"declaration-unavailable"}, actor:{state:"unavailable",reason:"not-recorded"},version:1,failureCode:null,evidence:{receipt:false,failure:false,diagnostic:false} },
    }],
    nextCursor: { state: "present", value: "opaque-first-page-cursor" },
  });
}

describe("the Top Bar corpus search", () => {
  it("starts a bounded metadata corpus query from the typed term", () => {
    assert.deepEqual(currentCorpusSearchQuery("  sp-160000  "), {
      q: "sp-160000",
      scope: "all",
      facets: {},
      limit: 20,
    });
  });

  it("requires the opaque snapshot token before a corpus page can reach the control", () => {
    const page = corpusPage();
    const { token: _token, ...snapshotWithoutToken } = page.snapshot;

    assert.throws(
      () => CrossDateSearchPageSchema.parse({ ...page, snapshot: snapshotWithoutToken }),
      /snapshot\.token|expected string/u,
    );
  });

  it("keeps a wire-schema refusal typed without echoing response detail", () => {
    const failure = corpusSearchFailure(new DashboardClientError({
      kind: "schema",
      message: "GET /api/v1/search: response failed its wire schema: run 3b8f0a1e-2c4d-4e6f-8a9b-0c1d2e3f4a5b",
    }));

    assert.deepEqual(failure, {
      code: "SEARCH_RESPONSE_REJECTED",
      message: "The service returned a search page outside the verified contract.",
      retryable: false,
    });
  });

  it("redacts non-schema and unsafe continuation failures before they enter UI state", () => {
    const first = corpusPage();
    let continuationCause: unknown;
    assert.throws(
      () => appendCorpusSearchPage(first, { ...first, nextCursor: { state: "absent", reason: "end" } }),
      (error: unknown) => {
        continuationCause = error;
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(RAW_RUN_ID, "u"));
        return true;
      },
    );

    const failures = [
      corpusSearchFailure(continuationCause),
      corpusSearchFailure(new DashboardClientError({
        kind: "http",
        code: RAW_RUN_ID,
        message: `server refusal for ${RAW_RUN_ID}`,
        retryable: true,
      })),
      corpusSearchFailure(new DashboardClientError({
        kind: "network",
        message: `network failure for ${RAW_RUN_ID}`,
        retryable: true,
      })),
      corpusSearchFailure(new Error(`unexpected ${RAW_RUN_ID}`)),
    ];

    for (const failure of failures) {
      assert.equal(failure.message.includes(RAW_RUN_ID), false);
      assert.equal(failure.code.includes(RAW_RUN_ID), false);
    }
    assert.deepEqual(failures[0], {
      code: "SEARCH_RESULT_SET_REJECTED",
      message: "The cross-date result set could not be safely applied.",
      retryable: false,
    });
    assert.deepEqual(failures[1], {
      code: "SEARCH_SERVICE_REJECTED",
      message: "The search service refused this request.",
      retryable: true,
    });
    assert.deepEqual(failures[2], {
      code: "SEARCH_UNAVAILABLE",
      message: "The search service could not be reached.",
      retryable: true,
    });
    assert.deepEqual(failures[3], {
      code: "SEARCH_RESULT_SET_REJECTED",
      message: "The cross-date result set could not be safely applied.",
      retryable: false,
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
