/**
 * D144 — a transaction node IS a terminal dependency, proved end to end.
 *
 * This is the test the named gap in ref operator-trust asked for. It drives the REAL
 * interpreter (`executeClaimedRun`) over the REAL `kuali-timekeeper-annotation`
 * descriptor, the REAL write sequencer, the REAL Kuali store, and a REAL
 * temporary authority database — no hand-assembled terminal rows anywhere. The
 * only fakes are the process edges the rest of this suite already fakes: the
 * Kuali document, the clock, the id factory, and the span sink.
 *
 * NOTHING HERE TOUCHES A REAL HR SYSTEM.
 *
 * What it pins, in order:
 *   1. the run reaches terminal `done` through the ordinary interpreter path;
 *   2. its durable `RunResultRecord` is schema-bound to the descriptor's own
 *      result schema and carries the value the descriptor's sealed `derive`
 *      computed from the transaction node's outcome;
 *   3. its ONE terminal dependency is the exact stored transaction checkpoint —
 *      same run, same digests, and bound to the DURABLE `TransactionOutcome`
 *      schema hash the sequencer actually wrote (never the commit contract's
 *      bare output hash, which describes a value no row holds);
 *   4. an evidence receipt derives from that authority and reports the write
 *      as verified.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { executeClaimedRun, type RunExecutorDependencies } from "../../src/core/run-executor.js";
import {
  deriveCheckpointOutputDigest,
  deriveCheckpointProvenanceDigest,
} from "../../src/domain/run/result.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { projectTransactionOutcome } from "../../src/domain/workflow/graph.js";
import { TransactionOutcomeSchema } from "../../src/domain/write-safety.js";
import { KualiSaveTimekeeperAnnotation } from "../../src/domain/contracts/kuali/save-timekeeper-annotation.js";
import { workflowTerminalResultExecution } from "../../src/base/workflow.js";
import { kualiTimekeeperAnnotationDescriptor } from "../../src/workflows/kuali-timekeeper-annotation/descriptor.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import { createReceiptService } from "../../src/server/trust/receipt-service.js";
import { ManualScheduler, recordingLogger } from "./fixtures/phase1f-executor-harness.js";
import {
  KUALI_DOCUMENT_NUMBER,
  KUALI_EID,
  KUALI_ITEM_ID,
  KUALI_NODE_ID,
  KUALI_RUN_ID,
  KUALI_TIMEKEEPER_VALUE,
  KUALI_WORKFLOW_ID,
  KUALI_WORKER_ID,
  kualiHarness,
  kualiQueuedRun,
  type KualiHarness,
} from "./fixtures/kuali-transaction-fixtures.js";

const open: KualiHarness[] = [];
afterEach(() => {
  for (const harness of open.splice(0)) harness.dispose();
});

function harness(options?: Parameters<typeof kualiHarness>[0]): KualiHarness {
  const created = kualiHarness(options);
  open.push(created);
  return created;
}

/**
 * Enqueue and claim, then hand the CLAIMED row to the interpreter. The
 * `validating → running → terminal` walk is the interpreter's own; a test that
 * pre-transitioned the run would be proving its own bookkeeping.
 */
function claimQueued(h: KualiHarness): { run: unknown; claim: unknown } {
  const enqueued = h.database.authority.runs.enqueue(kualiQueuedRun());
  if (enqueued.state !== "inserted") throw new Error(`enqueue outcome was ${enqueued.state}`);
  const claimed = h.database.authority.runs.claimNext({
    workflow: KUALI_WORKFLOW_ID,
    workerId: KUALI_WORKER_ID,
    now: h.clock.now().toISOString(),
  });
  if (claimed.state !== "claimed") throw new Error(`claim outcome was ${claimed.state}`);
  return {
    run: claimed.run,
    claim: { workerId: KUALI_WORKER_ID, claimGeneration: claimed.run.claimGeneration },
  };
}

function executorDeps(h: KualiHarness): RunExecutorDependencies {
  return {
    descriptor: kualiTimekeeperAnnotationDescriptor,
    stores: taskStoreRegistry,
    authority: h.database,
    sessions: h.manager,
    emitter: h.emitter.emitter,
    clock: h.clock,
    ids: h.ids,
    scheduler: new ManualScheduler(h.clock),
    taskDeadlineMs: 60_000,
    log: recordingLogger().log,
    writeSequencer: h.sequencer,
  };
}

