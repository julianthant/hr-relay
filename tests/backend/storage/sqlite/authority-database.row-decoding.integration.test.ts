import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it, vi } from "vitest";
import { createAuthorityAccountingTestWorld } from "../../../support/helpers/backend/authority-accounting-world.js";
import { LATER, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { nativeOrdinaryRecordFromRow } from "../../../../src/backend/storage/sqlite/native-record-row.js";

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

it("isolates native values shared by different readers in a read snapshot", async () => {
  const db = await world.openDatabase(), run = world.prepareRunning(db);
  const checkpoint = RunCheckpointRecordSchema.parse({ ...world.RUN_CHECKPOINT, runId: run.envelope.runId,
    workflowId: run.envelope.workflow, itemId: run.envelope.itemId, descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint });
  db.authority.runCheckpoints.insert(checkpoint);
  db.withAuthorityReadSnapshot(() => {
    const listed = db.authority.runs.listByItem({ workflow: run.envelope.workflow, itemId: run.envelope.itemId });
    assert.deepEqual(listed, [run]);
    const selected = listed[0]; assert.ok(selected);
    assert.equal(Reflect.set(selected.input.parsed, "value", { changed: true }), true);
    assert.deepEqual(db.authority.runs.get(run.envelope.runId), run);
    assert.deepEqual(db.authority.runs.listByItem({ workflow: run.envelope.workflow, itemId: run.envelope.itemId }), [run]);
    const checkpoints = db.authority.runCheckpoints.listByItem(checkpoint.workflowId, checkpoint.itemId);
    assert.deepEqual(checkpoints, [checkpoint]);
    const first = checkpoints[0]; assert.ok(first);
    assert.equal(Reflect.set(first.output, "value", { changed: true }), true);
    assert.deepEqual(db.authority.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId, 1, 1), checkpoint);
    assert.deepEqual(db.authority.runCheckpoints.listByItem(checkpoint.workflowId, checkpoint.itemId), [checkpoint]);
  });
});

it("refuses a different physical checkpoint digest within a read snapshot", async () => {
  const path = await world.databasePath(), db = await world.openDatabase(path), run = world.prepareRunning(db);
  const checkpoint = RunCheckpointRecordSchema.parse({ ...world.RUN_CHECKPOINT, runId: run.envelope.runId,
    workflowId: run.envelope.workflow, itemId: run.envelope.itemId, descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint });
  db.authority.runCheckpoints.insert(checkpoint);
  const raw = new DatabaseSync(path);
  try {
    const row = raw.prepare("SELECT * FROM run_checkpoints WHERE run_id=?").get(run.envelope.runId); assert.ok(row);
    db.withAuthorityReadSnapshot(() => {
      assert.deepEqual(nativeOrdinaryRecordFromRow("run_checkpoints", row), checkpoint);
      for (let index = 0; index < 2; index++) {
        assert.throws(() => nativeOrdinaryRecordFromRow("run_checkpoints", { ...row, output_digest: "0".repeat(64) }),
          /run_checkpoints-row-output_digest-mismatch/);
      }
      assert.deepEqual(nativeOrdinaryRecordFromRow("run_checkpoints", row), checkpoint);
    });
  } finally {
    raw.close();
  }
});

it("decodes each physical run once across readers and starts fresh in the next snapshot", async () => {
  const path = await world.databasePath(), db = await world.openDatabase(path), run = world.prepareRunning(db);
  const raw = new DatabaseSync(path);
  let row;
  try { row = raw.prepare("SELECT * FROM runs WHERE id=?").get(run.envelope.runId); }
  finally { raw.close(); }
  assert.ok(row && typeof row.envelope_json === "string" && typeof row.lifecycle_json === "string");
  const payloads = new Set([row.envelope_json, row.lifecycle_json]);
  const parse = JSON.parse;
  let parses = 0;
  const spy = vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
    if (payloads.has(text)) parses++;
    const value: unknown = parse(text, reviver); return value;
  });
  try {
    for (let snapshot = 0; snapshot < 2; snapshot++) db.withAuthorityReadSnapshot(() => {
      const before = parses;
      for (let reader = 0; reader < 2; reader++) {
        assert.deepEqual(db.authority.runs.listByItem({ workflow: run.envelope.workflow, itemId: run.envelope.itemId }), [run]);
        assert.deepEqual(db.authority.runs.get(run.envelope.runId), run);
      }
      assert.equal(parses - before, 2, "one envelope and one lifecycle decode per read snapshot");
    });
  } finally { spy.mockRestore(); }
});
