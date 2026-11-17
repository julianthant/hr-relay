import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { SeparationsVerifyTerminationReceipt } from "../../../src/models/workflows/separations/verify-termination-receipt.js";
import {
  COMPOSITION_EFFECTIVE_DATE, COMPOSITION_EID, COMPOSITION_SCOPE_OUTPUTS, COMPOSITION_UCPATH_NAME, TERMINATION_NODE,
  compositionClaimRunning, compositionContext, compositionHarness, compositionQueuedRun, type CompositionHarness,
} from "../../support/helpers/separations-composition-fixtures.js";

const worlds: CompositionHarness[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.dispose(); });

it("an already filed termination ends already present through the step's own probe, staging and submitting nothing", async () => {
  const filed = { transactionId: "T009000002", emplId: COMPOSITION_EID, action: "TER", approvalStatus: "Pending" as const,
    startDate: COMPOSITION_EFFECTIVE_DATE, displayedName: COMPOSITION_UCPATH_NAME };
  const h = await compositionHarness({ rows: [filed] }); worlds.push(h);
  const { run, claim } = compositionClaimRunning(h.database, h.clock, compositionQueuedRun(), TERMINATION_NODE);
  const outcome = await h.bound(() => h.sequencer.executeTransaction(compositionContext(run, claim, TERMINATION_NODE)));
  assert.equal(Reflect.get(outcome as object, "disposition"), "already-present");
  assert.equal(h.ucpath.events.some(event => event.startsWith("stage:") || event.startsWith("commit:")), false);
  assert.equal(h.ucpath.rows.length, 1);
  const output = Reflect.get(outcome as object, "output") as { receipt: { transactionId: string } };
  assert.equal(output.receipt.transactionId, filed.transactionId);
  // The receipt node reads this settlement as its own input.
  const receiptInput = SeparationsVerifyTerminationReceipt.input.parse({
    proof: output.receipt, disposition: Reflect.get(outcome as object, "disposition"),
    approvedEmplId: COMPOSITION_SCOPE_OUTPUTS.approval.approved.emplId, expectedEffectiveDate: COMPOSITION_EFFECTIVE_DATE,
  });
  assert.equal(receiptInput.disposition, "already-present");
});
