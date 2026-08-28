import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import {
  CrossDateSearchPageSchema,
  CrossDateSearchQuerySchema,
} from "../../../src/domain/dashboard/search.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { manualClock } from "../../../src/domain/clock.js";
import { createCrossDateSearchService } from "../../../src/server/dashboard/queries/search.js";
import { runRecordOf } from "./helpers/dashboard-harness.js";

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

describe("cross-date search result", () => {
  it("represents an exact zero-match page without an absent or unknown count", () => {
    assert.deepEqual(CrossDateSearchPageSchema.parse({
      wireVersion: 1,
      generatedAt: "2026-08-28T16:00:00.000Z",
      snapshot: {
        authorityGeneration: 19,
        order: "match-strength/enqueued-desc/run-id-asc:v1",
      },
      totalMatches: 0,
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
        order: "match-strength/enqueued-desc/run-id-asc:v1",
      },
      totalMatches: 1,
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
      }],
      nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
    });

    assert.equal(parsed.results[0]?.workflowId, "separations");
    assert.equal("title" in (parsed.results[0] ?? {}), false);
  });
});

describe("cross-date search authority read", () => {
  it("returns a bounded page in stable match, time, and run-id order", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-cross-date-search-"));
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.db"), busyTimeoutMs: 1_000, migrationOwner: "search-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    try {
      const oldestFirstById = runRecordOf({ seed: 1, enqueuedAt: "2026-08-27T12:00:00.000Z" });
      const oldestSecondById = runRecordOf({ seed: 2, enqueuedAt: "2026-08-27T12:00:00.000Z" });
      const newest = runRecordOf({ seed: 3, enqueuedAt: "2026-08-28T12:00:00.000Z" });
      for (const record of [oldestSecondById, newest, oldestFirstById]) {
        database.authority.runs.enqueue(record);
      }

      const page = database.authority.runs.search({
        q: "person-lookup",
        scope: "all",
        facets: {},
        limit: 3,
      });

      assert.equal(page.totalMatches, 3);
      assert.deepEqual(page.rows.map(({ record }) => record.envelope.runId), [
        newest.envelope.runId,
        oldestFirstById.envelope.runId,
        oldestSecondById.envelope.runId,
      ]);
      assert.deepEqual(page.rows.map(({ matchRank }) => matchRank), [2, 2, 2]);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("cross-date search service", () => {
  it("projects a strict page from one exact authority snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-cross-date-service-"));
    const clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.db"), busyTimeoutMs: 1_000, migrationOwner: "search-service-test" },
      clock,
    );
    try {
      const run = runRecordOf({
        seed: 7,
        workflow: "person-lookup",
        dryRun: true,
        runNumber: 7,
        enqueuedAt: "2026-08-28T15:00:00.000Z",
      });
      database.authority.runs.enqueue(run);
      const search = createCrossDateSearchService({
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        descriptors: {
          resolve: (workflowId) => workflowId === "person-lookup"
            ? { id: "person-lookup", label: "Person Lookup", code: "pl", category: "search" }
            : undefined,
        },
        authority: {
          readSnapshot: (read) => database.withAuthorityTransaction((repositories) => read({
            authorityGeneration: database.getMeta().authorityGeneration,
            searchRuns: (input) => repositories.runs.search(input),
          })),
        },
      });

      const page = search.search({ q: "person-lookup", limit: 1 });

      assert.equal(page.totalMatches, 1);
      assert.equal(page.results[0]?.runId, run.envelope.runId);
      assert.deepEqual(page.results[0]?.registration, {
        state: "registered",
        label: "Person Lookup",
        code: "pl",
        categoryId: "search",
      });
      assert.equal("title" in (page.results[0] ?? {}), false);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
