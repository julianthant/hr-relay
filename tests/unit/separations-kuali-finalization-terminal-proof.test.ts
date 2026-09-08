import { createTrustRunReader } from "../../src/server/trust/canonical-reader.js";
import { testRunLifecycle } from "../fixtures/run-lifecycle-fixtures.js";
/**
 * D144's current end-to-end proof.
 *
 * The retired `kuali-timekeeper-annotation` workflow first proved that a
 * transaction checkpoint can be terminal evidence. This file keeps that
 * invariant on the production successor: the registered separations Kuali
 * finalization descriptor, its real task stores, the real interpreter, write
 * sequencer, authority terminalization, and receipt derivation. Only the
 * browser systems, clock, ids, scheduler, and span sink are deterministic
 * process edges.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { workflowTerminalResultExecution } from "../../src/base/workflow.js";
import { deriveGateResultCheckpointFingerprint } from "../../src/core/command-kernel.js";
import { buildRunEvidenceReceipt } from "../../src/core/evidence-receipt.js";
import {
  executeClaimedRun,
  type RunExecutionAuthority,
  type RunExecutorDependencies,
} from "../../src/core/run-executor.js";
import { KualiSaveSeparationFinalization } from "../../src/domain/contracts/kuali/save-separation-finalization.js";
import { SeparationsMatchDepartmentOption } from "../../src/domain/contracts/separations/match-department-option.js";
import { MatchIdentityOutputSchema } from "../../src/domain/contracts/separations/match-identity.js";
import { UcpathReadJobSummary } from "../../src/domain/contracts/ucpath/read-job-summary.js";
import { SearchPersonOrg } from "../../src/domain/contracts/ucpath/search-person-org.js";
import type { AnyTaskContract } from "../../src/domain/contracts/base.js";
import { RunRecordSchema, type RunRecord } from "../../src/domain/run/record.js";
import { deriveCheckpointOutputDigest } from "../../src/domain/run/result.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { IdentityApprovalResultSchema } from "../../src/domain/separations/identity-approval.js";
import { evidenceLeaves } from "../../src/domain/trust/evidence-classification.js";
import { TransactionOutcomeSchema } from "../../src/domain/write-safety.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import {
  BUILD_MANIFEST,
  resolveTaskImplFingerprint,
} from "../../src/domain/workflow/build-manifest.js";
import { createReceiptService } from "../../src/server/trust/receipt-service.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import { SeparationsKualiFinalizationResultSchema } from "../../src/workflows/separations/kuali-finalization/workflow.js";
import { separationsKualiFinalizationDescriptor } from "../helpers/registered-workflows.js";
import {
  COMPARISON_NODE,
  DEPARTMENT_NODE,
  FINALIZE_NODE,
  GATE_NODE,
  JOB_SUMMARY_NODE,
  NAME_SEARCH_NODE,
} from "../../src/workflows/separations/workflow.js";
import { ManualScheduler, recordingLogger } from "../helpers/phase1f-executor-harness.js";
import { UUID_7 } from "../fixtures/phase1c-contract-fixtures.js";
import {
  FINALIZATION_FIELDS,
  FINALIZATION_ITEM_ID,
  FINALIZATION_JOB_SUMMARY_READ,
  FINALIZATION_NAME_SEARCH_OUTPUT,
  FINALIZATION_NOW,
  FINALIZATION_RUN_ID,
  FINALIZATION_RUN_INPUT,
  FINALIZATION_SCOPE_OUTPUTS,
  FINALIZATION_WORKER_ID,
  finalizationClaimRunning,
  finalizationContext,
  finalizationHarness,
  finalizationQueuedRun,
  type FinalizationHarness,
} from "../helpers/kuali-finalization-fixtures.js";

const open: FinalizationHarness[] = [];
const signal = new AbortController().signal;

afterEach(() => {
  for (const harness of open.splice(0)) harness.dispose();
});

function harness(): FinalizationHarness {
  const created = finalizationHarness();
  open.push(created);
  return created;
}

function executorDependencies(
  value: FinalizationHarness,
  authority: RunExecutionAuthority = value.database,
): RunExecutorDependencies {
  return {
    lifecycle: testRunLifecycle(value.database, value.clock),
    descriptor: separationsKualiFinalizationDescriptor,
    stores: taskStoreRegistry,
    authority,
    sessions: value.sessions,
    emitter: value.emitter.emitter,
    clock: value.clock,
    ids: value.ids,
    scheduler: new ManualScheduler(value.clock),
    taskDeadlineMs: 60_000,
    log: recordingLogger().log,
    writeSequencer: value.sequencer,
  };
}

function claimQueued(value: FinalizationHarness) {
  const claimed = value.database.authority.runs.claimNext({
    workflow: separationsKualiFinalizationDescriptor.id,
    workerId: FINALIZATION_WORKER_ID,
    now: value.clock.now().toISOString(),
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return {
    run: claimed.run,
    claim: {
      workerId: FINALIZATION_WORKER_ID,
      claimGeneration: claimed.run.claimGeneration,
    },
  };
}

function insertReplayCheckpoint(
  value: FinalizationHarness,
  run: RunRecord,
  nodeId: string,
  contract: AnyTaskContract,
  output: unknown,
  source: "live" | "derived",
): void {
  const parsedOutput = contract.output.parse(output);
  const inserted = value.database.authority.runCheckpoints.insert(RunCheckpointRecordSchema.parse({
    workflowId: separationsKualiFinalizationDescriptor.id,
    itemId: run.envelope.itemId,
    nodeId,
    attempt: run.envelope.attempt,
    claimGeneration: run.claimGeneration,
    runId: run.envelope.runId,
    output: {
      schemaHash: deriveSchemaHash(contract.output, "output"),
      value: parsedOutput,
    },
    descriptorVersion: separationsKualiFinalizationDescriptor.version,
    contractFingerprint: separationsKualiFinalizationDescriptor.contractFingerprint,
    implFingerprint: resolveTaskImplFingerprint(BUILD_MANIFEST, contract.id),
    provenance: evidenceLeaves(parsedOutput).map(({ path }) => ({
      path,
      source,
      observedAt: FINALIZATION_NOW,
      originalObservedAt: FINALIZATION_NOW,
    })),
    writtenAt: FINALIZATION_NOW,
  }));
  if (inserted.state !== "inserted") {
    throw new Error(`checkpoint ${nodeId} insert outcome was ${inserted.state}`);
  }
}

/**
 * Start at the first pre-gate fold with the three upstream reads authenticated
 * as replay checkpoints. The standalone chunk harness receives the department
 * facts through canonical input from the composed separations workflow; its
 * root `department-option` fold therefore has no in-graph source from which an
 * executor could derive provenance. That separate composition issue must not
 * be "fixed" by this D144 proof. None of these rows is terminal evidence: the
 * real executor still executes comparison, parks and re-checks the approval,
 * dispatches the real transaction, reads beat ⑦'s row, and terminalizes.
 */
