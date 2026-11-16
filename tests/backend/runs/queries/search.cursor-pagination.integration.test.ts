import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { measuredSearchService } from "../../../support/helpers/backend/cross-date-search-harness.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { insertMeasuredSearchRun } from "../../../support/helpers/backend/cross-date-search-harness.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const TEST_CURSOR_SIGNING_KEY = new Uint8Array(32).fill(0x53);
const MEASURED_SEARCH_DESCRIPTOR = Object.freeze({
  id: "separations",
  label: "Separations",
  code: "sp",
  category: "separation",
});

function resolveMeasuredSearchDescriptor(workflowId: string) {
  return workflowId === MEASURED_SEARCH_DESCRIPTOR.id ? MEASURED_SEARCH_DESCRIPTOR : undefined;
}

describe("cross-date search service", () => {

  it("continues the stable order with an opaque cursor", async () => {
    const profile = await createBoundProfileFixture();
    const clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 1_000, migrationOwner: "search-cursor-test" },
      clock,
    );
    try {
      const first = insertMeasuredSearchRun(database, { authorityPath: profile.path, seed: 11, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      const second = insertMeasuredSearchRun(database, { authorityPath: profile.path, seed: 12, enqueuedAt: "2026-08-28T14:00:00.000Z" });
      const search = measuredSearchService(database, {
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        cursorSigningKey: TEST_CURSOR_SIGNING_KEY,
        descriptors: { resolve: resolveMeasuredSearchDescriptor },
      });

      const baseQuery = {
        q: "separations",
        scope: "all",
        facets: {
          workflow: "separations",
          day: "2026-08-28",
          state: "parked-gate",
          shape: "single",
          dryRun: true,
          system: "ucpath",
        },
        limit: 1,
      };
      const firstPage = search.search(baseQuery);
      assert.equal(firstPage.results[0]?.runId, first.envelope.runId);
      assert.equal(firstPage.nextCursor.state, "present");
      if (firstPage.nextCursor.state !== "present") return;
      const cursorValue = firstPage.nextCursor.value;

      assert.throws(
        () => search.search({ ...baseQuery, q: "person", cursor: cursorValue }),
        /cursor belongs to a different query/,
      );
      const changedBindings = [
        { binding: "scope", query: { ...baseQuery, scope: "workflow" } },
        {
          binding: "workflow facet",
          query: {
            ...baseQuery,
            facets: {
              day: baseQuery.facets.day,
              state: baseQuery.facets.state,
              shape: baseQuery.facets.shape,
              dryRun: baseQuery.facets.dryRun,
              system: baseQuery.facets.system,
            },
          },
        },
        {
          binding: "day facet",
          query: { ...baseQuery, facets: { ...baseQuery.facets, day: "2026-08-27" } },
        },
        {
          binding: "state facet",
          query: { ...baseQuery, facets: { ...baseQuery.facets, state: "failed" } },
        },
        {
          binding: "shape facet",
          query: {
            ...baseQuery,
            facets: {
              workflow: baseQuery.facets.workflow,
              day: baseQuery.facets.day,
              state: baseQuery.facets.state,
              dryRun: baseQuery.facets.dryRun,
              system: baseQuery.facets.system,
            },
          },
        },
        {
          binding: "dry-run facet",
          query: {
            ...baseQuery,
            facets: {
              workflow: baseQuery.facets.workflow,
              day: baseQuery.facets.day,
              state: baseQuery.facets.state,
              shape: baseQuery.facets.shape,
              system: baseQuery.facets.system,
            },
          },
        },
        {
          binding: "system facet",
          query: { ...baseQuery, facets: { ...baseQuery.facets, system: "kuali" } },
        },
        { binding: "page limit", query: { ...baseQuery, limit: 2 } },
      ];
      for (const { binding, query } of changedBindings) {
        assert.throws(
          () => search.search({ ...query, cursor: cursorValue }),
          /cursor belongs to a different query/,
          `cursor must bind ${binding}`,
        );
      }
      assert.throws(
        () => search.search({ ...baseQuery, cursor: "not-a-cursor" }),
        /cursor.*malformed/,
      );
      const foreignAuthority = measuredSearchService(database, {
        clock,
        sourceIdentity: "f".repeat(64),
        cursorSigningKey: TEST_CURSOR_SIGNING_KEY,
        descriptors: { resolve: resolveMeasuredSearchDescriptor },
      });
      assert.throws(
        () => foreignAuthority.search({ ...baseQuery, cursor: cursorValue }),
        /cursor belongs to a foreign authority source/,
      );

      clock.advanceWall(1);
      const secondPage = search.search({
        ...baseQuery,
        cursor: cursorValue,
      });
      assert.equal(secondPage.results[0]?.runId, second.envelope.runId);
      assert.equal(secondPage.nextCursor.state, "absent");
      assert.equal(secondPage.totalMatches, 2);
      assert.equal(secondPage.generatedAt, firstPage.generatedAt);
      assert.equal(secondPage.snapshot.token, firstPage.snapshot.token);

      insertMeasuredSearchRun(database, { authorityPath: profile.path,
        seed: 13,
        enqueuedAt: "2026-08-28T13:00:00.000Z",
      });
      assert.throws(
        () => search.search({ ...baseQuery, cursor: cursorValue }),
        /cursor names authority generation .*current snapshot is generation/,
      );
    } finally {
      database.close();
      await profile.close();
    }
  });

  it("continues a cursor across authority writes that leave the matched runs unchanged", async () => {
    const profile = await createBoundProfileFixture();
    const clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 1_000, migrationOwner: "search-cursor-unrelated-write-test" },
      clock,
    );
    try {
      const runs = [15, 14, 13].map((hour, index) => insertMeasuredSearchRun(database, {
        authorityPath: profile.path, seed: 21 + index, enqueuedAt: `2026-08-28T${String(hour)}:00:00.000Z`,
      }));
      const search = measuredSearchService(database, {
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        cursorSigningKey: TEST_CURSOR_SIGNING_KEY,
        descriptors: { resolve: resolveMeasuredSearchDescriptor },
      });
      const query = { q: "separations", scope: "all", facets: { day: "2026-08-28" }, limit: 1 };
      const toggleWorkerPause = () => {
        const slot = database.authority.workerSlots.list("separations").find(row => row.retiredAt === null);
        if (slot === undefined) throw new Error("search fixture worker slot missing");
        const before = database.getMeta().authorityGeneration;
        database.authority.workerSlots.setPaused({ workerId: slot.workerId, paused: !slot.paused, now: clock.now().toISOString() });
        assert.ok(database.getMeta().authorityGeneration > before, "the unrelated write must advance the authority generation");
      };

      const pages = [search.search(query)];
      for (;;) {
        const previous = pages.at(-1);
        if (previous?.nextCursor.state !== "present") break;
        toggleWorkerPause();
        pages.push(search.search({ ...query, cursor: previous.nextCursor.value }));
      }

      assert.deepEqual(pages.flatMap(page => page.results.map(row => row.runId)), runs.map(run => run.envelope.runId));
      for (const page of pages) {
        assert.deepEqual(page.snapshot, pages[0]?.snapshot);
        assert.equal(page.totalMatches, 3);
        assert.equal(page.generatedAt, pages[0]?.generatedAt);
      }
    } finally {
      database.close();
      await profile.close();
    }
  });
});
