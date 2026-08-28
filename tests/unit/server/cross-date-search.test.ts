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
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { createCrossDateSearchService } from "../../../src/server/dashboard/queries/search.js";
import { runRecordOf } from "./helpers/dashboard-harness.js";
import { SANITIZED_CROSS_DATE_SEARCH_CORPUS } from "../fixtures/cross-date-search-corpus.js";

describe("cross-date search query", () => {
  it("pins the sanitized authority corpus that closed the facet vocabulary", () => {
    const corpus = SANITIZED_CROSS_DATE_SEARCH_CORPUS;
    assert.equal(corpus.authority.runs, 7);
    assert.equal(corpus.projection.authorityJoinedSpanIdentities, corpus.authority.runs);
    assert.equal(corpus.projection.orphanSpanIdentitiesExcluded, 50);
    assert.equal(corpus.projection.authorityRunsMissingSpans, 0);
    assert.equal(corpus.authority.displayName.present, 0);
  });

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
    assert.throws(
      () => CrossDateSearchPageSchema.parse({ ...parsed, totalMatches: 0 }),
      /totalMatches cannot be smaller than the returned result count/,
    );
  });
});

describe("cross-date search authority read", () => {
  it("refuses a strict run record whose authority order instant is foreign", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-cross-date-malformed-"));
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.db"), busyTimeoutMs: 1_000, migrationOwner: "search-malformed-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    try {
      const enqueued = runRecordOf({ seed: 90, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      const malformed = RunRecordSchema.parse({
        ...enqueued,
        version: 2,
        createdAt: "2026-08-28T15:01:00.000Z",
        updatedAt: "2026-08-28T15:01:00.000Z",
      });
      database.authority.runs.enqueue(malformed);

      assert.throws(
        () => database.authority.runs.search({
          q: "person-lookup",
          scope: "workflow",
          facets: {},
          limit: 1,
        }),
        /authority order instant.*durable enqueue instant/,
      );
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

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

      const exactRun = database.authority.runs.search({
        q: newest.envelope.runId,
        scope: "run",
        facets: {},
        limit: 1,
      });
      assert.equal(exactRun.totalMatches, 1);
      assert.equal(exactRun.rows[0]?.matchRank, 0);
      const exactTrace = database.authority.runs.search({
        q: newest.envelope.traceId,
        scope: "trace",
        facets: {},
        limit: 1,
      });
      assert.equal(exactTrace.totalMatches, 1);
      assert.equal(exactTrace.rows[0]?.matchRank, 1);
      assert.equal(database.authority.runs.search({
        q: "person-lookup",
        scope: "run",
        facets: {},
        limit: 1,
      }).totalMatches, 0, "a workflow match cannot leak through run-only scope");

      const measuredFacets = database.authority.runs.search({
        q: "person-lookup",
        scope: "workflow",
        facets: {
          workflow: "person-lookup",
          day: {
            startsAt: "2026-08-28T07:00:00.000Z",
            endsBefore: "2026-08-29T07:00:00.000Z",
          },
          state: "queued",
          shape: "single",
          dryRun: false,
          priority: "interactive",
          system: "ucpath",
        },
        limit: 2,
      });
      assert.equal(measuredFacets.totalMatches, 1);
      assert.equal(measuredFacets.rows[0]?.record.envelope.runId, newest.envelope.runId);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("cross-date search service", () => {
  it("normalizes offset instants across a Pacific DST day and keyset pages", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-cross-date-offsets-"));
    const clock = manualClock(new Date("2026-11-02T12:00:00.000Z"));
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.db"), busyTimeoutMs: 1_000, migrationOwner: "search-offset-test" },
      clock,
    );
    try {
      const newest = runRecordOf({ seed: 31, enqueuedAt: "2026-11-01T01:15:00.000-08:00" });
      const middle = runRecordOf({ seed: 32, enqueuedAt: "2026-11-01T01:30:00.000-07:00" });
      const oldest = runRecordOf({ seed: 33, enqueuedAt: "2026-10-31T23:30:00.000-08:00" });
      const outsideDay = runRecordOf({ seed: 34, enqueuedAt: "2026-11-02T07:30:00.000-02:00" });
      for (const record of [middle, outsideDay, oldest, newest]) {
        database.authority.runs.enqueue(record);
      }
      const search = createCrossDateSearchService({
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        descriptors: { resolve: () => undefined },
        authority: {
          readSnapshot: (read) => database.withAuthorityTransaction((repositories) => read({
            authorityGeneration: database.getMeta().authorityGeneration,
            searchRuns: (input) => repositories.runs.search(input),
          })),
        },
      });

      const first = search.search({
        q: "person-lookup",
        facets: { day: "2026-11-01" },
        limit: 1,
      });
      assert.equal(first.totalMatches, 3);
      assert.equal(first.results[0]?.runId, newest.envelope.runId);
      assert.equal(first.results[0]?.enqueuedAt, "2026-11-01T09:15:00.000Z");
      assert.equal(first.results[0]?.partitionDay, "2026-11-01");
      if (first.nextCursor.state !== "present") {
        throw new Error("the first normalized page must carry a continuation");
      }

      const second = search.search({
        q: "person-lookup",
        facets: { day: "2026-11-01" },
        limit: 1,
        cursor: first.nextCursor.value,
      });
      assert.equal(second.results[0]?.runId, middle.envelope.runId);
      assert.equal(second.results[0]?.enqueuedAt, "2026-11-01T08:30:00.000Z");
      if (second.nextCursor.state !== "present") {
        throw new Error("the second normalized page must carry a continuation");
      }

      const third = search.search({
        q: "person-lookup",
        facets: { day: "2026-11-01" },
        limit: 1,
        cursor: second.nextCursor.value,
      });
      assert.equal(third.results[0]?.runId, oldest.envelope.runId);
      assert.equal(third.results[0]?.enqueuedAt, "2026-11-01T07:30:00.000Z");
      assert.equal(third.nextCursor.state, "absent");
      assert.equal(third.results.some(({ runId }) => runId === outsideDay.envelope.runId), false);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

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

  it("continues the stable order with an opaque cursor", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-cross-date-cursor-"));
    const clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.db"), busyTimeoutMs: 1_000, migrationOwner: "search-cursor-test" },
      clock,
    );
    try {
      const first = runRecordOf({ seed: 11, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      const second = runRecordOf({ seed: 12, enqueuedAt: "2026-08-27T15:00:00.000Z" });
      database.authority.runs.enqueue(first);
      database.authority.runs.enqueue(second);
      const search = createCrossDateSearchService({
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        descriptors: { resolve: () => undefined },
        authority: {
          readSnapshot: (read) => database.withAuthorityTransaction((repositories) => read({
            authorityGeneration: database.getMeta().authorityGeneration,
            searchRuns: (input) => repositories.runs.search(input),
          })),
        },
      });

      const firstPage = search.search({ q: "person-lookup", limit: 1 });
      assert.equal(firstPage.results[0]?.runId, first.envelope.runId);
      assert.equal(firstPage.nextCursor.state, "present");
      if (firstPage.nextCursor.state !== "present") return;
      const cursorValue = firstPage.nextCursor.value;

      assert.throws(
        () => search.search({ q: "person", limit: 1, cursor: cursorValue }),
        /cursor belongs to a different query/,
      );
      assert.throws(
        () => search.search({ q: "person-lookup", limit: 1, cursor: "not-a-cursor" }),
        /cursor.*malformed/,
      );
      const foreignAuthority = createCrossDateSearchService({
        clock,
        sourceIdentity: "f".repeat(64),
        descriptors: { resolve: () => undefined },
        authority: {
          readSnapshot: (read) => database.withAuthorityTransaction((repositories) => read({
            authorityGeneration: database.getMeta().authorityGeneration,
            searchRuns: (input) => repositories.runs.search(input),
          })),
        },
      });
      assert.throws(
        () => foreignAuthority.search({ q: "person-lookup", limit: 1, cursor: cursorValue }),
        /cursor does not belong to this authority snapshot source/,
      );

      const secondPage = search.search({
        q: "person-lookup",
        limit: 1,
        cursor: cursorValue,
      });
      assert.equal(secondPage.results[0]?.runId, second.envelope.runId);
      assert.equal(secondPage.nextCursor.state, "absent");
      assert.equal(secondPage.totalMatches, 2);

      database.authority.runs.enqueue(runRecordOf({
        seed: 13,
        enqueuedAt: "2026-08-26T15:00:00.000Z",
      }));
      assert.throws(
        () => search.search({ q: "person-lookup", limit: 1, cursor: cursorValue }),
        /cursor names authority generation .*current snapshot is generation/,
      );
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
