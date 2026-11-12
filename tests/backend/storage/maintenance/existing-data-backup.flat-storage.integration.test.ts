import { prePreferencesSettingsRow } from "../../../support/fixtures/storage/person-preferences-predecessor.js";
import { convertPersonPreferencesRow } from "../../../../src/backend/storage/sqlite/person-preferences-migration.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { testProcessImport } from "../../../support/compiled-process.js";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import nativeFs, { lstatSync, chmodSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, it, vi } from "vitest";
import { acquireFlatArchiveFixture } from "../../../support/helpers/storage/flat-archive-admission.js";
import { prepareStoppedBackupClosure } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { backupFlatStorage } from "../../../../src/backend/storage/maintenance/existing-data-backup.js";
import { SourceRecordSchema, StorageBackupSchema, retainedStorageBackup, hash } from "../../../../src/backend/storage/maintenance/existing-data-backup-files.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AUTHORITY_APPLICATION_ID } from "../../../../src/backend/storage/sqlite/migrations.js";
import { UnboundPredecessorBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { readNative6RunRecord } from "../../../support/fixtures/storage/historical-run-schema.js";
import { plantOldBuildArtifact } from "../../../support/helpers/storage/old-build-artifact.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createHistoricalFlatProfileFixture } from "../../../support/fixtures/storage/historical-flat-profile-fixture.js";

// The flat profile fixture proves its own closure with lsof before deleting its temp folder, so hosts
// without lsof (Windows) skip every fixture case.
const hasLsof = spawnSync("lsof", ["-v"], { stdio: "ignore" }).error === undefined;
const fixtureIt = it.skipIf(!hasLsof);
// Process closure is provable only on macOS (process-closure.ts); elsewhere backup closure refuses with
// profile-process-closure-unproved before these cases reach the behaviour they check, so they skip there.
const closureIt = it.skipIf(!hasLsof || process.platform !== "darwin");
let previousUmask = process.umask();
beforeEach(() => { previousUmask = process.umask(0o077); });
afterEach(() => { process.umask(previousUmask); });

function oldArtifactSnapshot(root: string) {
  const paths = [root], entries = [];
  for (const path of paths) {
    const info = lstatSync(path);
    if (info.isDirectory()) paths.push(...readdirSync(path).sort().map(name => join(path, name)));
    entries.push({ path, device: info.dev, inode: info.ino, mode: info.mode, owner: info.uid, links: info.nlink,
      size: info.size, modified: info.mtimeMs, changed: info.ctimeMs,
      digest: info.isFile() ? createHash("sha256").update(readFileSync(path)).digest("hex") : undefined });
  }
  return entries;
}

type Fixture = Awaited<ReturnType<typeof createHistoricalFlatProfileFixture>>;
async function backup(f: Fixture) {
  const admission = await acquireFlatArchiveFixture(f.workspace, f.lifetime);
  try { const closure = await prepareStoppedBackupClosure(profileBrowserClosure, admission, admission.maintenanceOperation(), systemClock, f.processLockRoot); return await backupFlatStorage(closure, admission, systemClock); }
  finally { admission.release(); }
}
function receiptRoot(f: Fixture) {
  const root = join(f.workspace, ".tracker", "control", "storage-backups"), names = readdirSync(root);
  assert.equal(names.length, 1);
  return join(root, names[0] ?? "");
}
function untouched(f: Fixture) {
  for (const path of [join(f.stateRoot, "machine"), join(f.stateRoot, "profiles"), join(f.workspace, ".tracker", "control", "profile-registry.json"),
    join(f.workspace, ".tracker", "control", "profile-flat-claim.json"), join(f.workspace, ".tracker", "control", "profile-owner-claims")]) assert.equal(existsSync(path), false, path);
}

closureIt("archives raw native6 bytes without login or person adoption and excludes preserved auth owners", async () => {
  const f = await createHistoricalFlatProfileFixture({ closedBrowser: true });
  const paths = [f.databasePath, f.protectedPath, f.artifact, f.reportPath, f.browserPreferencesPath];
  for (const path of [f.databasePath, f.artifact, f.reportPath]) chmodSync(path, 0o644);
  const admission = await acquireFlatArchiveFixture(f.workspace, f.lifetime);
  const installationId = admission.locator.installationId;
  try {
    assert.equal(admission.isFlatBackup(), true);
    assert.throws(() => admission.profileBinding, /profile-bound-authority-required/u);
    assert.throws(() => admission.assertWritable(), /flat-backup-runtime-refused/u);
    assert.throws(() => admission.assertExclusive(), /flat-backup-exclusive-refused/u);
    assert.throws(() => admission.assertProfileInitialization(), /profile-initialization-authority-required/u);
    assert.throws(() => admission.assertReadyStoppedProfileUpgradeOwner(admission), /profile-stopped-upgrade-owner-required/u);
    assert.throws(() => admission.assertArtifactRoot(f.artifact), /flat-backup-artifact-refused/u);
    assert.throws(() => admission.assertProfileMigration(f.databasePath, 6), /profile-initialization-authority-required/u);
    assert.throws(() => AuthorityDatabase.upgradeStopped(admission, f.databasePath, f.processLockRoot, systemClock), /flat-backup-upgrade-refused/u);
    const preparation = vi.spyOn(profileBrowserClosure, "probeClosed");
    let closure: Awaited<ReturnType<typeof prepareStoppedBackupClosure>>;
    try {
      closure = await prepareStoppedBackupClosure(profileBrowserClosure, admission, admission.maintenanceOperation(), systemClock, f.processLockRoot);
      assert.equal(preparation.mock.calls.length, 1);
      assert.deepEqual(preparation.mock.calls[0]?.[0].map(profile => profile.profileDirectory), [join(f.stateRoot, "browsers", "w1", "ucpath")]);
    } finally { preparation.mockRestore(); }
    const before = paths.map(path => ({ bytes: readFileSync(path), stat: statSync(path) }));
    const sourceBefore = [oldArtifactSnapshot(f.stateRoot), oldArtifactSnapshot(join(f.workspace, "data"))];
    const native = vi.spyOn(profileBrowserClosure, "probeClosed");
    let report: Awaited<ReturnType<typeof backupFlatStorage>>;
    try { report = await backupFlatStorage(closure, admission, systemClock); assert.equal(native.mock.calls.length, 0); }
    finally { native.mockRestore(); }
    for (const [index, path] of paths.entries()) {
      assert.deepEqual(readFileSync(path), before[index]?.bytes);
      assert.equal(statSync(path).ino, before[index]?.stat.ino);
      assert.equal(statSync(path).mode, before[index]?.stat.mode);
    }
    assert.deepEqual([oldArtifactSnapshot(f.stateRoot), oldArtifactSnapshot(join(f.workspace, "data"))], sourceBefore);

    assert.equal(report.kind, "flat-archive");
    const root = dirname(report.archive.backupPath);
    const record = StorageBackupSchema.parse(JSON.parse(readFileSync(report.archive.backupPath, "utf8")));
    const source = SourceRecordSchema.parse(JSON.parse(readFileSync(join(root, "source.json"), "utf8")));
    assert.equal(record.operationId, report.archive.operationId);
    assert.equal(record.sourceDigest, hash(readFileSync(join(root, "source.json"))));
    assert.deepEqual(retainedStorageBackup(f.workspace, installationId, report.archive), {
      backupPath: report.archive.backupPath, backupDigest: report.archive.backupDigest,
    });
    for (const path of ["profile/state.db", "control/installation.json", "workspace-data/reports/historical-report.csv", `profile/artifacts/${f.artifact.split("/").at(-1) ?? ""}`]) {
      assert.ok(record.files.some(entry => entry.path === path), path);
    }
    for (const entry of record.files) {
      const copied = join(root, "files", entry.path);
      const original = entry.path.startsWith("profile/") ? join(f.stateRoot, entry.path.slice("profile/".length))
        : entry.path.startsWith("control/") ? join(f.workspace, ".tracker", entry.path)
          : join(f.workspace, "data", entry.path.slice("workspace-data/".length));
      assert.equal(entry.mode, statSync(original).mode & 0o7777);
      assert.equal(statSync(copied).mode & 0o7777, 0o600);
      assert.deepEqual(readFileSync(copied), readFileSync(original));
    }
    assert.deepEqual(readFileSync(join(root, "files", "profile", "state.db")), before[0]?.bytes);
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const member = source.members.find(entry => entry.path === `profile/state.db${suffix}`);
      assert.ok(member);
      if (existsSync(`${f.databasePath}${suffix}`)) {
        assert.equal(member.kind, "file");
        assert.deepEqual(readFileSync(join(root, "files", "profile", `state.db${suffix}`)), readFileSync(`${f.databasePath}${suffix}`));
      } else assert.equal(member.kind, "absent");
    }
    for (const path of ["profile/credentials/protected.json", "profile/browsers/w1/ucpath/Default/Preferences"]) {
      assert.ok(source.members.some(entry => entry.kind === "file" && entry.path === path && entry.disposition === "auth-state"));
      assert.equal(record.files.some(entry => entry.path === path), false);
      assert.equal(existsSync(join(root, "files", path)), false);
    }
    assert.equal(report.archive.fileCount, record.files.length);
    assert.equal(report.archive.byteSize, record.files.reduce((total, entry) => total + entry.size, 0));
    assert.equal(existsSync(join(f.stateRoot, "backups")), false);
    const firstBackup = oldArtifactSnapshot(root), sourceRecord = readFileSync(join(root, "source.json"));
    admission.maintenanceOperation().release();
    assert.throws(() => admission.assertLive(), { code: "RUNTIME_OFFLINE_OPERATION_UNAVAILABLE" });
    await assert.rejects(backupFlatStorage(closure, admission, systemClock), { code: "RUNTIME_OFFLINE_OPERATION_UNAVAILABLE" });
    assert.deepEqual([oldArtifactSnapshot(f.stateRoot), oldArtifactSnapshot(join(f.workspace, "data"))], sourceBefore);
    assert.deepEqual(oldArtifactSnapshot(root), firstBackup);
    assert.deepEqual(readFileSync(join(root, "source.json")), sourceRecord);
    untouched(f);
  } finally { admission.release(); await f.close(); }
});

