import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { canonicalJsonStringify } from "../../src/domain/canonical-json.js";
import { manualClock } from "../../src/domain/clock.js";
import {
  CommandAuditRecordSchema,
  deriveSettingsCommandFingerprint,
  SettingsCommandRequestSchema,
} from "../../src/domain/commands.js";
import {
  derivePersistedSettingsFingerprint,
  deriveSettingsPatchFingerprint,
  SETTINGS_SCHEMA_HASH,
  SettingsFileRecordSchema,
  type SettingsFileRecord,
} from "../../src/domain/config/settings.js";
import {
  inspectAuthorityBackupReadOnly,
  openAuthorityBackupSourceReadOnly,
} from "../../src/infra/compat/backup-inspection.js";
import { SettingsCurrentRecordSchema } from "../../src/infra/compat/d331-settings-current.js";
import {
  AuthorityBackupService,
  verifyBackupManifestAtPath,
} from "../../src/infra/sqlite/backup-service.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import {
  AUTHORITY_APPLICATION_ID,
  SQLITE_MIGRATIONS,
} from "../../src/infra/sqlite/migrations.js";
import {
  AuthorityBackupManifestSchema,
  type AuthorityBackupManifest,
} from "../../src/infra/sqlite/recovery-contracts.js";
import { createSettingsFileAuthority } from "../fixtures/d331-settings-file.js";
import { initializeSyntheticSettingsBackupRoot } from "./helpers/settings-backup-fixture.js";

const NOW = "2026-09-06T20:00:00.000Z";
const CLOCK = manualClock(new Date(NOW));
const SETTINGS_COMMAND_ID = "11111111-1111-4111-8111-111111111111";
const SETTINGS_AUDIT_ID = "22222222-2222-4222-8222-222222222222";
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function openCurrentWorld() {
  const root = temporaryRoot("hrauto-v3-backup-");
  const stateRoot = join(root, ".tracker");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const authorityPath = join(stateRoot, "state.db");
  const database = AuthorityDatabase.open({
    path: authorityPath,
    busyTimeoutMs: 250,
    migrationOwner: "backup-test",
  }, CLOCK);
  databases.push(database);
  return {
    stateRoot,
    authorityPath,
    database,
    backupDirectory: join(stateRoot, "backups", "authority"),
  };
}

function createHistoricalAuthority(path: string, schemaVersion: number): void {
  const database = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    readBigInts: false,
    returnArrays: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    defensive: true,
  });
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("BEGIN IMMEDIATE");
    for (const migration of SQLITE_MIGRATIONS) {
      if (migration.version > schemaVersion) break;
      for (const statement of migration.statements) database.exec(statement);
    }
    database.prepare(`
      INSERT INTO ${schemaVersion >= 39 ? "database_state" : "authority_meta"}
        (singleton_id, schema_version, authority_generation, updated_at,
         migration_owner, migration_started_at)
      VALUES (1, ?, 7, ?, NULL, NULL)
    `).run(schemaVersion, NOW);
    database.exec(`PRAGMA application_id = ${String(AUTHORITY_APPLICATION_ID)}`);
    database.exec(`PRAGMA user_version = ${String(schemaVersion)}`);
    database.exec("COMMIT");
  } finally {
    database.close();
  }
}

function verificationFor(path: string, schemaVersion: number) {
  const inspection = inspectAuthorityBackupReadOnly(path, schemaVersion);
  return {
    inspection,
    verification: {
      state: "verified" as const,
      observedFrom: "backup-copy" as const,
      observedAt: NOW,
      applicationId: inspection.applicationId,
      schemaVersion: inspection.schemaVersion,
      pageCount: inspection.pageCount,
      authorityGeneration: inspection.authorityGeneration,
      authorityContentFingerprint: inspection.authorityContentFingerprint,
      quickCheck: inspection.quickCheck,
      foreignKeyViolations: inspection.foreignKeyViolations,
      invariantViolations: inspection.invariantViolations,
      exactTableRegistry: inspection.exactTableRegistry,
    },
  };
}