describe("D144 — a transaction node can be a terminal dependency", () => {
  it("carries kuali-timekeeper-annotation to terminal done over its real stored outcome", async () => {
    const h = harness();
    const { run, claim } = claimQueued(h);

    const outcome = await h.bound(() => executeClaimedRun(executorDeps(h), {
      run,
      claim,
      signal: new AbortController().signal,
    }));

    assert.deepEqual(outcome, { state: "done", runId: KUALI_RUN_ID });

    const settled = h.database.authority.runs.get(KUALI_RUN_ID);
    assert.equal(settled?.lifecycle.state, "terminal");
    assert.equal(
      settled?.lifecycle.state === "terminal" ? settled.lifecycle.outcome : undefined,
      "done",
    );

    /* ── the result is the descriptor's own, over the transaction outcome ── */
    const result = h.database.authority.runResults.get(KUALI_RUN_ID);
    assert.ok(result !== undefined, "a done run carries a durable result record");
    const terminal = workflowTerminalResultExecution(kualiTimekeeperAnnotationDescriptor);
    assert.equal(result.resultSchemaHash, terminal.schemaHash);
    assert.deepEqual(result.result.value, {
      disposition: "committed",
      saved: {
        kind: "kuali-saved-timekeeper",
        actionId: h.world.actionId,
        documentNumber: KUALI_DOCUMENT_NUMBER,
        timekeeperName: KUALI_TIMEKEEPER_VALUE,
        observedEid: KUALI_EID,
        source: "reload-read-back",
      },
    });

    /* ── the ONE dependency is the exact stored transaction checkpoint ───── */
    const stored = h.database.authority.runCheckpoints.latest(
      KUALI_WORKFLOW_ID,
      KUALI_ITEM_ID,
      KUALI_NODE_ID,
    );
    assert.ok(stored !== undefined, "the sequencer wrote the transaction checkpoint");
    assert.deepEqual(result.dependencies, [{
      state: "resolved",
      nodeId: KUALI_NODE_ID,
      checkpoint: {
        workflowId: KUALI_WORKFLOW_ID,
        itemId: KUALI_ITEM_ID,
        attempt: 1,
        // D214 — the evidence cites the EXECUTION, and the sequencer settled
        // this write under the run's first (and only) claim.
        claimGeneration: stored.claimGeneration,
        runId: KUALI_RUN_ID,
      },
      outputSchemaHash: stored.output.schemaHash,
      descriptorVersion: kualiTimekeeperAnnotationDescriptor.version,
      contractFingerprint: kualiTimekeeperAnnotationDescriptor.contractFingerprint,
      implFingerprint: stored.implFingerprint,
      outputDigest: deriveCheckpointOutputDigest(stored.output),
      provenanceDigest: deriveCheckpointProvenanceDigest(stored.provenance),
    }]);

    // The load-bearing identity: the dependency is bound to the DURABLE
    // outcome's schema hash, because that is the schema the stored bytes were
    // parsed with. The commit contract's own output hash lives one level down,
    // inside the envelope, and is checked there.
    assert.equal(
      stored.output.schemaHash,
      deriveSchemaHash(TransactionOutcomeSchema, "output"),
    );
    assert.notEqual(
      stored.output.schemaHash,
      deriveSchemaHash(KualiSaveTimekeeperAnnotation.output, "output"),
      "the row is the envelope, not the bare commit output — that is the whole point",
    );
    const durable = TransactionOutcomeSchema.parse(stored.output.value);
    assert.equal(
      durable.output.schemaHash,
      deriveSchemaHash(KualiSaveTimekeeperAnnotation.output, "output"),
      "the commit contract's identity is checked one level down, not lost",
    );
    assert.equal(durable.disposition, "committed");

    /* ── and the receipt derives from that authority ──────────────────────── */
    const receipts = createReceiptService({
      database: h.database,
      descriptors: [kualiTimekeeperAnnotationDescriptor],
    });
    const receipt = receipts.ensureReceipt(KUALI_RUN_ID);
    assert.equal(receipt.runId, KUALI_RUN_ID);
    assert.equal(receipt.result, "verified-done");
    assert.equal(receipt.confidence, "verified");
    const commit = receipt.actions.find((action) => action.kind === "commit");
    assert.equal(commit?.writeState, "verified", "committed AND proved, not merely clicked");
    assert.deepEqual(receipt.warnings, [], "nothing unsettled was left behind");
  });

  it("refuses a stored transaction outcome whose commit contract moved", () => {
    const terminal = workflowTerminalResultExecution(kualiTimekeeperAnnotationDescriptor);
    const node = terminal.dependsOn[0];
    assert.equal(node, KUALI_NODE_ID, "the kuali descriptor names its transaction node terminally");

    // The nested hash is not decoration: a durable outcome that claims a
    // different commit-output schema is refused before any authored `derive`
    // sees it, even though the ENVELOPE hash still matches.
    const proofSchemaHash = deriveSchemaHash(
      KualiSaveTimekeeperAnnotation.writeSafety.completion.proofSchema,
      "output",
    );
    const drifted = TransactionOutcomeSchema.parse({
      disposition: "committed",
      proofSource: "normal-output",
      proof: { schemaHash: proofSchemaHash, value: SAVED_PROOF },
      output: { schemaHash: "0".repeat(64), value: { savedState: SAVED_PROOF } },
      confirmedAt: "2026-08-04T17:08:54.867Z",
    });
    assert.throws(
      () => projectTransactionOutcome(KualiSaveTimekeeperAnnotation, drifted, "test"),
      /binds commit output schema 0{64}/,
    );
  });
});

const SAVED_PROOF = Object.freeze({
  kind: "kuali-saved-timekeeper",
  actionId: "0123456789abcdef01234567",
  documentNumber: KUALI_DOCUMENT_NUMBER,
  timekeeperName: KUALI_TIMEKEEPER_VALUE,
  observedEid: KUALI_EID,
  source: "reload-read-back",
});
