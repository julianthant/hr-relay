import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { cleanReceiptOf, runRecordOf } from "./server/helpers/dashboard-harness.js";

describe("evidence receipt repository", () => {
  it("filters multiple real SQLite receipt rows by exact run with stable cardinality", () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-receipt-comparison-"));
    const database = AuthorityDatabase.open({
      path: join(root, "authority.sqlite"),
      busyTimeoutMs: 250,
      migrationOwner: "receipt-comparison-test",
    }, manualClock(new Date("2026-08-28T12:00:00.000Z")));

    try {
      const seeds = [503, 501, 502] as const;
      for (const seed of seeds) {
        database.authority.runs.enqueue(runRecordOf({ seed, workflow: "separations" }));
        database.authority.evidenceReceipts.insert(cleanReceiptOf({ seed, workflow: "separations" }));
      }

      const reads = seeds.map((seed) => database.authority.evidenceReceipts.listByRun(
        runRecordOf({ seed, workflow: "separations" }).envelope.runId,
      ));

      assert.deepEqual(reads.map((receipts) => receipts.length), [1, 1, 1]);
      assert.deepEqual(
        reads.map(([receipt]) => receipt?.receiptId),
        seeds.map((seed) => cleanReceiptOf({ seed, workflow: "separations" }).receiptId),
      );
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

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