for (const options of [{ unknownWrite: true, closedBrowser: false, unretiredWorker: false, nonterminalWorker: false }, { unknownWrite: false, closedBrowser: true, unretiredWorker: true, nonterminalWorker: false }, { unknownWrite: true, closedBrowser: true, unretiredWorker: true, nonterminalWorker: true }]) {
  closureIt(`archives closed physical resources without rewriting historical lifecycle ${JSON.stringify(options)}`, async () => {
    const f = await createHistoricalFlatProfileFixture(options);
    const database = new DatabaseSync(f.databasePath, { readOnly: true });
    try {
      if (options.unknownWrite) {
        assert.equal(database.prepare("SELECT state FROM runs").get()?.state, "parked-write");
        const run = readNative6RunRecord(database, database.prepare("SELECT * FROM runs").get());
        assert.equal(run.lifecycle.state, "parked-write"); assert.ok(run.lifecycle.state === "parked-write");
        assert.equal(run.lifecycle.code, "unknown");
        assert.equal(database.prepare("SELECT status FROM write_intents").get()?.status, "parked");
      }
      if (options.unretiredWorker) {
        assert.equal(database.prepare("SELECT retired_at FROM worker_slots").get()?.retired_at, null);
        assert.equal(database.prepare("SELECT state FROM worker_leases").get()?.state, options.nonterminalWorker ? "stopping" : "stopped");
        assert.equal(database.prepare("SELECT count(*) AS count FROM worker_controls").get()?.count, 0);
      }
    } finally { database.close(); }
    const before = readFileSync(f.databasePath), credentials = readFileSync(f.protectedPath);
    const admission = await acquireFlatArchiveFixture(f.workspace, f.lifetime);
    try {
      const closure = await prepareStoppedBackupClosure(profileBrowserClosure, admission, admission.maintenanceOperation(), systemClock, f.processLockRoot);
      const outcome = await backupFlatStorage(closure, admission, systemClock);
      assert.equal(outcome.kind, "flat-archive");
      const root = receiptRoot(f);
      assert.deepEqual(readFileSync(join(root, "files", "profile", "state.db")), before);
      assert.deepEqual(readFileSync(f.databasePath), before);
      assert.deepEqual(readFileSync(f.protectedPath), credentials);
      assert.equal(existsSync(join(f.stateRoot, "backups")), false);
      untouched(f);
    } finally { admission.release(); await f.close(); }
  });
}

