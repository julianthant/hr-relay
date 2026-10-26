import assert from "node:assert/strict";



import { testAdmittedWorker } from '../fixtures/run-lifecycle-fixtures.js';
import { capturedInstantClock } from '../../../src/rules/time/clock.js';
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
  const repositories = database.authority;
  const currentSlots = repositories.workerSlots.list(ledger.workflowId).filter(slot => slot.retiredAt === null);
const admitted = currentSlots.find(slot => (preferredPoolIndex === undefined || slot.poolIndex === preferredPoolIndex)
      && !repositories.runs.listByWorker(slot.workerId).some(run =>
      ["claimed", "validating", "running"].includes(run.lifecycle.state)));
  let poolIndex = admitted?.poolIndex;
  if (admitted === undefined) {
    const occupied = new Set(currentSlots.map(slot => slot.poolIndex));
poolIndex = (preferredPoolIndex === undefined ? [1, 2, 3] : [preferredPoolIndex]).find(index => !occupied.has(index));
if (poolIndex === undefined) throw new Error("fixture has no unheld worker slot");
  }
  assert.ok(poolIndex !== undefined);
  const owned = testAdmittedWorker(database, capturedInstantClock(ledger.fencedAt), { path, workflow: ledger.workflowId, poolIndex,
    browserSystems: [ledger.system] });
  const slot = owned.member;
  if (owned.started !== undefined) assert.equal(owned.started.state, "started");
  const lease = database.authority.workerLeases.get(slot.workerId);
  if (lease === undefined) throw new Error("fixture claim lifetime unavailable");
  const claim = database.authority.runs.claimNext({ workflow: ledger.workflowId, workerId: slot.workerId,
    workerLifetime: { leaseGeneration: lease.leaseGeneration, membershipRevision: slot.membershipRevision }, now: ledger.fencedAt });
  assert.equal(claim.state, "claimed");
  if (claim.state !== "claimed") throw new Error("fixture owner could not claim");
  assert.equal(claim.run.envelope.runId, ledger.runId);
  assert.equal(database.authority.runs.get(ledger.runId)?.claimGeneration, 1);
}

export function currentAtomicWriteFixture(input: unknown) {
  return AtomicWriteCommitInputSchema.parse(input);
}
