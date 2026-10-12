import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { admitDirectWorker } from "../../../src/backend/storage/sqlite/worker-slots.js";
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { TransactionOutcomeSchema } from "../../../src/rules/write-safety/write-safety.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { AtomicWriteCommitInputSchema } from "../../../src/backend/storage/sqlite/write-commit-contracts.js";
import type { AuthorityDatabase } from "./synthetic-storage-admission.js";
import { HASH_A, HASH_B, CONFIG_SNAPSHOT } from "../fixtures/phase1c-contract-fixtures.js";

/** Populate the immutable output that real sequencer settlement always supplies. */
export function atomicWriteCheckpoint(input: unknown) {
  const commit = currentAtomicWriteFixture(input);
  const ledger = commit.transaction;
  return RunCheckpointRecordSchema.parse({ workflowId: ledger.workflowId, itemId: ledger.itemId,
    nodeId: `write-${ledger.writeIntentId}`, attempt: ledger.attempt, claimGeneration: 1, runId: ledger.runId,
    output: { schemaHash: deriveSchemaHash(TransactionOutcomeSchema, "output"), value: commit.outcome },
    descriptorVersion: 1, contractFingerprint: HASH_A, implFingerprint: HASH_B,
    provenance: [], writtenAt: commit.confirmedAt });
}

/** Unit fixtures retain an actual owner; timeline history may never manufacture it. */
export function seedAtomicWriteOwner(database: AuthorityDatabase, input: unknown, path: string, preferredPoolIndex?: number): void {
  const commit = currentAtomicWriteFixture(input);
  const ledger = commit.transaction;
  const existing = database.authority.runs.get(ledger.runId);
  if (existing !== undefined && (existing.lifecycle.state === "claimed" || existing.lifecycle.state === "validating" || existing.lifecycle.state === "running")) {
    assert.ok(existing.lifecycle.workerId);
    assert.equal(existing.claimGeneration, 1);
    assert.equal(existing.envelope.attempt, ledger.attempt);
    return;
  }
  if (ledger.configFingerprint !== CONFIG_SNAPSHOT.fingerprint) throw new Error("fixture config fingerprint differs from current snapshot");
  const active = database.authority.runtimeConfig.get() ?? database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  assert.equal(active.configSnapshotId, CONFIG_SNAPSHOT.configSnapshotId);
  assert.equal(active.configFingerprint, ledger.configFingerprint);
  if (existing === undefined) database.authority.runs.enqueue(RunRecordSchema.parse({
    envelope: { runId: ledger.runId, workflow: ledger.workflowId, itemId: ledger.itemId,
      traceId: ledger.traceId, descriptorVersion: 1, contractFingerprint: HASH_A,
      resolvedInstance: { [ledger.system]: ledger.instance }, configFingerprint: ledger.configFingerprint,
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, shape: "single", priority: "interactive", dryRun: false,
      attempt: ledger.attempt, enqueuedAt: ledger.fencedAt },
    input: { raw: {}, parsed: { schemaHash: HASH_A, value: {}, protectedBindings: [] }, ingressSchemaHash: HASH_A },
    lifecycle: { state: "queued" }, claimGeneration: 0, version: 1,
    createdAt: ledger.fencedAt, updatedAt: ledger.fencedAt,
  }));
  const slot = database.withAuthorityTransaction(repositories => {
    const currentSlots = repositories.workerSlots.list(ledger.workflowId).filter(slot => slot.retiredAt === null);
    let admitted = currentSlots.find(slot => (preferredPoolIndex === undefined || slot.poolIndex === preferredPoolIndex)
      && !repositories.runs.listByWorker(slot.workerId).some(run =>
      ["claimed", "validating", "running"].includes(run.lifecycle.state)));
    if (admitted === undefined) {
      const occupied = new Set(currentSlots.map(slot => slot.poolIndex));
      const poolIndex = (preferredPoolIndex === undefined ? [1, 2, 3] : [preferredPoolIndex]).find(index => !occupied.has(index));
      if (poolIndex === undefined) throw new Error("fixture has no unheld worker slot");
      admitted = admitDirectWorker(repositories, { commandId: randomUUID(), workflow: ledger.workflowId,
        poolIndex, expectedPoolVersion: repositories.workerPools.get(ledger.workflowId)?.version ?? 0,
        processId: process.pid, processAcquisitionId: randomUUID(), authorityPath: realpathSync(path),
        processLockRoot: join(dirname(realpathSync(path)), "locks"), now: ledger.fencedAt }, randomUUID());
    }
    if (repositories.workerLeases.get(admitted.workerId) === undefined || repositories.workerLeases.get(admitted.workerId)?.lifecycle.state === "stopped") {
      assert.equal(repositories.workerLeases.start({ workerId: admitted.workerId, workflow: ledger.workflowId,
        browserSystems: [ledger.system], processId: process.pid, requestedBy: "local-operator", now: ledger.fencedAt }).state, "started");
    }
    return admitted;
  });
  const claim = database.authority.runs.claimNext({ workflow: ledger.workflowId, workerId: slot.workerId, now: ledger.fencedAt });
  assert.equal(claim.state, "claimed");
  if (claim.state !== "claimed") throw new Error("fixture owner could not claim");
  assert.equal(claim.run.envelope.runId, ledger.runId);
  assert.equal(database.authority.runs.get(ledger.runId)?.claimGeneration, 1);
}

export function currentAtomicWriteFixture(input: unknown) {
  return AtomicWriteCommitInputSchema.parse(input);
}
