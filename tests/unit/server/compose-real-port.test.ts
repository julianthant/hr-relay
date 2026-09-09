import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
/**
 * The composed dashboard runtime over a REAL loopback socket:
 * composeDashboardRuntime opens authority under a temp state root, folds
 * existing JSONL, binds an OS-owned ephemeral port, and the ONE typed client
 * talks to it over real sockets — bootstrap query, day query, and a live SSE
 * hello/snapshot. Production-port identity stays in runtime-composition and
 * operational-isolation; a test must never contend with a running dashboard.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import {
  createDashboardClient,
  type DashboardClient,
  type SubscriptionState,
} from "../../../src/dashboard/client/index.js";
import { manualClock } from "../../../src/domain/clock.js";
import { resolveConfigWithProvenance } from "../../../src/domain/config/resolve.js";
import {
  SETTINGS_SCHEMA_HASH,
  deriveSettingsPatchFingerprint,
} from "../../../src/domain/config/settings.js";
import {
  CommandAuditRecordSchema,
  CommandResultSchema,
  ProtectedSettingsCommandRequestSchema,
  SettingsCommandRequestSchema,
} from "../../../src/domain/commands.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../src/domain/config/protected-settings.js";
import {
  ExplorerEditApplyRequestSchema,
  ExplorerWorkflowOverrideSchema,
} from "../../../src/domain/dashboard/explorer.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { SQLITE_MIGRATIONS } from "../../../src/infra/sqlite/migrations.js";
import {
  createExplorerOverrideStore,
  explorerEditCommandFingerprint,
} from "../../../src/server/dashboard/commands/explorer-override-store.js";
import {
  composeDashboardRuntime as composeProductionDashboardRuntime,
  productionWorkerLaunch,
  type DashboardComposeInput,
  type DashboardRuntime,
} from "../../../src/server/dashboard/compose.js";
import { readSettings } from "../../../src/server/settings-runtime.js";
import {
  SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS,
  persistCorruptJournaledSettings,
} from "../fixtures/settings-runtime-corruption-fixtures.js";
import { withAuthorityBuildVariant } from "../fixtures/authority-build-variant.js";
import { settingsSetOperations } from "../fixtures/settings-operation-fixtures.js";

const cleanups: (() => Promise<void> | void)[] = [];

/**
 * Every composition in this suite owns both of its port roles. Production-port
 * identity is pinned elsewhere; reaching it here would make an unrelated live
 * dashboard decide whether these assertions execute.
 */
function composeDashboardRuntime(input: DashboardComposeInput): Promise<DashboardRuntime> {
  return composeProductionDashboardRuntime({
    ...input,
    backendPortOverride: 0,
    frontendPortOverride: 0,
  });
}

function reportRealPortPhase(
  phase: "startup" | "request" | "teardown",
  state: "begin" | "complete",
): void {
  process.stdout.write(`[r3a:compose-real-port] ${phase}:${state}\n`);
}

function readRuntimeSettingsRevision(repoRoot: string) {
  const database = AuthorityDatabase.open({
    path: join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db"),
    busyTimeoutMs: 250,
    migrationOwner: "unit-test",
  });
  try {
    const active = database.authority.runtimeConfig.get();
    assert.ok(active, "the composed dashboard must have an active runtime config");
    return active.settingsRevision;
  } finally {
    database.close();
  }
}

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

function protectedSettingsCommand(
  commandId: string,
  requestedAt: string,
  expectedRevision: number,
  writeId: string,
  value: string,
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
      entries: { ucpathPassword: { set: value } },
    },
  });
}