function enqueueFromComparison(value: FinalizationHarness, suppliedEid = false, dryRun = false) {
  const raw = RunRecordSchema.parse(finalizationQueuedRun({ startAt: COMPARISON_NODE, dryRun }));
  const canonical = suppliedEid ? FINALIZATION_RUN_INPUT : {
    ...FINALIZATION_RUN_INPUT, emplIdSource: "name-resolved",
    documentEid: { state: "absent", reason: "name-only fixture" },
  };
  const run = RunRecordSchema.parse({ ...raw, input: {
    ...raw.input, raw: canonical, parsed: { ...raw.input.parsed, value: canonical },
  } });
  const inserted = value.database.authority.runs.enqueue(run);
  if (inserted.state !== "inserted") throw new Error(`enqueue outcome was ${inserted.state}`);
  const claimed = claimQueued(value);
  if (FINALIZATION_JOB_SUMMARY_READ.state !== "read") {
    throw new Error("the finalization UCPath fixture must carry a readable job summary");
  }
  insertReplayCheckpoint(
    value,
    claimed.run,
    JOB_SUMMARY_NODE,
    UcpathReadJobSummary,
    FINALIZATION_JOB_SUMMARY_READ.summary,
    "live",
  );
  insertReplayCheckpoint(
    value,
    claimed.run,
    NAME_SEARCH_NODE,
    SearchPersonOrg,
    FINALIZATION_NAME_SEARCH_OUTPUT,
    "live",
  );
  insertReplayCheckpoint(
    value,
    claimed.run,
    DEPARTMENT_NODE,
    SeparationsMatchDepartmentOption,
    FINALIZATION_SCOPE_OUTPUTS[DEPARTMENT_NODE],
    "derived",
  );
  return claimed;
}

