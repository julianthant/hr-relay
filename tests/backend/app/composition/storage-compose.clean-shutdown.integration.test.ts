import { syncBuiltinESMExports } from "node:module";
import assert from "node:assert/strict";
import nativeFs, { mkdirSync,readFileSync,readdirSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import { composeDashboardApplication } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { backupRegisteredPeopleAtCleanShutdown, initializeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService, verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";

it("keeps the last three verified shutdown backups and preserves an independent pre-upgrade backup", async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-11-02T12:00:00.000Z"));
  const profileId = f.admission.profileBinding.profileId;
  const directory = join(f.stateRoot, "backups", "authority"), credentialsPath = join(f.stateRoot, "credentials", "protected.json");
  const files = join(f.stateRoot, "files"), retainedFile = join(files, "retained-output.txt");
  mkdirSync(files, { mode: 0o700 }); writeFileSync(retainedFile, "synthetic retained workflow output", { mode: 0o600 });
  const retainedBytes = readFileSync(retainedFile);
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "shutdown-retention-fixture" }, clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  try {
    const protectedBackup = await new AuthorityBackupService(f.admission, database, { directory }, clock).request({ trigger: "schema-migration", requiredGeneration: database.getMeta().authorityGeneration });
    database.close(); const source = readFileSync(f.path), credentials = readFileSync(credentialsPath);
    const manifest = protectedBackup.manifests[0]; assert.ok(manifest);
    const originalBackup = readFileSync(join(directory, manifest.backupFileName)), originalManifest = readFileSync(join(directory, `${manifest.backupFileName}.manifest.json`));
    f.admission.release(); f.machine.release();
    for (let index = 0; index < 5; index++) { clock.advanceWall(1000); await backupRegisteredPeopleAtCleanShutdown(f.workspace, f.lifetime, clock); }
    const names = readdirSync(directory).filter(name => name.endsWith(".manifest.json"));
    assert.equal(names.length, 4); assert.equal(names.filter(name => name.endsWith(".shutdown.sqlite.manifest.json")).length, 3);
    assert.deepEqual(readFileSync(join(directory, manifest.backupFileName)), originalBackup);
    assert.deepEqual(readFileSync(join(directory, `${manifest.backupFileName}.manifest.json`)), originalManifest);
    assert.deepEqual(readFileSync(f.path), source); assert.deepEqual(readFileSync(credentialsPath), credentials);
    assert.deepEqual(readFileSync(retainedFile), retainedBytes);
    const machine = (await import("../../../../src/backend/storage/admission/admission.js")).RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
    const owner = machine.admitStoppedProfileRepair(profileId, machine.maintenanceOperation());
    try { for (const name of names) await verifyBackupManifestAtPath(owner, join(directory, name)); }
    finally { owner.release(); machine.release(); }
  } finally { database.close(); await f.close(); }
});

for (const failed of [false, true]) it(`owns one backup through actual application stop (backup failure: ${failed})`, async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-11-02T12:00:00.000Z"));
  const database = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "shutdown-stop-fixture" }, clock);
  const generation = database.getMeta().authorityGeneration; database.close();
  const application = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation,
    repoRoot: process.cwd(), backendPortOverride: 0, frontendPortOverride: 0, env: {}, clock, preflightRunnerFactory: healthyRuntimePreflightRunners });
  const request = vi.spyOn(AuthorityBackupService.prototype, "request");
  if (failed) request.mockRejectedValue(new Error("synthetic automatic backup failure"));
  try {
    if (failed) {
      const before = readFileSync(f.path);
      await assert.rejects(application.stop(), error => error instanceof AggregateError && error.errors.length > 0); f.lifetime.assertHeld();
      assert.deepEqual(readFileSync(f.path), before); await assert.rejects(application.stop());
    } else { await application.stop(); await application.stop(); }
    assert.equal(request.mock.calls.length, 1);
    assert.deepEqual(request.mock.calls[0]?.[0], { trigger: "graceful-drain", requiredGeneration: generation });
  } finally { request.mockRestore(); await f.close(); }
});

it("finishes an interrupted shutdown backup retirement at the next startup before complete backup inventory", async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-11-02T12:00:00.000Z"));
  const directory = join(f.stateRoot, "backups", "authority"), source = readFileSync(f.path);
  f.admission.release(); f.machine.release();
  try {
    for (let index = 0; index < 3; index++) { clock.advanceWall(1000); await backupRegisteredPeopleAtCleanShutdown(f.workspace, f.lifetime, clock); }
    const unlink = nativeFs.unlinkSync; let interrupted = false;
    const fault = vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
      if (!interrupted && String(path).endsWith(".manifest.json.retiring")) { interrupted = true; throw new Error("native fixture retirement interruption"); }
      unlink(path);
    }); syncBuiltinESMExports();
    try {
      clock.advanceWall(1000);
      await assert.rejects(backupRegisteredPeopleAtCleanShutdown(f.workspace, f.lifetime, clock));
      assert.equal(interrupted, true); assert.equal(readdirSync(directory).filter(name => name.endsWith(".retiring")).length, 1);
    } finally { fault.mockRestore(); syncBuiltinESMExports(); }
    await initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, clock);
    assert.equal(readdirSync(directory).filter(name => name.endsWith(".retiring")).length, 0);
    assert.equal(readdirSync(directory).filter(name => name.endsWith(".manifest.json")).length, 3);
    assert.deepEqual(readFileSync(f.path), source);
    f.lifetime.assertHeld();
  } finally { await f.close(); }
});