closureIt("archives genuinely never-initialized native6 settings without creating settings or snapshots", async () => {
  const f = await createHistoricalFlatProfileFixture({ neverInitialized: true });
  const raw = new DatabaseSync(f.databasePath, { readOnly: true });
  try {
    for (const table of ["settings", "settings_snapshots", "commands", "command_audits", "runs"]) {
      assert.equal(raw.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0, table);
    }
  } finally { raw.close(); }
  const before = readFileSync(f.databasePath);
  try {
    const outcome = await backup(f);
    assert.equal(outcome.kind, "flat-archive");
    assert.deepEqual(readFileSync(f.databasePath), before);
    assert.deepEqual(readFileSync(join(receiptRoot(f), "files", "profile", "state.db")), before);
    untouched(f);
  } finally { await f.close(); }
});

fixtureIt.each(["server", "workers", "geocode"] as const)("refuses an old-build %s process record before backup admission", async name => {
  const f = await createHistoricalFlatProfileFixture();
  try {
    plantOldBuildArtifact(f.processLockRoot, name);
    const before = oldArtifactSnapshot(f.processLockRoot);
    await assert.rejects(acquireFlatArchiveFixture(f.workspace, f.lifetime), { code: "RUNTIME_OLD_BUILD_ARTIFACTS" });
    assert.deepEqual(oldArtifactSnapshot(f.processLockRoot), before);
    assert.equal(existsSync(join(f.stateRoot, "backups")), false); untouched(f);
  } finally { await f.close(); }
});

