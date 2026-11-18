import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { z } from "zod";
import * as workflow from "../../../../src/workflow-kit/workflow.js";
import { deriveCheckpointOutputDigest, deriveCheckpointProvenanceDigest, TerminalDependencyEvidenceSchema, deriveRunResultDigest, deriveTerminalDependencyDigest, isRunPreviewSchemaHash, readRunPreviewResult, RunResultRecordSchema, terminalEvidenceResult } from "../../../../src/models/run/result.js";
import { DRY_RUN_I9_PROFILE_ID, DRY_RUN_TRANSACTION_NUMBER } from "../../../../src/models/workflow/dry-run.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { TransactionOutcomeSchema, WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import { transactionCheckpointProvenance } from "../../../../src/backend/runs/provenance/task-provenance.js";
import { buildRunResult } from "../../../../src/backend/runs/lifecycle/run-result.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { releaseSeededWriteOwners } from "../../../support/helpers/timeline-write-fixture.js";
import { trustWorld } from "../../../support/helpers/backend/trust-authority-fixture.js";
import { ocrProofReadDatabase } from "../../../support/helpers/backend/ocr-proof-reads.js";
import { createTrustRunReader } from "../../../../src/backend/runs/trust/canonical-reader.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { createCapabilityWiringTestWorld } from "../../../support/helpers/backend/capability-wiring-world.js";
import { createStepOmissionTestWorld } from "../../../support/helpers/backend/step-omission-world.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";

import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { LedgerEntryPayloadSchema } from "../../../../src/rules/runs/ledger.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { buildRunEvidenceReceipt, ensureRunEvidenceReceipt, type EvidenceReceiptStore } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { RunEvidenceReceiptSchema } from "../../../../src/models/trust/evidence.js";
import { kualiReceiptEvidence } from "../../../support/fixtures/receipt-run-fixtures.js";
import { finalizationPreviewDependencies } from "../../../support/helpers/kuali-finalization-fixtures.js";
import { personLookupDescriptor, separationsKualiFinalizationDescriptor as finalization } from "../../../support/helpers/registered-workflows.js";
import { workflowPreviewDependencyIds } from "../../../../src/workflow-kit/workflow.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("reads the settled receipt after its workflow removes a delegated node", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  assert.equal(f.canonical.kernel.execute(f.approval()).state, "applied");
  await f.canonical.execute(f.run, new AbortController().signal);

  const runId = f.run.envelope.runId;
  const deps = { database: f.database, runReader: f.canonical.lifecycle };
  const original = f.root.descriptor;
  const stored = createReceiptService({ ...deps, descriptors: [original] }).ensureReceipt(runId);
  const result = f.database.authority.runResults.get(runId);
  assert.ok(result);
  assert.deepEqual(f.database.authority.evidenceReceipts.findByRun(runId), stored);

  const wiring = createCapabilityWiringTestWorld();
  const revised = wiring.fixtureDescriptor(original.id, original.code, wiring.providersOnlyContract);
  assert.notEqual(revised.contractFingerprint, stored.descriptorFingerprint);
  const citation = result.dependencies.find(dep => dep.state === "delegation-resolved");
  assert.ok(citation);
  const dependencies = result.dependencies.map(dep => dep === citation ? { ...dep, nodeId: "foreign-node" } : dep);
  const repositories = f.database.authority;
  const conflicting = ocrProofReadDatabase(f.database, { ...repositories, runResults: { ...repositories.runResults,
    get: id => id === runId ? RunResultRecordSchema.parse({
      ...result, dependencies, dependencyDigest: deriveTerminalDependencyDigest(dependencies),
    }) : repositories.runResults.get(id),
  } });
  assert.throws(() => createReceiptService({ ...deps, database: conflicting, descriptors: [revised] }).ensure(runId),
    /receipt-delegation-citation-mismatch/);

  const checkpoint = result.dependencies.find(dep => dep.state === "resolved");
  assert.ok(checkpoint);
  const tamperedCheckpoints = ocrProofReadDatabase(f.database, { ...repositories, runCheckpoints: { ...repositories.runCheckpoints,
    listByItem: (workflow, item) => repositories.runCheckpoints.listByItem(workflow, item).filter(row =>
      row.nodeId !== checkpoint.nodeId || row.claimGeneration !== checkpoint.checkpoint.claimGeneration),
  } });
  assert.throws(() => createReceiptService({ ...deps, database: tamperedCheckpoints, descriptors: [revised] }).ensure(runId),
    /receipt-checkpoint-citation-mismatch/);

  const gate = stored.decisions.find(row => row.kind === "gate" && row.outcome === "approved");
  assert.ok(gate);
  const contradicted = RunEvidenceReceiptSchema.parse({ ...stored,
    decisions: stored.decisions.map(row => row.id === gate.id ? { ...row, outcome: "rejected" } : row),
  });
  const forgedDecision = ocrProofReadDatabase(f.database, { ...repositories, evidenceReceipts: { ...repositories.evidenceReceipts,
    findByRun: id => id === runId ? contradicted : repositories.evidenceReceipts.findByRun(id),
  } });
  assert.throws(() => createReceiptService({ ...deps, database: forgedDecision, descriptors: [revised] }).ensure(runId),
    /receipt-gate-decision-conflict/);

  const reader = createReceiptService({ ...deps, descriptors: [revised] });
  assert.deepEqual(reader.ensure(runId), { state: "existing", receipt: stored });
});

