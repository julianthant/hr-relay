import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import {
CrossDateSearchPageSchema,
CrossDateSearchQuerySchema,
} from "../../../src/models/dashboard/search.js";

function searchWireResult(input: Readonly<{
  runId: string;
  traceId: string;
  enqueuedAt: string;
}>): Readonly<Record<string, unknown>> {
  return {
    runId: input.runId,
    traceId: input.traceId,
    workflowId: "separations",
    registration: {
      state: "registered",
      label: "Separations",
      code: "sp",
      categoryId: "separation",
    },
    partitionDay: "2026-11-01",
    state: "parked-gate",
    shape: "single",
    dryRun: true,
    priority: "interactive",
    systems: ["kuali", "new-kronos", "ucpath"],
    runNumber: { state: "absent", reason: "this historical run has no durable workflow ordinal" },
    retryOf: { state: "absent", reason: "this run is not a retry" },
    enqueuedAt: input.enqueuedAt,
    endedAt: { state: "absent", reason: `run ${input.runId} is parked-gate, not terminal` },
    match: { field: "workflow", strength: "exact" },
    metadata: { subject: { state: "unavailable", reason: "not-recorded" }, actor: { state: "unavailable", reason: "not-recorded" }, version: 1, failureCode: null, evidence: { receipt: false, failure: false, diagnostic: false } },
  };
}

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

  it("accepts query text and page limits at their exact public maxima", () => {
    const parsed = CrossDateSearchQuerySchema.parse({
      q: "x".repeat(160),
      limit: 50,
    });

    assert.equal(parsed.q.length, 160);
    assert.equal(parsed.limit, 50);
  });

  it("accepts filter-only queries under the explicit bounded candidate contract", () => {
    for (const q of ["", "   "]) {
      assert.equal(CrossDateSearchQuerySchema.parse({ q }).q, "");
    }
  });

  it("refuses zero, negative, and non-integer page limits", () => {
    for (const limit of [0, -1, 1.5]) {
      assert.throws(() => CrossDateSearchQuerySchema.parse({ q: "separations", limit }));
    }
  });

  it("bounds cursor length and refuses a non-string cursor", () => {
    const maximum = CrossDateSearchQuerySchema.parse({
      q: "separations",
      cursor: "x".repeat(2_048),
    });
    assert.equal(maximum.cursor?.length, 2_048);
    for (const cursor of ["", "x".repeat(2_049), 1]) {
      assert.throws(() => CrossDateSearchQuerySchema.parse({ q: "separations", cursor }));
    }
  });

  it("accepts the historical measured facets and refuses arbitrary input fields", () => {
    const facets = {
      workflow: "separations",
      day: "2026-08-28",
      state: "failed",
      shape: "single",
      dryRun: true,
      system: "kuali",
    };

    assert.deepEqual(
      CrossDateSearchQuerySchema.parse({ q: "separations", facets }).facets,
      facets,
    );
    assert.throws(
      () => CrossDateSearchQuerySchema.parse({ q: "separations", facets: { title: "unsafe" } }),
      /title/,
    );
  });

  it("refuses malformed facet values and the unassigned priority family", () => {
    const unsupportedFacets = [
      { workflow: "NOT A WORKFLOW" },
      { state: "imaginary" },
      { shape: "unknown-shape" },
      { dryRun: "false" },
      { system: "unknown-system" },
      { priority: "interactive" },
    ];

    for (const facets of unsupportedFacets) {
      assert.throws(
        () => CrossDateSearchQuerySchema.parse({ q: "separations", facets }),
        (error) => error instanceof z.ZodError,
        `facets ${JSON.stringify(facets)} are outside the approved strict metadata contract`,
      );
    }
  });
});

describe("cross-date search result", () => {
  it("refuses offset-form results that are not ordered by their instants", () => {
    const earlier = searchWireResult({
      runId: "00010001-0001-4001-8001-000100010001",
      traceId: "sp-160001-0001",
      enqueuedAt: "2026-11-01T01:30:00.000-07:00",
    });
    const later = searchWireResult({
      runId: "00020002-0002-4002-8002-000200020002",
      traceId: "sp-160002-0002",
      enqueuedAt: "2026-11-01T01:15:00.000-08:00",
    });

    assert.throws(
      () => CrossDateSearchPageSchema.parse({
        wireVersion: 1,
        generatedAt: "2026-11-02T16:00:00.000Z",
        snapshot: {
          authorityGeneration: 19,
          order: "match-strength/enqueued-desc/run-id-asc:v2",
          token: "test-snapshot-token",
        },
        totalMatches: 2,
      coverage: { matched: 2, subjectUnavailable: 2, actorUnavailable: 2, candidateLimit: 10000 },
        results: [earlier, later],
        nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
      }),
      /search page is not ordered by match-strength\/enqueued-desc\/run-id-asc:v2/,
    );
  });

  it("represents an exact zero-match page without an absent or unknown count", () => {
    assert.deepEqual(CrossDateSearchPageSchema.parse({
      wireVersion: 1,
      generatedAt: "2026-08-28T16:00:00.000Z",
      snapshot: {
        authorityGeneration: 19,
        order: "match-strength/enqueued-desc/run-id-asc:v2",
        token: "test-snapshot-token",
      },
      totalMatches: 0,
      coverage: { matched: 0, subjectUnavailable: 0, actorUnavailable: 0, candidateLimit: 10000 },
      results: [],
      nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
    }).totalMatches, 0);
  });

  it("serves one redacted authority row without a title or person identifier", () => {
    const parsed = CrossDateSearchPageSchema.parse({
      wireVersion: 1,
      generatedAt: "2026-08-28T16:00:00.000Z",
      snapshot: {
        authorityGeneration: 19,
        order: "match-strength/enqueued-desc/run-id-asc:v2",
        token: "test-snapshot-token",
      },
      totalMatches: 1,
      coverage: { matched: 1, subjectUnavailable: 1, actorUnavailable: 1, candidateLimit: 10000 },
      results: [{
        runId: "00010001-0001-4001-8001-000100010001",
        traceId: "sp-160000-0001",
        workflowId: "separations",
        registration: {
          state: "registered",
          label: "Separations",
          code: "sp",
          categoryId: "separation",
        },
        partitionDay: "2026-08-28",
        state: "failed",
        shape: "single",
        dryRun: true,
        priority: "interactive",
        systems: ["kuali", "new-kronos", "ucpath"],
        runNumber: { state: "present", value: 7 },
        retryOf: { state: "absent", reason: "this run is not a retry" },
        enqueuedAt: "2026-08-28T15:00:00.000Z",
        endedAt: { state: "present", value: "2026-08-28T15:05:00.000Z" },
        match: { field: "workflow", strength: "exact" },
    metadata: { subject: { state: "unavailable", reason: "not-recorded" }, actor: { state: "unavailable", reason: "not-recorded" }, version: 1, failureCode: null, evidence: { receipt: false, failure: false, diagnostic: false } },
      }],
      nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
    });

    assert.equal(parsed.results[0]?.workflowId, "separations");
    assert.equal("title" in (parsed.results[0] ?? {}), false);
    assert.throws(
      () => CrossDateSearchPageSchema.parse({ ...parsed, totalMatches: 0 }),
      /totalMatches cannot be smaller than the returned result count/,
    );
  });
});