for (const change of ["schema", "claim-prefix", "credential-mode", "symlink", "hardlink"] as const) {
  (change === "schema" || change === "claim-prefix" ? fixtureIt : closureIt)(`refuses ${change} before publishing a flat backup`, async () => {
    const f = await createHistoricalFlatProfileFixture();
    const held = change === "hardlink" ? join(f.workspace, "credential-alias") : `${f.protectedPath}.held`;
    if (change === "schema") { const db = new DatabaseSync(f.databasePath); try { db.exec("PRAGMA user_version=7"); } finally { db.close(); } }
    if (change === "claim-prefix") writeFileSync(join(f.workspace, ".tracker", "control", "profile-flat-claim.json"), "{}", { mode: 0o600 });
    if (change === "credential-mode") chmodSync(f.protectedPath, 0o644);
    if (change === "symlink") { renameSync(f.protectedPath, held); symlinkSync(held, f.protectedPath); }
    if (change === "hardlink") linkSync(f.protectedPath, held);
    const before = readFileSync(f.databasePath);
    try {
      if (change === "hardlink") {
        assert.equal(statSync(f.protectedPath).nlink, 2);
        await assert.rejects(backup(f), /permissions or identity/u);
      } else await assert.rejects(backup(f));
      assert.deepEqual(readFileSync(f.databasePath), before);
      assert.equal(existsSync(join(f.stateRoot, "backups")), false);
    } finally {
      if (change === "symlink") { unlinkSync(f.protectedPath); renameSync(held, f.protectedPath); }
      if (change === "hardlink") unlinkSync(held);
      await f.close();
    }
  });
}

