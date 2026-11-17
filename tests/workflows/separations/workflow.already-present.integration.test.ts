import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { SeparationsVerifyTerminationReceipt } from "../../../src/models/workflows/separations/verify-termination-receipt.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { verifyTerminationReceiptTask } from "../../../src/workflows/separations/tasks/verify-termination-receipt.js";
import { createSeparationTaskFixtures } from "../../support/helpers/separation-task-fixtures.js";
import { separationsDescriptor } from "../../support/helpers/registered-workflows.js";
import {
  COMPOSITION_EFFECTIVE_DATE, COMPOSITION_EID, COMPOSITION_SCOPE_OUTPUTS, COMPOSITION_UCPATH_NAME, TERMINATION_NODE,
  compositionClaimRunning, compositionContext, compositionHarness, compositionQueuedRun, type CompositionHarness,
} from "../../support/helpers/separations-composition-fixtures.js";

const worlds: CompositionHarness[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.dispose(); });

it("an already filed termination ends already present through the step's own probe, staging and submitting nothing, and the receipt node records it", async () => {
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
  const receiptNode = descriptorRuntimeNodes(separationsDescriptor).find(node => String(node.id) === "receipt");
  assert.ok(receiptNode?.kind === "task");
  const scope = { input: {}, outputs: { ...COMPOSITION_SCOPE_OUTPUTS, "file-termination": outcome } } as unknown as Parameters<typeof receiptNode.bind>[0];
  const receiptInput = SeparationsVerifyTerminationReceipt.input.parse(receiptNode.bind(scope));
  assert.equal(receiptInput.disposition, "already-present");
  const { ctx } = createSeparationTaskFixtures().taskContext();
  const receipt = await verifyTerminationReceiptTask.impl.run({ input: receiptInput, ctx });
  assert.equal(receipt.disposition, "already-present");
  assert.equal(receipt.transactionNumber, filed.transactionId);
  assert.equal(receipt.emplId, COMPOSITION_EID);
  assert.equal(receipt.effectiveDate, COMPOSITION_EFFECTIVE_DATE);
});
