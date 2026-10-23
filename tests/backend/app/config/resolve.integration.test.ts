import type { CredentialStore } from "../../../../src/models/config/credential-store.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { AuthorityDatabase as NativeAuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createCredentialStore as createOwnedCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import assert from "node:assert/strict";
import { describe, it, vi, onTestFinished } from "vitest";
import { ConfigProvenanceSchema, configLeafPaths, resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { defaultRuntimePaths } from "../../../../src/backend/app/config/runtime-paths.js";
import { MIGRATED_SETTINGS_ENVIRONMENT_KEYS } from "../../../../src/models/config/catalog.js";
import { assertNotPast, requireAnnualDates } from "../../../../src/models/config/fiscal-year.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { resolveInstances, resolveSystemEntryUrl } from "../../../../src/models/config/instance.js";
import { ConfigSchema, SettingsOverrideSchema } from "../../../../src/models/config/schema.js";
import { SettingsPatchSchema, derivePersistedSettingsFingerprint, mergeSettingsPatch, SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { composeDashboardRuntime } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { EditableSettingsWireSchema } from "../../../../src/models/dashboard/settings-editor.js";
import { SettingsFactsWireSchema } from "../../../../src/models/dashboard/settings.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { createBoundProfileFixture, AuthorityDatabase, createCredentialStore } from "../../../support/helpers/admission-fixture.js";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { settingsSetOperations } from "../../../support/fixtures/settings-operation-fixtures.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { EXECUTOR_WORKER_ID, ManualScheduler, happySessionHarness, recordingLogger, recordingTimelineEmitter } from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { requireSecretFile } from "../../../../src/models/config/secrets.js";

{
const CLOCK = manualClock(new Date("2026-08-10T12:00:00-07:00"));
describe("strict config resolution", () => {
  it("makes empty settings exactly equal schema defaults", () => {
    assert.deepEqual(resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config, ConfigSchema.parse({ paths: defaultRuntimePaths() }));
    assert.equal(resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config.timeouts.ukgNavigationMs, 60_000);
    assert.equal(ConfigSchema.safeParse({ unexpected: true }).success, false);
    assert.equal(ConfigSchema.safeParse({ urls: { unexpected: true } }).success, false);
    assert.equal(SettingsOverrideSchema.safeParse({ urls: { ucpath: { test: { typo: "https://example.test" } } } }).success, false);
    assert.equal(SettingsOverrideSchema.safeParse({ actor: { id: "someone-else" } }).success, false);
    assert.equal(ConfigSchema.safeParse({ actor: { id: "someone-else", label: "Other" } }).success, false);
  });

  it("resolves an admitted storage pair without changing ordinary settings or an older snapshot", () => {
    const settings = { paths: { browserProfileRoot: "/tmp/profile" }, browser: { headless: false } };
    const ordinaryFingerprint = derivePersistedSettingsFingerprint(settings);
    const oldSnapshot = resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK);
    const oldConfig = structuredClone(oldSnapshot.config);
    const pair = { stateRoot: "/tmp/relocated-state", artifactRoot: "/tmp/relocated-state/artifacts" };
    const moved = resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK, pair);

    assert.equal(moved.config.paths.stateRoot, pair.stateRoot);
    assert.equal(moved.config.paths.artifactRoot, pair.artifactRoot);
    assert.equal(moved.config.paths.browserProfileRoot, "/tmp/profile");
    assert.equal(moved.config.paths.duoCredential, "/tmp/relocated-state/credentials/duo-webauthn.json");
    assert.equal(moved.provenance["paths.duoCredential"], "default");
    assert.equal(moved.provenance["paths.stateRoot"], "default");
    assert.equal(moved.provenance["paths.artifactRoot"], "default");
    assert.equal(moved.provenance["paths.browserProfileRoot"], "settings");
    assert.deepEqual(Object.keys(moved.provenance).sort(), [...configLeafPaths(moved.config)].sort());
    assert.notEqual(moved.fingerprint, oldSnapshot.fingerprint);
    assert.deepEqual(oldSnapshot.config, oldConfig);
    assert.equal(derivePersistedSettingsFingerprint(settings), ordinaryFingerprint);
    assert.deepEqual(resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK), oldSnapshot);
    assert.deepEqual(resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK, pair), moved);
  });

  it("refuses noncanonical or overlapping admitted storage pairs", () => {
    const valid = { stateRoot: "/tmp/state", artifactRoot: "/tmp/state/artifacts" };
    for (const pair of [
      { ...valid, stateRoot: "relative/state" },
      { ...valid, stateRoot: "/tmp/state/../state" },
      { ...valid, artifactRoot: "/tmp//state/artifacts" },
      { ...valid, artifactRoot: "/tmp/state" },
      { ...valid, artifactRoot: "/tmp" },
      { ...valid, extra: "unexpected" },
    ]) {
      assert.throws(() => resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK, pair), (error) => error instanceof Error, JSON.stringify(pair));
    }
    assert.equal(resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK, valid).config.paths.artifactRoot,
      valid.artifactRoot);
  });

  it("accepts complete production route edits and rejects retired test routes", () => {
    const defaults = resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config;
    const crm = { ...defaults.urls.crm.prod, entry: "https://crm.example.test/hr" };
    const patch = { "urls.crm.prod": { set: crm } };
    assert.equal(SettingsPatchSchema.safeParse(patch).success, true);
    const saved = mergeSettingsPatch({}, patch);
    assert.equal(resolveConfigWithProvenance(saved, hostConfigFacts({}), CLOCK).config.urls.crm.prod.entry, crm.entry);
    assert.equal(SettingsPatchSchema.safeParse({ "urls.crm.prod": { set: { entry: crm.entry } } }).success, false);
    assert.equal(SettingsPatchSchema.safeParse({ "urls.crm.test": { set: { entry: crm.entry } } }).success, true);
    assert.throws(() => mergeSettingsPatch({}, { "urls.crm.test": { set: { entry: crm.entry } } }), /retired test routes/u);
  });

  it("applies settings over defaults with complete value-free provenance", () => {
    const settings = {
      ocr: { secondOpinionMax: 7 },
      timeouts: { ukgNavigationMs: 75_000 },
      urls: { ucpath: { prod: { login: "https://login.example.test", smartHr: "https://settings-ucpath.example.test", jobSummary: "https://jobs.example.test", personalData: "https://personal.example.test", personProfile: "https://profile.example.test" } } },
    };
    const resolved = resolveConfigWithProvenance(settings, hostConfigFacts({}), CLOCK);
    assert.equal(resolved.config.ocr.secondOpinionMax, 7);
    assert.equal(resolved.config.urls.ucpath.prod.smartHr, "https://settings-ucpath.example.test");
    assert.equal(resolved.config.timeouts.ukgNavigationMs, 75_000);
    assert.equal(resolved.provenance["ocr.secondOpinionMax"], "settings");
    assert.equal(resolved.provenance["timeouts.ukgNavigationMs"], "settings");
    assert.equal(resolved.provenance["timeouts.taskMs"], "default");
    assert.equal(Object.hasOwn(resolved.config, "operator"), false);
    assert.deepEqual(Object.keys(resolved.provenance).sort(), [...configLeafPaths(resolved.config)].sort());
    assert.equal(Object.values(resolved.provenance).every((source) => source === "settings" || source === "default"), true);
    assert.match(resolved.fingerprint, /^[0-9a-f]{64}$/u);
  });

  it("applies the browser settings group instead of accepting and dropping it", () => {
    const resolved = resolveConfigWithProvenance({
      browser: { headless: false, closeProofMs: 25_000 },
    }, hostConfigFacts({}), CLOCK);

    assert.deepEqual(resolved.config.browser, { headless: false, closeProofMs: 25_000 });
    assert.equal(resolved.provenance["browser.headless"], "settings");
    assert.equal(resolved.provenance["browser.closeProofMs"], "settings");
  });

  it("rejects malformed ordinary values, missing job-end dates and half-display overrides", () => {
    assert.throws(() => resolveConfigWithProvenance({ ocr: { pageConcurrency: "auto" } }, hostConfigFacts({}), CLOCK));
    const jobEndOnly = resolveConfigWithProvenance({ annualDates: { FY2027: { jobEndDate: "06/30/2027" } } }, hostConfigFacts({}), CLOCK).config;
    assert.equal(jobEndOnly.annualDates.FY2027?.jobEndDate, "06/30/2027");
    assert.equal(jobEndOnly.annualDates.FY2027?.kronosDefaultStartDate, undefined);
    assert.equal(jobEndOnly.annualDates.FY2027?.kronosDefaultEndDate, undefined);
    assert.throws(() => resolveConfigWithProvenance({ annualDates: { FY2027: { kronosDefaultEndDate: "06/30/2027" } } }, hostConfigFacts({}), CLOCK));
    assert.throws(() => resolveConfigWithProvenance({ display: { screenWidth: 1920 } }, hostConfigFacts({}), CLOCK));
    assert.throws(() => resolveConfigWithProvenance({ display: { screenHeight: 1080 } }, hostConfigFacts({}), CLOCK));
    const config = resolveConfigWithProvenance({ annualDates: { FY2027: {
      jobEndDate: "06/30/2027", kronosDefaultEndDate: "2/1/2027", kronosDefaultStartDate: "1/1/2017",
    } } }, hostConfigFacts({}), CLOCK).config;
    assert.equal(config.annualDates.FY2027?.jobEndDate, "06/30/2027");
  });

  it("refuses restored environment provenance in resolved settings", () => {
    assert.equal(ConfigProvenanceSchema.safeParse("env").success, false);
    assert.deepEqual(ConfigProvenanceSchema.options, ["settings", "default"]);
  });

  it("ignores every migrated process environment key and rejects the old resolver signature", () => {
    const settings = { concurrency: { defaultWorkers: 2 } };
    const facts = hostConfigFacts({});
    const before = resolveConfigWithProvenance(settings, facts, CLOCK);
    assert.equal(MIGRATED_SETTINGS_ENVIRONMENT_KEYS.length, 40);
    try {
      for (const key of MIGRATED_SETTINGS_ENVIRONMENT_KEYS) vi.stubEnv(key, "hostile-migrated-value");
      assert.deepEqual(resolveConfigWithProvenance(settings, facts, CLOCK), before);
      assert.throws(() => {
        // @ts-expect-error A4: an environment object is no longer the resolver's second input.
        resolveConfigWithProvenance({}, {}, CLOCK);
      }, /primaryDisplay/u);
    } finally {
      vi.unstubAllEnvs();
    }
  });

});