it("reads a first-transaction preview under its issued schema identity", () => {
  const hash = FingerprintSchema.parse("f738e4b4f4f486242d97892b7927f1e5605823b687c59af9da799e83b2b6797b");
  const nodeId = "save";
  const preview = {
    kind: "transaction-dry-run-preview", nodeId, observedAt: "2026-01-01T00:00:00.000Z",
    probe: { state: "present", proof: { schemaHash: hash, value: {} }, output: { schemaHash: hash, value: {} } },
    outcome: { state: "already-present", proofSource: "live-probe" },
  };
  const value = { kind: "dry-run-preview", stoppedAtNodeId: nodeId, externalCommit: "none", preview };
  const read = (payload: typeof value) => readRunPreviewResult({ resultSchemaHash: hash, result: { schemaHash: hash, value: payload } });
  assert.equal(isRunPreviewSchemaHash(hash), true);
  assert.deepEqual(read(value), { kind: "dry-run-preview", externalCommit: "none",
    coverage: { state: "partial", boundaryNodeId: nodeId, reason: "historical-first-transaction-only" },
    steps: [{ nodeId, state: "transaction-preview", preview, samples: [] }] });
  assert.throws(() => read({ ...value, stoppedAtNodeId: "another-node" }));
});

it("reads each transaction-number preview format without admitting later sample values", () => {
  for (const fingerprint of ["328c2ad1f69a1425501408231a9f6cf22ec35a0abec986c98fdc7cba10e41077",
    "aa91aab7f1fc10d775a82949af2ab3a7610f6c799dfc7c8678443a183f4776ff"]) {
    const hash = FingerprintSchema.parse(fingerprint);
    const value = (sample: string) => ({ kind: "dry-run-preview", externalCommit: "none", coverage: { state: "full" }, steps: [{
      state: "transaction-preview", nodeId: "save", preview: { kind: "transaction-dry-run-preview", nodeId: "save",
        observedAt: "2026-01-01T00:00:00.000Z", probe: { state: "not-required", reason: "preview-only-sample" },
        outcome: { state: "would-prepare", prepare: { schemaHash: hash, value: {} }, subject: { state: "unscoped", reviewedReasonId: "fixture" } } },
      samples: [{ label: "dry-run sample", sourceNodeId: "prepare", field: "transactionNumber", value: sample }],
    }] });
    const read = (sample: string) => readRunPreviewResult({ resultSchemaHash: hash, result: { schemaHash: hash, value: value(sample) } });
    assert.deepEqual(read(DRY_RUN_TRANSACTION_NUMBER), value(DRY_RUN_TRANSACTION_NUMBER));
    assert.throws(() => read(DRY_RUN_I9_PROFILE_ID), /sample unavailable/);
  }
});

