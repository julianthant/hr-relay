import { fixtureAdmission, installationAdmission, releaseAdmissionFixture, releaseAdmissionFixtures } from "../../../../../support/helpers/admission-fixture.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../../../src/backend/storage/sqlite/migrations.js";
import { hostConfigFacts } from "../../../../../../src/models/config/host-display.js";

import assert from "node:assert/strict";
import { once } from "node:events";
import {
  copyFileSync,
  cpSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as explorerComposition from "../../../../../../src/backend/app/composition/dashboard/explorer.js";
import { afterEach, describe, it, vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../../src/backend/app/config/runtime-isolation.js";
import { DESCRIPTORS } from "../../../../../../src/backend/app/registries/workflow-registry.js";
import {
  createDashboardClient,
  type DashboardClient,
  type SubscriptionState,
} from "../../../../../../src/dashboard/client/index.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { resolveConfigWithProvenance } from "../../../../../../src/backend/app/config/resolve.js";
import {
  SETTINGS_SCHEMA_HASH,
  deriveSettingsPatchFingerprint,
} from "../../../../../../src/models/config/settings.js";
import {
  CommandAuditRecordSchema,
  CommandResultSchema,
  ProtectedSettingsCommandRequestSchema,
  SettingsCommandRequestSchema,
} from "../../../../../../src/rules/commands/commands.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../../../src/models/config/protected-settings.js";
import {
  ExplorerEditApplyRequestSchema,
  ExplorerWorkflowOverrideSchema,
} from "../../../../../../src/models/dashboard/explorer.js";
import { AuthorityDatabase } from "../../../../../support/helpers/admission-fixture.js";
import { SQLITE_MIGRATIONS } from "../../../../../../src/backend/storage/sqlite/migrations.js";
import {
  RuntimeProcessLockFileSchema,
  WorkerProcessLockFileSchema,
} from "../../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { explorerEditCommandFingerprint } from "../../../../../../src/models/dashboard/explorer-override.js";
import {
  composeDashboardRuntime as composeProductionDashboardRuntime,
  productionWorkerLaunch,
  type DashboardComposeInput,
  type DashboardRuntime,
} from "../../../../../../src/backend/app/composition/dashboard/compose.js";
import { writeDashboardBuildIdentity } from "../../../../../../src/backend/app/composition/dashboard/build-identity.js";
import { readSettings } from "../../../../../../src/backend/runtime/settings/settings-runtime.js";
import {
  SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS,
  persistCorruptJournaledSettings,
} from "../../../../../support/fixtures/integration/settings-runtime-corruption-fixtures.js";
import { settingsSetOperations } from "../../../../../support/fixtures/settings-operation-fixtures.js";

const cleanups: (() => Promise<void> | void)[] = [];


async function composeDashboardRuntime(input: DashboardComposeInput): Promise<DashboardRuntime> {
  return composeProductionDashboardRuntime({
    ...input,
    admission: input.admission ?? installationAdmission(input.repoRoot ?? process.cwd()),
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

  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  releaseAdmissionFixtures();
});

function committedExplorer() {
  const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-explorer-"));
  copyRuntimePackageFixture(repoRoot);
  cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
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
  mkdirSync(dirname(path), { recursive: true });
  return { repoRoot, path, request, override };
}

function explorerAudit(request: ReturnType<typeof committedExplorer>["request"]) {
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
  fixture: ReturnType<typeof committedExplorer>,
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
      repositories.explorerOverrides.replace(request, fixture.override);
      if (audit !== null) repositories.commandAudits.insert(audit);
    });
  } finally {
    database.close();
  }
}

