import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { createAuthorityAccountingTestWorld } from "../../../support/helpers/backend/authority-accounting-world.js";
import { LATER, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";

const world = createAuthorityAccountingTestWorld();
afterEach(world.cleanup);

it("reads native writes within one transaction and isolates returned run and checkpoint values", async () => {
  const db = await world.openDatabase(), run = world.prepareRunning(db);
  const checkpoint = RunCheckpointRecordSchema.parse({ ...world.RUN_CHECKPOINT, runId: run.envelope.runId,
    workflowId: run.envelope.workflow, itemId: run.envelope.itemId, descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint });
  db.withAuthorityTransaction(repositories => {
    const first = repositories.runs.get(run.envelope.runId); assert.ok(first);
    const second = repositories.runs.get(run.envelope.runId); assert.deepEqual(second, first); assert.notEqual(second, first);
    assert.ok(second);
    assert.equal(Object.isFrozen(first), false);
    assert.equal(Object.isFrozen(second), false);
    assert.equal(Reflect.set(first, "displayName", "Changed returned copy"), true);
    Reflect.set(first.input.parsed, "value", { changed: true });
    assert.deepEqual(repositories.runs.get(run.envelope.runId), run);
    const claim = runClaim(run); assert.ok(claim);
    assert.equal(repositories.runs.renewClaim({ runId: run.envelope.runId, claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, now: LATER }).state, "renewed");
    const current = repositories.runs.get(run.envelope.runId); assert.ok(current);
    assert.equal(current.version, run.version + 1);
    assert.equal(runClaim(current)?.heartbeatAt, LATER);
    assert.equal(repositories.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId, 1, 1), undefined);
    assert.equal(repositories.runCheckpoints.insert(checkpoint).state, "inserted");
    const stored = repositories.runCheckpoints.listByAttempt(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId, 1)[0];
    assert.deepEqual(stored, checkpoint); assert.ok(stored);
    assert.equal(Object.isFrozen(stored), false);
    assert.equal(Reflect.set(stored, "writtenAt", LATER), true);
    Reflect.set(stored.output, "value", { changed: true });
    assert.deepEqual(repositories.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId, 1, 1), checkpoint);
    assert.deepEqual(repositories.runCheckpoints.latest(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId), checkpoint);
  });
});

it("restores native run truth after nested rollback and clears outer rollback values", async () => {
  const db = await world.openDatabase(), run = world.prepareRunning(db), claim = runClaim(run); assert.ok(claim);
  const readCurrent = (runs: typeof db.authority.runs) => { const current = runs.get(run.envelope.runId); assert.ok(current); return current; };
  const rollback = new Error("row-decoding-test-rollback");
  assert.throws(() => db.withAuthorityTransaction(repositories => {
    assert.deepEqual(repositories.runs.get(run.envelope.runId), run);
    assert.throws(() => db.withAuthorityTransaction(inner => {
      assert.equal(inner.runs.renewClaim({ runId: run.envelope.runId, claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, now: LATER }).state, "renewed");
      assert.equal(runClaim(readCurrent(inner.runs))?.heartbeatAt, LATER);
      throw rollback;
    }), error => error === rollback);
    assert.deepEqual(repositories.runs.get(run.envelope.runId), run);
    assert.equal(repositories.runs.renewClaim({ runId: run.envelope.runId, claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, now: LATER }).state, "renewed");
    assert.equal(runClaim(readCurrent(repositories.runs))?.heartbeatAt, LATER);
    throw rollback;
  }), error => error === rollback);
  assert.deepEqual(db.withAuthorityReadSnapshot(() => db.authority.runs.get(run.envelope.runId)), run);
});

it("keeps an existing SQL snapshot and sees a native peer commit in the next operation", async () => {
  const path = await world.databasePath(), reader = await world.openDatabase(path), run = world.prepareRunning(reader);
  const writer = await world.openDatabase(path), claim = runClaim(run); assert.ok(claim);
  reader.withAuthorityReadSnapshot(() => {
    assert.deepEqual(reader.authority.runs.get(run.envelope.runId), run);
    assert.equal(writer.authority.runs.renewClaim({ runId: run.envelope.runId, claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, now: LATER }).state, "renewed");
    const retained = reader.authority.runs.get(run.envelope.runId); assert.ok(retained);
    assert.equal(runClaim(retained)?.heartbeatAt, NOW);
  });
  const current = reader.withAuthorityReadSnapshot(() => reader.authority.runs.get(run.envelope.runId)); assert.ok(current);
  assert.equal(current.version, run.version + 1);
  assert.equal(runClaim(current)?.heartbeatAt, LATER);
});

it("refuses a changed physical scalar even when the previously decoded run payload is unchanged", async () => {
  const path = await world.databasePath(), db = await world.openDatabase(path), run = world.prepareRunning(db);
  db.withAuthorityReadSnapshot(() => assert.deepEqual(db.authority.runs.get(run.envelope.runId), run));
  const raw = new DatabaseSync(path);
  try {
    raw.prepare("UPDATE runs SET version=version+1 WHERE id=?").run(run.envelope.runId);
    db.withAuthorityReadSnapshot(() => {
      assert.throws(() => db.authority.runs.get(run.envelope.runId), /version.*whole-record JSON/);
      assert.throws(() => db.authority.runs.get(run.envelope.runId), /version.*whole-record JSON/);
    });
  } finally {
    raw.prepare("UPDATE runs SET version=? WHERE id=?").run(run.version, run.envelope.runId);
    raw.close();
  }
});
