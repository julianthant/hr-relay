import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { afterEach, describe, it } from "vitest";
import { AuthorityUpgradeRecordSchema } from "../../src/domain/authority.js";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { manualClock } from "../../src/domain/clock.js";
import {
  CommandAuditRecordSchema,
  StartCommandRequestSchema,
} from "../../src/domain/commands.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import {
  AUTHORITY_APPLICATION_ID,
  CURRENT_AUTHORITY_SCHEMA_VERSION,
  SQLITE_MIGRATIONS,
} from "../../src/infra/sqlite/migrations.js";
import { inspectAuthorityBackupReadOnly } from "../../src/infra/compat/backup-inspection.js";
import { acquireRuntimeProcessLock } from "../../src/infra/sqlite/runtime-process-locks.js";
import { verifyBackupManifestAtPath } from "../../src/infra/sqlite/backup-service.js";
import {
  backupStoppedAuthority,
  upgradeStorage,
  type StorageUpgradeInput,
} from "../../src/server/storage/upgrade.js";

const NOW = "2026-09-06T12:00:00.000Z";
const LATER = "2026-09-06T12:01:00.000Z";
const CLOCK = manualClock(new Date(NOW));
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const COMMAND_ID = "11111111-1111-4111-8111-111111111111";
const AUDIT_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_COMMAND_ID = "33333333-3333-4333-8333-333333333333";
const SECOND_AUDIT_ID = "44444444-4444-4444-8444-444444444444";
const START_PLAN_ID = "55555555-5555-4555-8555-555555555555";
const ADMITTED_HISTORICAL_VERSIONS = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
  27, 28, 29, 30, 31,
] as const);
const REFUSED_GAP_VERSIONS = Object.freeze([19, 20, 21, 22, 23, 24, 25, 26] as const);
const roots: string[] = [];

