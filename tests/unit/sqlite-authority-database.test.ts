import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { AUTHORITY_TABLE_REGISTRY, type AuthorityTableName } from "../../src/domain/authority.js";
import { manualClock } from "../../src/domain/clock.js";
import { deriveIdempotencyKeyDigest } from "../../src/domain/write-safety.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import {
  COMMAND_FIXTURES,
  ATOMIC_WRITE_COMMIT,
  CONFIG_SNAPSHOT,
  DELEGATION_MANIFEST,
  DEPENDENCY_RECORD,
  GATE_RESULT,
  HASH_A,
  HASH_B,
  IDEMPOTENCY_KEY,
  NOTIFICATION,
  NOW,
  UUID_1,
  UUID_2,
  UUID_3,
  UUID_5,
  UUID_6,
  UUID_7,
  UUID_8,
  WRITE_ATTEMPT,
  WRITE_INTENT_ATTEMPTING,
} from "./fixtures/phase1c-contract-fixtures.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const CLOCK = manualClock(new Date(NOW));
const SCHEMA_BOUND_VALUE = { schemaHash: HASH_A, value: { verified: true } };
const OPAQUE_RECORD = { recordId: UUID_8, payload: SCHEMA_BOUND_VALUE, createdAt: NOW };
const VERSION_PLAN = {
  versionPlanId: UUID_7,
  version: 1,
  planFingerprint: HASH_A,
  state: "planned",
  payload: SCHEMA_BOUND_VALUE,
  createdAt: NOW,
};
const ARTIFACT_OUTBOX = {
  outboxId: UUID_7,
  artifactId: UUID_8,
  stableKeyFingerprint: HASH_B,
  sinkId: "evidence-ledger",
  state: "pending",
  payload: SCHEMA_BOUND_VALUE,
  createdAt: NOW,
};
const PROJECTION_RECORD = { projectionKey: HASH_A, payload: SCHEMA_BOUND_VALUE, updatedAt: NOW };
const COMMAND_AUDIT = {
  auditId: UUID_2,
  request: COMMAND_FIXTURES[0],
  result: {
    state: "applied",
    commandId: UUID_1,
    affectedTargets: [{ family: "start", workflowId: "onboarding", startPlanId: UUID_3 }],
  },
  completedAt: NOW,
  versionChanges: [],
  affectedDependencyIds: [],
};
const OBSERVED_PRESENT_WRITE_INTENT = {
  writeIntentId: UUID_7,
  workflowId: "separation",
  itemId: UUID_5,
  taskId: "ucpath/terminate-person",
  system: "ucpath",
  idempotencyKey: "10001573|termination|2026-08-02",
  idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", "10001573|termination|2026-08-02"),
  generation: 1,
  status: "observed-present",
  observedProof: { schemaHash: HASH_A, value: "receipt-seen-during-recovery" },
  observedAt: NOW,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

function databasePath(name = "authority.sqlite"): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-rebuild-sqlite-"));
  roots.push(root);
  return join(root, name);
}

