import { default as assert_m0,default as assert_m2,default as assert_m3,default as assert_m4 } from "node:assert/strict";
import { spawn as spawn_m1,spawn as spawn_m2,spawn as spawn_m4,type ChildProcess as ChildProcess_m1,type ChildProcess as ChildProcess_m2,type ChildProcess as ChildProcess_m4 } from "node:child_process";
import { createHash as createHash_m1,randomUUID as randomUUID_m1,randomUUID as randomUUID_m4 } from "node:crypto";
import * as filesystem_m1 from "node:fs";
import * as filesystem_m4 from "node:fs";
import { copyFileSync as copyFileSync_m0,copyFileSync as copyFileSync_m3,existsSync as existsSync_m0,existsSync as existsSync_m1,existsSync as existsSync_m2,existsSync as existsSync_m4,mkdirSync as mkdirSync_m1,mkdirSync as mkdirSync_m4,mkdtempSync as mkdtempSync_m0,mkdtempSync as mkdtempSync_m1,mkdtempSync as mkdtempSync_m2,mkdtempSync as mkdtempSync_m3,mkdtempSync as mkdtempSync_m4,readFileSync as readFileSync_m1,readFileSync as readFileSync_m2,readFileSync as readFileSync_m3,readFileSync as readFileSync_m4,readdirSync as readdirSync_m1,readdirSync as readdirSync_m4,realpathSync as realpathSync_m0,realpathSync as realpathSync_m1,realpathSync as realpathSync_m2,realpathSync as realpathSync_m3,realpathSync as realpathSync_m4,rmSync as rmSync_m0,rmSync as rmSync_m1,rmSync as rmSync_m2,rmSync as rmSync_m3,rmSync as rmSync_m4,rmdirSync as rmdirSync_m1,symlinkSync as symlinkSync_m4,writeFileSync as writeFileSync_m1,writeFileSync as writeFileSync_m4 } from "node:fs";
import { tmpdir as tmpdir_m0,tmpdir as tmpdir_m1,tmpdir as tmpdir_m2,tmpdir as tmpdir_m3,tmpdir as tmpdir_m4 } from "node:os";
import { join as join_m0,join as join_m1,join as join_m2,join as join_m3,join as join_m4 } from "node:path";
import { DatabaseSync as DatabaseSync_m3 } from "node:sqlite";
import { pathToFileURL as pathToFileURL_m1,pathToFileURL as pathToFileURL_m2,pathToFileURL as pathToFileURL_m4 } from "node:url";
import { expect as expect_m1,it as it_m0,it as it_m1,it as it_m2,it as it_m3,it as it_m4,vi } from "vitest";
import { composeDashboardRuntime as composeDashboardRuntime_m0 } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { composeStorageCommand as composeStorageCommand_m3,runOfflineAuthorityRestoreRecovery as runOfflineAuthorityRestoreRecovery_m2 } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m0,rebuildRuntimeIsolation as rebuildRuntimeIsolation_m3 } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireEntrypointAdmission as acquireEntrypointAdmission_m0,acquireEntrypointAdmission as acquireEntrypointAdmission_m1,acquireEntrypointAdmission as acquireEntrypointAdmission_m2,acquireEntrypointAdmission as acquireEntrypointAdmission_m3,acquireEntrypointAdmission as acquireEntrypointAdmission_m4 } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AdmissionMutexBusyError as AdmissionMutexBusyError_m1,AdmissionMutexBusyError as AdmissionMutexBusyError_m4,recoverAbandonedAdmissionMutex as recoverAbandonedAdmissionMutex_m1 } from "../../../../src/backend/storage/admission/installation.js";
import { backupStoppedAuthority as backupStoppedAuthority_m3 } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase as AuthorityDatabase_m2,AuthorityDatabase as AuthorityDatabase_m3 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AuthorityHealthPreflightRunner as AuthorityHealthPreflightRunner_m3 } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import * as locks_m1 from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import * as processLocks_m4 from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { createDashboardClient as createDashboardClient_m0 } from "../../../../src/dashboard/client/index.js";
import { manualClock as manualClock_m0,manualClock as manualClock_m3 } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify as canonicalJsonStringify_m1 } from "../../../../src/rules/validation/canonical-json.js";
import { runtimeFixture as runtimeFixture_m3 } from "../../../support/fixtures/preflight/runtime-fixture.js";
import { doctorAuthorityStorage as doctorAuthorityStorage_m3 } from "../../../support/helpers/synthetic-storage-admission.js";
vi.mock("node:fs", async importOriginal => {
 const actual = await importOriginal<typeof import("node:fs")>();
 return { ...actual, readdirSync: vi.fn(actual.readdirSync), mkdirSync: vi.fn(actual.mkdirSync), lstatSync: vi.fn(actual.lstatSync) };
});