describe("instance and fiscal safety", () => {
  it("defaults declared systems to production and refuses retired test targets", () => {
    const config = resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config;
    assert.deepEqual(resolveInstances(config, ["ucpath", "crm"], undefined, "run-1"), { ucpath: "prod", crm: "prod" });
    assert.throws(() => resolveInstances(config, ["ucpath"], { ucpath: "test" }, "run-1"), /retired test instance/u);
    assert.throws(() => resolveSystemEntryUrl(config, "ucpath", "test", "run-1"), /retired test instance/u);
    assert.equal(resolveSystemEntryUrl(config, "ucpath", "prod", "run-1"), config.urls.ucpath.prod.smartHr);
  });

  it("fails on missing and stale current-fiscal-year values", () => {
    const defaults = resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config;
    assert.throws(() => requireAnnualDates(defaults, CLOCK), /FY2027/);
    const jobEndOnly = resolveConfigWithProvenance({
      annualDates: { FY2027: { jobEndDate: "06/30/2027" } },
    }, hostConfigFacts({}), CLOCK).config;
    assert.deepEqual(requireAnnualDates(jobEndOnly, CLOCK), { jobEndDate: "06/30/2027" });
    const stale = resolveConfigWithProvenance({
      annualDates: { FY2027: {
        jobEndDate: "06/30/2026",
        kronosDefaultEndDate: "2/1/2027",
        kronosDefaultStartDate: "1/1/2017",
      } },
    }, hostConfigFacts({}), CLOCK).config;
    assert.throws(() => requireAnnualDates(stale, CLOCK), /stale/);
    assert.throws(() => assertNotPast("02/30/2027", "badDate", CLOCK), /valid calendar date/);
  });
});
}

