import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { AuthorityBackupService, AuthorityDatabase, inspectAuthorityBackupReadOnly, verifyBackupManifestAtPath } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { AuthorityBackupManifestSchema } from "../../../../../../src/backend/storage/sqlite/recovery-contracts.js";

const NOW = "2026-09-06T20:00:00.000Z";
const CLOCK = manualClock(new Date(NOW));
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix));
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

describe("DB-only authority backups", () => {
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

  it.each([0, 2])("refuses noncurrent schema %s without changing source bytes", version => {
    const world = openCurrentWorld();
    world.database.close();
    const raw = new DatabaseSync(world.authorityPath);
    try { raw.exec(`PRAGMA user_version=${String(version)}`); } finally { raw.close(); }
    const bytes = readFileSync(world.authorityPath);
    assert.throws(()=>inspectAuthorityBackupReadOnly(world.authorityPath),/normal-authority-schema-mismatch/u);
    assert.deepEqual(readFileSync(world.authorityPath),bytes);
    assert.equal(existsSync(`${world.authorityPath}-wal`),false);
    assert.equal(existsSync(`${world.authorityPath}-shm`),false);
  });

  it.each([
    ["table", "CREATE TABLE unauthorized_table (id INTEGER) STRICT"],
    ["column", "ALTER TABLE runs ADD COLUMN unauthorized_column TEXT"],
    ["index", "CREATE INDEX unauthorized_index ON runs(id)"],
    ["trigger", "CREATE TRIGGER unauthorized_trigger BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT,'unauthorized'); END"],
  ])("refuses a current schema with an extra %s", (_kind, statement) => {
    const world = openCurrentWorld();
    world.database.close();
    const raw = new DatabaseSync(world.authorityPath);
    try { raw.exec(statement); } finally { raw.close(); }
    const bytes = readFileSync(world.authorityPath);
    assert.throws(()=>inspectAuthorityBackupReadOnly(world.authorityPath,1),/authority-native-schema-shape-mismatch/u);
    assert.deepEqual(readFileSync(world.authorityPath),bytes);
    assert.equal(existsSync(`${world.authorityPath}-wal`),false);
    assert.equal(existsSync(`${world.authorityPath}-shm`),false);
  });
});