{


it_m0("initializes fresh authority before admission and refuses a later missing database", async () => {
  const workspace = realpathSync_m0(mkdtempSync_m0(join_m0(tmpdir_m0(), "relocation-fresh-bff-")));
  const authorityPath = join_m0(workspace, rebuildRuntimeIsolation_m0.stateRoot, "state.db");
  const clock = manualClock_m0(new Date("2026-09-26T12:00:00.000Z"));
  try {
    copyFileSync_m0(join_m0(process.cwd(), "package.json"), join_m0(workspace, "package.json"));
    copyFileSync_m0(join_m0(process.cwd(), "package-lock.json"), join_m0(workspace, "package-lock.json"));
    const first = acquireEntrypointAdmission_m0(workspace, "shared");
    try {
      assert_m0.equal(existsSync_m0(authorityPath), true);
      const runtime = await composeDashboardRuntime_m0({ admission: first, isolation: rebuildRuntimeIsolation_m0, repoRoot: workspace,
        env: {}, clock, backendPortOverride: 0, frontendPortOverride: 0 });
      try {
        const client = createDashboardClient_m0({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
        assert_m0.equal((await client.storageRelocationPlans()).revision, 0);
      } finally { await runtime.stop(); }
    } finally { first.release(); }

    rmSync_m0(authorityPath);
    const later = acquireEntrypointAdmission_m0(workspace, "shared");
    try {
      await assert_m0.rejects(composeDashboardRuntime_m0({ admission: later, isolation: rebuildRuntimeIsolation_m0,
        repoRoot: workspace, env: {}, clock, backendPortOverride: 0, frontendPortOverride: 0 }),
      /dashboard state root is established but its authority database is missing/u);
      assert_m0.equal(existsSync_m0(authorityPath), false);
    } finally { later.release(); }
  } finally { rmSync_m0(workspace, { recursive: true, force: true }); }
}, 20_000);
}

{
const roots: string[] = [];
const children: ChildProcess_m1[] = [];
async function kill(child: ChildProcess_m1): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill("SIGKILL"); });
}
const _afterEachFixture0 = async () => {
  vi.restoreAllMocks();
  await Promise.all(children.splice(0).map(kill));
  for (const root of roots.splice(0)) rmSync_m1(root, { recursive: true, force: true });
};
function fixture(): string {
  const root = realpathSync_m1(mkdtempSync_m1(join_m1(tmpdir_m1(), "admission-crash-")));
  roots.push(root);
  acquireEntrypointAdmission_m1(root, "exclusive").release();
  return root;
}
async function pausedChild(root: string, window: string): Promise<ChildProcess_m1> {
  const url = pathToFileURL_m1(join_m1(process.cwd(), "src/backend/storage/admission/bootstrap-admission.ts")).href;
  const code = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const window = ${JSON.stringify(window)};
    const pause = () => { fs.writeSync(1, 'PAUSED\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };
    const mkdir = fs.mkdirSync, rename = fs.renameSync, unlink = fs.unlinkSync;
    fs.mkdirSync = (...args) => { const result = mkdir(...args);
      if (window === 'pre-owner' && String(args[0]).includes('.admission-mutex-tmp-')) pause(); return result; };
    fs.renameSync = (...args) => { const result = rename(...args);
      if (window === 'prepared' && String(args[1]).endsWith('/owner.json') && String(args[1]).includes('admission-mutex')) pause();
      if (window === 'released' && String(args[0]).endsWith('/admission-mutex')) pause(); return result; };
    fs.unlinkSync = (...args) => { const result = unlink(...args);
      if (window === 'released' && String(args[0]).endsWith('/admission-mutex/owner.json')) pause(); return result; };
    syncBuiltinESMExports();
    const { acquireEntrypointAdmission } = await import(${JSON.stringify(url)});
    acquireEntrypointAdmission(process.argv[1], 'shared').release();
  `;
  const child = spawn_m1(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, root], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", chunk => { output += String(chunk); if (output.includes("PAUSED")) resolve(); });
    child.stderr?.on("data", chunk => { output += String(chunk); });
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`child exited ${String(code)}: ${output}`)));
  });
  return child;
}
it_m1.each(["prepared", "released"])("cleans an actual killed child's %s folder without a canonical empty lock", async window => {
try {


  const root = fixture();
  const child = await pausedChild(root, window);
  await kill(child);
  const control = join_m1(root, ".tracker/control");
  expect_m1(existsSync_m1(join_m1(control, "admission-mutex"))).toBe(false);
  expect_m1(readdirSync_m1(control).some(name => name.startsWith(".admission-mutex-"))).toBe(true);
  acquireEntrypointAdmission_m1(root, "shared").release();
  expect_m1(readdirSync_m1(control).filter(name => name.startsWith(".admission-mutex-"))).toEqual([]);

} finally {
await _afterEachFixture0();
}
});
it_m1("preserves a live temporary folder before owner publication and cleans it only after death", async () => {
try {


  const root = fixture();
  const child = await pausedChild(root, "pre-owner");
  const control = join_m1(root, ".tracker/control");
  const name = readdirSync_m1(control).find(entry => entry.startsWith(".admission-mutex-tmp-"));
  expect_m1(name).toBeDefined();
  acquireEntrypointAdmission_m1(root, "shared").release();
  expect_m1(readdirSync_m1(join_m1(control, name!))).toEqual([]);
  await kill(child);
  acquireEntrypointAdmission_m1(root, "shared").release();
  expect_m1(existsSync_m1(join_m1(control, name!))).toBe(false);

} finally {
await _afterEachFixture0();
}
});
it_m1("refuses an empty canonical lock immediately and archives its empty custody with a receipt", async () => {
try {


  const root = fixture();
  const path = join_m1(root, ".tracker/control", "admission-mutex");
  mkdirSync_m1(path, { mode: 0o700 });
  const wait = vi.spyOn(Atomics, "wait");
  let failure: unknown;
  try { acquireEntrypointAdmission_m1(root, "shared"); } catch (error) { failure = error; }
  expect_m1(failure).toBeInstanceOf(AdmissionMutexBusyError_m1);
  expect_m1(failure).toMatchObject({ name: "AdmissionMutexEmptyError" });
  expect_m1(String(failure)).toContain("storage recover-admission --empty");
  expect_m1(wait).not.toHaveBeenCalled();
  wait.mockRestore();
  const restore = locks_m1.acquireRuntimeRestoreAdmission({ processLockRoot: join_m1(root, ".tracker/data", "locks"), pid: process.pid });
  try {
    const result = recoverAbandonedAdmissionMutex_m1(root, restore, "empty");
    expect_m1(existsSync_m1(path)).toBe(false);
    expect_m1(readdirSync_m1(join_m1(root, ".tracker/control", "admission-mutex-recovery", result.acquisitionId))).toEqual([]);
    const receipt: unknown = JSON.parse(readFileSync_m1(result.receiptPath, "utf8"));
    expect_m1(receipt).toMatchObject({ custody: "empty", acquisitionId: result.acquisitionId });
    expect_m1(receipt).not.toHaveProperty("pid");
  } finally { restore.release(); }
  acquireEntrypointAdmission_m1(root, "shared").release();

} finally {
await _afterEachFixture0();
}
});
it_m1.each(["lease", "journal", "server", "workers"])("preserves empty lock custody when %s blocks recovery", async condition => {
try {


  const root = fixture();
  const control = join_m1(root, ".tracker/control");
  const path = join_m1(control, "admission-mutex");
  mkdirSync_m1(path, { mode: 0o700 });
  const current = locks_m1.observeProcessIdentity(process.pid);
  if (current.state !== "alive") throw new Error("current identity unavailable");
  if (condition === "lease") writeFileSync_m1(join_m1(control, "leases", `${randomUUID_m1()}.json`), JSON.stringify({
    schemaVersion: 1, admissionId: randomUUID_m1(), mode: "shared", pid: process.pid, processIdentity: current.identity,
  }), { mode: 0o600 });
  if (condition === "journal") writeFileSync_m1(join_m1(control, "journal.json"), "{}", { mode: 0o600 });
  const restore = locks_m1.acquireRuntimeRestoreAdmission({ processLockRoot: join_m1(root, ".tracker/data", "locks"), pid: process.pid });
  try {
    if (condition === "server" || condition === "workers") {
      const original = locks_m1.observeRuntimeLockSnapshot;
      vi.spyOn(locks_m1, "observeRuntimeLockSnapshot").mockImplementation(input => {
        const snapshot = original(input);
        return { ...snapshot, processLocks: { ...snapshot.processLocks, [condition]: { state: "active", generation: 1, pid: process.pid } } };
      });
    }
    expect_m1(() => recoverAbandonedAdmissionMutex_m1(root, restore, "empty")).toThrow(condition === "lease"
      ? /installation lease may still be live/u : condition === "journal"
        ? /unexpected installation control entry/u : /runtime process lock may still be live/u);
    expect_m1(readdirSync_m1(path)).toEqual([]);
    expect_m1(existsSync_m1(join_m1(control, "admission-mutex-recovery"))).toBe(false);
  } finally { restore.release(); }

} finally {
await _afterEachFixture0();
}
});

it_m1("retries acquisition when an observed empty canonical folder disappears during inspection", async () => {
try {


  const root = fixture();
  const path = join_m1(root, ".tracker/control", "admission-mutex");
  mkdirSync_m1(path, { mode: 0o700 });
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  let removed = false;
  vi.mocked(filesystem_m1.readdirSync).mockImplementation(((target: Parameters<typeof actual.readdirSync>[0]) => {
    const entries = actual.readdirSync(target);
    if (String(target) === path && !removed) { removed = true; rmdirSync_m1(path); }
    return entries;
  }) as typeof actual.readdirSync);
  acquireEntrypointAdmission_m1(root, "shared").release();
  expect_m1(removed).toBe(true);
  expect_m1(existsSync_m1(path)).toBe(false);

} finally {
await _afterEachFixture0();
}
});
it_m1("preserves a temporary folder when exact birth identity observation fails", async () => {
try {


  const root = fixture();
  const observed = locks_m1.observeProcessIdentity(process.pid);
  if (observed.state !== "alive") throw new Error("current identity unavailable");
  const digest = createHash_m1("sha256").update(canonicalJsonStringify_m1(observed.identity)).digest("hex");
  const path = join_m1(root, ".tracker/control", `.admission-mutex-tmp-${process.pid}-${digest}-${randomUUID_m1()}`);
  mkdirSync_m1(path, { mode: 0o700 });
  const failure = new Error("identity observation unavailable");
  vi.spyOn(locks_m1, "observeProcessIdentity").mockImplementation(() => { throw failure; });
  expect_m1(() => acquireEntrypointAdmission_m1(root, "shared")).toThrow(failure);
  expect_m1(readdirSync_m1(path)).toEqual([]);

} finally {
await _afterEachFixture0();
}
});
it_m1("cleans a pre-owner folder for a reused PID using exact birth identity", async () => {
try {


  const root = fixture();
  const digest = createHash_m1("sha256").update(canonicalJsonStringify_m1({ platform: process.platform, startToken: "previous-process" })).digest("hex");
  const path = join_m1(root, ".tracker/control", `.admission-mutex-tmp-${process.pid}-${digest}-${randomUUID_m1()}`);
  mkdirSync_m1(path, { mode: 0o700 });
  acquireEntrypointAdmission_m1(root, "shared").release();
  expect_m1(existsSync_m1(path)).toBe(false);

} finally {
await _afterEachFixture0();
}
});
it_m1("preserves a remnant whose complete owner disagrees with its process identity name", async () => {
try {


  const root = fixture();
  const current = locks_m1.observeProcessIdentity(process.pid);
  if (current.state !== "alive") throw new Error("current identity unavailable");
  const acquisitionId = randomUUID_m1();
  const path = join_m1(root, ".tracker/control", `.admission-mutex-tmp-${process.pid}-${"0".repeat(64)}-${acquisitionId}`);
  mkdirSync_m1(path, { mode: 0o700 });
  const ownerPath = join_m1(path, "owner.json");
  const bytes = JSON.stringify({ schemaVersion: 1, acquisitionId, phase: "admitting", pid: process.pid, processIdentity: current.identity });
  writeFileSync_m1(ownerPath, bytes, { mode: 0o600 });
  expect_m1(() => acquireEntrypointAdmission_m1(root, "shared")).toThrow(/mutex temporary owner identity mismatch/u);
  expect_m1(readFileSync_m1(ownerPath, "utf8")).toBe(bytes);

} finally {
await _afterEachFixture0();
}
});
}

{

const roots: string[] = [];
const children: ChildProcess_m2[] = [];
const _afterEachFixture0 = async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve())); child.kill("SIGKILL"); await exited;
  }
  for (const root of roots.splice(0)) rmSync_m2(root, { recursive: true, force: true });
};
it_m2("keeps the owned restoring journal after process death and absent staging until explicit exact stopped settlement", async () => {
try {


  const root = realpathSync_m2(mkdtempSync_m2(join_m2(tmpdir_m2(), "native-restore-crash-"))); roots.push(root);
  const url = (path: string) => pathToFileURL_m2(join_m2(process.cwd(), path)).href;
  const code = `
    import { readFileSync, renameSync, copyFileSync } from "node:fs";
    import { join } from "node:path";
    const { acquireEntrypointAdmission } = await import(${JSON.stringify(url("src/backend/storage/admission/bootstrap-admission.ts"))});
    const { AuthorityDatabase } = await import(${JSON.stringify(url("src/backend/storage/sqlite/authority-database.ts"))});
    const { AuthorityBackupService } = await import(${JSON.stringify(url("src/backend/storage/sqlite/backup-service.ts"))});
    const { OfflineAuthorityRestoreService } = await import(${JSON.stringify(url("src/backend/storage/sqlite/offline-restore.ts"))});
    const { observeRuntimeLockSnapshot } = await import(${JSON.stringify(url("src/backend/storage/sqlite/runtime-process-locks.ts"))});
    const { RecoveryStopProofStore } = await import(${JSON.stringify(url("src/backend/storage/sqlite/recovery-stop-proof.ts"))});
    const root = process.argv[1], admission = acquireEntrypointAdmission(root, "exclusive"), state = admission.stateRoot;
    const path = join(state, "state.db"), directory = join(state, "backups"), processLockRoot = join(state, "locks");
    const db = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "native-crash-test" });
    const report = await new AuthorityBackupService(admission, db, { directory }).request({ trigger: "operator", requiredGeneration: db.getMeta().authorityGeneration });
    db.close();
    const manifestPath = join(directory, report.manifests[0].backupFileName + ".manifest.json");
    const snapshot = observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(path) });
    const proofs = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60000 }); proofs.recordRuntimeState(snapshot);
    const stoppedSystemProof = proofs.issue({ observedBy: "local-operator", sourceDatabaseIdentity: snapshot.sourceDatabaseIdentity });
    const service = new OfflineAuthorityRestoreService(admission, { authorityPath: path, suspectDirectory: join(state, "backups", "suspects"),
      processLockRoot, busyTimeoutMs: 250, stoppedProofMaxAgeMs: 60000 }, async () => {}, undefined,
      { copyFile: copyFileSync, atomicReplace(source, destination) {
        renameSync(source, destination); copyFileSync(destination, source);
        const journal = JSON.parse(readFileSync(join(root, ".tracker", "control", "journal.json"), "utf8"));
        process.send({ state: "barrier-held", operationId: journal.restore.operationId, stagedPath: source, manifestPath });
        const wait = new Int32Array(new SharedArrayBuffer(4)); for (;;) Atomics.wait(wait, 0, 0, 1000);
      } });
    await service.restore({ manifestPath, stoppedSystemProof });
  `;
  const child = spawn_m2(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, root],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"] }); children.push(child);
  const message = await new Promise<{ state: string; operationId: string; stagedPath: string; manifestPath: string }>((resolve, reject) => {
    let output = ""; child.stderr?.on("data", value => { output += String(value); });
    child.once("message", value => resolve(value as { state: string; operationId: string; stagedPath: string; manifestPath: string }));
    child.once("exit", code => reject(new Error(`restore child exited ${String(code)}: ${output}`)));
  });
  assert_m2.equal(message.state, "barrier-held");
  const journalPath = join_m2(root, ".tracker", "control", "journal.json"), before = readFileSync_m2(journalPath);
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve())); child.kill("SIGKILL"); await exited;
  assert_m2.throws(() => acquireEntrypointAdmission_m2(root, "shared"), /unfinished restoring/u);
  assert_m2.deepEqual(readFileSync_m2(journalPath), before);
  rmSync_m2(message.stagedPath);
  assert_m2.throws(() => acquireEntrypointAdmission_m2(root, "shared"), /unfinished restoring/u);
  const settled = await runOfflineAuthorityRestoreRecovery_m2(root, ["--operation", message.operationId,
    "--from", message.manifestPath, "--outcome", "replaced", "--json"]);
  assert_m2.deepEqual(settled.report, { state: "settled", operationId: message.operationId, outcome: "replaced" });
  assert_m2.equal(existsSync_m2(journalPath), false);
  const admission = acquireEntrypointAdmission_m2(root, "shared");
  try { const db = AuthorityDatabase_m2.open(admission, { path: join_m2(admission.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "native-crash-reopen" });
    try { assert_m2.equal(db.getMeta().schemaVersion, 1); } finally { db.close(); }
  } finally { admission.release(); }

} finally {
await _afterEachFixture0();
}
}, 30_000);
}

{


it_m3("fresh private authority is healthy without creating a backup",async()=>{
  const f=runtimeFixture_m3(["dashboard.serve"]);
  try {const report=await doctorAuthorityStorage_m3(f.doctorOptions,f.clock);assert_m3.equal(report.authority.state,"healthy");assert_m3.equal(report.backup.state,"missing");assert_m3.equal((await f.report()).results.find(check=>check.check==="authority.health")?.status,"pass");}
  finally {f.close();}
});
it_m3.each(["wrong","newer","unsupported"] as const)("%s authority refuses read-only inspection without automatic migration",async kind=>{
  const f=runtimeFixture_m3(["dashboard.serve"]);
  try {
    const database=new DatabaseSync_m3(f.databasePath);
    try {if(kind==="wrong")database.exec("DROP TABLE runs");else {const version=kind==="newer"?999:2;database.exec(`UPDATE database_states SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`);}}
    finally {database.close();}
    const before=readFileSync_m3(f.databasePath);const report=await doctorAuthorityStorage_m3(f.doctorOptions,f.clock);
    assert_m3.equal(report.authority.state,"degraded");if(report.authority.state!=="degraded")throw new Error("unhealthy authority passed");
    assert_m3.equal(report.authority.cause.code,"authority-schema-mismatch");
    assert_m3.equal((await f.report()).results.find(check=>check.check==="authority.health")?.status,"fail");assert_m3.deepEqual(readFileSync_m3(f.databasePath),before);
  }finally {f.close();}
});

it_m3("supported single-authority restore re-checks healthy without inventing repair or substitute authority",async()=>{
  const workspace=mkdtempSync_m3(join_m3(realpathSync_m3(tmpdir_m3()),"native-preflight-restore-"));
  const admission=acquireEntrypointAdmission_m3(workspace,"exclusive"), stateRoot=admission.stateRoot;
  const clock=manualClock_m3(new Date("2026-09-19T12:00:00.000Z")), authorityPath=join_m3(stateRoot,"state.db");
  try {
    copyFileSync_m3(join_m3(process.cwd(),"package.json"),join_m3(workspace,"package.json"));
    AuthorityDatabase_m3.open(admission,{path:authorityPath,busyTimeoutMs:100,migrationOwner:"preflight-restore"},clock).close();
    const backup=await backupStoppedAuthority_m3(admission,stateRoot,clock,join_m3(workspace,rebuildRuntimeIsolation_m3.processLockRoot));
    const manifest=backup.manifests.at(-1);assert_m3.ok(manifest);
    const path=join_m3(stateRoot,"backups","authority",`${manifest.backupFileName}.manifest.json`);
    const restored=await composeStorageCommand_m3(rebuildRuntimeIsolation_m3,["restore","--from",path,"--json"],clock,workspace,admission);
    assert_m3.equal(restored.exitCode,0,restored.output);
    const runner=new AuthorityHealthPreflightRunner_m3(admission,{stateRootTrustAnchor:workspace,stateRoot,authorityPath,
      backupDirectory:join_m3(stateRoot,"backups","authority"),busyTimeoutMs:100},clock);
    const observed=await runner.run({signal:new AbortController().signal,timeoutMs:1000,deadlineMonotonicMs:clock.monotonicMs()+1000,redaction:"safe-summary"});
    assert_m3.equal(observed.state,"healthy",JSON.stringify(observed));
  }finally{admission.release();rmSync_m3(workspace,{recursive:true,force:true});}
});
}

{

const roots: string[] = [];
const children: ChildProcess_m4[] = [];
const _afterEachFixture0 = async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await exited;
    }
  }
  for (const root of roots.splice(0)) rmSync_m4(root, { recursive: true, force: true });
};
function launch(code: string, root: string): { child: ChildProcess_m4; next: () => Promise<{ state: string; detail?: string }> } {
  const child = spawn_m4(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, root],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"] });
  children.push(child);
  const queued: { state: string; detail?: string }[] = [];
  const readers: ((value: { state: string; detail?: string }) => void)[] = [];
  let output = "";
  child.stderr?.on("data", chunk => { output += String(chunk); });
  child.on("message", value => {
    const parsed = value as { state: string; detail?: string };
    const reader = readers.shift();
    if (reader === undefined) queued.push(parsed); else reader(parsed);
  });
  child.on("exit", code => {
    while (readers.length > 0) readers.shift()?.({ state: "exited", detail: `${String(code)} ${output}` });
  });
  return { child, next: () => {
    const value = queued.shift();
    return value === undefined ? new Promise(resolve => readers.push(resolve)) : Promise.resolve(value);
  } };
}
it_m4("admits and releases simultaneous installed children after a live mutex holder leaves its critical section", async () => {
try {


  const root = realpathSync_m4(mkdtempSync_m4(join_m4(tmpdir_m4(), "runtime-admission-concurrent-")));
  roots.push(root);
  acquireEntrypointAdmission_m4(root, "exclusive").release();
  const bootUrl = pathToFileURL_m4(join_m4(process.cwd(), "src/backend/storage/admission/bootstrap-admission.ts")).href;
  const locksUrl = pathToFileURL_m4(join_m4(process.cwd(), "src/backend/storage/sqlite/runtime-process-locks.ts")).href;
  const holder = launch(`
    import { mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
    import { join } from "node:path";
    import { randomUUID } from "node:crypto";
    const { observeProcessIdentity } = await import(${JSON.stringify(locksUrl)});
    const root = process.argv[1];
    const mutex = join(root, ".tracker/control", "admission-mutex");
    mkdirSync(mutex, { mode: 0o700 });
    const observed = observeProcessIdentity(process.pid);
    if (observed.state !== "alive") throw new Error("holder identity unavailable");
    writeFileSync(join(mutex, "owner.json"), JSON.stringify({ schemaVersion: 1, acquisitionId: randomUUID(),
      phase: "admitting", pid: process.pid, processIdentity: observed.identity }), { mode: 0o600 });
    process.on("message", () => { unlinkSync(join(mutex, "owner.json")); rmdirSync(mutex);
      process.send({ state: "released" }); process.disconnect(); });
    process.send({ state: "held" });
  `, root);
  assert_m4.equal((await holder.next()).state, "held");
  const code = `
    const { acquireEntrypointAdmission } = await import(${JSON.stringify(bootUrl)});
    process.send({ state: "attempting" });
    try { const admission = acquireEntrypointAdmission(process.argv[1], "shared");
      admission.assertLive(); admission.release(); process.send({ state: "admitted-and-released" }); }
    catch (error) { process.send({ state: "refused", detail: error.message }); }
    process.disconnect();
  `;
  const first = launch(code, root);
  const second = launch(code, root);
  assert_m4.equal((await first.next()).state, "attempting");
  assert_m4.equal((await second.next()).state, "attempting");
  holder.child.send("release");
  assert_m4.equal((await holder.next()).state, "released");
  assert_m4.deepEqual(await Promise.all([first.next(), second.next()]),
    [{ state: "admitted-and-released" }, { state: "admitted-and-released" }]);
  const exclusive = acquireEntrypointAdmission_m4(root, "exclusive");
  exclusive.release();

} finally {
await _afterEachFixture0();
}
});

function initializedRoot(): string {
  const root = realpathSync_m4(mkdtempSync_m4(join_m4(tmpdir_m4(), "runtime-admission-refusal-")));
  roots.push(root);
  acquireEntrypointAdmission_m4(root, "exclusive").release();
  return root;
}
it_m4.each(["live", "empty", "malformed", "unknown"] as const)("preserves %s owner custody without attempting abandoned-owner recovery", async condition => {
try {


  const root = initializedRoot();
  const mutex = join_m4(root, ".tracker/control", "admission-mutex");
  mkdirSync_m4(mutex, { mode: 0o700 });
  if (condition !== "empty") {
    const observation = processLocks_m4.observeProcessIdentity(process.pid);
    assert_m4.ok(observation.state === "alive");
    writeFileSync_m4(join_m4(mutex, "owner.json"), condition === "malformed" ? "not-json" : JSON.stringify({
      schemaVersion: 1, acquisitionId: randomUUID_m4(), phase: "admitting", pid: process.pid,
      processIdentity: observation.identity,
    }), { mode: 0o600 });
  }
  const before = readdirSync_m4(mutex).map(name => ({ name, bytes: readFileSync_m4(join_m4(mutex, name)) }));
  const unknown = new Error("process birth identity unavailable");
  if (condition === "unknown") vi.spyOn(processLocks_m4, "observeProcessIdentity").mockImplementation(() => { throw unknown; });
  if (condition === "unknown") assert_m4.throws(() => acquireEntrypointAdmission_m4(root, "shared"), error => error === unknown);
  else if (condition === "malformed") assert_m4.throws(() => acquireEntrypointAdmission_m4(root, "shared"), SyntaxError);
  else assert_m4.throws(() => acquireEntrypointAdmission_m4(root, "shared"), AdmissionMutexBusyError_m4);
  assert_m4.deepEqual(readdirSync_m4(mutex).map(name => ({ name, bytes: readFileSync_m4(join_m4(mutex, name)) })), before);
  assert_m4.equal(existsSync_m4(join_m4(root, ".tracker/control", "admission-mutex-recovery")), false);

} finally {
await _afterEachFixture0();
}
});
it_m4("propagates non-EEXIST mutex mkdir failures without translating them to busy", async () => {
try {


  const root = initializedRoot();
  const mutex = join_m4(root, ".tracker/control", "admission-mutex");
  const failure = Object.assign(new Error("injected mkdir access failure"), { code: "EACCES" });
  vi.mocked(filesystem_m4.mkdirSync).mockImplementationOnce(() => { throw failure; });
  assert_m4.throws(() => acquireEntrypointAdmission_m4(root, "shared"), error => error === failure);
  assert_m4.match(String(vi.mocked(filesystem_m4.mkdirSync).mock.calls.at(-1)?.[0]), /\/\.admission-mutex-tmp-[1-9]\d*-[0-9a-f]{64}-[0-9a-f-]{36}$/u);
  assert_m4.equal(existsSync_m4(mutex), false);

} finally {
await _afterEachFixture0();
}
});
it_m4("refuses symlink mutex custody and preserves an immediate exclusive lease conflict", async () => {
try {


  const root = initializedRoot();
  const admission = acquireEntrypointAdmission_m4(root, "exclusive");
  assert_m4.throws(() => acquireEntrypointAdmission_m4(root, "shared"), /installation lease busy/u);
  admission.release();
  const target = initializedRoot();
  symlinkSync_m4(join_m4(target, ".tracker/control"), join_m4(root, ".tracker/control", "admission-mutex"));
  assert_m4.throws(() => acquireEntrypointAdmission_m4(root, "shared"), /unsafe directory/u);
  assert_m4.equal(existsSync_m4(join_m4(target, ".tracker/control", "installation.json")), true);

} finally {
await _afterEachFixture0();
}
});

it_m4("propagates installation lstat access failure instead of treating the path as absent", async () => {
try {


  const root = initializedRoot();
  const failure = Object.assign(new Error("injected lstat access failure"), { code: "EACCES" });
  vi.mocked(filesystem_m4.lstatSync).mockImplementationOnce(() => { throw failure; });
  assert_m4.throws(() => acquireEntrypointAdmission_m4(root, "shared"), error => error === failure);

} finally {
await _afterEachFixture0();
}
});
}
