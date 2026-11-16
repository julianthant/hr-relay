import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { descriptorSetHash } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { createOperatorProjection } from "../../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../../src/backend/app/composition/dashboard/run-detail.js";
import { buildRunDetail } from "../../../../../src/backend/runs/queries/run-detail.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";
import { childExecutionModules, childExecutionRoot } from "../../../../support/fixtures/child-execution-workflows.js";
import { plan1ControlledFailureStores, plan1Leaf } from "../../../../support/fixtures/plan1-operation-workflows.js";
import { createDelegationExecutionWorld } from "../../../../support/helpers/backend/delegation-execution-world.js";

const world = createDelegationExecutionWorld({ root: plan1Leaf, modules: childExecutionModules });
afterEach(world.cleanup);
type Fixture = Awaited<ReturnType<typeof world.fixture>>;

function command(f: Fixture, type: "cancel" | "pause", runId = f.run.envelope.runId) {
  const run = f.database.authority.runs.get(runId);
  assert.ok(run);
  assert.equal(f.execution.kernel.execute({ commandId: randomUUID(), family: "run", type,
    source: "dashboard", requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(),
    target: { runId, expectedVersion: run.version } }).state, "applied");
}

function detailOf(f: Fixture, runId = f.run.envelope.runId) {
  const descriptors = { resolve: (id: string) => f.modules.find(module => module.descriptor.id === id)?.descriptor };
  const projection = createOperatorProjection({ database: f.database, stateRoot: f.stateRoot, clock: f.clock,
    reader: f.execution.lifecycle, appVersion: "0.1.0", descriptorSetHash: descriptorSetHash(f.modules.map(module => module.descriptor.contractFingerprint)),
    ledger: createTransactionHistory(f.database.authority), descriptors });
  projection.ingestFromTimeline();
  const deps = createOperatorRunDetail({ database: f.database, stateRoot: f.stateRoot, projection,
    runReader: f.execution.lifecycle, canonical: { database: f.database, reader: f.execution.lifecycle, descriptors } });
  return buildRunDetail({ ...deps, descriptors }, runId);
}

it("serves one run-level ending and cancels the first stage when stopped before any action", async () => {
  const f = await world.fixture();
  assert.equal(detailOf(f).cancellation, undefined);
  f.clock.advanceWall(1_000);
  command(f, "cancel");

  const detail = detailOf(f);
  assert.deepEqual(detail.cancellation, { title: "Run cancelled", at: f.clock.now().toISOString(),
    requestedBy: "operator", outcome: "You cancelled this run." });
  assert.deepEqual(detail.timeline.events, [], "the run ending is not a workflow node");
  assert.deepEqual(detail.timeline.steps?.map(step => step.state), ["cancelled", "pending"]);
});

it("attributes a cascaded cancellation to the parent without inventing a workflow event", async () => {
  const f = await world.fixture(undefined, "ok", { root: childExecutionRoot, modules: childExecutionModules });
  await f.execution.step(f.run, world.SIGNAL);
  const children = f.database.authority.runs.listChildren(f.run.envelope.runId);
  assert.ok(children.length > 0);
  f.clock.advanceWall(1_000);
  command(f, "cancel");
  for (const child of children) {
    const detail = detailOf(f, child.envelope.runId);
    assert.deepEqual(detail.cancellation, { title: "Run cancelled", at: f.clock.now().toISOString(),
      requestedBy: "parent", outcome: "This run was cancelled when its parent was stopped." });
    assert.deepEqual(detail.timeline.events, []);
    assert.equal(detail.timeline.steps?.[0]?.state, "cancelled");
  }
  assert.equal(detailOf(f).cancellation?.requestedBy, "operator");
});

it("credits a direct cancellation of a child to the operator", async () => {
  const f = await world.fixture(undefined, "ok", { root: childExecutionRoot, modules: childExecutionModules });
  await f.execution.step(f.run, world.SIGNAL);
  const child = f.database.authority.runs.listChildren(f.run.envelope.runId)[0];
  assert.ok(child);
  command(f, "cancel", child.envelope.runId);
  assert.equal(detailOf(f, child.envelope.runId).cancellation?.requestedBy, "operator");
});

it("serves no cancellation ending for a failed run", async () => {
  const f = await world.fixture(undefined, "fail");
  await f.execution.execute(f.run, world.SIGNAL);
  const detail = detailOf(f);
  assert.equal(detail.header.status, "failed");
  assert.equal(detail.cancellation, undefined);
  assert.deepEqual(detail.timeline.steps?.map(step => step.state), ["failed", "pending"]);
});

it.each([undefined, "RUN_STALE_QUEUE_CANCELLED", "RUN_LOGOUT_CANCELLED"] as const)("preserves the ending without guessing an unavailable requester (%s)", async code => {
  const f = await world.fixture();
  const at = f.clock.now().toISOString();
  assert.equal(f.execution.lifecycle.transition({ commandId: randomUUID(), runId: f.run.envelope.runId,
    expectedVersion: f.run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: at,
      ...(code === undefined ? {} : { errorSummary: `${code}: ${ERROR_CATALOG[code].text}` }) } }).state, "applied");
  f.clock.advanceWall(30_000);
  const detail = detailOf(f);
  assert.equal(detail.header.status, "cancelled");
  assert.deepEqual(detail.cancellation, { title: "Run cancelled", at, requestedBy: "unavailable", outcome: "This run was cancelled." });
  assert.deepEqual(detail.timeline.steps?.map(step => step.state), ["cancelled", "pending"]);
});

it("keeps completed steps and ends a run cancelled after its first task", async () => {
  const stores = plan1ControlledFailureStores(() => {
    command(f, "pause");
    return false;
  });
  const f = await world.fixture(stores);
  await f.execution.execute(f.run, world.SIGNAL);
  const paused = detailOf(f);
  assert.equal(paused.cancellation, undefined);
  assert.deepEqual(paused.timeline.steps?.map(step => step.state), ["done", "pending"]);

  f.clock.advanceWall(2_000);
  command(f, "cancel");
  const cancelled = detailOf(f);
  assert.deepEqual(cancelled.timeline.events, paused.timeline.events);
  assert.deepEqual(cancelled.timeline.steps?.[0], paused.timeline.steps?.[0]);
  assert.deepEqual(cancelled.timeline.steps?.map(step => step.state), ["done", "cancelled"]);
  assert.deepEqual(cancelled.cancellation, { title: "Run cancelled", at: f.clock.now().toISOString(),
    requestedBy: "operator", outcome: "You cancelled this run." });
});
