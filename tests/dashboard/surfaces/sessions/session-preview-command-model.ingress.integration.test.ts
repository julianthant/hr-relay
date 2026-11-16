import { join } from "node:path";
import { createDashboardPortTestWorld } from "../../../support/helpers/backend/dashboard-port-world.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { type DashboardRuntime } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { sessionCommandEffect } from "../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { AuthorityDatabase, releaseAdmissionFixtures } from "../../../support/helpers/admission-fixture.js";
import { scriptedWorkerSpawner, type ScriptedWorkerChild } from "../../../support/helpers/backend/fake-worker-port.js";

it("confirms Sessions intent through HTTP ingress, kernel storage and the served Day effect despite server provenance stamping", async () => {
  const world = createDashboardPortTestWorld(() => undefined, releaseAdmissionFixtures);
  const clock = manualClock(new Date("2026-08-26T09:00:00.000Z"));
  let runtime: DashboardRuntime | undefined;
  let database: AuthorityDatabase | undefined;
  const children: ScriptedWorkerChild[] = [];
  try {
    const profile = await world.createProfileFixture(clock);
    const root = profile.workspace;
    runtime = await world.composeDashboardRuntime({ lifetimeLock: profile.lifetime, ...profile.dashboardInput, preflightRunnerFactory: healthyRuntimePreflightRunners,
      isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {}, clock, repoRoot: root,
      workerProcess: { spawn: scriptedWorkerSpawner(children) } });
    const origin = `http://127.0.0.1:${runtime.port}`;
    const client = createDashboardClient({ baseUrl: origin, fetchImpl: (url, init) => fetch(url, { ...init, headers: { ...init?.headers, origin } }) });
    const request = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: "2020-01-01T00:00:00.000Z", requestedBy: "local-operator", source: "dashboard-sessions",
      family: "worker-browser", type: "plan-worker-count", target: { workflowId: "person-lookup", expectedVersion: 0 }, payload: { desiredWorkers: 1 } });
    const result = await client.executeCommand(request);
    assert.equal(result.state, "applied");
    database = profile.openDatabase({ path: join(profile.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "sessions-ingress-test" }, clock);
    const stored = database.authority.commands.get(request.commandId);
    assert(stored);
    assert.equal(stored.source, "dashboard");
    assert.equal(stored.requestedBy, "local-operator");
    assert.equal(stored.requestedAt, clock.now().toISOString());
    assert.notEqual(stored.requestedAt, request.requestedAt);
    assert.equal(database.authority.commandAudits.findByCommand(request.commandId)?.result.state, "applied");
    assert.equal(children.length, 1, "the plan starts its new member");
    const day = await client.dashboardDay("2026-08-26");
    assert.equal(sessionCommandEffect(day, request), true, "server provenance must not prevent confirmation by the served effect");
    for (const change of [{ target: { workflowId: "person-lookup", expectedVersion: 1 } }, { payload: { desiredWorkers: 2 } }]) {
      assert.equal(sessionCommandEffect(day, CommandRequestSchema.parse({ ...request, ...change })), false);
    }
    const refused = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ ...request, commandId: randomUUID(), requestedBy: "foreign-actor" }) });
    assert.equal(refused.status, 403, "HTTP admission must still authenticate the actor");
    assert.equal((await client.executeCommand(CommandRequestSchema.parse({ ...request, commandId: randomUUID(),
      target: { workflowId: "person-lookup", expectedVersion: 1 }, payload: { desiredWorkers: 0 } }))).state, "applied");
  } finally {
    database?.close();
    await runtime?.stop();
    await world.cleanup();
  }
});
