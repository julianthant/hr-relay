/**
 * D314 — a completed external write never executes twice, whichever recovery
 * choice the operator takes, and a restart whose fresh facts no longer match
 * the completed write refuses by name.
 *
 * The REAL write sequencer runs over a REAL authority database and the
 * deterministic UCPath Smart HR world:
 *
 * 1. attempt 1 files the termination — exactly one stage and one click;
 * 2. a Restart-from-start attempt of the same item reaches the same node with
 *    the same fresh facts — the settlement replays from its durable proof, and
 *    the world sees no second stage, fence or click;
 * 3. a restart whose fresh facts derive a DIFFERENT permanent key (another
 *    approved EID) refuses by node name and key digest reference, still with
 *    no stage, fence or click;
 * 4. a restart that BOTH drifted (the descriptor moved under the stored
 *    settlement) and moved its fresh facts is refused as DRIFT — the drift
 *    check runs before the fresh-fact lookup, so the operator is told the one
 *    thing that has to be resolved first rather than a mismatch derived from a
 *    checkpoint this build may no longer read.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { FingerprintSchema } from "../../../../../../src/rules/identity/ids.js";
import type { RunRecord } from "../../../../../../src/models/run/record.js";
import { UUID_5, UUID_7 } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import {
  COMPOSITION_EID,
  COMPOSITION_OTHER_EID,
  COMPOSITION_RECEIPT,
  COMPOSITION_RUN_INPUT,
  COMPOSITION_SCOPE_OUTPUTS,
  TERMINATION_IDEMPOTENCY_KEY,
  TERMINATION_NODE,
  compositionClaimRunning,
  compositionContext,
  compositionHarness,
  compositionPendingSet,
  compositionQueuedRun,
  type CompositionHarness,
} from "../../../../../support/helpers/separations-composition-fixtures.js";

const open: CompositionHarness[] = [];
afterEach(() => {
  for (const harness of open.splice(0)) harness.dispose();
});

function harness(): CompositionHarness {
  const created = compositionHarness();
  open.push(created);
  return created;
}

function restartRun(runId: string, attempt: number, retryOf: string): Record<string, unknown> {
  const run = compositionQueuedRun();
  const envelope = run.envelope as Record<string, unknown>;
  envelope.runId = runId;
  envelope.attempt = attempt;
  envelope.retryOf = retryOf;
  envelope.recovery = "restart-from-start";
  envelope.traceId = `sp-100000-${String(attempt).padStart(4, "0")}`;
  return run;
}

function worldCounts(h: CompositionHarness): Readonly<{ stages: number; clicks: number; rows: number }> {
  return {
    stages: h.ucpath.events.filter((event) => event.startsWith("stage:")).length,
    clicks: h.ucpath.events.filter((event) => event.startsWith("commit:")).length,
    rows: h.ucpath.rows.length,
  };
}

async function fileTermination(h: CompositionHarness): Promise<RunRecord> {
  const { run, claim } = compositionClaimRunning(h.database, h.clock, compositionQueuedRun(), TERMINATION_NODE);
  const outcome = await h.bound(() => h.sequencer.executeTransaction(compositionContext(run, claim, TERMINATION_NODE)));
  assert.equal(Reflect.get(outcome as object, "disposition"), "committed");
  assert.deepEqual(worldCounts(h), { stages: 1, clicks: 1, rows: 1 });
  // Attempt 1 ends terminal so the same worker may claim the item's next attempt.
  const current = h.database.authority.runs.get(run.envelope.runId);
  assert.ok(current !== undefined);
  const now = h.clock.now().toISOString();
  const ended = h.database.authority.runs.transition({
    runId: run.envelope.runId,
    expectedVersion: current.version,
    claim,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: now },
    now,
  });
  assert.equal(ended.state, "applied", "attempt 1 must terminalize before a recovery attempt is claimed");
  return run;
}

describe("write sequencer — no repeat writes across recovery (D314)", () => {
  it("a restart attempt reuses the completed write's durable proof: zero new stage, fence or click", async () => {
    const h = harness();
    const first = await fileTermination(h);
    const before = h.database.authority.writeIntents.findByPermanentKey("ucpath", TERMINATION_IDEMPOTENCY_KEY);
    const confirmations = h.database.authority.timelineEvents.page({}).filter((event) => event.payload.kind === "operation-confirmed");
    assert.equal(confirmations.length, 1);
    assert.notEqual(before, undefined);

    const { run, claim } = compositionClaimRunning(
      h.database, h.clock, restartRun(UUID_5, 2, first.envelope.runId), TERMINATION_NODE,
    );
    assert.equal(run.envelope.recovery, "restart-from-start");
    const outcome = await h.bound(() => h.sequencer.executeTransaction(compositionContext(run, claim, TERMINATION_NODE)));
    assert.equal(Reflect.get(outcome as object, "disposition"), "committed");
    const output = Reflect.get(outcome as object, "output") as { receipt: { transactionId: string } };
    assert.equal(output.receipt.transactionId, COMPOSITION_RECEIPT, "the reused settlement carries the first attempt's receipt");
    assert.deepEqual(worldCounts(h), { stages: 1, clicks: 1, rows: 1 }, "the restart neither staged nor clicked");
    const after = h.database.authority.writeIntents.findByPermanentKey("ucpath", TERMINATION_IDEMPOTENCY_KEY);
    assert.deepEqual(h.database.authority.timelineEvents.page({}).filter((event) => event.payload.kind === "operation-confirmed"), confirmations);
    assert.deepEqual(after, before, "the permanent intent is byte-for-byte the first attempt's");
    assert.equal(h.database.authority.writeIntents.countDryRunEvidenceByRun(UUID_5).writeAttempts, 0, "no attempt row under the restart run");
  });

  it("a restart whose fresh facts no longer match the completed write refuses by node name and key reference — no stage, fence or click", async () => {
    const h = harness();
    const first = await fileTermination(h);

    const { run, claim } = compositionClaimRunning(
      h.database, h.clock, restartRun(UUID_7, 2, first.envelope.runId), TERMINATION_NODE,
    );
    const moved = compositionContext(run, claim, TERMINATION_NODE);
    const approval = COMPOSITION_SCOPE_OUTPUTS.approval;
    const context = {
      ...moved,
      scope: {
        input: { ...COMPOSITION_RUN_INPUT },
        outputs: {
          ...COMPOSITION_SCOPE_OUTPUTS,
          "pending-set": compositionPendingSet([]),
          // The fresh identity fold names ANOTHER person than the one the write was filed for.
          approval: { ...approval, approved: { ...approval.approved, emplId: COMPOSITION_OTHER_EID } },
        },
      },
    };
    assert.notEqual(COMPOSITION_OTHER_EID, COMPOSITION_EID);
    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(context)),
      (error: unknown) => error instanceof Error
        && new RegExp(`transaction node "${TERMINATION_NODE}" holds a completed settlement`, "u").test(error.message)
        && /refusing to relabel a completed external write as the consequence of new facts \(D314\)/u.test(error.message)
        && /protected transaction key \(withheld\)/u.test(error.message)
        && !/[0-9a-f]{12}…/u.test(error.message)
        && !error.message.includes(String(COMPOSITION_OTHER_EID))
        && !error.message.includes(String(COMPOSITION_EID)),
    );
    assert.deepEqual(worldCounts(h), { stages: 1, clicks: 1, rows: 1 }, "the refused restart touched nothing");
    assert.equal(h.database.authority.writeIntents.countDryRunEvidenceByRun(UUID_7).writeIntents, 0);
    assert.equal(h.database.authority.writeIntents.countDryRunEvidenceByRun(UUID_7).writeAttempts, 0);
  });

  it("a drifted stored settlement refuses as contract drift, not as a fresh-fact mismatch", async () => {
    const h = harness();
    const first = await fileTermination(h);

    const { run, claim } = compositionClaimRunning(
      h.database, h.clock, restartRun(UUID_7, 2, first.envelope.runId), TERMINATION_NODE,
    );
    const moved = compositionContext(run, claim, TERMINATION_NODE);
    // The descriptor MOVED under the stored settlement: this build no longer
    // reads the checkpoint attempt 1 wrote.
    const drifted = FingerprintSchema.parse("d".repeat(64));
    assert.notEqual(drifted, moved.descriptor.contractFingerprint);
    const approval = COMPOSITION_SCOPE_OUTPUTS.approval;
    const context = {
      ...moved,
      descriptor: { ...moved.descriptor, contractFingerprint: drifted },
      scope: {
        input: { ...COMPOSITION_RUN_INPUT },
        outputs: {
          ...COMPOSITION_SCOPE_OUTPUTS,
          "pending-set": compositionPendingSet([]),
          // …AND the fresh identity fold names another person, so the fresh
          // key names no permanent intent either. Both refusals are available;
          // only drift is correct, because it is the one that has to be
          // resolved before the other question can even be asked.
          approval: { ...approval, approved: { ...approval.approved, emplId: COMPOSITION_OTHER_EID } },
        },
      },
    };
    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(context)),
      (error: unknown) => error instanceof Error
        && new RegExp(`transaction node "${TERMINATION_NODE}" has a stored outcome from a drifted descriptor/impl`, "u")
          .test(error.message)
        && /a transaction checkpoint never replays across contract drift and never re-clicks/u.test(error.message)
        && !/names no permanent write intent/u.test(error.message),
    );
    assert.deepEqual(worldCounts(h), { stages: 1, clicks: 1, rows: 1 }, "the refused restart touched nothing");
    assert.equal(h.database.authority.writeIntents.countDryRunEvidenceByRun(UUID_7).writeIntents, 0);
    assert.equal(h.database.authority.writeIntents.countDryRunEvidenceByRun(UUID_7).writeAttempts, 0);
  });
});
