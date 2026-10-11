import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { UcpathTerminationProof } from "../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import type { DataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { verifyTerminationReceiptTask } from "../../../../src/workflows/separations/tasks/verify-termination-receipt.js";
const EID = EidSchema.parse("10800000");
const NAME = "Person, Deterministic";

class TaskRefusal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function taskContext() {
  const records: DataPoint[] = [];
  const ctx = {
    signal: new AbortController().signal,
    log: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
    fail: (code: string, message: string): never => {
      throw new TaskRefusal(code, message);
    },
    recordData(input: DataPoint | readonly DataPoint[]): void {
      records.push(...(Array.isArray(input) ? input : [input]) as DataPoint[]);
    },
  };
  return { ctx: ctx as never, records };
}

function terminationProof(overrides: Partial<UcpathTerminationProof> = {}): UcpathTerminationProof {
  return {
    kind: "ucpath-termination",
    emplId: EID,
    effectiveDate: "06/20/2026",
    transactionId: "T009000001",
    approvalStatus: "Pending",
    displayedName: NAME,
    source: "ss-smart-hr-detail-read",
    ...overrides,
  };
}

describe("separations workflow task wrappers", () => {

  it("records a settled receipt pair and refuses a denied transaction", async () => {
    const input = {
      proof: terminationProof(),
      disposition: "committed" as const,
      approvedEmplId: EID,
      expectedEffectiveDate: "06/20/2026",
    };
    const success = taskContext();
    const output = await verifyTerminationReceiptTask.impl.run({ input, ctx: success.ctx });
    const expected = {
      transactionNumber: "T009000001",
      approvalStatus: "Pending",
      effectiveDate: "06/20/2026",
      emplId: EID,
      displayedName: NAME,
      disposition: "committed",
    };
    assert.deepEqual(output, expected);
    const entries = Object.entries(expected);
    assert.deepEqual(success.records.map(({ direction, field }) => ({ direction, field })), entries.map(([field]) => ({
      direction: "read",
      field,
    })));
    assert.deepEqual(Object.fromEntries(success.records.map(({ field, value }) => [field, value])), expected);

    const refusal = taskContext();
    await assert.rejects(() => verifyTerminationReceiptTask.impl.run({
      input: { ...input, proof: terminationProof({ approvalStatus: "Denied" }) },
      ctx: refusal.ctx,
    }), (error: unknown) => error instanceof TaskRefusal && error.code === "termination-not-in-effect");
    assert.deepEqual(refusal.records, []);
  });
});
