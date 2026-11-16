import { UcpathVerifyTerminationFilingPresent } from "../../../src/models/systems/ucpath/verify-termination-filing-present.js";
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { compositionHarness, compositionQueuedRun, compositionClaimRunning, compositionContext, SWEEP_NODE, TERMINATION_NODE, FINALIZE_NODE, type CompositionHarness } from "../../support/helpers/separations-composition-fixtures.js";
import { DRY_RUN_TRANSACTION_NUMBER, type DryRunScope } from "../../../src/models/workflow/dry-run.js";
import { TaskError } from "../../../src/workflow-kit/errors.js";
import { NodeIdSchema } from "../../../src/rules/identity/ids.js";

const worlds: CompositionHarness[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.dispose(); });

it("stages the later Kuali form with a labelled sample without inventing any filing receipt", async () => {
  const h = await compositionHarness(); worlds.push(h);
  const { run, claim } = compositionClaimRunning(h.database, h.clock, compositionQueuedRun({ dryRun: true }));
  const transactions: DryRunScope["transactions"][number][] = [];
  for (const nodeId of [SWEEP_NODE, TERMINATION_NODE, FINALIZE_NODE]) {
    const context = compositionContext(run, claim, nodeId, true);
    const scope = { ...context.scope, dryRun: { transactions }, outputs: Object.fromEntries(Object.entries(context.scope.outputs)
      .filter(([id]) => ![SWEEP_NODE, TERMINATION_NODE, "receipt", "filing-presence"].includes(id))) };
    const previewBinding = context.node.previewBind?.(scope);
    const preview = await h.bound(() => h.sequencer.executeDryRun({ ...context, scope,
      ...(previewBinding === undefined ? {} : { previewBinding }),
    }));
    transactions.push({ nodeId: NodeIdSchema.parse(nodeId), state: "transaction-preview", preview, samples: [...(previewBinding?.samples ?? [])] });
  }
  assert.equal(transactions.length, 3);
  const finalization = transactions.at(-1); assert.ok(finalization);
  assert.equal(finalization.preview.outcome.state, "would-prepare");
  assert.equal(finalization.preview.probe.state, "not-required");
  assert.deepEqual(finalization.samples, [{ label: "dry-run sample", sourceNodeId: TERMINATION_NODE,
    field: "UCPath transaction number", value: DRY_RUN_TRANSACTION_NUMBER }]);
  assert.ok(h.kuali.events.includes(`stage-finalization:${DRY_RUN_TRANSACTION_NUMBER}`));
  assert.equal(h.kuali.events.some(event => event.startsWith("commit")), false);
  assert.equal(h.ucpath.events.some(event => event.startsWith("commit")), false);
  assert.equal(h.ucpath.rows.length, 0);
  assert.deepEqual(h.database.authority.writeIntents.countDryRunEvidenceByRun(run.envelope.runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
  assert.deepEqual(h.database.authority.writeIntents.listByRun(run.envelope.runId), []);
  assert.deepEqual(h.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId), []);
});

it("refuses a sample in a real run before staging, probing or fencing", async () => {
  const h = await compositionHarness(); worlds.push(h);
  const { run, claim } = compositionClaimRunning(h.database, h.clock, compositionQueuedRun(), FINALIZE_NODE);
  const context = compositionContext(run, claim, FINALIZE_NODE);
  await assert.rejects(h.bound(() => h.sequencer.executeTransaction({ ...context,
    scope: { ...context.scope, outputs: { ...context.scope.outputs,
      "filing-presence": { ...UcpathVerifyTerminationFilingPresent.output.parse(context.scope.outputs["filing-presence"]), transactionId: DRY_RUN_TRANSACTION_NUMBER },
    } },
  })), (error: unknown) => error instanceof TaskError && error.code === "DRY_RUN_SAMPLE_REFUSED");
  assert.deepEqual(h.kuali.events, []);
  assert.deepEqual(h.ucpath.events, []);
  assert.deepEqual(h.database.authority.writeIntents.listByRun(run.envelope.runId), []);
});

it("refuses an unlabelled preview sample before the browser opens", async () => {
  const h = await compositionHarness(); worlds.push(h);
  const { run, claim } = compositionClaimRunning(h.database, h.clock, compositionQueuedRun({ dryRun: true }), FINALIZE_NODE);
  const context = compositionContext(run, claim, FINALIZE_NODE, true);
  await assert.rejects(h.bound(() => h.sequencer.executeDryRun({ ...context,
    scope: { ...context.scope, outputs: { ...context.scope.outputs,
      "filing-presence": { ...UcpathVerifyTerminationFilingPresent.output.parse(context.scope.outputs["filing-presence"]), transactionId: DRY_RUN_TRANSACTION_NUMBER },
    } },
  })), (error: unknown) => error instanceof TaskError && error.code === "DRY_RUN_SAMPLE_UNDECLARED");
  assert.deepEqual(h.kuali.events, []);
  assert.deepEqual(h.ucpath.events, []);
  assert.deepEqual(h.database.authority.writeIntents.listByRun(run.envelope.runId), []);
});