it("recognizes terminal evidence under its issued hash and verifies its original owner", async () => {
  const f = await trustWorld();
  try {
    const failed = f.fail(f.create(1), 2);
    const current = f.database.authority.runResults.get(failed.envelope.runId);
    assert.ok(current);
    const hash = FingerprintSchema.parse("491980e23e4128e69e199f95f6a56ef735cc08e5419b2c5d587143e2621d18ec");
    const bound = { ...current.result, schemaHash: hash };
    const retained = RunResultRecordSchema.parse({ ...current, resultSchemaHash: hash, result: bound, resultDigest: deriveRunResultDigest(bound) });
    assert.deepEqual(terminalEvidenceResult(retained), current.result.value);
    assert.throws(() => RunResultRecordSchema.parse({ ...retained, attempt: retained.attempt + 1 }), /terminal failure evidence identity mismatch/);
  } finally {
    await f.dispose();
  }
});

it("refuses a failure warning that contradicts native settlement", async () => {
  const f = await trustWorld();
  try {
    const runId = f.fail(f.create(1), 2).envelope.runId;
    const stored = f.receipts.ensureReceipt(runId);
    assert.ok(stored.warnings.some(row => row.code === "INPUT_INVALID"));
    const wiring = createCapabilityWiringTestWorld();
    const revised = wiring.fixtureDescriptor(personLookupDescriptor.id, personLookupDescriptor.code, wiring.providersOnlyContract);
    const repositories = f.database.authority;
    const forged = RunEvidenceReceiptSchema.parse({ ...stored, warnings: stored.warnings.map(row =>
      row.code === "INPUT_INVALID" ? { ...row, summary: "The write committed before validation failed." } : row) });
    const database = ocrProofReadDatabase(f.database, { ...repositories, evidenceReceipts: { ...repositories.evidenceReceipts,
      findByRun: () => forged,
    } });
    for (const descriptor of [personLookupDescriptor, revised]) {
      const reader = createReceiptService({ database, runReader: f.reader, descriptors: [descriptor] });
      assert.throws(() => reader.ensure(runId), /declared-evidence moved|receipt-warning-conflict/);
    }
  } finally {
    await f.dispose();
  }
});

