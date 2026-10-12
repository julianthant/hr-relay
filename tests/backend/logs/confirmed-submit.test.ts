import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { createConfirmedActionPublisher } from "../../../src/backend/logs/confirmed-action-publisher.js";
import { publishConfirmedSubmit } from "../../../src/backend/logs/confirmed-submit.js";
import { completeProtectedWrite,runMandatorySavedVerification } from "../../../src/backend/runtime/writes/mandatory-saved-verification.js";
import { createDeclaredActionBinder } from "../../../src/backend/runtime/writes/operation-action-binding.js";
import { runDeclaredAction,withBrowserActionBinding,withBrowserActionNotes,withBrowserActionSession,type BrowserAction } from "../../../src/backend/systems/browser-shared/action-notes.js";
import { UCPATH_SMART_HR_DELETE_SELECTED_BUTTON } from "../../../src/models/ui/ucpath-smart-hr-termination.js";
import { freezeWorkflowOperationDisplaySnapshot,WorkflowOperationDisplaySnapshotSchema } from "../../../src/models/workflow/operation-display-snapshot.js";
import { OperationOccurrenceSegmentSchema } from "../../../src/models/workflow/operation-display.js";
import { BrowserSessionIdSchema } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { plan1Leaf } from "../../support/fixtures/plan1-operation-workflows.js";

const runId = "00000000-0000-4000-8000-000000000002";
const session = "00000000-0000-4000-8000-000000000003";
const digest = "a".repeat(64);

function harness() {
  const clock = manualClock(new Date("2026-10-02T12:00:00.000Z"));
  const events: Array<import("../../../src/models/events/confirmed-action.js").ConfirmedActionEvent> = [];
  const publisher = createConfirmedActionPublisher({ workerId: "fixture-worker-1", streamId: "submit-stream-1", clock,
    capacity: 32, append: event => { events.push(event); } });
  const frozen = freezeWorkflowOperationDisplaySnapshot({ workflowId: plan1Leaf.descriptor.id,
    definitionFingerprint: plan1Leaf.descriptor.contractFingerprint, display: plan1Leaf.descriptor.operationDisplay });
  if (frozen === undefined) throw new Error("frozen fixture missing");
  const original = frozen.invocations[0];
  const snapshot = WorkflowOperationDisplaySnapshotSchema.parse({ ...frozen, invocations: [
    { ...original, id: "commit-operation", taskId: "ucpath/fixture-commit", contractRole: "commit" as const,
      operation: { ...original.operation, system: "ucpath" as const,
        session: { kind: "browser" as const, id: "fixture-session", system: "ucpath" as const },
        actions: [{ id: "submit", kind: "click" as const, target: UCPATH_SMART_HR_DELETE_SELECTED_BUTTON }] } },
    { ...original, id: "verify-operation", taskId: "ucpath/fixture-verify", contractRole: "verify" as const,
      operation: { ...original.operation, system: "ucpath" as const,
        session: { kind: "browser" as const, id: "fixture-session", system: "ucpath" as const },
        actions: [{ id: "saved", kind: "verify" as const, target: "fixture.saved" }] } },
  ] });
  const makeBinder = (role: "commit" | "verify", taskId: string) => createDeclaredActionBinder({ snapshot,
    runId, attempt: 2, claimGeneration: 3, taskAttempt: 1, nodeId: original.entryId, taskId, contractRole: role,
    parsedInput: { emplId: "10800000", text: "fixture", mode: "ok" }, protectedBindings: [] });
  const commits: BrowserAction[] = [];
  const verifiers: BrowserAction[] = [];
  let verifiedProofDigest: string | undefined;
  let submitCalls = 0;
  const commit = async () => withBrowserActionNotes(clock, () => withBrowserActionBinding(makeBinder("commit", "ucpath/fixture-commit"),
    () => withBrowserActionSession(session, async () => {
      await runDeclaredAction({ id: "submit", kind: "clicked", targetId: UCPATH_SMART_HR_DELETE_SELECTED_BUTTON },
        async () => { submitCalls += 1; });
    })), actions => { commits.push(...actions); });
  const verify = async (check: () => Promise<boolean>) => {
    await withBrowserActionNotes(clock,
    () => withBrowserActionBinding(makeBinder("verify", "ucpath/fixture-verify"),
      () => withBrowserActionSession(session, async () => {
        await runDeclaredAction({ id: "saved", kind: "verified", targetId: "fixture.saved" }, async () => {
          if (!await check()) throw new Error("saved-effect-unconfirmed");
        });
      })), actions => { verifiers.push(...actions); });
    verifiedProofDigest = digest;
  };
  const publish = (settled = true, overrides: Partial<Parameters<typeof publishConfirmedSubmit>[0]> = {}) => publishConfirmedSubmit({ publisher, snapshot, system: "ucpath", commitTaskId: "ucpath/fixture-commit",
    verifierTaskId: "ucpath/fixture-verify", commits, verifiers,
    verifiedProofDigest,
    ...(settled ? { durable: { writeIntentId: "intent-1", confirmedAt: clock.now().toISOString(), proofDigest: digest } } : {}),
    checkpointNodeId: original.entryId, checkpointProofDigest: digest, traceId: "fpo-120000-0002", ...overrides });
  return { clock, events, publisher, snapshot, commits, verifiers, commit, verify, publish, submitCalls: () => submitCalls };
}