function readPersistedSettings(repoRoot: string, clock: ReturnType<typeof manualClock>) {
  const database = AuthorityDatabase.open({ path: join(repoRoot, ".tracker", "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
  try { return readSettings(database.authority); } finally { database.close(); }
}

function copyRuntimePackageFixture(repoRoot: string): void {
  copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
  copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
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

afterEach(async () => {
  vi.mocked(fsyncSync).mockReset();
  vi.mocked(readFileSync).mockReset();
  vi.mocked(openSync).mockReset();
  vi.mocked(mkdirSync).mockReset();
  vi.restoreAllMocks();
  // LIFO, like any resource teardown: the subscription closes before the
  // runtime stops, and the runtime stops — including its graceful-drain
  // backup write — before the temp root it writes into is removed.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function pendingExplorer(landed = true) {
  const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-explorer-"));
  copyRuntimePackageFixture(repoRoot);
  cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
  const descriptor = DESCRIPTORS.find(({ id }) => String(id) === "person-lookup");
  assert.ok(descriptor !== undefined);
  const path = join(repoRoot, rebuildRuntimeIsolation.stateRoot, "explorer-overrides.json");
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
  if (landed) {
    createExplorerOverrideStore(path).replace(request, override);
  } else {
    const store = createExplorerOverrideStore(path, {
      writeExclusive: (target, text) => writeFileSync(target, text, { encoding: "utf8", mode: 0o600, flag: "wx" }),
      syncPath: (target) => {
        const handle = openSync(target, "r");
        try { fsyncSync(handle); } finally { closeSync(handle); }
      },
      atomicReplace: (from, to) => {
        if (to === path) throw new Error("injected crash before override rename");
        renameSync(from, to);
      },
      remove: unlinkSync,
    });
    assert.throws(() => store.replace(request, override), /injected crash before override rename/u);
    assert.equal(existsSync(path), false);
  }
  return { repoRoot, path, request };
}

function explorerAudit(request: ReturnType<typeof pendingExplorer>["request"]) {
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
  fixture: ReturnType<typeof pendingExplorer>,
  request = fixture.request,
  audit: ReturnType<typeof explorerAudit> | null = explorerAudit(fixture.request),
): void {
  // All authority in this suite is under the fixture's mkdtemp root.
  const database = AuthorityDatabase.open({
    path: join(fixture.repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db"),
    busyTimeoutMs: 5000, migrationOwner: "explorer-startup-test",
  });
  try {
    database.withAuthorityTransaction((repositories) => {
      repositories.commands.insert(request);
      if (audit !== null) repositories.commandAudits.insert(audit);
    });
  } finally {
    database.close();
  }
}

describe("composed dashboard runtime over an owned loopback socket", () => {
  it("M9 refuses the current authority under CURRENT29 before settings opens or config resolution", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-downgrade-v31-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    const artifactRoot = join(repoRoot, rebuildRuntimeIsolation.artifactRoot);
    const lockPath = join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");
    mkdirSync(stateRoot, { recursive: true });
    const path = join(stateRoot, "state.db");
    AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "m9-floor-fixture" }).close();
    const before = readFileSync(path);
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Reflect.get(raw.prepare("PRAGMA user_version").get() ?? {}, "user_version"), 38);
      assert.notEqual(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'authority_upgrades'").get(), undefined);
    } finally {
      raw.close();
    }
    // A readable planted settings file makes the early-read negative control
    // reach the same authority refusal rather than failing on ENOENT first.
    mkdirSync(join(stateRoot, "settings"), { recursive: true, mode: 0o700 });
    writeFileSync(join(stateRoot, "settings", "settings.json"), "{}", { mode: 0o600 });

    await withAuthorityBuildVariant("current-29", async () => {
      const build = await import("../../../src/infra/sqlite/migrations.js");
      assert.equal(build.CURRENT_AUTHORITY_SCHEMA_VERSION, 29);
      const resolver = await import("../../../src/domain/config/resolve.js");
      const resolveSpy = vi.spyOn(resolver, "resolveConfigWithProvenance");
      const { composeDashboardRuntime: composeOlderBuild } = await import("../../../src/server/dashboard/compose.js");
      vi.mocked(readFileSync).mockClear();
      vi.mocked(openSync).mockClear();
      vi.mocked(mkdirSync).mockClear();
      try {
        await assert.rejects(composeOlderBuild({
          isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0,
          env: {}, clock: manualClock(new Date("2026-08-28T12:00:00.000Z")), repoRoot,
        }), /authority schema 38 is newer than supported 29/u);

        const isSettingsPath = (value: unknown): boolean => typeof value === "string"
          && (value.startsWith(join(stateRoot, "settings", "settings.json"))
            || value.startsWith(join(stateRoot, "settings") + "/"));
        assert.equal(vi.mocked(openSync).mock.calls.filter(([target]) => isSettingsPath(target)).length,
          0, "M9: zero settings-family openSync calls before downgrade refusal");
        assert.equal(vi.mocked(readFileSync).mock.calls.filter(([target]) => isSettingsPath(target)).length,
          0, "M9: zero settings-family readFileSync calls before downgrade refusal");
        assert.equal(resolveSpy.mock.calls.length, 0, "M9: zero resolveConfigWithProvenance calls before downgrade refusal");
        assert.ok(vi.mocked(mkdirSync).mock.calls.some(([target]) => target === stateRoot),
          "M9: state-root mkdir precedes the refused authority open");
        assert.ok(vi.mocked(openSync).mock.calls.some(([target]) => target === artifactRoot),
          "M9: artifact-root directory check precedes the refused authority open");
        assert.equal(statSync(artifactRoot).mode & 0o777, 0o700);
        const released = JSON.parse(readFileSync(lockPath, "utf8")) as Record<string, unknown>;
        assert.equal(released.acquiredAt, "2026-08-28T12:00:00.000Z");
        assert.equal(released.releasedAt, "2026-08-28T12:00:00.000Z");
        assert.deepEqual(readFileSync(path), before);
      } finally {
        resolveSpy.mockRestore();
      }
    });
    assert.equal((await import("../../../src/infra/sqlite/migrations.js")).CURRENT_AUTHORITY_SCHEMA_VERSION, 38);
  });

  it.each([
    { version: 29, refusal: /upgrade-required \{ schemaVersion: 29, floor: 37 \}/u },
    { version: 39, refusal: /authority schema 39 is newer than supported 38/u },
  ])("releases its acquired server process record when authority v$version refuses open", async ({
    version,
    refusal,
  }) => {
    const repoRoot = mkdtempSync(join(tmpdir(), `hrauto-compose-open-v${String(version)}-`));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const path = join(stateRoot, "state.db");
    const legacy = new DatabaseSync(path);
    legacy.exec("BEGIN EXCLUSIVE");
    for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 29)) {
      for (const statement of migration.statements) legacy.exec(statement);
    }
    legacy.prepare(`
      INSERT INTO authority_meta (
        singleton_id, schema_version, authority_generation, updated_at,
        migration_owner, migration_started_at
      ) VALUES (1, ?, 0, ?, NULL, NULL)
    `).run(version, "2026-08-28T12:00:00.000Z");
    legacy.exec("PRAGMA application_id = 1217249861");
    legacy.exec(`PRAGMA user_version = ${String(version)}`);
    legacy.exec("COMMIT");
    legacy.close();

    await assert.rejects(
      composeDashboardRuntime({
        isolation: rebuildRuntimeIsolation,
        backendPortOverride: 0,
        env: {},
        clock: manualClock(new Date("2026-08-28T12:00:00.000Z")),
        repoRoot,
      }),
      refusal,
    );
    const releasedRecord = JSON.parse(readFileSync(
      join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json"),
      "utf8",
    )) as Record<string, unknown>;
    assert.equal(releasedRecord.releasedAt, "2026-08-28T12:00:00.000Z");
    const unchanged = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Reflect.get(unchanged.prepare("PRAGMA user_version").get() ?? {}, "user_version"), version);
    } finally {
      unchanged.close();
    }
  });

  it("serves the exact editable settings command schema hash", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-schema-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const runtime = await composeDashboardRuntime({
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

  it("launches pool workers through the secure bootstrap's cli arm, never the inert src/cli.ts module", () => {
    // A direct `src/cli.ts` entry exits 0 without writing a lease
    // (secure-env-bootstrap.test.ts proves the module is inert), and the
    // supervisor then reports "exited with code 0 before proving its lease
    // birth" for every spawn — which is how the 2026-09-02 live check found it.
    const launch = productionWorkerLaunch("/repo");
    assert.equal(launch.command, process.execPath);
    assert.deepEqual([...launch.prefixArgs], ["--import", "tsx", "/repo/scripts/secure-env-bootstrap.ts", "cli"]);
    assert.equal(launch.cwd, "/repo");
    assert.ok(!launch.prefixArgs.some((arg) => arg.endsWith(join("src", "cli.ts"))));
  });

  it("P20 launch carries only process mechanics and host display, never provider or arbitrary values", () => {
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

  it("publishes a lease-only worker card from the real tail tick, before any span exists (D248 freshness)", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-lease-tick-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock: manualClock(new Date("2026-08-28T12:00:00.000Z")),
      repoRoot,
    });
    cleanups.push(() => runtime.stop());

    const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
    const day = "2026-08-28";
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

    // A worker PROCESS writes its lease in authority and has emitted no span:
    // nothing on disk moves, so only the tick's lease reconcile can publish it.
    const database = AuthorityDatabase.open({
      path: join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db"),
      busyTimeoutMs: 250,
      migrationOwner: "unit-test",
    });
    try {
      const started = database.authority.workerLeases.start({
        workerId: "person-lookup-worker-1",
        workflow: "person-lookup",
        browserSystems: ["crm", "ucpath"],
        processId: 4242,
        requestedBy: "local-operator",
        now: "2026-08-28T12:00:01.000Z",
      });
      assert.equal(started.state, "started");
    } finally {
      database.close();
    }

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
  }, 20_000);

  it.each(["GET", "validate"] as const)("serves Explorer with one recovery admission and one document read per %s request", async (operation) => {
    const fixture = pendingExplorer();
    journalExplorer(fixture);
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation, env: {}, repoRoot: fixture.repoRoot, backendPortOverride: 0,
      clock: manualClock(new Date(fixture.request.requestedAt)),
    });
    try {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      let directorySyncs = 0;
      vi.mocked(fsyncSync).mockImplementation((handle) => {
        if (actual.fstatSync(handle).isDirectory()) directorySyncs += 1;
        actual.fsyncSync(handle);
      });
      const sql = vi.spyOn(DatabaseSync.prototype, "exec");
      vi.mocked(readFileSync).mockClear();
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });

      for (const requestCount of [1, 2]) {
        if (operation === "GET") {
          const explorer = await client.workflowExplorer();
          assert.deepEqual(explorer.workflows.map(({ id }) => id), DESCRIPTORS.map(({ id }) => id));
          const workflow = explorer.workflows.find(({ id }) => id === fixture.request.target.workflowId);
          assert.equal(workflow?.label, "Recovered people search");
          assert.equal(workflow?.edit.overrideRevision, 1);
        } else {
          const validation = await client.validateExplorerEdit({
            draftVersion: 1, workflowId: fixture.request.target.workflowId,
            baseDescriptorVersion: fixture.request.target.expectedVersion,
            baseContractFingerprint: fixture.request.target.contractFingerprint,
            baseOverrideRevision: 1, changes: [{ kind: "workflow-label", value: "Reviewed directory search" }],
          });
          assert.equal(validation.state, "ready-to-apply");
          if (validation.state !== "ready-to-apply") assert.fail("expected presentation validation");
          assert.equal(validation.override.revision, 2);
        }
        assert.deepEqual({
          writeAdmissions: sql.mock.calls.filter(([statement]) => statement === "BEGIN IMMEDIATE").length,
          directorySyncs,
          documentReads: vi.mocked(readFileSync).mock.calls.filter(([path]) => path === fixture.path).length,
        }, { writeAdmissions: requestCount, directorySyncs: requestCount, documentReads: requestCount });
      }
    } finally {
      await runtime.stop();
    }
  }, 20_000);

  it.each(["GET", "validate"] as const)("keeps the admitted %s view when a new claim lands after admission, then re-admits on the next request", async (operation) => {
    const fixture = pendingExplorer();
    journalExplorer(fixture);
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation, env: {}, repoRoot: fixture.repoRoot, backendPortOverride: 0,
      clock: manualClock(new Date(fixture.request.requestedAt)),
    });
    try {
      const request = ExplorerEditApplyRequestSchema.parse({
        ...fixture.request,
        commandId: "24242424-2424-4242-8242-242424242424",
        target: { ...fixture.request.target, expectedOverrideRevision: 1 },
        payload: { changes: [{ kind: "workflow-label", value: "New directory search" }] },
      });
      const override = ExplorerWorkflowOverrideSchema.parse({
        overrideVersion: 1, workflowId: request.target.workflowId,
        descriptorVersion: request.target.expectedVersion,
        contractFingerprint: request.target.contractFingerprint,
        revision: 2, appliedCommandId: request.commandId,
        commandFingerprint: explorerEditCommandFingerprint(request),
        presentation: { label: "New directory search" },
      });
      // Run real SQLite first, then land real new file/claim bytes exactly when
      // the read's authority transaction releases its writer exclusion.
      const execute: unknown = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, "exec")?.value;
      assert.ok(typeof execute === "function");
      let crossed = false;
      vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
        Reflect.apply(execute, this, [sql]);
        if (sql === "COMMIT" && !crossed) {
          crossed = true;
          createExplorerOverrideStore(fixture.path).replace(request, override);
        }
      });
      const baseUrl = `http://127.0.0.1:${String(runtime.port)}`;
      const client = createDashboardClient({ baseUrl });
      const draft = {
        draftVersion: 1, workflowId: request.target.workflowId,
        baseDescriptorVersion: request.target.expectedVersion,
        baseContractFingerprint: request.target.contractFingerprint,
        baseOverrideRevision: 1, changes: [{ kind: "workflow-label", value: "Reviewed directory search" }],
      };

      if (operation === "GET") {
        const explorer = await client.workflowExplorer();
        assert.deepEqual(explorer.workflows.map(({ id }) => id), DESCRIPTORS.map(({ id }) => id));
        const workflow = explorer.workflows.find(({ id }) => id === request.target.workflowId);
        assert.equal(workflow?.label, "Recovered people search");
        assert.equal(workflow?.edit.overrideRevision, 1);
      } else {
        const validation = await client.validateExplorerEdit(draft);
        assert.equal(validation.state, "ready-to-apply");
        if (validation.state !== "ready-to-apply") assert.fail("expected admitted revision-one validation");
        assert.equal(validation.override.revision, 2);
        assert.deepEqual(validation.semanticDiff, [{
          path: "presentation.label", before: "Recovered people search", after: "Reviewed directory search",
        }]);
      }
      assert.equal(crossed, true);
      assert.equal(existsSync(`${fixture.path}.claim`), true);
      if (operation === "GET") {
        await assert.rejects(() => client.workflowExplorer(), /has uncommitted command 24242424/u);
      } else {
        await assert.rejects(() => client.validateExplorerEdit(draft), /has uncommitted command 24242424/u);
      }

      const replay = await fetch(`${baseUrl}/api/v1/commands`, {
        method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify(request),
      });
      assert.equal(replay.status, 200, await replay.clone().text());
      assert.equal(CommandResultSchema.parse(await replay.json()).state, "applied");
      if (operation === "GET") {
        const workflow = (await client.workflowExplorer()).workflows.find(({ id }) => id === request.target.workflowId);
        assert.equal(workflow?.label, "New directory search");
        assert.equal(workflow?.edit.overrideRevision, 2);
      } else {
        const validation = await client.validateExplorerEdit(draft);
        assert.equal(validation.state, "conflict");
        if (validation.state !== "conflict") assert.fail("expected current revision conflict");
        assert.equal(validation.conflict, "override-revision");
        assert.equal(validation.currentOverrideRevision, 2);
      }
      assert.equal(existsSync(`${fixture.path}.claim`), false);
    } finally {
      await runtime.stop();
    }
  }, 20_000);

  it.each([true, false])("blocks unjournaled Explorer reads after restart while preserving exact command replay (landed=%s)", async (landed) => {
    const { repoRoot, path, request } = pendingExplorer(landed);
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation, env: {}, repoRoot, backendPortOverride: 0,
      clock: manualClock(new Date(request.requestedAt)),
    });
    try {
      const baseUrl = `http://127.0.0.1:${String(runtime.port)}`;
      const blocked = await fetch(`${baseUrl}/api/v1/explorer`);
      assert.equal(blocked.status, 500);
      assert.match(await blocked.text(), /has uncommitted command 13131313-1313-4313-8313-131313131313/u);
      assert.equal(existsSync(`${path}.claim`), true);
      const validation = await fetch(`${baseUrl}/api/v1/explorer/validate`, {
        method: "POST", headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({
          draftVersion: 1, workflowId: request.target.workflowId,
          baseDescriptorVersion: request.target.expectedVersion,
          baseContractFingerprint: request.target.contractFingerprint,
          baseOverrideRevision: 0, changes: request.payload.changes,
        }),
      });
      assert.equal(validation.status, 500);
      assert.match(await validation.text(), /has uncommitted command/u);

      const foreign = await fetch(`${baseUrl}/api/v1/commands`, {
        method: "POST", headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ ...request, reason: "Not the reviewed envelope" }),
      });
      assert.equal(foreign.status, 500);
      assert.equal(existsSync(`${path}.claim`), true);
      const stillBlocked = await fetch(`${baseUrl}/api/v1/explorer`);
      assert.equal(stillBlocked.status, 500);

      const replay = await fetch(`${baseUrl}/api/v1/commands`, {
        method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify(request),
      });
      assert.equal(replay.status, 200, await replay.clone().text());
      assert.equal(CommandResultSchema.parse(await replay.json()).state, "applied");
      const client = createDashboardClient({ baseUrl });
      const workflow = (await client.workflowExplorer()).workflows.find(({ id }) => id === request.target.workflowId);
      assert.equal(workflow?.label, "Recovered people search");
      assert.equal(workflow?.edit.overrideRevision, 1);
      assert.equal(existsSync(`${path}.claim`), false);
    } finally {
      await runtime.stop();
    }
  }, 20_000);

  it("reconciles exact journal, audit and next bytes before startup admits Explorer", async () => {
    const fixture = pendingExplorer();
    journalExplorer(fixture);
    const bytes = readFileSync(fixture.path, "utf8");
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation, env: {}, repoRoot: fixture.repoRoot, backendPortOverride: 0,
      clock: manualClock(new Date(fixture.request.requestedAt)),
    });
    try {
      // Assert before GET: lazy reconciliation on a later command is too late.
      assert.equal(existsSync(`${fixture.path}.claim`), false);
      assert.equal(readFileSync(fixture.path, "utf8"), bytes);
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
      const workflow = (await client.workflowExplorer()).workflows.find(({ id }) => id === fixture.request.target.workflowId);
      assert.equal(workflow?.label, "Recovered people search");
      assert.equal(workflow?.edit.overrideRevision, 1);
    } finally {
      await runtime.stop();
    }
  }, 20_000);

  it.each([
    "partial-journal", "divergent-journal", "divergent-audit", "foreign-result",
    "wrong-revision", "missing-next-bytes", "damaged-next-bytes",
  ] as const)("refuses startup and retains the claim for %s", async (scenario) => {
    const fixture = pendingExplorer();
    const request = scenario === "divergent-journal"
      ? ExplorerEditApplyRequestSchema.parse({ ...fixture.request, reason: "Different journal envelope" })
      : fixture.request;
    const exactAudit = explorerAudit(fixture.request);
    const audit = CommandAuditRecordSchema.parse({
      ...exactAudit,
      request: scenario === "divergent-audit"
        ? { ...fixture.request, reason: "Different audit envelope" } : exactAudit.request,
      result: scenario === "foreign-result"
        ? { ...exactAudit.result, commandId: "22222222-2222-4222-8222-222222222222" } : exactAudit.result,
      versionChanges: scenario === "wrong-revision"
        ? exactAudit.versionChanges.map((change) => ({ ...change, before: 4 })) : exactAudit.versionChanges,
    });
    // Explicit null means no audit; avoid a default argument replacing absence.
    journalExplorer(fixture, request, scenario === "partial-journal" ? null : audit);
    if (scenario === "missing-next-bytes") unlinkSync(fixture.path);
    if (scenario === "damaged-next-bytes") writeFileSync(fixture.path, "{damaged", "utf8");
    await assert.rejects(async () => {
      const runtime = await composeDashboardRuntime({
        isolation: rebuildRuntimeIsolation, env: {}, repoRoot: fixture.repoRoot, backendPortOverride: 0,
        clock: manualClock(new Date(fixture.request.requestedAt)),
      });
      await runtime.stop();
    }, /partial journal outcome|complete command envelope|pending override transition|exact next bytes|matches neither/u);
    assert.equal(existsSync(`${fixture.path}.claim`), true);
  }, 20_000);

  it("ignores retired malformed file authority and serves the SQLite baseline", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-retired-settings-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const path = join(repoRoot, ".tracker", "settings", "settings.json");
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "retired malformed file");
    const runtime = await composeDashboardRuntime({ isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {}, repoRoot });
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
      const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-corrupt-settings-"));
      writeFileSync(
        join(repoRoot, "package.json"),
        JSON.stringify({ name: "probe", version: "0.1.0" }),
      );
      cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
      const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
      const fixture = persistCorruptJournaledSettings({
        repoRoot,
        stateRoot: join(repoRoot, rebuildRuntimeIsolation.stateRoot),
        clock,
        corruption,
        activateRuntime: false,
      });

      await assert.rejects(async () => {
        const runtime = await composeDashboardRuntime({
          isolation: rebuildRuntimeIsolation,
          backendPortOverride: 0,
          env: {},
          clock,
          repoRoot,
        });
        await runtime.stop();
      }, corruption.expected);

      const database = AuthorityDatabase.open({ path: join(repoRoot, ".tracker", "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" }, clock);
      try { assert.deepEqual(database.authority.settingsCurrent.get(), fixture.record); } finally { database.close(); }
    },
  );

  it("refuses new start plans after settings apply until this dashboard restarts", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-stale-runtime-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const runtime = await composeDashboardRuntime({
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
      { browser: { headless: false } },
    );
    const applied = await client.executeCommand(command);
    assert.equal(applied.state, "applied");

    await assert.rejects(
      client.submitStartPlan({
        workflowId: "person-lookup",
        submissions: [{ emplId: "10800000" }],
        dryRun: true,
        browserMode: "headless",
        captureBrowserScreenshots: false,
      }),
      /dashboard runtime settings are stale; restart activation is required/u,
    );
  });

  it("activates the exact persisted settings generation after a dashboard restart", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-restart-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    let runtime = await composeDashboardRuntime({
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
      { browser: { headless: false } },
    );
    const applied = await firstClient.executeCommand(command);
    const persisted = readPersistedSettings(repoRoot, clock);
    assert.deepEqual(applied, {
      state: "applied",
      commandId: command.commandId,
      affectedTargets: [{ family: "settings", revision: 2 }],
      restartRequired: true,
      settingsRevision: 2,
      settingsFingerprint: persisted.settingsFingerprint,
    });

    await runtime.stop();
    runtime = await composeDashboardRuntime({
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
      resolveConfigWithProvenance(persisted.settings, hostConfigFacts({}), clock).fingerprint,
      "the restarted plan must bind the config resolved from the exact persisted settings generation",
    );
    assert.equal(plan.planned.length, 1);
    assert.deepEqual(plan.refused, []);
  });

  it("refuses historical protected write-id reuse after a dashboard restart", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-protected-write-id-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const writeId = "77777777-7777-4777-8777-777777777777";
    let runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock,
      repoRoot,
    });
    cleanups.push(() => runtime.stop());
    const firstClient = createDashboardClient({
      baseUrl: `http://127.0.0.1:${String(runtime.port)}`,
    });
    const first = await firstClient.executeCommand(protectedSettingsCommand(
      "33333333-3333-4333-8333-333333333333",
      clock.now().toISOString(),
      1,
      writeId,
      "first-synthetic-protected-value",
    ));
    assert.equal(first.state, "applied");
    const protectedPath = join(repoRoot, ".tracker", "credentials", "protected.json");
    const committedBytes = readFileSync(protectedPath);

    await runtime.stop();
    runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock,
      repoRoot,
    });
    const restartedClient = createDashboardClient({
      baseUrl: `http://127.0.0.1:${String(runtime.port)}`,
    });
    const reused = await restartedClient.executeCommand(protectedSettingsCommand(
      "55555555-5555-4555-8555-555555555555",
      clock.now().toISOString(),
      2,
      writeId,
      "second-synthetic-protected-value",
    ));

    assert.equal(reused.state, "rejected");
    if (reused.state === "rejected") {
      assert.equal(reused.code, "command-divergent");
      assert.equal(reused.message, "credential command or write identity differs from its persisted request");
    }
    assert.deepEqual(readFileSync(protectedPath), committedBytes);
  });

  it("creates the artifact root as an owner-only directory", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-private-artifacts-"));
    copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      frontendPortOverride: 0,
      env: {},
      repoRoot,
    });
    cleanups.push(() => runtime.stop());

    const permissions = statSync(join(repoRoot, rebuildRuntimeIsolation.artifactRoot)).mode & 0o777;
    assert.equal(permissions, 0o700);
  });

  it("keeps an applied revision restart-required until a dashboard restart activates it", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-"));
    copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const commandId = "72727272-7272-4272-8272-727272727272";
    const patch = settingsSetOperations({ display: { screenWidth: 1980, screenHeight: 1080 } });
    const command = {
      commandId,
      requestedAt: new Date().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    } as const;

    const first = await composeDashboardRuntime({
      frontendPortOverride: 0,
      isolation: rebuildRuntimeIsolation,
      env: {},
      repoRoot,
      backendPortOverride: 0,
    });
    try {
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(first.port)}` });
      const before = await client.editableSettings();
      assert.equal(before.revision, 1);
      const applied = await client.applySettings(command);
      assert.equal(applied.state, "applied");
      if (applied.state === "applied") assert.equal(applied.restartRequired, true);
      const readback = await client.editableSettings();
      assert.equal(readback.revision, 2);
      assert.equal(readback.runtimeStatus.state, "restart-required");
      const screenWidth = readback.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
      assert.equal(screenWidth?.effectiveValue, 1980);
      assert.equal(screenWidth?.settingsValue, 1980);
      assert.equal(readPersistedSettings(repoRoot, manualClock(new Date(command.requestedAt))).settings.display?.screenWidth, 1980);
      assert.equal(readRuntimeSettingsRevision(repoRoot), 1);
      const replay = await client.applySettings(command);
      assert.equal(replay.state, "already-applied");
      if (replay.state === "already-applied") assert.equal(replay.restartRequired, true);
    } finally {
      await first.stop();
    }

    const restarted = await composeDashboardRuntime({
      frontendPortOverride: 0,
      isolation: rebuildRuntimeIsolation,
      env: {},
      repoRoot,
      backendPortOverride: 0,
    });
    try {
      assert.equal(readRuntimeSettingsRevision(repoRoot), 2);
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(restarted.port)}` });
      const readback = await client.editableSettings();
      assert.equal(readback.runtimeStatus.state, "current");
      assert.equal(readback.revision, 2);
    } finally {
      await restarted.stop();
    }
  }, 20_000);

  it("serves bootstrap, day, and SSE through a real ephemeral listener and releases it at teardown", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-"));
    copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));

    reportRealPortPhase("startup", "begin");
    const runtime: DashboardRuntime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      frontendPortOverride: 0,
      env: {},
      repoRoot,
    });
    let subscription: ReturnType<DashboardClient["subscribeDay"]> | undefined;
    const failures: unknown[] = [];
    try {
      assert.notEqual(runtime.port, 0);
      assert.notEqual(runtime.port, rebuildRuntimeIsolation.backendPort);
      reportRealPortPhase("startup", "complete");

      reportRealPortPhase("request", "begin");
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
      const bootstrap = await client.bootstrap();
      assert.equal(bootstrap.appVersion, "0.1.0");
      // DERIVED from the composition root, never a hand-listed set: this assertion
      // was hardcoded to `["person-lookup"]` and went red the moment a second
      // workflow registered, asserting the fixture rather than the contract —
      // the bootstrap serves exactly what WORKFLOW_MODULES declares.
      assert.deepEqual(
        (bootstrap.workflows as { id: string }[]).map(({ id }) => id).toSorted(),
        DESCRIPTORS.map(({ id }) => id).toSorted(),
      );
      assert.equal(bootstrap.storage.authority, "healthy");

      const today = new Date().toISOString().slice(0, 10);
      const day = await client.dashboardDay(today);
      assert.deepEqual(day.queueSurfaces, []);
      assert.deepEqual(day.workflowCounts, []);

      const states: SubscriptionState[] = [];
      let sawDay = false;
      const liveWithDay = new Promise<void>((resolve) => {
        subscription = client.subscribeDay({
          day: today,
          onDay: (received) => {
            assert.equal(received.day, today);
            sawDay = true;
          },
          onState: (state) => {
            states.push(state);
            if (state.state === "live" && sawDay) resolve();
          },
        });
      });
      await liveWithDay;
      assert.equal(states[0]?.state, "connecting");
      reportRealPortPhase("request", "complete");
    } catch (error: unknown) {
      failures.push(error);
    }

    reportRealPortPhase("teardown", "begin");
    try {
      subscription?.close();
    } catch (error: unknown) {
      failures.push(error);
    }
    try {
      await runtime.stop();
    } catch (error: unknown) {
      failures.push(error);
    }

    const releasedPortProbe = createServer();
    try {
      releasedPortProbe.listen(runtime.port, "127.0.0.1");
      await once(releasedPortProbe, "listening");
    } catch (error: unknown) {
      failures.push(error);
    } finally {
      if (releasedPortProbe.listening) {
        try {
          releasedPortProbe.close();
          await once(releasedPortProbe, "close");
        } catch (error: unknown) {
          failures.push(error);
        }
      }
    }
    if (failures.length === 0) reportRealPortPhase("teardown", "complete");
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "real-port lifecycle observed multiple failures", {
        cause: failures[0],
      });
    }
  }, 20_000);
  it("built-bundle mode refuses to compose without dist/dashboard/index.html, and serves the bundle beside the API when it exists", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-built-bundle-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));

    // No bundle: refuse before any authority, lock or socket exists.
    await assert.rejects(
      composeDashboardRuntime({
        isolation: rebuildRuntimeIsolation,
        backendPortOverride: 0,
        env: {},
        clock: manualClock(new Date("2026-08-28T12:00:00.000Z")),
        repoRoot,
        frontend: "built-bundle",
      }),
      /npm run web:build/u,
    );
    assert.equal(existsSync(join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db")), false, "a refused built-bundle composition opens no authority");

    const dist = join(repoRoot, "dist", "dashboard", "assets");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(repoRoot, "dist", "dashboard", "index.html"), "<!doctype html><title>built</title>");
    writeFileSync(join(dist, "app.f00d.js"), "export const built = true;");
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock: manualClock(new Date("2026-08-28T12:00:00.000Z")),
      repoRoot,
      frontend: "built-bundle",
    });
    cleanups.push(() => runtime.stop());
    const base = `http://127.0.0.1:${String(runtime.port)}`;

    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.equal(index.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(index.headers.get("cache-control"), "no-cache");
    assert.match(await index.text(), /<title>built<\/title>/u);
    const asset = await fetch(`${base}/assets/app.f00d.js`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
    const spa = await fetch(`${base}/archive`);
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /<title>built<\/title>/u);
    const api = await fetch(`${base}/api/v1/bootstrap`);
    assert.equal(api.status, 200);
    assert.match(api.headers.get("content-type") ?? "", /application\/json/u);
    const unknownApi = await fetch(`${base}/api/v1/nope`);
    assert.equal(unknownApi.status, 404);
    assert.equal(((await unknownApi.json()) as { code: string }).code, "ROUTE_NOT_FOUND");
    const refused = await fetch(`${base}/..%2fpackage.json`);
    assert.equal(refused.status, 400);
    assert.equal(((await refused.json()) as { code: string }).code, "STATIC_PATH_REFUSED");
  });

  it("vite-dev mode (the default) serves no bundle bytes: an unrouted path stays a JSON 404", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-vite-dev-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock: manualClock(new Date("2026-08-28T12:00:00.000Z")),
      repoRoot,
    });
    cleanups.push(() => runtime.stop());
    const index = await fetch(`http://127.0.0.1:${String(runtime.port)}/`);
    assert.equal(index.status, 404);
    assert.equal(((await index.json()) as { code: string }).code, "ROUTE_NOT_FOUND");
  });
});