for (const change of ["missing-copy", "extra-copy", "corrupt-copy", "source-bytes", "source-mode", "source-membership", "generation", "missing-source-record", "operation-binding", "projection", "source-digest", "old-v1"] as const) {
  closureIt(`refuses ${change} on completed backup reuse`, async () => {
    const f = await createHistoricalFlatProfileFixture();
    try {
      await backup(f); const root = receiptRoot(f), copy = join(root, "files", "workspace-data", "reports", "historical-report.csv");
      const original = readFileSync(join(root, "backup.json"));
      if (change === "missing-copy") unlinkSync(copy);
      if (change === "extra-copy") writeFileSync(join(root, "files", "extra"), "extra", { mode: 0o600 });
      if (change === "corrupt-copy") writeFileSync(copy, "corrupt");
      if (change === "source-bytes") writeFileSync(f.reportPath, "changed");
      if (change === "source-mode") chmodSync(f.reportPath, 0o644);
      if (change === "source-membership") writeFileSync(join(dirname(f.reportPath), "new.csv"), "new", { mode: 0o600 });
      if (change === "generation") { const db = new DatabaseSync(f.databasePath); try { db.exec("UPDATE database_states SET authority_generation=authority_generation+1"); } finally { db.close(); } }
      if (change === "missing-source-record") unlinkSync(join(root, "source.json"));
      const record = StorageBackupSchema.parse(JSON.parse(original.toString("utf8")));
      if (change === "operation-binding") writeFileSync(join(root, "backup.json"), JSON.stringify({ ...record, operationId: randomUUID() }));
      if (change === "projection") writeFileSync(join(root, "backup.json"), JSON.stringify({ ...record, files: record.files.slice(1) }));
      if (change === "source-digest") writeFileSync(join(root, "backup.json"), JSON.stringify({ ...record, sourceDigest: "f".repeat(64) }));
      if (change === "old-v1") writeFileSync(join(root, "backup.json"), JSON.stringify({ ...record, schemaVersion: 1 }));
      const tampered = readFileSync(join(root, "backup.json"));
      await assert.rejects(backup(f)); assert.deepEqual(readFileSync(join(root, "backup.json")), tampered); untouched(f);
      if (change === "missing-copy") assert.equal(existsSync(copy), false);
    } finally { await f.close(); }
  });
}

closureIt("reuses immutable archive bytes after identical source replacement between closed admissions", async () => {
  const f = await createHistoricalFlatProfileFixture();
  try {
    const first = await backup(f), root = receiptRoot(f), archive = oldArtifactSnapshot(root);
    const before = statSync(f.reportPath), replacement = `${f.reportPath}.new`;
    writeFileSync(replacement, readFileSync(f.reportPath), { mode: before.mode & 0o7777 });
    renameSync(replacement, f.reportPath);
    assert.notEqual(statSync(f.reportPath).ino, before.ino);
    const repeated = await backup(f);
    assert.equal(repeated.kind, "flat-archive");
    assert.deepEqual(repeated, first);
    assert.deepEqual(oldArtifactSnapshot(root), archive);
    untouched(f);
  } finally { await f.close(); }
});

