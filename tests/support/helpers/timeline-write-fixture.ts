import assert from "node:assert/strict";



import { testAdmittedWorker } from '../fixtures/run-lifecycle-fixtures.js';
import { capturedInstantClock } from '../../../src/rules/time/clock.js';
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import { RunRecordSchema, runClaim } from "../../../src/models/run/record.js";
import { deriveWriteAuthorityReason } from "../../../src/rules/write-safety/write-authority-reason.js";
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

export function releaseSeededWriteOwners(database: AuthorityDatabase, now: string): void {
  const authorityReason = deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "fixture release");
  for (const slot of database.authority.workerSlots.list()) {
    for (const owned of database.authority.runs.listByWorker(slot.workerId)) {
      if (owned.lifecycle.state !== "claimed" && owned.lifecycle.state !== "validating" && owned.lifecycle.state !== "running") continue;
      let run = database.authority.runs.get(owned.envelope.runId);
      if (run === undefined) continue;
      let parkedIntent: { writeIntentId: string; generation: number } | undefined;
      for (const intent of database.authority.writeIntents.listByRun(run.envelope.runId)) {
        if (intent.status !== "attempting") continue;
        const parked = database.authority.writeIntents.parkAttempt({
          writeIntentId: intent.writeIntentId, generation: intent.generation, expectedVersion: intent.version,
          code: "unknown", message: "fixture release", authorityReason, now,
        });
        parkedIntent = { writeIntentId: parked.writeIntentId, generation: parked.generation };
        run = database.authority.runs.get(run.envelope.runId) ?? run;
      }
      const held = runClaim(run);
      if (held === undefined) continue;
      const claim = { workerId: held.workerId, claimGeneration: held.claimGeneration };
      if (parkedIntent !== undefined) {
        if (run.lifecycle.state === "claimed" || run.lifecycle.state === "validating") {
          const lifetime = "workerLifetime" in run.lifecycle ? run.lifecycle.workerLifetime : undefined;
          const stepping = database.authority.runs.transition({
            runId: run.envelope.runId, expectedVersion: run.version, claim,
            lifecycle: { state: run.lifecycle.state === "claimed" ? "validating" : "running", workerId: claim.workerId,
              ...(lifetime === undefined ? {} : { workerLifetime: lifetime }), claimedAt: now, heartbeatAt: now },
            now,
          });
          if (stepping.state !== "applied") throw new Error("fixture-worker-claim-release-unproved");
          run = stepping.run;
          if (run.lifecycle.state === "validating") {
            const running = database.authority.runs.transition({
              runId: run.envelope.runId, expectedVersion: run.version, claim,
              lifecycle: { state: "running", workerId: claim.workerId,
                ...(lifetime === undefined ? {} : { workerLifetime: lifetime }), claimedAt: now, heartbeatAt: now },
              now,
            });
            if (running.state !== "applied") throw new Error("fixture-worker-claim-release-unproved");
            run = running.run;
          }
        }
        const parkedRun = database.authority.runs.transition({
          runId: run.envelope.runId, expectedVersion: run.version, claim,
          lifecycle: { state: "parked-write", writeIntentId: parkedIntent.writeIntentId,
            intentGeneration: parkedIntent.generation, parkedAt: now, code: "unknown", message: "fixture release" },
          now,
        });
        if (parkedRun.state !== "applied") throw new Error("fixture-worker-claim-release-unproved");
        continue;
      }
      const released = database.authority.runs.requeue({
        runId: run.envelope.runId, expectedVersion: run.version,
        claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration },
        cause: "recovery", now,
      });
      if (released.state !== "applied") throw new Error("fixture-worker-claim-release-unproved");
    }
  }
}

export function currentAtomicWriteFixture(input: unknown) {
  return AtomicWriteCommitInputSchema.parse(input);
}
