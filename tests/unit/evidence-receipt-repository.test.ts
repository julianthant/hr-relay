import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";

describe("evidence receipt repository", () => {
  it("refuses a list read whose run id is not exact", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-receipt-comparison-"));
    const database = AuthorityDatabase.open({
      path: join(root, "authority.sqlite"),
      busyTimeoutMs: 250,
      migrationOwner: "receipt-comparison-test",
    }, manualClock(new Date("2026-08-28T12:00:00.000Z")));

    try {
      assert.throws(
        () => database.authority.evidenceReceipts.listByRun("not-a-run-id"),
        /run id must be a UUID/,
      );
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