const TableNameRowsSchema = z.array(z.strictObject({ name: z.string().min(1) }));
const CountRowSchema = z.strictObject({ count: z.number().int().nonnegative() });
const TextRowSchema = z.strictObject({ record_json: z.string().min(1) });
const MetaRowSchema = z.strictObject({
  schema_version: z.number().int().positive(),
  authority_generation: z.number().int().nonnegative(),
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function strictDatabase(path: string): DatabaseSync {
  return new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    readBigInts: false,
    returnArrays: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    defensive: true,
  });
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function historicalCommand(commandId: string, auditId: string) {
  const command = StartCommandRequestSchema.parse({
    commandId,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "start",
    type: "start-run",
    target: {
      workflowId: "onboarding",
      startPlanId: START_PLAN_ID,
      expectedVersion: 1,
    },
    payload: {
      descriptorFingerprint: HASH_A,
      configFingerprint: HASH_B,
      ingressSchemaHash: HASH_C,
      canonicalInputSchemaHash: HASH_A,
      inputFingerprint: HASH_C,
    },
  });
  const audit = CommandAuditRecordSchema.parse({
    auditId,
    request: command,
    result: {
      state: "applied",
      commandId,
      affectedTargets: [{
        family: "start",
        workflowId: command.target.workflowId,
        startPlanId: command.target.startPlanId,
        expectedVersion: command.target.expectedVersion,
      }],
    },
    completedAt: NOW,
    versionChanges: [],
    affectedDependencyIds: [],
  });
  return Object.freeze({ command, audit });
}

function insertHistoricalCommand(
  database: DatabaseSync,
  commandId = COMMAND_ID,
  auditId = AUDIT_ID,
): Readonly<{ commandJson: string; auditJson: string }> {
  const { command, audit } = historicalCommand(commandId, auditId);
  const commandJson = canonicalJsonStringify(command);
  const auditJson = canonicalJsonStringify(audit);
  database.prepare(`
    INSERT INTO commands (record_key, family, record_json, created_at)
    VALUES (?, ?, ?, ?)
  `).run(command.commandId, command.family, commandJson, NOW);
  database.prepare(`
    INSERT INTO command_audits (record_key, command_id, record_json, created_at)
    VALUES (?, ?, ?, ?)
  `).run(audit.auditId, command.commandId, auditJson, NOW);
  return Object.freeze({ commandJson, auditJson });
}

interface HistoricalFixture {
  readonly root: string;
  readonly path: string;
  readonly input: StorageUpgradeInput;
  readonly commandJson: string;
  readonly auditJson: string;
}

function historicalFixture(version: number): HistoricalFixture {
  const root = mkdtempSync(join(tmpdir(), `storage-upgrade-admission-v${String(version)}-`));
  roots.push(root);
  const path = join(root, "state.db");
  const database = strictDatabase(path);
  let journal: ReturnType<typeof insertHistoricalCommand>;
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("BEGIN IMMEDIATE");
    for (const migration of SQLITE_MIGRATIONS) {
      if (migration.version > Math.min(version, CURRENT_AUTHORITY_SCHEMA_VERSION)) break;
      for (const statement of migration.statements) database.exec(statement);
    }
    database.prepare(`
      INSERT INTO authority_meta
        (singleton_id, schema_version, authority_generation, updated_at,
         migration_owner, migration_started_at)
      VALUES (1, ?, 7, ?, NULL, NULL)
    `).run(version, NOW);
    journal = insertHistoricalCommand(database);
    database.exec(`PRAGMA application_id = ${String(AUTHORITY_APPLICATION_ID)}`);
    database.exec(`PRAGMA user_version = ${String(version)}`);
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
  return Object.freeze({
    root,
    path,
    input: Object.freeze({
      stateRoot: root,
      processLockRoot: join(root, "locks"),
      environmentFile: join(root, ".env"),
      plan: false,
    }),
    commandJson: journal.commandJson,
    auditJson: journal.auditJson,
  });
}

function tableCounts(path: string): ReadonlyMap<string, number> {
  const database = strictDatabase(path);
  try {
    const tables = TableNameRowsSchema.parse(database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all());
    return new Map(tables.map(({ name }) => [
      name,
      CountRowSchema.parse(database.prepare(
        `SELECT count(*) AS count FROM ${quoteIdentifier(name)}`,
      ).get()).count,
    ]));
  } finally {
    database.close();
  }
}

function readJournalJson(path: string, table: "commands" | "command_audits", key: string): string {
  const database = strictDatabase(path);
  try {
    const row = TextRowSchema.parse(database.prepare(
      `SELECT record_json FROM ${table} WHERE record_key = ?`,
    ).get(key));
    return row.record_json;
  } finally {
    database.close();
  }
}

function readMeta(path: string): z.infer<typeof MetaRowSchema> {
  const database = strictDatabase(path);
  try {
    return MetaRowSchema.parse(database.prepare(`
      SELECT schema_version, authority_generation
      FROM authority_meta WHERE singleton_id = 1
    `).get());
  } finally {
    database.close();
  }
}

function readUpgradeRecords(path: string) {
  const database = strictDatabase(path);
  try {
    return database.prepare(`
      SELECT record_json FROM authority_upgrades ORDER BY rowid
    `).all().map((row) => AuthorityUpgradeRecordSchema.parse(
      JSON.parse(TextRowSchema.parse(row).record_json),
    ));
  } finally {
    database.close();
  }
}

function assertOnlyExpectedRowsRemain(fixture: HistoricalFixture): void {
  const counts = tableCounts(fixture.path);
  for (const [table, count] of counts) {
    const expected = table === "authority_meta" || table === "commands" || table === "command_audits"
      ? 1
      : table === "authority_upgrades" ? 2 : 0;
    assert.equal(count, expected, `${table} must retain exactly ${String(expected)} row(s)`);
  }
  assert.equal(readJournalJson(fixture.path, "commands", COMMAND_ID), fixture.commandJson);
  assert.equal(readJournalJson(fixture.path, "command_audits", AUDIT_ID), fixture.auditJson);
}

function backupManifestPath(fixture: HistoricalFixture, backupFileName: string): string {
  return join(
    fixture.root,
    "backups",
    "authority",
    `${backupFileName}.manifest.json`,
  );
}

describe("D336 stopped-upgrade admission matrix", () => {
  it("refuses schema-valid journal column corruption during read-only preflight without creating runtime admission", async () => {
    const f = historicalFixture(29);
    const raw = strictDatabase(f.path);
    try { raw.exec("UPDATE commands SET family='settings'"); } finally { raw.close(); }
    await assert.rejects(backupStoppedAuthority(f.root, CLOCK), /commands-family-column-matches-record/u);
    const before = readFileSync(f.path);
    const pathsBefore = readdirSync(f.root).sort();
    for (const plan of [true, false]) await assert.rejects(upgradeStorage({ ...f.input, plan }, CLOCK), /commands-family-column-matches-record/u);
    assert.deepEqual(readFileSync(f.path), before);
    assert.deepEqual(readdirSync(f.root).sort(), pathsBefore);
  });
  it.each(ADMITTED_HISTORICAL_VERSIONS)(
    "requires backup, plans read-only, and converts exact v%s while preserving authority",
    async (version) => {
      const fixture = historicalFixture(version);
      const originalBytes = readFileSync(fixture.path);
      const originalEntries = readdirSync(fixture.root).sort();
      const originalCounts = tableCounts(fixture.path);

      await assert.rejects(
        upgradeStorage({ ...fixture.input, plan: true }, CLOCK),
        /backup-required: run storage backup first/u,
      );
      await assert.rejects(
        upgradeStorage(fixture.input, CLOCK),
        /backup-required: run storage backup first/u,
      );
      assert.deepEqual(readFileSync(fixture.path), originalBytes);
      assert.deepEqual(readdirSync(fixture.root).sort(), originalEntries);
      assert.deepEqual(tableCounts(fixture.path), originalCounts);

      const backup = await backupStoppedAuthority(fixture.root, CLOCK);
      assert.equal(backup.state, "verified");
      assert.equal(backup.manifests.length, 1);
      const manifest = backup.manifests[0];
      assert.ok(manifest !== undefined);
      assert.equal(manifest.schemaVersion, version);
      assert.equal(manifest.authorityGeneration, 7);
      const manifestPath = backupManifestPath(fixture, manifest.backupFileName);
      const backupEntries = readdirSync(join(fixture.root, "backups", "authority")).sort();
      const plannedRootEntries = readdirSync(fixture.root).sort();

      const plan = await upgradeStorage({ ...fixture.input, plan: true }, CLOCK);
      assert.deepEqual(plan, {
        state: "planned",
        fromSchemaVersion: version,
        toSchemaVersion: 32,
        importedKeys: [],
        sourceFiles: [],
        envKeysToRemove: [],
        backupManifest: basename(manifestPath),
        credentials: "empty",
        historicalExposure: [],
        orphanGateRecordsRemoved: 0,
        tombstoneBackfill: { fromRoots: 0, fromReconstructedRoots: 0, unknown: 0, missingRunNumber: 0 },
      });
      assert.deepEqual(readFileSync(fixture.path), originalBytes);
      assert.deepEqual(tableCounts(fixture.path), originalCounts);
      assert.deepEqual(readdirSync(fixture.root).sort(), plannedRootEntries);
      assert.deepEqual(
        readdirSync(join(fixture.root, "backups", "authority")).sort(),
        backupEntries,
      );

      const applied = await upgradeStorage(fixture.input, CLOCK);
      assert.deepEqual(applied, { ...plan, state: "converted" });
      assert.equal(
        AuthorityDatabase.inspectExistingReadOnly(fixture.path).schemaVersion,
        CURRENT_AUTHORITY_SCHEMA_VERSION,
      );
      assert.deepEqual(readMeta(fixture.path), {
        schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION,
        authority_generation: 9,
      });
      assertOnlyExpectedRowsRemain(fixture);
      const upgrades = readUpgradeRecords(fixture.path);
      assert.deepEqual(upgrades.map(({ phase }) => phase), ["committed", "settled"]);
      for (const record of upgrades) {
        assert.equal("format" in record && record.format, 3);
        assert.equal(record.fromSchemaVersion, version);
        assert.equal(record.toSchemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      }
      assert.equal(
        (await verifyBackupManifestAtPath(manifestPath)).manifest.schemaVersion,
        version,
      );
      assert.equal(existsSync(join(fixture.root, "credentials")), false);
    },
  );

  it.each(REFUSED_GAP_VERSIONS)(
    "refuses exact unsupported gap schema v%s without effects",
    async (version) => {
      const fixture = historicalFixture(version);
      const before = readFileSync(fixture.path);
      const entries = readdirSync(fixture.root).sort();
      await assert.rejects(
        upgradeStorage({ ...fixture.input, plan: true }, CLOCK),
        new RegExp(`authority schema ${String(version)} is not an admitted backup schema`, "u"),
      );
      assert.deepEqual(readFileSync(fixture.path), before);
      assert.deepEqual(readdirSync(fixture.root).sort(), entries);
      assert.deepEqual(readMeta(fixture.path), {
        schema_version: version,
        authority_generation: 7,
      });
    },
  );

  it("refuses an ahead schema without effects", async () => {
    const fixture = historicalFixture(CURRENT_AUTHORITY_SCHEMA_VERSION + 1);
    const before = readFileSync(fixture.path);
    await assert.rejects(
      upgradeStorage({ ...fixture.input, plan: true }, CLOCK),
      /authority schema 33 is not an admitted backup schema/u,
    );
    assert.deepEqual(readFileSync(fixture.path), before);
    assert.deepEqual(readMeta(fixture.path), {
      schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION + 1,
      authority_generation: 7,
    });
  });

  it("refuses an admitted version whose SQLite schema diverges from released migrations", async () => {
    const fixture = historicalFixture(31);
    const database = strictDatabase(fixture.path);
    database.exec("CREATE TABLE divergent_authority (record_key TEXT PRIMARY KEY) STRICT");
    database.close();
    const before = readFileSync(fixture.path);
    await assert.rejects(
      upgradeStorage({ ...fixture.input, plan: true }, CLOCK),
      /authority schema 31 does not match its immutable migration replay/u,
    );
    assert.deepEqual(readFileSync(fixture.path), before);
    assert.equal(tableCounts(fixture.path).get("divergent_authority"), 0);
  });

  it("refuses an active runtime lock before reading backup admission", async () => {
    const fixture = historicalFixture(31);
    await backupStoppedAuthority(fixture.root, CLOCK);
    const before = readFileSync(fixture.path);
    const server = acquireRuntimeProcessLock({
      processLockRoot: fixture.input.processLockRoot,
      name: "server",
      pid: process.pid,
    }, CLOCK);
    try {
      await assert.rejects(
        upgradeStorage({ ...fixture.input, plan: true }, CLOCK),
        /runtime-active: stop server and workers before storage upgrade/u,
      );
      assert.deepEqual(readFileSync(fixture.path), before);
      assert.deepEqual(readMeta(fixture.path), {
        schema_version: 31,
        authority_generation: 7,
      });
    } finally {
      server.release();
    }
  });

  it("refuses stale backup evidence after a valid historical authority write", async () => {
    const fixture = historicalFixture(31);
    await backupStoppedAuthority(fixture.root, CLOCK);
    const database = strictDatabase(fixture.path);
    try {
      database.exec("BEGIN IMMEDIATE");
      insertHistoricalCommand(database, SECOND_COMMAND_ID, SECOND_AUDIT_ID);
      database.prepare(`
        UPDATE authority_meta
        SET authority_generation = authority_generation + 1, updated_at = ?
        WHERE singleton_id = 1
      `).run(LATER);
      database.exec("COMMIT");
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    } finally {
      database.close();
    }
    const before = readFileSync(fixture.path);
    await assert.rejects(
      upgradeStorage({ ...fixture.input, plan: true }, CLOCK),
      /backup-stale: run storage backup against the current authority first/u,
    );
    assert.deepEqual(readFileSync(fixture.path), before);
    assert.deepEqual(readMeta(fixture.path), {
      schema_version: 31,
      authority_generation: 8,
    });
    assert.equal(readJournalJson(fixture.path, "commands", SECOND_COMMAND_ID),
      canonicalJsonStringify(historicalCommand(SECOND_COMMAND_ID, SECOND_AUDIT_ID).command));
  });

  it("rolls back a beforeCommit interruption and admits an exact retry", async () => {
    const fixture = historicalFixture(31);
    const backup = await backupStoppedAuthority(fixture.root, CLOCK);
    const manifest = backup.manifests[0];
    assert.ok(manifest !== undefined);
    const manifestPath = backupManifestPath(fixture, manifest.backupFileName);
    const before = readFileSync(fixture.path);

    await assert.rejects(
      upgradeStorage({
        ...fixture.input,
        hooks: { beforeCommit: () => { throw new Error("interrupted-before-commit"); } },
      }, CLOCK),
      /interrupted-before-commit/u,
    );
    assert.deepEqual(readFileSync(fixture.path), before);
    assert.equal(
      inspectAuthorityBackupReadOnly(fixture.path).schemaVersion,
      31,
    );
    assert.deepEqual(readMeta(fixture.path), {
      schema_version: 31,
      authority_generation: 7,
    });
    assert.equal(existsSync(join(fixture.root, "credentials")), false);
    assert.equal((await verifyBackupManifestAtPath(manifestPath)).manifest.schemaVersion, 31);

    const retried = await upgradeStorage(fixture.input, CLOCK);
    assert.equal(retried.state, "converted");
    assert.equal(
      AuthorityDatabase.inspectExistingReadOnly(fixture.path).schemaVersion,
      CURRENT_AUTHORITY_SCHEMA_VERSION,
    );
    assertOnlyExpectedRowsRemain(fixture);
  });
});
