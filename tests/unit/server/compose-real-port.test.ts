/**
 * The composed dashboard runtime on the REAL isolation port (3938, from the
 * config value — never a literal at the call site): composeDashboardRuntime
 * opens authority under a temp state root, folds existing JSONL, binds
 * loopback HTTP, and the ONE typed client talks to it over real sockets —
 * bootstrap query, day query, and a live SSE hello/snapshot.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import { createDashboardClient, type SubscriptionState } from "../../../src/dashboard/client/index.js";
import { manualClock } from "../../../src/domain/clock.js";
import { resolveConfigWithProvenance } from "../../../src/domain/config/resolve.js";
import {
  SETTINGS_SCHEMA_HASH,
  deriveSettingsPatchFingerprint,
} from "../../../src/domain/config/settings.js";
import { deriveSettingsCommandFingerprint } from "../../../src/domain/commands.js";
import { createSettingsFileAuthority } from "../../../src/infra/config/settings-file.js";
import { composeDashboardRuntime, type DashboardRuntime } from "../../../src/server/dashboard/compose.js";

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  // LIFO, like any resource teardown: the subscription closes before the
  // runtime stops, and the runtime stops — including its graceful-drain
  // backup write — before the temp root it writes into is removed.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("composed dashboard runtime on the isolation port", () => {
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
