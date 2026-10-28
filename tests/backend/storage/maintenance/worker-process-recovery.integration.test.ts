import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { workerBootstrapEnvironment } from "../../../../src/models/config/secrets.js";
import nativeFs, { chmodSync, copyFileSync, existsSync, linkSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it, vi } from "vitest";
import { createHistoricalFlatProfileFixture } from "../../../support/fixtures/storage/historical-flat-profile-fixture.js";
import { runOfflineWorkerProcessRecovery } from "../../../../src/backend/storage/maintenance/worker-process-recovery.js";
import { profileProcessQuery } from "../../../../src/backend/storage/maintenance/process-closure.js";
import { acquireRuntimeProcessLock, validateWorkerProcessRecoveryReceipt, inspectRuntimeProcessOrphans, inspectStoppedDeviceRecertificationCustody, workerProcessRecoveryProved, observeProcessIdentity, WorkerProcessLockFileSchema, WORKER_PROCESS_RECOVERY_DIRECTORY } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireStorageBackupEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { captureExistingDataOwner } from "../../../../src/backend/storage/configuration/credential-store.js";
import { historicalFlatFields } from "../../../support/fixtures/storage/historical-flat-profile-fixture.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { randomUUID } from "node:crypto";
import { verifyExistingDataBackupFiles } from "../../../../src/backend/storage/maintenance/existing-data-backup-files.js";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const close of cleanups.splice(0)) close(); });
function fixture(options: Parameters<typeof createHistoricalFlatProfileFixture>[0] & { missingLease?: boolean } = { closedBrowser: true }) {
  const f = createHistoricalFlatProfileFixture(options); cleanups.push(() => f.close());
  if (options.missingLease) {
    const raw = new DatabaseSync(f.databasePath);
    try { assert.equal(raw.prepare("DELETE FROM worker_leases WHERE worker_id = ?").run("person-lookup-worker-1").changes, 1); }
    finally { raw.close(); }
  }
  const module = pathToFileURL(join(process.cwd(), "src/backend/storage/sqlite/runtime-process-locks.ts")).href;
  const script = `
    import { acquireRuntimeProcessLock } from ${JSON.stringify(module)};
    const handle = acquireRuntimeProcessLock({ processLockRoot: process.argv[1], name: "workers", workerId: "synthetic-recovery-worker", pid: process.pid });
    process.stdout.write(handle.acquisitionId);
  `;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, f.processLockRoot],
    { encoding: "utf8", timeout: 20_000, env: workerBootstrapEnvironment() });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.error, undefined);
  const acquisitionId = z.uuid().parse(child.stdout.trim()), path = join(f.processLockRoot, "workers", `${acquisitionId}.lock.json`);
  const original = WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  assert.equal(original.pid, child.pid); assert.equal(original.releasedAt, null);
  assert.equal(observeProcessIdentity(original.pid).state, "gone");
  const plan = () => runOfflineWorkerProcessRecovery(f.workspace, ["--acquisition", acquisitionId, "--plan", "--json"]);
  const apply = (digest: string) => runOfflineWorkerProcessRecovery(f.workspace, ["--acquisition", acquisitionId, "--capture", digest, "--apply", "--json"]);
  const before = [path, f.databasePath, f.protectedPath].map(path => ({ path, bytes: readFileSync(path), inode: statSync(path).ino }));
  const unchanged = () => {
    for (const value of before) { assert.deepEqual(readFileSync(value.path), value.bytes); assert.equal(statSync(value.path).ino, value.inode); }
    assert.equal(WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(path, "utf8"))).releasedAt, null);
  };
  vi.spyOn(profileProcessQuery, "spawnSync").mockImplementation(command => ({ pid: 0, output: [], stderr: "", status: 0, signal: null,
    stdout: command === "/bin/ps" ? ` ${process.pid} synthetic-proof\n` : `p${process.pid}\nfcwd\ntDIR\nn/synthetic-other-root\n` }));
  return { ...f, acquisitionId, path, plan, apply, unchanged, receipt: join(f.processLockRoot, WORKER_PROCESS_RECOVERY_DIRECTORY, `${acquisitionId}.json`) };
}

