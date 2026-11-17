import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { applyAuthorityMigrationsAfter, inspectNativeAuthority, inspectNormalAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { commandFromRow, commandIdentity } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { AUTHORITY_APPLICATION_ID, BUILD_ID_ENVELOPE_SCHEMA_VERSION, CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { predecessorRunRecordFromRow, runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { createSettingsActivationRepositories } from "../../../../src/backend/storage/sqlite/settings-activation.js";
import { PredecessorRunRecordSchema } from "../../../../src/models/run/record.js";
import { deriveBulkChildCommand } from "../../../../src/rules/commands/command-groups.js";
import { BulkRunCommandRequestSchema, deriveBulkRunCommandFingerprint } from "../../../../src/rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex as sha256 } from "../../../../src/rules/validation/sha256.js";
import { CONFIG_SNAPSHOT, LATER, NOW, UUID_1, UUID_2, UUID_3 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

const SHAPE_VERSION = BUILD_ID_ENVELOPE_SCHEMA_VERSION - 1;
const CAPTURE = { now: NOW, captureFile: () => { throw new Error("artifact-unexpected"); } };

/** A schema-21 store holding one queued predecessor run and its initialized config snapshot. */
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
  const { buildId: _omit, ...envelope } = QUEUED_RUN.envelope;
  const run = PredecessorRunRecordSchema.parse({ ...QUEUED_RUN, envelope });
  const columns = runRecordColumns(run, PredecessorRunRecordSchema);
  database.prepare(`INSERT INTO runs(${Object.keys(columns).join(",")}) VALUES(${Object.keys(columns).map(() => "?").join(",")})`).run(...Object.values(columns));
  assert.equal(predecessorRunRecordFromRow(database.prepare("SELECT * FROM runs").get()).envelope.runId, run.envelope.runId);
  return database;
}

function insertCommand(database: DatabaseSync, request: unknown, row: Readonly<{ parent?: string; state: string; outcome?: unknown }>): void {
  const identity = commandIdentity(request);
  database.prepare(`INSERT INTO commands(id,family,actor_id,parent_id,target_id,request_digest,request_json,state,outcome_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(identity.request.commandId, identity.family, identity.actor, row.parent ?? null, identity.targetId,
    sha256(identity.json), identity.json, row.state, row.outcome === undefined ? null : canonicalJsonStringify(row.outcome), identity.createdAt,
    row.outcome === undefined ? identity.createdAt : LATER);
}

/** A bulk parent and its child stored as schema 21 stores an errored child: `refused`, with a rejected `bulk-child-errored` audit. */
function seedErroredBulkChild(database: DatabaseSync): string {
  const request = BulkRunCommandRequestSchema.parse({ commandId: UUID_1, bulkCommandId: UUID_1, requestedBy: "local-operator", requestedAt: NOW,
    source: "dashboard", family: "run", type: "pause", targets: [{ runId: UUID_2, expectedVersion: 1 }], mode: "best-effort" });
  const parent = { kind: "bulk-parent", commandId: UUID_1, acceptance: { bulkCommandId: UUID_1, request, requestFingerprint: deriveBulkRunCommandFingerprint(request) } };
  const child = deriveBulkChildCommand(request, request.targets[0]);
  const audit = { auditId: UUID_3, request: child, result: { state: "rejected", commandId: child.commandId, code: "bulk-child-errored", message: "Unexpected failure" },
    completedAt: LATER, versionChanges: [], affectedDependencyIds: [] };
  insertCommand(database, parent, { state: "succeeded" });
  insertCommand(database, child, { parent: parent.commandId, state: "refused", outcome: audit });
  database.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES(?,?,?,?,?)")
    .run(UUID_3, child.commandId, "bulk-child-errored", canonicalJsonStringify(audit), LATER);
  return child.commandId;
}

function upgrade(database: DatabaseSync): void {
  database.exec("BEGIN EXCLUSIVE");
  applyAuthorityMigrationsAfter(database, SHAPE_VERSION, CAPTURE);
  database.prepare("UPDATE database_states SET schema_version=?").run(CURRENT_AUTHORITY_SCHEMA_VERSION);
  database.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
  database.exec("COMMIT");
}

describe("command row state with a schema-21 store", () => {
  it("upgrades a store with no bulk command", () => {
    const database = store();
    try {
      assert.equal(inspectNativeAuthority(database, SHAPE_VERSION).schemaVersion, SHAPE_VERSION);
      upgrade(database);
      assert.equal(inspectNormalAuthority(database).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    } finally { database.close(); }
  });

  it("upgrades a store whose errored bulk child is stored as refused and stores it as uncertain", () => {
    const database = store();
    try {
      const childId = seedErroredBulkChild(database);
      assert.equal(inspectNativeAuthority(database, SHAPE_VERSION).schemaVersion, SHAPE_VERSION);
      upgrade(database);
      assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, CURRENT_AUTHORITY_SCHEMA_VERSION);
      assert.equal(database.prepare("SELECT state FROM commands WHERE id=?").get(childId)?.state, "uncertain");
    } finally { database.close(); }
  });
});
