import { createFinalizationTerminalTestWorld } from "../../../support/helpers/backend/finalization-terminal-world.js";
import { createTrustRunReader } from "../../../../src/backend/runs/trust/canonical-reader.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildRunEvidenceReceipt } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { deriveCheckpointOutputDigest } from "../../../../src/models/run/result.js";
import { KualiSaveSeparationFinalization } from "../../../../src/models/systems/kuali/save-separation-finalization.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { TransactionOutcomeSchema } from "../../../../src/rules/write-safety/write-safety.js";
import { workflowTerminalResultExecution } from "../../../../src/workflow-kit/workflow.js";
import { SeparationsKualiFinalizationResultSchema } from "../../../../src/workflows/separations/steps/kuali-finalization/step.js";
import { FINALIZE_NODE } from "../../../../src/workflows/separations/workflow.js";
import { FINALIZATION_FIELDS, FINALIZATION_ITEM_ID, FINALIZATION_RUN_ID, FINALIZATION_RUN_INPUT, finalizationClaimRunning, finalizationContext, type FinalizationHarness } from "../../../support/helpers/kuali-finalization-fixtures.js";
import { separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";

const {signal, harness, executorDependencies, enqueueFromComparison, parkApproveAndReclaim, cleanup } = createFinalizationTerminalTestWorld();


afterEach(cleanup);

function deriveReceipts(value: FinalizationHarness) {
  const run = value.database.authority.runs.get(FINALIZATION_RUN_ID);
  if (run?.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "done") {
    throw new Error(`run ${FINALIZATION_RUN_ID} is not terminal done`);
  }
  const result = value.database.authority.runResults.get(FINALIZATION_RUN_ID);
  if (result === undefined)
    throw new Error(`run ${FINALIZATION_RUN_ID} has no durable result`);
  const checkpoints = value.database.authority.runCheckpoints.listByItem(
    separationsKualiFinalizationDescriptor.id,
    run.envelope.itemId,
  );
  const writes = value.database.authority.writeIntents
    .listByRun(FINALIZATION_RUN_ID)
    .map((intent) => ({
      intent,
      attempts: value.database.authority.writeAttempts.listByIntent(
        intent.writeIntentId,
      ),
    }));
  const direct = buildRunEvidenceReceipt({
    descriptor: separationsKualiFinalizationDescriptor,
    run,
    result,
    checkpoints,
    writes,
    gateResults:
      value.database.authority.gateResults.listByRun(FINALIZATION_RUN_ID),
  });
  const service = createReceiptService({
    database: value.database,
    runReader: createTrustRunReader(value.database),
    descriptors: [separationsKualiFinalizationDescriptor],
  }).ensureReceipt(FINALIZATION_RUN_ID);
  return { run, result, direct, service };
}

describe("supplied-EID executor authority", () => {
  it("writes through the real sequencer with machine provenance and no operator gate", async () => {
    const value = await harness();
    const claimed = enqueueFromComparison(value, true);
    const outcome = await value.bound(() =>
      executeClaimedRun(executorDependencies(value), { ...claimed, signal }),
    );
    assert.deepEqual(outcome, { state: "done", runId: FINALIZATION_RUN_ID });
    assert.deepEqual(
      value.database.authority.gateResults.listByRun(FINALIZATION_RUN_ID),
      [],
    );
    assert.equal(
      value.emitter.events().some((event) => event.t === "gate.opened"),
      false,
    );
    const proof = deriveReceipts(value);
    const result = SeparationsKualiFinalizationResultSchema.parse(
      proof.result.result.value,
    );
    assert.equal(result.approved.authority, "machine-verification");
    assert.equal(
      proof.service.decisions.some((decision) => decision.kind === "gate"),
      false,
    );
    const gate = proof.service.verification.find(
      (row) => row.obligation === "node.identity-approval",
    );
    assert.deepEqual(
      gate && { verdict: gate.verdict, mandatory: gate.mandatory },
      { verdict: "absent", mandatory: false },
    );
    assert.equal(proof.service.result, "verified-done");
  });
});

describe("current Kuali finalization transaction is terminal evidence", () => {
  it("settles through the real executor and derives a verified receipt from the stored read-back", async () => {
    const value = await harness();
    const claimed = await parkApproveAndReclaim(value);

    const outcome = await value.bound(() =>
      executeClaimedRun(executorDependencies(value), {
        ...claimed,
        signal,
      }),
    );

    assert.deepEqual(outcome, { state: "done", runId: FINALIZATION_RUN_ID });
    const proof = deriveReceipts(value);
    assert.equal(proof.run.lifecycle.state, "terminal");
    assert.equal(
      proof.run.lifecycle.state === "terminal"
        ? proof.run.lifecycle.outcome
        : undefined,
      "done",
    );
    assert.equal(
      proof.result.resultSchemaHash,
      workflowTerminalResultExecution(separationsKualiFinalizationDescriptor)
        .schemaHash,
    );
    const resultValue = SeparationsKualiFinalizationResultSchema.parse(
      proof.result.result.value,
    );
    assert.deepEqual(resultValue.finalization, {
      disposition: "committed",
      proof: {
        kind: "kuali-saved-finalization",
        actionId: FINALIZATION_RUN_INPUT.actionId,
        documentNumber: FINALIZATION_RUN_INPUT.documentNumber,
        observedEid: FINALIZATION_RUN_INPUT.emplId,
        fields: FINALIZATION_FIELDS,
        source: "reload-read-back",
      },
    });

    const stored = value.database.authority.runCheckpoints.latest(
      separationsKualiFinalizationDescriptor.id,
      FINALIZATION_ITEM_ID,
      FINALIZE_NODE,
    );
    assert.ok(stored !== undefined, "beat ⑦ stored the transaction checkpoint");
    const transaction = TransactionOutcomeSchema.parse(stored.output.value);
    assert.equal(transaction.disposition, "committed");
    assert.equal(transaction.proofSource, "normal-output");
    assert.deepEqual(transaction.proof.value, resultValue.finalization.proof);
    assert.deepEqual(transaction.output.value, {
      savedState: resultValue.finalization.proof,
    });
    assert.equal(
      transaction.output.schemaHash,
      deriveSchemaHash(KualiSaveSeparationFinalization.output, "output"),
    );
    const dependency = proof.result.dependencies.find(
      ({ nodeId }) => nodeId === FINALIZE_NODE,
    );
    assert.ok(
      dependency?.state === "resolved",
      "terminal result resolved the transaction dependency",
    );
    assert.equal(dependency.checkpoint.runId, FINALIZATION_RUN_ID);
    assert.equal(dependency.outputSchemaHash, stored.output.schemaHash);
    assert.equal(
      dependency.outputDigest,
      deriveCheckpointOutputDigest(stored.output),
    );

    assert.deepEqual(
      proof.service,
      proof.direct,
      "the service and direct builder consume the same authority rows",
    );
    assert.equal(proof.service.result, "verified-done");
    assert.equal(proof.service.confidence, "verified");
    assert.equal(
      proof.service.actions.find(({ kind }) => kind === "commit")?.writeState,
      "verified",
    );
    for (const obligation of [
      "node.identity-approval",
      "identity.eid-agrees-across-sources",
      "write.document-matches-request",
      "write.proof-is-a-read-back",
      "write.timekeeper-matches-request",
      "write.transaction-matches-request",
    ]) {
      assert.equal(
        proof.service.verification.find((row) => row.obligation === obligation)
          ?.verdict,
        "verified",
        obligation,
      );
    }
    assert.deepEqual(proof.service.warnings, []);
    assert.equal(
      value.world.events.filter((event) =>
        event.startsWith("read-back-finalization:"),
      ).length,
      2,
      "one pre-fence probe and one post-save reload read-back ran",
    );
  });

  it("does not accept a sequencer-only settlement that bypasses the executor", async () => {
    const value = await harness();
    const { run, claim } = finalizationClaimRunning(
      value.database,
      value.clock,
    );

    await value.bound(() =>
      value.sequencer.executeTransaction(finalizationContext(run, claim)),
    );

    assert.notEqual(
      value.database.authority.runCheckpoints.latest(
        separationsKualiFinalizationDescriptor.id,
        FINALIZATION_ITEM_ID,
        FINALIZE_NODE,
      ),
      undefined,
      "the sequencer did settle its transaction checkpoint",
    );
    assert.equal(
      value.database.authority.runResults.get(FINALIZATION_RUN_ID),
      undefined,
    );
    assert.throws(
      () => deriveReceipts(value),
      /is not terminal done/u,
      "a direct sequencer call cannot satisfy the executor-backed terminal/receipt oracle",
    );
  });
});