function deadSingletonClaims(f: ReturnType<typeof fixture>) {
  const owner = WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(f.path, "utf8")));
  return (["server", "live-smoke", "geocode"] as const).map(role => {
    const handle = acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name: role, pid: owner.pid }, systemClock,
      { observeProcessIdentity: () => ({ state: "alive", identity: owner.processIdentity }) });
    const path = join(f.processLockRoot, `${role}-claims`, `${handle.generation}.claim.json`);
    return { role, acquisitionId: handle.acquisitionId, pid: owner.pid, generation: handle.generation, path, bytes: readFileSync(path), inode: statSync(path).ino };
  });
}

it("plans and applies proved-gone unreleased singleton claims with bound receipt evidence and unchanged files", () => {
  const f = fixture(), claims = deadSingletonClaims(f), plan = f.plan();
  assert.equal(plan.report.state, "planned"); assert.equal(existsSync(f.receipt), false);
  assert.equal(f.apply(plan.report.captureDigest).report.state, "recovered");
  const receipt = validateWorkerProcessRecoveryReceipt(JSON.parse(readFileSync(f.receipt, "utf8")));
  assert.deepEqual(receipt.capture.singletonClaims.map(({ role, generation, acquisitionId, pid, observation }) =>
    ({ role, generation, acquisitionId, pid, observation })), claims.map(({ role, generation, acquisitionId, pid }) =>
    ({ role, generation, acquisitionId, pid, observation: { state: "gone" } })));
  for (const claim of claims) {
    assert.deepEqual(readFileSync(claim.path), claim.bytes); assert.equal(statSync(claim.path).ino, claim.inode);
    assert.deepEqual(readdirSync(join(f.processLockRoot, `${claim.role}-claims`)), [`${claim.generation}.claim.json`]);
  }
  f.unchanged();
  assert.equal(f.apply(plan.report.captureDigest).report.state, "already-recovered");
});

it("refuses a gone singleton claim changed between plan and apply", () => {
  const f = fixture(), claims = deadSingletonClaims(f), plan = f.plan();
  const claim = claims[0]; assert.ok(claim);
  writeFileSync(claim.path, `${claim.bytes.toString("utf8")}\n`);
  assert.notEqual(f.plan().report.captureDigest, plan.report.captureDigest);
  assert.throws(() => f.apply(plan.report.captureDigest), /worker-process-recovery-capture-changed/u);
  assert.equal(existsSync(f.receipt), false); f.unchanged();
});

it("refuses a live singleton owner before planning recovery", () => {
  const f = fixture();
  const lock = acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name: "server", pid: process.pid });
  try { assert.throws(() => f.plan(), /worker-process-recovery-(other-owner-unreleased|runtime-active)/u); }
  finally { lock.release(); }
  assert.equal(existsSync(f.receipt), false); f.unchanged();
});

