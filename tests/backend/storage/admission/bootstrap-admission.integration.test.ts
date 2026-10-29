import { withOfflineMaintenance, createBoundProfileFixture, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { once } from "node:events";
import { z } from "zod";
import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import nativeFirstBootFs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { retainAuthoritySourceClosure as retainFirstBootSourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { default as assert } from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync as readdirSync_m1, realpathSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { it, vi } from "vitest";
import { composeDashboardRuntime } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { composeStorageCommand, composeProfileRuntime, runOfflineAuthorityRestoreRecovery } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { backupStoppedAuthority } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/authority-health-runner.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { runtimeFixture } from "../../../support/fixtures/preflight/runtime-fixture.js";
import { doctorAuthorityStorage } from "../../../../src/backend/storage/sqlite/storage-doctor.js";

{

it("serves only the genuine token-owned profile and refuses its later missing canonical database", async () => {
  const profile = await createBoundProfileFixture();
  const workspace = profile.workspace, authorityPath = profile.path;
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(workspace, name));
  const runtime = composeProfileRuntime({ admission: profile.machine, clock, hostFacts: { primaryDisplay: null } });
  let dashboard: Awaited<ReturnType<typeof composeDashboardRuntime>> | undefined;
  let restarted: ReturnType<typeof acquireEntrypointAdmission> | undefined;
  let dashboardStopped = false;
  try {
    const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
    assert.equal(active.state, "active");
    if (active.state !== "active") throw new Error("actual profile sign-in required");
    assert.equal(existsSync(join(profile.machine.stateRoot, "state.db")), false);
    assert.equal(existsSync(authorityPath), true);
    dashboard = await composeDashboardRuntime({ lifetimeLock: profile.lifetime, admission: profile.machine, profile: { runtime, token: active.token },
      isolation: rebuildRuntimeIsolation, repoRoot: workspace, env: {}, clock, backendPortOverride: 0, frontendPortOverride: 0,
      preflightRunnerFactory: healthyRuntimePreflightRunners });
    const response = await fetch(`http://127.0.0.1:${String(dashboard.port)}/api/v1/settings/storage-relocation`);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { state: "error", code: "PROFILE_STORAGE_RELOCATION_UNSUPPORTED",
      message: ERROR_CATALOG.PROFILE_STORAGE_RELOCATION_UNSUPPORTED.text, retryable: false });
    await dashboard.stop(); dashboard = undefined; dashboardStopped = true;
    const credentialPath = join(profile.stateRoot, "credentials", "protected.json"), credentialBytes = readFileSync(credentialPath);
    rmSync(authorityPath);
    const fresh = acquireEntrypointAdmission(workspace, "exclusive", profile.lifetime); restarted = fresh;
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
    restarted?.release(); await profile.close();
  }
}, 20_000);
}

{

const roots: string[] = [];
const children: ChildProcess[] = [];
const rootClosures: (() => Promise<void>)[] = [];
const _afterEachFixture0 = async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve())); child.kill("SIGKILL"); await exited;
  }
  for (const close of rootClosures.splice(0)) await close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};
