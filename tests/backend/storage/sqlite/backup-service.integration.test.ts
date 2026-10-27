import { createBackupFixtures } from "../../../support/helpers/storage/backup-fixtures.js";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { afterEach,describe,it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";

const NOW = "2026-09-06T20:00:00.000Z";
const CLOCK = manualClock(new Date(NOW));
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of [...cleanups]) { cleanup(); cleanups.splice(cleanups.indexOf(cleanup), 1); } });
const { openCurrentWorld, takeBackup } = createBackupFixtures(cleanups, CLOCK);


describe("DB-only authority backups", () => {

  it("preserves checksum and source-identity refusals", async () => {
    const world = await openCurrentWorld();
    const { manifest, manifestPath } = await takeBackup(world);
    await assert.rejects(
      verifyBackupManifestAtPath(world.admission, manifestPath, "f".repeat(64)),
      /belongs to a different authority database/u,
    );
    writeFileSync(join(world.backupDirectory, manifest.backupFileName), "tampered");
    await assert.rejects(
      verifyBackupManifestAtPath(world.admission, manifestPath),
      /byte size does not match verified manifest/u,
    );
  });

  it.each([0, 1])("refuses noncurrent schema %s without changing source bytes", async version => {
    const world = await openCurrentWorld();
    world.closeDatabase();
    const raw = new DatabaseSync(world.authorityPath);
    try { raw.exec(`PRAGMA user_version=${String(version)}`); } finally { raw.close(); }
    const bytes = readFileSync(world.authorityPath);
    const inspection = world.machine.verifiedReadOnlyCopy(world.authorityPath, createHash("sha256").update(bytes).digest("hex"));
    assert.throws(() => inspection.assertProfileRuntime(), /profile-bound-authority-required/);
    try { assert.throws(()=>inspectAuthorityBackupReadOnly(inspection, world.authorityPath),/normal-authority-schema-mismatch/u); } finally { inspection.release(); }
    assert.deepEqual(readFileSync(world.authorityPath),bytes);
    assert.equal(existsSync(`${world.authorityPath}-wal`),false);
    assert.equal(existsSync(`${world.authorityPath}-shm`),false);
  });

  it.each([
    ["table", "CREATE TABLE unauthorized_table (id INTEGER) STRICT"],
    ["column", "ALTER TABLE runs ADD COLUMN unauthorized_column TEXT"],
    ["index", "CREATE INDEX unauthorized_index ON runs(id)"],
    ["trigger", "CREATE TRIGGER unauthorized_trigger BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT,'unauthorized'); END"],
  ])("refuses a current schema with an extra %s", async (_kind, statement) => {
    const world = await openCurrentWorld();
    world.closeDatabase();
    const raw = new DatabaseSync(world.authorityPath);
    try { raw.exec(statement); } finally { raw.close(); }
    const bytes = readFileSync(world.authorityPath);
    const inspection = world.machine.verifiedReadOnlyCopy(world.authorityPath, createHash("sha256").update(bytes).digest("hex"));
    assert.throws(() => inspection.assertProfileRuntime(), /profile-bound-authority-required/);
    try { assert.throws(()=>inspectAuthorityBackupReadOnly(inspection, world.authorityPath,CURRENT_AUTHORITY_SCHEMA_VERSION),/authority-native-schema-shape-mismatch/u); } finally { inspection.release(); }
    assert.deepEqual(readFileSync(world.authorityPath),bytes);
    assert.equal(existsSync(`${world.authorityPath}-wal`),false);
    assert.equal(existsSync(`${world.authorityPath}-shm`),false);
  });
});