it("plans without mutation, recovers a native6 flat installation without registry, and admits existing backup while preserving original custody/history", async () => {
  const f = fixture();
  const lockNames = readdirSync(f.processLockRoot), controlNames = readdirSync(join(f.workspace, ".tracker/control"));
  assert.equal(existsSync(join(f.workspace, ".tracker/control/profile-registry.json")), false);
  assert.throws(() => RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace), /process-custody-unproved/u);
  // The failed admission above owns its own historical restore record; plan must add none.
  const beforePlan = readdirSync(f.processLockRoot);
  const plan = f.plan(); assert.equal(plan.report.state, "planned");
  assert.deepEqual(readdirSync(f.processLockRoot), beforePlan);
  assert.deepEqual(readdirSync(join(f.workspace, ".tracker/control")), controlNames);
  f.unchanged(); assert.equal(existsSync(f.receipt), false);
  const recovered = f.apply(plan.report.captureDigest);
  assert.equal(recovered.report.state, "recovered"); assert.equal(existsSync(f.receipt), true);
  f.unchanged(); assert.equal(WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(f.path, "utf8"))).releasedAt, null);
  assert.deepEqual(inspectRuntimeProcessOrphans(f.processLockRoot), { staleWorkerRecords: 0, staleServerRecords: 0 });
  const admission = await acquireStorageBackupEntrypointAdmission(f.workspace);
  try { assert.equal(admission.isFlatBackup(), true); } finally { admission.release(); }
  assert.equal(f.apply(plan.report.captureDigest).report.state, "already-recovered"); f.unchanged();
  assert.ok(lockNames.includes("workers"));
});

it("refuses protected source changes during final process closure before publishing recovery", () => {
  const f = fixture(), plan = f.plan(); let lsofObservations = 0, injected = false;
  vi.mocked(profileProcessQuery.spawnSync).mockImplementation(command => {
    if (command === "/usr/sbin/lsof" && ++lsofObservations === 2) {
      writeFileSync(f.protectedPath, `${readFileSync(f.protectedPath, "utf8")} `);
      injected = true;
    }
    return { pid: 0, output: [], stderr: "", status: 0, signal: null,
      stdout: command === "/bin/ps" ? ` ${process.pid} synthetic-proof\n` : `p${process.pid}\nfcwd\ntDIR\nn/synthetic-other-root\n` };
  });
  try { assert.throws(() => f.apply(plan.report.captureDigest), /worker-process-recovery-source-changed/u); }
  finally { assert.equal(injected, true); }
  assert.equal(existsSync(f.receipt), false);
});

it("recovers an unretired historical slot with a matching stopped lease and closed browser while preserving custody/history", () => {
  const f = fixture({ closedBrowser: true, unretiredWorker: true }), plan = f.plan();
  const recovered = f.apply(plan.report.captureDigest);
  assert.equal(recovered.report.state, "recovered"); assert.equal(existsSync(f.receipt), true);
  f.unchanged();
  assert.deepEqual(inspectRuntimeProcessOrphans(f.processLockRoot), { staleWorkerRecords: 0, staleServerRecords: 0 });
});

for (const options of [{ unknownWrite: true }, { closedBrowser: true, unretiredWorker: true, missingLease: true }]) {
  it(`keeps native custody held without altering journals ${JSON.stringify(options)}`, () => {
    const f = fixture(options), plan = f.plan();
    assert.throws(() => f.apply(plan.report.captureDigest));
    f.unchanged(); assert.equal(existsSync(f.receipt), false);
    assert.equal(inspectRuntimeProcessOrphans(f.processLockRoot).staleWorkerRecords, 1);
  });
}

for (const change of ["bytes", "inode", "mode", "capture", "pending", "os-failure"] as const) {
  it(`refuses changed or uncertain ${change} custody before publishing recovery`, () => {
    const f = fixture(), plan = f.plan(); let digest = plan.report.captureDigest;
    if (change === "bytes") writeFileSync(f.path, `${readFileSync(f.path, "utf8")}\n`);
    if (change === "inode") { copyFileSync(f.path, `${f.path}.replacement`); renameSync(`${f.path}.replacement`, f.path); }
    if (change === "mode") chmodSync(f.path, 0o644);
    if (change === "capture") digest = "0".repeat(64);
    if (change === "pending") writeFileSync(join(f.processLockRoot, "workers", ".pending"), "unfinished", { mode: 0o600 });
    if (change === "os-failure") vi.mocked(profileProcessQuery.spawnSync).mockReturnValue({ pid: 0, output: [], stderr: "incomplete", stdout: "", status: 1, signal: null });
    assert.throws(() => f.apply(digest)); assert.equal(existsSync(f.receipt), false);
  });
}

