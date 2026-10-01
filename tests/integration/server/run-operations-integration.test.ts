import assert from "node:assert/strict";
import { Hono } from "hono";
import { it } from "vitest";
import { StartPlanWireSchema } from "../../../src/domain/dashboard/start-plan.js";
import { CommandResultSchema } from "../../../src/domain/commands.js";
import type { DashboardApp } from "../../../src/server/dashboard/routes/api-types.js";
import { servedPreflightRuntime } from "../../fixtures/preflight/served-runtime.js";
import { installRunOperationsRoutes } from "../../fixtures/run-operations.js";

it("shared Setup admission refuses a late fault without consuming review, then exact replay remains read-only", async () => {
  const setup = await servedPreflightRuntime("healthy");
  try {
    const app: DashboardApp = new Hono(); const h = installRunOperationsRoutes(app, setup);
    const post = (path: string, body: unknown) => app.request(`http://localhost${path}`, { method: "POST",
      headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body) });
    const response = await post("/api/v1/start-plans", { workflowId: setup.scope, submissions: [{ emplId: "10873698" }], dryRun: false });
    assert.equal(response.status, 200);
    const plan = StartPlanWireSchema.parse(await response.json());
    assert.equal(plan.planned.length, 1, JSON.stringify(plan));
    assert.equal(h.runs().length, 0); assert.equal(h.mintedRunIdentities, 0); assert.equal(h.publications, 0);
    const command = { commandId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", requestedAt: setup.clock.now().toISOString(),
      requestedBy: "local-operator", source: "dashboard", family: "start", type: "start-run",
      target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints };
    h.fault(); await setup.runtime.admission.prepare(setup.runtime.currentScope(setup.scope), new AbortController().signal);
    const rejected = CommandResultSchema.parse(await (await post("/api/v1/commands", command)).json());
    assert.equal(rejected.state, "rejected"); assert.equal(h.runs().length, 0); assert.equal(h.publications, 0);
    assert.equal(setup.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    h.repair(); await setup.runtime.admission.prepare(setup.runtime.currentScope(setup.scope), new AbortController().signal);
    const freshCommand = { ...command, commandId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };
    const applied = CommandResultSchema.parse(await (await post("/api/v1/commands", freshCommand)).json());
    assert.equal(applied.state, "applied"); assert.equal(h.publications, 1, JSON.stringify(applied));
    const run = h.runs()[0]; assert.ok(run); assert.equal(run.lifecycle.state, "queued"); assert.equal(run.envelope.dryRun, false);
    h.fault(); await setup.runtime.admission.prepare(setup.runtime.currentScope(setup.scope), new AbortController().signal);
    const before = JSON.stringify({ meta: setup.database.getMeta(), runs: h.runs(), minted: h.mintedRunIdentities });
    const replay = CommandResultSchema.parse(await (await post("/api/v1/commands", freshCommand)).json());
    assert.deepEqual(replay, { ...applied, state: "already-applied" }); assert.equal(h.publications, 1);
    assert.equal(JSON.stringify({ meta: setup.database.getMeta(), runs: h.runs(), minted: h.mintedRunIdentities }), before);
  } finally { setup.close(); }
});
