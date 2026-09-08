/**
 * One synthetic person-bearing permanent key crossing every operator boundary.
 * Authority retains the natural key; diagnostics and wires may retain only its
 * digest or a bounded reference derived from that digest.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildRunEvidenceReceipt } from "../../src/core/evidence-receipt.js";
import {
  LedgerLinePointerSchema,
  resolveLedgerLine,
} from "../../src/domain/archive/ledger-resolution.js";
import { deriveWriteBindingProofDigest, WriteIntentRecordSchema } from "../../src/domain/write-safety.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import { RunEvidenceReceiptSchema } from "../../src/domain/trust/evidence.js";
import {
  buildExplainRunView,
  renderExplainRun,
} from "../../src/server/explain/explain-run.js";
import { buildRunSection } from "../../src/server/dashboard/queries/run-detail.js";
import {
  KUALI_EID,
  kualiReceiptEvidence,
} from "../fixtures/receipt-run-fixtures.js";
import { separationsKualiFinalizationDescriptor } from "../helpers/registered-workflows.js";
import {
  makeWorld,
  queuedEventOf,
  runEndedEventOf,
  uuidOf,
  type DashboardWorld,
} from "./server/helpers/dashboard-harness.js";

const worlds: DashboardWorld[] = [];

afterEach(() => {
  for (const world of worlds.splice(0)) world.dispose();
});

describe("idempotency-key privacy across operator projections", () => {
  it("keeps one raw key and its EID out of parked messages, receipts, Archive, Explain, and dashboard wires", () => {
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

    const archive = resolveLedgerLine(
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
    );

    const explain = buildExplainRunView({
      run,
      checkpoints,
      writes: [parked],
      receipt,
      nodeIds: [],
      dependencies: [],
    });

    const world = makeWorld();
    worlds.push(world);
    const runId = uuidOf(1);
    const writeIntentId = uuidOf(11);
    const currentAttemptId = uuidOf(12);
    queuedEventOf(world, {
      seed: 1,
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
    const bindingProof = { ...parked.bindingProof, runId };
    world.authority.putWriteIntent(WriteIntentRecordSchema.parse({
      ...parked,
      writeIntentId,
      currentAttemptId,
      runId,
      bindingProof,
      bindingProofDigest: deriveWriteBindingProofDigest(bindingProof),
    }));
    const dashboard = buildRunSection({ runReader: world.runReader,
      stateRoot: world.stateRoot,
      projection: world.projection,
      authority: world.authority,
      descriptors: { resolve: () => undefined },
    }, runId, "parked-write");

    const projectedBytes = JSON.stringify({
      receipt,
      archive,
      explain,
      explainText: renderExplainRun(explain),
      dashboard,
    });
    assert.equal(projectedBytes.includes(rawKey), false);
    assert.equal(projectedBytes.includes(KUALI_EID), false);
    assert.ok(projectedBytes.includes(digest.slice(0, 12)));
    assert.equal(parked.idempotencyKey, rawKey, "authority retains the byte-exact natural key");
    assert.equal(parked.message, unsafeMessage, "historical authority evidence remains immutable");
  });

  it("withholds a seeded legacy receipt from run detail and Explain", () => {
    const world = makeWorld();
    worlds.push(world);
    queuedEventOf(world, {
      seed: 2,
      lifecycle: {
        state: "terminal",
        outcome: "done",
        endedAt: "2026-08-29T08:00:00.000Z",
      },
      version: 2,
    });
    runEndedEventOf(world, 2, "done");
    const raw = "ucpath:termination|10812345|2026-08-29";
    const evidence = kualiReceiptEvidence();
    const current = buildRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      run: evidence.run,
      result: evidence.result,
      checkpoints: evidence.checkpoints,
      writes: evidence.writes,
    });
    const legacy = RunEvidenceReceiptSchema.parse({
      ...current,
      composition: 2,
      warnings: [{
        id: "20000000-0000-4000-8000-000000000001",
        code: "LEGACY_DIAGNOSTIC",
        summary: raw,
        loadBearing: false,
        evidence: [],
      }],
      confidence: "partial",
      result: "done-with-warnings",
    });
    const runDetail = buildRunSection({ runReader: world.runReader,
      stateRoot: world.stateRoot,
      projection: world.projection,
      authority: world.authority,
      descriptors: { resolve: () => undefined },
      trust: {
        ensureReceipt: () => legacy,
        getFailure: () => undefined,
        countFailuresByFingerprint: () => 1,
      },
    }, uuidOf(2), "receipt");
    const run = world.authority.getRun(uuidOf(2));
    if (run === undefined) throw new Error("the fixture run is missing");
    const explain = buildExplainRunView({
      run,
      checkpoints: [],
      writes: [],
      receipt: legacy,
      nodeIds: [],
      dependencies: [],
    });

    const projected = JSON.stringify({ runDetail, explain, text: renderExplainRun(explain) });
    assert.equal(projected.includes(raw), false);
    assert.match(projected, /composition 2.*withheld/u);
    assert.equal(JSON.stringify(legacy).includes(raw), true, "authority evidence remains unchanged");
  });
});