it("returns the issued first-transaction receipt wording and the producer's mandatory flags", () => {
  const fixture = kualiReceiptEvidence();
  const source = RunRecordSchema.parse(fixture.run);
  const original = RunResultRecordSchema.parse(fixture.result);
  assert.ok(source.completion?.kind === "done");
  const hash = FingerprintSchema.parse("f738e4b4f4f486242d97892b7927f1e5605823b687c59af9da799e83b2b6797b");
  const nodeId = "finalize-kuali", observedAt = original.createdAt;
  const preview = { kind: "transaction-dry-run-preview", nodeId, observedAt,
    probe: { state: "present", proof: { schemaHash: hash, value: {} }, output: { schemaHash: hash, value: {} } },
    outcome: { state: "already-present", proofSource: "live-probe" } };
  const bound = { schemaHash: hash, value: { kind: "dry-run-preview", externalCommit: "none", stoppedAtNodeId: nodeId, preview } };
  const decoded = readRunPreviewResult({ resultSchemaHash: hash, result: bound });
  assert.ok(decoded);
  const required = workflowPreviewDependencyIds(finalization, decoded.steps);
  const checkpoints = finalizationPreviewDependencies(source).map(row => TerminalDependencyEvidenceSchema.parse(row))
    .flatMap(row => row.state === "resolved" && required.includes(row.nodeId) ? [row.checkpoint] : []);
  const dependencies = checkpoints.map(row => ({
    state: "resolved", nodeId: row.nodeId, descriptorVersion: row.descriptorVersion, contractFingerprint: row.contractFingerprint,
    implFingerprint: row.implFingerprint, outputSchemaHash: row.output.schemaHash, outputDigest: deriveCheckpointOutputDigest(row.output),
    provenanceDigest: deriveCheckpointProvenanceDigest(row.provenance), checkpoint: { workflowId: row.workflowId, itemId: row.itemId,
      runId: row.runId, attempt: row.attempt, claimGeneration: row.claimGeneration },
  }));
  const result = RunResultRecordSchema.parse({ ...original, dependencies, dependencyDigest: deriveTerminalDependencyDigest(dependencies),
    resultSchemaHash: hash, result: bound, resultDigest: deriveRunResultDigest(bound) });
  const run = RunRecordSchema.parse({ ...source, envelope: { ...source.envelope, dryRun: true },
    completion: { ...source.completion, resultDigest: result.resultDigest } });
  const current = buildRunEvidenceReceipt({ descriptor: finalization, run, result, checkpoints });
  const summary = `this run was a DRY RUN: transaction node "${nodeId}" was previewed `
    + `(settled already-present at its present probe, before anything was staged, observed ${observedAt}) and the run ended `
    + "there. No external write was attempted — no write intent, no fence, no commit — so this "
    + "receipt states what WOULD have been written, never what was";
  const sample = current.observations[0];
  assert.ok(sample);
  const stored = RunEvidenceReceiptSchema.parse({ ...current,
    warnings: current.warnings.map(row => row.code === "DRY_RUN_PREVIEW" ? { ...row, summary } : row),
    observations: current.observations.map(row => row.id === sample.id ? { ...row, mandatory: !sample.mandatory } : row) });
  const store: EvidenceReceiptStore = { getRun: () => run, getResult: () => result, getFailure: () => undefined,
    listCheckpointsByRun: () => checkpoints, listWritesByRun: () => [], listGateResultsByRun: () => [],
    findReceiptByRun: () => stored, insertReceipt: candidate => {
      assert.deepEqual(candidate, stored);
      return { state: "existing", record: stored };
    } };
  assert.deepEqual(ensureRunEvidenceReceipt(store, finalization, run.envelope.runId), { state: "existing", receipt: stored });
  const wiring = createCapabilityWiringTestWorld();
  const removedBoundary = wiring.fixtureDescriptor(finalization.id, finalization.code, wiring.providersOnlyContract);
  assert.deepEqual(ensureRunEvidenceReceipt(store, removedBoundary, run.envelope.runId), { state: "existing", receipt: stored });
  const conflicting = { ...store, findReceiptByRun: () => ({ ...stored,
    warnings: stored.warnings.map(warning => ({ ...warning, summary: warning.summary.replace("already-present", "committed") })),
  }) };
  assert.throws(() => ensureRunEvidenceReceipt(conflicting, finalization, run.envelope.runId), /declared-evidence moved/);
  assert.throws(() => ensureRunEvidenceReceipt(conflicting, removedBoundary, run.envelope.runId), /receipt-preview-conflict/);
});

it("reads a removed transaction against its native write proof and refuses an altered proof", () => {
  const { store, runId, stored } = settledTransaction();
  const wiring = createCapabilityWiringTestWorld();
  const revised = wiring.fixtureDescriptor(finalization.id, finalization.code, wiring.providersOnlyContract);
  assert.deepEqual(ensureRunEvidenceReceipt(store, revised, runId), { state: "existing", receipt: stored });
  const altered = { ...stored, actions: stored.actions.map(action => action.proved === undefined ? action :
    { ...action, proved: { ...action.proved, recordedAt: "2026-01-01T00:00:00.000Z" } }) };
  assert.throws(() => ensureRunEvidenceReceipt({ ...store, findReceiptByRun: () => altered }, revised, runId), /receipt-write-proof-conflict/);
});

it("checks the issued checkpoint verdict and its exact output citations after the node is removed", () => {
  const { store, runId, stored } = settledTransaction();
  const wiring = createCapabilityWiringTestWorld();
  const revised = wiring.fixtureDescriptor(finalization.id, finalization.code, wiring.providersOnlyContract);
  const marker = stored.verification.find(row => row.obligation === "node.finalize-kuali");
  assert.ok(marker?.verdict === "verified" && marker.evidence.length > 1);
  for (const replacement of [
    { ...marker, mandatory: false, verdict: "absent" },
    { ...marker, evidence: marker.evidence.slice(1) },
  ]) {
    const altered = RunEvidenceReceiptSchema.parse({ ...stored,
      verification: stored.verification.map(row => row.id === marker.id ? replacement : row) });
    assert.throws(() => ensureRunEvidenceReceipt({ ...store, findReceiptByRun: () => altered }, revised, runId),
      /receipt-checkpoint-verification-conflict/);
  }
});