async function parkApproveAndReclaim(value: FinalizationHarness) {
  const first = enqueueFromComparison(value);
  const parked = await value.bound(() => executeClaimedRun(executorDependencies(value), {
    ...first,
    signal,
  }));
  if (parked.state !== "parked-gate" || parked.gateId !== GATE_NODE) {
    const failure = parked.state === "failed"
      ? value.database.authority.failures.get(parked.failureId)
      : undefined;
    throw new Error(
      `expected ${GATE_NODE} park, received ${JSON.stringify(parked)}: ${failure?.summary ?? "no failure"}`,
    );
  }

  const parkedRun = value.database.authority.runs.get(FINALIZATION_RUN_ID);
  if (parkedRun?.lifecycle.state !== "parked-gate") {
    throw new Error(`run did not durably park at ${GATE_NODE}`);
  }
  const comparison = value.database.authority.runCheckpoints.latest(
    separationsKualiFinalizationDescriptor.id,
    parkedRun.envelope.itemId,
    COMPARISON_NODE,
  );
  if (comparison === undefined) throw new Error(`${COMPARISON_NODE} checkpoint is absent`);
  const compared = MatchIdentityOutputSchema.parse(comparison.output.value);
  const approval = IdentityApprovalResultSchema.parse({
    decision: "approved",
    eid: FINALIZATION_RUN_INPUT.emplId,
    chosenFrom: "checked",
    evidenceDigest: compared.evidenceDigest,
  });
  const result = {
    schemaHash: deriveSchemaHash(IdentityApprovalResultSchema, "output"),
    value: approval,
  };
  const gateInsert = value.database.authority.gateResults.insert({
    runId: FINALIZATION_RUN_ID,
    gateId: GATE_NODE,
    commandId: UUID_7,
    expectedVersion: parkedRun.version,
    resolvedBy: "local-operator",
    resolvedAt: value.clock.now().toISOString(),
    checkpointFingerprint: deriveGateResultCheckpointFingerprint(result),
    result,
  });
  if (gateInsert.state !== "inserted") throw new Error(`gate insert outcome was ${gateInsert.state}`);
  const resumed = value.database.authority.runs.resume({
    runId: FINALIZATION_RUN_ID,
    expectedVersion: parkedRun.version,
    startAt: parkedRun.lifecycle.resumeAt,
    now: value.clock.now().toISOString(),
  });
  if (resumed.state !== "applied") throw new Error(`resume outcome was ${resumed.state}`);

  return claimQueued(value);
}

function authorityWithoutFinalizationCheckpoint(
  value: FinalizationHarness,
): RunExecutionAuthority {
  const { authority } = value.database;
  return {
    authority: {
      timelineEvents: authority.timelineEvents,
      runs: authority.runs,
      gateResults: authority.gateResults,
      artifactOutbox: authority.artifactOutbox,
      runCheckpoints: {
        insert: (input) => authority.runCheckpoints.insert(input),
        get: (workflowId, itemId, nodeId, attempt, claimGeneration) =>
          authority.runCheckpoints.get(workflowId, itemId, nodeId, attempt, claimGeneration),
        latest: (workflowId, itemId, nodeId) => nodeId === FINALIZE_NODE
          ? undefined
          : authority.runCheckpoints.latest(workflowId, itemId, nodeId),
        listByAttempt: (workflowId, itemId, nodeId, attempt) =>
          authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt),
        listByItem: (workflowId, itemId) => authority.runCheckpoints.listByItem(workflowId, itemId),
      },
    },
    afterAuthorityCommit: (publish) => value.database.afterAuthorityCommit(publish),
  };
}

