import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createConfirmedActionPublisher } from "../../../../src/backend/logs/confirmed-action-publisher.js";
import { drainBrowserActionNotes, type BrowserActionDrainStatus } from "../../../../src/backend/logs/browser-action-drain.js";
import { recordBrowserAction, withBrowserActionNotes } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { completeProtectedWrite, runMandatorySavedVerification } from "../../../../src/backend/runtime/writes/mandatory-saved-verification.js";

describe("browser action note drain after protected settlement", () => {
  it("keeps commit, saved verification and settlement despite append, warning and health callback failures", async () => {
    const clock = manualClock(new Date("2026-10-02T12:00:00.000Z"));
    const publisher = createConfirmedActionPublisher({ workerId: "fixture-worker-1", streamId: "drain-stream-1", clock,
      capacity: 4, append: () => {}, onHealth: () => { throw new Error("health callback failed"); } });
    const order: string[] = [];
    let commitCalls = 0;
    let emitCalls = 0;
    let status: BrowserActionDrainStatus | undefined;
    const result = await withBrowserActionNotes(clock, () => completeProtectedWrite({
      performCommitAndVerify: async () => {
        commitCalls += 1;
        order.push("commit");
        recordBrowserAction("clicked", "fixture.submit");
        recordBrowserAction("read", "fixture.receipt");
        await runMandatorySavedVerification({ diagnosticIsProgramFailure: () => false,
          reportDeliveryFailure: () => {}, verifySavedEffect: async () => { order.push("verify"); return true; },
          onProgramFailure: error => { throw error; } });
        return { state: "new" as const, proof: "saved-proof" };
      },
      settleVerified: async proof => { assert.equal(proof, "saved-proof"); order.push("settle"); return "committed" as const; },
      onSettled: () => { order.push("notified"); }, reportDeliveryFailure: () => {},
      projectSettled: settlement => settlement,
    }), actions => {
      status = drainBrowserActionNotes({ actions, publisher,
        emitAction: () => { emitCalls += 1; throw new Error("append failed"); },
        warn: () => { throw new Error("warning logger failed"); } });
      order.push("drain");
    });
    assert.equal(result, "committed");
    assert.deepEqual(order, ["commit", "verify", "settle", "notified", "drain"]);
    assert.equal(commitCalls, 1);
    assert.equal(emitCalls, 2);
    assert.deepEqual(status && { ...status, health: status.health.state }, {
      attempted: 2, failed: 2, state: "append-failed", warningFailed: true, health: "append-failed",
    });
    assert.equal(publisher.health().diagnosticFailure, true);
  });

  it("keeps schema faults distinct and exposes a failed health fallback", () => {
    const clock = manualClock(new Date("2026-10-02T12:00:00.000Z"));
    let schemaError: unknown;
    try { z.string().parse(1); } catch (error) { schemaError = error; }
    const action = { kind: "read" as const, targetId: "fixture.read", at: clock.now().toISOString() };
    const publisher = createConfirmedActionPublisher({ workerId: "fixture-worker-1", streamId: "drain-stream-2", clock,
      capacity: 4, append: () => {} });
    const program = drainBrowserActionNotes({ actions: [action], emitAction: () => { throw schemaError; },
      warn: () => {}, publisher });
    assert.equal(program.state, "program-error");
    assert.equal(program.health.state, "program-error");
    const fallback = drainBrowserActionNotes({ actions: [action], emitAction: () => { throw new Error("append failed"); },
      warn: () => { throw new Error("warn failed"); },
      publisher: { reportAppendFailure: () => { throw new Error("health failed"); },
        reportProgramError: () => { throw new Error("health failed"); } } });
    assert.deepEqual(fallback, { attempted: 1, failed: 1, state: "append-failed", warningFailed: true,
      health: { state: "report-failed" } });
  });
});