{
const profiles: ReturnType<typeof createBoundProfileFixture>[] = [];
const openDatabases: AuthorityDatabase[] = [];

const cleanupOriginalFixture = () => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) profile.close();
};

const NOW = "2026-08-03T09:00:00.000Z";

function repoRootWithState() {
  const profile = createBoundProfileFixture(); profiles.push(profile);
  const repoRoot = profile.workspace;
  const stateRoot = profile.stateRoot;
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "worker-composition-fixture", version: "0.1.0", type: "module" }));
  return { repoRoot, stateRoot, admission: profile.admission, profile };
}

function reopen(admission: RuntimeAdmission, credentials: CredentialStore, clock: TestClock): AuthorityDatabase {
  const database = NativeAuthorityDatabase.open(admission,
    { path: join(admission.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock, undefined, undefined, undefined, credentials,
  );
  openDatabases.push(database);
  return database;
}

function persistUnjournaledWorkerSettings(repoRoot: string, clock: TestClock, patch: unknown) {
  patch = settingsSetOperations(patch);
  const patchFingerprint = deriveSettingsPatchFingerprint(patch);
  const command = {
    commandId: "33333333-3333-4333-8333-333333333333",
    requestedAt: "2026-08-28T12:00:00.000Z",
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-settings",
    target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint, patch },
  };
  void repoRoot; void clock;
  return Object.freeze({ command, settingsFingerprint: derivePersistedSettingsFingerprint({ browser: { headless: false } }) });
}

function journalWorkerSettings(
  database: AuthorityDatabase,
  persisted: ReturnType<typeof persistUnjournaledWorkerSettings>,
  admission: RuntimeAdmission,
  credentials: CredentialStore,
): void {
  const stateRoot = admission.stateRoot;
  const clock = manualClock(new Date(NOW));
  if (database.authority.runtimeConfig.get() === undefined) {
    const resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), clock, {
      stateRoot, artifactRoot: admission.artifactRoot,
    });
    database.authority.runtimeConfig.initialize({ configSnapshotId: randomUUID(), revision: 1,
      fingerprint: resolved.fingerprint, capturedAt: clock.now().toISOString(),
      capturedBy: "local-operator", config: resolved.config, provenance: resolved.provenance });
  }
  const result = executeSettingsCommand({ authority: database, clock, ids: sequentialIdFactory("4"),
    settings: createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value, hostConfigFacts({}), clock, { stateRoot, artifactRoot: admission.artifactRoot }), credentials) }, persisted.command);
  assert.equal(result.state, "applied");
}

