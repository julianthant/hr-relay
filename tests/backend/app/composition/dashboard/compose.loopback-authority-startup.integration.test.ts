import { runtimeLifetimeLock } from "../../../../support/helpers/backend/runtime-lifetime.js";
import { composeProfileCredentialInventory } from "../../../../../src/backend/app/composition/profile-credential-inventory.js";
import type { RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import { createProfileRegistry } from "../../../../../src/backend/profiles/registry.js";
import { createCredentialStore } from "../../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase as CanonicalAuthorityDatabase, AuthorityDatabaseOptionsSchema, AuthoritySchemaVersionError } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import type { Clock } from "../../../../../src/rules/time/clock.js";
import { acquireEntrypointAdmission } from "../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeDashboardApplication, type DashboardComposeInput } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { storageTree } from "../../../../support/helpers/integration/storage-recovery-fixture.js";
import { RuntimeCustodyUncertainError, composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { createDashboardPortTestWorld } from "../../../../support/helpers/backend/dashboard-port-world.js";
import { spawnSync } from "node:child_process";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../../src/backend/storage/sqlite/migrations.js";
import { SettingsCurrentRecordSchema } from "../../../../../src/models/config/settings-current.js";
import { releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import * as processLocks from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import * as supervisors from "../../../../../src/backend/runtime/workers/worker-supervisor.js";
import { WorkerProcessLockFileSchema, readRuntimeProcessLock } from "../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { SETTINGS_SCHEMA_HASH } from "../../../../../src/models/config/settings.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS, persistCorruptJournaledSettings } from "../../../../support/fixtures/integration/settings-runtime-corruption-fixtures.js";
import { AuthorityDatabase } from "../../../../support/helpers/admission-fixture.js";

const { cleanups, composeDashboardRuntime: composeFixtureDashboardRuntime, copyRuntimePackageFixture, cleanup } = createDashboardPortTestWorld(() => {
      vi.mocked(fsyncSync).mockReset();
      vi.mocked(readFileSync).mockReset();
      vi.mocked(openSync).mockReset();
      vi.mocked(mkdirSync).mockReset();
      vi.restoreAllMocks();
    }, () => releaseAdmissionFixtures());


const readyProfiles = new Map<string, { fixture: Awaited<ReturnType<typeof createBoundProfileFixture>>; selected: ReturnType<typeof selectedProfile> }>();
function selectedProfile(fixture: Awaited<ReturnType<typeof createBoundProfileFixture>>) {
  const machine = acquireEntrypointAdmission(fixture.workspace, "shared");
  const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
  const runtime = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null } });
  const storage: { admission?: RuntimeAdmission } = {};
  const cleanup = async () => { await runtime.close(); storage.admission?.release(); machine.release(); };
  cleanups.push(cleanup);
  const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  assert.equal(active.state, "active");
  if (active.state !== "active") throw new Error("startup fixture sign-in refused");
  const admission = machine.admitProfile(createProfileRegistry(machine).storageClaim(active.profileId));
  storage.admission = admission;
  const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot, erasureJournalAdmission: machine,
    erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${active.profileId}.json`) });
  return { machine, runtime, token: active.token, admission, credentials, cleanup };
}
async function readyRoot() {
  const fixture = await createBoundProfileFixture({ sharedMachine: true });
  cleanups.push(async () => { readyProfiles.delete(fixture.workspace); await fixture.close(); });
  copyRuntimePackageFixture(fixture.workspace);
  readyProfiles.set(fixture.workspace, { fixture, selected: selectedProfile(fixture) });
  return fixture.workspace;
}
function profileStateRoot(repoRoot: string) {
  const entry = readyProfiles.get(repoRoot); assert.ok(entry);
  return entry.fixture.stateRoot;
}
function restartSelectedProfile(repoRoot: string) {
  const entry = readyProfiles.get(repoRoot); assert.ok(entry);
  entry.selected = selectedProfile(entry.fixture);
}
function openFixtureDatabase(input: unknown, clock?: Clock) {
  const options = AuthorityDatabaseOptionsSchema.parse(input);
  const owner = [...readyProfiles.values()].find(entry => join(entry.fixture.stateRoot, "state.db") === options.path)?.selected;
  assert.ok(owner);
  return CanonicalAuthorityDatabase.open(owner.admission, options, clock, undefined, undefined, undefined, owner.credentials);
}
function assertReleasedServerClaim(repoRoot: string, start: number) {
  const lockRoot = join(repoRoot, rebuildRuntimeIsolation.processLockRoot);
  const acquired = vi.mocked(processLocks.acquireRuntimeProcessLock);
  const matches = acquired.mock.calls.slice(start).flatMap((args, offset) => {
    const input = processLocks.RuntimeProcessLockOptionsSchema.parse(args[0]);
    if (input.name !== "server" || input.processLockRoot !== lockRoot) return [];
    const result = acquired.mock.results[start + offset];
    assert.ok(result?.type === "return");
    return [result.value];
  });
  assert.equal(matches.length, 1);
  const handle = matches[0]; assert.ok(handle);
  const current = readRuntimeProcessLock(lockRoot, "server"); assert.ok(current);
  assert.equal(current.acquisitionId, handle.acquisitionId); assert.equal(current.generation, handle.generation);
  assert.equal(current.pid, process.pid); assert.equal(typeof current.releasedAt, "string");
}
async function composeDashboardRuntime(input: DashboardComposeInput) {
  if (input.profile !== undefined) return composeFixtureDashboardRuntime(input);
  assert.ok(input.repoRoot);
  const entry = readyProfiles.get(input.repoRoot); assert.ok(entry);
  return composeFixtureDashboardRuntime({ ...input, admission: entry.selected.machine,
    profile: { runtime: entry.selected.runtime, token: entry.selected.token } });
}


vi.mock("../../../../../src/backend/storage/sqlite/runtime-process-locks.js", { spy: true });
vi.mock("../../../../../src/backend/runtime/workers/worker-supervisor.js", { spy: true });

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    fsyncSync: vi.fn(actual.fsyncSync),
    readFileSync: vi.fn(actual.readFileSync),
    openSync: vi.fn(actual.openSync),
    mkdirSync: vi.fn(actual.mkdirSync),
  };
});

afterEach(cleanup);

describe("composed dashboard runtime over an owned loopback socket", () => {
  it("unwinds an initial preflight refresh rejection and keeps authority admission recoverable", async () => {
    const repoRoot = await readyRoot();
    copyRuntimePackageFixture(repoRoot);
    mkdirSync(profileStateRoot(repoRoot), { recursive: true });
    const path = join(profileStateRoot(repoRoot), "state.db");
    const primary = new Error("injected preflight clock failure");
    const baseClock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const clock = { ...baseClock, monotonicMs: () => { throw primary; } };

    await assert.rejects(composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(),
      isolation: rebuildRuntimeIsolation,
      env: {},
      clock,
      repoRoot,
    }), (error: unknown) => error instanceof AggregateError && error.errors.includes(primary));

    const lock = readRuntimeProcessLock(join(repoRoot, rebuildRuntimeIsolation.processLockRoot), "server");
    assert.ok(lock);
    assert.equal(typeof lock.releasedAt, "string", "the server record releases after startup cleanup closes authority");
    const database = openFixtureDatabase({ path, busyTimeoutMs: 250, migrationOwner: "startup-unwind-test" }, baseClock);
    try {
      assert.equal(database.getMeta().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    } finally {
      database.close();
    }
  });

  it("preserves an HTTP bind rejection while unwinding the constructed dashboard", async () => {
    const repoRoot = await readyRoot();
    copyRuntimePackageFixture(repoRoot);
    const primary = new Error("injected HTTP listen failure");

    await assert.rejects(composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(),
      isolation: rebuildRuntimeIsolation,
      env: {},
      repoRoot,
      httpServerStarter: async () => { throw primary; },
    }), (error: unknown) => error === primary);

    const lock = readRuntimeProcessLock(join(repoRoot, rebuildRuntimeIsolation.processLockRoot), "server");
    assert.ok(lock);
    assert.equal(typeof lock.releasedAt, "string");
    const database = openFixtureDatabase({
      path: join(profileStateRoot(repoRoot), "state.db"),
      busyTimeoutMs: 250,
      migrationOwner: "startup-unwind-test",
    });
    database.close();
  });

  it("refuses a missing saved settings singleton when active revision proves one existed", async () => {
    const repoRoot = await readyRoot();
    copyRuntimePackageFixture(repoRoot);
    const stateRoot = profileStateRoot(repoRoot);
    mkdirSync(stateRoot, { recursive: true });
    const path = join(stateRoot, "state.db");
    const initial = await composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(), isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {}, repoRoot });
    await initial.stop();
    restartSelectedProfile(repoRoot);
    const raw = new DatabaseSync(path);
    try {
      raw.exec("DELETE FROM settings");
    } finally {
      raw.close();
    }

    await assert.rejects(composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(),
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      repoRoot,
    }), /settings-current-missing-with-history/u);
    const lock = readRuntimeProcessLock(join(repoRoot, rebuildRuntimeIsolation.processLockRoot), "server");
    assert.ok(lock);
    assert.equal(typeof lock.releasedAt, "string");
  });

  it("serves a virgin public shell without flat authority, then creates one genuinely coupled selected profile", async () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "public-virgin-root-")));
    copyRuntimePackageFixture(repoRoot);
    const machine = acquireEntrypointAdmission(repoRoot, "exclusive");
    mkdirSync(join(repoRoot, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
    let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
    try {
      vi.mocked(readFileSync).mockClear();
      application = await composeDashboardApplication({ lifetimeLock: await runtimeLifetimeLock(), admission: machine, isolation: rebuildRuntimeIsolation,
        repoRoot, backendPortOverride: 0, frontendPortOverride: 0, env: {} });
      assert.equal(existsSync(join(machine.stateRoot, "state.db")), false);
      assert.equal(machine.readProfileRegistry().profiles.length, 0);
      assert.equal(vi.mocked(readFileSync).mock.calls.filter(([path]) => typeof path === "string" && path.includes("/credentials/")).length, 0);
      const origin = `http://127.0.0.1:${String(application.port)}`;
      const response = await fetch(`${origin}/api/v1/profile/sign-up`, { method: "POST", headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "disposable-fixture-password" }) });
      const active = PublicProfileStateSchema.parse(await response.json()); assert.equal(active.state, "active");
      if (active.state !== "active") throw new Error("actual signup required");
      assert.equal(machine.readProfileRegistry().profiles.length, 1);
      assert.equal(existsSync(join(machine.stateRoot, "profiles", active.profileId, "state.db")), true);
      assert.equal(existsSync(join(machine.stateRoot, "state.db")), false);
      const cookie = response.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
      assert.equal((await fetch(`${origin}/api/v1/bootstrap`, { headers: { cookie } })).status, 200);
    } finally { await application?.stop(); machine.release(); rmSync(repoRoot, { recursive: true, force: true }); }
  });

  it("refuses an established selected profile with no authority database and releases its exact server claim", async () => {
    const repoRoot = await readyRoot();
    copyRuntimePackageFixture(repoRoot);
    const stateRoot = profileStateRoot(repoRoot);
    mkdirSync(stateRoot, { recursive: true });
    rmSync(join(stateRoot, "state.db"));
    const evidencePath = join(stateRoot, "retained-evidence");
    writeFileSync(evidencePath, "evidence", { mode: 0o600 });
    const planted = statSync(evidencePath), evidenceBytes = readFileSync(evidencePath);
    const before = storageTree(stateRoot);
    const lockPath = join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");

    const acquisitionStart = vi.mocked(processLocks.acquireRuntimeProcessLock).mock.calls.length;
    assert.equal(existsSync(lockPath), false);
    await assert.rejects(composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(),
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      repoRoot,
    }), /profile-database-binding-required/u);

    assertReleasedServerClaim(repoRoot, acquisitionStart);
    assert.equal(existsSync(join(stateRoot, "state.db")), false);
    assert.deepEqual(storageTree(stateRoot), before);
    const selected = readyProfiles.get(repoRoot)?.selected; assert.ok(selected);
    await selected.runtime.close();
    assert.deepEqual(storageTree(stateRoot), before);
    const retained = statSync(evidencePath);
    for (const key of ["dev", "ino", "mode"] as const) assert.equal(retained[key], planted[key]);
    assert.equal(readFileSync(evidencePath).equals(evidenceBytes), true);
    selected.machine.assertLive(); selected.admission.assertLive();
  });

  it("refuses missing native authority beside its surviving canonical protected credentials without repairing either half", async () => {
    const repoRoot = await readyRoot(), stateRoot = profileStateRoot(repoRoot);
    assert.equal(existsSync(join(stateRoot, "credentials", "protected.json")), true);
    rmSync(join(stateRoot, "state.db"));
    const before = storageTree(stateRoot);
    assert.equal(readRuntimeProcessLock(join(repoRoot, rebuildRuntimeIsolation.processLockRoot), "server"), undefined);
    const acquisitionStart = vi.mocked(processLocks.acquireRuntimeProcessLock).mock.calls.length;
    await assert.rejects(composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(), isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {}, repoRoot }),
      error => error instanceof Error && error.message === "profile-database-binding-required");
    assertReleasedServerClaim(repoRoot, acquisitionStart);
    assert.equal(existsSync(join(stateRoot, "state.db")), false);
    assert.deepEqual(storageTree(stateRoot), before);
  });

  it("refuses the missing database beside an unowned legacy settings directory without repairing either half", async () => {
    const repoRoot = await readyRoot(), stateRoot = profileStateRoot(repoRoot);
    const selected = readyProfiles.get(repoRoot)?.selected; assert.ok(selected);
    rmSync(join(stateRoot, "state.db"));
    const legacyPath = join(stateRoot, "settings");
    mkdirSync(legacyPath, { mode: 0o700 });
    const planted = statSync(legacyPath), before = storageTree(stateRoot);
    const acquisitionStart = vi.mocked(processLocks.acquireRuntimeProcessLock).mock.calls.length;
    await assert.rejects(composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(), isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {}, repoRoot }),
      error => error instanceof Error && error.message === "profile-database-binding-required");
    assertReleasedServerClaim(repoRoot, acquisitionStart);
    assert.equal(existsSync(join(stateRoot, "state.db")), false);
    assert.deepEqual(storageTree(stateRoot), before);
    await selected.runtime.close();
    assert.deepEqual(storageTree(stateRoot), before);
    const retained = statSync(legacyPath);
    for (const key of ["dev", "ino", "mode"] as const) assert.equal(retained[key], planted[key]);
    assert.deepEqual(readdirSync(legacyPath), []);
    selected.machine.assertLive(); selected.admission.assertLive();
  });

  it.each(["file", "directory"] as const)("refuses an unowned %s through actual inventory while retaining the opened profile owner", async kind => {
    const repoRoot = await readyRoot(), stateRoot = profileStateRoot(repoRoot);
    const selected = readyProfiles.get(repoRoot)?.selected; assert.ok(selected);
    const context = selected.runtime.selectedContext(selected.token);
    assert.equal(context.database.getMeta().profileId, selected.admission.profileBinding.profileId);
    const path = join(stateRoot, kind === "file" ? "retained-evidence" : "settings");
    if (kind === "file") writeFileSync(path, "evidence", { mode: 0o600 });
    else mkdirSync(path, { mode: 0o700 });
    const planted = statSync(path), bytes = kind === "file" ? readFileSync(path) : undefined;
    const before = storageTree(stateRoot);
    await assert.rejects(composeProfileCredentialInventory({ machine: selected.machine, admission: context.admission,
      database: context.database, hostFacts: { primaryDisplay: null }, clock: manualClock(new Date("2026-08-28T12:00:00.000Z")) }).prepare(),
      error => error instanceof Error && error.message === "profile-inventory-unowned-entry");
    context.assertCurrent();
    selected.machine.assertLive(); selected.admission.assertLive();
    assert.doesNotThrow(() => context.database.getMeta());
    assert.deepEqual(storageTree(stateRoot), before);
    const retained = statSync(path);
    for (const key of ["dev", "ino", "mode"] as const) assert.equal(retained[key], planted[key]);
    if (bytes !== undefined) {
      assert.equal(readFileSync(path).equals(bytes), true);
      unlinkSync(path);
    } else {
      assert.deepEqual(readdirSync(path), []);
      rmdirSync(path);
    }
    await selected.runtime.close();
    const descriptors = spawnSync("lsof", ["-nP", "-a", "-p", String(process.pid), "-Fn"], { encoding: "utf8" });
    assert.equal(descriptors.status, 0); assert.equal(descriptors.stderr, "");
    const sourcePath = join(stateRoot, "state.db");
    assert.deepEqual(descriptors.stdout.split("\n").filter(line => [sourcePath, `${sourcePath}-wal`, `${sourcePath}-shm`]
      .some(file => line === `n${file}` || line === `n${file} (deleted)`)), []);
  });

  it("recovers after genuine abandoned server custody and retains dead worker evidence", async () => {
    const repoRoot = await readyRoot();
    copyRuntimePackageFixture(repoRoot);
    const processLockRoot = join(repoRoot, rebuildRuntimeIsolation.processLockRoot);
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const abandon = (worker: boolean) => {
      const modulePath = join(process.cwd(), "src/backend/storage/sqlite/runtime-process-locks.ts");
      const code = `import { acquireRuntimeProcessLock } from ${JSON.stringify(modulePath)}; const root=${JSON.stringify(processLockRoot)}; const server=acquireRuntimeProcessLock({processLockRoot:root,name:"server",pid:process.pid}); if(${String(worker)})acquireRuntimeProcessLock({processLockRoot:root,name:"workers",workerId:"orphan-worker",pid:process.pid}); console.log(server.acquisitionId); process.exit(23);`;
      const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 });
      assert.equal(child.status, 23, child.stderr);
      const record = readRuntimeProcessLock(processLockRoot, "server");
      assert.ok(record); assert.equal(record.acquisitionId, child.stdout.trim());
      assert.equal(record.releasedAt, null);
      const claim = join(processLockRoot, "server-claims", `${String(record.generation)}.claim.json`);
      return { record, claim, bytes: readFileSync(claim) };
    };
    const crashed = abandon(false);
    const recovered = await composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(), isolation: rebuildRuntimeIsolation, env: {}, clock, repoRoot });
    assert.deepEqual(readFileSync(crashed.claim), crashed.bytes);
    await recovered.stop();
    const stopped = readRuntimeProcessLock(processLockRoot, "server");
    assert.ok(stopped); assert.equal(stopped.pid, process.pid); assert.equal(typeof stopped.releasedAt, "string");
    restartSelectedProfile(repoRoot);
    const secondCrash = abandon(true);
    const orphanFiles = readdirSync(join(processLockRoot, "workers")).filter(name => name.endsWith(".lock.json"));
    assert.equal(orphanFiles.length, 1);
    const orphanPath = join(processLockRoot, "workers", orphanFiles[0] ?? "");
    const orphan = WorkerProcessLockFileSchema.parse(JSON.parse(readFileSync(orphanPath, "utf8")));
    assert.ok("workerId" in orphan); assert.equal(orphan.workerId, "orphan-worker"); assert.equal(orphan.releasedAt, null);
    const orphanBytes = readFileSync(orphanPath);
    const selected = readyProfiles.get(repoRoot)?.selected; assert.ok(selected);
    const context = selected.runtime.selectedContext(selected.token);
    const sourcePath = join(profileStateRoot(repoRoot), "state.db"), originalSource = statSync(sourcePath);
    let server: processLocks.RuntimeProcessLockHandle | undefined;
    let supervisor: ReturnType<typeof supervisors.createDashboardWorkerProcessSupervisor> | undefined;
    const actualLocks = await vi.importActual<typeof processLocks>("../../../../../src/backend/storage/sqlite/runtime-process-locks.js");
    const actualSupervisors = await vi.importActual<typeof supervisors>("../../../../../src/backend/runtime/workers/worker-supervisor.js");
    vi.spyOn(processLocks, "acquireRuntimeProcessLock").mockImplementation((input, inputClock, hooks) => {
      const handle = actualLocks.acquireRuntimeProcessLock(input, inputClock, hooks);
      const parsed = processLocks.RuntimeProcessLockOptionsSchema.parse(input);
      if (parsed.name === "server" && parsed.processLockRoot === processLockRoot) server = handle;
      return handle;
    });
    vi.spyOn(supervisors, "createDashboardWorkerProcessSupervisor").mockImplementation(input => {
      supervisor = actualSupervisors.createDashboardWorkerProcessSupervisor(input);
      return supervisor;
    });
    const second = await composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(), isolation: rebuildRuntimeIsolation, env: {}, clock, repoRoot });
    try {
      const readiness = await createDashboardClient({ baseUrl: `http://127.0.0.1:${String(second.port)}` }).readiness();
      assert.equal(readiness.state, "present");
      if (readiness.state === "present") {
        const check = readiness.checks.find(({ id }) => id === "process.orphans");
        assert.equal(check?.verdict, "warning"); assert.match(check?.detail ?? "", /1 unreleased dead process owner record/u);
      }
    } finally {
      await assert.rejects(second.stop(), error => {
        assert.ok(error instanceof RuntimeCustodyUncertainError);
        assert.equal(error.code, "RUNTIME_CUSTODY_UNCERTAIN");
        assert.equal(error.errors.length, 1);
        const detached: unknown = error.errors[0]; assert.ok(detached instanceof RuntimeCustodyUncertainError);
        assert.equal(error.cause, detached);
        const primary: unknown = detached.errors[0];
        assert.ok(primary instanceof Error); assert.equal(primary.constructor, Error);
        assert.equal(primary.message, "profile-worker-process-closure-unproved");
        assert.equal(detached.code, "RUNTIME_CUSTODY_UNCERTAIN");
        assert.deepEqual(detached.errors, [primary]); assert.equal(detached.cause, primary);
        return true;
      });
      await assert.rejects(fetch(`http://127.0.0.1:${String(second.port)}/api/v1/bootstrap`));
      await assert.rejects(selected.runtime.close(), error => {
        assert.ok(error instanceof RuntimeCustodyUncertainError); assert.equal(error.code, "RUNTIME_CUSTODY_UNCERTAIN");
        assert.equal(error.errors.length, 1);
        const cause: unknown = error.errors[0]; assert.ok(cause instanceof Error);
        assert.equal(cause.constructor, Error); assert.equal(cause.message, "profile-resource-closure-unproved");
        assert.equal(error.cause, cause); return true;
      });
      selected.machine.assertLive(); context.admission.assertLive();
      const retainedSource = statSync(sourcePath);
      assert.equal(retainedSource.dev, originalSource.dev); assert.equal(retainedSource.ino, originalSource.ino);
      const resources = context.database.readProfileResourceCustody();
      assert.equal(resources.slots.length, 0); assert.equal(resources.leases.length, 0); assert.equal(resources.browsers.length, 0);
      assert.deepEqual(readFileSync(orphanPath), orphanBytes);
      assert.deepEqual(readFileSync(crashed.claim), crashed.bytes);
      assert.deepEqual(readFileSync(secondCrash.claim), secondCrash.bytes);
      const current = readRuntimeProcessLock(processLockRoot, "server");
      assert.ok(current); assert.ok(server);
      assert.equal(current.pid, process.pid); assert.equal(current.acquisitionId, server.acquisitionId); assert.equal(current.releasedAt, null);
      assert.equal(context.database.getSourceDatabaseIdentity(), AuthorityDatabase.sourceDatabaseIdentity(join(profileStateRoot(repoRoot), "state.db")));
      assert.ok(supervisor); assert.deepEqual(supervisor.close(), []);
      const descriptors = () => {
        const result = spawnSync("lsof", ["-nP", "-a", "-p", String(process.pid), "-Fn"], { encoding: "utf8" });
        assert.equal(result.status, 0); assert.equal(result.stderr, "");
        const path = join(profileStateRoot(repoRoot), "state.db");
        return result.stdout.split("\n").filter(line => [path, `${path}-wal`, `${path}-shm`].some(file => line === `n${file}`)).length;
      };
      assert.ok(descriptors() > 0);
      await context.account.close(); context.database.close();
      assert.equal(descriptors(), 0);
      context.admission.release(); selected.admission.release(); server.release(); selected.machine.release();
      assert.throws(() => context.admission.assertLive(), /missing or released admission/u);
      const released = readRuntimeProcessLock(processLockRoot, "server"); assert.ok(released);
      assert.equal(released.acquisitionId, server.acquisitionId); assert.equal(typeof released.releasedAt, "string");
      assert.deepEqual(readFileSync(orphanPath), orphanBytes);
      const cleanupIndex = cleanups.indexOf(selected.cleanup); assert.notEqual(cleanupIndex, -1);
      assert.deepEqual(cleanups.splice(cleanupIndex, 1), [selected.cleanup]);
    }
  });

  it("refuses a newer authority under the current build before settings opens or config resolution", async () => {
    const repoRoot = await readyRoot();
    copyRuntimePackageFixture(repoRoot);
    const stateRoot = profileStateRoot(repoRoot);
    const artifactRoot = join(profileStateRoot(repoRoot), "artifacts");
    const lockPath = join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    const path = join(stateRoot, "state.db");
    openFixtureDatabase({ path, busyTimeoutMs: 250, migrationOwner: "native-schema-refusal-fixture" }).close();
    const selected = readyProfiles.get(repoRoot)?.selected; assert.ok(selected);
    const admission = selected.machine;
    const artifactBefore = statSync(artifactRoot);
    const newer = new DatabaseSync(path);
    newer.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION + 1)}`);
    newer.close();
    const before = readFileSync(path);
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Reflect.get(raw.prepare("PRAGMA user_version").get() ?? {}, "user_version"), CURRENT_AUTHORITY_SCHEMA_VERSION + 1);
      assert.notEqual(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'database_upgrades'").get(), undefined);
    } finally {
      raw.close();
    }
    // A readable planted settings file makes the early-read negative control
    // reach the same authority refusal rather than failing on ENOENT first.
    mkdirSync(join(stateRoot, "settings"), { recursive: true, mode: 0o700 });
    writeFileSync(join(stateRoot, "settings", "settings.json"), "{}", { mode: 0o600 });

    {
      const resolver = await import("../../../../../src/backend/app/config/resolve.js");
      const resolveSpy = vi.spyOn(resolver, "resolveConfigWithProvenance");
      const { composeDashboardRuntime: composeCurrentBuild } = await import("../../../../../src/backend/app/composition/dashboard/compose.js");
      vi.mocked(readFileSync).mockClear();
      vi.mocked(openSync).mockClear();
      vi.mocked(mkdirSync).mockClear();
      try {
        await assert.rejects(composeCurrentBuild({ lifetimeLock: await runtimeLifetimeLock(), admission, profile: { runtime: selected.runtime, token: selected.token },
          isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0,
          env: {}, clock: manualClock(new Date("2026-08-28T12:00:00.000Z")), repoRoot,
        }), error => error instanceof AuthoritySchemaVersionError && error.code === "authority-schema-mismatch"
          && error.schemaVersion === CURRENT_AUTHORITY_SCHEMA_VERSION + 1);

        const isSettingsPath = (value: unknown): boolean => typeof value === "string"
          && (value.startsWith(join(stateRoot, "settings", "settings.json"))
            || value.startsWith(join(stateRoot, "settings") + "/"));
        assert.equal(vi.mocked(openSync).mock.calls.filter(([target]) => isSettingsPath(target)).length,
          0, "zero settings-family openSync calls before downgrade refusal");
        assert.equal(vi.mocked(readFileSync).mock.calls.filter(([target]) => isSettingsPath(target)).length,
          0, "zero settings-family readFileSync calls before downgrade refusal");
        assert.equal(resolveSpy.mock.calls.length, 0, "zero resolveConfigWithProvenance calls before downgrade refusal");
        assert.equal(vi.mocked(mkdirSync).mock.calls.filter(([target]) => target === stateRoot).length,
          0, "profile binding refuses before native mutable directory validation");
        assert.equal(vi.mocked(openSync).mock.calls.filter(([target]) => target === artifactRoot).length,
          0, "profile binding refuses before native mutable artifact validation");
        const artifactAfter = statSync(artifactRoot);
        assert.equal(artifactAfter.mode & 0o777, 0o700);
        for (const key of ["dev", "ino", "mode", "mtimeMs", "ctimeMs"] as const) assert.equal(artifactAfter[key], artifactBefore[key], `artifact directory ${key} unchanged`);
        assert.equal(existsSync(lockPath), false, "native schema refusal acquires no server process record");
        assert.deepEqual(readFileSync(path), before);
      } finally {
        resolveSpy.mockRestore();
      }
    }
  });

  it.each([29, CURRENT_AUTHORITY_SCHEMA_VERSION + 1])("refuses unsupported selected-profile authority %s before acquiring a server process record", async version => {
    const repoRoot = await readyRoot();
    copyRuntimePackageFixture(repoRoot);
    const path = join(profileStateRoot(repoRoot), "state.db");
    openFixtureDatabase({ path, busyTimeoutMs: 250, migrationOwner: "unsupported-schema-fixture" }).close();
    const raw = new DatabaseSync(path);
    try { raw.exec(`UPDATE database_states SET schema_version=${String(version)} WHERE id=1; PRAGMA user_version=${String(version)}`); } finally { raw.close(); }
    const before = readFileSync(path);
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const acquisitionStart = vi.mocked(processLocks.acquireRuntimeProcessLock).mock.calls.length;
    await assert.rejects(composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(), isolation: rebuildRuntimeIsolation, env: {}, repoRoot, clock }),
      error => error instanceof AuthoritySchemaVersionError && error.code === "authority-schema-mismatch" && error.schemaVersion === version);
    assertReleasedServerClaim(repoRoot, acquisitionStart);
    assert.deepEqual(readFileSync(path), before);
    const unchanged = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(Reflect.get(unchanged.prepare("PRAGMA user_version").get() ?? {}, "user_version"), version); } finally { unchanged.close(); }
  });

  it("serves the exact editable settings command schema hash", async () => {
    const repoRoot = await readyRoot();
    copyRuntimePackageFixture(repoRoot);
    const runtime = await composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(),
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock: manualClock(new Date("2026-08-28T12:00:00.000Z")),
      repoRoot,
    });
    cleanups.push(() => runtime.stop());

    const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
    const bootstrap = await client.bootstrap();

    assert.equal(bootstrap.settingsSchemaHash, SETTINGS_SCHEMA_HASH);
  });

  it("ignores retired malformed file authority and serves the SQLite baseline", async () => {
    const repoRoot = await readyRoot();
    copyRuntimePackageFixture(repoRoot);
    const authorityPath = join(profileStateRoot(repoRoot), "state.db");
    mkdirSync(dirname(authorityPath), { recursive: true });
    openFixtureDatabase({ path: authorityPath, busyTimeoutMs: 250, migrationOwner: "retired-settings-fixture" }).close();
    const path = join(repoRoot, ".tracker", "settings", "settings.json");
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "retired malformed file");
    const runtime = await composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(), isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {}, repoRoot });
    try {
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
      const editor = await client.editableSettings();
      assert.equal(editor.revision, 1);
      assert.equal(readFileSync(path, "utf8"), "retired malformed file");
    } finally { await runtime.stop(); }
  });

  it.each(SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS)(
    "refuses valid settings bytes with corrupt $label on dashboard boot",
    async (corruption) => {
      const owner = await createBoundProfileFixture({ sharedMachine: true });
      const repoRoot = owner.workspace;
      cleanups.push(async () => await owner.close());
      copyRuntimePackageFixture(repoRoot);
      const clock = manualClock(new Date("2026-10-22T12:00:00.000Z"));
      const profile = composeProfileRuntime({ admission: owner.machine, clock, hostFacts: { primaryDisplay: null } });
      const storage: { admission?: RuntimeAdmission } = {};
      cleanups.push(async () => { await profile.close(); storage.admission?.release(); });
      const signedIn = profile.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password",
        at: clock.now().toISOString() });
      assert.equal(signedIn.state, "active");
      if (signedIn.state !== "active") throw new Error("corruption-fixture-signin-refused");
      const admission = owner.machine.admitProfile(createProfileRegistry(owner.machine).storageClaim(signedIn.profileId));
      storage.admission = admission;
      const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot, erasureJournalAdmission: owner.machine,
        erasureJournalPath: join(owner.machine.stateRoot, "machine", "erasures", `${signedIn.profileId}.json`) });
      const fixture = persistCorruptJournaledSettings({
        repoRoot,
        stateRoot: owner.stateRoot,
        clock,
        corruption,
        activateRuntime: false,
        admission, credentials,
      });

      await assert.rejects(async () => {
        const runtime = await composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(),
          admission: owner.machine, profile: { runtime: profile, token: signedIn.token },
          isolation: rebuildRuntimeIsolation,
          backendPortOverride: 0,
          env: {},
          clock,
          repoRoot,
        });
        await runtime.stop();
      }, corruption.id === "command-envelope" ? /command-row-identity-mismatch/u : /command-audit-settlement-mismatch/u);

      const raw = new DatabaseSync(owner.path, { readOnly: true });
      try {
        const row = raw.prepare("SELECT payload_json FROM settings WHERE id='current'").get();
        assert.equal(typeof row?.payload_json, "string");
        if (typeof row?.payload_json !== "string") throw new Error("fixture settings row missing");
        assert.deepEqual(SettingsCurrentRecordSchema.parse(Reflect.get(JSON.parse(row.payload_json), "saved")), fixture.record);
      } finally { raw.close(); }
    },
  );
});
