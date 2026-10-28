import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { executeIdempotencyProbe } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { createDeterministicUcpathSmartHrDriver } from "../../../../src/backend/systems/ucpath/driver/smart-hr-fake.js";
import { UcpathCreateTermination } from "../../../../src/models/systems/ucpath/create-termination.js";
import { UcpathTerminationTargetSchema, UcpathTransactionScanSchema } from "../../../../src/models/ui/ucpath-smart-hr-termination.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { ManualScheduler, recordingLogger } from "../../../support/helpers/phase1f-executor-harness.js";

const target = UcpathTerminationTargetSchema.parse({ emplId: "10800000", expectedName: "Deterministic Person", emplRecord: "0",
  effectiveDate: "06/11/2026", template: "UC_VOL_TERM", reasonCode: "Resign - No Reason Given", lastDateWorked: "06/10/2026", initiatorComments: "Fixture" });
const now = "2026-10-27T18:00:00.000Z";
const row = { transactionId: "T002209631", emplId: target.emplId, action: "TER", approvalStatus: "Pending",
  startDate: target.effectiveDate, displayedName: target.expectedName };

async function read(transactionId: string, patch: Record<string, unknown> = {}, ignoreTarget = false) {
  const clock = manualClock(new Date(now));
  const driver = createDeterministicUcpathSmartHrDriver({ scan: UcpathTransactionScanSchema.parse({ state: "read", emplId: target.emplId,
    rows: [{ ...row, ...patch }, { ...row, transactionId: "T002209632" }], scannedRowCount: 2, observedAt: now }) });
  return executeIdempotencyProbe({ stores: taskStoreRegistry, clock, scheduler: new ManualScheduler(clock), taskDeadlineMs: 10_000,
    log: recordingLogger().log, sessions: { withDriver: async (need, _instance, _signal, operation) => {
      assert.equal(need.access, "read");
      return operation(ignoreTarget ? { ...driver, scanTerminationTransactions: async () => UcpathTransactionScanSchema.parse({
        state: "read", emplId: target.emplId, rows: [{ ...row, ...patch }], scannedRowCount: 1, observedAt: now }) } : driver);
    } } }, { commitContract: UcpathCreateTermination, commitInput: target, transactionId, instance: "test", signal: new AbortController().signal });
}

describe("targeted parked-write completion read", () => {
  it("reads the typed ID even when another termination has the same permanent subject and date", async () => {
    const verdict = await read(row.transactionId);
    assert.equal(verdict.state, "present"); if (verdict.state !== "present") throw new Error("present required");
    assert.deepEqual(verdict.proof, UcpathCreateTermination.example.receipt);
  });
  it("does not substitute another matching transaction when the typed ID is missing", async () => {
    assert.equal((await read("T999999999")).state, "absent");
  });
  it("rejects a verifier that returns another transaction ID", async () => {
    await assert.rejects(read("T999999999", {}, true), error => error instanceof Error && error.cause instanceof Error
      && error.cause.message === "write-recheck-transaction-identity-mismatch");
  });
  it("refuses a targeted transaction for another displayed subject", async () => {
    await assert.rejects(read(row.transactionId, { displayedName: "Another Person" }), /subject-mismatch|post-submit read-back/u);
  });
  it("does not accept a targeted transaction with another effective date", async () => {
    assert.equal((await read(row.transactionId, { startDate: "06/12/2026" })).state, "absent");
  });
});