function openDatabase(path = databasePath(), busyTimeoutMs = 250): AuthorityDatabase {
  const database = AuthorityDatabase.open({ path, busyTimeoutMs, migrationOwner: "unit-test" }, CLOCK);
  openDatabases.push(database);
  return database;
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("native SQLite authority schema", () => {
  it("creates every registered table with its exact authority classification and required pragmas", () => {
    const database = openDatabase();
    const inspection = database.inspectSchema();
    assert.deepEqual(inspection.tables, [...AUTHORITY_TABLE_REGISTRY]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, classification }) => ({ name, classification })));
    assert.equal(inspection.schemaVersion, 1);
    assert.equal(inspection.authorityGeneration, 0);
    assert.deepEqual(inspection.pragmas, {
      journalMode: "wal",
      foreignKeys: 1,
      synchronous: 2,
      busyTimeoutMs: 250,
    });
  });

  it("reopens an already-current database without rerunning the migration", () => {
    const path = databasePath();
    const first = openDatabase(path);
    first.authority.commands.insert(COMMAND_FIXTURES[0]);
    const before = first.getMeta();
    first.close();
    const reopened = openDatabase(path);
    assert.deepEqual(reopened.getMeta(), before);
    assert.deepEqual(reopened.authority.commands.get(UUID_1), COMMAND_FIXTURES[0]);
  });

  it("fails loud for empty, foreign, newer, locked, and structurally invalid databases", () => {
    const emptyPath = databasePath("empty.sqlite");
    writeFileSync(emptyPath, "");
    assert.throws(() => openDatabase(emptyPath), /exists but is empty/);

    const foreignPath = databasePath("foreign.sqlite");
    writeFileSync(foreignPath, "not a sqlite database");
    const foreignBytes = readFileSync(foreignPath);
    assert.throws(() => openDatabase(foreignPath), /failed to open authority database/);
    assert.deepEqual(readFileSync(foreignPath), foreignBytes);

    const newerPath = databasePath("newer.sqlite");
    openDatabase(newerPath).close();
    const newer = new DatabaseSync(newerPath);
    newer.exec("PRAGMA user_version = 2");
    newer.close();
    assert.throws(() => openDatabase(newerPath), /newer than supported/);

    const markedPath = databasePath("marked.sqlite");
    openDatabase(markedPath).close();
    const marked = new DatabaseSync(markedPath);
    marked.prepare(`
      UPDATE authority_meta
      SET migration_owner = ?, migration_started_at = ?
      WHERE singleton_id = 1
    `).run("other-process", NOW);
    marked.close();
    assert.throws(() => openDatabase(markedPath), /locked by migration owner other-process/);

    const malformedPath = databasePath("malformed.sqlite");
    openDatabase(malformedPath).close();
    const malformed = new DatabaseSync(malformedPath);
    malformed.exec("DROP TABLE notes");
    malformed.close();
    assert.throws(() => openDatabase(malformedPath), /tables do not match registry/);

    const badForeignKeyPath = databasePath("bad-foreign-key.sqlite");
    openDatabase(badForeignKeyPath).close();
    const badForeignKey = new DatabaseSync(badForeignKeyPath, { enableForeignKeyConstraints: false });
    badForeignKey.prepare(`
      INSERT INTO command_audits (record_key, command_id, record_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(UUID_2, UUID_8, JSON.stringify(COMMAND_AUDIT), NOW);
    badForeignKey.close();
    assert.throws(() => openDatabase(badForeignKeyPath), /foreign-key validation failed/);
  });

  it("fails when another connection holds the migration/write lease", () => {
    const path = databasePath();
    openDatabase(path).close();
    const locker = new DatabaseSync(path);
    locker.exec("BEGIN EXCLUSIVE");
    const contender = openDatabase(path, 10);
    assert.throws(() => contender.authority.commands.insert(COMMAND_FIXTURES[0]), /database is locked/);
    assert.equal(contender.getMeta().authorityGeneration, 0);
    locker.exec("ROLLBACK");
    locker.close();
  });
});

describe("authority generation accounting", () => {
  type MutationCase = Readonly<{
    table: Exclude<AuthorityTableName, "authority_meta">;
    prepare?: (database: AuthorityDatabase) => void;
    mutate: (database: AuthorityDatabase) => void;
  }>;

  const cases: readonly MutationCase[] = [
    { table: "tasks", mutate: (db) => { db.authority.opaque.tasks.insert(OPAQUE_RECORD); } },
    { table: "leases", mutate: (db) => { db.authority.opaque.leases.insert(OPAQUE_RECORD); } },
    { table: "delegation_manifests", mutate: (db) => { db.authority.delegationManifests.insert(DELEGATION_MANIFEST); } },
    { table: "dependencies", prepare: (db) => { db.authority.delegationManifests.insert(DELEGATION_MANIFEST); }, mutate: (db) => { db.authority.dependencies.insert(DEPENDENCY_RECORD); } },
    { table: "commands", mutate: (db) => { db.authority.commands.insert(COMMAND_FIXTURES[0]); } },
    { table: "command_audits", prepare: (db) => { db.authority.commands.insert(COMMAND_FIXTURES[0]); }, mutate: (db) => { db.authority.commandAudits.insert(COMMAND_AUDIT); } },
    { table: "notifications", mutate: (db) => { db.authority.notifications.insert(NOTIFICATION); } },
    { table: "config_snapshots", mutate: (db) => { db.authority.configSnapshots.insert(CONFIG_SNAPSHOT); } },
    { table: "version_plans", mutate: (db) => { db.authority.versionPlans.insert(VERSION_PLAN); } },
    { table: "checkpoint_payloads", mutate: (db) => { db.authority.gateResults.insert(GATE_RESULT); } },
    { table: "ocr_approvals", mutate: (db) => { db.authority.opaque.ocrApprovals.insert(OPAQUE_RECORD); } },
    { table: "capture_sessions", mutate: (db) => { db.authority.opaque.captureSessions.insert(OPAQUE_RECORD); } },
    { table: "capture_photo_order", mutate: (db) => { db.authority.opaque.capturePhotoOrder.insert(OPAQUE_RECORD); } },
    { table: "capture_finalization_outboxes", mutate: (db) => { db.authority.opaque.captureFinalizationOutboxes.insert(OPAQUE_RECORD); } },
    { table: "write_intents", mutate: (db) => { db.authority.writeIntents.recordObservedPresent(OBSERVED_PRESENT_WRITE_INTENT); } },
    { table: "write_attempts", mutate: (db) => { db.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }); } },
    {
      table: "durable_outbox",
      prepare: (db) => { db.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }); },
      mutate: (db) => { db.commitWriteAttempt(ATOMIC_WRITE_COMMIT); },
    },
    { table: "artifact_outbox", mutate: (db) => { db.authority.artifactOutbox.insert(ARTIFACT_OUTBOX); } },
    { table: "artifact_sink_heads", mutate: (db) => { db.authority.opaque.artifactSinkHeads.insert(OPAQUE_RECORD); } },
  ];

  it("covers every classified authority table mutator and increments once per outer mutation", () => {
    assert.deepEqual(cases.map(({ table }) => table).sort(), AUTHORITY_TABLE_REGISTRY
      .filter(({ classification, name }) => classification === "authority" && name !== "authority_meta")
      .map(({ name }) => name)
      .sort());
    for (const mutation of cases) {
      const database = openDatabase();
      mutation.prepare?.(database);
      const before = database.getMeta().authorityGeneration;
      mutation.mutate(database);
      assert.equal(database.getMeta().authorityGeneration, before + 1, mutation.table);
      database.close();
    }
  });

  it("shares nested authority transactions and increments exactly once", () => {
    const database = openDatabase();
    database.withAuthorityTransaction((authority) => {
      authority.commands.insert(COMMAND_FIXTURES[0]);
      database.withAuthorityTransaction((nested) => {
        nested.notifications.insert(NOTIFICATION);
      });
    });
    assert.equal(database.getMeta().authorityGeneration, 1);
  });

  it("leaves generation unchanged for empty, projection-only, idempotent, and rolled-back work", () => {
    const database = openDatabase();
    database.withAuthorityTransaction(() => undefined);
    assert.equal(database.getMeta().authorityGeneration, 0);

    database.projections.spans.upsert(PROJECTION_RECORD);
    database.projections.spans.clear();
    assert.equal(database.getMeta().authorityGeneration, 0);

    assert.equal(database.authority.commands.insert(COMMAND_FIXTURES[0]).state, "inserted");
    assert.equal(database.getMeta().authorityGeneration, 1);
    assert.equal(database.authority.commands.insert(COMMAND_FIXTURES[0]).state, "existing");
    assert.equal(database.getMeta().authorityGeneration, 1);

    assert.throws(() => database.withAuthorityTransaction((authority) => {
      authority.notifications.insert(NOTIFICATION);
      throw new Error("roll back the authority unit");
    }), /roll back the authority unit/);
    assert.equal(database.getMeta().authorityGeneration, 1);
    assert.equal(database.authority.notifications.get(UUID_3), undefined);
  });

  it("never increments authority generation for projection upsert or clear", () => {
    const database = openDatabase();
    for (const repository of [
      database.projections.spans,
      database.projections.gates,
      database.projections.notes,
      database.projections.runsView,
    ]) {
      repository.upsert(PROJECTION_RECORD);
      assert.deepEqual(repository.get(HASH_A), PROJECTION_RECORD);
      assert.equal(repository.clear(), 1);
    }
    assert.equal(database.getMeta().authorityGeneration, 0);
  });
});

describe("authority persistence invariants", () => {
  it("makes command insertion idempotent but rejects command-id content reuse", () => {
    const database = openDatabase();
    assert.equal(database.authority.commands.insert(COMMAND_FIXTURES[0]).state, "inserted");
    assert.equal(database.authority.commands.insert(COMMAND_FIXTURES[0]).state, "existing");
    assert.throws(() => database.authority.commands.insert({
      ...(COMMAND_FIXTURES[0] as Record<string, unknown>),
      requestedBy: "different-operator",
    }), /reused with different content/);
    assert.equal(database.getMeta().authorityGeneration, 1);
  });

  it("keeps committed and observed-present idempotency keys permanent", () => {
    const database = openDatabase();
    assert.equal(database.authority.writeIntents.fenceAttempt({ intent: WRITE_INTENT_ATTEMPTING, attempt: WRITE_ATTEMPT }).state, "fenced");
    database.commitWriteAttempt(ATOMIC_WRITE_COMMIT);
    const committedReplay = {
      intent: { ...WRITE_INTENT_ATTEMPTING, writeIntentId: UUID_8, currentAttemptId: UUID_6 },
      attempt: { ...WRITE_ATTEMPT, writeIntentId: UUID_8, writeAttemptId: UUID_6 },
    };
    assert.equal(database.authority.writeIntents.fenceAttempt(committedReplay).state, "existing");
    assert.equal(database.authority.writeIntents.findByPermanentKey("ucpath", IDEMPOTENCY_KEY)?.writeIntentId, UUID_1);

    assert.equal(database.authority.writeIntents.recordObservedPresent(OBSERVED_PRESENT_WRITE_INTENT).state, "recorded-observed-present");
    const observedReplay = { ...OBSERVED_PRESENT_WRITE_INTENT, writeIntentId: UUID_6 };
    assert.equal(database.authority.writeIntents.recordObservedPresent(observedReplay).state, "existing");
    assert.equal(database.authority.writeIntents.findByPermanentKey("ucpath", OBSERVED_PRESENT_WRITE_INTENT.idempotencyKey)?.writeIntentId, UUID_7);
    assert.equal(database.getMeta().authorityGeneration, 3);
  });

  it("enforces command, delegation, write-attempt, and outbox foreign keys", () => {
    const database = openDatabase();
    assert.throws(() => database.authority.commandAudits.insert(COMMAND_AUDIT), /FOREIGN KEY constraint failed/);
    assert.throws(() => database.authority.dependencies.insert(DEPENDENCY_RECORD), /FOREIGN KEY constraint failed/);
    assert.throws(
      () => database.commitWriteAttempt(ATOMIC_WRITE_COMMIT),
      /write intent .* does not exist/,
    );
    assert.equal(database.getMeta().authorityGeneration, 0);
  });

  it("rejects authority mutation inside a projection transaction", () => {
    const database = openDatabase();
    assert.throws(() => database.withProjectionTransaction(() => {
      database.authority.commands.insert(COMMAND_FIXTURES[0]);
    }), /authority mutation cannot run inside a projection transaction/);
    assert.equal(database.getMeta().authorityGeneration, 0);
  });
});
