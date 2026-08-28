/**
 * The composed dashboard runtime on the REAL isolation port (3938, from the
 * config value — never a literal at the call site): composeDashboardRuntime
 * opens authority under a temp state root, folds existing JSONL, binds
 * loopback HTTP, and the ONE typed client talks to it over real sockets —
 * bootstrap query, day query, and a live SSE hello/snapshot.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import { createDashboardClient, type SubscriptionState } from "../../../src/dashboard/client/index.js";
import { manualClock } from "../../../src/domain/clock.js";
import { resolveConfigWithProvenance } from "../../../src/domain/config/resolve.js";
import {
  SETTINGS_SCHEMA_HASH,
  SettingsFileRecordSchema,
  deriveSettingsPatchFingerprint,
  type SettingsFileRecord,
} from "../../../src/domain/config/settings.js";
import {
  SettingsCommandRequestSchema,
  deriveSettingsCommandFingerprint,
} from "../../../src/domain/commands.js";
import { createSettingsFileAuthority } from "../../../src/infra/config/settings-file.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import { composeDashboardRuntime, type DashboardRuntime } from "../../../src/server/dashboard/compose.js";
import {
  SETTINGS_RUNTIME_IDENTITY_CORRUPTIONS,
  persistCorruptJournaledSettings,
} from "../fixtures/settings-runtime-corruption-fixtures.js";

const cleanups: (() => Promise<void> | void)[] = [];

function settingsCommand(
  commandId: string,
  requestedAt: string,
  expectedRevision: number,
  patch: unknown,
) {
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

function journalSettings(
  database: AuthorityDatabase,
  command: ReturnType<typeof settingsCommand>,
  record: SettingsFileRecord,
  auditId: string,
): void {
  database.withAuthorityTransaction((repositories) => {
    repositories.commands.insert(command);
    const target = { family: "settings" as const, revision: record.revision };
    repositories.commandAudits.insert({
      auditId,
      request: command,
      result: {
        state: "applied",
        commandId: command.commandId,
        affectedTargets: [target],
        restartRequired: true,
        settingsRevision: record.revision,
        settingsFingerprint: record.settingsFingerprint,
      },
      completedAt: command.requestedAt,
      versionChanges: [{
        target,
        before: command.target.expectedRevision,
        after: record.revision,
      }],
      affectedDependencyIds: [],
    });
    repositories.settingsCurrent.advance({
      revision: record.revision,
      settingsFingerprint: record.settingsFingerprint,
      commandId: command.commandId,
      commandFingerprint: deriveSettingsCommandFingerprint(command),
      auditId,
      committedAt: command.requestedAt,
    });
  });
}

function applyJournaledSettings(
  path: string,
  database: AuthorityDatabase,
  command: ReturnType<typeof settingsCommand>,
  auditId: string,
): Readonly<{ record: SettingsFileRecord; bytes: Buffer }> {
  const authority = createSettingsFileAuthority({
    path,
    validateCandidate: () => undefined,
  });
  const outcome = authority.apply({
    commandId: command.commandId,
    commandFingerprint: deriveSettingsCommandFingerprint(command),
    expectedRevision: command.target.expectedRevision,
    settingsSchemaHash: command.payload.settingsSchemaHash,
    patchFingerprint: command.payload.patchFingerprint,
    patch: command.payload.patch,
  });
  if (outcome.state !== "applied") {
    assert.fail(`settings fixture refused: ${outcome.message}`);
  }
  journalSettings(database, command, outcome.record, auditId);
  outcome.commit();
  return Object.freeze({ record: outcome.record, bytes: readFileSync(path) });
}

function crashSettingsReplacement(
  path: string,
  input: unknown,
  phase: "before-live-rename" | "after-live-rename",
) {
  const moduleUrl = pathToFileURL(join(
    process.cwd(),
    "src",
    "infra",
    "config",
    "settings-file.ts",
  )).href;
  return spawnSync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    `import { renameSync } from "node:fs";
     import { createSettingsFileAuthority } from ${JSON.stringify(moduleUrl)};
     createSettingsFileAuthority({
       path: ${JSON.stringify(path)},
       validateCandidate: () => undefined,
       operations: {
         atomicReplace: (source, destination) => {
           if (destination === ${JSON.stringify(path)}
             && ${JSON.stringify(phase)} === "before-live-rename") {
             process.kill(process.pid, "SIGKILL");
           }
           renameSync(source, destination);
           if (destination === ${JSON.stringify(path)}
             && ${JSON.stringify(phase)} === "after-live-rename") {
             process.kill(process.pid, "SIGKILL");
           }
         },
       },
     }).apply(${JSON.stringify(input)});`,
  ], { encoding: "utf8" });
}

afterEach(async () => {
  // LIFO, like any resource teardown: the subscription closes before the
  // runtime stops, and the runtime stops — including its graceful-drain
  // backup write — before the temp root it writes into is removed.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("composed dashboard runtime on the isolation port", () => {
  it("serves the exact editable settings command schema hash", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-schema-"));
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "probe", version: "0.1.0" }));
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

  it("clears a durable prepare when the process died before the live settings rename", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-pre-rename-settings-"));
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "probe", version: "0.1.0" }));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const path = join(repoRoot, "config", "settings.json");
    const command = settingsCommand(
      "33333333-3333-4333-8333-333333333333",
      clock.now().toISOString(),
      1,
      { browser: { headless: false } },
    );
    const child = crashSettingsReplacement(path, {
      commandId: command.commandId,
      commandFingerprint: deriveSettingsCommandFingerprint(command),
      expectedRevision: command.target.expectedRevision,
      settingsSchemaHash: command.payload.settingsSchemaHash,
      patchFingerprint: command.payload.patchFingerprint,
      patch: command.payload.patch,
    }, "before-live-rename");
    assert.equal(child.signal, "SIGKILL", child.stderr);
    assert.equal(existsSync(path), false);
    assert.equal(existsSync(`${path}.prepare.json`), true);

    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock,
      repoRoot,
    });
    cleanups.push(() => runtime.stop());

    assert.equal(existsSync(path), false);
    assert.equal(existsSync(`${path}.prepare.json`), false);
  });

  it("rolls back a prepared settings rename whose command transaction never committed", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-prepared-settings-"));
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "probe", version: "0.1.0" }));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const path = join(repoRoot, "config", "settings.json");
    const command = settingsCommand(
      "33333333-3333-4333-8333-333333333333",
      clock.now().toISOString(),
      1,
      { browser: { headless: false } },
    );
    const child = crashSettingsReplacement(path, {
      commandId: command.commandId,
      commandFingerprint: deriveSettingsCommandFingerprint(command),
      expectedRevision: command.target.expectedRevision,
      settingsSchemaHash: command.payload.settingsSchemaHash,
      patchFingerprint: command.payload.patchFingerprint,
      patch: command.payload.patch,
    }, "after-live-rename");
    assert.equal(child.signal, "SIGKILL", child.stderr);

    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock,
      repoRoot,
    });
    cleanups.push(() => runtime.stop());

    assert.equal(existsSync(path), false);
    assert.equal(existsSync(`${path}.prepare.json`), false);
  });

  it("keeps exact prepared settings only after their command, audit, and current result committed", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-committed-settings-"));
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "probe", version: "0.1.0" }));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const path = join(repoRoot, "config", "settings.json");
    const command = settingsCommand(
      "33333333-3333-4333-8333-333333333333",
      clock.now().toISOString(),
      1,
      { browser: { headless: false } },
    );
    const child = crashSettingsReplacement(path, {
      commandId: command.commandId,
      commandFingerprint: deriveSettingsCommandFingerprint(command),
      expectedRevision: command.target.expectedRevision,
      settingsSchemaHash: command.payload.settingsSchemaHash,
      patchFingerprint: command.payload.patchFingerprint,
      patch: command.payload.patch,
    }, "after-live-rename");
    assert.equal(child.signal, "SIGKILL", child.stderr);

    const prepare = JSON.parse(readFileSync(`${path}.prepare.json`, "utf8")) as {
      nextSettingsBytesBase64?: unknown;
    };
    assert.equal(typeof prepare.nextSettingsBytesBase64, "string");
    if (typeof prepare.nextSettingsBytesBase64 !== "string") {
      throw new Error("prepared settings fixture has no next bytes");
    }
    const nextBytes = Buffer.from(prepare.nextSettingsBytesBase64, "base64");
    const record = SettingsFileRecordSchema.parse(JSON.parse(nextBytes.toString("utf8")));
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const database = AuthorityDatabase.open(
      { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
      clock,
    );
    try {
      journalSettings(
        database,
        command,
        record,
        "44444444-4444-4444-8444-444444444444",
      );
    } finally {
      database.close();
    }

    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      env: {},
      clock,
      repoRoot,
    });
    cleanups.push(() => runtime.stop());

    assert.deepEqual(readFileSync(path), nextBytes);
    assert.equal(existsSync(`${path}.prepare.json`), false);
  });

  it("refuses an unjournaled persisted settings generation before serving", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-unjournaled-settings-"));
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "probe", version: "0.1.0" }));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const patch = { browser: { headless: false } } as const;
    const patchFingerprint = deriveSettingsPatchFingerprint(patch);
    const command = {
      commandId: "33333333-3333-4333-8333-333333333333",
      requestedAt: clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "dashboard",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint, patch },
    };
    const outcome = createSettingsFileAuthority({
      path: join(repoRoot, "config", "settings.json"),
      validateCandidate: (settings) => {
        resolveConfigWithProvenance({}, settings, clock);
      },
    }).apply({
      commandId: command.commandId,
      commandFingerprint: deriveSettingsCommandFingerprint(command),
      expectedRevision: 1,
      settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      patchFingerprint,
      patch,
    });
    assert.equal(outcome.state, "applied");
    if (outcome.state === "applied") outcome.commit();

    await assert.rejects(async () => {
      const runtime = await composeDashboardRuntime({
        isolation: rebuildRuntimeIsolation,
        backendPortOverride: 0,
        env: {},
        clock,
        repoRoot,
      });
      await runtime.stop();
    }, /settings revision 2 has no durable command journal/u);
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

      const retainedBytes = readFileSync(fixture.settingsPath);
      assert.deepEqual(retainedBytes, fixture.settingsBytes);
      SettingsFileRecordSchema.parse(JSON.parse(retainedBytes.toString("utf8")));
    },
  );

  it("refuses a byte-exact older settings file even when that revision was once journaled", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-stale-settings-"));
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "probe", version: "0.1.0" }));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const clock = manualClock(new Date("2026-08-28T12:00:00.000Z"));
    const path = join(repoRoot, "config", "settings.json");
    const stateRoot = join(repoRoot, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const database = AuthorityDatabase.open(
      { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
      clock,
    );
    let staleBytes: Buffer;
    try {
      staleBytes = applyJournaledSettings(
        path,
        database,
        settingsCommand(
          "33333333-3333-4333-8333-333333333333",
          clock.now().toISOString(),
          1,
          { browser: { headless: false } },
        ),
        "44444444-4444-4444-8444-444444444444",
      ).bytes;
      applyJournaledSettings(
        path,
        database,
        settingsCommand(
          "55555555-5555-4555-8555-555555555555",
          clock.now().toISOString(),
          2,
          { timeouts: { taskMs: 240_000 } },
        ),
        "66666666-6666-4666-8666-666666666666",
      );
    } finally {
      database.close();
    }
    writeFileSync(path, staleBytes);

    await assert.rejects(async () => {
      const runtime = await composeDashboardRuntime({
        isolation: rebuildRuntimeIsolation,
        backendPortOverride: 0,
        env: {},
        clock,
        repoRoot,
      });
      await runtime.stop();
    }, /settings revision 2 is not the exact canonical current settings result/u);
  });

  it("refuses new start plans after settings apply until this dashboard restarts", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-stale-runtime-"));
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "probe", version: "0.1.0" }));
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
      }),
      /dashboard runtime settings are stale; restart activation is required/u,
    );
  });

  it("activates the exact persisted settings generation after a dashboard restart", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-restart-"));
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "probe", version: "0.1.0" }));
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
    const persisted = SettingsFileRecordSchema.parse(JSON.parse(
      readFileSync(join(repoRoot, "config", "settings.json"), "utf8"),
    ));
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
    });

    assert.equal(plan.workflowId, "person-lookup");
    assert.equal(
      plan.fingerprints.configFingerprint,
      resolveConfigWithProvenance({}, persisted.settings, clock).fingerprint,
      "the restarted plan must bind the config resolved from the exact persisted settings generation",
    );
    assert.equal(plan.planned.length, 1);
    assert.deepEqual(plan.refused, []);
  });

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