it("refuses a derived field that cites an action instead of upstream node evidence", () => {
  const { store, runId, stored } = settledTransaction();
  const derived = stored.observations.find(fact => fact.source.kind === "derived");
  const dedupe = stored.decisions.find(decision => decision.kind === "dedupe");
  assert.ok(derived && dedupe);
  const conflicting = RunEvidenceReceiptSchema.parse({ ...stored,
    observations: stored.observations.map(fact => fact !== derived ? fact : {
      ...fact, source: { kind: "derived", evidence: dedupe.evidence },
    }),
  });
  const wiring = createCapabilityWiringTestWorld();
  const revised = wiring.fixtureDescriptor(finalization.id, finalization.code, wiring.providersOnlyContract);
  assert.throws(() => ensureRunEvidenceReceipt({ ...store, findReceiptByRun: () => conflicting }, revised, runId),
    /receipt-checkpoint-source-conflict/);
});

it("keeps operator-asserted checkpoints present and rejects invented verification or decisions", async () => {
  const omissions = createStepOmissionTestWorld();
  try {
    const fixture = await omissions.omittedStepFixture();
    const runId = fixture.run.envelope.runId;
    const stored = buildRunEvidenceReceipt({ descriptor: personLookupDescriptor, ...fixture });
    const wiring = createCapabilityWiringTestWorld();
    const revised = wiring.fixtureDescriptor(personLookupDescriptor.id, personLookupDescriptor.code, wiring.providersOnlyContract);
    const store: EvidenceReceiptStore = {
      getRun: () => fixture.run, getResult: () => fixture.result, getFailure: () => undefined,
      listCheckpointsByRun: () => fixture.checkpoints, listWritesByRun: () => [], listGateResultsByRun: () => [],
      findReceiptByRun: () => stored, insertReceipt: candidate => ({ state: "existing", record: RunEvidenceReceiptSchema.parse(candidate) }),
    };
    assert.deepEqual(ensureRunEvidenceReceipt(store, revised, runId).receipt, stored);
    const marker = stored.verification.find(row => row.obligation === `node.${omissions.ASSERTED_NODE}`);
    assert.ok(marker?.verdict === "present");
    const forged = { ...stored, verification: stored.verification.map(row => row.id === marker.id ? { ...marker, verdict: "verified" } : row) };
    assert.throws(() => ensureRunEvidenceReceipt({ ...store, findReceiptByRun: () => forged }, revised, runId),
      /receipt-checkpoint-verification-conflict/);
    const forgedDecision = { ...stored, decisions: stored.decisions.map(row =>
      row.kind === "assertion" ? { ...row, outcome: "not-taken" } : row) };
    assert.throws(() => ensureRunEvidenceReceipt({ ...store, findReceiptByRun: () => forgedDecision }, revised, runId),
      /receipt-assertion-decision-conflict/);
  } finally {
    await omissions.cleanup();
  }
});

it("refuses a different completion method after its transaction node is removed", () => {
  const { store, runId, stored, publication } = settledTransaction();
  const wiring = createCapabilityWiringTestWorld();
  const revised = wiring.fixtureDescriptor(finalization.id, finalization.code, wiring.providersOnlyContract);
  assert.throws(() => ensureRunEvidenceReceipt({ ...store, readConfirmedWrite: () => undefined }, revised, runId),
    /receipt-write-completion-authority-unavailable/);
  assert.throws(() => ensureRunEvidenceReceipt({ ...store, readConfirmedWrite: () => undefined }, finalization, runId),
    /receipt-write-completion-authority-unavailable/);
  const foreign = { ...publication, ledger: LedgerEntryPayloadSchema.parse({ ...publication.ledger, intentGeneration: publication.ledger.intentGeneration + 1 }) };
  assert.throws(() => ensureRunEvidenceReceipt({ ...store, readConfirmedWrite: () => foreign }, revised, runId),
    /receipt-write-publication-conflict/);
  const commit = stored.actions.find(action => action.proved !== undefined);
  assert.ok(commit?.proved?.completion === "save-verify");
  const altered = RunEvidenceReceiptSchema.parse({ ...stored, actions: stored.actions.map(action => action.id !== commit.id
    ? action : { ...action, proved: { ...commit.proved, completion: "receipt" } }) });
  assert.throws(() => ensureRunEvidenceReceipt({ ...store, findReceiptByRun: () => altered }, revised, runId),
    /receipt-write-proof-conflict/);
});

