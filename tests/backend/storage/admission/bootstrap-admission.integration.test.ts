import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { withSynchronousMutexDeadline } from "../../../support/helpers/storage/synchronous-mutex-deadline.js";
import { createAdmissionChildFixtures } from "../../../support/helpers/storage/admission-child-fixtures.js";
import { default as assert } from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as filesystem_m1 from "node:fs";
import * as filesystem_m4 from "node:fs";
import { copyFileSync, existsSync, mkdirSync as mkdirSync_m1, mkdtempSync, readFileSync, readdirSync as readdirSync_m1, realpathSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { expect, it, vi } from "vitest";
import { composeDashboardRuntime } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { composeStorageCommand, composeProfileRuntime, runOfflineAuthorityRestoreRecovery } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { AdmissionMutexBusyError, recoverAbandonedAdmissionMutex } from "../../../../src/backend/storage/admission/installation.js";
import { backupStoppedAuthority } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import * as locks_m1 from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import * as processLocks_m4 from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { runtimeFixture } from "../../../support/fixtures/preflight/runtime-fixture.js";
import { doctorAuthorityStorage } from "../../../support/helpers/synthetic-storage-admission.js";
vi.mock("node:fs", async importOriginal => {
 const actual = await importOriginal<typeof import("node:fs")>();
 return { ...actual, readdirSync: vi.fn(actual.readdirSync), mkdirSync: vi.fn(actual.mkdirSync), lstatSync: vi.fn(actual.lstatSync) };
});

{

it("serves only the genuine token-owned profile and refuses its later missing canonical database", async () => {
  const profile = createBoundProfileFixture();
  const workspace = profile.workspace, authorityPath = profile.path;
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(workspace, name));
  const runtime = composeProfileRuntime({ admission: profile.machine, clock, hostFacts: { primaryDisplay: null },
    processLockRoot: join(workspace, rebuildRuntimeIsolation.processLockRoot) });
  let dashboard: Awaited<ReturnType<typeof composeDashboardRuntime>> | undefined;
  let restarted: ReturnType<typeof acquireEntrypointAdmission> | undefined;
  let dashboardStopped = false;
  try {
    const active = runtime.session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
    assert.equal(active.state, "active");
    if (active.state !== "active") throw new Error("actual profile sign-in required");
    assert.equal(existsSync(join(profile.machine.stateRoot, "state.db")), false);
    assert.equal(existsSync(authorityPath), true);
    dashboard = await composeDashboardRuntime({ admission: profile.machine, profile: { runtime, token: active.token },
      isolation: rebuildRuntimeIsolation, repoRoot: workspace, env: {}, clock, backendPortOverride: 0, frontendPortOverride: 0,
      preflightRunnerFactory: healthyRuntimePreflightRunners });
    const response = await fetch(`http://127.0.0.1:${String(dashboard.port)}/api/v1/settings/storage-relocation`);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { state: "error", code: "PROFILE_STORAGE_RELOCATION_UNSUPPORTED",
      message: ERROR_CATALOG.PROFILE_STORAGE_RELOCATION_UNSUPPORTED.text, retryable: false });
    await dashboard.stop(); dashboard = undefined; dashboardStopped = true;
    const credentialPath = join(profile.stateRoot, "credentials", "protected.json"), credentialBytes = readFileSync(credentialPath);
    rmSync(authorityPath);
    const fresh = acquireEntrypointAdmission(workspace, "exclusive"); restarted = fresh;
    assert.throws(() => {
      const claim = createProfileRegistry(fresh).storageClaim(active.profileId);
      fresh.admitProfile(claim);
    }, /profile-database-binding-required/u);
    assert.equal(existsSync(authorityPath), false);
    assert.equal(existsSync(`${authorityPath}-wal`), false);
    assert.equal(existsSync(`${authorityPath}-shm`), false);
    assert.equal(readFileSync(credentialPath).equals(credentialBytes), true);
  } finally {
    if (dashboard !== undefined) await dashboard.stop();
    if (!dashboardStopped) await runtime.close();
    restarted?.release(); profile.close();
  }
}, 20_000);
}

{
const roots: string[] = [];
const children: ChildProcess[] = [];
async function kill(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill("SIGKILL"); });
}
const _afterEachFixture0 = async () => {
  vi.restoreAllMocks();
  await Promise.all(children.splice(0).map(kill));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};
function fixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "admission-crash-")));
  roots.push(root);
  acquireEntrypointAdmission(root, "exclusive").release();
  return root;
}
async function pausedChild(root: string, window: string): Promise<ChildProcess> {
  const url = pathToFileURL(join(process.cwd(), "src/backend/storage/admission/bootstrap-admission.ts")).href;
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
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, root], { stdio: ["ignore", "pipe", "pipe"] });
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
it.each(["prepared", "released"])("cleans an actual killed child's %s folder without a canonical empty lock", async window => {
try {

  const root = fixture();
  const child = await pausedChild(root, window);
  await kill(child);
  const control = join(root, ".tracker/control");
  expect(existsSync(join(control, "admission-mutex"))).toBe(false);
  expect(readdirSync_m1(control).some(name => name.startsWith(".admission-mutex-"))).toBe(true);
  acquireEntrypointAdmission(root, "shared").release();
  expect(readdirSync_m1(control).filter(name => name.startsWith(".admission-mutex-"))).toEqual([]);

} finally {
await _afterEachFixture0();
}
});
it("preserves a live temporary folder before owner publication and cleans it only after death", async () => {
try {

  const root = fixture();
  const child = await pausedChild(root, "pre-owner");
  const control = join(root, ".tracker/control");
  const name = readdirSync_m1(control).find(entry => entry.startsWith(".admission-mutex-tmp-"));
  expect(name).toBeDefined();
  acquireEntrypointAdmission(root, "shared").release();
  expect(readdirSync_m1(join(control, name!))).toEqual([]);
  await kill(child);
  acquireEntrypointAdmission(root, "shared").release();
  expect(existsSync(join(control, name!))).toBe(false);

} finally {
await _afterEachFixture0();
}
});
it("refuses an empty canonical lock immediately and archives its empty custody with a receipt", async () => {
try {

  const root = fixture();
  const path = join(root, ".tracker/control", "admission-mutex");
  mkdirSync_m1(path, { mode: 0o700 });
  const wait = vi.spyOn(Atomics, "wait");
  let failure: unknown;
  try { acquireEntrypointAdmission(root, "shared"); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(AdmissionMutexBusyError);
  expect(failure).toMatchObject({ name: "AdmissionMutexEmptyError" });
  expect(String(failure)).toContain("storage recover-admission --empty");
  expect(wait).not.toHaveBeenCalled();
  wait.mockRestore();
  const restore = locks_m1.acquireRuntimeRestoreAdmission({ processLockRoot: join(root, ".tracker/data", "locks"), pid: process.pid });
  try {
    const result = recoverAbandonedAdmissionMutex(root, restore, "empty");
    expect(existsSync(path)).toBe(false);
    expect(readdirSync_m1(join(root, ".tracker/control", "admission-mutex-recovery", result.acquisitionId))).toEqual([]);
    const receipt: unknown = JSON.parse(readFileSync(result.receiptPath, "utf8"));
    expect(receipt).toMatchObject({ custody: "empty", acquisitionId: result.acquisitionId });
    expect(receipt).not.toHaveProperty("pid");
  } finally { restore.release(); }
  acquireEntrypointAdmission(root, "shared").release();

} finally {
await _afterEachFixture0();
}
});
it.each(["lease", "journal", "server", "workers"])("preserves empty lock custody when %s blocks recovery", async condition => {
try {

  const root = fixture();
  const control = join(root, ".tracker/control");
  const path = join(control, "admission-mutex");
  mkdirSync_m1(path, { mode: 0o700 });
  const current = locks_m1.observeProcessIdentity(process.pid);
  if (current.state !== "alive") throw new Error("current identity unavailable");
  if (condition === "lease") writeFileSync(join(control, "leases", `${randomUUID()}.json`), JSON.stringify({
    schemaVersion: 1, admissionId: randomUUID(), mode: "shared", pid: process.pid, processIdentity: current.identity,
  }), { mode: 0o600 });
  if (condition === "journal") writeFileSync(join(control, "journal.json"), "{}", { mode: 0o600 });
  const restore = locks_m1.acquireRuntimeRestoreAdmission({ processLockRoot: join(root, ".tracker/data", "locks"), pid: process.pid });
  try {
    if (condition === "server" || condition === "workers") {
      const original = locks_m1.observeRuntimeLockSnapshot;
      vi.spyOn(locks_m1, "observeRuntimeLockSnapshot").mockImplementation(input => {
        const snapshot = original(input);
        return { ...snapshot, processLocks: { ...snapshot.processLocks, [condition]: { state: "active", generation: 1, pid: process.pid } } };
      });
    }
    expect(() => recoverAbandonedAdmissionMutex(root, restore, "empty")).toThrow(condition === "lease"
      ? /installation lease may still be live/u : condition === "journal"
        ? /unexpected installation control entry/u : /runtime process lock may still be live/u);
    expect(readdirSync_m1(path)).toEqual([]);
    expect(existsSync(join(control, "admission-mutex-recovery"))).toBe(false);
  } finally { restore.release(); }

} finally {
await _afterEachFixture0();
}
});

it("retries acquisition when an observed empty canonical folder disappears during inspection", async () => {
try {

  const root = fixture();
  const path = join(root, ".tracker/control", "admission-mutex");
  mkdirSync_m1(path, { mode: 0o700 });
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  let removed = false;
  vi.mocked(filesystem_m1.readdirSync).mockImplementation(((target: Parameters<typeof actual.readdirSync>[0]) => {
    const entries = actual.readdirSync(target);
    if (String(target) === path && !removed) { removed = true; rmdirSync(path); }
    return entries;
  }) as typeof actual.readdirSync);
  acquireEntrypointAdmission(root, "shared").release();
  expect(removed).toBe(true);
  expect(existsSync(path)).toBe(false);

} finally {
await _afterEachFixture0();
}
});
it("preserves a temporary folder when exact birth identity observation fails", async () => {
try {

  const root = fixture();
  const observed = locks_m1.observeProcessIdentity(process.pid);
  if (observed.state !== "alive") throw new Error("current identity unavailable");
  const digest = createHash("sha256").update(canonicalJsonStringify(observed.identity)).digest("hex");
  const path = join(root, ".tracker/control", `.admission-mutex-tmp-${process.pid}-${digest}-${randomUUID()}`);
  mkdirSync_m1(path, { mode: 0o700 });
  const failure = new Error("identity observation unavailable");
  vi.spyOn(locks_m1, "observeProcessIdentity").mockImplementation(() => { throw failure; });
  expect(() => acquireEntrypointAdmission(root, "shared")).toThrow(failure);
  expect(readdirSync_m1(path)).toEqual([]);

} finally {
await _afterEachFixture0();
}
});
it("cleans a pre-owner folder for a reused PID using exact birth identity", async () => {
try {

  const root = fixture();
  const digest = createHash("sha256").update(canonicalJsonStringify({ platform: process.platform, startToken: "previous-process" })).digest("hex");
  const path = join(root, ".tracker/control", `.admission-mutex-tmp-${process.pid}-${digest}-${randomUUID()}`);
  mkdirSync_m1(path, { mode: 0o700 });
  acquireEntrypointAdmission(root, "shared").release();
  expect(existsSync(path)).toBe(false);

} finally {
await _afterEachFixture0();
}
});
it("preserves a remnant whose complete owner disagrees with its process identity name", async () => {
try {

  const root = fixture();
  const current = locks_m1.observeProcessIdentity(process.pid);
  if (current.state !== "alive") throw new Error("current identity unavailable");
  const acquisitionId = randomUUID();
  const path = join(root, ".tracker/control", `.admission-mutex-tmp-${process.pid}-${"0".repeat(64)}-${acquisitionId}`);
  mkdirSync_m1(path, { mode: 0o700 });
  const ownerPath = join(path, "owner.json");
  const bytes = JSON.stringify({ schemaVersion: 1, acquisitionId, phase: "admitting", pid: process.pid, processIdentity: current.identity });
  writeFileSync(ownerPath, bytes, { mode: 0o600 });
  expect(() => acquireEntrypointAdmission(root, "shared")).toThrow(/mutex temporary owner identity mismatch/u);
  expect(readFileSync(ownerPath, "utf8")).toBe(bytes);

} finally {
await _afterEachFixture0();
}
});
}

