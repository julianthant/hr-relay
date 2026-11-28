import { syncBuiltinESMExports } from "node:module";
import assert from "node:assert/strict";
import type { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import nativeFs, { existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import { composeDashboardApplication } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { backupRegisteredPeopleAtCleanShutdown, detachedShutdownBackup, initializeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService, backupLogPaths, verifyBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";

it("keeps three verified shutdown backups for a signed-out person and preserves the pre-upgrade backup", async () => {
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
    createProfileRegistry(f.machine).advanceSession(null);
    f.admission.release(); f.machine.release();
    for (let index = 0; index < 5; index++) { clock.advanceWall(1000); await backupRegisteredPeopleAtCleanShutdown(f.workspace, f.lifetime, clock); }
    const names = readdirSync(directory).filter(name => name.endsWith(".manifest.json"));
    assert.equal(names.length, 4); assert.equal(names.filter(name => name.endsWith(".shutdown.sqlite.manifest.json")).length, 3);
    assert.deepEqual(readdirSync(directory).sort(), names.flatMap(manifest => {
      const name = manifest.slice(0, -".manifest.json".length);
      return [manifest, name, ...backupLogPaths(name)];
    }).sort());
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

// A person with no backup yet has no backup directory either.
const shutdownManifestCount = (directory: string) => existsSync(directory)
  ? readdirSync(directory).filter(name => name.endsWith(".shutdown.sqlite.manifest.json")).length : 0;

it("hands the quit-time backup of a stopping dashboard to one detached finisher and takes none itself", async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-11-02T12:00:00.000Z"));
  const profileId = f.admission.profileBinding.profileId, directory = join(f.stateRoot, "backups", "authority");
  const spawned: { command: string; args: readonly string[]; options: unknown; unref: number }[] = [];
  const spawnStub = ((command: string, args: readonly string[], options: unknown) => {
    const record = { command, args, options, unref: 0 }; spawned.push(record);
    const child = Object.assign(new EventEmitter(), { unref: () => { record.unref++; } });
    queueMicrotask(() => child.emit("spawn"));
    return child;
  }) as unknown as typeof spawn;
  const launch = { command: "/synthetic/node", prefixArgs: ["bootstrap.ts", "cli"], environment: { PATH: "/usr/bin" }, cwd: "/synthetic/repo" };
  const application = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation,
    repoRoot: process.cwd(), backendPortOverride: 0, frontendPortOverride: 0, env: {}, clock, preflightRunnerFactory: healthyRuntimePreflightRunners,
    shutdownBackup: detachedShutdownBackup(launch, spawnStub) });
  const request = vi.spyOn(AuthorityBackupService.prototype, "request");
  try {
    await application.stop();
    assert.equal(request.mock.calls.length, 0);
    assert.deepEqual(spawned.map(value => ({ command: value.command, args: value.args, unref: value.unref })),
      [{ command: "/synthetic/node", args: ["bootstrap.ts", "cli", "storage", "finish-shutdown-backup", f.workspace, profileId], unref: 1 }]);
    // oxlint-disable-next-line no-unsafe-optional-chaining -- Missing spawn options must fail this assertion.
    assert.equal((spawned[0]?.options as { detached?: boolean }).detached, true);
    assert.equal(shutdownManifestCount(directory), 0);
  } finally { request.mockRestore(); await f.close(); }
});

it("backs up only the people handed to the finisher", async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-11-02T12:00:00.000Z"));
  const profileId = f.admission.profileBinding.profileId, directory = join(f.stateRoot, "backups", "authority");
  f.admission.release(); f.machine.release();
  try {
    clock.advanceWall(1000); await backupRegisteredPeopleAtCleanShutdown(f.workspace, f.lifetime, clock, new Set([randomUUID()]));
    assert.equal(shutdownManifestCount(directory), 0);
    clock.advanceWall(1000); await backupRegisteredPeopleAtCleanShutdown(f.workspace, f.lifetime, clock, new Set([profileId]));
    assert.equal(shutdownManifestCount(directory), 1);
  } finally { await f.close(); }
});