it("reads a removed transaction through the receipt service using its SQLite confirmation", async () => {
  const { fixture, publication, runId } = settledTransaction();
  const { ledger, checkpoint } = publication;
  const clock = manualClock(new Date(ledger.confirmedAt));
  const profile = await createBoundProfileFixture();
  const database = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner: "retained-receipt-test" }, clock);
  try {
    const { authority } = database;
    testWorkerPorts(database, clock, { path: profile.path, descriptor: finalization, poolIndex: 1 });
    const active = authority.runtimeConfig.get();
    assert.ok(active);
    const run = RunRecordSchema.parse(fixture.run);
    authority.runs.enqueue({ envelope: { ...run.envelope, configFingerprint: active.configFingerprint, configSnapshotId: active.configSnapshotId },
      input: run.input, lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: run.createdAt, updatedAt: run.createdAt });
    const write = fixture.writes[0];
    assert.ok(write?.intent.status === "committed");
    const { completionProof, confirmedAt, ...identity } = write.intent;
    fenceWriteFixture(database, {
      intent: { ...identity, status: "attempting", version: 1, updatedAt: ledger.fencedAt },
      attempt: { ...write.attempts[0], outcome: { state: "attempting" }, recordedAt: ledger.fencedAt },
    });
    const checkpoints = fixture.checkpoints.map(row => RunCheckpointRecordSchema.parse(row));
    for (const row of checkpoints) {
      if (row.nodeId !== checkpoint.nodeId) authority.runCheckpoints.insert(row);
    }
    const { writeIntentId, intentGeneration, traceId, workflowId, itemId, attempt, system, idempotencyKey, idempotencyKeyDigest, bindingProofDigest } = ledger;
    const outcome = checkpoint.output.value;
    database.commitWriteAttempt({ writeIntentId, generation: intentGeneration, completionProof, confirmedAt, outcome,
      transaction: { ...ledger, configFingerprint: active.configFingerprint },
      committedSpan: { kind: "write-committed-span", writeIntentId, intentGeneration, runId, traceId, workflowId, itemId,
        attempt, system, idempotencyKey, idempotencyKeyDigest, bindingProofDigest, occurredAt: confirmedAt, outcome },
    }, checkpoint);
    const running = authority.runs.get(runId);
    assert.ok(running?.lifecycle.state === "running");
    const built = buildRunResult(finalization, running, checkpoints.map(row => ({ state: "resolved", nodeId: row.nodeId, checkpoint: row })), clock);
    database.terminalizeSuccess({ result: built.record, authorization: {
      kind: "done", runId, workflowId, attempt, descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint, expectedVersion: running.version, authorizedAt: confirmedAt,
      claim: { workerId: running.lifecycle.workerId, claimGeneration: running.claimGeneration }, resultDigest: built.record.resultDigest,
    } }, built.authorization);
    const runReader = createTrustRunReader(database, clock);
    const service = (descriptor: workflow.AnyWorkflowDescriptor) =>
      createReceiptService({ database, runReader, descriptors: [descriptor] });
    const stored = service(finalization).ensure(runId);
    assert.equal(stored.state, "derived");
    const wiring = createCapabilityWiringTestWorld();
    const revised = wiring.fixtureDescriptor(finalization.id, finalization.code, wiring.providersOnlyContract);
    assert.deepEqual(service(revised).ensure(runId), { state: "existing", receipt: stored.receipt });
  } finally {
    releaseSeededWriteOwners(database, ledger.confirmedAt);
    database.close();
    await profile.close();
  }
});

