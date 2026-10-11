import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { cleanReceiptOf, uuidOf } from "../../../../../support/helpers/backend/dashboard-harness.js";
import { foundationFixture, failure, terminalizeFixtureFailure } from "../../../../../support/helpers/database-foundation/fixtures.js";

function insertReceipt(f: ReturnType<typeof foundationFixture>, seed: number) {
  const run = f.createRun(uuidOf(seed));
  const failed = {
    ...failure(),
    failureId: uuidOf(seed + 9000),
    runId: run.envelope.runId,
    traceId: run.envelope.traceId,
    workflowId: run.envelope.workflow,
    attempt: run.envelope.attempt,
  };
  assert.equal(terminalizeFixtureFailure(f, run, failed).state, "applied");
  return f.db.authority.evidenceReceipts.insert({
    ...cleanReceiptOf({ seed, workflow: run.envelope.workflow }),
    traceId: run.envelope.traceId,
    descriptorFingerprint: run.envelope.contractFingerprint,
    configFingerprint: run.envelope.configFingerprint,
    result: "failed",
    confidence: "partial",
    failure: { state: "present", value: failed.failureId },
  });
}

describe("evidence receipt repository", () => {
  it("filters multiple real SQLite receipt rows by exact run with stable cardinality", () => {
    const f = foundationFixture();
    try {
      const seeds = [503, 501, 502] as const;
      const inserted = seeds.map(seed => insertReceipt(f, seed));
      const reads = seeds.map(seed => f.db.authority.evidenceReceipts.listByRun(uuidOf(seed)));

      assert.deepEqual(reads.map((receipts) => receipts.length), [1, 1, 1]);
      assert.deepEqual(
        reads.map(([receipt]) => receipt?.receiptId),
        inserted.map(receipt => receipt.record.receiptId),
      );
    } finally {
      f.dispose();
    }
  });

  it("returns no receipt for a well-formed absent run in populated SQLite authority", () => {
    const f = foundationFixture();
    try {
      insertReceipt(f, 504);
      const receipts = f.db.authority.evidenceReceipts.listByRun(uuidOf(505));

      assert.deepEqual(receipts, []);
    } finally {
      f.dispose();
    }
  });

  it("refuses a list read whose run id is not exact", () => {
    const f = foundationFixture();
    try {
      assert.throws(
        () => f.db.authority.evidenceReceipts.listByRun("not-a-run-id"),
        /run id must be a UUID/,
      );
    } finally {
      f.dispose();
    }
  });
});