it("keeps the owned restoring journal after process death and absent staging until explicit exact stopped settlement", async () => {
try {

  const profile = await createBoundProfileFixture();
  const root = profile.workspace, profileId = profile.admission.profileBinding.profileId; roots.push(root);
  const port = profile.lifetime.port;
  await profile.closeController();
  const url = (path: string) => pathToFileURL(join(process.cwd(), path)).href;
  const code = `


    const { acquireEntrypointAdmission } = await import(${JSON.stringify(url("src/backend/storage/admission/bootstrap-admission.ts"))});
    const { AuthorityDatabase } = await import(${JSON.stringify(url("src/backend/storage/sqlite/authority-database.ts"))});
    const { AuthorityBackupService } = await import(${JSON.stringify(url("src/backend/storage/sqlite/backup-service.ts"))});
    const { OfflineAuthorityRestoreService } = await import(${JSON.stringify(url("src/backend/storage/sqlite/offline-restore.ts"))});
    const { profileBrowserClosure } = await import(${JSON.stringify(url("src/backend/runtime/browser/native-profile-probe.ts"))});
    const { observeRuntimeLockSnapshot } = await import(${JSON.stringify(url("src/backend/storage/sqlite/runtime-process-locks.ts"))});
        const { createProfileRegistry } = await import(${JSON.stringify(url("src/backend/profiles/registry.ts"))});
    const { createCredentialStore } = await import(${JSON.stringify(url("src/backend/storage/configuration/credential-store.ts"))});
    const { RuntimeLifetimeLock } = await import(${JSON.stringify(url("src/backend/storage/admission/lifetime-lock.ts"))});
    const lifetime = await RuntimeLifetimeLock.acquire(Number(process.argv[2]));
    const root = process.argv[1], machine = acquireEntrypointAdmission(root, "exclusive", lifetime);
    const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(${JSON.stringify(profileId)})), state = admission.stateRoot;
    const credentials = createCredentialStore({ admission, stateRoot: state, erasureJournalAdmission: machine,
      erasureJournalPath: join(machine.stateRoot, "machine", "erasures", admission.profileBinding.profileId + ".json") });
    const path = join(state, "state.db"), directory = join(state, "backups", "authority"), processLockRoot = join(root, ${JSON.stringify(rebuildRuntimeIsolation.processLockRoot)});
    const db = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "native-crash-test" }, undefined, undefined, undefined, undefined, credentials);
    const report = await new AuthorityBackupService(admission, db, { directory }).request({ trigger: "operator", requiredGeneration: db.getMeta().authorityGeneration });
    db.close();
    const manifestPath = join(directory, report.manifests[0].backupFileName + ".manifest.json");


    const operation = admission.acquireOfflineMaintenance();
    const service = new OfflineAuthorityRestoreService(profileBrowserClosure, admission, { authorityPath: path, suspectDirectory: join(state, "backups", "suspects"),
      processLockRoot, busyTimeoutMs: 250}, async () => {}, undefined,
      { copyFile: copyFileSync, atomicReplace(source, destination) {
        renameSync(source, destination); copyFileSync(destination, source);
        const journal = JSON.parse(readFileSync(join(root, ".tracker", "control", "journal.json"), "utf8"));
        process.send({ state: "barrier-held", workspace: root, profileId: admission.profileBinding.profileId, operationId: journal.restore.operationId, stagedPath: source, manifestPath });
        const wait = new Int32Array(new SharedArrayBuffer(4)); for (;;) Atomics.wait(wait, 0, 0, 1000);
      } }, credentials);
    await service.restore({ manifestPath }, operation);
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, root, String(port)],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"] }); children.push(child);
  const message = await new Promise<{ state: string; workspace: string; profileId: string; operationId: string; stagedPath: string; manifestPath: string }>((resolve, reject) => {
    let output = ""; child.stderr?.on("data", value => { output += String(value); });
    child.once("message", value => {
      try { resolve(z.strictObject({ state: z.literal("barrier-held"), workspace: z.string().min(1), profileId: z.uuid(),
        operationId: z.uuid(), stagedPath: z.string().min(1), manifestPath: z.string().min(1) }).parse(value)); }
      catch (error) { reject(error instanceof Error ? error : new Error("restore child receipt validation failed", { cause: error })); }
    });
    child.once("exit", code => reject(new Error(`restore child exited ${String(code)}: ${output}`)));
  });
  assert.equal(message.state, "barrier-held");
  const workspace = message.workspace; roots.push(workspace);
  const journalPath = join(workspace, ".tracker", "control", "journal.json"), before = readFileSync(journalPath);
  const closed = once(child, "close"); assert.equal(child.kill("SIGKILL"), true);
  assert.deepEqual(await closed, [null, "SIGKILL"]);
  const lifetime = await RuntimeLifetimeLock.acquire(port);
  const releaseRoot = () => lifetime.close();
  rootClosures.push(releaseRoot);
  assert.throws(() => acquireEntrypointAdmission(workspace, "shared", lifetime), /unfinished restoring/u);
  assert.deepEqual(readFileSync(journalPath), before);
  rmSync(message.stagedPath);
  assert.throws(() => acquireEntrypointAdmission(workspace, "shared", lifetime), /unfinished restoring/u);
  const settled = await runOfflineAuthorityRestoreRecovery(workspace, ["--operation", message.operationId,
    "--from", message.manifestPath, "--outcome", "replaced", "--json"], lifetime);
  assert.deepEqual(settled.report, { state: "settled", operationId: message.operationId, outcome: "replaced" });
  assert.equal(existsSync(journalPath), false);
  const admission = acquireEntrypointAdmission(workspace, "shared", lifetime);
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
  const f=await runtimeFixture(["dashboard.serve"]);
  try {const report=await doctorAuthorityStorage(f.admission,f.doctorOptions,f.clock);assert.equal(report.authority.state,"healthy");assert.equal(report.backup.state,"missing");assert.equal((await f.report()).results.find(check=>check.check==="authority.health")?.status,"pass");}
  finally {await f.close();}
});
it.each(["wrong","newer","unsupported"] as const)("%s authority refuses read-only inspection without automatic migration",async kind=>{
  const f=await runtimeFixture(["dashboard.serve"]);
  try {
    const database=new DatabaseSync(f.databasePath);
    try {if(kind==="wrong")database.exec("DROP TABLE runs");else {const version=kind==="newer"?999:1;database.exec(`UPDATE database_states SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`);}}
    finally {database.close();}
    const before=readFileSync(f.databasePath);const report=await doctorAuthorityStorage(f.admission,f.doctorOptions,f.clock);
    assert.equal(report.authority.state,"degraded");if(report.authority.state!=="degraded")throw new Error("unhealthy authority passed");
    assert.equal(report.authority.cause.code,"authority-schema-mismatch");
    assert.equal((await f.report()).results.find(check=>check.check==="authority.health")?.status,"fail");assert.deepEqual(readFileSync(f.databasePath),before);
  }finally {await f.close();}
});

it("supported single-authority restore re-checks healthy without inventing repair or substitute authority",async()=>{
  const profile=await createBoundProfileFixture(), workspace=profile.workspace;
  const admission=profile.admission, stateRoot=profile.stateRoot;
  const clock=manualClock(new Date("2026-09-19T12:00:00.000Z")), authorityPath=join(stateRoot,"state.db");
  try {
    copyFileSync(join(process.cwd(),"package.json"),join(workspace,"package.json"));
    AuthorityDatabase.open(admission,{path:authorityPath,busyTimeoutMs:100,migrationOwner:"preflight-restore"},clock,undefined,undefined,undefined,boundProfileCredentials(admission)).close();
    const backup=await withOfflineMaintenance(admission, operation => backupStoppedAuthority(profileBrowserClosure, admission, stateRoot, clock, join(workspace,rebuildRuntimeIsolation.processLockRoot), operation));
    const manifest=backup.manifests.at(-1);assert.ok(manifest);
    const path=join(stateRoot,"backups","authority",`${manifest.backupFileName}.manifest.json`);
    const restored=await composeStorageCommand(rebuildRuntimeIsolation,["restore","--from",path,"--json"],clock,workspace,admission,boundProfileCredentials(admission));
    assert.equal(restored.exitCode,0,restored.output);
    const renewed = profile.renewAfterRestore();
    assert.throws(() => admission.assertLive(), /profile-restore-context-expired|released admission/u);
    const runner=new AuthorityHealthPreflightRunner(renewed.admission,{stateRootTrustAnchor:workspace,stateRoot,authorityPath,
      backupDirectory:join(stateRoot,"backups","authority"),busyTimeoutMs:100},clock,renewed.credentials);
    const observed=await runner.run({signal:new AbortController().signal,timeoutMs:1000,deadlineMonotonicMs:clock.monotonicMs()+1000,redaction:"safe-summary"});
    assert.equal(observed.state,"healthy",JSON.stringify(observed));
  }finally{await profile.close();}
});
}

{

const roots: string[] = [];
const children: ChildProcess[] = [];
const _afterEachFixture0 = async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await exited;
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};

async function initializedRoot() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "runtime-admission-refusal-")));
  roots.push(root);
  const lifetime = await runtimeLifetimeLock();
  acquireEntrypointAdmission(root, "exclusive", lifetime).release();
  return { root, lifetime };
}

it("propagates installation lstat access failure instead of treating the path as absent", async () => {
try {

  const { root, lifetime } = await initializedRoot();
  const failure = Object.assign(new Error("injected lstat access failure"), { code: "EACCES" });
  vi.spyOn(nativeFirstBootFs, "lstatSync").mockImplementationOnce(() => { throw failure; });
  syncBuiltinESMExports();
  assert.throws(() => acquireEntrypointAdmission(root, "shared", lifetime), error => error === failure);

} finally {
await _afterEachFixture0();
}
});
}

it.each(["malformed", "foreign"] as const)("refuses %s machine registry without publishing control entries", async kind => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "machine-registry-admission-")));
  const lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  const registryPath = join(machine.stateRoot, "machine", "profiles.json");
  machine.release();
  const control = join(workspace, ".tracker/control");
  try {
    const document = JSON.parse(readFileSync(registryPath, "utf8")) as Record<string, unknown>;
    writeFileSync(registryPath, kind === "malformed" ? "{" : JSON.stringify({ ...document, sessionGeneration: 7 }), { mode: 0o600 });
    const before = readFileSync(registryPath), beforeEntries = readdirSync_m1(control);
    assert.throws(() => acquireEntrypointAdmission(workspace, "shared", lifetime));
    assert.deepEqual(readdirSync_m1(control), beforeEntries);
    assert.equal(readFileSync(registryPath).equals(before), true);
    assert.equal(existsSync(join(control, "admission-mutex")), false);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

const retainedFirstBootLockOwners = new Set<object>();

it("fresh machine admission creates its private fixed lock root before profile composition", async () => {
  const workspace = nativeFirstBootFs.mkdtempSync(join(nativeFirstBootFs.realpathSync(tmpdir()), "relay-first-boot-locks-"));
  const held: { workspace: string; admission?: ReturnType<typeof acquireEntrypointAdmission>; primary?: { error: unknown } } = { workspace };
  retainedFirstBootLockOwners.add(held);
  try {
    const processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
    assert.equal(nativeFirstBootFs.existsSync(processLockRoot), false);
    const lifetime = await runtimeLifetimeLock();
    const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime); held.admission = machine;
    machine.assertFixedProcessLockRoot(workspace, processLockRoot);
    const lock = nativeFirstBootFs.lstatSync(processLockRoot);
    assert.ok(lock.isDirectory() && !lock.isSymbolicLink());
    assert.equal(lock.mode & 0o777, 0o700);
    if (process.getuid) assert.equal(lock.uid, process.getuid());
    assert.deepEqual(nativeFirstBootFs.readdirSync(processLockRoot), []);
    assert.equal(nativeFirstBootFs.existsSync(join(machine.stateRoot, "state.db")), false);
    const context = machine.readInstallationContext(); assert.ok(context);
    const registry = machine.readProfileRegistry(); assert.deepEqual(registry.profiles, []);
    machine.release();
    const reopened = acquireEntrypointAdmission(workspace, "exclusive", lifetime); held.admission = reopened;
    reopened.assertFixedProcessLockRoot(workspace, processLockRoot);
    assert.equal(reopened.readInstallationContext()?.locator.installationId, context.locator.installationId);
    assert.deepEqual(reopened.readProfileRegistry(), registry);
    const sameLock = nativeFirstBootFs.lstatSync(processLockRoot);
    assert.deepEqual({ device: sameLock.dev, inode: sameLock.ino, mode: sameLock.mode }, { device: lock.dev, inode: lock.ino, mode: lock.mode });
    reopened.release();
    nativeFirstBootFs.rmSync(workspace, { recursive: true, force: true });
    retainedFirstBootLockOwners.delete(held);
  } catch (error) { held.primary = { error }; throw retainFirstBootSourceClosure([error], { admission: held }); }
});

it.each(["missing", "permissions"] as const)("ordinary admission refuses an existing %s lock root without repair", async kind => {
  const workspace = nativeFirstBootFs.mkdtempSync(join(nativeFirstBootFs.realpathSync(tmpdir()), "relay-existing-locks-"));
  const held: { workspace: string; admission?: ReturnType<typeof acquireEntrypointAdmission>; primary?: { error: unknown } } = { workspace };
  retainedFirstBootLockOwners.add(held);
  try {
    const lifetime = await runtimeLifetimeLock();
    const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime); held.admission = machine;
    const processLockRoot = join(workspace, rebuildRuntimeIsolation.processLockRoot);
    machine.assertFixedProcessLockRoot(workspace, processLockRoot);
    const context = machine.readInstallationContext(); assert.ok(context);
    const registry = machine.readProfileRegistry();
    machine.release();
    if (kind === "missing") nativeFirstBootFs.rmdirSync(processLockRoot);
    else nativeFirstBootFs.chmodSync(processLockRoot, 0o755);
    const before = kind === "missing" ? undefined : nativeFirstBootFs.lstatSync(processLockRoot);
    const reopened = acquireEntrypointAdmission(workspace, "exclusive", lifetime); held.admission = reopened;
    reopened.assertLive();
    assert.equal(reopened.readInstallationContext()?.locator.installationId, context.locator.installationId);
    assert.throws(() => reopened.assertFixedProcessLockRoot(workspace, processLockRoot), (error: unknown) => error instanceof Error
      && (kind === "missing" ? Reflect.get(error, "code") === "ENOENT" : error.message === `runtime-control: unsafe directory ${processLockRoot}`));
    assert.deepEqual(reopened.readProfileRegistry(), registry);
    if (kind === "missing") assert.equal(nativeFirstBootFs.existsSync(processLockRoot), false);
    else {
      assert.ok(before);
      const after = nativeFirstBootFs.lstatSync(processLockRoot);
      assert.deepEqual({ device: after.dev, inode: after.ino, mode: after.mode }, { device: before.dev, inode: before.ino, mode: before.mode });
      assert.equal(after.mode & 0o777, 0o755);
    }
    reopened.release();
    nativeFirstBootFs.rmSync(workspace, { recursive: true, force: true });
    retainedFirstBootLockOwners.delete(held);
  } catch (error) { held.primary = { error }; throw retainFirstBootSourceClosure([error], { admission: held }); }
});
