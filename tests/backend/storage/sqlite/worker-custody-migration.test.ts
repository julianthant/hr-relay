import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { commandFromRow } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS, WORKER_CUSTODY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { createSettingsActivationRepositories } from "../../../../src/backend/storage/sqlite/settings-activation.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema, deriveIdempotencyKeyDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { CONFIG_SNAPSHOT, HASH_B, NOW, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING, UUID_2, UUID_3, UUID_4, UUID_5, UUID_6, UUID_7, UUID_8 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID, TRACE_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { migrateWorkerCustody } from "../../../support/helpers/storage/worker-custody-migration.js";

const LIFETIME = { leaseGeneration: 2, membershipRevision: 1 };
const WORKER = "person-lookup-worker-1";

function store(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const migration of SQLITE_MIGRATIONS.filter(item => item.version < WORKER_CUSTODY_SCHEMA_VERSION)) for (const statement of migration.statements) database.exec(statement);
  const predecessor = WORKER_CUSTODY_SCHEMA_VERSION - 1;
  database.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA user_version=${String(predecessor)}`);
  database.prepare("INSERT INTO database_states VALUES(1,?,0,?,NULL,'unbuilt',?,?)").run(predecessor, NOW, UUID_2, UUID_3);
  createSettingsActivationRepositories({ database,
    mutate: work => work().result,
    readRecord(table, key, schema) {
      const row = database.prepare(`SELECT * FROM ${table} WHERE id=?`).get(key);
      return row === undefined ? undefined : schema.parse(table === "commands" ? commandFromRow(row) : JSON.parse(String(row.payload_json)));
    },
  }).runtimeConfig.initialize(CONFIG_SNAPSHOT);
  database.prepare("INSERT INTO worker_pools VALUES('person-lookup',1,1,'{}',?,?)").run(NOW, NOW);
  database.prepare("INSERT INTO worker_slots VALUES(?,'person-lookup',1,1,'idle',NULL,NULL,NULL,?,?,?)").run(WORKER, JSON.stringify({ poolIndex: 1 }), NOW, NOW);
  for (const [generation, directive] of [[1, "run"], [2, "pause"]] as const) {
    database.prepare("INSERT INTO worker_leases VALUES(?,?,'person-lookup',?,1,'idle',?,NULL,1,'{}',?,?)").run(`lease-${String(generation)}`, WORKER, generation, directive, NOW, NOW);
  }
  database.prepare("INSERT INTO auth_leases VALUES('ucpath',1,?,'ucpath','released',?,1,'{}',?)").run(WORKER, NOW, NOW);
  return database;
}

function run(envelope: object = {}, rest: object = {}): RunRecord {
  return RunRecordSchema.parse({ ...QUEUED_RUN, ...rest, envelope: { ...QUEUED_RUN.envelope, ...envelope } });
}
const claimed = (envelope: object = {}) => run(envelope, { lifecycle: { state: "claimed", workerId: WORKER, claimedAt: NOW, heartbeatAt: NOW }, claimGeneration: 1, version: 2 });
const unrelated = () => run({ runId: UUID_6, itemId: UUID_7, traceId: "pl-170001-6666" });

function insertRun(database: DatabaseSync, record: RunRecord): void {
  const stored = runRecordColumns(record, RunRecordSchema);
  // Schema 22 stored a claim's worker lifetime on its lifecycle; the current run grammar has none.
  const lifecycle = JSON.parse(String(stored.lifecycle_json)) as { lifecycle: Record<string, unknown> };
  const columns = record.lifecycle.state === "claimed" ? { ...stored, lifecycle_json: canonicalJsonStringify({ ...lifecycle, lifecycle: { ...lifecycle.lifecycle, workerLifetime: LIFETIME } }) } : stored;
  database.prepare(`INSERT INTO runs(${Object.keys(columns).join(",")}) VALUES(${Object.keys(columns).map(() => "?").join(",")})`).run(...Object.values(columns));
}

function insertCommand(database: DatabaseSync, id: string, family: string, request: object, targetId: string | null = null): void {
  const json = canonicalJsonStringify(request);
  database.prepare("INSERT INTO commands VALUES(?,?,'local-operator',NULL,?,?,?,'succeeded',?,?,?)").run(id, family, targetId, "a".repeat(64), json, json, NOW, NOW);
  database.prepare("INSERT INTO command_audits VALUES(?,?,NULL,?,?)").run(id, id, canonicalJsonStringify({ request }), NOW);
}

const migrate = (database: DatabaseSync) => migrateWorkerCustody(database, NOW);

const PROOF = { schemaHash: HASH_B, value: "T123456" };
type WriteShape = { intentId: string; attemptId: string; runId: string; key: string; status: "committed" | "observed-present" | "attempting" | "parked";
  attempt?: "committed" | "attempting" | "parked" | "none"; resolution?: string };

function insertWrite(database: DatabaseSync, write: WriteShape): void {
  const identity = { writeIntentId: write.intentId, currentAttemptId: write.attemptId, runId: write.runId, idempotencyKey: write.key,
    idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", write.key) };
  const { currentAttemptId: _attempt, runAttempt: _runAttempt, bindingProof: _proof, bindingProofDigest: _digest, fencedAt: _fenced, status: _status, runId: _runId, ...observed } = { ...WRITE_INTENT_ATTEMPTING, ...identity };
  const resolution = write.resolution === undefined ? {} : { resolution: { commandId: write.resolution, auditId: write.resolution, writeIntentId: write.intentId,
    writeAttemptId: write.attemptId, generation: 1, bindingProofDigest: WRITE_INTENT_ATTEMPTING.bindingProofDigest, idempotencyKeyDigest: identity.idempotencyKeyDigest,
    runId: write.runId, runAttempt: 1, expectedRunVersion: 1, decision: "present", resolvedAt: NOW } };
  const intent = WriteIntentRecordSchema.parse(write.status === "observed-present" ? { ...observed, status: "observed-present", observedProof: PROOF, observedAt: NOW }
    : write.status === "committed" ? { ...WRITE_INTENT_ATTEMPTING, ...identity, status: "committed", completionProof: PROOF, confirmedAt: NOW, ...resolution }
    : write.status === "parked" ? { ...WRITE_INTENT_ATTEMPTING, ...identity, status: "parked", parkedCode: "unknown", message: "Outcome unknown.", authorityReason: "outcome-unknown" }
    : { ...WRITE_INTENT_ATTEMPTING, ...identity });
  database.prepare("INSERT INTO write_intents VALUES(?,?,?,?,?,?,?,?,NULL,?,?)").run(write.intentId, "ucpath", write.key, identity.idempotencyKeyDigest,
    intent.status, 1, intent.status === "observed-present" ? null : write.runId, canonicalJsonStringify(intent), NOW, NOW);
  const state = write.attempt ?? (write.status === "observed-present" ? "none" : write.status === "committed" ? "committed" : write.status);
  if (state === "none") return;
  const outcome = state === "committed" ? { state, completionProof: PROOF, confirmedAt: NOW }
    : state === "parked" ? { state, code: "outcome-unknown", message: "Outcome unknown.", authorityReason: "outcome-unknown" } : { state };
  const attempt = WriteAttemptRecordSchema.parse({ ...WRITE_ATTEMPT, writeAttemptId: write.attemptId, writeIntentId: write.intentId, runId: write.runId, outcome });
  database.prepare("INSERT INTO write_attempts VALUES(?,?,1,?,?,?)").run(write.attemptId, write.intentId, write.runId, canonicalJsonStringify(attempt), NOW);
}

const count = (database: DatabaseSync, sql: string) => Number(database.prepare(sql).get()?.count);
const triggers = (database: DatabaseSync) => database.prepare("SELECT name, sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();
const dump = (database: DatabaseSync) => ["runs", "commands", "command_audits", "worker_slots", "worker_leases", "write_intents", "deleted_runs"]
  .map(table => database.prepare(`SELECT * FROM ${table}`).all());

it("deletes the worker-lifetime closure and worker history and keeps unrelated runs byte-identical", () => {
  const database = store();
  try {
    const parent = claimed(), child = run({ runId: UUID_4, itemId: UUID_5, traceId: "pl-170001-4444", parent: { runId: RUN_ID, tracePrefix: TRACE_ID, edgeId: "child-edge" } });
    insertRun(database, parent); insertRun(database, child); insertRun(database, unrelated());
    insertCommand(database, UUID_8, "run-lifecycle", { kind: "run-lifecycle", operation: "claim-next", request: { workflow: "person-lookup", workerId: WORKER, workerLifetime: LIFETIME } });
    insertCommand(database, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "worker-browser", { family: "worker-browser", type: "pause-worker", target: { workerId: WORKER, membershipRevision: 1 } });
    insertCommand(database, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "run-lifecycle", { kind: "run-lifecycle", operation: "worker-admission", request: {} });
    const kept = database.prepare("SELECT * FROM runs WHERE id=?").get(UUID_6);
    const before = triggers(database).filter(row => !String(row.name).startsWith("worker_") && !String(row.name).startsWith("browser_"));
    migrate(database);
    assert.deepEqual(database.prepare("SELECT id FROM runs").all().map(row => row.id), [UUID_6]);
    assert.deepEqual(database.prepare("SELECT * FROM runs WHERE id=?").get(UUID_6), kept);
    assert.deepEqual(database.prepare("SELECT run_id FROM deleted_runs ORDER BY run_id").all().map(row => row.run_id), [RUN_ID, UUID_4].sort());
    assert.equal(count(database, "SELECT count(*) AS count FROM commands WHERE family='worker-browser' OR request_json LIKE '%workerLifetime%' OR request_json LIKE '%worker-admission%'"), 0);
    assert.equal(count(database, "SELECT count(*) AS count FROM command_audits WHERE command_id NOT IN (SELECT id FROM commands)"), 0);
    assert.deepEqual(triggers(database).filter(row => !String(row.name).startsWith("worker_")), before);
    assert.deepEqual(database.prepare("SELECT id, pool_index, paused, retired_at FROM worker_slots").all().map(row => ({ ...row })), [{ id: WORKER, pool_index: 1, paused: 1, retired_at: null }]);
    assert.equal(count(database, "SELECT count(*) AS count FROM sqlite_schema WHERE name IN ('worker_leases','worker_controls','browser_sessions')"), 0);
    assert.deepEqual(database.prepare("SELECT holder_worker_id FROM auth_leases").all().map(row => row.holder_worker_id), [WORKER]);
    assert.throws(() => database.exec("DELETE FROM command_audits"), /retained-evidence-required/u);
    assert.throws(() => database.exec("UPDATE worker_slots SET pool_index=2"), /worker-slot-identity-immutable/u);
  } finally { database.close(); }
});

it("changes only the worker tables on a store with no worker-lifetime history", () => {
  const database = store();
  try {
    insertRun(database, unrelated());
    const before = database.prepare("SELECT * FROM runs").all();
    migrate(database);
    assert.deepEqual(database.prepare("SELECT * FROM runs").all(), before);
    assert.equal(count(database, "SELECT count(*) AS count FROM deleted_runs"), 0);
  } finally { database.close(); }
});

it("refuses a closure run whose write is not committed and proven, and leaves the store unchanged", () => {
  const cases: Omit<WriteShape, "intentId" | "attemptId" | "runId" | "key">[] = [
    { status: "observed-present" }, { status: "attempting" }, { status: "parked" }, { status: "committed", attempt: "parked" }, { status: "committed", attempt: "attempting" },
  ];
  for (const shape of cases) {
    const database = store();
    try {
      insertRun(database, claimed());
      insertWrite(database, { ...shape, intentId: UUID_7, attemptId: UUID_8, runId: RUN_ID, key: "10101010|termination|2026-08-01" });
      const before = dump(database);
      assert.throws(() => migrate(database), /authority-upgrade-unresolved-writes/u, JSON.stringify(shape));
      assert.deepEqual(dump(database), before);
    } finally { database.close(); }
  }
});

