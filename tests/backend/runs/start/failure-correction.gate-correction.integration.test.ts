import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { buildRerunPlan, RerunRefusedError } from "../../../../src/backend/runs/start/rerun.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { launchDescriptor, launchHarness } from "../../../support/fixtures/run-launch-fixtures.js";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });

type Harness = Awaited<ReturnType<typeof launchHarness>>;

async function parkedAtGate() {
  const h = await launchHarness(); disposers.push(h.dispose);
  h.registerDescriptor(launchDescriptor("reject-active", { gateDependency: true, gateCorrection: true }));
  const run = h.start(h.proposal(undefined, undefined, true));
  await h.execute(run);
  const source = h.fresh(run);
  assert.equal(source.lifecycle.state, "parked-gate");
  return { h, source };
}

function correction(h: Harness, source: RunRecord, change: Readonly<{ submissions?: unknown[]; dryRun?: boolean; gateId?: string; inputField?: string;
  expectedVersion?: number; failureCorrection?: boolean }> = {}) {
  const selectedStepKeys = h.descriptor.timeline.map(step => step.key);
  return { workflowId: h.descriptor.id, submissions: change.submissions ?? [{ memo: "corrected" }], dryRun: change.dryRun ?? true, selectedStepKeys,
    rerunSource: { runId: source.envelope.runId, expectedVersion: change.expectedVersion ?? source.version, intent: "rerun", selectedStepKeys,
      gateCorrection: { gateId: change.gateId ?? "approval", inputField: change.inputField ?? "memo" },
      ...(change.failureCorrection === true ? { failureCorrection: { failureId: "f", inputField: "memo" } } : {}) } };
}
const refusedWith = (code: string) => (error: unknown) => error instanceof RerunRefusedError && error.code === code;
const supersedeTarget = (run: RunRecord) => ({ runId: run.envelope.runId, traceId: run.envelope.traceId, version: run.version,
  attempt: run.envelope.attempt, claimGeneration: run.claimGeneration });

describe("gate correction plan", () => {
  it("accepts one declared value from a run parked at that gate and reviews it as the single supersede target", async () => {
    const { h, source } = await parkedAtGate();
    const plan = h.planner.plan(correction(h, source));
    assert.deepEqual(plan.refused, []);
    assert.equal(plan.planned.length, 1);
    assert.deepEqual(plan.planned[0]?.supersedeTargets, [supersedeTarget(source)]);
    assert.deepEqual(plan.rerun?.source.gateCorrection, { gateId: "approval", inputField: "memo" });
    assert.equal(plan.dryRun, true);
  });

  it("refuses a stale source, another gate, an undeclared or extra field, a bad value, changed options and a mixed source", async () => {
    const { h, source } = await parkedAtGate();
    assert.throws(() => h.planner.plan(correction(h, source, { expectedVersion: source.version + 1 })), refusedWith("source-stale"));
    assert.throws(() => h.planner.plan(correction(h, source, { gateId: "read" })), refusedWith("invalid-state"));
    assert.throws(() => h.planner.plan(correction(h, source, { inputField: "eid" })), refusedWith("invalid-value"));
    for (const submissions of [[{ memo: "corrected", eid: "10812345" }], [{ memo: "Corrected" }], [{}], [{ memo: "corrected" }, { memo: "other" }]]) {
      assert.throws(() => h.planner.plan(correction(h, source, { submissions })), refusedWith("invalid-value"));
    }
    assert.throws(() => h.planner.plan(correction(h, source, { dryRun: false })), refusedWith("invalid-value"));
    assert.throws(() => h.planner.plan(correction(h, source, { failureCorrection: true })), refusedWith("invalid-value"));
    assert.equal(h.fresh(source).lifecycle.state, "parked-gate");
  });

  it("refuses a source that is not parked at the gate", async () => {
    const { h } = await parkedAtGate();
    const queued = h.start(h.proposal(undefined, undefined, true, "10812346"));
    assert.throws(() => h.planner.plan(correction(h, queued)), refusedWith("invalid-state"));
  });

  it("enters the declared field only through its gate correction", async () => {
    const { h } = await parkedAtGate();
    assert.throws(() => h.proposal(undefined, undefined, true, "10812346", "typed"), refusedWith("invalid-value"));
  });

  it("refuses a source with an uncertain write on its item", async () => {
    const { h, source } = await parkedAtGate();
    const plan = h.planner.plan(correction(h, source));
    const stored = h.database.authority.startPlans.get(plan.startPlanId);
    const rerun = stored?.rerun;
    assert.ok(stored !== undefined && rerun !== undefined);
    const uncertain = { ...h.database.authority, writeIntents: { ...h.database.authority.writeIntents,
      listAttemptingByItem: () => [{ writeIntentId: "attempting" }] } } as unknown as AuthorityRepositories;
    assert.throws(() => buildRerunPlan(uncertain, h.descriptor, rerun.source, stored.planned), refusedWith("invalid-state"));
  });
});

describe("gate correction start", () => {
  it("supersedes the parked run and queues one replacement with the typed value in one transaction; a replay adds nothing", async () => {
    const { h, source } = await parkedAtGate();
    const plan = h.planner.plan(correction(h, source));
    const command = h.command(plan);
    assert.equal(h.kernel.execute(command).state, "applied");
    assert.deepEqual(h.fresh(source).lifecycle, { state: "terminal", outcome: "superseded", endedAt: h.clock.now().toISOString() });
    const runs = h.database.authority.runs.listByWorkflow(h.descriptor.id);
    assert.equal(runs.length, 2);
    const replacement = runs.find(run => run.envelope.runId !== source.envelope.runId);
    assert.ok(replacement);
    assert.equal(replacement.lifecycle.state, "queued");
    assert.equal(replacement.envelope.itemId, source.envelope.itemId);
    assert.equal(replacement.envelope.dryRun, true);
    assert.deepEqual(replacement.input.parsed.value, { eid: "10812345", memo: "corrected" });
    assert.deepEqual(replacement.envelope.sourceBound?.source.gateCorrection, { gateId: "approval", inputField: "memo" });
    const closing = () => h.database.authority.timelineEvents.page({ runId: source.envelope.runId }).flatMap(record =>
      record.payload.kind === "note" && record.payload.note.message.startsWith("Replaced:") ? [record.payload.note.message] : []);
    assert.deepEqual(closing(), ["Replaced: Relay is looking up the Memo you entered."]);
    assert.equal(h.kernel.execute(command).state, "already-applied");
    assert.equal(h.database.authority.runs.listByWorkflow(h.descriptor.id).length, 2);
    assert.equal(closing().length, 1);
  });

  it("refuses replan-required when the parked run changed after the preview, leaving it parked and starting nothing", async () => {
    const { h, source } = await parkedAtGate();
    const plan = h.planner.plan(correction(h, source));
    assert.equal(h.kernel.execute({ commandId: h.ids.uuid(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
      source: "dashboard", family: "run", type: "rename", target: { runId: source.envelope.runId, expectedVersion: source.version },
      payload: { displayName: "Changed" } }).state, "applied");
    const result = h.kernel.execute(h.command(plan));
    assert.ok(result.state === "rejected");
    assert.equal(result.code, "replan-required");
    assert.equal(h.fresh(source).lifecycle.state, "parked-gate");
    assert.equal(h.database.authority.runs.listByWorkflow(h.descriptor.id).length, 1);
    assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
  });
});
