import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { measuredSearchService } from "../../../support/helpers/backend/cross-date-search-harness.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { type CrossDateSearchQueryService } from "../../../../src/backend/runs/queries/search.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { insertMeasuredSearchRun } from "../../../support/helpers/backend/cross-date-search-harness.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const CLOCK = manualClock(new Date("2026-08-28T16:00:00.000Z"));

function searchService(
  database: AuthorityDatabase,
  signingByte: number,
  sourceIdentity = database.getSourceDatabaseIdentity(),
): CrossDateSearchQueryService {
  return measuredSearchService(database, {
        clock: CLOCK,
        sourceIdentity,
        cursorSigningKey: new Uint8Array(32).fill(signingByte),
        descriptors: {
      resolve: (workflowId) => workflowId === "separations"
        ? { id: "separations", label: "Separations", code: "sp", category: "separation" }
        : undefined,
    },
      });
}

describe("cross-date search snapshot token", () => {
  it("binds export selection to the exact process signer, authority source, query, and generation", () => {
    const profile = createBoundProfileFixture();
    const database = AuthorityDatabase.open({
      path: profile.path,
      busyTimeoutMs: 1_000,
      migrationOwner: "search-selection-token-test",
    }, CLOCK);
    try {
      insertMeasuredSearchRun(database, { authorityPath: profile.path, seed: 81, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      const service = searchService(database, 0x41);
      const query = { q: "separations", scope: "workflow" as const, facets: {}, limit: 20 };
      const page = service.search(query);
      assert.match(page.snapshot.token, /^ss1\./u);
      CLOCK.advanceWall(1);
      assert.deepEqual(service.searchSelected(query, page.snapshot.token), page);

      const restarted = searchService(database, 0x42);
      assert.throws(
        () => restarted.searchSelected(query, page.snapshot.token),
        /snapshot token signature belongs to a different BFF process or was modified/,
      );
      const foreignAuthority = searchService(database, 0x41, "f".repeat(64));
      assert.throws(
        () => foreignAuthority.searchSelected(query, page.snapshot.token),
        /snapshot token belongs to a foreign authority source/,
      );
      assert.throws(
        () => service.searchSelected({ ...query, q: "sp" }, page.snapshot.token),
        /snapshot token belongs to a different query/,
      );

      insertMeasuredSearchRun(database, { authorityPath: profile.path, seed: 82, enqueuedAt: "2026-08-27T15:00:00.000Z" });
      assert.throws(
        () => service.searchSelected(query, page.snapshot.token),
        /snapshot token names authority generation .*current snapshot is generation/,
      );
    } finally {
      database.close();
      profile.close();
    }
  });
});