it("F composed dashboard reads active settings after boot through real HTTP", async () => {
const acquired: { profile?: ReturnType<typeof composeProfileRuntime>; admission?: RuntimeAdmission } = {};
 onTestFinished(async () => { await acquired.profile?.close(); acquired.admission?.release(); cleanupOriginalFixture(); });

 const { repoRoot, stateRoot, profile: owner } = repoRootWithState();
 const clock = manualClock(new Date(NOW));
 for (const name of ["package.json", "package-lock.json"])
  writeFileSync(join(repoRoot, name), readFileSync(join(process.cwd(), name)));
 const profile = composeProfileRuntime({ admission: owner.machine, clock, hostFacts: { primaryDisplay: null },
   processLockRoot: join(repoRoot, rebuildRuntimeIsolation.processLockRoot) });
 acquired.profile = profile;
 const active = profile.session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
 assert.equal(active.state, 'active');
 if (active.state !== 'active') throw new Error('config fixture sign-in refused');
 const currentAdmission = owner.machine.admitProfile(createProfileRegistry(owner.machine).storageClaim(active.profileId));
 acquired.admission = currentAdmission;
 const credentials = createOwnedCredentialStore({ admission: currentAdmission, stateRoot,
   erasureJournalAdmission: owner.machine,
   erasureJournalPath: join(owner.machine.stateRoot, 'machine', 'erasures', `${active.profileId}.json`) });
 const dashboard = await composeDashboardRuntime({ admission: owner.machine, profile: { runtime: profile, token: active.token },
   isolation: rebuildRuntimeIsolation, repoRoot, env: {}, clock, backendPortOverride: 0, frontendPortOverride: 0 });
 try {
  const database = reopen(currentAdmission, credentials, clock);
  const before = database.authority.runtimeConfig.get();
  assert.ok(before !== undefined);
  const snapshot = database.authority.configSnapshots.get(before.configSnapshotId);
  assert.ok(snapshot !== undefined);
  const settings = persistUnjournaledWorkerSettings(repoRoot, clock, { display: { screenWidth: 1980, screenHeight: 1080 } });
  journalWorkerSettings(database, settings, currentAdmission, credentials);
  const record = readSettings(database.authority);
  const resolved = resolveConfigWithProvenance(record.settings, hostConfigFacts({}), clock, { stateRoot, artifactRoot: currentAdmission.artifactRoot });
  database.authority.configSnapshots.insert({ configSnapshotId: UUID_7, revision: 1,
   fingerprint: resolved.fingerprint, config: resolved.config, provenance: resolved.provenance,
   capturedAt: NOW, capturedBy: "local-operator" });
  database.authority.runtimeConfig.activate({ settingsRevision: record.revision, settingsFingerprint: record.settingsFingerprint,
   configSnapshotId: UUID_7, configFingerprint: resolved.fingerprint, activatedAt: NOW });
  const response = await fetch(`http://127.0.0.1:${String(dashboard.port)}/api/v1/settings/editable`);
  assert.equal(response.status, 200);
  const editor = EditableSettingsWireSchema.parse(await response.json());
  assert.equal(editor.runtimeStatus.state, "current");
  assert.equal(editor.revision, record.revision);
  // Facts must follow the active snapshot as well; a synthetic endpoint is never contacted.
  const config = structuredClone(resolved.config);
  config.urls.crm.prod.entry = "https://synthetic.example.invalid/";
  const nextId = "83000000-0000-4000-8000-000000000098";
  const fingerprint = sha256Hex(canonicalJsonStringify(config));
  database.authority.configSnapshots.insert({ ...snapshot, configSnapshotId: nextId, config, fingerprint });
  database.authority.runtimeConfig.activate({ settingsRevision: record.revision, settingsFingerprint: record.settingsFingerprint,
   configSnapshotId: nextId, configFingerprint: fingerprint, activatedAt: NOW });
  const factsResponse = await fetch(`http://127.0.0.1:${String(dashboard.port)}/api/v1/settings/facts`);
  assert.equal(factsResponse.status, 200);
  const facts = SettingsFactsWireSchema.parse(await factsResponse.json());
  assert.equal(facts.systemHosts.find(entry => entry.system === "crm")?.production, "https://synthetic.example.invalid/");
 } finally {
   for (const database of openDatabases.splice(0)) database.close();
   await dashboard.stop();
 }
});
}

