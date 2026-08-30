/**
 * The composed dashboard runtime on the REAL isolation port (3938, from the
 * config value — never a literal at the call site): composeDashboardRuntime
 * opens authority under a temp state root, folds existing JSONL, binds
 * loopback HTTP, and the ONE typed client talks to it over real sockets —
 * bootstrap query, day query, and a live SSE hello/snapshot.
 */
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import { createDashboardClient, type SubscriptionState } from "../../../src/dashboard/client/index.js";
import {
  CURRENT_SETTINGS_SCHEMA_HASH,
  deriveSettingsPatchFingerprint,
} from "../../../src/domain/config/settings.js";
import { composeDashboardRuntime, type DashboardRuntime } from "../../../src/server/dashboard/compose.js";

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  // LIFO, like any resource teardown: the subscription closes before the
  // runtime stops, and the runtime stops — including its graceful-drain
  // backup write — before the temp root it writes into is removed.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("composed dashboard runtime on the isolation port", () => {
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
      frontendPortOverride: 0,
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
    copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
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
      if (error instanceof Error
        && error.message === "dashboard preflight refused startup: ports.available: reserved backend port is occupied by an unrecognized process") return;
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
