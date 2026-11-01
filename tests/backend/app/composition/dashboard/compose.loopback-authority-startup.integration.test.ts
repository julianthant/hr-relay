import { assertRuntimeLifetimeHeld, runtimeLifetimeLock } from "../../../../support/helpers/backend/runtime-lifetime.js";
import type { RuntimeLifetimeLock } from "../../../../../src/backend/storage/admission/lifetime-lock.js";
import { composeProfileCredentialInventory } from "../../../../../src/backend/app/composition/profile-credential-inventory.js";
import type { RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import { createCredentialStore } from "../../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase as CanonicalAuthorityDatabase, AuthorityDatabaseOptionsSchema, AuthoritySchemaVersionError } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import type { Clock } from "../../../../../src/rules/time/clock.js";
import { acquireEntrypointAdmission } from "../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeDashboardApplication, type DashboardComposeInput } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { storageTree } from "../../../../support/helpers/integration/storage-recovery-fixture.js";
import { composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { createBoundProfileFixture, syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";
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
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { SETTINGS_SCHEMA_HASH } from "../../../../../src/models/config/settings.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS, persistCorruptJournaledSettings } from "../../../../support/fixtures/integration/settings-runtime-corruption-fixtures.js";

const { cleanups, composeDashboardRuntime: composeFixtureDashboardRuntime, copyRuntimePackageFixture, cleanup } = createDashboardPortTestWorld(() => {
      vi.mocked(fsyncSync).mockReset();
      vi.mocked(readFileSync).mockReset();
      vi.mocked(openSync).mockReset();
      vi.mocked(mkdirSync).mockReset();
      vi.restoreAllMocks();
    }, () => releaseAdmissionFixtures());


const readyProfiles = new Map<string, { fixture: Awaited<ReturnType<typeof createBoundProfileFixture>>; selected: ReturnType<typeof selectedProfile> }>();
function selectedProfile(fixture: Awaited<ReturnType<typeof createBoundProfileFixture>>) {
  const machine = acquireEntrypointAdmission(fixture.workspace, "shared", fixture.lifetime);
  const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
  const runtime = composeProfileRuntime({ admission: machine, clock, hostFacts: { primaryDisplay: null } });
  const storage: { admission?: RuntimeAdmission } = {};
  const cleanup = async () => { await runtime.close(); storage.admission?.release(); machine.release(); };
  cleanups.push(cleanup);
  const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  assert.equal(active.state, "active");
  if (active.state !== "active") throw new Error("startup fixture sign-in refused");
  const admission = machine.admitProfile(active.profileId);
  storage.admission = admission;
  const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot, erasureJournalAdmission: machine,
    erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${active.profileId}.json`) });
  return { machine, runtime, token: active.token, admission, credentials, cleanup };
}
async function readyRoot(lifetime: RuntimeLifetimeLock) {
  const fixture = await createBoundProfileFixture({ sharedMachine: true, lifetime });
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
async function composeDashboardRuntime(input: DashboardComposeInput) {
  if (input.profile !== undefined) return composeFixtureDashboardRuntime(input);
  assert.ok(input.repoRoot);
  const entry = readyProfiles.get(input.repoRoot); assert.ok(entry);
  return composeFixtureDashboardRuntime({ ...input, admission: entry.selected.machine,
    profile: { runtime: entry.selected.runtime, token: entry.selected.token } });
}



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
  const controllerLock=await runtimeLifetimeLock();
    const repoRoot = await readyRoot(controllerLock);
    copyRuntimePackageFixture(repoRoot);
    mkdirSync(profileStateRoot(repoRoot), { recursive: true });
    const path = join(profileStateRoot(repoRoot), "state.db");
    const primary = new Error("injected preflight clock failure");
    const baseClock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const clock = { ...baseClock, monotonicMs: () => { throw primary; } };

    await assert.rejects(composeDashboardRuntime({ lifetimeLock: controllerLock,
      isolation: rebuildRuntimeIsolation,
      env: {},
      clock,
      repoRoot,
    }), (error: unknown) => error instanceof AggregateError && error.errors.includes(primary));

    await assertRuntimeLifetimeHeld(controllerLock);
    const database = openFixtureDatabase({ path, busyTimeoutMs: 250, migrationOwner: "startup-unwind-test" }, baseClock);
    try {
      assert.equal(database.getMeta().schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    } finally {
      database.close();
    }
  });

  it("preserves an HTTP bind rejection while unwinding the constructed dashboard", async () => {
  const controllerLock=await runtimeLifetimeLock();
    const repoRoot = await readyRoot(controllerLock);
    copyRuntimePackageFixture(repoRoot);
    const primary = new Error("injected HTTP listen failure");

    await assert.rejects(composeDashboardRuntime({ lifetimeLock: controllerLock,
      isolation: rebuildRuntimeIsolation,
      env: {},
      repoRoot,
      httpServerStarter: async () => { throw primary; },
    }), (error: unknown) => error === primary);

    await assertRuntimeLifetimeHeld(controllerLock);
    const database = openFixtureDatabase({
      path: join(profileStateRoot(repoRoot), "state.db"),
      busyTimeoutMs: 250,
      migrationOwner: "startup-unwind-test",
    });
    database.close();
  });

  it("refuses a missing saved settings singleton when active revision proves one existed", async () => {
  const controllerLock=await runtimeLifetimeLock();
    const repoRoot = await readyRoot(controllerLock);
    copyRuntimePackageFixture(repoRoot);
    const stateRoot = profileStateRoot(repoRoot);
    mkdirSync(stateRoot, { recursive: true });
    const path = join(stateRoot, "state.db");
    const initial = await composeDashboardRuntime({ lifetimeLock: controllerLock, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {}, repoRoot });
    await initial.stop();
    restartSelectedProfile(repoRoot);
    const raw = new DatabaseSync(path);
    try {
      raw.exec("DELETE FROM settings");
    } finally {
      raw.close();
    }

    await assert.rejects(composeDashboardRuntime({ lifetimeLock: controllerLock,
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      repoRoot,
    }), /settings-current-missing-with-history/u);
    await assertRuntimeLifetimeHeld(controllerLock);
  });

  it("serves a virgin public shell without flat authority, then creates one genuinely coupled selected profile", async () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "public-virgin-root-")));
    copyRuntimePackageFixture(repoRoot);
    const controllerLock = await runtimeLifetimeLock();
    const machine = acquireEntrypointAdmission(repoRoot, "exclusive", controllerLock);
    mkdirSync(join(repoRoot, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
    let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
    try {
      vi.mocked(readFileSync).mockClear();
      application = await composeDashboardApplication({ lifetimeLock: controllerLock, admission: machine, isolation: rebuildRuntimeIsolation,
        repoRoot, backendPortOverride: 0, frontendPortOverride: 0, env: {}, onboardingDuo: syntheticOnboardingDuo(() => "fixture@ucsd.edu") });
      assert.equal(existsSync(join(machine.stateRoot, "state.db")), false);
      assert.equal(machine.readProfileRegistry().profiles.length, 0);
      assert.equal(vi.mocked(readFileSync).mock.calls.filter(([path]) => typeof path === "string" && path.includes("/credentials/")).length, 0);
      const origin = `http://127.0.0.1:${String(application.port)}`;
      const response = await fetch(`${origin}/api/v1/profile/sign-up`, { method: "POST", headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "disposable-fixture-password" }) });
      const draft = PublicProfileStateSchema.parse(await response.json()); assert.equal(draft.state, "onboarding");
      if (draft.state !== "onboarding") throw new Error("actual onboarding required");
      let cookie = response.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
      const onboarding = async (path: string, body: unknown) => {
        assert.ok(cookie);
        const result = await fetch(`${origin}/api/v1/profile/onboarding/${path}`, { method: "POST",
          headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
        assert.equal(result.status, 200);
        cookie = result.headers.get("set-cookie")?.split(";", 1)[0] ?? cookie;
        return PublicProfileStateSchema.parse(await result.json());
      };
      for (const method of ["key", "touch"] as const) {
        const started = await onboarding("duo/start", { operationId: draft.operationId, method });
        assert.equal(started.state, "onboarding");
        if (started.state !== "onboarding") throw new Error("onboarding method did not start");
        const attemptId = started.methods[method].attemptId; assert.ok(attemptId);
        const confirmed = await onboarding("duo/confirm", { operationId: draft.operationId, method, attemptId, operatorConfirmed: true });
        assert.equal(confirmed.state, "onboarding");
      }
      const active = await onboarding("complete", { operationId: draft.operationId }); assert.equal(active.state, "active");
      if (active.state !== "active") throw new Error("actual signup required");
      assert.equal(machine.readProfileRegistry().profiles.length, 1);
      assert.equal(existsSync(join(machine.stateRoot, "profiles", active.profileId, "state.db")), true);
      assert.equal(existsSync(join(machine.stateRoot, "state.db")), false);
      assert.ok(cookie);
      assert.equal((await fetch(`${origin}/api/v1/bootstrap`, { headers: { cookie } })).status, 200);
    } finally { await application?.stop(); machine.release(); rmSync(repoRoot, { recursive: true, force: true }); }
  });

  it("refuses an established selected profile with no authority database under the held controller", async () => {
  const controllerLock=await runtimeLifetimeLock();
    const repoRoot = await readyRoot(controllerLock);
    copyRuntimePackageFixture(repoRoot);
    const stateRoot = profileStateRoot(repoRoot);
    mkdirSync(stateRoot, { recursive: true });
    rmSync(join(stateRoot, "state.db"));
    const evidencePath = join(stateRoot, "retained-evidence");
    writeFileSync(evidencePath, "evidence", { mode: 0o600 });
    const planted = statSync(evidencePath), evidenceBytes = readFileSync(evidencePath);
    const before = storageTree(stateRoot);

    await assert.rejects(composeDashboardRuntime({ lifetimeLock: controllerLock,
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      repoRoot,
    }), /profile-database-binding-required/u);

    await assertRuntimeLifetimeHeld(controllerLock);
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
  const controllerLock=await runtimeLifetimeLock();
    const repoRoot = await readyRoot(controllerLock), stateRoot = profileStateRoot(repoRoot);
    assert.equal(existsSync(join(stateRoot, "credentials", "protected.json")), true);
    rmSync(join(stateRoot, "state.db"));
    const before = storageTree(stateRoot);
    await assert.rejects(composeDashboardRuntime({ lifetimeLock: controllerLock, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {}, repoRoot }),
      error => error instanceof Error && error.message === "profile-database-binding-required");
    await assertRuntimeLifetimeHeld(controllerLock);
    assert.equal(existsSync(join(stateRoot, "state.db")), false);
    assert.deepEqual(storageTree(stateRoot), before);
  });

  it("refuses the missing database beside an unowned legacy settings directory without repairing either half", async () => {
  const controllerLock=await runtimeLifetimeLock();
    const repoRoot = await readyRoot(controllerLock), stateRoot = profileStateRoot(repoRoot);
    const selected = readyProfiles.get(repoRoot)?.selected; assert.ok(selected);
    rmSync(join(stateRoot, "state.db"));
    const legacyPath = join(stateRoot, "settings");
    mkdirSync(legacyPath, { mode: 0o700 });
    const planted = statSync(legacyPath), before = storageTree(stateRoot);
    await assert.rejects(composeDashboardRuntime({ lifetimeLock: controllerLock, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {}, repoRoot }),
      error => error instanceof Error && error.message === "profile-database-binding-required");
    await assertRuntimeLifetimeHeld(controllerLock);
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
    const controllerLock = await runtimeLifetimeLock();
    const repoRoot = await readyRoot(controllerLock), stateRoot = profileStateRoot(repoRoot);
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

  it("refuses a newer authority under the current build before settings opens or config resolution", async () => {
  const controllerLock=await runtimeLifetimeLock();
    const repoRoot = await readyRoot(controllerLock);
    copyRuntimePackageFixture(repoRoot);
    const stateRoot = profileStateRoot(repoRoot);
    const artifactRoot = join(profileStateRoot(repoRoot), "artifacts");
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
        await assert.rejects(composeCurrentBuild({ lifetimeLock: controllerLock, admission, profile: { runtime: selected.runtime, token: selected.token },
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
        assert.deepEqual(readFileSync(path), before);
      } finally {
        resolveSpy.mockRestore();
      }
    }
  });

  it.each([29, CURRENT_AUTHORITY_SCHEMA_VERSION + 1])("refuses unsupported selected-profile authority %s before acquiring a server process record", async version => {
    const controllerLock = await runtimeLifetimeLock();
    const repoRoot = await readyRoot(controllerLock);
    copyRuntimePackageFixture(repoRoot);
    const path = join(profileStateRoot(repoRoot), "state.db");
    openFixtureDatabase({ path, busyTimeoutMs: 250, migrationOwner: "unsupported-schema-fixture" }).close();
    const raw = new DatabaseSync(path);
    try { raw.exec(`UPDATE database_states SET schema_version=${String(version)} WHERE id=1; PRAGMA user_version=${String(version)}`); } finally { raw.close(); }
    const before = readFileSync(path);
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    await assert.rejects(composeDashboardRuntime({ lifetimeLock: controllerLock, isolation: rebuildRuntimeIsolation, env: {}, repoRoot, clock }),
      error => error instanceof AuthoritySchemaVersionError && error.code === "authority-schema-mismatch" && error.schemaVersion === version);
    await assertRuntimeLifetimeHeld(controllerLock);
    assert.deepEqual(readFileSync(path), before);
    const unchanged = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(Reflect.get(unchanged.prepare("PRAGMA user_version").get() ?? {}, "user_version"), version); } finally { unchanged.close(); }
  });

  it("serves the exact editable settings command schema hash", async () => {
    const controllerLock = await runtimeLifetimeLock();
    const repoRoot = await readyRoot(controllerLock);
    copyRuntimePackageFixture(repoRoot);
    const runtime = await composeDashboardRuntime({ lifetimeLock: controllerLock,
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
    const controllerLock = await runtimeLifetimeLock();
    const repoRoot = await readyRoot(controllerLock);
    copyRuntimePackageFixture(repoRoot);
    const authorityPath = join(profileStateRoot(repoRoot), "state.db");
    mkdirSync(dirname(authorityPath), { recursive: true });
    openFixtureDatabase({ path: authorityPath, busyTimeoutMs: 250, migrationOwner: "retired-settings-fixture" }).close();
    const path = join(repoRoot, ".tracker", "settings", "settings.json");
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "retired malformed file");
    const runtime = await composeDashboardRuntime({ lifetimeLock: controllerLock, isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {}, repoRoot });
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
      const admission = owner.machine.admitProfile(signedIn.profileId);
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
        const runtime = await composeDashboardRuntime({ lifetimeLock: owner.lifetime,
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