closureIt("resumes only an exact interrupted raw copy prefix without creating a SQLite backup or changing completed copy inodes", async () => {
  const f = await createHistoricalFlatProfileFixture();
  const write = nativeFs.writeFileSync.bind(nativeFs); let copied: string | undefined;
  const spy = vi.spyOn(nativeFs, "writeFileSync").mockImplementation((path, data, options) => {
    write(path, data, options);
    if (copied === undefined && String(path).endsWith("/files/profile/state.db")) { copied = String(path); throw new Error("fixture interrupted flat backup"); }
  });
  syncBuiltinESMExports();
  try {
    try { await assert.rejects(backup(f), /fixture interrupted flat backup/u); }
    finally { spy.mockRestore(); syncBuiltinESMExports(); }
    assert.ok(copied); const inode = statSync(copied).ino, before = readFileSync(f.databasePath);
    const interrupted = SourceRecordSchema.parse(JSON.parse(readFileSync(join(receiptRoot(f), "source.json"), "utf8"))).operationId;
    const completed = await backup(f); assert.equal(completed.kind, "flat-archive");
    assert.equal(completed.archive.operationId, interrupted);
    assert.equal(statSync(copied).ino, inode); assert.deepEqual(readFileSync(f.databasePath), before);
    assert.equal(existsSync(join(f.stateRoot, "backups")), false); untouched(f);
  } finally { await f.close(); }
});

