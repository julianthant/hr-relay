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

  it("continues the stable order with an opaque cursor", () => {
    const profile = createBoundProfileFixture();
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
        enqueuedAt: "2026-08-26T15:00:00.000Z",
      });
      assert.throws(
        () => search.search({ ...baseQuery, cursor: cursorValue }),
        /cursor names authority generation .*current snapshot is generation/,
      );
    } finally {
      database.close();
      profile.close();
    }
  });
});
