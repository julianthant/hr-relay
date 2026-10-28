import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { composeDashboardRuntime, type DashboardRuntime } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { sessionCommandApplication } from "../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { AuthorityDatabase, installationAdmission, releaseAdmissionFixture } from "../../../support/helpers/admission-fixture.js";

it("confirms immutable Sessions intent through HTTP ingress, kernel storage and served Day despite server provenance stamping", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-sessions-ingress-")));
  const clock = manualClock(new Date("2026-08-26T09:00:00.000Z"));
  let runtime: DashboardRuntime | undefined;
  let database: AuthorityDatabase | undefined;
  try {
    copyFileSync("package.json", join(root, "package.json"));
    copyFileSync("package-lock.json", join(root, "package-lock.json"));
    runtime = await composeDashboardRuntime({ lifetimeLock: await runtimeLifetimeLock(), admission: installationAdmission(root), preflightRunnerFactory: healthyRuntimePreflightRunners,
      isolation: rebuildRuntimeIsolation, backendPortOverride: 0, frontendPortOverride: 0, env: {}, clock, repoRoot: root,
      workerProcess: { spawn: () => { throw new Error("plan must not spawn a worker"); } } });
    const origin = `http://127.0.0.1:${runtime.port}`;
    const client = createDashboardClient({ baseUrl: origin, fetchImpl: (url, init) => fetch(url, { ...init, headers: { ...init?.headers, origin } }) });
    const request = CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: "2020-01-01T00:00:00.000Z", requestedBy: "local-operator", source: "dashboard-sessions",
      family: "worker-browser", type: "plan-worker-count", target: { workflowId: "person-lookup", expectedVersion: 0 }, payload: { desiredWorkers: 1 } });
    const result = await client.executeCommand(request);
    assert.equal(result.state, "applied");
    database = AuthorityDatabase.open({ path: join(root, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "sessions-ingress-test" }, clock);
    const stored = database.authority.workerControls.get(request.commandId);
    assert(stored);
    assert.equal(stored.request.source, "dashboard");
    assert.equal(stored.request.requestedBy, "local-operator");
    assert.equal(stored.request.requestedAt, clock.now().toISOString());
    assert.notEqual(stored.request.requestedAt, request.requestedAt);
    assert.equal(stored.phase.state, "succeeded");
    assert(stored.auditedAt);
    assert.deepEqual(database.authority.commands.get(request.commandId), stored.request);
    const day = await client.dashboardDay("2026-08-26");
    assert.deepEqual(day.workerOperations.find(record => record.commandId === request.commandId), stored);
    assert.deepEqual(sessionCommandApplication(day, request), result, "server provenance must not prevent exact intent confirmation");
    for (const change of [{ target: { workflowId: "person-lookup", expectedVersion: 1 } }, { payload: { desiredWorkers: 2 } }, { requestedBy: "foreign-actor" }, { reason: "different intent" }]) {
      assert.equal(sessionCommandApplication(day, CommandRequestSchema.parse({ ...request, ...change })), undefined);
    }
    const refused = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ ...request, commandId: randomUUID(), requestedBy: "foreign-actor" }) });
    assert.equal(refused.status, 403, "HTTP admission must still authenticate the actor");
  } finally {
    database?.close();
    await runtime?.stop();
    releaseAdmissionFixture(root);
    rmSync(root, { recursive: true, force: true });
  }
});
