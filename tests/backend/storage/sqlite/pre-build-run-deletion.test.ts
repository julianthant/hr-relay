import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { currentBuildId } from "../../../../src/backend/app/build-id.js";
import { assertTerminalEvidenceOwner, inspectNativeAuthority, inspectNormalAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { commandFromRow } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { AUTHORITY_APPLICATION_ID, BUILD_ID_ENVELOPE_SCHEMA_VERSION, CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { prepareNativeRunDeletion } from "../../../../src/backend/storage/sqlite/native-run-deletion.js";
import { deletePreBuildRuns, requireSettledPreBuildRun, settlePreBuildRun } from "../../../../src/backend/storage/sqlite/pre-build-run-deletion.js";
import { predecessorRunRecordFromRow, runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { createSettingsActivationRepositories } from "../../../../src/backend/storage/sqlite/settings-activation.js";
import { RunDeleteInputSchema } from "../../../../src/models/run/deleted-run.js";
import { PredecessorRunRecordSchema, RunRecordSchema, type PredecessorRunRecord } from "../../../../src/models/run/record.js";
import { CONFIG_SNAPSHOT, NOW, UUID_2, UUID_3, UUID_4, UUID_5 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, TRACE_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";

const SHAPE_VERSION = BUILD_ID_ENVELOPE_SCHEMA_VERSION - 1;

function store(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const migration of SQLITE_MIGRATIONS.filter(row => row.version < BUILD_ID_ENVELOPE_SCHEMA_VERSION)) {
    for (const statement of migration.statements) database.exec(statement);
  }
  database.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA user_version=${String(SHAPE_VERSION)}`);
  database.prepare("INSERT INTO database_states VALUES(1,?,0,?,NULL,'unbuilt',?,?)").run(SHAPE_VERSION, NOW, UUID_2, UUID_3);
  createSettingsActivationRepositories({ database,
    mutate: work => work().result,
    readRecord(table, key, schema) {
      const row = database.prepare(`SELECT * FROM ${table} WHERE id=?`).get(key);
      return row === undefined ? undefined : schema.parse(table === "commands" ? commandFromRow(row) : JSON.parse(String(row.payload_json)));
    },
  }).runtimeConfig.initialize(CONFIG_SNAPSHOT);
  return database;
}

function predecessor(envelope: object = {}, rest: object = {}): PredecessorRunRecord {
  const { buildId: _omit, ...base } = QUEUED_RUN.envelope;
  return PredecessorRunRecordSchema.parse({ ...QUEUED_RUN, ...rest, envelope: { ...base, ...envelope } });
}

function insertRuns(database: DatabaseSync, runs: readonly PredecessorRunRecord[]): void {
  const pending = [...runs];
  while (pending.length > 0) {
    const index = pending.findIndex(run => run.envelope.parent === undefined || pending.every(other => other.envelope.runId !== run.envelope.parent?.runId));
    const run = pending.splice(index, 1)[0];
    if (run === undefined) throw new Error("predecessor run insert stalled");
    const columns = runRecordColumns(run, PredecessorRunRecordSchema);
    database.prepare(`INSERT INTO runs(${Object.keys(columns).join(",")}) VALUES(${Object.keys(columns).map(() => "?").join(",")})`).run(...Object.values(columns));
  }
}

function owner(database: DatabaseSync) {
  return (record: Parameters<typeof assertTerminalEvidenceOwner>[1], run: PredecessorRunRecord) => {
    assertTerminalEvidenceOwner(database, record, predecessorRunRecordFromRow, run, new Set(), SHAPE_VERSION);
  };
}

function upgrade(database: DatabaseSync): void {
  database.exec("BEGIN EXCLUSIVE");
  deletePreBuildRuns(database, NOW, () => { throw new Error("artifact-unexpected"); }, owner(database));
  database.prepare("UPDATE database_states SET schema_version=?").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
  database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
  database.exec("COMMIT");
  assert.equal(inspectNormalAuthority(database).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
}

function doors(database: DatabaseSync): { operation: string; runId: string }[] {
  return database.prepare(`SELECT json_extract(request_json,'$.operation') AS operation, json_extract(request_json,'$.request.runId') AS runId
    FROM commands WHERE family='run-lifecycle' AND json_extract(request_json,'$.operation') IN ('transition','terminalize') ORDER BY created_at, id`).all() as { operation: string; runId: string }[];
}

function child(parent: PredecessorRunRecord): PredecessorRunRecord {
  return predecessor({ runId: UUID_4, itemId: UUID_5, traceId: "pl-170001-4444", parent: { runId: parent.envelope.runId, tracePrefix: TRACE_ID, edgeId: "child-edge" } });
}

it("deletes a predecessor queued run through the cancel door without inserting a build id", () => {
  const database = store();
  try {
    insertRuns(database, [predecessor()]);
    const settings = database.prepare("SELECT payload_json FROM settings").get();
    assert.equal(inspectNativeAuthority(database, SHAPE_VERSION).schemaVersion, SHAPE_VERSION);
    assert.throws(() => prepareNativeRunDeletion(database, predecessorRunRecordFromRow(database.prepare("SELECT * FROM runs").get()), RunDeleteInputSchema.parse({
      runId: RUN_ID, origin: "storage", commandId: randomUUID(), now: NOW, cascadeRunIds: [RUN_ID],
    }), () => { throw new Error("artifact-unexpected"); }, "execution", SHAPE_VERSION), /terminal-run-tombstone-required/);
    database.exec("BEGIN EXCLUSIVE");
    requireSettledPreBuildRun(database, RUN_ID, NOW, owner(database));
    const terminal = PredecessorRunRecordSchema.parse(JSON.parse(String(database.prepare("SELECT terminal_run_json FROM run_results").get()?.terminal_run_json)));
    assert.equal("buildId" in terminal.envelope, false);
    assert.equal(inspectNativeAuthority(database, SHAPE_VERSION).schemaVersion, SHAPE_VERSION);
    deletePreBuildRuns(database, NOW, () => { throw new Error("artifact-unexpected"); }, owner(database));
    database.prepare("UPDATE database_states SET schema_version=?").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
    database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
    database.exec("COMMIT");
    assert.equal(inspectNormalAuthority(database).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(database.prepare("SELECT count(*) AS count FROM runs").get()?.count, 0);
    assert.equal(database.prepare("SELECT count(*) AS count FROM deleted_runs WHERE cleanup_state='pending'").get()?.count, 1);
    assert.deepEqual(database.prepare("SELECT payload_json FROM settings").get(), settings);
    assert.equal(JSON.stringify(database.prepare("SELECT * FROM commands").all()).includes("\"buildId\""), false);
    assert.equal(doors(database).some(door => door.operation === "transition" && door.runId === RUN_ID), true);
  } finally { database.close(); }
});

it("settles each non-terminal predecessor by its own door, including an independent child", () => {
  const paused = predecessor({}, { pause: { state: "paused", commandId: UUID_4, requestedAt: NOW, pausedAt: NOW } });
  const parked = predecessor({}, { lifecycle: { state: "parked-gate", gateId: "manual-gate", parkedAt: NOW, resumeAt: "resume-node" } });
  const waiting = predecessor({}, { delegationRefresh: { commandId: UUID_4, nodeId: "refresh-node", phase: "waiting", retryCommandIds: [UUID_5] } });
  assert.equal(waiting.delegationRefresh?.phase, "waiting");
  const parent = predecessor({}, { lifecycle: { state: "claimed", workerId: "worker-1", claimedAt: NOW, heartbeatAt: NOW }, claimGeneration: 1 });
  const cases = [
    [predecessor()],
    [parked],
    [paused],
    [parent, child(parent)],
    [predecessor(), child(predecessor())],
  ];
  for (const runs of cases) {
    const database = store();
    try {
      insertRuns(database, runs);
      upgrade(database);
      const settled = doors(database);
      for (const run of runs) {
        const own = settled.filter(door => door.runId === run.envelope.runId);
        const door = run.lifecycle.state === "claimed" || run.lifecycle.state === "validating" || run.lifecycle.state === "running" ? "terminalize" : "transition";
        assert.equal(own.some(row => row.operation === door), true);
      }
      assert.equal(database.prepare("SELECT count(*) AS count FROM deleted_runs").get()?.count, runs.length);
    } finally { database.close(); }
  }
});

it("throws a returned refusal inside the upgrade transaction and leaves the version", () => {
  const database = store();
  try {
    const parent = predecessor();
    insertRuns(database, [parent, child(parent)]);
    const before = database.prepare("SELECT count(*) AS count FROM commands").get()?.count;
    database.exec("BEGIN EXCLUSIVE");
    assert.equal(settlePreBuildRun(database, RUN_ID, NOW, owner(database)).state, "refused");
    assert.throws(() => requireSettledPreBuildRun(database, RUN_ID, NOW, owner(database)), /authority-upgrade-run-settlement-refused/);
    database.exec("ROLLBACK");
    assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, SHAPE_VERSION);
    assert.equal(database.prepare("SELECT count(*) AS count FROM runs").get()?.count, 2);
    assert.equal(database.prepare("SELECT count(*) AS count FROM commands").get()?.count, before);
    assert.equal(database.prepare("SELECT count(*) AS count FROM deleted_runs").get()?.count, 0);
  } finally { database.close(); }
});

it("refuses an unresolved write or a parked-write run before any cancel", () => {
  for (const status of ["attempting", "parked", "retryable", "observed-present"]) {
    const database = store();
    try {
      insertRuns(database, [predecessor()]);
      database.prepare("INSERT INTO write_intents(id,system,idempotency_key,idempotency_key_digest,status,generation,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .run(UUID_4, "ucpath", `key-${status}`, "b".repeat(64), status, 1, "{}", NOW, NOW);
      const before = database.prepare("SELECT * FROM write_intents").all();
      database.exec("BEGIN EXCLUSIVE");
      assert.throws(() => deletePreBuildRuns(database, NOW, () => { throw new Error("artifact-unexpected"); }, owner(database)), /authority-upgrade-unresolved-writes/);
      database.exec("ROLLBACK");
      assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, SHAPE_VERSION);
      assert.deepEqual(database.prepare("SELECT * FROM write_intents").all(), before);
      assert.equal(doors(database).length, 0);
    } finally { database.close(); }
  }
  const parked = store();
  try {
    insertRuns(parked, [predecessor({}, { lifecycle: { state: "parked-write", writeIntentId: UUID_4, intentGeneration: 1, parkedAt: NOW, code: "unknown", message: "missing intent" } })]);
    parked.exec("BEGIN EXCLUSIVE");
    assert.throws(() => deletePreBuildRuns(parked, NOW, () => { throw new Error("artifact-unexpected"); }, owner(parked)), /authority-upgrade-unresolved-writes/);
    parked.exec("ROLLBACK");
    assert.equal(parked.prepare("SELECT count(*) AS count FROM runs").get()?.count, 1);
    assert.equal(parked.prepare("PRAGMA user_version").get()?.user_version, SHAPE_VERSION);
  } finally { parked.close(); }
});

it("creates a current store with no migration and requires a build id on a new run", () => {
  const database = new DatabaseSync(":memory:");
  try {
    for (const migration of SQLITE_MIGRATIONS) for (const statement of migration.statements) database.exec(statement);
    assert.equal(database.prepare("SELECT count(*) AS count FROM runs").get()?.count, 0);
    assert.equal(QUEUED_RUN.envelope.buildId, currentBuildId());
    const { buildId: _omit, ...envelope } = QUEUED_RUN.envelope;
    assert.equal(PredecessorRunRecordSchema.safeParse({ ...QUEUED_RUN, envelope }).success, true);
    assert.equal(RunRecordSchema.safeParse({ ...QUEUED_RUN, envelope }).success, false);
  } finally { database.close(); }
});