{

const roots: string[] = [];
const children: ChildProcess[] = [];
const _afterEachFixture0 = async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve())); child.kill("SIGKILL"); await exited;
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};
it("keeps the owned restoring journal after process death and absent staging until explicit exact stopped settlement", async () => {
try {

  const profile = createBoundProfileFixture();
  const root = profile.workspace, profileId = profile.admission.profileBinding.profileId; roots.push(root);
  profile.admission.release(); profile.machine.release();
  const url = (path: string) => pathToFileURL(join(process.cwd(), path)).href;
  const code = `
    import { readFileSync, renameSync, copyFileSync } from "node:fs";
    import { join } from "node:path";
    const { acquireEntrypointAdmission } = await import(${JSON.stringify(url("src/backend/storage/admission/bootstrap-admission.ts"))});
    const { AuthorityDatabase } = await import(${JSON.stringify(url("src/backend/storage/sqlite/authority-database.ts"))});
    const { AuthorityBackupService } = await import(${JSON.stringify(url("src/backend/storage/sqlite/backup-service.ts"))});
    const { OfflineAuthorityRestoreService } = await import(${JSON.stringify(url("src/backend/storage/sqlite/offline-restore.ts"))});
    const { observeRuntimeLockSnapshot } = await import(${JSON.stringify(url("src/backend/storage/sqlite/runtime-process-locks.ts"))});
    const { RecoveryStopProofStore } = await import(${JSON.stringify(url("src/backend/storage/sqlite/recovery-stop-proof.ts"))});
    const { createProfileRegistry } = await import(${JSON.stringify(url("src/backend/profiles/registry.ts"))});
    const { createCredentialStore } = await import(${JSON.stringify(url("src/backend/storage/configuration/credential-store.ts"))});
    const root = process.argv[1], machine = acquireEntrypointAdmission(root, "exclusive");
    const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(${JSON.stringify(profileId)})), state = admission.stateRoot;
    const credentials = createCredentialStore({ admission, stateRoot: state, erasureJournalAdmission: machine,
      erasureJournalPath: join(machine.stateRoot, "machine", "erasures", admission.profileBinding.profileId + ".json") });
    const path = join(state, "state.db"), directory = join(state, "backups"), processLockRoot = join(root, ${JSON.stringify(rebuildRuntimeIsolation.processLockRoot)});
    const db = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "native-crash-test" }, undefined, undefined, undefined, undefined, credentials);
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
        process.send({ state: "barrier-held", workspace: root, profileId: admission.profileBinding.profileId, operationId: journal.restore.operationId, stagedPath: source, manifestPath });
        const wait = new Int32Array(new SharedArrayBuffer(4)); for (;;) Atomics.wait(wait, 0, 0, 1000);
      } }, undefined, credentials);
    await service.restore({ manifestPath, stoppedSystemProof });
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, root],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"] }); children.push(child);
  const message = await new Promise<{ state: string; workspace: string; profileId: string; operationId: string; stagedPath: string; manifestPath: string }>((resolve, reject) => {
    let output = ""; child.stderr?.on("data", value => { output += String(value); });
    child.once("message", value => resolve(value as { state: string; workspace: string; profileId: string; operationId: string; stagedPath: string; manifestPath: string }));
    child.once("exit", code => reject(new Error(`restore child exited ${String(code)}: ${output}`)));
  });
  assert.equal(message.state, "barrier-held");
  const workspace = message.workspace; roots.push(workspace);
  const journalPath = join(workspace, ".tracker", "control", "journal.json"), before = readFileSync(journalPath);
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve())); child.kill("SIGKILL"); await exited;
  assert.throws(() => acquireEntrypointAdmission(workspace, "shared"), /unfinished restoring/u);
  assert.deepEqual(readFileSync(journalPath), before);
  rmSync(message.stagedPath);
  assert.throws(() => acquireEntrypointAdmission(workspace, "shared"), /unfinished restoring/u);
  const settled = await runOfflineAuthorityRestoreRecovery(workspace, ["--operation", message.operationId,
    "--from", message.manifestPath, "--outcome", "replaced", "--json"]);
  assert.deepEqual(settled.report, { state: "settled", operationId: message.operationId, outcome: "replaced" });
  assert.equal(existsSync(journalPath), false);
  const admission = acquireEntrypointAdmission(workspace, "shared");
  const childAdmission = admission.admitProfile(createProfileRegistry(admission).storageClaim(message.profileId));
  try { const db = AuthorityDatabase.open(childAdmission, { path: join(childAdmission.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "native-crash-reopen" });
    try { assert.equal(db.getMeta().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION); } finally { db.close(); }
  } finally { childAdmission.release(); admission.release(); }

} finally {
await _afterEachFixture0();
}
}, 30_000);
}

{

it("fresh private authority is healthy without creating a backup",async()=>{
  const f=runtimeFixture(["dashboard.serve"]);
  try {const report=await doctorAuthorityStorage(f.doctorOptions,f.clock);assert.equal(report.authority.state,"healthy");assert.equal(report.backup.state,"missing");assert.equal((await f.report()).results.find(check=>check.check==="authority.health")?.status,"pass");}
  finally {f.close();}
});
it.each(["wrong","newer","unsupported"] as const)("%s authority refuses read-only inspection without automatic migration",async kind=>{
  const f=runtimeFixture(["dashboard.serve"]);
  try {
    const database=new DatabaseSync(f.databasePath);
    try {if(kind==="wrong")database.exec("DROP TABLE runs");else {const version=kind==="newer"?999:1;database.exec(`UPDATE database_states SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`);}}
    finally {database.close();}
    const before=readFileSync(f.databasePath);const report=await doctorAuthorityStorage(f.doctorOptions,f.clock);
    assert.equal(report.authority.state,"degraded");if(report.authority.state!=="degraded")throw new Error("unhealthy authority passed");
    assert.equal(report.authority.cause.code,"authority-schema-mismatch");
    assert.equal((await f.report()).results.find(check=>check.check==="authority.health")?.status,"fail");assert.deepEqual(readFileSync(f.databasePath),before);
  }finally {f.close();}
});

it("supported single-authority restore re-checks healthy without inventing repair or substitute authority",async()=>{
  const profile=createBoundProfileFixture(), workspace=profile.workspace;
  const admission=profile.admission, stateRoot=profile.stateRoot;
  const clock=manualClock(new Date("2026-09-19T12:00:00.000Z")), authorityPath=join(stateRoot,"state.db");
  try {
    copyFileSync(join(process.cwd(),"package.json"),join(workspace,"package.json"));
    AuthorityDatabase.open(admission,{path:authorityPath,busyTimeoutMs:100,migrationOwner:"preflight-restore"},clock,undefined,undefined,undefined,boundProfileCredentials(admission)).close();
    const backup=await backupStoppedAuthority(admission,stateRoot,clock,join(workspace,rebuildRuntimeIsolation.processLockRoot));
    const manifest=backup.manifests.at(-1);assert.ok(manifest);
    const path=join(stateRoot,"backups","authority",`${manifest.backupFileName}.manifest.json`);
    const restored=await composeStorageCommand(rebuildRuntimeIsolation,["restore","--from",path,"--json"],clock,workspace,admission);
    assert.equal(restored.exitCode,0,restored.output);
    const runner=new AuthorityHealthPreflightRunner(admission,{stateRootTrustAnchor:workspace,stateRoot,authorityPath,
      backupDirectory:join(stateRoot,"backups","authority"),busyTimeoutMs:100},clock);
    const observed=await runner.run({signal:new AbortController().signal,timeoutMs:1000,deadlineMonotonicMs:clock.monotonicMs()+1000,redaction:"safe-summary"});
    assert.equal(observed.state,"healthy",JSON.stringify(observed));
  }finally{profile.close();}
});
}

{

const roots: string[] = [];
const children: ChildProcess[] = [];
const _afterEachFixture0 = async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await exited;
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};
const { launch } = createAdmissionChildFixtures(children);
it("admits and releases simultaneous installed children after a live mutex holder leaves its critical section", async () => {
try {

  const root = realpathSync(mkdtempSync(join(tmpdir(), "runtime-admission-concurrent-")));
  roots.push(root);
  acquireEntrypointAdmission(root, "exclusive").release();
  const bootUrl = pathToFileURL(join(process.cwd(), "src/backend/storage/admission/bootstrap-admission.ts")).href;
  const locksUrl = pathToFileURL(join(process.cwd(), "src/backend/storage/sqlite/runtime-process-locks.ts")).href;
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
  assert.equal((await holder.next()).state, "held");
  const code = `
    const { acquireEntrypointAdmission } = await import(${JSON.stringify(bootUrl)});
    process.send({ state: "attempting" });
    try { const admission = acquireEntrypointAdmission(process.argv[1], "shared");
      admission.assertLive(); admission.release(); process.send({ state: "admitted-and-released" }); }
    catch (error) { process.send({ state: "refused", detail: error.message }); }
    process.disconnect();
  `;
  const first = launch(code, root);
  assert.equal((await first.next()).state, "attempting");
  const second = launch(code, root);
  assert.equal((await second.next()).state, "attempting");
  holder.child.send("release");
  assert.equal((await holder.next()).state, "released");
  assert.deepEqual(await Promise.all([first.next(), second.next()]),
    [{ state: "admitted-and-released" }, { state: "admitted-and-released" }]);
  const exclusive = acquireEntrypointAdmission(root, "exclusive");
  exclusive.release();

} finally {
await _afterEachFixture0();
}
});

function initializedRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "runtime-admission-refusal-")));
  roots.push(root);
  acquireEntrypointAdmission(root, "exclusive").release();
  return root;
}
it.each(["live", "empty", "malformed", "unknown"] as const)("preserves %s owner custody without attempting abandoned-owner recovery", async condition => {
try {

  const root = initializedRoot();
  const mutex = join(root, ".tracker/control", "admission-mutex");
  mkdirSync_m1(mutex, { mode: 0o700 });
  if (condition !== "empty") {
    const observation = processLocks_m4.observeProcessIdentity(process.pid);
    assert.ok(observation.state === "alive");
    writeFileSync(join(mutex, "owner.json"), condition === "malformed" ? "not-json" : JSON.stringify({
      schemaVersion: 1, acquisitionId: randomUUID(), phase: "admitting", pid: process.pid,
      processIdentity: observation.identity,
    }), { mode: 0o600 });
  }
  const before = readdirSync_m1(mutex).map(name => ({ name, bytes: readFileSync(join(mutex, name)) }));
  const unknown = new Error("process birth identity unavailable");
  if (condition === "unknown") vi.spyOn(processLocks_m4, "observeProcessIdentity").mockImplementation(() => { throw unknown; });
  if (condition === "unknown") assert.throws(() => acquireEntrypointAdmission(root, "shared"), error => error === unknown);
  else if (condition === "malformed") withSynchronousMutexDeadline(() => {
    assert.throws(() => acquireEntrypointAdmission(root, "shared"), SyntaxError);
  });
  else if (condition === "live") withSynchronousMutexDeadline(() => {
    assert.throws(() => acquireEntrypointAdmission(root, "shared"), AdmissionMutexBusyError);
  });
  else assert.throws(() => acquireEntrypointAdmission(root, "shared"), AdmissionMutexBusyError);
  assert.deepEqual(readdirSync_m1(mutex).map(name => ({ name, bytes: readFileSync(join(mutex, name)) })), before);
  assert.equal(existsSync(join(root, ".tracker/control", "admission-mutex-recovery")), false);

} finally {
await _afterEachFixture0();
}
});
it("propagates non-EEXIST mutex mkdir failures without translating them to busy", async () => {
try {

  const root = initializedRoot();
  const mutex = join(root, ".tracker/control", "admission-mutex");
  const failure = Object.assign(new Error("injected mkdir access failure"), { code: "EACCES" });
  vi.mocked(filesystem_m4.mkdirSync).mockImplementationOnce(() => { throw failure; });
  assert.throws(() => acquireEntrypointAdmission(root, "shared"), error => error === failure);
  assert.match(String(vi.mocked(filesystem_m4.mkdirSync).mock.calls.at(-1)?.[0]), /\/\.admission-mutex-tmp-[1-9]\d*-[0-9a-f]{64}-[0-9a-f-]{36}$/u);
  assert.equal(existsSync(mutex), false);

} finally {
await _afterEachFixture0();
}
});
it("refuses symlink mutex custody and preserves an immediate exclusive lease conflict", async () => {
try {

  const root = initializedRoot();
  const admission = acquireEntrypointAdmission(root, "exclusive");
  assert.throws(() => acquireEntrypointAdmission(root, "shared"), /installation lease busy/u);
  admission.release();
  const target = initializedRoot();
  symlinkSync(join(target, ".tracker/control"), join(root, ".tracker/control", "admission-mutex"));
  assert.throws(() => acquireEntrypointAdmission(root, "shared"), /unsafe directory/u);
  assert.equal(existsSync(join(target, ".tracker/control", "installation.json")), true);

} finally {
await _afterEachFixture0();
}
});

it("propagates installation lstat access failure instead of treating the path as absent", async () => {
try {

  const root = initializedRoot();
  const failure = Object.assign(new Error("injected lstat access failure"), { code: "EACCES" });
  vi.mocked(filesystem_m4.lstatSync).mockImplementationOnce(() => { throw failure; });
  assert.throws(() => acquireEntrypointAdmission(root, "shared"), error => error === failure);

} finally {
await _afterEachFixture0();
}
});
}
