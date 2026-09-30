import { failureStatus } from "../../../src/server/dashboard/routes/failure-status.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { Hono } from "hono";
import { createDashboardClient, StartPlanRefusalError } from "../../../src/dashboard/client/index.js";
import { createRunLaunchService } from "../../../src/dashboard/app/run-launch-model.js";
import { readRerunValues } from "../../../src/services/start/rerun-values.js";
import { registerDataRoutes } from "../../../src/server/dashboard/routes/data.js";
import { registerQueueRoutes } from "../../../src/server/dashboard/routes/queue.js";
import type { DashboardApp } from "../../../src/server/dashboard/routes/api-types.js";
import { composeDataQueries } from "../../../src/server/dashboard/compose/data.js";
import { mappedTransactionHarness, rerunValuesHarness, rerunValuesDeps } from "../fixtures/rerun-values-fixtures.js";
import { absentProbeEvidence } from "../../fixtures/write-sequencer-fixtures.js";
import { makeWorld } from "../server/helpers/dashboard-harness.js";

const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });
function consumer(transaction = false) {
  const h = transaction ? mappedTransactionHarness() : rerunValuesHarness();
  const w = makeWorld(); disposers.push(h.dispose, () => w.dispose());
  const app: DashboardApp = new Hono();
  app.onError((error, c) => { const failure = failureStatus(error); return c.json(failure.body, failure.status); });
  const data = composeDataQueries({ stateRoot: w.stateRoot, projection: w.projection, authority: w.authority,
    descriptors: { resolve: () => h.descriptor }, runReader: h.lifecycle, canonical: { ...rerunValuesDeps(h), reader: h.lifecycle } });
  registerDataRoutes(app, () => data);
  registerQueueRoutes(app, { queue: { day: () => { throw new Error("unrequested queue read"); } }, startPlans: h.planner });
  app.post("/api/v1/commands", async (c) => c.json(h.kernel.execute(await c.req.json())));
  let dropNextResponse = false;
  const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async (url, init) => {
    const response = await app.request(url, init);
    if (dropNextResponse && new URL(url).pathname === "/api/v1/commands") { dropNextResponse = false; throw new Error("lost response after commit"); }
    return response;
  } });
  const launch = createRunLaunchService(client, "local-operator", { uuid: () => h.ids.uuid(), now: () => h.clock.now().toISOString() });
  return { h, client, launch, dropResponse: () => { dropNextResponse = true; } };
}
async function completeSource(h: ReturnType<typeof consumer>["h"], transaction = false) {
  const run = h.start(h.proposal());
  if (transaction) h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  assert.equal((await h.execute(run)).state, "done"); return h.fresh(run);
}