for (const change of ["receipt", "record", "physical-record", "stage", "worker-stage"] as const) {
  it(`fresh consumers refuse changed ${change} after recovery`, () => {
    const f = fixture(), plan = f.plan(); f.apply(plan.report.captureDigest);
    if (change === "receipt") writeFileSync(f.receipt, "{}");
    if (change === "record") writeFileSync(f.path, `${readFileSync(f.path, "utf8")}\n`);
    if (change === "physical-record") { copyFileSync(f.path, `${f.path}.replacement`); renameSync(`${f.path}.replacement`, f.path); }
    if (change === "worker-stage") writeFileSync(join(f.processLockRoot, "workers", ".unknown.tmp"), "unfinished", { mode: 0o600 });
    if (change === "stage") writeFileSync(join(f.processLockRoot, WORKER_PROCESS_RECOVERY_DIRECTORY, ".unknown.tmp"), "unfinished", { mode: 0o600 });
    assert.throws(() => inspectRuntimeProcessOrphans(f.processLockRoot));
    assert.throws(() => RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace));
  });
}

for (const phase of ["before-link", "after-link"] as const) {
  it(`preserves uncertain ${phase} publication and never cleans it up or admits backup`, () => {
    const f = fixture(), plan = f.plan(), link = nativeFs.linkSync.bind(nativeFs);
    vi.spyOn(nativeFs, "linkSync").mockImplementation((source, destination) => {
      if (String(destination) !== f.receipt) return link(source, destination);
      if (phase === "after-link") link(source, destination);
      throw new Error("synthetic publication interruption");
    });
    syncBuiltinESMExports();
    assert.throws(() => f.apply(plan.report.captureDigest), /synthetic publication interruption/u);
    assert.equal(existsSync(join(f.processLockRoot, WORKER_PROCESS_RECOVERY_DIRECTORY, `.${f.acquisitionId}.tmp`)), true);
    assert.throws(() => inspectRuntimeProcessOrphans(f.processLockRoot));
    f.unchanged();
  });
}

it("keeps recovered flat custody outside finite historical device recertification while preserving supported backup and private claim", async () => {
  const f = fixture(), plan = f.plan(); f.apply(plan.report.captureDigest);
  const receipt = readFileSync(f.receipt), originalBytes = readFileSync(f.path), originalInode = statSync(f.path).ino;
  const original = WorkerProcessLockFileSchema.parse(JSON.parse(originalBytes.toString("utf8")));
  assert.equal(workerProcessRecoveryProved(f.processLockRoot, original), true);
  assert.throws(() => inspectStoppedDeviceRecertificationCustody(f.processLockRoot), /device-recertification-worker-custody-unproved/u);
  const backup = await acquireStorageBackupEntrypointAdmission(f.workspace);
  try { assert.equal(backup.isFlatBackup(), true); } finally { backup.release(); }
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
  try {
    const owner = captureExistingDataOwner(machine, historicalFlatFields);
    const operation = await machine.claimExistingProfileData(owner, randomUUID(), systemClock,
      { ...historicalFlatFields, createdAt: systemClock.now().toISOString() });
    assert.ok(operation.ownerClaim);
    assert.equal(existsSync(operation.ownerClaim.backupPath), true);
    const verified = verifyExistingDataBackupFiles(operation.ownerClaim, f.workspace, machine.locator.installationId);
    assert.equal(verified.sourceStateRoot, f.stateRoot); assert.equal(verified.profileId, operation.profileId);
    assert.equal(operation.onboarding?.finish, undefined);
    assert.equal(machine.readProfileRegistry().profiles.length, 0);
    assert.equal(workerProcessRecoveryProved(f.processLockRoot, original), true);
    assert.throws(() => inspectStoppedDeviceRecertificationCustody(f.processLockRoot), /device-recertification-worker-custody-unproved/u);
    assert.deepEqual(readFileSync(f.receipt), receipt);
    assert.deepEqual(readFileSync(f.path), originalBytes); assert.equal(statSync(f.path).ino, originalInode);
    assert.deepEqual(WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(f.path, "utf8"))), original);
  } finally { machine.release(); }
});

