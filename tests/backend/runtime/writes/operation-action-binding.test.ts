import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createDeclaredActionBinder } from "../../../../src/backend/runtime/writes/operation-action-binding.js";
import { runDeclaredAction,withBrowserActionBinding,withBrowserActionNotes,type BrowserAction } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { DeclaredActionIdentitySchema } from "../../../../src/models/workflow/operation-action-identity.js";
import { freezeWorkflowOperationDisplaySnapshot } from "../../../../src/models/workflow/operation-display-snapshot.js";
import { OperationActionIdSchema } from "../../../../src/models/workflow/operation-display.js";
import { IsoInstantSchema,PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { plan1Contract,plan1Parent } from "../../../support/fixtures/plan1-operation-workflows.js";

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
  const proof = { verificationActionId: OperationActionIdSchema.parse("check-save"), verificationOccurrence: PositiveIntSchema.parse(1), verifiedAt: IsoInstantSchema.parse("2026-09-29T12:00:00.000Z") };
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
    assert.throws(() => unrelated.action("save", "confirmed", { ...unrelated.proof, verificationActionId: OperationActionIdSchema.parse("other-check") }), /confirmation-mismatch/u);
    const stale = fixture(); stale.complete("check-save"); stale.complete("save");
    assert.throws(() => stale.action("save", "confirmed", stale.proof), /confirmation-mismatch/u);
    const duplicate = fixture(); duplicate.complete("save"); duplicate.complete("check-save"); duplicate.action("save", "confirmed", duplicate.proof);
    assert.throws(() => duplicate.action("save", "confirmed", duplicate.proof), /without a recorded start/u);
    const incarnation = fixture(); incarnation.complete("save"); incarnation.complete("check-save", "00000000-0000-4000-8000-000000000003");
    assert.throws(() => incarnation.action("save", "confirmed", incarnation.proof), /confirmation-mismatch/u);
  });
  it("refuses to relabel other gesture kinds as a declared save click", () => {
    const f = fixture();
    for (const kind of ["selected", "pressed", "branched", "joined", "gated", "delegated", "session"] as const) {
      assert.throws(() => f.binder({ kind, targetId: "save", declaredActionId: "save", state: "started",
        at: "2026-09-29T12:00:00.000Z", physicalSessionId: "00000000-0000-4000-8000-000000000002" }),
      new RegExp(`browser action ${kind} save is not declared for operation`, "u"));
    }
    const saved = f.complete("save").operation;
    assert.ok(saved);
    assert.equal(saved.logicalActionId, "save");
    assert.equal(saved.occurrence, 1, "refused gestures never start or consume a declared occurrence");
  });
  it("keeps supporting field clears unbound and refuses a concurrent declared start", () => {
    const f = fixture();
    const clear: BrowserAction = { kind: "cleared", targetId: "save", at: "2026-09-29T12:00:00.000Z" };
    assert.equal(f.binder(clear), clear, "a supporting clear cannot acquire a save identity");
    f.action("save", "started");
    assert.throws(() => f.action("save", "started"), /started concurrently within one invocation/u);
    const completed = f.action("save", "completed").operation;
    assert.ok(completed);
    assert.equal(completed.logicalActionId, "save");
    assert.equal(completed.occurrence, 1, "the admitted start remains the sole pending occurrence");
  });
  it("rejects confirmed identity without proof and nonconfirmed identity carrying proof", () => {
    const f = fixture(); const identity = f.complete("save").operation!;
    assert.equal(DeclaredActionIdentitySchema.safeParse({ ...identity, state: "confirmed" }).success, false);
    assert.equal(DeclaredActionIdentitySchema.safeParse({ ...identity, confirmation: f.proof }).success, false);
  });
});

it("keeps diagnostic screenshot associations unbound without admitting unknown gestures", () => {
  const { binder, complete } = fixture();
  const screenshot: BrowserAction = { kind: "screenshot", targetId: "ucpath.task-capture", at: "2026-09-29T12:00:00.000Z",
    physicalSessionId: "00000000-0000-4000-8000-000000000002", value: "00000000-0000-4000-8000-000000000003:00000000-0000-4000-8000-000000000004" };
  assert.equal(binder(screenshot), screenshot);
  assert.equal(screenshot.operation, undefined);
  assert.throws(() => binder({ ...screenshot, kind: "clicked", targetId: "unknown-control" }), /is not declared/);
  assert.equal(complete("save").operation?.occurrence, 1);
});
