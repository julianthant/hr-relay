import { createDashboardChildTestWorld } from "../../../../support/helpers/backend/dashboard-child-world.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { createDashboardPortTestWorld } from "../../../../support/helpers/backend/dashboard-port-world.js";
import { hostConfigFacts } from "../../../../../src/models/config/host-display.js";
import { randomUUID } from "node:crypto";
import { releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, it, vi } from "vitest";
import { productionWorkerLaunch } from "../../../../../src/backend/app/composition/dashboard/compose.js";

import { resolveConfigWithProvenance } from "../../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";

import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../../src/models/config/protected-settings.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
import { ProtectedSettingsCommandRequestSchema, SettingsCommandRequestSchema, WorkerBrowserCommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import { manualClock, systemClock } from "../../../../../src/rules/time/clock.js";
import { settingsSetOperations } from "../../../../support/fixtures/settings-operation-fixtures.js";
import { scaledMs } from "../../../../support/time-scale.js";

const { cleanups, composeDashboardRuntime, readRuntimeSettingsRevision, readPersistedSettings, createProfileFixture, cleanup } = createDashboardPortTestWorld(() => {
      vi.mocked(fsyncSync).mockReset();
      vi.mocked(readFileSync).mockReset();
      vi.mocked(openSync).mockReset();
      vi.mocked(mkdirSync).mockReset();
      vi.restoreAllMocks();
    }, () => releaseAdmissionFixtures());


function settingsCommand(
  commandId: string,
  requestedAt: string,
  expectedRevision: number,
  patch: unknown,
) {
  patch = settingsSetOperations(patch);
  return SettingsCommandRequestSchema.parse({
    commandId,
    requestedAt,
    requestedBy: "local-operator",
    source: "dashboard",
    family: "settings",
    type: "apply-settings",
    target: { expectedRevision },
    payload: {
      settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(patch),
      patch,
    },
  });
}

function protectedUcpathSettingsCommand(
  commandId: string,
  requestedAt: string,
  expectedRevision: number,
  writeId: string,
) {
  return ProtectedSettingsCommandRequestSchema.parse({
    commandId,
    requestedAt,
    requestedBy: "local-operator",
    source: "settings-surface",
    family: "settings",
    type: "apply-protected-settings",
    target: { expectedRevision },
    payload: {
      protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId,
      entries: {
        ucpathUserId: { set: "fixture@ucsd.edu" },
        ucpathPassword: { set: "disposable-fixture-password" },
      },
    },
  });
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

  it("launches pool workers through the secure bootstrap's cli arm, never the inert src/cli.ts module", () => {

    const launch = productionWorkerLaunch("/repo");
    assert.equal(launch.command, process.execPath);
    assert.deepEqual([...launch.prefixArgs], ["--import", "tsx", "/repo/scripts/dev/secure-env-bootstrap.ts", "cli"]);
    assert.equal(launch.cwd, "/repo");
    assert.ok(!launch.prefixArgs.some((arg) => arg.endsWith(join("src", "cli.ts"))));
  });

  it("launch carries only process mechanics and host display, never provider or arbitrary values", () => {
    const hostile = new Proxy<NodeJS.ProcessEnv>({
      PATH: "/synthetic/bin", HOME: "/synthetic/home", HRAUTO_HOST_PRIMARY_DISPLAY: "1920x1080",
      GEMINI_API_KEY: "synthetic-provider-private", NODE_OPTIONS: "synthetic-injection", UNREGISTERED: "synthetic-private",
    }, { get(target, key, receiver) {
      if (key === "GEMINI_API_KEY" || key === "NODE_OPTIONS" || key === "UNREGISTERED") {
        throw new Error("forbidden environment value read");
      }
      return Reflect.get(target, key, receiver) as string | undefined;
    } });
    assert.deepEqual(productionWorkerLaunch("/repo", hostile).environment, {
      PATH: "/synthetic/bin", HOME: "/synthetic/home", HRAUTO_HOST_PRIMARY_DISPLAY: "1920x1080",
    });
    assert.throws(() => productionWorkerLaunch("/repo", { UCPATH_PASSWORD: "synthetic-private" }),
      /migrated environment key UCPATH_PASSWORD is refused/u);
  });

  it("publishes a lease-only worker card from the real tail tick, before any span exists", async () => {
    const clock = systemClock;
    const profile = await createProfileFixture(clock);
    const repoRoot = profile.workspace;
    const lifetimeLock = profile.lifetime;
    const children = createDashboardChildTestWorld(() => {}, () => {});
    const records: Parameters<typeof children.realStubSpawner>[0] = [];
    const runtime = await composeDashboardRuntime({ lifetimeLock,
      frontendPortOverride: 0, preflightRunnerFactory: healthyRuntimePreflightRunners,
      workerProcess: { launch: children.stubLaunch(join(profile.stateRoot, "state.db"),
        join(repoRoot, rebuildRuntimeIsolation.processLockRoot), "installed", process.execPath, lifetimeLock),
        spawn: children.realStubSpawner(records, lifetimeLock), birth: { pollMs: 25, timeoutMs: 10_000 } },
      ...profile.dashboardInput,
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock,
      repoRoot,
    });
    cleanups.push(async () => { try { await runtime.stop(); } finally { await children.cleanup(); } });

    const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
    const day = clock.todayLocal();
    const initial = await client.dashboardDay(day);
    assert.deepEqual(initial.workerCards, []);

    // Subscribe first, so the card can only arrive through a published snapshot.
    const days: (typeof initial)[] = [];
    const cardArrived = Promise.withResolvers<void>();
    const live = new Promise<void>((resolve) => {
      const subscription = client.subscribeDay({
        day,
        onDay: (received) => {
          days.push(received);
          if (received.workerCards.length === 1) cardArrived.resolve();
        },
        onState: (state) => {
          if (state.state === "live") resolve();
        },
      });
      cleanups.push(() => subscription.close());
    });
    await live;
    assert.equal(days.at(-1)?.workerCards.length, 0);

    const envelope = () => ({ commandId: randomUUID(), requestedAt: clock.now().toISOString(),
      requestedBy: "local-operator", source: "dashboard", family: "worker-browser" });
    const planned = await client.executeCommand(WorkerBrowserCommandRequestSchema.parse({ ...envelope(), type: "plan-worker-count",
      target: { workflowId: personLookupDescriptor.id, expectedVersion: 0 }, payload: { desiredWorkers: 1 } }));
    assert.equal(planned.state, "applied");
    const spawnCommandId = randomUUID();
    const spawning = client.executeCommand(WorkerBrowserCommandRequestSchema.parse({ ...envelope(), commandId: spawnCommandId, type: "spawn-worker",
      target: { workflowId: personLookupDescriptor.id, expectedVersion: 1 }, payload: { workerId: "person-lookup-worker-1" } }))
      .then(result => ({ result }), (error: unknown) => ({ error }));

    const outcome = await spawning;
    if ("error" in outcome) throw outcome.error;
    assert.equal(outcome.result.state, "applied");
    assert.equal(records.length, 1);
    assert.ok(records[0]?.pid !== undefined);
    const database = profile.openDatabase({ path: join(profile.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
    try {
      const started = database.authority.workerLeases.get("person-lookup-worker-1");
      assert.ok(started);
      assert.equal(started.processId, records[0].pid);
      assert.deepEqual(database.authority.timelineEvents.page({}).filter(record => record.payload.kind === "span"), []);
    } finally { database.close(); }
    const deadline = setTimeout(() => {
      cardArrived.reject(new Error(`no worker-card snapshot within 5s; snapshots seen: ${String(days.length)}`));
    }, 5_000);
    try {
      await cardArrived.promise;
    } finally {
      clearTimeout(deadline);
    }
    const card = days.at(-1)?.workerCards[0];
    assert.equal(card?.workerId, "person-lookup-worker-1");
    assert.equal(card?.state, "starting");
    assert.ok(card);
    assert.ok(card.controls);
    assert.deepEqual(card.controls.ownership, { state: "owned" });
    assert.deepEqual(card?.browserRequirements, { state: "present", systems: ["crm", "ucpath"] });
    assert.deepEqual(card?.browsers, []);
    assert.equal(records[0]?.exited, false);
  }, scaledMs(20_000));

  it("plans new runs with saved settings without a dashboard restart", async () => {
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const profile = await createProfileFixture(clock);
    const repoRoot = profile.workspace;
    const lifetimeLock = profile.lifetime;
    const runtime = await composeDashboardRuntime({ lifetimeLock,
      ...profile.dashboardInput,
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock,
      repoRoot,
    });
    cleanups.push(() => runtime.stop());
    const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
    const command = settingsCommand(
      "33333333-3333-4333-8333-333333333333",
      clock.now().toISOString(),
      1,
      { browser: { headless: false }, features: { duoWebAuthn: false } },
    );
    const applied = await client.executeCommand(command);
    assert.equal(applied.state, "applied");
    const protectedSettings = (await client.editableSettings()).protectedSettings;
    assert.equal(protectedSettings.state, "available");
    if (protectedSettings.state !== "available") throw new Error("fixture-protected-settings-unavailable");
    const protectedRevision = protectedSettings.readback.revision;
    const protectedApplied = await client.executeCommand(protectedUcpathSettingsCommand(
      "44444444-4444-4444-8444-444444444444",
      clock.now().toISOString(),
      protectedRevision,
      "44444444-4444-4444-8444-444444444445",
    ));
    assert.equal(protectedApplied.state, "applied");
    if (protectedApplied.state === "applied") assert.equal(protectedApplied.revision, protectedRevision + 1);

    const plan = await client.submitStartPlan({
      workflowId: "person-lookup", submissions: [{ emplId: "10800000" }], dryRun: true,
      browserMode: "headless", captureBrowserScreenshots: false,
    });
    assert.equal(plan.fingerprints.configFingerprint,
      resolveConfigWithProvenance(readPersistedSettings(profile, clock).settings, hostConfigFacts({}), clock, { stateRoot: profile.stateRoot, artifactRoot: profile.artifactRoot }).fingerprint);
    assert.equal(readRuntimeSettingsRevision(profile), 2);
  });

  it("activates the exact persisted settings generation after a dashboard restart", async () => {
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const profile = await createProfileFixture(clock);
    const repoRoot = profile.workspace;
    let runtime = await composeDashboardRuntime({ lifetimeLock: profile.lifetime,
      ...profile.dashboardInput,
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock,
      repoRoot,
    });
    cleanups.push(() => runtime.stop());
    const firstClient = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
    const command = settingsCommand(
      "33333333-3333-4333-8333-333333333333",
      clock.now().toISOString(),
      1,
      { browser: { headless: false }, features: { duoWebAuthn: false } },
    );
    const applied = await firstClient.executeCommand(command);
    const persisted = readPersistedSettings(profile, clock);
    assert.deepEqual(applied, {
      state: "applied",
      commandId: command.commandId,
      affectedTargets: [{ family: "settings", revision: 2 }],
      restartRequired: false,
      settingsRevision: 2,
      settingsFingerprint: persisted.settingsFingerprint,
    });
    const protectedSettings = (await firstClient.editableSettings()).protectedSettings;
    assert.equal(protectedSettings.state, "available");
    if (protectedSettings.state !== "available") throw new Error("fixture-protected-settings-unavailable");
    const protectedRevision = protectedSettings.readback.revision;
    const protectedApplied = await firstClient.executeCommand(protectedUcpathSettingsCommand(
      "44444444-4444-4444-8444-444444444444",
      clock.now().toISOString(),
      protectedRevision,
      "44444444-4444-4444-8444-444444444445",
    ));
    assert.equal(protectedApplied.state, "applied");
    if (protectedApplied.state === "applied") assert.equal(protectedApplied.revision, protectedRevision + 1);

    await runtime.stop();
    await profile.restart();
    runtime = await composeDashboardRuntime({ lifetimeLock: profile.lifetime,
      ...profile.dashboardInput,
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock,
      repoRoot,
    });
    const restartedClient = createDashboardClient({
      baseUrl: `http://127.0.0.1:${String(runtime.port)}`,
    });
    const plan = await restartedClient.submitStartPlan({
      workflowId: "person-lookup",
      submissions: [{ emplId: "10800000" }],
      dryRun: false,
      browserMode: "headed",
      captureBrowserScreenshots: false,
    });

    assert.equal(plan.workflowId, "person-lookup");
    assert.equal(
      plan.fingerprints.configFingerprint,
      resolveConfigWithProvenance(persisted.settings, hostConfigFacts({}), clock, { stateRoot: profile.stateRoot, artifactRoot: profile.artifactRoot }).fingerprint,
      "the restarted plan must bind the config resolved from the exact persisted settings generation",
    );
    assert.equal(plan.planned.length, 1);
    assert.deepEqual(plan.refused, []);
  });
});