for (const change of ["missing", "witness", "root", "receipt-mode", "receipt-hardlink", "foreign-receipt"] as const) {
  it(`authenticates current recovery custody through fresh consumers after ${change}`, () => {
    const f = fixture(), plan = f.plan(); f.apply(plan.report.captureDigest);
    const original = WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(f.path, "utf8")));
    if (change === "missing") unlinkSync(f.receipt);
    if (change === "witness") writeFileSync(join(f.workspace, ".tracker/control/locator.json"), `${readFileSync(join(f.workspace, ".tracker/control/locator.json"), "utf8")}\n`);
    if (change === "root") chmodSync(f.artifactRoot, 0o750);
    if (change === "receipt-mode") chmodSync(f.receipt, 0o644);
    if (change === "receipt-hardlink") linkSync(f.receipt, join(f.workspace, "receipt-alias"));
    if (change === "foreign-receipt") {
      const foreign = fixture(), foreignPlan = foreign.plan(); foreign.apply(foreignPlan.report.captureDigest);
      copyFileSync(foreign.receipt, f.receipt);
    }
    if (change === "missing") {
      assert.equal(workerProcessRecoveryProved(f.processLockRoot, original), false);
      assert.equal(inspectRuntimeProcessOrphans(f.processLockRoot).staleWorkerRecords, 1);
    } else {
      assert.throws(() => workerProcessRecoveryProved(f.processLockRoot, original));
      assert.throws(() => inspectRuntimeProcessOrphans(f.processLockRoot));
    }
  });
}

it("requires freshly gone owners even when canonical receipt and capture authenticate", () => {
  const f = fixture(), plan = f.plan(); f.apply(plan.report.captureDigest);
  const record = WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(f.path, "utf8")));
  assert.equal(workerProcessRecoveryProved(f.processLockRoot, record), true);
  const unavailable = new Error("synthetic-process-identity-unavailable");
  assert.throws(() => workerProcessRecoveryProved(f.processLockRoot, record, () => { throw unavailable; }), error => error === unavailable);
  for (const observed of [{ state: "alive" as const, identity: record.processIdentity },
    { state: "alive" as const, identity: { ...record.processIdentity, startToken: `${record.processIdentity.startToken}-reused` } }]) {
    assert.throws(() => workerProcessRecoveryProved(f.processLockRoot, record, () => observed), /worker-process-recovery-owner-not-gone/u);
  }
});