function journalHistoricalOrdinarySettings(
  authorityPath: string,
  settingsPath: string,
): SettingsFileRecord {
  const patch = { "browser.headless": { set: false } } as const;
  const patchFingerprint = deriveSettingsPatchFingerprint(patch);
  const command = SettingsCommandRequestSchema.parse({
    commandId: SETTINGS_COMMAND_ID,
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "settings-surface",
    family: "settings",
    type: "apply-settings",
    target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint, patch },
  });
  const commandFingerprint = deriveSettingsCommandFingerprint(command);
  const ordinary = createSettingsFileAuthority({
    path: settingsPath,
    validateCandidate: () => undefined,
  });
  const applied = ordinary.apply({
    commandId: command.commandId,
    commandFingerprint,
    expectedRevision: command.target.expectedRevision,
    settingsSchemaHash: command.payload.settingsSchemaHash,
    patchFingerprint: command.payload.patchFingerprint,
    patch: command.payload.patch,
  });
  if (applied.state !== "applied") {
    throw new Error(`released settings producer refused historical fixture: ${applied.message}`);
  }
  const record = applied.record;
  const target = { family: "settings" as const, revision: record.revision };
  const audit = CommandAuditRecordSchema.parse({
    auditId: SETTINGS_AUDIT_ID,
    request: command,
    result: {
      state: "applied",
      commandId: command.commandId,
      affectedTargets: [target],
      restartRequired: true,
      settingsRevision: record.revision,
      settingsFingerprint: record.settingsFingerprint,
    },
    completedAt: NOW,
    versionChanges: [{ target, before: 1, after: record.revision }],
    affectedDependencyIds: [],
  });
  const current = SettingsCurrentRecordSchema.parse({
    revision: record.revision,
    settingsFingerprint: record.settingsFingerprint,
    commandId: command.commandId,
    commandFingerprint,
    auditId: SETTINGS_AUDIT_ID,
    committedAt: NOW,
  });
  const database = new DatabaseSync(authorityPath, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    readBigInts: false,
    returnArrays: false,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    defensive: true,
  });
  let journalCommitted = false;
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("BEGIN IMMEDIATE");
    database.prepare(`
      INSERT INTO commands (record_key, family, record_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(command.commandId, command.family, canonicalJsonStringify(command), command.requestedAt);
    database.prepare(`
      INSERT INTO command_audits (record_key, command_id, record_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(audit.auditId, command.commandId, canonicalJsonStringify(audit), audit.completedAt);
    database.prepare(`
      INSERT INTO settings_current
        (record_key, revision, settings_fingerprint, command_id, command_fingerprint,
         audit_id, record_json, created_at)
      VALUES ('current', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      current.revision,
      current.settingsFingerprint,
      current.commandId,
      current.commandFingerprint,
      current.auditId,
      canonicalJsonStringify(current),
      current.committedAt,
    );
    database.prepare(`
      UPDATE authority_meta
      SET authority_generation = authority_generation + 1, updated_at = ?
      WHERE singleton_id = 1
    `).run(NOW);
    database.exec("COMMIT");
    journalCommitted = true;
    applied.commit();
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    if (!journalCommitted) applied.rollback();
    throw error;
  } finally {
    database.close();
  }
  return record;
}

function fileIdentity(path: string) {
  const bytes = readFileSync(path);
  return { byteSize: bytes.byteLength, sha256: sha256(bytes) };
}

function writeManifest(
  directory: string,
  value: AuthorityBackupManifest,
  name = `${value.backupFileName}.manifest.json`,
): string {
  const path = join(directory, name);
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  return path;
}

async function takeBackup(world: ReturnType<typeof openCurrentWorld>) {
  const service = new AuthorityBackupService(world.database, { directory: world.backupDirectory }, CLOCK);
  const report = await service.request({
    trigger: "operator",
    requiredGeneration: world.database.getMeta().authorityGeneration,
  });
  const manifest = report.manifests[0];
  assert.ok(manifest !== undefined);
  return {
    report,
    manifest,
    manifestPath: join(world.backupDirectory, `${manifest.backupFileName}.manifest.json`),
  };
}

describe("D336 DB-only authority backups", () => {
  it("writes manifest v3 and never reads or copies settings or credentials", async () => {
    const world = openCurrentWorld();
    const canary = "CANARY-CREDENTIAL-must-not-enter-backup";
    const credentialRoot = join(world.stateRoot, "credentials");
    mkdirSync(credentialRoot, { mode: 0o700 });
    writeFileSync(join(credentialRoot, "protected.json"), canary, { mode: 0o600 });
    writeFileSync(join(world.stateRoot, "unrelated-settings.json"), canary, { mode: 0o600 });

    const { report, manifest, manifestPath } = await takeBackup(world);

    assert.equal(report.manifests.every((entry) => entry.manifestVersion === 3), true);
    assert.equal(manifest.manifestVersion, 3);
    assert.equal("files" in manifest, false);
    assert.equal("protectedSettings" in manifest, false);
    const entries = readdirSync(world.backupDirectory).sort();
    assert.equal(entries.length, 2);
    assert.equal(
      entries.some((name) => readFileSync(join(world.backupDirectory, name)).includes(canary)),
      false,
    );
    assert.equal(AuthorityBackupManifestSchema.safeParse({
      ...manifest,
      protectedSettings: { revision: 1, entries: [] },
    }).success, false);
    await verifyBackupManifestAtPath(manifestPath, world.database.getSourceDatabaseIdentity());
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39])(
    "admits immutable historical schema %s without changing its bytes",
    (version) => {
      const root = temporaryRoot("historical-operation-names-");
      const path = join(root, "state.db");
      createHistoricalAuthority(path, version);
      const bytes = readFileSync(path);
      const inspected = inspectAuthorityBackupReadOnly(path, version);
      assert.equal(inspected.schemaVersion, version);
      assert.equal(inspected.counts.unresolvedWriteIntents, 0);
      assert.equal(inspected.counts.durableOutbox, 0);
      assert.deepEqual(readFileSync(path), bytes);
    },
  );

  it("preserves checksum and source-identity refusals", async () => {
    const world = openCurrentWorld();
    const { manifest, manifestPath } = await takeBackup(world);
    await assert.rejects(
      verifyBackupManifestAtPath(manifestPath, "f".repeat(64)),
      /belongs to a different authority database/u,
    );
    writeFileSync(join(world.backupDirectory, manifest.backupFileName), "tampered");
    await assert.rejects(
      verifyBackupManifestAtPath(manifestPath),
      /byte size does not match verified manifest/u,
    );
  });

  it("reads strict historical v1 and v2 layouts independently of the current schema", async () => {
    const root = temporaryRoot("hrauto-historical-backup-");
    const stateRoot = join(root, ".tracker");
    const directory = join(stateRoot, "backups", "authority");
    mkdirSync(directory, { recursive: true, mode: 0o700 });

    const v29Name = "authority-v29.sqlite";
    const v29Path = join(directory, v29Name);
    createHistoricalAuthority(v29Path, 29);
    const v29 = verificationFor(v29Path, 29);
    const v1 = AuthorityBackupManifestSchema.parse({
      kind: "hrauto-authority-backup",
      manifestVersion: 1,
      backupFileName: v29Name,
      sourceDatabaseIdentity: "a".repeat(64),
      applicationId: v29.inspection.applicationId,
      schemaVersion: v29.inspection.schemaVersion,
      pageCount: v29.inspection.pageCount,
      authorityGeneration: v29.inspection.authorityGeneration,
      authorityContentFingerprint: v29.inspection.authorityContentFingerprint,
      createdAt: NOW,
      ...fileIdentity(v29Path),
      verification: v29.verification,
    });
    const v1Path = writeManifest(directory, v1, "authority-v29.v1.manifest.json");
    assert.equal((await verifyBackupManifestAtPath(v1Path)).manifest.manifestVersion, 1);

    const v33Name = "authority-v33.sqlite";
    const v33Path = join(directory, v33Name);
    createHistoricalAuthority(v33Path, 33);
    const v33 = verificationFor(v33Path, 33);
    const v3 = AuthorityBackupManifestSchema.parse({ ...v1, manifestVersion: 3,
      backupFileName: v33Name, schemaVersion: 33, pageCount: v33.inspection.pageCount,
      authorityGeneration: v33.inspection.authorityGeneration,
      authorityContentFingerprint: v33.inspection.authorityContentFingerprint,
      ...fileIdentity(v33Path), verification: v33.verification,
    });
    const v3Path = writeManifest(directory, v3, "authority-v33.v3.manifest.json");
    assert.equal((await verifyBackupManifestAtPath(v3Path)).manifest.schemaVersion, 33);
    assert.equal(AuthorityBackupManifestSchema.safeParse({ ...v3, manifestVersion: 1 }).success, false,
      "new historical admission must not extend the released v1 format");

    const v31Name = "authority-v31.sqlite";
    const v31Path = join(directory, v31Name);
    createHistoricalAuthority(v31Path, 31);
    const settings = initializeSyntheticSettingsBackupRoot(stateRoot);
    const ordinaryRecord = journalHistoricalOrdinarySettings(v31Path, settings.ordinary);
    const v31 = verificationFor(v31Path, 31);
    writeFileSync(settings.protected, "unread credential canary", { mode: 0o600 });
    const ordinaryName = "authority-v31.settings.json";
    const rootAuthorityName = "authority-v31.settings-authority.json";
    writeFileSync(join(directory, ordinaryName), readFileSync(settings.ordinary), { mode: 0o600 });
    writeFileSync(join(directory, rootAuthorityName), readFileSync(settings.authority), { mode: 0o600 });
    const v2 = AuthorityBackupManifestSchema.parse({
      kind: "hrauto-authority-backup",
      manifestVersion: 2,
      backupFileName: v31Name,
      sourceDatabaseIdentity: "b".repeat(64),
      applicationId: v31.inspection.applicationId,
      schemaVersion: v31.inspection.schemaVersion,
      pageCount: v31.inspection.pageCount,
      authorityGeneration: v31.inspection.authorityGeneration,
      authorityContentFingerprint: v31.inspection.authorityContentFingerprint,
      createdAt: NOW,
      ...fileIdentity(v31Path),
      verification: v31.verification,
      files: [
        { role: "authority-database", sourceFileName: "state.db", backupFileName: v31Name, ...fileIdentity(v31Path) },
        { role: "ordinary-settings", sourceFileName: "settings.json", backupFileName: ordinaryName, ...fileIdentity(join(directory, ordinaryName)) },
        { role: "settings-root-authority", sourceFileName: "authority.json", backupFileName: rootAuthorityName, ...fileIdentity(join(directory, rootAuthorityName)) },
      ],
      protectedSettings: { revision: 1, entries: [] },
    });
    const v2Path = writeManifest(directory, v2, "authority-v31.v2.manifest.json");
    assert.equal((await verifyBackupManifestAtPath(v2Path)).manifest.manifestVersion, 2);
    assert.equal(AuthorityBackupManifestSchema.safeParse({ ...v2, schemaVersion: 29 }).success, false);

    const tamperedSettings = { browser: { headless: true } };
    const tamperedOrdinary = SettingsFileRecordSchema.parse({
      ...ordinaryRecord,
      settings: tamperedSettings,
      settingsFingerprint: derivePersistedSettingsFingerprint(tamperedSettings),
    });
    writeFileSync(
      join(directory, ordinaryName),
      `${canonicalJsonStringify(tamperedOrdinary)}\n`,
      { mode: 0o600 },
    );
    if (v2.manifestVersion !== 2) throw new Error("historical fixture is not v2");
    const ordinaryTamperManifest = AuthorityBackupManifestSchema.parse({
      ...v2,
      files: v2.files.map((file, index) => index === 1
        ? { ...file, ...fileIdentity(join(directory, ordinaryName)) }
        : file),
    });
    const ordinaryTamperPath = writeManifest(
      directory,
      ordinaryTamperManifest,
      "authority-v31.ordinary-tamper.manifest.json",
    );
    await assert.rejects(
      verifyBackupManifestAtPath(ordinaryTamperPath),
      /is not its authenticated current journal result/u,
    );

    writeFileSync(
      join(directory, ordinaryName),
      `${canonicalJsonStringify(ordinaryRecord)}\n`,
      { mode: 0o600 },
    );
    const protectedTamperManifest = AuthorityBackupManifestSchema.parse({
      ...v2,
      files: v2.files.map((file, index) => index === 1
        ? { ...file, ...fileIdentity(join(directory, ordinaryName)) }
        : file),
      protectedSettings: {
        revision: 2,
        entries: [{
          name: "ucpathPassword",
          valueId: "33333333-3333-4333-8333-333333333333",
          updatedAt: NOW,
        }],
      },
    });
    const protectedTamperPath = writeManifest(
      directory,
      protectedTamperManifest,
      "authority-v31.protected-tamper.manifest.json",
    );
    await assert.rejects(
      verifyBackupManifestAtPath(protectedTamperPath),
      /does not match its copied singleton/u,
    );
  });

  it.each([
    ["table", "CREATE TABLE unauthorized_table (id INTEGER) STRICT"],
    ["column", "ALTER TABLE tasks ADD COLUMN unauthorized_column TEXT"],
    ["index", "CREATE INDEX unauthorized_index ON tasks(record_key)"],
    ["trigger", `CREATE TRIGGER unauthorized_trigger BEFORE DELETE ON tasks
      BEGIN SELECT RAISE(ABORT, 'unauthorized'); END`],
  ])("refuses a historical schema with an extra %s", (_kind, statement) => {
    const root = temporaryRoot("hrauto-historical-schema-");
    const path = join(root, "state.db");
    createHistoricalAuthority(path, 29);
    const database = new DatabaseSync(path);
    database.exec(statement);
    database.close();
    assert.throws(
      () => inspectAuthorityBackupReadOnly(path, 29),
      /does not match its immutable migration replay/u,
    );
  });

  it("backs up a stopped v29 source as v3 without migrating it", async () => {
    const root = temporaryRoot("hrauto-v29-source-backup-");
    const authorityPath = join(root, "state.db");
    const directory = join(root, "backups");
    createHistoricalAuthority(authorityPath, 29);
    const sourceBytes = readFileSync(authorityPath);
    const source = openAuthorityBackupSourceReadOnly(authorityPath);
    try {
      const service = new AuthorityBackupService(source, { directory }, CLOCK);
      const report = await service.request({ trigger: "schema-migration", requiredGeneration: 7 });
      const manifest = report.manifests[0];
      assert.ok(manifest !== undefined);
      assert.equal(manifest.manifestVersion, 3);
      assert.equal(manifest.schemaVersion, 29);
      assert.equal(source.getMeta().schemaVersion, 29);
      await verifyBackupManifestAtPath(
        join(directory, `${manifest.backupFileName}.manifest.json`),
        source.getSourceDatabaseIdentity(),
      );
    } finally {
      source.close();
    }
    assert.equal(readFileSync(authorityPath).equals(sourceBytes), true);
    assert.equal(existsSync(`${authorityPath}-wal`), false);
    assert.equal(existsSync(`${authorityPath}-shm`), false);
  });
});