describe("composed dashboard runtime over an owned loopback socket", () => {
  it("unwinds an initial preflight refresh rejection and keeps authority admission recoverable", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-preflight-unwind-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    mkdirSync(join(repoRoot, rebuildRuntimeIsolation.stateRoot), { recursive: true });
    const path = join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db");
    const lockPath = join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");
    const primary = new Error("injected preflight clock failure");
    const baseClock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const clock = { ...baseClock, monotonicMs: () => { throw primary; } };

    await assert.rejects(composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      env: {},
      clock,
      repoRoot,
    }), (error: unknown) => error instanceof AggregateError && error.errors.includes(primary));

    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as Record<string, unknown>;
    assert.equal(typeof lock.releasedAt, "string", "the server record releases after startup cleanup closes authority");
    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "startup-unwind-test" }, baseClock);
    try {
      assert.ok(database.getMeta().schemaVersion >= CURRENT_AUTHORITY_SCHEMA_VERSION);
    } finally {
      database.close();
    }
  });

  it("preserves an HTTP bind rejection while unwinding the constructed dashboard", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-listen-unwind-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const lockPath = join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");
    const primary = new Error("injected HTTP listen failure");

    await assert.rejects(composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      env: {},
      repoRoot,
      httpServerStarter: async () => { throw primary; },
    }), (error: unknown) => error === primary);

    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as Record<string, unknown>;
    assert.equal(typeof lock.releasedAt, "string");
    const database = AuthorityDatabase.open({
      path: join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db"),
      busyTimeoutMs: 250,
      migrationOwner: "startup-unwind-test",
    });
    database.close();
  });

  it("refuses a missing saved settings singleton when active revision proves one existed", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-evidence-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const path = join(stateRoot, "state.db");
    const initial = await composeDashboardRuntime({ isolation: rebuildRuntimeIsolation, backendPortOverride: 0, env: {}, repoRoot });
    await initial.stop();
    const raw = new DatabaseSync(path);
    try {
      raw.prepare(`UPDATE app_settings SET record_json = json_set(
        json_set(record_json, '$.saved', NULL), '$.active.settingsRevision', 2
      ) WHERE record_key = 'current'`).run();
      raw.prepare("UPDATE app_settings SET command_id = NULL, audit_id = NULL WHERE record_key = 'current'").run();
    } finally {
      raw.close();
    }

    await assert.rejects(composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      repoRoot,
    }), /settings-current-missing-with-history/u);
    const lock = JSON.parse(readFileSync(join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json"), "utf8")) as Record<string, unknown>;
    assert.equal(typeof lock.releasedAt, "string");
  });

  it("admits an empty pre-created state root as a virgin authority", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-virgin-root-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    mkdirSync(join(repoRoot, rebuildRuntimeIsolation.stateRoot), { recursive: true });
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      repoRoot,
    });
    await runtime.stop();
    assert.ok(existsSync(join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db")));
  });

  it("refuses an established state root with no authority database before taking the server lock", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-missing-authority-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(join(stateRoot, "retained-evidence"), "evidence");
    const lockPath = join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");

    await assert.rejects(composeDashboardRuntime({ admission: fixtureAdmission(repoRoot),
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      repoRoot,
    }), /state root is established but its authority database is missing/u);

    assert.equal(existsSync(lockPath), false, "missing established authority is refused before process-lock admission");
    assert.equal(existsSync(join(stateRoot, "state.db")), false);
  });

  it("refuses a settings-family-only root instead of regenerating its missing authority", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-only-root-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(join(stateRoot, "settings"), { recursive: true });
    const lockPath = join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");

    await assert.rejects(composeDashboardRuntime({ admission: fixtureAdmission(repoRoot),
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      repoRoot,
    }), /state root is established but its authority database is missing/u);

    assert.equal(existsSync(join(stateRoot, "state.db")), false);
    assert.equal(existsSync(lockPath), false, "a non-virgin settings family blocks before process-lock admission");
  });

  it("archives a crashed server by birth identity and retains worker-orphan evidence for recovery", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-orphan-recovery-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const processLockRoot = join(repoRoot, rebuildRuntimeIsolation.processLockRoot);
    const serverLockPath = join(processLockRoot, "server.lock.json");
    const authorityPath = join(repoRoot, rebuildRuntimeIsolation.stateRoot, "state.db");
    mkdirSync(dirname(authorityPath), { recursive: true });
    AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 250, migrationOwner: "crash-recovery-fixture" }, clock).close();
    const identityPlatform = process.platform as "linux" | "darwin" | "win32";
    const crashedServer = RuntimeProcessLockFileSchema.parse({
      schemaVersion: 2,
      name: "server",
      pid: process.pid,
      processIdentity: { platform: identityPlatform, startToken: "previous-server-birth" },
      acquisitionId: "11111111-1111-4111-8111-111111111111",
      generation: 4,
      acquiredAt: clock.now().toISOString(),
      releasedAt: null,
    });
    if (crashedServer.schemaVersion !== 2) throw new Error("expected-version-2-crash-record");
    mkdirSync(processLockRoot, { recursive: true });
    writeFileSync(serverLockPath, `${JSON.stringify(crashedServer)}\n`);

    const recovered = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock,
      repoRoot,
    });
    const singletonHistory = join(processLockRoot, "singleton-history", "server");
    const initialHistory = readdirSync(singletonHistory).filter((name) => name.endsWith(".lock.json"));
    assert.equal(initialHistory.length, 1, "the stale owner record is archived before a new owner is admitted");
    const archived = JSON.parse(readFileSync(join(singletonHistory, initialHistory[0] ?? ""), "utf8")) as Record<string, unknown>;
    assert.equal(archived.acquisitionId, crashedServer.acquisitionId);
    assert.equal(archived.releasedAt, null, "crash evidence retains its unreleased state");
    await recovered.stop();

    const orphanDirectory = join(processLockRoot, "workers");
    mkdirSync(orphanDirectory, { recursive: true });
    const orphan = WorkerProcessLockFileSchema.parse({
      schemaVersion: 3,
      name: "workers",
      workerId: "orphan-worker",
      pid: process.pid,
      processIdentity: { platform: identityPlatform, startToken: "previous-worker-birth" },
      acquisitionId: "22222222-2222-4222-8222-222222222222",
      acquiredAt: clock.now().toISOString(),
      releasedAt: null,
    });
    const orphanPath = join(orphanDirectory, `${orphan.acquisitionId}.lock.json`);
    const orphanBytes = `${JSON.stringify(orphan)}\n`;
    writeFileSync(orphanPath, orphanBytes);
    const releasedServer = RuntimeProcessLockFileSchema.parse(JSON.parse(readFileSync(serverLockPath, "utf8")));
    writeFileSync(serverLockPath, `${JSON.stringify({
      ...releasedServer,
      processIdentity: { platform: identityPlatform, startToken: "another-prior-server-birth" },
      releasedAt: null,
    })}\n`);

    const recoveredWithOrphan = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock,
      repoRoot,
    });
    try {
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(recoveredWithOrphan.port)}` });
      const readiness = await client.readiness();
      assert.equal(readiness.state, "present");
      if (readiness.state === "present") {
        const orphanCheck = readiness.checks.find(({ id }) => id === "process.orphans");
        assert.equal(orphanCheck?.verdict, "warning");
        assert.match(orphanCheck?.detail ?? "", /1 unreleased dead process owner record/u);
      }
    } finally {
      await recoveredWithOrphan.stop();
    }

    assert.equal(readFileSync(orphanPath, "utf8"), orphanBytes, "startup preserves the unknown worker's orphan record");
    const historyRecords = readdirSync(singletonHistory)
      .filter((name) => name.endsWith(".lock.json"))
      .map((name) => JSON.parse(readFileSync(join(singletonHistory, name), "utf8")) as Record<string, unknown>);
    assert.ok(historyRecords.some((record) => record.acquisitionId === crashedServer.acquisitionId && record.releasedAt === null));
    const current = JSON.parse(readFileSync(serverLockPath, "utf8")) as Record<string, unknown>;
    assert.equal(current.pid, process.pid, "the recovered owner released its own lock after database cleanup");
    assert.equal(typeof current.releasedAt, "string");
  });

  it("refuses a newer authority under the current build before settings opens or config resolution", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-downgrade-v31-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    const artifactRoot = join(repoRoot, rebuildRuntimeIsolation.artifactRoot);
    const lockPath = join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json");
    mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    const path = join(stateRoot, "state.db");
    AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "m9-floor-fixture" }).close();
    const admission = installationAdmission(repoRoot);
    const newer = new DatabaseSync(path);
    newer.exec("PRAGMA user_version=2");
    newer.close();
    const before = readFileSync(path);
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Reflect.get(raw.prepare("PRAGMA user_version").get() ?? {}, "user_version"), 2);
      assert.notEqual(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'database_upgrades'").get(), undefined);
    } finally {
      raw.close();
    }
    // A readable planted settings file makes the early-read negative control
    // reach the same authority refusal rather than failing on ENOENT first.
    mkdirSync(join(stateRoot, "settings"), { recursive: true, mode: 0o700 });
    writeFileSync(join(stateRoot, "settings", "settings.json"), "{}", { mode: 0o600 });

    {
      const resolver = await import("../../../../../../src/backend/app/config/resolve.js");
      const resolveSpy = vi.spyOn(resolver, "resolveConfigWithProvenance");
      const { composeDashboardRuntime: composeCurrentBuild } = await import("../../../../../../src/backend/app/composition/dashboard/compose.js");
      vi.mocked(readFileSync).mockClear();
      vi.mocked(openSync).mockClear();
      vi.mocked(mkdirSync).mockClear();
      try {
        await assert.rejects(composeCurrentBuild({ admission,
          isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0,
          env: {}, clock: manualClock(new Date("2026-08-28T12:00:00.000Z")), repoRoot,
        }), new RegExp(`authority schema 2 does not match supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`, "u"));

        const isSettingsPath = (value: unknown): boolean => typeof value === "string"
          && (value.startsWith(join(stateRoot, "settings", "settings.json"))
            || value.startsWith(join(stateRoot, "settings") + "/"));
        assert.equal(vi.mocked(openSync).mock.calls.filter(([target]) => isSettingsPath(target)).length,
          0, "M9: zero settings-family openSync calls before downgrade refusal");
        assert.equal(vi.mocked(readFileSync).mock.calls.filter(([target]) => isSettingsPath(target)).length,
          0, "M9: zero settings-family readFileSync calls before downgrade refusal");
        assert.equal(resolveSpy.mock.calls.length, 0, "M9: zero resolveConfigWithProvenance calls before downgrade refusal");
        assert.equal(vi.mocked(mkdirSync).mock.calls.filter(([target]) => target === stateRoot).length,
          0, "native schema refusal precedes runtime directory mutation");
        assert.equal(vi.mocked(openSync).mock.calls.filter(([target]) => target === artifactRoot).length,
          0, "native schema refusal precedes artifact-root acquisition");
        assert.equal(statSync(artifactRoot).mode & 0o777, 0o700);
        assert.equal(existsSync(lockPath), false, "native schema refusal acquires no server process record");
        assert.deepEqual(readFileSync(path), before);
      } finally {
        resolveSpy.mockRestore();
      }
    }
  });

  it("releases its acquired server process record when a pre-floor authority refuses open", async () => {
    const version = 29;
    const repoRoot = mkdtempSync(join(tmpdir(), `hrauto-compose-open-v${String(version)}-`));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
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
      composeDashboardRuntime({ admission: fixtureAdmission(repoRoot),
        isolation: rebuildRuntimeIsolation,
        backendPortOverride: 0,
        env: {},
        clock: manualClock(new Date("2026-08-28T12:00:00.000Z")),
        repoRoot,
      }),
      /upgrade-required \{ schemaVersion: 29, floor: 46 \}/u,
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

  it("releases its acquired server process record when a valid authority is marked ahead of this build", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), `hrauto-compose-open-v${String(CURRENT_AUTHORITY_SCHEMA_VERSION + 1)}-`));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const path = join(stateRoot, "state.db");
    AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "future-schema-fixture" }).close();
    installationAdmission(repoRoot);
    const futureVersion = CURRENT_AUTHORITY_SCHEMA_VERSION + 1;
    const raw = new DatabaseSync(path);
    raw.exec(`UPDATE database_state SET schema_version = ${String(futureVersion)} WHERE singleton_id = 1`);
    raw.exec(`PRAGMA user_version = ${String(futureVersion)}`);
    raw.close();

    await assert.rejects(
      composeDashboardRuntime({
        isolation: rebuildRuntimeIsolation,
        backendPortOverride: 0,
        env: {},
        clock: manualClock(new Date("2026-08-28T12:00:00.000Z")),
        repoRoot,
      }),
      new RegExp(`authority schema ${String(futureVersion)} is newer than supported ${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`, "u"),
    );
    const releasedRecord = JSON.parse(readFileSync(
      join(repoRoot, rebuildRuntimeIsolation.processLockRoot, "server.lock.json"),
      "utf8",
    )) as Record<string, unknown>;
    assert.equal(releasedRecord.releasedAt, "2026-08-28T12:00:00.000Z");
    const unchanged = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Reflect.get(unchanged.prepare("PRAGMA user_version").get() ?? {}, "user_version"), futureVersion);
    } finally {
      unchanged.close();
    }
  });

  it("serves the exact editable settings command schema hash", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-schema-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
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
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-lease-tick-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
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

  it.each(["GET", "validate"] as const)("serves one SQLite snapshot and no historical file reads per Explorer %s request", async operation => {
    const fixture = committedExplorer(); journalExplorer(fixture);
    for (const suffix of ["", ".claim", ".pending", ".claim.pending"]) writeFileSync(`${fixture.path}${suffix}`, "inert historical bytes");
    const sql = observeExplorerSnapshot(join(fixture.repoRoot, ".tracker", "state.db"));
    const runtime = await composeDashboardRuntime({ isolation: rebuildRuntimeIsolation, env: {}, repoRoot: fixture.repoRoot, backendPortOverride: 0,
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
  }, 20_000);

  it.each(["GET", "validate"] as const)("keeps the captured Explorer %s view across a concurrent commit and sees it on the next request", async operation => {
    const fixture = committedExplorer(); journalExplorer(fixture);
    let committed: (() => void) | undefined;
    observeExplorerSnapshot(join(fixture.repoRoot, ".tracker", "state.db"), () => committed?.());
    const runtime = await composeDashboardRuntime({ isolation: rebuildRuntimeIsolation, env: {}, repoRoot: fixture.repoRoot, backendPortOverride: 0,
      clock: manualClock(new Date(fixture.request.requestedAt)) });
    try {
      const request = ExplorerEditApplyRequestSchema.parse({ ...fixture.request, commandId: "24242424-2424-4242-8242-242424242424",
        target: { ...fixture.request.target, expectedOverrideRevision: 1 }, payload: { changes: [{ kind: "workflow-label", value: "New directory search" }] } });
      const override = ExplorerWorkflowOverrideSchema.parse({ ...fixture.override, revision: 2, appliedCommandId: request.commandId,
        commandFingerprint: explorerEditCommandFingerprint(request), presentation: { label: "New directory search" } });
      const audit = CommandAuditRecordSchema.parse({ ...explorerAudit(request), auditId: "88888888-8888-4888-8888-888888888888",
        result: { state: "applied", commandId: request.commandId, affectedTargets: [{ family: "explorer", workflowId: request.target.workflowId, revision: 2 }] },
        versionChanges: [{ target: { family: "explorer", workflowId: request.target.workflowId, revision: 2 }, before: 1, after: 2 }] });
      const writer = AuthorityDatabase.open({ path: join(fixture.repoRoot, ".tracker", "state.db"), busyTimeoutMs: 250, migrationOwner: "concurrent-explorer" });
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
  }, 20_000);

  it("applies and replays the complete Explorer command after a real runtime restart", async () => {
    const fixture = committedExplorer();
    let runtime = await composeDashboardRuntime({ isolation: rebuildRuntimeIsolation, env: {}, repoRoot: fixture.repoRoot, backendPortOverride: 0,
      clock: manualClock(new Date(fixture.request.requestedAt)) });
    const send = (request: unknown) => {
      const baseUrl = `http://127.0.0.1:${String(runtime.port)}`;
      return fetch(`${baseUrl}/api/v1/commands`, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify(request) });
    };
    try {
      const first = await send(fixture.request); assert.equal(first.status, 200); assert.equal(CommandResultSchema.parse(await first.json()).state, "applied");
      await runtime.stop();
      for (const suffix of ["", ".claim"]) writeFileSync(`${fixture.path}${suffix}`, "retired malformed file");
      runtime = await composeDashboardRuntime({ isolation: rebuildRuntimeIsolation, env: {}, repoRoot: fixture.repoRoot, backendPortOverride: 0,
        clock: manualClock(new Date(fixture.request.requestedAt)) });
      const replay = await send(fixture.request); assert.equal(replay.status, 200); assert.equal(CommandResultSchema.parse(await replay.json()).state, "already-applied");
      const divergent = await send({ ...fixture.request, reason: "Changed envelope" }); assert.equal(divergent.status, 500);
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(runtime.port)}` });
      assert.equal((await client.workflowExplorer()).workflows.find(row => row.id === fixture.request.target.workflowId)?.label, "Recovered people search");
    } finally { await runtime.stop(); }
  }, 20_000);

  it("ignores retired malformed file authority and serves the SQLite baseline", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-retired-settings-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
    const authorityPath = join(repoRoot, ".tracker", "state.db");
    mkdirSync(dirname(authorityPath), { recursive: true });
    AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 250, migrationOwner: "retired-settings-fixture" }).close();
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
      cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
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

  it("plans new runs with saved settings without a dashboard restart", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-stale-runtime-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
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
      { browser: { headless: false }, features: { duoWebAuthn: false } },
    );
    const applied = await client.executeCommand(command);
    assert.equal(applied.state, "applied");
    const protectedApplied = await client.executeCommand(protectedUcpathSettingsCommand(
      "44444444-4444-4444-8444-444444444444",
      clock.now().toISOString(),
      1,
      "44444444-4444-4444-8444-444444444445",
    ));
    assert.equal(protectedApplied.state, "applied");

    const plan = await client.submitStartPlan({
      workflowId: "person-lookup", submissions: [{ emplId: "10800000" }], dryRun: true,
      browserMode: "headless", captureBrowserScreenshots: false,
    });
    assert.equal(plan.fingerprints.configFingerprint,
      resolveConfigWithProvenance(readPersistedSettings(repoRoot, clock).settings, hostConfigFacts({}), clock, { stateRoot: join(repoRoot, rebuildRuntimeIsolation.stateRoot), artifactRoot: join(repoRoot, rebuildRuntimeIsolation.artifactRoot) }).fingerprint);
    assert.equal(readRuntimeSettingsRevision(repoRoot), 2);
  });

  it("activates the exact persisted settings generation after a dashboard restart", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-restart-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
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
      { browser: { headless: false }, features: { duoWebAuthn: false } },
    );
    const applied = await firstClient.executeCommand(command);
    const persisted = readPersistedSettings(repoRoot, clock);
    assert.deepEqual(applied, {
      state: "applied",
      commandId: command.commandId,
      affectedTargets: [{ family: "settings", revision: 2 }],
      restartRequired: false,
      settingsRevision: 2,
      settingsFingerprint: persisted.settingsFingerprint,
    });
    const protectedApplied = await firstClient.executeCommand(protectedUcpathSettingsCommand(
      "44444444-4444-4444-8444-444444444444",
      clock.now().toISOString(),
      1,
      "44444444-4444-4444-8444-444444444445",
    ));
    assert.equal(protectedApplied.state, "applied");

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
      resolveConfigWithProvenance(persisted.settings, hostConfigFacts({}), clock, { stateRoot: join(repoRoot, rebuildRuntimeIsolation.stateRoot), artifactRoot: join(repoRoot, rebuildRuntimeIsolation.artifactRoot) }).fingerprint,
      "the restarted plan must bind the config resolved from the exact persisted settings generation",
    );
    assert.equal(plan.planned.length, 1);
    assert.deepEqual(plan.refused, []);
  });

  it("refuses historical protected write-id reuse after a dashboard restart", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-protected-write-id-"));
    copyRuntimePackageFixture(repoRoot);
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
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
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
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

  it("activates a saved revision immediately and retains it through restart", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-"));
    copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
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
      if (applied.state === "applied") assert.equal(applied.restartRequired, false);
      const readback = await client.editableSettings();
      assert.equal(readback.revision, 2);
      assert.equal(readback.runtimeStatus.state, "current");
      const screenWidth = readback.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
      assert.equal(screenWidth?.effectiveValue, 1980);
      assert.equal(screenWidth?.settingsValue, 1980);
      assert.equal(readPersistedSettings(repoRoot, manualClock(new Date(command.requestedAt))).settings.display?.screenWidth, 1980);
      assert.equal(readRuntimeSettingsRevision(repoRoot), 2);
      const replay = await client.applySettings(command);
      assert.equal(replay.state, "already-applied");
      if (replay.state === "already-applied") assert.equal(replay.restartRequired, false);
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
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));

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
    cpSync(join(process.cwd(), "src"), join(repoRoot, "src"), { recursive: true });
    mkdirSync(join(repoRoot, "config"), { recursive: true });
    copyFileSync(join(process.cwd(), "config", "dashboard-workflow-sources.json"), join(repoRoot, "config", "dashboard-workflow-sources.json"));
    copyFileSync(join(process.cwd(), "vite.dashboard.config.ts"), join(repoRoot, "vite.dashboard.config.ts"));
    copyFileSync(join(process.cwd(), "tsconfig.json"), join(repoRoot, "tsconfig.json"));
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));

    // No bundle: refuse before any authority, lock or socket exists.
    await assert.rejects(
      composeDashboardRuntime({ admission: fixtureAdmission(repoRoot),
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
    writeDashboardBuildIdentity({ repoRoot, distDir: join(repoRoot, "dist", "dashboard") });
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
    cleanups.push(() => (releaseAdmissionFixture(repoRoot), rmSync(repoRoot, { recursive: true, force: true })));
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