for (const phase of ["stage-fsync", "linked-directory-fsync", "unlinked-directory-fsync", "stage-unlink", "readback", "readback-parse"] as const) {
  it(`keeps exact publication facts after ${phase} failure and reauthenticates with a fresh consumer`, () => {
    const f = fixture(), plan = f.plan(), directory = join(f.processLockRoot, WORKER_PROCESS_RECOVERY_DIRECTORY);
    const stage = join(directory, `.${f.acquisitionId}.tmp`), sync = nativeFs.fsyncSync.bind(nativeFs), unlink = nativeFs.unlinkSync.bind(nativeFs);
    const read = nativeFs.readFileSync.bind(nativeFs), primary = new Error(`synthetic-${phase}`);
    let fired = false;
    vi.spyOn(nativeFs, "fsyncSync").mockImplementation(fd => {
      const opened = nativeFs.fstatSync(fd);
      const same = (path: string) => existsSync(path) && statSync(path).ino === opened.ino && statSync(path).dev === opened.dev;
      if (phase === "stage-fsync" && same(stage) || phase === "linked-directory-fsync" && same(directory) && existsSync(f.receipt) && existsSync(stage)
        || phase === "unlinked-directory-fsync" && same(directory) && existsSync(f.receipt) && !existsSync(stage)) { fired = true; throw primary; }
      sync(fd);
    });
    vi.spyOn(nativeFs, "unlinkSync").mockImplementation(path => {
      if (phase === "stage-unlink" && String(path) === stage) { fired = true; throw primary; }
      unlink(path);
    });
    vi.spyOn(nativeFs, "readFileSync").mockImplementation((...args: Parameters<typeof nativeFs.readFileSync>) => {
      if ((phase === "readback" || phase === "readback-parse") && typeof args[0] === "number" && existsSync(f.receipt) && !existsSync(stage)) {
        const opened = nativeFs.fstatSync(args[0]), final = statSync(f.receipt);
        if (opened.ino === final.ino && opened.dev === final.dev) {
          fired = true;
          if (phase === "readback-parse") return Buffer.alloc(final.size, 0x20);
          throw primary;
        }
      }
      return read(...args);
    });
    syncBuiltinESMExports();
    try {
      if (phase === "readback-parse") assert.throws(() => f.apply(plan.report.captureDigest), SyntaxError);
      else assert.throws(() => f.apply(plan.report.captureDigest), error => error === primary);
    }
    finally { vi.restoreAllMocks(); syncBuiltinESMExports(); }
    assert.equal(fired, true);
    const stagePresent = ["stage-fsync", "linked-directory-fsync", "stage-unlink"].includes(phase);
    assert.equal(existsSync(stage), stagePresent);
    assert.equal(existsSync(f.receipt), phase !== "stage-fsync");
    if (existsSync(f.receipt)) assert.equal(statSync(f.receipt).nlink, stagePresent ? 2 : 1);
    if (stagePresent) assert.throws(() => inspectRuntimeProcessOrphans(f.processLockRoot));
    else assert.equal(inspectRuntimeProcessOrphans(f.processLockRoot).staleWorkerRecords, 0);
    assert.equal(existsSync(join(f.processLockRoot, "restore-admission.lock.json")), false);
    assert.deepEqual(readdirSync(join(f.workspace, ".tracker/control/leases")), []);
    f.unchanged();
  });
}

for (const phase of ["original-close", "witness-close", "receipt-close", "stage-sync-close", "database-close-1", "database-close-2",
  "snapshot-dispose-1", "snapshot-dispose-2", "iterator-close", "lease-release", "restore-release"] as const) {
  it(`retains command custody after ${phase} until the isolated owner exits`, () => {
    const f = fixture(), plan = f.plan();
    const child = spawnSync(process.execPath, ["--import", "tsx", "tests/support/processes/worker-process-recovery-fault-child.ts",
      f.workspace, f.acquisitionId, plan.report.captureDigest, phase], { encoding: "utf8", timeout: 20_000, env: workerBootstrapEnvironment() });
    assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
    const result = z.object({ phase: z.literal(phase), pid: z.number(), snapshot: z.string().optional(),
      closure: z.literal("process-exit-required"), published: z.boolean(), leaseCount: z.number() }).parse(JSON.parse(child.stdout));
    assert.equal(result.pid, child.pid); assert.equal(observeProcessIdentity(result.pid).state, "gone");
    for (const root of [f.workspace, ...(result.snapshot === undefined ? [] : [result.snapshot])]) {
      const closure = spawnSync("/usr/sbin/lsof", ["-nP", "+D", root, "-Fn"], { encoding: "utf8" });
      assert.equal(closure.error, undefined); assert.equal(closure.status, 1, closure.stdout + closure.stderr);
      assert.equal(closure.stdout, ""); assert.equal(closure.stderr, "");
    }
    if (result.snapshot !== undefined) rmSync(result.snapshot, { recursive: true });
    f.unchanged();
    process.stdout.write(`${JSON.stringify({ recoveryFaultProof: result, owner: "gone", openFiles: "absent" })}\n`);
  });
}