function settledTransaction() {
  const fixture = kualiReceiptEvidence();
  const run = RunRecordSchema.parse(fixture.run);
  const stored = buildRunEvidenceReceipt({ descriptor: finalization, ...fixture });
  const checkpoint = fixture.checkpoints.map(row => RunCheckpointRecordSchema.parse(row)).find(row => row.nodeId === "finalize-kuali");
  const intent = fixture.writes[0]?.intent;
  assert.ok(checkpoint && intent?.status === "committed");
  const ledger = LedgerEntryPayloadSchema.parse({
    runId: intent.runId, traceId: run.envelope.traceId, attempt: intent.runAttempt, workflowId: intent.workflowId, itemId: intent.itemId,
    writeIntentId: intent.writeIntentId, intentGeneration: intent.generation, bindingProofDigest: intent.bindingProofDigest,
    system: intent.system, instance: "prod", idempotencyKey: intent.idempotencyKey, idempotencyKeyDigest: intent.idempotencyKeyDigest,
    proof: intent.completionProof, completionKind: "save-verify", proofSource: "normal-output", confirmedAt: intent.confirmedAt,
    configFingerprint: run.envelope.configFingerprint, dryRun: false, fencedAt: intent.fencedAt,
    operator: "local-operator", externalOccurredAt: { state: "absent" },
    subject: intent.bindingProof.kind === "subject-match" ? { state: "present", value: intent.bindingProof.expected } : { state: "absent" },
  });
  const publication = { checkpoint, ledger };
  const store: EvidenceReceiptStore = {
    readConfirmedWrite: id => id === intent.writeIntentId ? publication : undefined,
    getRun: () => run, getResult: () => fixture.result, getFailure: () => undefined,
    listCheckpointsByRun: () => fixture.checkpoints, listWritesByRun: () => fixture.writes,
    listGateResultsByRun: () => [], findReceiptByRun: () => stored,
    insertReceipt: candidate => ({ state: "existing", record: RunEvidenceReceiptSchema.parse(candidate) }),
  };
  return { store, runId: run.envelope.runId, stored, fixture, publication };
}

it("reads an observed-present proof with its issuing rule and distinguishes a missing historical method", () => {
  const { fixture, publication, store, runId } = settledTransaction();
  const { ledger, checkpoint } = publication;
  const source = RunRecordSchema.parse(fixture.run);
  const { completion, ...runFields } = source;
  assert.ok(completion?.kind === "done");
  const outcome = TransactionOutcomeSchema.parse({ disposition: "already-present", proofSource: "durable-intent",
    proof: ledger.proof, output: TransactionOutcomeSchema.parse(checkpoint.output.value).output, observedAt: checkpoint.writtenAt });
  const checkpoints = fixture.checkpoints.map(row => RunCheckpointRecordSchema.parse(row)).map(row =>
    row.nodeId === checkpoint.nodeId ? RunCheckpointRecordSchema.parse({ ...row, output: { ...row.output, value: outcome },
      provenance: transactionCheckpointProvenance(outcome, row.writtenAt) }) : row);
  const { record: result } = buildRunResult(finalization, { ...runFields, version: completion.expectedVersion, lifecycle: {
    state: "running", workerId: completion.claim.workerId, claimedAt: source.createdAt, heartbeatAt: checkpoint.writtenAt,
  } }, checkpoints.map(row => ({ state: "resolved", nodeId: row.nodeId, checkpoint: row })), manualClock(new Date(checkpoint.writtenAt)));
  const run = RunRecordSchema.parse({ ...source, completion: { ...completion, resultDigest: result.resultDigest } });
  const intent = WriteIntentRecordSchema.parse({ status: "observed-present", writeIntentId: ledger.writeIntentId,
    workflowId: ledger.workflowId, itemId: ledger.itemId, taskId: "kuali/save-separation-finalization", system: ledger.system,
    idempotencyKey: ledger.idempotencyKey, idempotencyKeyDigest: ledger.idempotencyKeyDigest, generation: 1, version: 1,
    observedProof: ledger.proof, observedAt: ledger.fencedAt, createdAt: ledger.fencedAt, updatedAt: ledger.fencedAt });
  assert.ok(intent.status === "observed-present");
  const writes = [{ intent, attempts: [] }];
  const issued = buildRunEvidenceReceipt({ descriptor: finalization, run, result, checkpoints, writes });
  const retained: EvidenceReceiptStore = { ...store, getRun: () => run, getResult: () => result, listCheckpointsByRun: () => checkpoints,
    listWritesByRun: () => writes, findReceiptByRun: () => issued, readConfirmedWrite: () => assert.fail("no fenced confirmation for an observation") };
  assert.deepEqual(ensureRunEvidenceReceipt(retained, finalization, runId), { state: "existing", receipt: issued });
  const foreign = WriteIntentRecordSchema.parse({ ...intent, itemId: "ebea05e6-6be3-470a-a172-7ef56494a231" });
  assert.throws(() => ensureRunEvidenceReceipt({ ...retained, listWritesByRun: () => [{ intent: foreign, attempts: [] }] }, finalization, runId),
    /receipt-write-owner-conflict/);
  const conflicting = { ...intent, observedProof: { ...intent.observedProof, value: { changed: true } } };
  assert.throws(() => ensureRunEvidenceReceipt({ ...retained, listWritesByRun: () => [{ intent: conflicting, attempts: [] }] }, finalization, runId),
    /receipt-write-proof-conflict/);
  const wiring = createCapabilityWiringTestWorld();
  const revised = wiring.fixtureDescriptor(finalization.id, finalization.code, wiring.providersOnlyContract);
  assert.throws(() => ensureRunEvidenceReceipt(retained, revised, runId), /receipt-write-completion-authority-unavailable/);
});

