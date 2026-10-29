import assert from "node:assert/strict";
import { copyFileSync, renameSync, readdirSync, lstatSync, readFileSync, existsSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { z } from "zod";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService, OfflineRestoreFailure } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { assertOfflineMaintenanceOperation, type OfflineMaintenanceOperation } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import { probeRestoreProfileBrowsersClosed, ProfileRestoreBrowserCustodyUnprovedError } from "../../../../src/backend/storage/maintenance/profile-inventory.js";

function fileIdentity(path: string) {
  const stat = lstatSync(path);
  return { device: stat.dev, inode: stat.ino, mode: stat.mode, owner: stat.uid, size: stat.size, modifiedAt: stat.mtimeMs };
}

for (const malformed of ["browser", "config", "control"] as const) it(`refuses malformed current ${malformed} custody before restore or native browser effects`, async () => {
  const fixture = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const processLockRoot = join(fixture.workspace, rebuildRuntimeIsolation.processLockRoot);
  const directory = join(fixture.stateRoot, "backups", "authority"), now = clock.now().toISOString();
  let primary: { error: unknown } | undefined;
  const native = vi.spyOn(profileBrowserClosure, "probeClosed");
  const inventory = vi.spyOn(AuthorityDatabase, "readProfileRestoreBrowserInventory");
  try {
    const database = AuthorityDatabase.open(fixture.admission, { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "restore-browser-custody" }, clock,
      undefined, undefined, undefined, boundProfileCredentials(fixture.admission));
    let manifestPath: string;
    try {
      const report = await new AuthorityBackupService(fixture.admission, database, { directory }, clock)
        .request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration });
      const manifest = report.manifests[0]; assert.ok(manifest);
      manifestPath = join(directory, manifest.backupFileName + ".manifest.json");
    } finally { database.close(); }
    const raw = new DatabaseSync(fixture.path, { enableForeignKeyConstraints: false });
    try {
      if (malformed === "browser") raw.prepare(`INSERT INTO browser_sessions
        (id,worker_id,lease_generation,system,state,auth_fingerprint,presentation,profile_revision,payload_json,opened_at,observed_at)
        VALUES(?,?,1,'ucpath','unknown',?,'headless',1,'{}',?,?)`).run("malformed-browser", "missing-worker", "a".repeat(64), now, now);
      if (malformed === "config") raw.prepare(`INSERT INTO settings_snapshots
        (id,revision,fingerprint,payload_json,captured_at) VALUES(?,1,?,'{}',?)`).run("malformed-config", "a".repeat(64), now);
      if (malformed === "control") raw.prepare(`INSERT INTO worker_controls
        (command_id,scope,worker_id,phase,audited_at,payload_json,created_at)
        VALUES(?,'worker',NULL,'admitted',NULL,'{}',?)`).run("malformed-control", now);
    } finally { raw.close(); }


    const operation = fixture.admission.acquireOfflineMaintenance();
    const before = storageTree(fixture.workspace), entries = readdirSync(fixture.workspace, { recursive: true, encoding: "utf8" }).sort();
    const stat = lstatSync(fixture.path);
    const retainedFiles = Object.fromEntries(Object.keys(before).map(path => [path, {
      ...fileIdentity(join(fixture.workspace, path)), changedAt: lstatSync(join(fixture.workspace, path)).ctimeMs,
    }]));
    const retainedDirectories = Object.fromEntries(entries.filter(path => lstatSync(join(fixture.workspace, path)).isDirectory()).map(path => {
      const metadata = lstatSync(join(fixture.workspace, path));
      return [path, { device: metadata.dev, inode: metadata.ino, mode: metadata.mode, owner: metadata.uid }];
    }));
    let copies = 0, replacements = 0, projections = 0;
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, fixture.admission,
      { authorityPath: fixture.path, suspectDirectory: join(fixture.stateRoot, "backups", "suspects"), busyTimeoutMs: 250,
        processLockRoot}, async () => { projections++; }, clock,
      { copyFile: (from, to) => { copies++; copyFileSync(from, to); }, atomicReplace: (from, to) => { replacements++; renameSync(from, to); } }, boundProfileCredentials(fixture.admission));
    await assert.rejects(restore.restore({ manifestPath }, operation), error => error instanceof OfflineRestoreFailure
      && error.authorityState === "unchanged" && (malformed === "config"
        ? error.cause instanceof Error && error.cause.message === "settings-current-missing-with-history"
        : error.cause instanceof z.ZodError));
    assert.equal(inventory.mock.calls.length, 1); assert.equal(native.mock.calls.length, 0);
    assert.deepEqual([copies, replacements, projections], [0, 0, 0]);
    assert.throws(() => assertOfflineMaintenanceOperation(operation, fixture.workspace), /offline-maintenance-unissued/u);
    assert.deepEqual(storageTree(fixture.workspace), before);
    for (const [path, metadata] of Object.entries(retainedFiles)) {
      assert.deepEqual({ ...fileIdentity(join(fixture.workspace, path)), changedAt: lstatSync(join(fixture.workspace, path)).ctimeMs }, metadata);
    }
    for (const [path, metadata] of Object.entries(retainedDirectories)) {
      const current = lstatSync(join(fixture.workspace, path));
      assert.deepEqual({ device: current.dev, inode: current.ino, mode: current.mode, owner: current.uid }, metadata);
    }
    assert.deepEqual(readdirSync(fixture.workspace, { recursive: true, encoding: "utf8" }).sort(), entries);
    const after = lstatSync(fixture.path);
    assert.deepEqual([after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs], [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
  } catch (error) { primary = { error }; }
  native.mockRestore(); inventory.mockRestore();
  try { await fixture.close(); }
  catch (error) { throw new AggregateError(primary === undefined ? [error] : [primary.error, error], "restore-browser-custody-close-failed", { cause: error }); }
  if (primary !== undefined) throw primary.error;
});

