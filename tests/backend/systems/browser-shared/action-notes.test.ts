import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { recordBrowserAction,recordDeclaredActionNotRun,runDeclaredAction,withBrowserActionBinding,withBrowserActionNotes,withBrowserActionSession,type BrowserAction } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { DeclaredActionOccurrenceSchema } from "../../../../src/rules/workflow/task-provenance.js";

describe("browser action notes", () => {
  it("requires an explicit verified effect, preserves unconfirmed gestures and propagates verifier failures", async () => {
    const clock = manualClock(new Date("2026-09-23T12:00:00.000Z"));
    const run = async (verify?: () => Promise<boolean>) => {
      let drained: readonly BrowserAction[] = [];
      let occurrence = 0;
      const operation = withBrowserActionNotes(clock, () => withBrowserActionBinding((action) => ({ ...action,
        operation: DeclaredActionOccurrenceSchema.parse({ runId: "00000000-0000-4000-8000-000000000001", definitionFingerprint: "a".repeat(64), nodeId: "fixture", taskId: "ucpath/fixture", attempt: 2, claimGeneration: 3, taskAttempt: 4, invocationId: "fixture", occurrencePath: ["fixture"], logicalActionId: action.declaredActionId!, occurrence: ++occurrence, logicalSessionId: "fixture", state: action.state, ...(action.confirmation === undefined ? {} : { confirmation: action.confirmation }) }),
      }), () => runDeclaredAction({ id: "save", kind: "clicked", targetId: "fixture.save" }, async () => "protected-result", undefined,
        verify === undefined ? undefined : { id: "verify-save", targetId: "fixture.saved", verify })), (actions) => { drained = actions; });
      try { await operation; } catch (error) { return { drained, error }; }
      return { drained, error: undefined };
    };
    assert.deepEqual((await run()).drained.map((action) => action.state), ["started", "completed"]);
    const success = await run(async () => true);
    assert.deepEqual(success.drained.map((action) => action.state), ["started", "completed", "started", "completed", "confirmed"]);
    assert.deepEqual(success.drained.at(-1)?.confirmation, { verificationActionId: "verify-save", verificationOccurrence: 4, verifiedAt: clock.now().toISOString() });
    assert.ok(success.drained.every((action) => action.value === undefined && action.declaredValue === undefined));
    const failed = await run(async () => false);
    assert.match(String(failed.error), /declared-action-effect-not-confirmed/u);
    assert.deepEqual(failed.drained.map((action) => action.state), ["started", "completed", "started", "failed"]);
    const failure = new Error("selector timeout");
    const thrown = await run(async () => { throw failure; });
    assert.equal(thrown.error, failure);
    assert.ok(thrown.drained.every((action) => action.state !== "confirmed"));
  });

  it("buffers explicit lifecycle and not-run decisions, preserving the original failure", async () => {
    const clock = manualClock(new Date("2026-09-23T12:00:00.000Z"));
    const failure = new Error("driver failed");
    let drained: readonly BrowserAction[] = [];
    await assert.rejects(withBrowserActionNotes(clock, () => withBrowserActionBinding((action) => action, () => withBrowserActionSession("00000000-0000-4000-8000-000000000001", async () => {
      await runDeclaredAction({ id: "read-name", kind: "read", targetId: "fixture.name" }, async () => "Ada", (value) => value);
      recordDeclaredActionNotRun({ id: "skip-save", kind: "clicked", targetId: "fixture.save" }, "dry-run");
      assert.deepEqual(drained, []);
      await runDeclaredAction({ id: "submit", kind: "clicked", targetId: "fixture.submit" }, async () => { throw failure; });
    })), (actions) => { drained = actions; }), (error) => error === failure);
    assert.deepEqual(drained.map(({ state }) => state), ["started", "completed", "not-run", "started", "failed"]);
    assert.equal(drained[1]?.declaredValue, "Ada");
    assert.equal(drained[2]?.reason, "dry-run");
    assert.equal(drained[4]?.reason, "callback-failed");
    assert.ok(drained.every(({ physicalSessionId }) => physicalSessionId === "00000000-0000-4000-8000-000000000001"));
  });

  it("holds successful gestures in memory until the operation settles", async () => {
    const clock = manualClock(new Date("2026-09-23T12:00:00.000Z"));
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let drained: readonly BrowserAction[] = [];
    const operation = withBrowserActionNotes(clock, async () => {
      recordBrowserAction("typed", "kuali.action-list.search-input");
      await barrier;
      recordBrowserAction("clicked", "kuali.action-list.search-go-button");
      return "settled";
    }, (actions) => { drained = actions; });

    assert.deepEqual(drained, [], "the action sink must not run while a transaction is between fence and click");
    release?.();
    assert.equal(await operation, "settled");
    assert.deepEqual(drained.map(({ kind, targetId }) => ({ kind, targetId })), [
      { kind: "typed", targetId: "kuali.action-list.search-input" },
      { kind: "clicked", targetId: "kuali.action-list.search-go-button" },
    ]);
    recordBrowserAction("clicked", "kuali.action-list.search-go-button");
    assert.equal(drained.length, 2, "a settled scope cannot collect later work");
  });

  it("retains every gesture in a busy operation", async () => {
    const clock = manualClock(new Date("2026-09-23T12:00:00.000Z"));
    let recorded = 0;
    await withBrowserActionNotes(clock, async () => {
      for (let index = 0; index < 258; index += 1) recordBrowserAction("clicked", "ucpath.person-org.result");
    }, (actions) => {
      recorded = actions.length;
    });
    assert.equal(recorded, 258);
  });
});
