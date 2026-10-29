import assert from "node:assert/strict";
import { copyFileSync, renameSync, readdirSync, lstatSync, readFileSync, existsSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { z } from "zod";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { OfflineAuthorityRestoreService, OfflineRestoreFailure } from "../../../../src/backend/storage/sqlite/offline-restore.js";
import { RecoveryStopProofStore } from "../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot, acquireRuntimeRestoreAdmission, assertRuntimeRestoreAdmission, RestoreAdmissionFileSchema, type RestoreAdmissionHandle } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
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
    const identity = AuthorityDatabase.sourceDatabaseIdentity(fixture.path);
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60_000 }, clock);
    proofs.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: identity }, clock));
    const stoppedSystemProof = proofs.issue({ observedBy: "local-operator", sourceDatabaseIdentity: identity });
    const before = storageTree(fixture.workspace), entries = readdirSync(fixture.workspace, { recursive: true, encoding: "utf8" }).sort();
    const stat = lstatSync(fixture.path);
    const pendingPath = join(processLockRoot, "restore-proofs-pending", stoppedSystemProof.proofId + ".json");
    const consumedPath = join(processLockRoot, "restore-proofs-consumed", stoppedSystemProof.proofId + ".json");
    const pendingBytes = readFileSync(pendingPath), pendingIdentity = fileIdentity(pendingPath);
    assert.deepEqual(JSON.parse(pendingBytes.toString("utf8")), stoppedSystemProof);
    assert.equal(existsSync(consumedPath), false);
    const retainedFiles = Object.fromEntries(Object.keys(before).map(path => [path, {
      ...fileIdentity(join(fixture.workspace, path)), changedAt: lstatSync(join(fixture.workspace, path)).ctimeMs,
    }]));
    const retainedDirectories = Object.fromEntries(entries.filter(path => lstatSync(join(fixture.workspace, path)).isDirectory()).map(path => {
      const metadata = lstatSync(join(fixture.workspace, path));
      return [path, { device: metadata.dev, inode: metadata.ino, mode: metadata.mode, owner: metadata.uid }];
    }));
    const acquisition: { value?: { handle: RestoreAdmissionHandle; bytes: Buffer; identity: ReturnType<typeof fileIdentity> } } = {};
    let copies = 0, replacements = 0, projections = 0;
    const restore = new OfflineAuthorityRestoreService(profileBrowserClosure, fixture.admission,
      { authorityPath: fixture.path, suspectDirectory: join(fixture.stateRoot, "backups", "suspects"), busyTimeoutMs: 250,
        processLockRoot, stoppedProofMaxAgeMs: 60_000 }, async () => { projections++; }, clock,
      { copyFile: (from, to) => { copies++; copyFileSync(from, to); }, atomicReplace: (from, to) => { replacements++; renameSync(from, to); } },
      (input, admissionClock) => {
        const handle = acquireRuntimeRestoreAdmission(input, admissionClock);
        try {
          assertRuntimeRestoreAdmission(handle, processLockRoot);
          const activePath = join(processLockRoot, "restore-admission.lock.json"), bytes = readFileSync(activePath);
          const record = RestoreAdmissionFileSchema.parse(JSON.parse(bytes.toString("utf8")));
          assert.equal(record.admissionId, handle.admissionId); assert.equal(record.pid, process.pid); assert.equal(record.acquiredAt, now);
          assert.equal(acquisition.value, undefined);
          acquisition.value = { handle, bytes, identity: fileIdentity(activePath) };
          return handle;
        } catch (error) {
          try { handle.release(); }
          catch (cleanup) { throw new AggregateError([error, cleanup], "restore-browser-custody-acquisition-close-failed", { cause: cleanup }); }
          throw error;
        }
      }, boundProfileCredentials(fixture.admission));
    await assert.rejects(restore.restore({ manifestPath, stoppedSystemProof }), error => error instanceof OfflineRestoreFailure
      && error.authorityState === "unchanged" && (malformed === "config"
        ? error.cause instanceof Error && error.cause.message === "settings-current-missing-with-history"
        : error.cause instanceof z.ZodError));
    assert.equal(inventory.mock.calls.length, 1); assert.equal(native.mock.calls.length, 0);
    assert.deepEqual([copies, replacements, projections], [0, 0, 0]);
    assert.ok(acquisition.value);
    const acquired = acquisition.value;
    const historyDirectory = join(processLockRoot, "restore-admission-history");
    const historyPath = join(historyDirectory, acquired.handle.admissionId + ".lock.json");
    const pendingRelative = relative(fixture.workspace, pendingPath), consumedRelative = relative(fixture.workspace, consumedPath);
    const historyRelative = relative(fixture.workspace, historyPath);
    assert.equal(existsSync(pendingPath), false);
    assert.deepEqual(readFileSync(consumedPath), pendingBytes);
    assert.deepEqual(fileIdentity(consumedPath), pendingIdentity); assert.equal(lstatSync(consumedPath).nlink, 1);
    assert.deepEqual(readFileSync(historyPath), acquired.bytes);
    assert.deepEqual(fileIdentity(historyPath), acquired.identity); assert.equal(lstatSync(historyPath).nlink, 1);
    assert.deepEqual(RestoreAdmissionFileSchema.parse(JSON.parse(readFileSync(historyPath, "utf8"))),
      RestoreAdmissionFileSchema.parse(JSON.parse(acquired.bytes.toString("utf8"))));
    assert.equal(existsSync(join(processLockRoot, "restore-admission.lock.json")), false);
    assert.throws(() => assertRuntimeRestoreAdmission(acquired.handle, processLockRoot), { message: "restore-admission-handle-released" });
    const expected = { ...before };
    assert.ok(expected[pendingRelative] !== undefined);
    assert.equal(expected[consumedRelative], undefined); assert.equal(expected[historyRelative], undefined);
    delete expected[pendingRelative];
    expected[consumedRelative] = createHash("sha256").update(pendingBytes).digest("hex");
    expected[historyRelative] = createHash("sha256").update(acquired.bytes).digest("hex");
    assert.deepEqual(storageTree(fixture.workspace), expected);
    for (const [path, metadata] of Object.entries(retainedFiles)) {
      if (path === pendingRelative) continue;
      assert.deepEqual({ ...fileIdentity(join(fixture.workspace, path)), changedAt: lstatSync(join(fixture.workspace, path)).ctimeMs }, metadata);
    }
    for (const [path, metadata] of Object.entries(retainedDirectories)) {
      const current = lstatSync(join(fixture.workspace, path));
      assert.deepEqual({ device: current.dev, inode: current.ino, mode: current.mode, owner: current.uid }, metadata);
    }
    const expectedEntries = new Set(entries);
    expectedEntries.delete(pendingRelative); expectedEntries.add(consumedRelative); expectedEntries.add(historyRelative);
    expectedEntries.add(relative(fixture.workspace, historyDirectory));
    assert.deepEqual(readdirSync(fixture.workspace, { recursive: true, encoding: "utf8" }).sort(), [...expectedEntries].sort());
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
  let restore: RestoreAdmissionHandle | undefined;
  let primary: { error: unknown } | undefined;
  try {
    restore = acquireRuntimeRestoreAdmission({ processLockRoot, pid: process.pid }, clock);
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
  let restore: RestoreAdmissionHandle | undefined;
  let primary: { error: unknown } | undefined;
  try {
    restore = acquireRuntimeRestoreAdmission({ processLockRoot, pid: process.pid }, clock);
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
