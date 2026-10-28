import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import nativeFs, { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { it, vi } from "vitest";
import { acquireStorageBackupEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeStorageCommand } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { observeProcessIdentity, acquireRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import { MutexRecoveryReceiptSchema } from "../../../../src/backend/storage/admission/mutex-contracts.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { captureExistingDataOwner } from "../../../../src/backend/storage/configuration/credential-store.js";
import { ownerClaimRecoveryCopies } from "../../../../src/backend/storage/maintenance/flat-profile-claim.js";
import { verifyExistingDataBackupFiles } from "../../../../src/backend/storage/maintenance/existing-data-backup-files.js";
import { createHistoricalFlatProfileFixture, historicalFlatFields } from "../../../support/fixtures/storage/historical-flat-profile-fixture.js";

type Fixture = ReturnType<typeof createHistoricalFlatProfileFixture>;
function loseMutex(f: Fixture, phase: "complete" | "copy-prefix" | "empty") {
  const module = (path: string) => JSON.stringify(pathToFileURL(join(process.cwd(), path)).href);
  const script = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { join } from 'node:path';
    import { acquireStorageBackupEntrypointAdmission } from ${module("src/backend/storage/admission/bootstrap-admission.ts")};
    import { acquireInstallation } from ${module("src/backend/storage/admission/installation.ts")};
    import { composeStorageCommand } from ${module("src/backend/app/composition/storage-compose.ts")};
    import { rebuildRuntimeIsolation } from ${module("src/backend/app/config/runtime-isolation.ts")};
    import { systemClock } from ${module("src/rules/time/clock.ts")};
    const workspace = ${JSON.stringify(f.workspace)}, phase = ${JSON.stringify(phase)};
    const rename = fs.renameSync.bind(fs), write = fs.writeFileSync.bind(fs);
    let armed = false;
    fs.renameSync = (source, target) => {
      rename(source, target);
      if (armed && String(target) === join(workspace, '.tracker/control/admission-mutex')) process.exit(73);
    };
    fs.writeFileSync = (path, bytes, options) => {
      write(path, bytes, options);
      if (phase === 'copy-prefix' && String(path).endsWith('/files/profile/credentials/protected.json')) {
        armed = true;
        acquireInstallation(workspace, 'exclusive');
        throw new Error('fixture did not lose its mutex');
      }
    };
    syncBuiltinESMExports();
    const admission = await acquireStorageBackupEntrypointAdmission(workspace);
    try {
      if (phase === 'empty') fs.mkdirSync(join(workspace, '.tracker/control/storage-backups', admission.locator.installationId), {recursive:true,mode:0o700});
      else {
        const outcome = await composeStorageCommand(rebuildRuntimeIsolation, ['backup','--json'], systemClock, workspace, admission);
        if (outcome.exitCode !== 0) throw new Error('fixture backup failed');
      }
    } finally { admission.release(); }
    armed = true;
    acquireInstallation(workspace, 'exclusive');
    throw new Error('fixture did not lose its mutex');
  `;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), encoding: "utf8", timeout: 20_000 });
  assert.equal(child.status, 73, `${child.error?.message ?? ""}\n${child.stdout}\n${child.stderr}`);
  const control = join(f.workspace, ".tracker/control"), mutex = join(control, "admission-mutex");
  const owner = JSON.parse(readFileSync(join(mutex, "owner.json"), "utf8")) as { acquisitionId: string; pid: number };
  assert.equal(owner.pid, child.pid); assert.equal(observeProcessIdentity(owner.pid).state, "gone");
  const allocation = join(control, "storage-backups"), names = readdirSync(allocation); assert.equal(names.length, 1);
  return { control, mutex, owner, root: join(allocation, names[0] ?? "") };
}

async function resume(f: Fixture) {
  const admission = await acquireStorageBackupEntrypointAdmission(f.workspace);
  try { return await composeStorageCommand(rebuildRuntimeIsolation, ["backup", "--json"], systemClock, f.workspace, admission); }
  finally { admission.release(); }
}

for (const phase of ["complete", "copy-prefix", "empty"] as const) {
  it(`recovers a genuinely lost mutex and resumes only the exact ${phase} flat backup allocation`, async () => {
    const f = createHistoricalFlatProfileFixture();
    const source = [f.databasePath, f.protectedPath, f.artifact, f.reportPath].map(path => ({ path, bytes: readFileSync(path), stat: statSync(path) }));
    try {
      const lost = loseMutex(f, phase), copy = join(lost.root, "files/profile/credentials/protected.json");
      const priorCopy = existsSync(copy) ? { bytes: readFileSync(copy), inode: statSync(copy).ino } : undefined;
      const sourceRecord = existsSync(join(lost.root, "source.json")) ? readFileSync(join(lost.root, "source.json")) : undefined;
      const result = await resume(f); assert.equal(result.exitCode, 0);
      assert.equal(existsSync(lost.mutex), false);
      assert.equal(existsSync(join(lost.control, "admission-mutex-recovery", lost.owner.acquisitionId, "owner.json")), true);
      assert.equal(existsSync(join(lost.root, "backup.json")), true);
      if (sourceRecord !== undefined) assert.deepEqual(readFileSync(join(lost.root, "source.json")), sourceRecord);
      if (priorCopy !== undefined) { assert.deepEqual(readFileSync(copy), priorCopy.bytes); assert.equal(statSync(copy).ino, priorCopy.inode); }
      for (const entry of source) {
        assert.deepEqual(readFileSync(entry.path), entry.bytes); assert.equal(statSync(entry.path).ino, entry.stat.ino); assert.equal(statSync(entry.path).mode, entry.stat.mode);
      }
      for (const name of ["machine", "profiles"]) assert.equal(existsSync(join(f.stateRoot, name)), false);
      for (const name of ["profile-registry.json", "profile-owner-claims", "profile-flat-claim.json", "profile-publication.json"]) assert.equal(existsSync(join(lost.control, name)), false);
    } finally { f.close(); }
  });
}

for (const change of ["malformed", "foreign", "missing-copy", "extra-copy", "extra-directory", "changed-copy", "source-bytes", "source-mode", "pending-operation", "foreign-allocation"] as const) {
  it(`retains the genuinely abandoned mutex and source for ${change} backup evidence`, async () => {
    const f = createHistoricalFlatProfileFixture();
    try {
      const lost = loseMutex(f, "complete"), receiptPath = join(lost.root, "backup.json"), copy = join(lost.root, "files/workspace-data/reports/historical-report.csv");
      if (change === "malformed") writeFileSync(receiptPath, "{}");
      if (change === "foreign") {
        const receipt: unknown = JSON.parse(readFileSync(receiptPath, "utf8"));
        assert.ok(receipt !== null && typeof receipt === "object" && "installationId" in receipt); receipt.installationId = "00000000-0000-4000-8000-000000000001"; writeFileSync(receiptPath, JSON.stringify(receipt));
      }
      if (change === "missing-copy") nativeFs.unlinkSync(copy);
      if (change === "extra-copy") writeFileSync(join(lost.root, "files/extra"), "unowned", { mode: 0o600 });
      if (change === "extra-directory") nativeFs.mkdirSync(join(lost.root, "files/extra"), { mode: 0o700 });
      if (change === "changed-copy") writeFileSync(copy, "changed");
      if (change === "source-bytes") writeFileSync(f.reportPath, "changed source");
      if (change === "source-mode") chmodSync(f.reportPath, 0o644);
      if (change === "pending-operation") writeFileSync(join(lost.control, "profile-publication.json"), "{}", { mode: 0o600 });
      if (change === "foreign-allocation") nativeFs.mkdirSync(join(dirname(lost.root), "00000000-0000-4000-8000-000000000001"), { mode: 0o700 });
      const owner = readFileSync(join(lost.mutex, "owner.json")), source = readFileSync(f.databasePath), receipt = readFileSync(receiptPath);
      await assert.rejects(resume(f));
      assert.deepEqual(readFileSync(join(lost.mutex, "owner.json")), owner); assert.deepEqual(readFileSync(f.databasePath), source); assert.deepEqual(readFileSync(receiptPath), receipt);
    } finally { f.close(); }
  });
}

it("retains the abandoned mutex when server custody becomes active", async () => {
  const f = createHistoricalFlatProfileFixture(); let lock: ReturnType<typeof acquireRuntimeProcessLock> | undefined;
  try {
    const lost = loseMutex(f, "complete");
    lock = acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name: "server", pid: process.pid });
    await assert.rejects(resume(f)); assert.equal(existsSync(join(lost.mutex, "owner.json")), true);
  } finally { lock?.release(); f.close(); }
});

it("rechecks copied physical identity at the final recovery custody barrier", async () => {
  const f = createHistoricalFlatProfileFixture();
  const write = nativeFs.writeFileSync.bind(nativeFs), rename = nativeFs.renameSync.bind(nativeFs); let changed = false;
  try {
    const lost = loseMutex(f, "complete"), copy = join(lost.root, "files/workspace-data/reports/historical-report.csv");
    const spy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, target) => {
      rename(source, target);
      if (!changed && String(target) === join(lost.control, "admission-mutex-recovery", `${lost.owner.acquisitionId}.json`)) {
        changed = true; const replacement = `${copy}.new`; write(replacement, readFileSync(copy), { mode: 0o600 }); rename(replacement, copy);
      }
    });
    syncBuiltinESMExports();
    try { await assert.rejects(resume(f)); assert.equal(changed, true); assert.equal(existsSync(join(lost.mutex, "owner.json")), true); }
    finally { spy.mockRestore(); syncBuiltinESMExports(); }
  } finally { f.close(); }
});

it("keeps an unobservable dead-owner PID refused without retiring its mutex", async () => {
  const f = createHistoricalFlatProfileFixture();
  const kill = process.kill.bind(process);
  try {
    const lost = loseMutex(f, "complete");
    const spy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === lost.owner.pid) throw Object.assign(new Error("fixture unknown PID observation"), { code: "EIO" });
      return kill(pid, signal);
    });
    try { await assert.rejects(resume(f), /could not observe/u); assert.equal(existsSync(join(lost.mutex, "owner.json")), true); }
    finally { spy.mockRestore(); }
  } finally { f.close(); }
});

it("keeps a live installation lease refused during flat mutex recovery", async () => {
  const f = createHistoricalFlatProfileFixture();
  try {
    const lost = loseMutex(f, "complete"), identity = observeProcessIdentity(process.pid); assert.equal(identity.state, "alive");
    if (identity.state !== "alive") throw new Error("fixture process unavailable");
    const admissionId = randomUUID();
    writeFileSync(join(lost.control, "leases", `${admissionId}.json`), JSON.stringify({ schemaVersion: 1, admissionId,
      mode: "shared", pid: process.pid, processIdentity: identity.identity }), { mode: 0o600 });
    await assert.rejects(resume(f), /lease may still be live/u); assert.equal(existsSync(join(lost.mutex, "owner.json")), true);
  } finally { f.close(); }
});

for (const change of ["source-reference", "allocation-reference", "foreign-receipt", "missing-owner", "extra-owner", "changed-owner", "unknown-history"] as const) {
  it(`refuses ${change} instead of extending the recovery-history exclusion`, async () => {
    const f = createHistoricalFlatProfileFixture();
    try {
      const lost = loseMutex(f, "complete"); assert.equal((await resume(f)).exitCode, 0);
      const history = join(lost.control, "admission-mutex-recovery"), receiptPath = join(history, `${lost.owner.acquisitionId}.json`);
      const archive = join(history, lost.owner.acquisitionId), ownerPath = join(archive, "owner.json");
      const receipt = MutexRecoveryReceiptSchema.parse(JSON.parse(readFileSync(receiptPath, "utf8")));
      assert.ok(receipt.flatBackup);
      if (change === "source-reference") receipt.flatBackup.sourceDigest = "0".repeat(64);
      if (change === "allocation-reference") receipt.flatBackup.allocationInode += 1;
      if (change === "foreign-receipt") receipt.installationId = randomUUID();
      if (["source-reference", "allocation-reference", "foreign-receipt"].includes(change)) writeFileSync(receiptPath, JSON.stringify(receipt));
      if (change === "missing-owner") nativeFs.unlinkSync(ownerPath);
      if (change === "extra-owner") writeFileSync(join(archive, "extra.json"), "{}", { mode: 0o600 });
      if (change === "changed-owner") writeFileSync(ownerPath, "{}");
      if (change === "unknown-history") writeFileSync(join(history, `${randomUUID()}.json`), "{}", { mode: 0o600 });
      const baseline = readFileSync(join(lost.root, "source.json"));
      await assert.rejects(resume(f)); assert.deepEqual(readFileSync(join(lost.root, "source.json")), baseline);
      assert.equal(existsSync(receiptPath), true); assert.equal(existsSync(archive), true);
    } finally { f.close(); }
  });
}

it("preserves recovery history in the later genuine claim snapshot and retains only its exact CLI reference", async () => {
  const f = createHistoricalFlatProfileFixture();
  try {
    const lost = loseMutex(f, "complete"); assert.equal((await resume(f)).exitCode, 0);
    const sourceRecord = readFileSync(join(lost.root, "source.json"));
    const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
    try {
      const owner = captureExistingDataOwner(machine, historicalFlatFields);
      const operation = await machine.claimExistingProfileData(owner, randomUUID(), systemClock, { ...historicalFlatFields, createdAt: systemClock.now().toISOString() });
      assert.ok(operation.ownerClaim); assert.equal(operation.onboarding?.finish, undefined);
      const claim = verifyExistingDataBackupFiles(operation.ownerClaim, f.workspace, machine.locator.installationId);
      assert.ok(claim.files.some(entry => entry.path === `control/admission-mutex-recovery/${lost.owner.acquisitionId}.json`));
      assert.ok(claim.files.some(entry => entry.path === `control/admission-mutex-recovery/${lost.owner.acquisitionId}/owner.json`));
      assert.equal(claim.storageBackup?.backupPath, join(lost.root, "backup.json"));
      assert.deepEqual(ownerClaimRecoveryCopies(machine, operation.profileId), [dirname(operation.ownerClaim.backupPath), lost.root]);
      assert.deepEqual(readFileSync(join(lost.root, "source.json")), sourceRecord);
      assert.equal(machine.readProfileRegistry().profiles.length, 0);
    } finally { machine.release(); }
  } finally { f.close(); }
});

it("refuses a hole in the declared copy prefix rather than resurrecting a missing completed copy", async () => {
  const f = createHistoricalFlatProfileFixture();
  try {
    const lost = loseMutex(f, "copy-prefix");
    const source = JSON.parse(readFileSync(join(lost.root, "source.json"), "utf8")) as { files: { path: string }[] };
    const first = source.files[0]; assert.ok(first);
    const copy = join(lost.root, "files", first.path); assert.equal(existsSync(copy), true); nativeFs.unlinkSync(copy);
    await assert.rejects(resume(f), /copy-refused/u);
    assert.equal(existsSync(copy), false); assert.equal(existsSync(join(lost.mutex, "owner.json")), true);
  } finally { f.close(); }
});

it("retains restore custody when the read-only snapshot reports unproved closure", async () => {
  const f = createHistoricalFlatProfileFixture(), remove = nativeFs.rmSync.bind(nativeFs); let failed = false;
  try {
    const lost = loseMutex(f, "complete");
    const spy = vi.spyOn(nativeFs, "rmSync").mockImplementation((path, options) => {
      remove(path, options);
      if (!failed && String(path).includes("relay-readonly-authority-")) { failed = true; throw new Error("fixture snapshot closure unproved"); }
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(resume(f), error => error instanceof AuthoritySourceClosureUnprovedError);
      assert.equal(failed, true); assert.equal(existsSync(join(f.processLockRoot, "restore-admission.lock.json")), true);
      assert.equal(existsSync(join(lost.mutex, "owner.json")), true);
    } finally { spy.mockRestore(); syncBuiltinESMExports(); }
  } finally { f.close(); }
});

for (const entry of ["src/backend/storage/maintenance/existing-data-backup.ts", "src/backend/storage/admission/bootstrap-admission.ts", "scripts/dev/secure-env-bootstrap.ts"]) {
  it(`loads ${entry} in a fresh module graph before any fixture admission`, () => {
    const script = `await import(${JSON.stringify(pathToFileURL(join(process.cwd(), entry)).href)}); process.stdout.write("fresh-import-complete");`;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), encoding: "utf8", timeout: 20_000 });
    assert.equal(child.status, 0, `${child.error?.message ?? ""}\n${child.stdout}\n${child.stderr}`);
    assert.equal(child.stdout, "fresh-import-complete");
  });
}

it("runs the actual backup bootstrap in a fresh flat fixture process", () => {
  const f = createHistoricalFlatProfileFixture();
  try {
    cpSync(join(process.cwd(), "src"), join(f.workspace, "src"), { recursive: true });
    mkdirSync(join(f.workspace, "scripts/dev"), { recursive: true });
    cpSync(join(process.cwd(), "scripts/dev/secure-env-bootstrap.ts"), join(f.workspace, "scripts/dev/secure-env-bootstrap.ts"));
    mkdirSync(join(f.workspace, "config"));
    for (const name of ["runtime-isolation.json", "test-data.json", "dashboard-workflow-sources.json"]) cpSync(join(process.cwd(), "config", name), join(f.workspace, "config", name));
    symlinkSync(dirname(dirname(fileURLToPath(import.meta.resolve("tsx/package.json")))), join(f.workspace, "node_modules"));
    const source = [f.databasePath, f.protectedPath, f.artifact, f.reportPath].map(path => ({ path, bytes: readFileSync(path), inode: statSync(path).ino }));
    const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/dev/secure-env-bootstrap.ts", "cli", "storage", "backup", "--json"], { cwd: f.workspace, encoding: "utf8", timeout: 20_000 });
    assert.equal(child.status, 0, `${child.error?.message ?? ""}\n${child.stdout}\n${child.stderr}`);
    const result = JSON.parse(child.stdout) as { coupledBackup: { backupPath: string } };
    assert.equal(existsSync(result.coupledBackup.backupPath), true);
    for (const entry of source) { assert.deepEqual(readFileSync(entry.path), entry.bytes); assert.equal(statSync(entry.path).ino, entry.inode); }
    assert.equal(existsSync(join(f.stateRoot, "machine")), false); assert.equal(existsSync(join(f.stateRoot, "profiles")), false);
  } finally { f.close(); }
});

for (const replacement of ["malformed", "flat-binding", "recovered-at"] as const) {
  it(`refuses publication-time same-path ${replacement} receipt substitution before its first pin`, async () => {
    const f = createHistoricalFlatProfileFixture(), rename = nativeFs.renameSync.bind(nativeFs); let substituted = false;
    try {
      const lost = loseMutex(f, "complete"), receiptPath = join(lost.control, "admission-mutex-recovery", `${lost.owner.acquisitionId}.json`);
      const owner = readFileSync(join(lost.mutex, "owner.json"));
      const spy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, target) => {
        rename(source, target);
        if (!substituted && String(target) === receiptPath) {
          substituted = true;
          const receipt = MutexRecoveryReceiptSchema.parse(JSON.parse(readFileSync(receiptPath, "utf8")));
          assert.ok(receipt.flatBackup);
          if (replacement === "flat-binding") receipt.flatBackup.sourceDigest = "0".repeat(64);
          if (replacement === "recovered-at") receipt.recoveredAt = "2000-01-01T00:00:00.000Z";
          const path = `${receiptPath}.substitute`;
          writeFileSync(path, replacement === "malformed" ? "{}" : JSON.stringify(receipt), { mode: 0o600 });
          rename(path, receiptPath);
        }
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(resume(f)); assert.equal(substituted, true);
        assert.deepEqual(readFileSync(join(lost.mutex, "owner.json")), owner);
        assert.equal(existsSync(join(lost.control, "admission-mutex-recovery", lost.owner.acquisitionId)), false);
        assert.equal(existsSync(receiptPath), true);
      } finally { spy.mockRestore(); syncBuiltinESMExports(); }
    } finally { f.close(); }
  });
}

it("preserves the exact prior receipt timestamp when retrying its genuine publication prefix", async () => {
  const f = createHistoricalFlatProfileFixture(), rename = nativeFs.renameSync.bind(nativeFs); let interrupted = false;
  try {
    const lost = loseMutex(f, "complete"), receiptPath = join(lost.control, "admission-mutex-recovery", `${lost.owner.acquisitionId}.json`);
    const spy = vi.spyOn(nativeFs, "renameSync").mockImplementation((source, target) => {
      rename(source, target);
      if (!interrupted && String(target) === receiptPath) { interrupted = true; throw new Error("fixture interrupted receipt publication"); }
    });
    syncBuiltinESMExports();
    try { await assert.rejects(resume(f)); assert.equal(interrupted, true); assert.equal(existsSync(join(lost.mutex, "owner.json")), true); }
    finally { spy.mockRestore(); syncBuiltinESMExports(); }
    const published = readFileSync(receiptPath);
    assert.equal((await resume(f)).exitCode, 0);
    assert.deepEqual(readFileSync(receiptPath), published); assert.equal(existsSync(lost.mutex), false);
  } finally { f.close(); }
});
