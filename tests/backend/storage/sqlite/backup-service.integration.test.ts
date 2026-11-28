import { createBackupFixtures } from "../../../support/helpers/storage/backup-fixtures.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { afterEach,describe,it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { authoritySourceDatabaseIdentity } from "../../../../src/backend/storage/sqlite/database-identity.js";
import { backupLogPaths, verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { doctorAuthorityStorage } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { upgradeProfileAtStartup, upgradeReadyProfileStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { hostFacts, readyBoundEight } from "../../../support/helpers/storage/ready-bound-upgrade.js";

const NOW = "2026-09-06T20:00:00.000Z";
const CLOCK = manualClock(new Date(NOW));
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of [...cleanups]) { cleanup(); cleanups.splice(cleanups.indexOf(cleanup), 1); } });
const { openCurrentWorld, takeBackup } = createBackupFixtures(cleanups, CLOCK);


describe("DB-only authority backups", () => {

  it.skipIf(process.platform === "win32")("upgrades after interrupted backup publication and retains only a verified backup for recovery", async () => {
    const f = await readyBoundEight();
    try {
      const directory = join(f.stateRoot, "backups", "authority");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const stage = join(directory, `.authority-${randomUUID()}.sqlite.tmp`);
      const token = randomUUID();
      const unpublishedStage = join(directory, `.authority-${token}.sqlite.tmp`);
      const unpublished = join(directory, `authority-g0-20260906200000000-${token}.sqlite`);
      const interruption = spawnSync(process.execPath, ["--input-type=module", "-e", `
        import { readFileSync, writeFileSync, renameSync } from "node:fs";
        import { DatabaseSync } from "node:sqlite";
        const [source, stage, unpublishedStage, unpublished] = process.argv.slice(1);
        const bytes = readFileSync(source);
        writeFileSync(stage, bytes.subarray(0, 128), { mode: 0o600 });
        writeFileSync(unpublishedStage, bytes, { mode: 0o600 });
        const untrusted = new DatabaseSync(unpublishedStage);
        untrusted.exec("PRAGMA application_id=0");
        untrusted.close();
        renameSync(unpublishedStage, unpublished);
        process.kill(process.pid, "SIGKILL");
      `, f.path, stage, unpublishedStage, unpublished], { encoding: "utf8" });
      assert.equal(interruption.signal, "SIGKILL", interruption.stderr);
      const partialBytes = readFileSync(stage), unpublishedBytes = readFileSync(unpublished);

      await assert.rejects(
        upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: true, hostFacts }, CLOCK),
        /profile-stopped-upgrade-backup-membership-unproved/u,
      );
      assert.deepEqual(readFileSync(stage), partialBytes);
      assert.deepEqual(readFileSync(unpublished), unpublishedBytes);

      const retry = await upgradeProfileAtStartup(profileBrowserClosure, f.machine, f.claim, hostFacts, CLOCK);
      assert.equal(retry.state, "upgraded");
      assert.equal(existsSync(stage), false);
      assert.equal(existsSync(unpublished), false);
      const manifests = readdirSync(directory).filter(name => name.endsWith(".manifest.json"));
      assert.equal(manifests.length, 1);
      const manifestPath = join(directory, manifests[0]);
      const admission = f.machine.admitProfile(f.claim);
      let verified: Awaited<ReturnType<typeof verifyBackupManifestAtPath>>;
      try {
        verified = await verifyBackupManifestAtPath(admission, manifestPath);
        assert.equal(verified.manifest.schemaVersion, 8);
        assert.deepEqual(readdirSync(directory).sort(), [verified.manifest.backupFileName, manifests[0]].sort());
        const report = await doctorAuthorityStorage(admission, {
          authorityPath: f.path, stateRoot: f.stateRoot, stateRootTrustAnchor: f.workspace,
          backupDirectory: directory, busyTimeoutMs: 250,
        }, CLOCK);
        assert.equal(report.spanAuthority.state, "reconciled", JSON.stringify(report.spanAuthority));
      } finally { admission.release(); }

      const recordedBytes = readFileSync(verified.backupPath);
      rmSync(manifestPath);
      await assert.rejects(upgradeProfileAtStartup(profileBrowserClosure, f.machine, f.claim, hostFacts, CLOCK),
        /profile-stopped-upgrade-backup-membership-unproved/u);
      assert.deepEqual(readFileSync(verified.backupPath), recordedBytes);
    } finally { await f.close(); }
  });

  it("preserves checksum and source-identity refusals", async () => {
    const world = await openCurrentWorld();
    const { manifest, manifestPath } = await takeBackup(world);
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, sourceDatabaseIdentity: "f".repeat(64) }));
    await assert.rejects(
      verifyBackupManifestAtPath(world.admission, manifestPath),
      /belongs to a different authority database/u,
    );
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(join(world.backupDirectory, manifest.backupFileName), "tampered");
    await assert.rejects(
      verifyBackupManifestAtPath(world.admission, manifestPath),
      /byte size does not match verified manifest/u,
    );
  });

  it("checks the issued profile against both manifest and inspected copy", async () => {
    const world = await openCurrentWorld(), other = await openCurrentWorld();
    const own = await takeBackup(world), foreign = await takeBackup(other);
    const binding = world.admission.profileBinding;
    const otherBinding = other.admission.profileBinding;
    writeFileSync(own.manifestPath, JSON.stringify({ ...own.manifest, ...otherBinding,
      sourceDatabaseIdentity: authoritySourceDatabaseIdentity({ kind: "profile", binding }),
      verification: { ...own.manifest.verification, ...otherBinding } }));
    await assert.rejects(verifyBackupManifestAtPath(world.admission, own.manifestPath), /backup-profile-binding-mismatch/u);

    const foreignPath = join(other.backupDirectory, foreign.manifest.backupFileName);
    const ownPath = join(world.backupDirectory, own.manifest.backupFileName);
    const ownFiles = [ownPath, ...backupLogPaths(ownPath)];
    [foreignPath, ...backupLogPaths(foreignPath)].forEach((path, index) => copyFileSync(path, ownFiles[index]));
    writeFileSync(own.manifestPath, JSON.stringify({ ...foreign.manifest, ...binding,
      backupFileName: own.manifest.backupFileName,
      sourceDatabaseIdentity: authoritySourceDatabaseIdentity({ kind: "profile", binding }),
      verification: { ...foreign.manifest.verification, ...binding } }));
    await assert.rejects(verifyBackupManifestAtPath(world.admission, own.manifestPath), /backup-profile-binding-mismatch/u);
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