for (const changed of [false, true]) it(`probes every physical browser directory without readable SQLite and ${changed ? "refuses a changed census" : "proves an unchanged census"}`, async () => {
  const fixture = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const processLockRoot = join(fixture.workspace, rebuildRuntimeIsolation.processLockRoot);
  const profileRoot = join(fixture.stateRoot, "browsers"), paths = [join(profileRoot, "w17", "ucpath"), join(profileRoot, "w23", "onbase")];
  const nativeProbe = profileBrowserClosure.probeClosed;
  const native = vi.spyOn(profileBrowserClosure, "probeClosed").mockImplementation(async (...args) => {
    await nativeProbe(...args);
    if (changed) mkdirSync(join(profileRoot, "w31", "ucpath"), { recursive: true, mode: 0o700 });
  });
  let restore: OfflineMaintenanceOperation | undefined;
  let primary: { error: unknown } | undefined;
  try {
    restore = fixture.admission.acquireOfflineMaintenance();
    for (const path of paths) mkdirSync(path, { recursive: true, mode: 0o700 });
    const corrupted = readFileSync(fixture.path);
    corrupted.fill(0x5a, 4096, Math.min(corrupted.length, 40_960)); writeFileSync(fixture.path, corrupted);
    const before = fileIdentity(fixture.path), source = readFileSync(fixture.path);
    const proof = probeRestoreProfileBrowsersClosed(fixture.admission, processLockRoot, restore, clock, profileBrowserClosure);
    if (changed) await assert.rejects(proof, ProfileRestoreBrowserCustodyUnprovedError);
    else await proof;
    assert.equal(native.mock.calls.length, 1);
    assert.deepEqual(native.mock.calls[0]?.[0], paths.map(profileDirectory => ({ profileRoot, profileDirectory, cleanupCompleted: false })));
    assert.deepEqual(readFileSync(fixture.path), source); assert.deepEqual(fileIdentity(fixture.path), before);
    assert.equal(existsSync(join(fixture.stateRoot, "backups", "suspects")), false);
    fixture.lifetime.assertHeld();
    assert.throws(() => fixture.machine.beginOfflineMaintenance(), /offline-maintenance-busy/u);
    restore.release();
    const successor = fixture.machine.beginOfflineMaintenance(); successor.release();
  } catch (error) { primary = { error }; }
  native.mockRestore();
  if (primary?.error instanceof AuthoritySourceClosureUnprovedError) throw primary.error;
  try { restore?.release(); await fixture.close(); }
  catch (error) { throw new AggregateError(primary === undefined ? [error] : [primary.error, error], "physical-browser-census-close-failed", { cause: error }); }
  if (primary !== undefined) throw primary.error;
});

for (const unsafe of ["unknown-directory", "noncanonical-root", "symlink", "unsupported-platform"] as const) it(`refuses ${unsafe} physical browser custody without native or source effects`, async () => {
  const fixture = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const processLockRoot = join(fixture.workspace, rebuildRuntimeIsolation.processLockRoot), profileRoot = join(fixture.stateRoot, "browsers");
  const platform = Object.getOwnPropertyDescriptor(process, "platform"); assert.ok(platform);
  const native = vi.spyOn(profileBrowserClosure, "probeClosed");
  let restore: OfflineMaintenanceOperation | undefined;
  let primary: { error: unknown } | undefined;
  try {
    restore = fixture.admission.acquireOfflineMaintenance();
    mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
    if (unsafe === "unknown-directory") mkdirSync(join(profileRoot, "foreign"), { mode: 0o700 });
    if (unsafe === "symlink") symlinkSync(fixture.stateRoot, join(profileRoot, "w17"));
    if (unsafe === "noncanonical-root") mkdirSync(join(fixture.stateRoot, "custom-browser-root", "w17", "ucpath"), { recursive: true, mode: 0o700 });
    const corrupted = readFileSync(fixture.path);
    corrupted.fill(0x5a, 4096, Math.min(corrupted.length, 40_960)); writeFileSync(fixture.path, corrupted);
    const before = storageTree(fixture.workspace), source = fileIdentity(fixture.path);
    if (unsafe === "unsupported-platform") Object.defineProperty(process, "platform", { value: "linux" });
    await assert.rejects(probeRestoreProfileBrowsersClosed(fixture.admission, processLockRoot, restore, clock, profileBrowserClosure),
      error => unsafe === "symlink" && process.platform === "darwin"
        ? error instanceof Error && error.message === "profile-process-closure-unproved"
        : error instanceof ProfileRestoreBrowserCustodyUnprovedError && error.code === "PROFILE_RESTORE_BROWSER_CUSTODY_UNPROVED");
    assert.equal(native.mock.calls.length, 0);
    assert.deepEqual(storageTree(fixture.workspace), before); assert.deepEqual(fileIdentity(fixture.path), source);
  } catch (error) { primary = { error }; }
  Object.defineProperty(process, "platform", platform); native.mockRestore();
  if (primary?.error instanceof AuthoritySourceClosureUnprovedError) throw primary.error;
  try { restore?.release(); await fixture.close(); }
  catch (error) { throw new AggregateError(primary === undefined ? [error] : [primary.error, error], "unsafe-browser-census-close-failed", { cause: error }); }
  if (primary !== undefined) throw primary.error;
});
