import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createDeclaredActionBinder } from "../../src/core/operation-action-binding.js";
import { DeclaredActionIdentitySchema } from "../../src/domain/workflow/operation-action-identity.js";
import { freezeWorkflowOperationDisplaySnapshot } from "../../src/domain/workflow/operation-display-snapshot.js";
import { manualClock } from "../../src/domain/clock.js";
import { runDeclaredAction, withBrowserActionBinding, withBrowserActionNotes, type BrowserAction } from "../../src/infra/browser/action-notes.js";
import { plan1Parent, plan1Contract } from "../fixtures/plan1-operation-workflows.js";

function fixture() {
  const frozen = freezeWorkflowOperationDisplaySnapshot({ workflowId: plan1Parent.descriptor.id, definitionFingerprint: plan1Parent.descriptor.contractFingerprint, display: plan1Parent.descriptor.operationDisplay });
  if (frozen === undefined) throw new Error("confirmation-fixture-missing");
  const invocation = frozen.invocations[0];
  const snapshot = { ...frozen, invocations: [{ ...invocation, operation: { ...invocation.operation, actions: [
    { id: "save", kind: "click" as const, target: "save", confirmationActionId: "check-save" },
    { id: "check-save", kind: "verify" as const, target: "saved" },
    { id: "other-check", kind: "verify" as const, target: "other" },
  ] } }] };
  const binder = createDeclaredActionBinder({ snapshot, runId: "00000000-0000-4000-8000-000000000001", attempt: 2, claimGeneration: 3, taskAttempt: 4, nodeId: invocation.entryId, taskId: plan1Contract.id, contractRole: "task", parsedInput: { emplId: "10800000", text: "fixture", mode: "ok" }, protectedBindings: [] });
  const action = (id: string, state: BrowserAction["state"], confirmation?: BrowserAction["confirmation"], session = "00000000-0000-4000-8000-000000000002") => binder({ kind: id === "save" ? "clicked" : "verified", targetId: id === "save" ? "save" : id === "check-save" ? "saved" : "other", declaredActionId: id, state, at: "2026-09-29T12:00:00.000Z", physicalSessionId: session, ...(confirmation === undefined ? {} : { confirmation }) });
  const complete = (id: string, session?: string) => { action(id, "started", undefined, session); return action(id, "completed", undefined, session); };
  const proof = { verificationActionId: "check-save", verificationOccurrence: 1, verifiedAt: "2026-09-29T12:00:00.000Z" };
  return { binder, action, complete, proof };
}

describe("exact expected-effect confirmation", () => {
  it("binds repeated gestures to the exact later verifier and preserves attempt identity", async () => {
    const { binder } = fixture();
    let drained: readonly BrowserAction[] = [];
    const clock = manualClock(new Date("2026-09-29T12:00:00.000Z"));
    let values = 0;
    await withBrowserActionNotes(clock, () => withBrowserActionBinding(binder, async () => {
      for (let index = 0; index < 2; index += 1) await runDeclaredAction({ id: "save", kind: "clicked", targetId: "save" }, async () => true, () => { values += 1; return true; }, { id: "check-save", targetId: "saved", verify: async () => true });
    }), (actions) => { drained = actions; });
    assert.equal(values, 2);
    assert.deepEqual(drained.filter((action) => action.operation?.state === "confirmed").map((action) => [action.operation?.occurrence, action.operation?.confirmation?.verificationOccurrence, action.operation?.attempt, action.operation?.claimGeneration, action.operation?.taskAttempt]), [[1, 1, 2, 3, 4], [2, 2, 2, 3, 4]]);
  });
  it("refuses unrelated, stale, duplicate and cross-session verification", () => {
    const unrelated = fixture(); unrelated.complete("save"); unrelated.complete("other-check");
    assert.throws(() => unrelated.action("save", "confirmed", { ...unrelated.proof, verificationActionId: "other-check" }), /confirmation-mismatch/u);
    const stale = fixture(); stale.complete("check-save"); stale.complete("save");
    assert.throws(() => stale.action("save", "confirmed", stale.proof), /confirmation-mismatch/u);
    const duplicate = fixture(); duplicate.complete("save"); duplicate.complete("check-save"); duplicate.action("save", "confirmed", duplicate.proof);
    assert.throws(() => duplicate.action("save", "confirmed", duplicate.proof), /without a recorded start/u);
    const incarnation = fixture(); incarnation.complete("save"); incarnation.complete("check-save", "00000000-0000-4000-8000-000000000003");
    assert.throws(() => incarnation.action("save", "confirmed", incarnation.proof), /confirmation-mismatch/u);
  });
  it("rejects confirmed identity without proof and nonconfirmed identity carrying proof", () => {
    const f = fixture(); const identity = f.complete("save").operation!;
    assert.equal(DeclaredActionIdentitySchema.safeParse({ ...identity, state: "confirmed" }).success, false);
    assert.equal(DeclaredActionIdentitySchema.safeParse({ ...identity, confirmation: f.proof }).success, false);
  });
});
