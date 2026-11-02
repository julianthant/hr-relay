import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { testProcessImport } from "../../../support/compiled-process.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import nativeFs, { cpSync, lstatSync, chmodSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, it, vi } from "vitest";
import { acquireStorageBackupEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { prepareStorageBackupCommand, composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { SourceRecordSchema, StorageBackupSchema, retainedStorageBackup, hash } from "../../../../src/backend/storage/maintenance/existing-data-backup-files.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { runRecordFromRow } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { acquireRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createHistoricalFlatProfileFixture } from "../../../support/fixtures/storage/historical-flat-profile-fixture.js";

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

it("archives raw native6 bytes without login or person adoption and excludes preserved auth owners", async () => {
  const f = await createHistoricalFlatProfileFixture({ closedBrowser: true });
  const paths = [f.databasePath, f.protectedPath, f.artifact, f.reportPath, f.browserPreferencesPath];
  for (const path of [f.databasePath, f.artifact, f.reportPath]) chmodSync(path, 0o644);
  const admission = await acquireStorageBackupEntrypointAdmission(f.workspace, f.lifetime);
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
    let prepared: Awaited<ReturnType<typeof prepareStorageBackupCommand>>;
    try {
      prepared = await prepareStorageBackupCommand(rebuildRuntimeIsolation, ["--json"], systemClock, f.workspace, admission);
      assert.equal(preparation.mock.calls.length, 1);
      assert.deepEqual(preparation.mock.calls[0]?.[0].map(profile => profile.profileDirectory), [join(f.stateRoot, "browsers", "w1", "ucpath")]);
    } finally { preparation.mockRestore(); }
    const before = paths.map(path => ({ bytes: readFileSync(path), stat: statSync(path) }));
    const sourceBefore = [oldArtifactSnapshot(f.stateRoot), oldArtifactSnapshot(join(f.workspace, "data"))];
    const native = vi.spyOn(profileBrowserClosure, "probeClosed");
    let outcome: Awaited<ReturnType<typeof prepared.run>>;
    try { outcome = await prepared.run(); assert.equal(native.mock.calls.length, 0); }
    finally { native.mockRestore(); }
    for (const [index, path] of paths.entries()) {
      assert.deepEqual(readFileSync(path), before[index]?.bytes);
      assert.equal(statSync(path).ino, before[index]?.stat.ino);
      assert.equal(statSync(path).mode, before[index]?.stat.mode);
    }
    assert.deepEqual([oldArtifactSnapshot(f.stateRoot), oldArtifactSnapshot(join(f.workspace, "data"))], sourceBefore);
    assert.equal(outcome.exitCode, 0);
    const report = JSON.parse(outcome.output) as { kind: string; archive: { backupPath: string; backupDigest: string; operationId: string; fileCount: number; byteSize: number } };
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
    assert.throws(() => admission.assertLive(), { code: "RUNTIME_OFFLINE_OPERATION_UNAVAILABLE" });
    await assert.rejects(prepared.run(), { code: "RUNTIME_OFFLINE_OPERATION_UNAVAILABLE" });
    assert.deepEqual([oldArtifactSnapshot(f.stateRoot), oldArtifactSnapshot(join(f.workspace, "data"))], sourceBefore);
    assert.deepEqual(oldArtifactSnapshot(root), firstBackup);
    assert.deepEqual(readFileSync(join(root, "source.json")), sourceRecord);
    untouched(f);
  } finally { admission.release(); await f.close(); }
});

for (const options of [{ unknownWrite: true, closedBrowser: false, unretiredWorker: false, nonterminalWorker: false }, { unknownWrite: false, closedBrowser: true, unretiredWorker: true, nonterminalWorker: false }, { unknownWrite: true, closedBrowser: true, unretiredWorker: true, nonterminalWorker: true }]) {
  it(`archives closed physical resources without rewriting historical lifecycle ${JSON.stringify(options)}`, async () => {
    const f = await createHistoricalFlatProfileFixture(options);
    const database = new DatabaseSync(f.databasePath, { readOnly: true });
    try {
      if (options.unknownWrite) {
        assert.equal(database.prepare("SELECT state FROM runs").get()?.state, "parked-write");
        const run = runRecordFromRow(database.prepare("SELECT * FROM runs").get());
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
    const admission = await acquireStorageBackupEntrypointAdmission(f.workspace, f.lifetime);
    try {
      const prepared = await prepareStorageBackupCommand(rebuildRuntimeIsolation, ["--json"], systemClock, f.workspace, admission);
      const outcome = await prepared.run();
      assert.equal(outcome.exitCode, 0);
      const root = receiptRoot(f);
      assert.deepEqual(readFileSync(join(root, "files", "profile", "state.db")), before);
      assert.deepEqual(readFileSync(f.databasePath), before);
      assert.deepEqual(readFileSync(f.protectedPath), credentials);
      assert.equal(existsSync(join(f.stateRoot, "backups")), false);
      untouched(f);
    } finally { admission.release(); await f.close(); }
  });
}

it("archives genuinely never-initialized native6 settings without creating settings or snapshots", async () => {
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
    assert.equal(outcome.exitCode, 0);
    assert.deepEqual(readFileSync(f.databasePath), before);
    assert.deepEqual(readFileSync(join(receiptRoot(f), "files", "profile", "state.db")), before);
    untouched(f);
  } finally { await f.close(); }
});

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
  it(`refuses ${change} on completed backup reuse`, async () => {
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

it("reuses immutable archive bytes after identical source replacement between closed admissions", async () => {
  const f = await createHistoricalFlatProfileFixture();
  try {
    const first = await backup(f), root = receiptRoot(f), archive = oldArtifactSnapshot(root);
    const before = statSync(f.reportPath), replacement = `${f.reportPath}.new`;
    writeFileSync(replacement, readFileSync(f.reportPath), { mode: before.mode & 0o7777 });
    renameSync(replacement, f.reportPath);
    assert.notEqual(statSync(f.reportPath).ino, before.ino);
    const repeated = await backup(f);
    assert.equal(repeated.exitCode, 0);
    assert.equal(repeated.output, first.output);
    assert.deepEqual(oldArtifactSnapshot(root), archive);
    untouched(f);
  } finally { await f.close(); }
});

it("resumes only an exact interrupted raw copy prefix without creating a SQLite backup or changing completed copy inodes", async () => {
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
    const completed = await backup(f); assert.equal(completed.exitCode, 0);
    assert.equal(statSync(copied).ino, inode); assert.deepEqual(readFileSync(f.databasePath), before);
    assert.equal(existsSync(join(f.stateRoot, "backups")), false); untouched(f);
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
    await assert.rejects(backup(f), { message: "flat-archive-member-unsafe" });
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
    const isolationPath = join(f.workspace, "src/backend/app/config/runtime-isolation.ts"), isolation = readFileSync(isolationPath, "utf8");
    const fixedReturn = 'return join(homeDirectory, "Library", "Application Support", "Relay");';
    assert.ok(isolation.includes(fixedReturn));
    writeFileSync(isolationPath, isolation.replace(fixedReturn, `return ${JSON.stringify(f.workspace)};`));
    mkdirSync(join(f.workspace, "scripts/dev"), { recursive: true });
    cpSync(join(process.cwd(), "scripts/dev/secure-env-bootstrap.ts"), join(f.workspace, "scripts/dev/secure-env-bootstrap.ts"));
    mkdirSync(join(f.workspace, "config"));
    for (const name of ["runtime-isolation.json", "test-data.json", "dashboard-workflow-sources.json"]) cpSync(join(process.cwd(), "config", name), join(f.workspace, "config", name));
    symlinkSync(dirname(dirname(fileURLToPath(import.meta.resolve("tsx/package.json")))), join(f.workspace, "node_modules"));
    const source = [f.databasePath, f.protectedPath, f.artifact, f.reportPath].map(path => ({ path, bytes: readFileSync(path), inode: statSync(path).ino }));
    const child = spawnSync(process.execPath, ["--import", testProcessImport(), "scripts/dev/secure-env-bootstrap.ts", "cli", "storage", "backup", "--json"], { cwd: f.workspace, encoding: "utf8", timeout: 20_000 });
    assert.equal(child.status, 0, `${child.error?.message ?? ""}\n${child.stdout}\n${child.stderr}`);
    const result = JSON.parse(child.stdout) as { kind: string; archive: { backupPath: string } };
    assert.equal(result.kind, "flat-archive");
    assert.equal(existsSync(result.archive.backupPath), true);
    for (const entry of source) { assert.deepEqual(readFileSync(entry.path), entry.bytes); assert.equal(statSync(entry.path).ino, entry.inode); }
    assert.equal(existsSync(join(f.stateRoot, "machine")), false); assert.equal(existsSync(join(f.stateRoot, "profiles")), false);
  } finally { await f.close(); }
});
