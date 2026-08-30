/**
 * The composed dashboard runtime on the REAL isolation port (3938, from the
 * config value — never a literal at the call site): composeDashboardRuntime
 * opens authority under a temp state root, folds existing JSONL, binds
 * loopback HTTP, and the ONE typed client talks to it over real sockets —
 * bootstrap query, day query, and a live SSE hello/snapshot.
 */
import assert from "node:assert/strict";
import {
  closeSync, existsSync, fsyncSync, mkdtempSync, openSync, readFileSync,
  renameSync, rmSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import { createDashboardClient, type SubscriptionState } from "../../../src/dashboard/client/index.js";
import {
  CURRENT_SETTINGS_SCHEMA_HASH,
  deriveSettingsPatchFingerprint,
} from "../../../src/domain/config/settings.js";
import { composeDashboardRuntime, type DashboardRuntime } from "../../../src/server/dashboard/compose.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { CommandAuditRecordSchema, CommandResultSchema } from "../../../src/domain/commands.js";
import {
  ExplorerEditApplyRequestSchema,
  ExplorerWorkflowOverrideSchema,
} from "../../../src/domain/dashboard/explorer.js";
import {
  createExplorerOverrideStore,
  explorerEditCommandFingerprint,
} from "../../../src/server/dashboard/commands/explorer-override-store.js";

const cleanups: (() => Promise<void> | void)[] = [];

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, fsyncSync: vi.fn(actual.fsyncSync), readFileSync: vi.fn(actual.readFileSync) };
});

afterEach(async () => {
  vi.mocked(fsyncSync).mockReset();
  vi.mocked(readFileSync).mockReset();
  vi.restoreAllMocks();
  // LIFO, like any resource teardown: the subscription closes before the
  // runtime stops, and the runtime stops — including its graceful-drain
  // backup write — before the temp root it writes into is removed.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function pendingExplorer(landed = true) {
  const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-explorer-"));
  writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "probe", version: "0.1.0" }));
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

describe("composed dashboard runtime on the isolation port", () => {
  it.each(["GET", "validate"] as const)("serves Explorer with one recovery admission and one document read per %s request", async (operation) => {
    const fixture = pendingExplorer();
    journalExplorer(fixture);
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation, env: {}, repoRoot: fixture.repoRoot, backendPortOverride: 0,
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
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request),
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
    });
    try {
      const baseUrl = `http://127.0.0.1:${String(runtime.port)}`;
      const blocked = await fetch(`${baseUrl}/api/v1/explorer`);
      assert.equal(blocked.status, 500);
      assert.match(await blocked.text(), /has uncommitted command 13131313-1313-4313-8313-131313131313/u);
      assert.equal(existsSync(`${path}.claim`), true);
      const validation = await fetch(`${baseUrl}/api/v1/explorer/validate`, {
        method: "POST", headers: { "content-type": "application/json" },
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
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, reason: "Not the reviewed envelope" }),
      });
      assert.equal(foreign.status, 500);
      assert.equal(existsSync(`${path}.claim`), true);
      const stillBlocked = await fetch(`${baseUrl}/api/v1/explorer`);
      assert.equal(stillBlocked.status, 500);

      const replay = await fetch(`${baseUrl}/api/v1/commands`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request),
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
      });
      await runtime.stop();
    }, /partial journal outcome|complete command envelope|pending override transition|exact next bytes|matches neither/u);
    assert.equal(existsSync(`${fixture.path}.claim`), true);
  }, 20_000);

  it("keeps an applied revision restart-required until a dashboard restart activates it", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-"));
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "probe", version: "0.1.0" }));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const generationPath = join(
      repoRoot,
      rebuildRuntimeIsolation.stateRoot,
      "settings",
      "runtime-generation.json",
    );
    const commandId = "72727272-7272-4272-8272-727272727272";
    const patch = { display: { screenWidth: 1980 } };
    const command = {
      commandId,
      requestedAt: new Date().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    } as const;

    const first = await composeDashboardRuntime({
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
      assert.match(readFileSync(join(repoRoot, "config", "settings.json"), "utf8"), /"screenWidth":1980/u);
      const activation = JSON.parse(readFileSync(generationPath, "utf8")) as {
        identity: { settingsRevision: number };
      };
      assert.equal(activation.identity.settingsRevision, 1);
      const replay = await client.applySettings(command);
      assert.equal(replay.state, "already-applied");
      if (replay.state === "already-applied") assert.equal(replay.restartRequired, true);
    } finally {
      await first.stop();
    }

    const restarted = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      env: {},
      repoRoot,
      backendPortOverride: 0,
    });
    try {
      const activation = JSON.parse(readFileSync(generationPath, "utf8")) as {
        identity: { settingsRevision: number };
      };
      assert.equal(activation.identity.settingsRevision, 2);
    } finally {
      await restarted.stop();
    }
  }, 20_000);

  it("serves bootstrap, day, and SSE through the real client on 127.0.0.1:<backendPort>", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-"));
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "probe", version: "0.1.0" }));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));

    let runtime: DashboardRuntime;
    try {
      runtime = await composeDashboardRuntime({
        isolation: rebuildRuntimeIsolation,
        env: {},
        repoRoot,
      });
    } catch (error) {
      // The port is a machine-wide singleton; a concurrently running rebuild
      // dashboard legitimately owns it. That is contention, not a regression.
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EADDRINUSE") return;
      throw error;
    }
    cleanups.push(() => runtime.stop());
    assert.equal(runtime.port, rebuildRuntimeIsolation.backendPort);

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
      const subscription = client.subscribeDay({
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
      cleanups.push(() => subscription.close());
    });
    await liveWithDay;
    assert.equal(states[0]?.state, "connecting");
  }, 20_000);
});