closureIt("refuses a foreign managed-file owner without certifying a backup", async () => {
  const f = await createHistoricalFlatProfileFixture(), lstat = nativeFs.lstatSync;
  const spy = vi.spyOn(nativeFs, "lstatSync").mockImplementation((target, options) => {
    const status = lstat(target, options);
    if (status !== undefined && target === f.reportPath) status.uid = (process.getuid?.() ?? 1000) + 1;
    return status;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(backup(f), { message: "flat-archive-member-unsafe" });
    assert.equal(existsSync(join(receiptRoot(f), "backup.json")), false); untouched(f);
  } finally { spy.mockRestore(); syncBuiltinESMExports(); await f.close(); }
});

for (const change of ["database-identity", "artifact-root-identity", "sidecar-membership"] as const) {
  fixtureIt(`revokes held backup admission after ${change} drift`, async () => {
    const f = await createHistoricalFlatProfileFixture(), admission = await acquireFlatArchiveFixture(f.workspace, f.lifetime);
    try {
      if (change === "database-identity") { const path = `${f.databasePath}.new`; writeFileSync(path, readFileSync(f.databasePath), { mode: statSync(f.databasePath).mode & 0o7777 }); renameSync(path, f.databasePath); }
      if (change === "artifact-root-identity") {
        const before = statSync(f.artifactRoot), marker = readFileSync(join(f.artifactRoot, ".runtime-owner.json"));
        renameSync(f.artifactRoot, `${f.artifactRoot}.held`); mkdirSync(f.artifactRoot, { mode: 0o700 });
        writeFileSync(join(f.artifactRoot, ".runtime-owner.json"), marker, { mode: 0o600 });
        assert.notEqual(statSync(f.artifactRoot).ino, before.ino);
        assert.deepEqual(readFileSync(join(f.artifactRoot, ".runtime-owner.json")), marker);
      }
      if (change === "sidecar-membership") writeFileSync(`${f.databasePath}-journal`, "unexpected", { mode: 0o600 });
      assert.throws(() => admission.assertLive(), /identity changed|flat-backup-source-changed/u);
      assert.equal(existsSync(join(f.stateRoot, "backups")), false); untouched(f);
    } finally { admission.release(); await f.close(); }
  });
}

closureIt("completes only a proved empty installation backup allocation", async () => {
  const f = await createHistoricalFlatProfileFixture(), admission = await acquireFlatArchiveFixture(f.workspace, f.lifetime);
  const root = join(f.workspace, ".tracker", "control", "storage-backups", admission.locator.installationId);
  try { mkdirSync(root, { recursive: true, mode: 0o700 }); }
  finally { admission.release(); }
  try {
    assert.equal((await backup(f)).kind, "flat-archive"); assert.equal(existsSync(join(root, "backup.json")), true); untouched(f);
  } finally { await f.close(); }
});

fixtureIt("refuses flat backup without publishing where the platform cannot prove process closure", async () => {
  const f = await createHistoricalFlatProfileFixture(), platform = Object.getOwnPropertyDescriptor(process, "platform");
  assert.ok(platform);
  try {
    try {
      Object.defineProperty(process, "platform", { value: "linux" });
      await assert.rejects(backup(f), { message: "profile-process-closure-unproved" });
    } finally { Object.defineProperty(process, "platform", platform); }
    assert.equal(existsSync(join(f.workspace, ".tracker", "control", "storage-backups")), false); untouched(f);
  } finally { await f.close(); }
});

function plantAuthorityBackup(f: Fixture, change?: "lone-database" | "lone-manifest" | "digest") {
  const directory = join(f.stateRoot, "backups", "authority"), name = `authority-g0-1-${randomUUID()}.sqlite`;
  const bytes = readFileSync(f.databasePath), at = "2026-10-01T12:00:00.000Z", fingerprint = "c".repeat(64);
  const observed = { applicationId: AUTHORITY_APPLICATION_ID, schemaVersion: 6, pageCount: 1, authorityGeneration: 0, authorityContentFingerprint: fingerprint };
  const manifest = UnboundPredecessorBackupManifestSchema.parse({ kind: "hrauto-authority-backup", manifestVersion: 3, backupFileName: name,
    sourceDatabaseIdentity: fingerprint, ...observed, createdAt: at, byteSize: bytes.byteLength, sha256: change === "digest" ? "0".repeat(64) : hash(bytes),
    verification: { state: "verified", observedFrom: "backup-copy", observedAt: at, ...observed, quickCheck: "ok", foreignKeyViolations: 0, invariantViolations: [], exactTableRegistry: true } });
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (change !== "lone-manifest") writeFileSync(join(directory, name), bytes, { mode: 0o600 });
  if (change !== "lone-database") writeFileSync(join(directory, `${name}.manifest.json`), JSON.stringify(manifest), { mode: 0o600 });
  return `profile/backups/authority/${name}`;
}

closureIt("archives a predecessor authority backup together with its manifest", async () => {
  const f = await createHistoricalFlatProfileFixture();
  try {
    const path = plantAuthorityBackup(f), report = await backup(f), root = dirname(report.archive.backupPath);
    const record = StorageBackupSchema.parse(JSON.parse(readFileSync(report.archive.backupPath, "utf8")));
    for (const member of [path, `${path}.manifest.json`]) {
      assert.ok(record.files.some(entry => entry.path === member), member);
      assert.deepEqual(readFileSync(join(root, "files", member)), readFileSync(join(f.stateRoot, member.slice("profile/".length))));
    }
  } finally { await f.close(); }
});

for (const change of ["lone-database", "lone-manifest", "digest"] as const) {
  closureIt(`refuses a predecessor authority backup with ${change} before writing anything`, async () => {
    const f = await createHistoricalFlatProfileFixture();
    try {
      plantAuthorityBackup(f, change);
      await assert.rejects(backup(f), { message: change === "digest" ? "flat-archive-authority-pair-refused" : "flat-archive-authority-pair-required" });
      assert.deepEqual(readdirSync(receiptRoot(f)), []); untouched(f);
    } finally { await f.close(); }
  });
}

async function backupChangedDuringCopy(f: Fixture, change: () => void) {
  const write = nativeFs.writeFileSync.bind(nativeFs); let changed = false;
  const spy = vi.spyOn(nativeFs, "writeFileSync").mockImplementation((path, data, options) => {
    write(path, data, options);
    if (!changed && String(path).endsWith("/files/profile/state.db")) { changed = true; change(); }
  });
  syncBuiltinESMExports();
  try { return await backup(f); } finally { spy.mockRestore(); syncBuiltinESMExports(); }
}

closureIt("publishes no backup when copied source bytes change before the copy completes", async () => {
  const f = await createHistoricalFlatProfileFixture();
  try {
    await assert.rejects(backupChangedDuringCopy(f, () => writeFileSync(f.artifact, "changed after its copy")), { code: "STORAGE_BACKUP_SOURCE_CHANGED" });
    assert.equal(existsSync(join(receiptRoot(f), "backup.json")), false); untouched(f);
  } finally { await f.close(); }
});

closureIt("publishes no backup when process closure is lost during the copy", async () => {
  const f = await createHistoricalFlatProfileFixture();
  let holder: ChildProcess | undefined;
  try {
    await assert.rejects(backupChangedDuringCopy(f, () => { holder = spawn("/bin/sleep", ["60"], { cwd: f.stateRoot, stdio: "ignore" }); }),
      (error: Error & { code?: string }) => error.code === "STORAGE_BACKUP_CLOSURE_UNPROVED" && error.cause instanceof Error && error.cause.message === "profile-process-closure-unproved");
    assert.ok(holder);
    assert.equal(existsSync(join(receiptRoot(f), "backup.json")), false); untouched(f);
  } finally {
    if (holder !== undefined && holder.exitCode === null && holder.signalCode === null) { const exited = once(holder, "exit"); holder.kill(); await exited; }
    await f.close();
  }
});

for (const key of ["stateRoot", "artifactRoot", "reportsDir"] as const) {
  fixtureIt(`refuses an authentic historical snapshot with an unsupported ${key}`, async () => {
    const f = await createHistoricalFlatProfileFixture(), database = new DatabaseSync(f.databasePath);
    try {
      const row = database.prepare("SELECT payload_json FROM settings_snapshots LIMIT 1").get(); assert.equal(typeof row?.payload_json, "string");
      const inspected = convertPersonPreferencesRow("settings_snapshots", row);
      assert.ok(typeof inspected.payload_json === "string");
      const original = ConfigSnapshotRecordSchema.parse(JSON.parse(inspected.payload_json));
      const config = { ...original.config, paths: { ...original.config.paths, [key]: join(f.workspace, "unsupported") } };
      const snapshot = ConfigSnapshotRecordSchema.parse({ ...original, configSnapshotId: randomUUID(), revision: 2, config,
        fingerprint: createHash("sha256").update(canonicalJsonStringify(config)).digest("hex") });
      const predecessor = prePreferencesSettingsRow("settings_snapshots", { payload_json: canonicalJsonStringify(snapshot) });
      assert.ok(typeof predecessor.payload_json === "string");
      database.prepare("INSERT INTO settings_snapshots(id,revision,fingerprint,payload_json,captured_at) VALUES(?,?,?,?,?)")
        .run(snapshot.configSnapshotId, snapshot.revision, snapshot.fingerprint, predecessor.payload_json, snapshot.capturedAt);
    } finally { database.close(); }
    try {
      await assert.rejects(backup(f), /existing-data-flat-custom-paths-unsupported/u);
      assert.equal(existsSync(join(f.stateRoot, "backups")), false); untouched(f);
    } finally { await f.close(); }
  });
}

for (const entry of ["src/backend/storage/maintenance/existing-data-backup.ts", "src/backend/storage/admission/bootstrap-admission.ts", "scripts/dev/secure-env-bootstrap.ts"]) {
  it(`loads ${entry} in a fresh module graph before any fixture admission`, async () => {
    const script = `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), entry)).href)}); process.stdout.write("fresh-import-complete");`;
    const child = spawnSync(process.execPath, ["--import", testProcessImport(), "--input-type=module", "-e", script], { cwd: process.cwd(), encoding: "utf8", timeout: 20_000 });
    assert.equal(child.status, 0, `${child.error?.message ?? ""}\n${child.stdout}\n${child.stderr}`);
    assert.equal(child.stdout, "fresh-import-complete");
  });
}
