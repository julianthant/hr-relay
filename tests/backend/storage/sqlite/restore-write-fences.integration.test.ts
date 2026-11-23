import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import {
  captureRestoreWriteFenceProof,
  readRestoreWriteFences,
  readUnresolvedRestoreWrites,
} from "../../../../src/backend/storage/sqlite/restore-write-fences.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { UUID_5, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const capture = (database: DatabaseSync) => captureRestoreWriteFenceProof(read => read(database));

function authority(resultKey: "id" | "run_id" = "id") {
  const database = new DatabaseSync(":memory:");
  for (const table of ["settings_snapshots", "run_batches", "run_requests", "run_delegations", "delegation_dependencies",
    "diagnostic_snapshots", "diagnostic_files", "run_checkpoints", "gate_results", "run_failures", "run_receipts", "commands", "command_audits"]) {
    database.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY, payload_json TEXT NOT NULL) STRICT`);
  }
  database.exec(`
    CREATE TABLE deleted_runs(run_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL) STRICT;
    CREATE TABLE write_intents(id TEXT PRIMARY KEY, status TEXT NOT NULL, generation INTEGER NOT NULL, run_id TEXT, payload_json TEXT NOT NULL) STRICT;
    CREATE TABLE write_attempts(id TEXT PRIMARY KEY, intent_id TEXT NOT NULL, generation INTEGER NOT NULL, run_id TEXT NOT NULL, payload_json TEXT NOT NULL) STRICT;
    CREATE TABLE runs(id TEXT PRIMARY KEY, state TEXT NOT NULL, lifecycle_json TEXT NOT NULL) STRICT;
    CREATE TABLE artifacts(id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload_json TEXT NOT NULL) STRICT;
    CREATE TABLE timeline_events(cursor INTEGER PRIMARY KEY, operation_id TEXT, payload_json TEXT NOT NULL) STRICT;
    CREATE TABLE run_results(${resultKey} TEXT PRIMARY KEY, payload_json TEXT NOT NULL) STRICT;
  `);
  return database;
}

function retainEvidence(db: DatabaseSync) {
  db.prepare("INSERT INTO deleted_runs VALUES (?,?)").run("tombstone", "{ }");
  db.prepare("INSERT INTO run_results VALUES (?,?)").run("run", '{"result":"retained"}');
  db.prepare("INSERT INTO timeline_events VALUES (?,NULL,?)").run(12, "{}");
  db.prepare("INSERT INTO timeline_events VALUES (?,NULL,?)").run(2, "{}");
  const command = db.prepare("INSERT INTO commands VALUES (?,?)");
  command.run("\uE000", '{"text":"synthetic"}');
  command.run("\u{10000}", '{"text":"synthetic"}');
}

function holdLease(db: DatabaseSync) {
  db.exec(`CREATE TABLE exclusive_session_leases(id TEXT PRIMARY KEY, generation INTEGER, worker_id TEXT,
    worker_lease_generation INTEGER, session_id TEXT, acquired_at TEXT, released_at TEXT) STRICT`);
  db.prepare("INSERT INTO exclusive_session_leases VALUES(?,?,?,?,?,?,NULL)").run(
    "a".repeat(64), 1, "onbase-worker-1", 1, "11111111-1111-4111-8111-111111111111", "2026-11-02T12:00:00.000Z");
}

it.each(["id", "run_id"] as const)("preserves the journal digest and compares exact rows for a result table keyed by %s", key => {
  using original = authority(key);
  using candidate = authority(key);
  retainEvidence(original);
  retainEvidence(candidate);
  candidate.prepare("INSERT INTO timeline_events VALUES (?,NULL,?)").run(3, "{}");
  original.exec("PRAGMA query_only=ON; BEGIN");
  candidate.exec("PRAGMA query_only=ON; BEGIN");
  const digest = sha256Hex(canonicalJsonStringify(readRestoreWriteFences(original)));
  using proof = capture(original);
  assert.equal(proof.digest, digest);
  assert.doesNotThrow(() => proof.assertPreservedBy(candidate));
  assert.doesNotThrow(() => proof.assertCurrent(original));
  assert.throws(() => proof.assertCurrent(candidate), /restore-write-fences-changed/u);
  original.exec("ROLLBACK; PRAGMA query_only=OFF");
  candidate.exec("ROLLBACK; PRAGMA query_only=OFF");
  candidate.exec(`UPDATE run_results SET payload_json='{}' WHERE ${key}='run'`);
  assert.throws(() => proof.assertPreservedBy(candidate), /restore-would-weaken-write-evidence:run_results/u);
  original.exec("INSERT INTO commands VALUES ('changed','{}')");
  assert.throws(() => proof.assertCurrent(original), /restore-write-fences-changed/u);
});

it("retains only held leases and refuses a candidate that lost the lease table", () => {
  using original = authority();
  using candidate = authority();
  using empty = capture(original);
  assert.equal(empty.digest, sha256Hex(canonicalJsonStringify(readRestoreWriteFences(original))));
  holdLease(original);
  using proof = capture(original);
  assert.equal(proof.digest, sha256Hex(canonicalJsonStringify(readRestoreWriteFences(original))));
  assert.throws(() => proof.assertPreservedBy(candidate), /restore-would-weaken-write-evidence:exclusive_session_leases/u);
  holdLease(candidate);
  assert.doesNotThrow(() => proof.assertPreservedBy(candidate));
  candidate.exec("UPDATE exclusive_session_leases SET released_at = acquired_at");
  assert.throws(() => proof.assertPreservedBy(candidate), /restore-would-weaken-write-evidence:exclusive_session_leases/u);
});

it("refuses losing an unresolved write even when the candidate has no evidence comparison rows", () => {
  using original = authority();
  using candidate = authority();
  const intent = WRITE_INTENT_ATTEMPTING;
  original.prepare("INSERT INTO write_intents VALUES (?,?,?,?,?)").run(
    intent.writeIntentId, intent.status, intent.generation, intent.runId, JSON.stringify(intent));
  using proof = capture(original);
  assert.equal(proof.digest, sha256Hex(canonicalJsonStringify(readRestoreWriteFences(original))));
  assert.throws(() => proof.assertPreservedBy(candidate), /restore-would-lose-unresolved-write/u);
});

it("accepts additional unresolved writes but refuses weakened intent, attempt and artifact evidence", () => {
  using original = authority();
  using candidate = authority();
  const intent = WRITE_INTENT_ATTEMPTING;
  const attempt = WRITE_ATTEMPT;
  for (const db of [original, candidate]) {
    db.prepare("INSERT INTO write_intents VALUES (?,?,?,?,?)").run(
      intent.writeIntentId, intent.status, intent.generation, intent.runId, JSON.stringify(intent));
    db.prepare("INSERT INTO write_attempts VALUES (?,?,?,?,?)").run(
      attempt.writeAttemptId, attempt.writeIntentId, attempt.generation, attempt.runId, JSON.stringify(attempt));
    db.exec("INSERT INTO artifacts VALUES ('receipt', 'generated', '{}')");
  }
  const more = { ...intent, writeIntentId: UUID_5 };
  candidate.prepare("INSERT INTO write_intents VALUES (?,?,?,?,?)").run(
    more.writeIntentId, more.status, more.generation, more.runId, JSON.stringify(more));
  using proof = capture(original);
  assert.doesNotThrow(() => proof.assertPreservedBy(candidate));
  const retainedDigest = sha256Hex(canonicalJsonStringify(readRestoreWriteFences(candidate)));
  for (const table of ["write_intents", "write_attempts", "artifacts"] as const) {
    candidate.exec("SAVEPOINT evidence");
    if (table === "write_intents") {
      const changed = { ...intent, version: intent.version + 1 };
      candidate.prepare("UPDATE write_intents SET payload_json=? WHERE id=?")
        .run(JSON.stringify(changed), changed.writeIntentId);
    } else {
      candidate.exec(`DELETE FROM ${table}`);
    }
    assert.throws(() => proof.assertPreservedBy(candidate), {
      message: `restore-would-weaken-write-evidence:${table}`,
    });
    assert.notEqual(sha256Hex(canonicalJsonStringify(readRestoreWriteFences(candidate))), retainedDigest);
    candidate.exec("ROLLBACK TO evidence; RELEASE evidence");
  }
});

it.each([
  ["timeline_events", `INSERT INTO timeline_events VALUES (1,NULL,'{"event":{"t":"transaction.fenced"}}')`],
  ["deleted_runs", "INSERT INTO deleted_runs VALUES ('tombstone','{}')"],
  ["artifacts", "INSERT INTO artifacts VALUES ('receipt','generated','{}')"],
])("refuses losing standalone %s evidence and accepts it when the source had none", (table, seed) => {
  using original = authority();
  using candidate = authority();
  using empty = capture(original);
  original.exec(seed);
  using proof = capture(original);
  assert.throws(() => proof.assertPreservedBy(candidate), { message: `restore-would-weaken-write-evidence:${table}` });
  assert.doesNotThrow(() => empty.assertPreservedBy(original));
});

it("reads unresolved IDs without comparison rows and preserves malformed-fence refusals", () => {
  using db = authority();
  const attempt = WRITE_ATTEMPT;
  db.prepare("INSERT INTO write_attempts VALUES (?,?,?,?,?)").run(
    attempt.writeAttemptId, attempt.writeIntentId, attempt.generation, attempt.runId, JSON.stringify(attempt));
  db.prepare("INSERT INTO runs VALUES (?,?,?)").run("run", "parked-write",
    JSON.stringify({ lifecycle: { state: "parked-write", writeIntentId: attempt.writeIntentId } }));
  assert.deepEqual(readUnresolvedRestoreWrites(db), [attempt.writeIntentId]);
  using candidate = authority();
  using proof = capture(db);
  assert.throws(() => proof.assertPreservedBy(candidate), /restore-would-lose-unresolved-write/u);
  db.prepare("INSERT INTO timeline_events VALUES (?,NULL,?)").run(1, "malformed JSON");
  assert.throws(() => readUnresolvedRestoreWrites(db), SyntaxError);
  db.exec("DELETE FROM timeline_events");
  db.exec("UPDATE runs SET state='terminal'");
  assert.throws(() => readUnresolvedRestoreWrites(db), /restore-run-fence-record-invalid/u);
  db.exec("UPDATE runs SET state='parked-write'; DROP TABLE run_results");
  assert.throws(() => readUnresolvedRestoreWrites(db), /no such table: run_results/u);
});

it("refuses an unreadable row in a present comparison table before account removal", () => {
  using db = authority();
  retainEvidence(db);
  db.exec("ALTER TABLE run_batches ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)");
  db.exec("INSERT INTO run_batches VALUES ('batch', '{}', 9007199254740992)");
  assert.throws(() => readRestoreWriteFences(db), { code: "ERR_OUT_OF_RANGE" });
  assert.throws(() => readUnresolvedRestoreWrites(db), { code: "ERR_OUT_OF_RANGE" });
});


it("owns a private indexed witness and removes it on disposal or a failed source close", () => {
  using original = authority();
  retainEvidence(original);
  const ownIndexes = () => readdirSync(tmpdir()).filter(name => name.startsWith(`relay-readonly-authority-pid${process.pid}-fences-`));
  const before = ownIndexes();
  {
    using proof = capture(original);
    const active = ownIndexes().filter(name => !before.includes(name));
    assert.equal(active.length, 1);
    const [name] = active;
    assert.ok(name);
    const folder = join(tmpdir(), name);
    assert.deepEqual(readdirSync(folder), ["fences.sqlite"]);
    if (process.platform !== "win32") assert.equal(statSync(folder).mode & 0o777, 0o700);
    assert.equal(proof.digest, sha256Hex(canonicalJsonStringify(readRestoreWriteFences(original))));
  }
  assert.deepEqual(ownIndexes(), before);
  assert.throws(() => captureRestoreWriteFenceProof(read => {
    read(original);
    throw new Error("unproved source close");
  }), /unproved source close/u);
  assert.deepEqual(ownIndexes(), before);
});