describe("protected submit publication after sequencer settlement", () => {
  it("publishes only after exact saved verifier and durable proof are present", async () => {
    const h = harness();
    await h.commit();
    assert.equal(h.events.length, 0);
    assert.equal(h.publish(), "proof-unavailable");
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const verifying = h.verify(async () => { entered(); await pending; h.clock.advanceWall(20); return true; });
    await started;
    assert.equal(h.events.length, 0);
    release();
    await verifying;
    assert.equal(h.publish() === "proof-unavailable" ? "proof-unavailable" : h.events.length > 0 ? "delivered" : "refused", "delivered");
    assert.equal(h.events[0]?.kind, "fact");
    assert.equal(h.events[0]?.kind === "fact" ? h.events[0].meaning : undefined, "submit");
    assert.equal(h.submitCalls(), 1);
  });

  it("false or throwing verifier cannot publish submit or request another callback", async () => {
    for (const check of [async () => false, async () => { throw new Error("unreadable"); }]) {
      const h = harness();
      await h.commit();
      await assert.rejects(h.verify(check));
      assert.equal(h.publish(), "proof-unavailable");
      assert.equal(h.events.length, 0);
      assert.equal(h.submitCalls(), 1);
    }
  });

  it("refuses wrong frozen role or path, foreign session, stale verifier, and mismatched durable proof", async () => {
    const cases: readonly Readonly<{ name: string; change: (h: ReturnType<typeof harness>) => Partial<Parameters<typeof publishConfirmedSubmit>[0]> }>[] = [
      { name: "wrong role", change: h => ({ snapshot: WorkflowOperationDisplaySnapshotSchema.parse({ ...h.snapshot,
        invocations: h.snapshot.invocations.map(invocation => invocation.contractRole === "verify"
          ? { ...invocation, contractRole: "task" } : invocation) }) }) },
      { name: "wrong path", change: h => ({ commits: h.commits.map(note => note.operation?.state === "completed"
        ? { ...note, operation: { ...note.operation, occurrencePath: [OperationOccurrenceSegmentSchema.parse("foreign-step")] } } : note) }) },
      { name: "foreign physical session", change: h => ({ verifiers: h.verifiers.map(note => note.operation?.state === "completed"
        ? { ...note, physicalSessionId: BrowserSessionIdSchema.parse("00000000-0000-4000-8000-000000000004"),
          operation: { ...note.operation, physicalSessionId: BrowserSessionIdSchema.parse("00000000-0000-4000-8000-000000000004") } } : note) }) },
      { name: "stale verifier", change: h => ({ verifiers: h.verifiers.map(note => note.operation?.state === "completed"
        ? { ...note, at: "2026-10-02T11:59:59.000Z" } : note) }) },
      { name: "mismatched checkpoint digest", change: () => ({ checkpointProofDigest: "b".repeat(64) }) },
      { name: "mismatched saved digest", change: () => ({ verifiedProofDigest: "b".repeat(64) }) },
    ];
    for (const testCase of cases) {
      const h = harness();
      await h.commit();
      await h.verify(async () => true);
      assert.equal(h.publish(true, testCase.change(h)), "proof-unavailable", testCase.name);
      assert.equal(h.events.length, 0, testCase.name);
      assert.equal(h.submitCalls(), 1, testCase.name);
    }
  });

  it("runs commit, mandatory verifier, settlement, then publication despite diagnostic failures", async () => {
    const h = harness();
    let releaseVerifier!: () => void;
    let enteredVerifier!: () => void;
    let releaseSettlement!: () => void;
    let enteredSettlement!: () => void;
    let durable = false;
    const verifierBlocked = new Promise<void>(resolve => { releaseVerifier = resolve; });
    const verifierStarted = new Promise<void>(resolve => { enteredVerifier = resolve; });
    const settlementBlocked = new Promise<void>(resolve => { releaseSettlement = resolve; });
    const settlementStarted = new Promise<void>(resolve => { enteredSettlement = resolve; });
    const lifecycle = completeProtectedWrite({
      performCommitAndVerify: async () => {
        await h.commit();
        await runMandatorySavedVerification({
          diagnosticFailure: new Error("append failed"), diagnosticIsProgramFailure: () => false,
          reportDeliveryFailure: () => { throw new Error("health callback failed"); },
          verifySavedEffect: async () => h.verify(async () => { enteredVerifier(); await verifierBlocked; return true; }),
          onProgramFailure: error => { throw error; },
        });
        return { state: "new" as const, proof: { saved: true } };
      },
      settleVerified: async proof => { enteredSettlement(); await settlementBlocked; return proof; },
      onSettled: () => { durable = true; },
      reportDeliveryFailure: () => { throw new Error("health callback failed"); },
      projectSettled: settled => settled,
    });
    await verifierStarted;
    assert.equal(h.publish(false), "proof-unavailable");
    assert.equal(h.events.length, 0);
    releaseVerifier();
    await settlementStarted;
    assert.equal(h.publish(durable), "proof-unavailable");
    assert.equal(h.events.length, 0);
    releaseSettlement();
    await lifecycle;
    assert.equal(h.submitCalls(), 1);
    assert.equal(h.publish(durable) === "proof-unavailable", false);
    assert.equal(h.events.length, 1);
  });

  it("keeps diagnostic schema faults distinct after mandatory verification", async () => {
    const h = harness();
    await h.commit();
    let verified = false;
    await assert.rejects(runMandatorySavedVerification({
      diagnosticFailure: new Error("invalid diagnostic schema"),
      diagnosticIsProgramFailure: () => true,
      reportDeliveryFailure: () => { throw new Error("must not classify as delivery"); },
      verifySavedEffect: async () => { await h.verify(async () => true); verified = true; },
      onProgramFailure: error => { throw error; },
    }), /invalid diagnostic schema/u);
    assert.equal(verified, true);
    assert.equal(h.publish(false), "proof-unavailable");
    assert.equal(h.submitCalls(), 1);
  });
});