{
const cleanups: (() => void)[] = [];
const cleanupOriginalFixture = () => { for (const close of cleanups.splice(0).reverse()) close(); vi.restoreAllMocks(); };
function fixture(isolateBrowser = false) { const f = settingsFixture(isolateBrowser); cleanups.push(f.close); return f; }

it("saved idle cadence applies at the next boundary without retiming the pending wait", async () => {
onTestFinished(cleanupOriginalFixture);

  const f = fixture();
  const scheduler = new ManualScheduler(f.clock, 0);
  const stop = new AbortController();
  const sessions = happySessionHarness();
  const cadence = () => resolveConfigWithProvenance(readSettings(f.database.authority).settings, f.host, f.clock).config.daemon.idleRepollMs;
  const initial = cadence();
  const looping = runWorkerLoop({ ...testWorkerPorts(f.database, f.clock, { path: f.path, descriptor: personLookupDescriptor, poolIndex: 1 }),
    workflowId: WorkflowIdSchema.parse("person-lookup"), workerId: EXECUTOR_WORKER_ID,
    descriptor: personLookupDescriptor, stores: taskStoreRegistry, authority: f.database,
    sessionFactory: sessions.factory, emitter: recordingTimelineEmitter(f.database, f.clock).emitter,
    clock: f.clock, ids: { uuid: randomUUID }, scheduler, taskDeadlineMs: 60_000, sessionAcquireMs: 20_000,
    duoCeremony: fixtureDuoCeremonyGates(f.clock), heartbeatIntervalMs: 500, idleRepollMs: initial,
    idleCadence: cadence, log: recordingLogger().log, stopSignal: stop.signal, exitWhenIdle: false,
    controlPoll: () => "pause",
  });
  try {
    // Worker admission settles asynchronously before its first scheduled wait.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const first = scheduler.pending()[0]; assert.ok(first);
    assert.equal(first.deadlineMonotonicMs, f.clock.monotonicMs() + initial);
    assert.equal(f.save({ "daemon.idleRepollMs": { set: initial + 1_000 } }).state, "applied");
    assert.equal(scheduler.pending().length, 1);
    assert.equal(scheduler.pending()[0]?.deadlineMonotonicMs, first.deadlineMonotonicMs);
    first.fire();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(scheduler.pending()[0]?.deadlineMonotonicMs, f.clock.monotonicMs() + initial + 1_000);
    assert.equal(sessions.opens(), 0);
  } finally { stop.abort(); await looping; }
});
}

{
describe("closed secret access", () => {

  it("does not accept an arbitrary secret-file path", () => {

    const resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(new Date("2026-08-10T12:00:00-07:00"))).config;
    const config = {
      ...resolved,
      paths: { ...resolved.paths, duoCredential: "/nonexistent-rebuild-secret-root/duo-webauthn.json" },
    };
    assert.equal(requireSecretFile.length, 2);
    assert.throws(() => requireSecretFile("duoWebauthnCredential", config), /registered rebuild credential path/);
  });
});
}
