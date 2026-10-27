import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import {
buildExplainRunView,
renderExplainRun,
} from "../../../../src/backend/runs/explain/explain-run.js";
import { buildRunEvidenceReceipt } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { buildRunSection } from "../../../../src/backend/runs/queries/run-detail.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import {
LedgerLinePointerSchema,
resolveLedgerLine,
} from "../../../../src/models/run/transaction-resolution.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { deriveWriteBindingProofDigest,WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import {
KUALI_EID,
kualiReceiptEvidence,
} from "../../../support/fixtures/receipt-run-fixtures.js";
import {
makeWorld,
queuedEventOf,
uuidOf,
type DashboardWorld,
} from "../../../support/helpers/backend/dashboard-harness.js";
import { separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";

const worlds: DashboardWorld[] = [];

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.dispose();
});

describe("idempotency-key privacy across operator projections", () => {
  it("keeps one raw key out of parked messages, receipts, transactions, Explain, and dashboard wires", async () => {
    const evidence = kualiReceiptEvidence();
    const committed = evidence.writes[0].intent;
    if (committed.status !== "committed") throw new Error("the canary fixture must start committed");
    const { completionProof, confirmedAt, status, ...attemptAuthority } = committed;
    void completionProof;
    void confirmedAt;
    void status;
    const rawKey = committed.idempotencyKey;
    const digest = committed.idempotencyKeyDigest;
    const unsafeMessage = `probe failed for ${rawKey}; subject ${KUALI_EID}`;
    const parked = WriteIntentRecordSchema.parse({
      ...attemptAuthority,
      status: "parked",
      parkedCode: "unknown",
      message: unsafeMessage,
      authorityReason: deriveWriteAuthorityReason("post-click-verifier-unknown", "probe", unsafeMessage),
    });
    if (parked.status !== "parked") throw new Error("the canary fixture must be parked");
    const run = RunRecordSchema.parse(evidence.run);
    const checkpoints = RunCheckpointRecordSchema.array().parse(evidence.checkpoints);

    const receipt = buildRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      run,
      result: evidence.result,
      checkpoints,
      writes: [{ intent: parked, attempts: [] }],
    });

    const transaction = resolveLedgerLine(
      LedgerLinePointerSchema.parse({ system: "kuali", date: "2026-08-14", sequence: 0 }),
      {
        system: parked.system,
        instance: "prod",
        idempotencyKeyDigest: digest,
        completionKind: "save-verify",
        proofSource: "normal-output",
        confirmedAt: run.updatedAt,
        proof: { schemaHash: "f".repeat(64), value: {} },
      },
      "protected",
    );

    const explain = buildExplainRunView({
      run,
      checkpoints,
      writes: [parked],
      receipt,
      nodeIds: [],
      dependencies: [],
    });

    const world = await makeWorld();
    worlds.push(world);
    const runId = uuidOf(1);
    const writeIntentId = uuidOf(11);
    const currentAttemptId = uuidOf(12);
    const queued = queuedEventOf(world, {
      seed: 1,
      workflow: parked.workflowId,
      version: 4,
      lifecycle: {
        state: "parked-write",
        writeIntentId,
        intentGeneration: parked.generation,
        parkedAt: parked.updatedAt,
        code: parked.parkedCode,
        message: unsafeMessage,
      },
    });
    const bindingProof = { ...parked.bindingProof, runId, attempt: queued.attempt };
    world.authority.putWriteIntent(WriteIntentRecordSchema.parse({
      ...parked,
      writeIntentId,
      currentAttemptId,
      runId,
      itemId: queued.itemId,
      runAttempt: queued.attempt,
      bindingProof,
      bindingProofDigest: deriveWriteBindingProofDigest(bindingProof),
    }));
    const dashboard = buildRunSection({ runReader: world.runReader, timeline: world.timeline,
      stateRoot: world.stateRoot,
      projection: world.projection,
      authority: world.authority,
      descriptors: { resolve: () => undefined },
    }, runId, "parked-write");

    const projectedBytes = JSON.stringify({
      receipt,
      transaction,
      explain,
      explainText: renderExplainRun(explain),
      dashboard,
    });
    assert.equal(projectedBytes.includes(rawKey), false);
    assert.equal(projectedBytes.includes(KUALI_EID), true);
    assert.ok(projectedBytes.includes(digest.slice(0, 12)));
    assert.equal(parked.idempotencyKey, rawKey, "authority retains the byte-exact natural key");
    assert.equal(parked.message, unsafeMessage, "authority evidence remains immutable");
  });
});
