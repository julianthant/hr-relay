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
import { createDashboardClient, type SubscriptionState } from "../../../src/dashboard/client/index.js";
import { composeDashboardRuntime, type DashboardRuntime } from "../../../src/server/dashboard/compose.js";

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("composed dashboard runtime on the isolation port", () => {
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
    assert.deepEqual(bootstrap.workflows.map(({ id }) => id), ["person-lookup"]);
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