function deriveReceipts(value: FinalizationHarness) {
  const run = value.database.authority.runs.get(FINALIZATION_RUN_ID);
  if (run?.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "done") {
    throw new Error(`run ${FINALIZATION_RUN_ID} is not terminal done`);
  }
  const result = value.database.authority.runResults.get(FINALIZATION_RUN_ID);
  if (result === undefined) throw new Error(`run ${FINALIZATION_RUN_ID} has no durable result`);
  const checkpoints = value.database.authority.runCheckpoints.listByItem(
    separationsKualiFinalizationDescriptor.id,
    run.envelope.itemId,
  );
  const writes = value.database.authority.writeIntents.listByRun(FINALIZATION_RUN_ID)
    .map((intent) => ({
      intent,
      attempts: value.database.authority.writeAttempts.listByIntent(intent.writeIntentId),
    }));
  const direct = buildRunEvidenceReceipt({
    descriptor: separationsKualiFinalizationDescriptor,
    run,
    result,
    checkpoints,
    writes,
    gateResults: value.database.authority.gateResults.listByRun(FINALIZATION_RUN_ID),
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
    const value = harness();
    const claimed = enqueueFromComparison(value, true);
    const outcome = await value.bound(() => executeClaimedRun(executorDependencies(value), { ...claimed, signal }));
    assert.deepEqual(outcome, { state: "done", runId: FINALIZATION_RUN_ID });
    assert.deepEqual(value.database.authority.gateResults.listByRun(FINALIZATION_RUN_ID), []);
    assert.equal(value.emitter.events().some((event) => event.t === "gate.opened"), false);
    const proof = deriveReceipts(value);
    const result = SeparationsKualiFinalizationResultSchema.parse(proof.result.result.value);
    assert.equal(result.approved.authority, "machine-verification");
    assert.equal(proof.service.decisions.some((decision) => decision.kind === "gate"), false);
    const gate = proof.service.verification.find((row) => row.obligation === "node.identity-approval");
    assert.deepEqual(gate && { verdict: gate.verdict, mandatory: gate.mandatory }, { verdict: "absent", mandatory: false });
    assert.equal(proof.service.result, "verified-done");
  });

  it("previews without a gate or any intent, attempt, or outbox write", async () => {
    const value = harness();
    const claimed = enqueueFromComparison(value, true, true);
    const outcome = await value.bound(() => executeClaimedRun(executorDependencies(value), { ...claimed, signal }));
    assert.deepEqual(outcome, { state: "done", runId: FINALIZATION_RUN_ID });
    assert.deepEqual(value.database.authority.gateResults.listByRun(FINALIZATION_RUN_ID), []);
    assert.deepEqual(value.database.authority.writeIntents.listByRun(FINALIZATION_RUN_ID), []);
    assert.equal(value.emitter.events().some((event) => event.t === "gate.opened"), false);
  });
});