describe("independent Run/Rerun consumer of the released launch service", () => {
  it("reads exact source values, prefills, previews, submits once and replays a lost response through real services", async () => {
    const { h, launch, dropResponse } = consumer(); const source = await completeSource(h);
    const before = h.queueRoots.length;
    const response = await launch.openRerun({ runId: source.envelope.runId, expectedVersion: source.version });
    assert.ok(response.state === "available");
    const draft = launch.prefill(response.snapshot, { selectedValueIndexes: [0], selectedStepKeys: response.snapshot.steps.map((s) => s.key),
      dryRun: false, browserMode: "headless", captureBrowserScreenshots: false });
    assert.deepEqual(draft.submissions, [{ eid: "10812345" }]);
    const plan = await launch.preview(draft);
    assert.equal(h.queueRoots.length, before, "read/prefill/preview never enqueue");
    const command = launch.prepareFinal(plan); dropResponse();
    await assert.rejects(launch.submit(command), /lost response/);
    assert.equal(h.queueRoots.length, before + 1);
    const replay = await launch.replay(command); assert.equal(replay.state, "already-applied");
    assert.equal(h.queueRoots.length, before + 1);
    await assert.rejects(launch.replay({ ...command, requestedBy: "someone-else" }), /divergent|reused/);
    assert.deepEqual(await launch.openRerun({ runId: source.envelope.runId, expectedVersion: source.version - 1 }), { state: "refused", code: "source-stale" });
    assert.throws(() => launch.prefill(response.snapshot, { selectedValueIndexes: [99], selectedStepKeys: ["reading"], dryRun: true, browserMode: "headless", captureBrowserScreenshots: false }), /VALUE_UNAVAILABLE/);
    assert.equal(h.lifecycle.delete({ commandId: h.ids.uuid(), runId: source.envelope.runId, expectedVersion: source.version }).state, "deleted");
    assert.deepEqual(await launch.openRerun({ runId: source.envelope.runId, expectedVersion: source.version }), { state: "refused", code: "target-deleted" });
  });
  it("warning acknowledgement calls the real planner, with no queue effect before final confirmation", async () => {
    const { h, launch } = consumer(true); const source = await completeSource(h, true);
    const selectedStepKeys = h.descriptor.timeline.map((step) => step.key);
    const draft = { workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }], dryRun: true, browserMode: "headless", captureBrowserScreenshots: false,
      selectedStepKeys, rerunSource: { runId: source.envelope.runId, expectedVersion: source.version, intent: "rerun", selectedStepKeys } };
    const before = h.queueRoots.length;
    const warning = await launch.preview(draft); assert.ok(warning.rerun); assert.equal(warning.rerun.warnings.length, 1);
    const acknowledged = await launch.acknowledge(draft, warning);
    assert.equal(acknowledged.rerun?.acknowledgment, warning.rerun.warningDigest);
    assert.equal(h.queueRoots.length, before);
    assert.throws(() => launch.acknowledge({ ...draft, rerunSource: { ...draft.rerunSource, expectedVersion: source.version + 1 } }, warning), /ACK_SOURCE_MISMATCH/);
    assert.equal((await launch.submit(launch.prepareFinal(acknowledged))).state, "applied");
    assert.equal(h.queueRoots.length, before + 1);
  });
  it("refuses an unresolved write source through both source read and planning, without another run", async () => {
    const { h, launch } = consumer(true); const source = await completeSource(h, true);
    const warning = h.proposal(source); assert.ok(warning.rerun);
    const repeat = h.start(h.proposal(source, warning.rerun.warningDigest));
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T123456" } });
    await h.execute(repeat); const unresolved = h.fresh(repeat);
    assert.equal(unresolved.lifecycle.state, "parked-write");
    const count = h.queueRoots.length;
    assert.deepEqual(await launch.openRerun({ runId: unresolved.envelope.runId, expectedVersion: unresolved.version }), { state: "refused", code: "source-ineligible" });
    const selectedStepKeys = h.descriptor.timeline.map((step) => step.key);
    await assert.rejects(launch.preview({ browserMode: "headless", captureBrowserScreenshots: false, workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }], dryRun: true, selectedStepKeys,
      rerunSource: { runId: unresolved.envelope.runId, expectedVersion: unresolved.version, intent: "rerun", selectedStepKeys } }), (error: unknown) => error instanceof StartPlanRefusalError && error.refusalCode === "invalid-state" && /uncertain writes/.test(error.message));
    assert.equal(h.queueRoots.length, count);
  });
  it("preserves archived-source refusal and rejects malformed or substituted prefill evidence", async () => {
    const { h } = consumer(); const source = await completeSource(h);
    const request = { runId: source.envelope.runId, expectedVersion: source.version };
    const archived = readRerunValues({ ...rerunValuesDeps(h), reader: { read: () => ({ state: "present", disposition: "archived", run: source }) } }, request);
    assert.deepEqual(archived, { state: "refused", code: "source-archived" });
    const result = readRerunValues(rerunValuesDeps(h), request); assert.ok(result.state === "available");
    for (const body of [ { ...result, snapshot: { ...result.snapshot, source: { ...result.snapshot.source, version: source.version + 1 } } },
      { ...result, snapshot: { ...result.snapshot, values: [{ state: "available", value: "invented" }] } } ]) {
      const client = createDashboardClient({ baseUrl: "http://localhost", fetchImpl: async () => Response.json(body) });
      await assert.rejects(client.rerunValues(request), /IDENTITY_MISMATCH|wire schema/);
    }
  });
});