it("refuses a decision reason that contradicts the settled transaction", () => {
  const { store, runId, stored } = settledTransaction();
  const dedupe = stored.decisions.find(row => row.kind === "dedupe");
  assert.ok(dedupe?.outcome === "taken");
  const forged = { ...store, findReceiptByRun: () => ({ ...stored, decisions: stored.decisions.map(row => row.id === dedupe.id
    ? { ...row, reason: "The permanent key was already satisfied and no write occurred." } : row) }) };
  assert.throws(() => ensureRunEvidenceReceipt(forged, finalization, runId), /declared-evidence moved/);
  const wiring = createCapabilityWiringTestWorld();
  const revised = wiring.fixtureDescriptor(finalization.id, finalization.code, wiring.providersOnlyContract);
  assert.throws(() => ensureRunEvidenceReceipt(forged, revised, runId), /receipt-write-decision-conflict/);
});

it.each(["proof schema", "proof schema and method"])("reads a settled write after its %s changes and rejects a conflicting intent proof", change => {
  const { store, runId, stored, fixture } = settledTransaction();
  const nodes = workflow.descriptorRuntimeNodes(finalization);
  const revised = nodes.map(node => {
    if (node.kind !== "transaction") return node;
    const commit = node.commit.uses;
    return { ...node, commit: { ...node.commit, uses: { ...commit, writeSafety: { ...commit.writeSafety,
      completion: { ...commit.writeSafety.completion, ...(change === "proof schema" ? {} : { kind: "receipt" as const }), proofSchema: z.strictObject({ revised: z.boolean() }) },
    } } } };
  });
  const projection = vi.spyOn(workflow, "descriptorRuntimeNodes").mockReturnValue(revised);
  try {
    assert.deepEqual(ensureRunEvidenceReceipt(store, finalization, runId), { state: "existing", receipt: stored });
    const writes = fixture.writes.map(row => row.intent.status !== "committed" ? row : { ...row, intent: {
      ...row.intent, completionProof: { ...row.intent.completionProof, value: { changed: true } },
    } });
    assert.throws(() => ensureRunEvidenceReceipt({ ...store, listWritesByRun: () => writes }, finalization, runId),
      /receipt-write-proof-conflict/);
  } finally {
    projection.mockRestore();
  }
});
