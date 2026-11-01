import { testProcessImport } from "../../../support/compiled-process.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import nativeFs, { cpSync, lstatSync, chmodSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { it, vi } from "vitest";
import { acquireStorageBackupEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { prepareStorageBackupCommand, composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { verifyStoppedBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { acquireRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createHistoricalFlatProfileFixture } from "../../../support/fixtures/storage/historical-flat-profile-fixture.js";

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
  const admission = await acquireStorageBackupEntrypointAdmission(f.workspace, f.lifetime);
  try { return await composeStorageCommand(rebuildRuntimeIsolation, ["backup", "--json"], systemClock, f.workspace, admission); }
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

it("backs up an adopted native6 flat source without login, preserves source identity, and grants only finite backup authority", async () => {
  const f = await createHistoricalFlatProfileFixture({ closedBrowser: true });
  const paths = [f.databasePath, f.protectedPath, f.artifact, f.reportPath, join(f.stateRoot, "browsers", "w1", "ucpath", "Default", "Preferences")];
  for (const path of paths.filter(path => path !== f.protectedPath)) chmodSync(path, 0o644);
  let admission = await acquireStorageBackupEntrypointAdmission(f.workspace, f.lifetime);
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
    let prepared: Awaited<ReturnType<typeof prepareStorageBackupCommand>>;
    try {
      prepared = await prepareStorageBackupCommand(rebuildRuntimeIsolation, ["--json"], systemClock, f.workspace, admission);
      assert.equal(preparation.mock.calls.length, 1);
      assert.deepEqual(preparation.mock.calls[0]?.[0].map(profile => profile.profileDirectory), [join(f.stateRoot, "browsers", "w1", "ucpath")]);
    } finally { preparation.mockRestore(); }
    const before = paths.map(path => ({ bytes: readFileSync(path), stat: statSync(path) }));
    const assertSourceUnchanged = (captured: typeof before) => {
      for (const [index, path] of paths.entries()) {
        assert.deepEqual(readFileSync(path), captured[index]?.bytes);
        assert.equal(statSync(path).ino, captured[index]?.stat.ino); assert.equal(statSync(path).mode, captured[index]?.stat.mode);
      }
    };
    const native = vi.spyOn(profileBrowserClosure, "probeClosed");
    let outcome: Awaited<ReturnType<typeof prepared.run>>;
    try { outcome = await prepared.run(); assert.equal(native.mock.calls.length, 0); }
    finally { native.mockRestore(); }
    assertSourceUnchanged(before);
    assert.equal(outcome.exitCode, 0);
    const report = JSON.parse(outcome.output) as { manifests: { backupFileName: string }[]; coupledBackup: { backupPath: string } };
    const manifest = report.manifests[0]; assert.ok(manifest);
    admission.release();
    admission = await acquireStorageBackupEntrypointAdmission(f.workspace, f.lifetime);
    const verified = verifyStoppedBackupManifestAtPath(admission, join(f.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`), AuthorityDatabase.sourceDatabaseIdentity(f.databasePath));
    assert.equal(verified.manifest.schemaVersion, 6); assert.equal(verified.manifest.installationId, undefined); assert.equal(verified.manifest.profileId, undefined);
    const record = JSON.parse(readFileSync(report.coupledBackup.backupPath, "utf8")) as { claimId?: string; profileId?: string; files: { path: string }[] };
    assert.equal(record.claimId, undefined); assert.equal(record.profileId, undefined);
    for (const path of ["profile/credentials/protected.json", "control/installation.json", "workspace-data/reports/historical-report.csv", `profile/artifacts/${f.artifact.split("/").at(-1) ?? ""}`]) assert.ok(record.files.some(entry => entry.path === path), path);
    assert.ok(record.files.some(entry => entry.path === `profile/backups/authority/${manifest.backupFileName}`));
    for (const entry of record.files) assert.equal(statSync(join(dirname(report.coupledBackup.backupPath), "files", entry.path)).mode & 0o7777, 0o600);
    const sourceRecord = readFileSync(join(dirname(report.coupledBackup.backupPath), "source.json"));
    assert.deepEqual(readFileSync(join(dirname(report.coupledBackup.backupPath), "files", "profile", "browsers", "w1", "ucpath", "Default", "Preferences")), before[4]?.bytes);
    const firstBackup = oldArtifactSnapshot(dirname(report.coupledBackup.backupPath));
    assertSourceUnchanged(before);
    const repeated = await prepareStorageBackupCommand(rebuildRuntimeIsolation, ["--json"], systemClock, f.workspace, admission);
    const afterProbe = paths.map(path => ({ bytes: readFileSync(path), stat: statSync(path) }));
    await assert.rejects(repeated.run(), { code: "STORAGE_BACKUP_SOURCE_CHANGED" });
    assertSourceUnchanged(afterProbe);
    assert.deepEqual(oldArtifactSnapshot(dirname(report.coupledBackup.backupPath)), firstBackup);
    assert.deepEqual(readFileSync(join(dirname(report.coupledBackup.backupPath), "source.json")), sourceRecord);
    untouched(f);
  } finally { admission.release(); await f.close(); }
});

for (const options of [{ unknownWrite: true }, { closedBrowser: true, unretiredWorker: true }]) {
  it(`refuses unclosed flat resource custody ${JSON.stringify(options)} before a backup`, async () => {
    const f = await createHistoricalFlatProfileFixture(options), before = readFileSync(f.databasePath);
    try {
      await assert.rejects(backup(f), /custody-unproved|worker-custody-unsupported/u);
      assert.equal(existsSync(join(f.stateRoot, "backups")), false); assert.deepEqual(readFileSync(f.databasePath), before); untouched(f);
    } finally { await f.close(); }
  });
}

it.each(["server", "workers", "geocode"] as const)("refuses active %s process custody before backup admission", async name => {
  const f = await createHistoricalFlatProfileFixture();
  const lock = acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name, pid: process.pid,
    ...(name === "workers" ? { admission: { kind: "unbound-worker" as const, authorityPath: f.databasePath } } : {}) });
  try {
    const before = oldArtifactSnapshot(f.processLockRoot);
    await assert.rejects(acquireStorageBackupEntrypointAdmission(f.workspace, f.lifetime), { code: "RUNTIME_OLD_BUILD_ARTIFACTS" });
    assert.deepEqual(oldArtifactSnapshot(f.processLockRoot), before);
    lock.release();
    const released = oldArtifactSnapshot(f.processLockRoot);
    await assert.rejects(acquireStorageBackupEntrypointAdmission(f.workspace, f.lifetime), { code: "RUNTIME_OLD_BUILD_ARTIFACTS" });
    assert.deepEqual(oldArtifactSnapshot(f.processLockRoot), released);
    assert.equal(existsSync(join(f.stateRoot, "backups")), false); untouched(f);
  } finally { lock.release(); await f.close(); }
});

for (const change of ["schema", "claim-prefix", "credential-mode", "symlink", "hardlink"] as const) {
  it(`refuses ${change} before publishing a flat backup`, async () => {
    const f = await createHistoricalFlatProfileFixture();
    const held = `${f.protectedPath}.held`;
    if (change === "schema") { const db = new DatabaseSync(f.databasePath); try { db.exec("PRAGMA user_version=7"); } finally { db.close(); } }
    if (change === "claim-prefix") writeFileSync(join(f.workspace, ".tracker", "control", "profile-flat-claim.json"), "{}", { mode: 0o600 });
    if (change === "credential-mode") chmodSync(f.protectedPath, 0o644);
    if (change === "symlink") { renameSync(f.protectedPath, held); symlinkSync(held, f.protectedPath); }
    if (change === "hardlink") linkSync(f.protectedPath, held);
    const before = readFileSync(f.databasePath);
    try {
      await assert.rejects(backup(f)); assert.deepEqual(readFileSync(f.databasePath), before);
      assert.equal(existsSync(join(f.stateRoot, "backups")), false);
    } finally {
      if (change === "symlink") { unlinkSync(f.protectedPath); renameSync(held, f.protectedPath); }
      if (change === "hardlink") unlinkSync(held);
      await f.close();
    }
  });
}

for (const change of ["missing-copy", "extra-copy", "corrupt-copy", "source-bytes", "source-inode", "source-mode", "source-membership", "generation", "missing-source-record", "missing-manifest", "extra-sqlite", "corrupt-manifest", "corrupt-sqlite"] as const) {
  it(`refuses ${change} on completed backup reuse`, async () => {
    const f = await createHistoricalFlatProfileFixture();
    try {
      await backup(f); const root = receiptRoot(f), copy = join(root, "files", "workspace-data", "reports", "historical-report.csv");
      const original = readFileSync(join(root, "backup.json"));
      if (change === "missing-copy") unlinkSync(copy);
      if (change === "extra-copy") writeFileSync(join(root, "files", "extra"), "extra", { mode: 0o600 });
      if (change === "corrupt-copy") writeFileSync(copy, "corrupt");
      if (change === "source-bytes") writeFileSync(f.reportPath, "changed");
      if (change === "source-inode") { const path = `${f.reportPath}.new`; writeFileSync(path, readFileSync(f.reportPath), { mode: 0o600 }); renameSync(path, f.reportPath); }
      if (change === "source-mode") chmodSync(f.reportPath, 0o644);
      if (change === "source-membership") writeFileSync(join(dirname(f.reportPath), "new.csv"), "new", { mode: 0o600 });
      if (change === "generation") { const db = new DatabaseSync(f.databasePath); try { db.exec("UPDATE database_states SET authority_generation=authority_generation+1"); } finally { db.close(); } }
      if (change === "missing-source-record") unlinkSync(join(root, "source.json"));
      if (["missing-manifest", "extra-sqlite", "corrupt-manifest", "corrupt-sqlite"].includes(change)) {
        const directory = join(f.stateRoot, "backups", "authority"), manifest = readdirSync(directory).find(name => name.endsWith(".manifest.json"));
        assert.ok(manifest);
        if (change === "missing-manifest") unlinkSync(join(directory, manifest));
        if (change === "extra-sqlite") writeFileSync(join(directory, `authority-g0-1-${randomUUID()}.sqlite`), "unverified", { mode: 0o600 });
        if (change === "corrupt-manifest") writeFileSync(join(directory, manifest), "{}");
        if (change === "corrupt-sqlite") writeFileSync(join(directory, manifest.replace(/\.manifest\.json$/u, "")), "corrupt");
      }
      await assert.rejects(backup(f)); assert.deepEqual(readFileSync(join(root, "backup.json")), original); untouched(f);
      if (change === "missing-copy") assert.equal(existsSync(copy), false);
    } finally { await f.close(); }
  });
}

it("resumes only an exact interrupted private copy prefix without repeating SQLite backup or changing completed copy inodes", async () => {
  const f = await createHistoricalFlatProfileFixture();
  const write = nativeFs.writeFileSync.bind(nativeFs); let copied: string | undefined;
  const spy = vi.spyOn(nativeFs, "writeFileSync").mockImplementation((path, data, options) => {
    write(path, data, options);
    if (copied === undefined && String(path).endsWith("/files/profile/credentials/protected.json")) { copied = String(path); throw new Error("fixture interrupted flat backup"); }
  });
  syncBuiltinESMExports();
  try {
    try { await assert.rejects(backup(f), /fixture interrupted flat backup/u); }
    finally { spy.mockRestore(); syncBuiltinESMExports(); }
    assert.ok(copied); const inode = statSync(copied).ino, names = readdirSync(join(f.stateRoot, "backups", "authority"));
    const completed = await backup(f); assert.equal(completed.exitCode, 0);
    assert.equal(statSync(copied).ino, inode); assert.deepEqual(readdirSync(join(f.stateRoot, "backups", "authority")), names); untouched(f);
  } finally { await f.close(); }
});

it("refuses a foreign managed-file owner without certifying a backup", async () => {
  const f = await createHistoricalFlatProfileFixture(), lstat = nativeFs.lstatSync;
  const spy = vi.spyOn(nativeFs, "lstatSync").mockImplementation((target, options) => {
    const status = lstat(target, options);
    if (status !== undefined && target === f.reportPath) status.uid = (process.getuid?.() ?? 1000) + 1;
    return status;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(backup(f), /permissions or identity/u);
    assert.equal(existsSync(join(receiptRoot(f), "backup.json")), false); untouched(f);
  } finally { spy.mockRestore(); syncBuiltinESMExports(); await f.close(); }
});

for (const change of ["database-identity", "artifact-root-identity", "sidecar-membership"] as const) {
  it(`revokes held backup admission after ${change} drift`, async () => {
    const f = await createHistoricalFlatProfileFixture(), admission = await acquireStorageBackupEntrypointAdmission(f.workspace, f.lifetime);
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

it("completes only a proved empty installation backup allocation", async () => {
  const f = await createHistoricalFlatProfileFixture(), admission = await acquireStorageBackupEntrypointAdmission(f.workspace, f.lifetime);
  const root = join(f.workspace, ".tracker", "control", "storage-backups", admission.locator.installationId);
  try { mkdirSync(root, { recursive: true, mode: 0o700 }); }
  finally { admission.release(); }
  try {
    assert.equal((await backup(f)).exitCode, 0); assert.equal(existsSync(join(root, "backup.json")), true); untouched(f);
  } finally { await f.close(); }
});

for (const key of ["stateRoot", "artifactRoot", "reportsDir"] as const) {
  it(`refuses an authentic historical snapshot with an unsupported ${key}`, async () => {
    const f = await createHistoricalFlatProfileFixture(), database = new DatabaseSync(f.databasePath);
    try {
      const row = database.prepare("SELECT payload_json FROM settings_snapshots LIMIT 1").get(); assert.equal(typeof row?.payload_json, "string");
      const original = ConfigSnapshotRecordSchema.parse(JSON.parse(String(row?.payload_json)));
      const config = { ...original.config, paths: { ...original.config.paths, [key]: join(f.workspace, "unsupported") } };
      const snapshot = ConfigSnapshotRecordSchema.parse({ ...original, configSnapshotId: randomUUID(), revision: 2, config,
        fingerprint: createHash("sha256").update(canonicalJsonStringify(config)).digest("hex") });
      database.prepare("INSERT INTO settings_snapshots(id,revision,fingerprint,payload_json,captured_at) VALUES(?,?,?,?,?)")
        .run(snapshot.configSnapshotId, snapshot.revision, snapshot.fingerprint, canonicalJsonStringify(snapshot), snapshot.capturedAt);
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

it("runs the actual backup bootstrap in a fresh flat fixture process", async () => {
  const f = await createHistoricalFlatProfileFixture();
  try {
    cpSync(join(process.cwd(), "src"), join(f.workspace, "src"), { recursive: true });
    mkdirSync(join(f.workspace, "scripts/dev"), { recursive: true });
    cpSync(join(process.cwd(), "scripts/dev/secure-env-bootstrap.ts"), join(f.workspace, "scripts/dev/secure-env-bootstrap.ts"));
    mkdirSync(join(f.workspace, "config"));
    for (const name of ["runtime-isolation.json", "test-data.json", "dashboard-workflow-sources.json"]) cpSync(join(process.cwd(), "config", name), join(f.workspace, "config", name));
    symlinkSync(dirname(dirname(fileURLToPath(import.meta.resolve("tsx/package.json")))), join(f.workspace, "node_modules"));
    const source = [f.databasePath, f.protectedPath, f.artifact, f.reportPath].map(path => ({ path, bytes: readFileSync(path), inode: statSync(path).ino }));
    const child = spawnSync(process.execPath, ["--import", testProcessImport(), "scripts/dev/secure-env-bootstrap.ts", "cli", "storage", "backup", "--json"], { cwd: f.workspace, encoding: "utf8", timeout: 20_000 });
    assert.equal(child.status, 0, `${child.error?.message ?? ""}\n${child.stdout}\n${child.stderr}`);
    const result = JSON.parse(child.stdout) as { coupledBackup: { backupPath: string } };
    assert.equal(existsSync(result.coupledBackup.backupPath), true);
    for (const entry of source) { assert.deepEqual(readFileSync(entry.path), entry.bytes); assert.equal(statSync(entry.path).ino, entry.inode); }
    assert.equal(existsSync(join(f.stateRoot, "machine")), false); assert.equal(existsSync(join(f.stateRoot, "profiles")), false);
  } finally { await f.close(); }
});
