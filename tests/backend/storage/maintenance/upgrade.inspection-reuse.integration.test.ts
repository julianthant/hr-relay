import assert from "node:assert/strict";
import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { initializeRegisteredPersonStores, upgradeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { readLocalDebugLog } from "../../../../src/backend/storage/events/local-debug-log.js";
import { backupStoppedAuthority, upgradeReadyProfileStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { prepareStoppedBackupClosure } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { AuthorityDatabase, inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { verifyBackupManifestAtPath, verifyStoppedBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { hostFacts, readyBoundEight } from "../../../support/helpers/storage/ready-bound-upgrade.js";

it("fully verifies an unchanged READY source once while qualifying and planning the upgrade", async () => {
  const fixture = await readyBoundEight();
  const sql = vi.spyOn(DatabaseSync.prototype, "prepare");
  try {
    const report = await upgradeReadyProfileStorage(profileBrowserClosure, fixture.machine, fixture.claim, { plan: true, hostFacts }, systemClock);
    assert.equal(report.state, "planned");
    assert.equal(sql.mock.calls.filter(([query]) => query === "PRAGMA quick_check(1)").length, 1);
  } finally {
    sql.mockRestore();
    await fixture.close();
  }
});

it("invalidates registered-person verification on replacement of the main file or changes to SQLite companions", async () => {
  const fixture = await readyBoundEight();
  const operation = fixture.acquireRestore();
  const sql = vi.spyOn(DatabaseSync.prototype, "prepare");
  const inspect = () => AuthorityDatabase.inspectRegisteredPersonAtStartup(fixture.machine, fixture.claim);
  const checks = () => sql.mock.calls.filter(([query]) => query === "PRAGMA quick_check(1)").length;
  try {
    await AuthorityDatabase.withUpgradeInspections(async () => {
      const first = inspect();
      assert.deepEqual(inspect(), first);
      assert.equal(checks(), 1);
      copyFileSync(fixture.path, fixture.path + ".replacement");
      renameSync(fixture.path + ".replacement", fixture.path);
      assert.deepEqual(inspect(), first);
      assert.equal(checks(), 2);
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        const path = fixture.path + suffix;
        assert.equal(existsSync(path), false);
        const before = checks();
        writeFileSync(path, "", { mode: 0o600, flag: "wx" });
        assert.deepEqual(inspect(), first);
        assert.equal(checks(), before + 1);
        unlinkSync(path);
        assert.deepEqual(inspect(), first);
        assert.equal(checks(), before + 2);
      }
      const writer = new DatabaseSync(fixture.path);
      try {
        writer.exec("BEGIN EXCLUSIVE");
        const before = checks();
        inspectNativeAuthority(writer, first.schemaVersion);
        inspectNativeAuthority(writer, first.schemaVersion);
        assert.equal(checks(), before + 2);
        writer.exec("ROLLBACK");
      } finally { writer.close(); }
      writeFileSync(fixture.path + "-journal", "unsettled", { mode: 0o600, flag: "wx" });
      assert.throws(inspect, /journal-unsettled/u);
    });
  } finally {
    sql.mockRestore();
    operation.release();
    await fixture.close();
  }
});

it("records the startup stages and reads back the migrated authority", async () => {
  const fixture = await readyBoundEight();
  try {
    fixture.machine.release();
    await upgradeRegisteredPersonStores(fixture.workspace, fixture.lifetime, hostFacts);
    const log = readLocalDebugLog(join(fixture.workspace, rebuildRuntimeIsolation.stateRoot));
    assert.equal(log.state, "present");
    const stages = log.records.flatMap(record => record.payload.kind === "debug" && record.payload.event.area === "profile-startup-upgrade"
      && record.payload.event.phase === "started" ? [record.payload.event.reason] : []);
    assert.deepEqual(stages, ["admission", "backup-closure", "backup", "migration", "readback"]);
    const migrated = new DatabaseSync(fixture.path, { readOnly: true });
    try { assert.equal(migrated.prepare("PRAGMA user_version").get()?.user_version, CURRENT_AUTHORITY_SCHEMA_VERSION); }
    finally { migrated.close(); }
  } finally {
    await fixture.close();
  }
});

it("checks current-schema registration twice at startup with one full inspection", async () => {
  const fixture = await createBoundProfileFixture();
  const inspect = AuthorityDatabase.inspectRegisteredPersonAtStartup.bind(AuthorityDatabase);
  const sql = vi.spyOn(DatabaseSync.prototype, "prepare");
  const count = () => sql.mock.calls.filter(([query]) => query === "PRAGMA quick_check(1)").length;
  const checks: number[] = [];
  const registration = vi.spyOn(AuthorityDatabase, "inspectRegisteredPersonAtStartup").mockImplementation((machine, profileId) => {
    const before = count();
    const result = inspect(machine, profileId);
    checks.push(count() - before);
    return result;
  });
  try {
    fixture.admission.release();
    fixture.machine.release();
    await initializeRegisteredPersonStores(fixture.workspace, fixture.lifetime, hostFacts);
    assert.deepEqual(checks, [1, 0]);
  } finally {
    registration.mockRestore();
    sql.mockRestore();
    await fixture.close();
  }
});

it("shares full inspection of an unchanged backup while verifying the manifest binding and backup bytes on each read", async () => {
  const fixture = await readyBoundEight(), operation = fixture.acquireRestore();
  try {
    const owner = await fixture.machine.forStoppedProfileUpgrade(profileBrowserClosure, fixture.claim, operation, systemClock, hostFacts);
    try {
      const closure = await prepareStoppedBackupClosure(profileBrowserClosure, owner, operation, systemClock, fixture.processLockRoot);
      const backup = await backupStoppedAuthority(closure, owner, fixture.stateRoot, systemClock, fixture.processLockRoot, operation, "schema-migration");
      const manifest = backup.manifests[0];
      assert.ok(manifest);
      const path = join(fixture.stateRoot, "backups", "authority", manifest.backupFileName);
      const manifestPath = path + ".manifest.json";
      const sql = vi.spyOn(DatabaseSync.prototype, "prepare");
      try {
        await AuthorityDatabase.withUpgradeInspections(async () => {
          const stopped = verifyStoppedBackupManifestAtPath(owner, manifestPath);
          assert.deepEqual(await verifyBackupManifestAtPath(owner, manifestPath), stopped);
          assert.equal(sql.mock.calls.filter(([query]) => query === "PRAGMA quick_check(1)").length, 1);
          const saved = readFileSync(manifestPath);
          const foreignId = "00000000-0000-4000-8000-000000000001";
          writeFileSync(manifestPath, JSON.stringify({ ...manifest, profileId: foreignId, verification: { ...manifest.verification, profileId: foreignId } }));
          assert.throws(() => verifyStoppedBackupManifestAtPath(owner, manifestPath), /backup-profile-binding-mismatch/u);
          writeFileSync(manifestPath, saved);
          const bytes = readFileSync(path);
          bytes.writeUInt8(bytes.readUInt8(0) ^ 1, 0);
          writeFileSync(path, bytes);
          await assert.rejects(verifyBackupManifestAtPath(owner, manifestPath), /checksum does not match/u);
        });
      } finally { sql.mockRestore(); }
    } finally { owner.release(); }
  } finally {
    operation.release();
    await fixture.close();
  }
});