describe("D144 — current Kuali finalization transaction is terminal evidence", () => {
  it("settles through the real executor and derives a verified receipt from the stored read-back", async () => {
    const value = harness();
    const claimed = await parkApproveAndReclaim(value);

    const outcome = await value.bound(() => executeClaimedRun(executorDependencies(value), {
      ...claimed,
      signal,
    }));

    assert.deepEqual(outcome, { state: "done", runId: FINALIZATION_RUN_ID });
    const proof = deriveReceipts(value);
    assert.equal(proof.run.lifecycle.state, "terminal");
    assert.equal(proof.run.lifecycle.state === "terminal" ? proof.run.lifecycle.outcome : undefined, "done");
    assert.equal(
      proof.result.resultSchemaHash,
      workflowTerminalResultExecution(separationsKualiFinalizationDescriptor).schemaHash,
    );
    const resultValue = SeparationsKualiFinalizationResultSchema.parse(proof.result.result.value);
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
    assert.deepEqual(transaction.output.value, { savedState: resultValue.finalization.proof });
    assert.equal(
      transaction.output.schemaHash,
      deriveSchemaHash(KualiSaveSeparationFinalization.output, "output"),
    );
    const dependency = proof.result.dependencies.find(({ nodeId }) => nodeId === FINALIZE_NODE);
    assert.ok(dependency?.state === "resolved", "terminal result resolved the transaction dependency");
    assert.equal(dependency.checkpoint.runId, FINALIZATION_RUN_ID);
    assert.equal(dependency.outputSchemaHash, stored.output.schemaHash);
    assert.equal(dependency.outputDigest, deriveCheckpointOutputDigest(stored.output));

    assert.deepEqual(proof.service, proof.direct, "the service and direct builder consume the same authority rows");
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
        proof.service.verification.find((row) => row.obligation === obligation)?.verdict,
        "verified",
        obligation,
      );
    }
    assert.deepEqual(proof.service.warnings, []);
    assert.equal(
      value.world.events.filter((event) => event.startsWith("read-back-finalization:")).length,
      2,
      "one pre-fence probe and one post-save reload read-back ran",
    );
  });

  it("refuses terminal success when the sequencer's checkpoint is hidden from the executor", async () => {
    const value = harness();
    const claimed = await parkApproveAndReclaim(value);

    const outcome = await value.bound(() => executeClaimedRun(
      executorDependencies(value, authorityWithoutFinalizationCheckpoint(value)),
      { ...claimed, signal },
    ));

    if (outcome.state !== "failed") {
      throw new Error(`checkpoint-removal control returned ${outcome.state}, not failed`);
    }
    const run = value.database.authority.runs.get(FINALIZATION_RUN_ID);
    assert.equal(run?.lifecycle.state, "terminal");
    assert.equal(run?.lifecycle.state === "terminal" ? run.lifecycle.outcome : undefined, "failed");
    if (run?.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "failed") {
      throw new Error("checkpoint-removal control did not fail the run");
    }
    assert.equal(run.lifecycle.failureId, outcome.failureId);
    const failure = value.database.authority.failures.get(outcome.failureId);
    assert.match(failure?.summary ?? "", /settled but run .* has no durable checkpoint/u);
    assert.notEqual(
      value.database.authority.runCheckpoints.latest(
        separationsKualiFinalizationDescriptor.id,
        FINALIZATION_ITEM_ID,
        FINALIZE_NODE,
      ),
      undefined,
      "the sequencer wrote the row; only the executor read was mutated",
    );
    assert.equal(value.database.authority.runResults.get(FINALIZATION_RUN_ID), undefined);
  });

  it("does not accept a sequencer-only settlement that bypasses the executor", async () => {
    const value = harness();
    const { run, claim } = finalizationClaimRunning(value.database, value.clock);

    await value.bound(() => value.sequencer.executeTransaction(finalizationContext(run, claim)));

    assert.notEqual(
      value.database.authority.runCheckpoints.latest(
        separationsKualiFinalizationDescriptor.id,
        FINALIZATION_ITEM_ID,
        FINALIZE_NODE,
      ),
      undefined,
      "the sequencer did settle its transaction checkpoint",
    );
    assert.equal(value.database.authority.runResults.get(FINALIZATION_RUN_ID), undefined);
    assert.throws(
      () => deriveReceipts(value),
      /is not terminal done/u,
      "a direct sequencer call cannot satisfy the executor-backed terminal/receipt oracle",
    );
  });
});
