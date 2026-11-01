import { afterAll, afterEach, describe, it } from "vitest";
import { createClonedProfileFixtures } from "../../../../support/helpers/admission-fixture.js";
import { Hono } from "hono";
import assert from "node:assert/strict";
import { composeDataQueries } from "../../../../../src/backend/app/composition/dashboard/data.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { registerDataRoutes } from "../../../../../src/backend/transports/http/routes/data.js";
import { RerunValuesResponseSchema } from "../../../../../src/models/dashboard/rerun-values.js";
import { rerunValuesHarness } from "../../../../support/fixtures/rerun-values-fixtures.js";
import { makeWorld } from "../../../../support/helpers/backend/dashboard-harness.js";

const profileFixtures = createClonedProfileFixtures();
afterAll(() => profileFixtures.close());

const disposers: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });
async function setup() {
  const h = await rerunValuesHarness(profileFixtures.create); const w = await makeWorld({ profileFixture: profileFixtures.create }); disposers.push(h.dispose, async () => await w.dispose());
  const queued = h.start(h.proposal()); assert.equal((await h.execute(queued)).state, "done"); const run = h.fresh(queued);
  const deps = { stateRoot: w.stateRoot, timeline:w.timeline, projection: w.projection, authority: w.authority,
    descriptors: { resolve: () => undefined }, runReader: h.lifecycle,
    canonical: { reader: h.lifecycle, database: h.database, descriptors: { resolve: () => h.descriptor } } };
  const data = composeDataQueries(deps); const app: DashboardApp = new Hono();
  registerDataRoutes(app, () => data);
  app.get("/api/v1/runs/:runId/:section", (c) => c.json({ generic: true }));
  return { h, run, data, deps, app, path: `/api/v1/runs/${run.envelope.runId}/rerun-values` };
}
describe("Rerun values HTTP and composition", () => {
  it("uses the literal data route and preserves exact source coordinates across JSON", async () => {
    const { app, path, run, h } = await setup(); const generation = h.database.getMeta().authorityGeneration;
    const response = await app.request(`${path}?expectedVersion=${run.version}`);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const result = RerunValuesResponseSchema.parse(await response.json()); assert.ok(result.state === "available");
    assert.equal(result.snapshot.source.runId, run.envelope.runId); assert.equal(result.snapshot.source.version, run.version);
    const value = result.snapshot.values[0]; assert.ok(value?.state === "available");
    const selectedStepKeys = h.descriptor.timeline.map(({ key }) => key);
    const plan = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: value.value }], dryRun: false, selectedStepKeys,
      rerunSource: { runId: result.snapshot.source.runId, expectedVersion: result.snapshot.source.version, intent: "rerun", selectedStepKeys,
        copiedFrom: [{ nodeId: value.nodeId, fieldPath: value.fieldPath, targetFieldPath: value.targetFieldPath }] } });
    assert.equal(plan.rerun?.source.copiedFrom?.[0]?.nodeId, value.nodeId);
    assert.equal(h.database.getMeta().authorityGeneration, generation + 1);
  });
  for (const query of ["", "?expectedVersion=0", "?expectedVersion=-1", "?expectedVersion=1.5", "?expectedVersion=1&expectedVersion=2", "?expectedVersion=999999999999999999999999"]) {
    it(`refuses invalid version query ${query}`, async () => {
      const { app, path, h } = await setup(); const before = h.database.getMeta().authorityGeneration;
      const response = await app.request(`${path}${query}`); assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "RERUN_VALUES_REQUEST_INVALID" });
      assert.equal(h.database.getMeta().authorityGeneration, before);
    });
  }
  it("returns typed stale and absent refusals without mutation", async () => {
    const { app, path, run, h } = await setup(); const before = h.database.getMeta().authorityGeneration;
    const stale = await app.request(`${path}?expectedVersion=${run.version - 1}`); assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), { state: "refused", code: "source-stale" });
    const absent = await app.request(`/api/v1/runs/${h.ids.uuid()}/rerun-values?expectedVersion=1`); assert.equal(absent.status, 404);
    assert.deepEqual(await absent.json(), { state: "refused", code: "target-not-found" });
    assert.equal(h.database.getMeta().authorityGeneration, before);
  });
  it("requires the explicit canonical bundle, even when old read ports exist", async () => {
    const { deps, run } = await setup(); const { canonical: _canonical, ...contextOnly } = deps;
    assert.throws(() => composeDataQueries(contextOnly).rerunValues({ runId: run.envelope.runId, expectedVersion: run.version }), /RERUN_VALUES_NOT_CONFIGURED/u);
  });
  it("serves canonical Context without spans and marks absent requeue evidence explicitly", async () => {
    const { data, run, deps } = await setup();
    assert.equal(deps.projection.runFold(run.envelope.runId), undefined);
    const context = data.contextData(run.envelope.runId);
    assert.ok(context.section === "context-data");
    assert.equal(context.payload.runId, run.envelope.runId);
    const attempts = data.contextAttempts(run.envelope.runId);
    assert.ok(attempts.section === "context-attempts");
    assert.deepEqual(attempts.payload.entries.slice(0, 2), [
      { label: "current-attempt", valueRedacted: String(run.envelope.attempt) },
      { label: "requeues", valueRedacted: "not recorded" },
    ]);
  });

});
