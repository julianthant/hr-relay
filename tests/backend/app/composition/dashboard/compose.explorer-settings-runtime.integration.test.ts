import { createDashboardChildTestWorld } from "../../../../support/helpers/backend/dashboard-child-world.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { createDashboardPortTestWorld } from "../../../../support/helpers/backend/dashboard-port-world.js";
import { hostConfigFacts } from "../../../../../src/models/config/host-display.js";
import { randomUUID } from "node:crypto";
import { releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, vi } from "vitest";
import { productionWorkerLaunch } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import * as explorerComposition from "../../../../../src/backend/app/composition/dashboard/explorer.js";
import { resolveConfigWithProvenance } from "../../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { DESCRIPTORS } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../../src/models/config/protected-settings.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
import { explorerEditCommandFingerprint } from "../../../../../src/models/dashboard/explorer-override.js";
import { ExplorerEditApplyRequestSchema, ExplorerWorkflowOverrideSchema } from "../../../../../src/models/dashboard/explorer.js";
import { CommandAuditRecordSchema, CommandResultSchema, ProtectedSettingsCommandRequestSchema, SettingsCommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
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
        ucpathUserId: { set: "synthetic-ucpath-user" },
        ucpathPassword: { set: "synthetic-ucpath-password" },
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

async function committedExplorer() {
  const descriptor = DESCRIPTORS.find(({ id }) => String(id) === "person-lookup");
  assert.ok(descriptor !== undefined);
  const request = ExplorerEditApplyRequestSchema.parse({
    commandId: "13131313-1313-4313-8313-131313131313",
    requestedAt: "2026-08-28T12:00:00.000Z",
    requestedBy: "local-operator",
    source: "dashboard",
    reason: "Apply the reviewed presentation label",
    family: "explorer",
    type: "apply-explorer-edit",
    target: {
      workflowId: descriptor.id,
      expectedVersion: descriptor.version,
      contractFingerprint: descriptor.contractFingerprint,
      expectedOverrideRevision: 0,
    },
    payload: { changes: [{ kind: "workflow-label", value: "Recovered people search" }] },
  });
  const profile = await createProfileFixture(manualClock(new Date(request.requestedAt)));
  const repoRoot = profile.workspace;
  const path = join(repoRoot, rebuildRuntimeIsolation.stateRoot, "explorer-overrides.json");
  const override = ExplorerWorkflowOverrideSchema.parse({
    overrideVersion: 1,
    workflowId: descriptor.id,
    descriptorVersion: descriptor.version,
    contractFingerprint: descriptor.contractFingerprint,
    revision: 1,
    appliedCommandId: request.commandId,
    commandFingerprint: explorerEditCommandFingerprint(request),
    presentation: { label: "Recovered people search" },
  });
  mkdirSync(dirname(path), { recursive: true });
  return { profile, repoRoot, path, request, override };
}

function explorerAudit(request: Awaited<ReturnType<typeof committedExplorer>>["request"]) {
  const target = { family: "explorer", workflowId: request.target.workflowId, revision: 1 } as const;
  return CommandAuditRecordSchema.parse({
    auditId: "99999999-9999-4999-8999-999999999999",
    request,
    result: { state: "applied", commandId: request.commandId, affectedTargets: [target] },
    completedAt: "2026-08-28T12:00:01.000Z",
    versionChanges: [{ target, before: 0, after: 1 }],
    affectedDependencyIds: [],
  });
}

function journalExplorer(
  fixture: Awaited<ReturnType<typeof committedExplorer>>,
  request = fixture.request,
  audit: ReturnType<typeof explorerAudit> | null = explorerAudit(fixture.request),
): void {
  const database = fixture.profile.openDatabase({
    path: join(fixture.profile.stateRoot, "state.db"),
    busyTimeoutMs: 5000, migrationOwner: "explorer-startup-test",
  });
  try {
    database.withAuthorityTransaction((repositories) => {
      repositories.commands.insert(request);
      repositories.explorerOverrides.replace(request, fixture.override);
      if (audit !== null) repositories.commandAudits.insert(audit);
    });
  } finally {
    database.close();
  }
}

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
    let resolveCard: (() => void) | undefined;
    const cardArrived = new Promise<void>((resolve) => {
      resolveCard = resolve;
    });
    const live = new Promise<void>((resolve) => {
      const subscription = client.subscribeDay({
        day,
        onDay: (received) => {
          days.push(received);
          if (received.workerCards.length === 1) resolveCard?.();
        },
        onState: (state) => {
          if (state.state === "live") resolve();
        },
      });
      cleanups.push(() => subscription.close());
    });
    await live;
    assert.equal(days.at(-1)?.workerCards.length, 0);

    const origin = `http://127.0.0.1:${String(runtime.port)}`;
    const response = await fetch(`${origin}/api/v1/commands`, { method: "POST",
      headers: { "content-type": "application/json", origin }, body: JSON.stringify({
        commandId: randomUUID(), family: "worker-browser", type: "plan-worker-count",
        target: { workflowId: personLookupDescriptor.id, expectedVersion: 0 }, payload: { desiredWorkers: 1 },
        source: "dashboard", requestedBy: "local-operator", requestedAt: clock.now().toISOString(),
      }) });
    assert.equal(CommandResultSchema.parse(await response.json()).state, "applied");
    const spawnResponse = await fetch(`${origin}/api/v1/commands`, { method: "POST",
      headers: { "content-type": "application/json", origin }, body: JSON.stringify({
        commandId: randomUUID(), family: "worker-browser", type: "spawn-worker",
        target: { workflowId: personLookupDescriptor.id, expectedVersion: 1 },
        payload: { workerId: "person-lookup-worker-1" }, source: "dashboard", requestedBy: "local-operator",
        requestedAt: clock.now().toISOString(),
      }) });
    const spawned: unknown = await spawnResponse.json();
    assert.equal(spawnResponse.status, 200, JSON.stringify(spawned) + records.flatMap(record => record.output).join(""));
    assert.equal(CommandResultSchema.parse(spawned).state, "applied");
    assert.equal(records.length, 1);
    assert.ok(records[0]?.pid !== undefined);

    const deadline = setTimeout(() => {
      assert.fail(`no worker-card snapshot within 5s; snapshots seen: ${String(days.length)}`);
    }, 5_000);
    try {
      await cardArrived;
    } finally {
      clearTimeout(deadline);
    }
    const card = days.at(-1)?.workerCards[0];
    assert.equal(card?.workerId, "person-lookup-worker-1");
    assert.equal(card?.state, "starting");
    assert.deepEqual(card?.browserRequirements, { state: "present", systems: ["crm", "ucpath"] });
    assert.deepEqual(card?.browsers, []);
    assert.equal(records[0]?.exited, false);
  }, scaledMs(20_000));

  function observeExplorerSnapshot(authorityPath: string, onCommit?: () => void) {
    const statements: string[] = [];
    const expectedPath = realpathSync(authorityPath);
    let readingExplorer = false;
    const reader: { connection?: DatabaseSync } = {};
    const compose = explorerComposition.composeExplorer;
    vi.spyOn(explorerComposition, "composeExplorer").mockImplementation((input) => {
      const composed = compose(input);
      const snapshot = <Result,>(read: () => Result): Result => {
        assert.equal(readingExplorer, false);
        readingExplorer = true;
        try { return read(); }
        finally { readingExplorer = false; }
      };
      assert.ok(composed.routes.explorer.overrides);
      assert.ok(composed.routes.explorerEdits);
      const readAll = composed.routes.explorer.overrides.readAll;
      const validate = composed.routes.explorerEdits.validate;
      return { ...composed, routes: {
        explorer: { ...composed.routes.explorer, overrides: {
          readAll: () => snapshot(() => readAll()),
        } },
        explorerEdits: { validate: (draft) => snapshot(() => validate(draft)) },
      } };
    });
    const execute = Reflect.get(DatabaseSync.prototype, "exec");
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
      if (readingExplorer && reader.connection === undefined && sql === "BEGIN"
        && this.location() === expectedPath) reader.connection = this;
      const tagged = readingExplorer && this === reader.connection;
      if (tagged) statements.push(sql);
      Reflect.apply(execute, this, [sql]);
      if (tagged && sql === "COMMIT") onCommit?.();
    });
    return statements;
  }

  it.each(["GET", "validate"] as const)("serves one SQLite snapshot without unrelated file reads per Explorer %s request", async operation => {
    const fixture = await committedExplorer(); journalExplorer(fixture);
    for (const suffix of ["", ".claim", ".pending", ".claim.pending"]) writeFileSync(`${fixture.path}${suffix}`, "unrelated bytes");
    const sql = observeExplorerSnapshot(join(fixture.profile.stateRoot, "state.db"));
    const lifetimeLock = fixture.profile.lifetime;
    const runtime = await composeDashboardRuntime({ lifetimeLock, ...fixture.profile.dashboardInput, isolation: rebuildRuntimeIsolation, env: {}, repoRoot: fixture.repoRoot, backendPortOverride: 0,
      clock: manualClock(new Date(fixture.request.requestedAt)) });
    try {
      vi.mocked(readFileSync).mockClear();
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
      for (const requestCount of [1, 2]) {
        if (operation === "GET") {
          const workflow = (await client.workflowExplorer()).workflows.find(row => row.id === fixture.request.target.workflowId);
          assert.equal(workflow?.label, "Recovered people search"); assert.equal(workflow?.edit.overrideRevision, 1);
        } else {
          const validation = await client.validateExplorerEdit({ draftVersion: 1, workflowId: fixture.request.target.workflowId,
            baseDescriptorVersion: fixture.request.target.expectedVersion, baseContractFingerprint: fixture.request.target.contractFingerprint,
            baseOverrideRevision: 1, changes: [{ kind: "workflow-label", value: "Reviewed directory search" }] });
          assert.equal(validation.state, "ready-to-apply");
          if (validation.state === "ready-to-apply") assert.equal(validation.override.revision, 2);
        }
        assert.equal(sql.filter(statement => statement === "BEGIN IMMEDIATE").length, 0);
        assert.equal(sql.filter(statement => statement === "BEGIN").length, requestCount);
        assert.equal(vi.mocked(readFileSync).mock.calls.filter(([path]) => String(path).startsWith(fixture.path)).length, 0);
      }
    } finally { await runtime.stop(); }
  }, scaledMs(20_000));

  it.each(["GET", "validate"] as const)("keeps the captured Explorer %s view across a concurrent commit and sees it on the next request", async operation => {
    const fixture = await committedExplorer(); journalExplorer(fixture);
    let committed: (() => void) | undefined;
    observeExplorerSnapshot(join(fixture.profile.stateRoot, "state.db"), () => committed?.());
    const lifetimeLock = fixture.profile.lifetime;
    const runtime = await composeDashboardRuntime({ lifetimeLock, ...fixture.profile.dashboardInput, isolation: rebuildRuntimeIsolation, env: {}, repoRoot: fixture.repoRoot, backendPortOverride: 0,
      clock: manualClock(new Date(fixture.request.requestedAt)) });
    try {
      const request = ExplorerEditApplyRequestSchema.parse({ ...fixture.request, commandId: "24242424-2424-4242-8242-242424242424",
        target: { ...fixture.request.target, expectedOverrideRevision: 1 }, payload: { changes: [{ kind: "workflow-label", value: "New directory search" }] } });
      const override = ExplorerWorkflowOverrideSchema.parse({ ...fixture.override, revision: 2, appliedCommandId: request.commandId,
        commandFingerprint: explorerEditCommandFingerprint(request), presentation: { label: "New directory search" } });
      const audit = CommandAuditRecordSchema.parse({ ...explorerAudit(request), auditId: "88888888-8888-4888-8888-888888888888",
        result: { state: "applied", commandId: request.commandId, affectedTargets: [{ family: "explorer", workflowId: request.target.workflowId, revision: 2 }] },
        versionChanges: [{ target: { family: "explorer", workflowId: request.target.workflowId, revision: 2 }, before: 1, after: 2 }] });
      const writer = fixture.profile.openDatabase({ path: join(fixture.profile.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "concurrent-explorer" });
      try {
        let crossed = false;
        committed = () => {
          if (crossed) return;
          crossed = true;
          writer.withAuthorityTransaction(repositories => { repositories.commands.insert(request); repositories.explorerOverrides.replace(request, override); repositories.commandAudits.insert(audit); });
        };
        const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
        const draft = { draftVersion: 1, workflowId: request.target.workflowId, baseDescriptorVersion: request.target.expectedVersion,
          baseContractFingerprint: request.target.contractFingerprint, baseOverrideRevision: 1, changes: [{ kind: "workflow-label", value: "Reviewed search" }] };
        if (operation === "GET") {
          assert.equal((await client.workflowExplorer()).workflows.find(row => row.id === request.target.workflowId)?.label, "Recovered people search");
          assert.equal((await client.workflowExplorer()).workflows.find(row => row.id === request.target.workflowId)?.label, "New directory search");
        } else {
          assert.equal((await client.validateExplorerEdit(draft)).state, "ready-to-apply");
          assert.equal((await client.validateExplorerEdit(draft)).state, "conflict");
        }
        assert.equal(crossed, true);
      } finally { writer.close(); }
    } finally { await runtime.stop(); }
  }, scaledMs(20_000));

  it("applies and replays the complete Explorer command after a real runtime restart", async () => {
    const fixture = await committedExplorer();
    let runtime = await composeDashboardRuntime({ lifetimeLock: fixture.profile.lifetime, ...fixture.profile.dashboardInput, isolation: rebuildRuntimeIsolation, env: {}, repoRoot: fixture.repoRoot, backendPortOverride: 0,
      clock: manualClock(new Date(fixture.request.requestedAt)) });
    const send = (request: unknown) => {
      const baseUrl = `http://127.0.0.1:${String(runtime.port)}`;
      return fetch(`${baseUrl}/api/v1/commands`, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify(request) });
    };
    try {
      const first = await send(fixture.request); assert.equal(first.status, 200); assert.equal(CommandResultSchema.parse(await first.json()).state, "applied");
      await runtime.stop();
      for (const suffix of ["", ".claim"]) writeFileSync(`${fixture.path}${suffix}`, "retired malformed file");
      await fixture.profile.restart();
      runtime = await composeDashboardRuntime({ lifetimeLock: fixture.profile.lifetime, ...fixture.profile.dashboardInput, isolation: rebuildRuntimeIsolation, env: {}, repoRoot: fixture.repoRoot, backendPortOverride: 0,
        clock: manualClock(new Date(fixture.request.requestedAt)) });
      const replay = await send(fixture.request); assert.equal(replay.status, 200); assert.equal(CommandResultSchema.parse(await replay.json()).state, "already-applied");
      const divergent = await send({ ...fixture.request, reason: "Changed envelope" }); assert.equal(divergent.status, 500);
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
      assert.equal((await client.workflowExplorer()).workflows.find(row => row.id === fixture.request.target.workflowId)?.label, "Recovered people search");
    } finally { await runtime.stop(); }
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
