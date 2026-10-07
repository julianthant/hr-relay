import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import {
  createCrossDateSearchService,
  type CrossDateSearchQueryService,
} from "../../../../../../src/backend/runs/queries/search.js";
import { insertMeasuredSearchRun } from "../../../../../support/helpers/backend/cross-date-search-harness.js";

const CLOCK = manualClock(new Date("2026-08-28T16:00:00.000Z"));

function searchService(
  database: AuthorityDatabase,
  signingByte: number,
  sourceIdentity = database.getSourceDatabaseIdentity(),
): CrossDateSearchQueryService {
  return createCrossDateSearchService({
    clock: CLOCK,
    sourceIdentity,
    cursorSigningKey: new Uint8Array(32).fill(signingByte),
    descriptors: {
      resolve: (workflowId) => workflowId === "separations"
        ? { id: "separations", label: "Separations", code: "sp", category: "separation" }
        : undefined,
    },
    authority: {
      readSnapshot: (read) => database.withAuthorityReadSnapshot(() => read({
        authorityGeneration: database.getMeta().authorityGeneration,
        searchRuns: (input) => database.authority.runs.search(input),
      })),
    },
  });
}

describe("cross-date search snapshot token", () => {
  it("binds export selection to the exact process signer, authority source, query, and generation", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-search-selection-token-"));
    const database = AuthorityDatabase.open({
      path: join(root, "authority.db"),
      busyTimeoutMs: 1_000,
      migrationOwner: "search-selection-token-test",
    }, CLOCK);
    try {
      insertMeasuredSearchRun(database, { seed: 81, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      const service = searchService(database, 0x41);
      const query = { q: "separations", scope: "workflow" as const, facets: {}, limit: 20 };
      const page = service.search(query);
      assert.match(page.snapshot.token, /^ss1\./u);
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

      insertMeasuredSearchRun(database, { seed: 82, enqueuedAt: "2026-08-27T15:00:00.000Z" });
      assert.throws(
        () => service.searchSelected(query, page.snapshot.token),
        /snapshot token names authority generation .*current snapshot is generation/,
      );
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
