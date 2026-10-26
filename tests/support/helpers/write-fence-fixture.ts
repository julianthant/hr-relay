import { retainAuthoritySourceClosure } from "../../../src/backend/storage/source-closure.js";
import { testWorkerLifetime } from '../fixtures/run-lifecycle-fixtures.js';
import { boundProfileAdmission } from "./admission-fixture.js";
import assert from "node:assert/strict";
import type { DatabaseSync as DatabaseSyncInstance } from "node:sqlite";
import { WriteFenceRecordsSchema } from "../../../src/backend/storage/sqlite/write-commit-contracts.js";
import { deriveIdempotencyKeyDigest } from "../../../src/rules/write-safety/write-safety.js";
import { runClaim } from "../../../src/models/run/record.js";
import { ATOMIC_WRITE_COMMIT } from "../fixtures/phase1c-contract-fixtures.js";
import { seedAtomicWriteOwner } from "./timeline-write-fixture.js";
import { syntheticDatabasePath, type AuthorityDatabase } from "./synthetic-database-admission.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";

export function writeFenceFixtureInput(database: AuthorityDatabase, input: unknown, path?: string) {
  const databasePath = syntheticDatabasePath(database);
  if (path !== undefined) assert.equal(path, databasePath);
  boundProfileAdmission(databasePath);
  const fence = WriteFenceRecordsSchema.parse(input);
  const { intent } = fence;
  if (intent.status !== "attempting") throw new Error("fixture intent is not attempting");
  const identity = { runId: intent.runId, workflowId: intent.workflowId, itemId: intent.itemId,
    attempt: intent.runAttempt, system: intent.system,
    idempotencyKeyDigest: deriveIdempotencyKeyDigest(intent.system, ATOMIC_WRITE_COMMIT.transaction.idempotencyKey) };
  const outcome = { ...ATOMIC_WRITE_COMMIT.outcome, confirmedAt: intent.fencedAt };
  if (database.authority.runs.get(intent.runId) === undefined) seedAtomicWriteOwner(database, { ...ATOMIC_WRITE_COMMIT, confirmedAt: intent.fencedAt, outcome,
    transaction: { ...ATOMIC_WRITE_COMMIT.transaction, ...identity, fencedAt: intent.fencedAt, confirmedAt: intent.fencedAt },
    committedSpan: { ...ATOMIC_WRITE_COMMIT.committedSpan, ...identity, occurredAt: intent.fencedAt, outcome },
  }, databasePath, 3);
  let run = database.authority.runs.get(intent.runId);
  assert.ok(run);
  if (run.lifecycle.state === "queued") {
    const worker = database.authority.workerSlots.list(run.envelope.workflow).find(slot => slot.retiredAt === null
      && !database.authority.runs.listByWorker(slot.workerId).some(owned => runClaim(owned) !== undefined));
    assert.ok(worker);
    const lifetime = testWorkerLifetime(database, run.envelope.workflow, worker.poolIndex);
    assert.equal(lifetime.workerId, worker.workerId);
    const claimed = database.authority.runs.claimNext({ workflow: run.envelope.workflow,
      workerId: worker.workerId, now: intent.fencedAt, workerLifetime: lifetime.workerLifetime });
    assert.equal(claimed.state, "claimed");
    if (claimed.state !== "claimed") throw new Error("fixture claim failed");
    assert.equal(claimed.run.envelope.runId, intent.runId);
    run = claimed.run;
  }
  const held = runClaim(run);
  assert.ok(held);
  const claim = { workerId: held.workerId, claimGeneration: held.claimGeneration };
  if (run.lifecycle.state === "claimed") {
    const transition = database.authority.runs.transition({ runId: intent.runId, expectedVersion: run.version,
      claim, lifecycle: { ...run.lifecycle, state: "validating" }, now: intent.fencedAt });
    assert.equal(transition.state, "applied");
    run = database.authority.runs.get(intent.runId);
    assert.ok(run);
  }
  if (run.lifecycle.state === "validating") {
    assert.equal(database.authority.runs.transition({ runId: intent.runId, expectedVersion: run.version,
      claim, lifecycle: { ...run.lifecycle, state: "running" }, now: intent.fencedAt }).state, "applied");
  }
  return { ...fence, claim };
}

export function fenceWriteFixture(database: AuthorityDatabase, input: unknown, path?: string) {
  const result = database.withAuthorityTransaction(() =>
    database.authority.writeIntents.fenceAttempt(writeFenceFixtureInput(database, input, path)));
  if (result.state === "refused") throw new Error(`fixture fence refused: ${result.refusal.reason}`);
  return result;
}

export function seedCorruptWriteFenceFixture(database: AuthorityDatabase, input: unknown,
  DatabaseSync: new (location: string) => DatabaseSyncInstance): void {
  const { intent, attempt } = WriteFenceRecordsSchema.parse(input);
  if (intent.status !== "attempting") throw new Error("corruption fixture intent is not attempting");
  const databasePath = syntheticDatabasePath(database);
  const admission = boundProfileAdmission(databasePath);
  const raw = new DatabaseSync(databasePath);
  let primary: { error: unknown } | undefined;
  try {
    raw.prepare(`INSERT INTO write_intents (id, system, idempotency_key, idempotency_key_digest, status,
      generation, run_id, payload_json, publication_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .run(intent.writeIntentId, intent.system, intent.idempotencyKey, intent.idempotencyKeyDigest, intent.status,
        intent.generation, intent.runId, canonicalJsonStringify(intent), intent.createdAt, intent.updatedAt);
    raw.prepare(`INSERT INTO write_attempts (id, intent_id, generation, run_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(attempt.writeAttemptId, attempt.writeIntentId,
        attempt.generation, attempt.runId, canonicalJsonStringify(attempt), attempt.recordedAt);
  } catch (error) { primary = { error }; }
  let closeFailure: { error: unknown } | undefined;
  try { raw.close(); } catch (error) { closeFailure = { error }; }
  if (closeFailure !== undefined) throw retainAuthoritySourceClosure(primary === undefined ? [closeFailure.error] : [primary.error, closeFailure.error], { admission: { admission, database, raw } });
  if (primary !== undefined) throw primary.error;
}
