import { retainAuthoritySourceClosure } from '../../../../src/backend/storage/source-closure.js';
import { runClaim } from '../../../../src/models/run/record.js';
import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { NO_INTAKE_PROJECTIONS,UNSTORED_CONFIG_IDENTITY,UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { launchDescriptor,launchHarness } from "../../../support/fixtures/run-launch-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
type HeldSupersedeFixture = { h: ReturnType<typeof launchHarness>; reopened?: AuthorityDatabase; primary?: { error: unknown }; failure?: Error; disposeAttempted: boolean };
const retainedSupersedeOwners = new Set<HeldSupersedeFixture>();
function setup(enqueue: Parameters<typeof launchHarness>[0] = "supersede-active") {
  const h = launchHarness(enqueue);
  const held: HeldSupersedeFixture = { h, disposeAttempted: false };
  retainedSupersedeOwners.add(held);
  cleanup.push(() => {
    if (held.failure !== undefined) throw held.failure;
    if (held.disposeAttempted) return;
    held.disposeAttempted = true;
    try { held.reopened?.close(); h.dispose(); retainedSupersedeOwners.delete(held); }
    catch (error) {
      held.primary = { error };
      held.failure = retainAuthoritySourceClosure([error], { admission: held });
      throw held.failure;
    }
  });
  return { h, held };
}
describe("start-specific supersede review is atomic", () => {
  it("names exact generations and replaces them only on final submission; replay is stable", () => {
    const { h, held } = setup();
    try {
      const source = h.start(h.proposal()); const plan = h.proposal();
    assert.deepEqual(plan.planned[0].supersedeTargets, [{ runId: source.envelope.runId, traceId: source.envelope.traceId,
      version: source.version, attempt: source.envelope.attempt, claimGeneration: source.claimGeneration }]);
    assert.equal(h.fresh(source).lifecycle.state, "queued");
    const command = h.command(plan); assert.equal(h.kernel.execute(command).state, "applied");
    assert.deepEqual(h.fresh(source).lifecycle, { state: "terminal", outcome: "superseded", endedAt: h.clock.now().toISOString() });
    assert.equal(h.kernel.execute(command).state, "already-applied"); assert.equal(h.queueRoots.length, 2);
    } catch (error) {
      held.primary = { error };
      held.failure = retainAuthoritySourceClosure([error], { admission: held });
      throw held.failure;
    }
  });
  for (const change of ["added", "removed", "revised", "claimed"] as const) {
    it(`refuses ${change} membership/generation before consumption or publication`, () => {
      const { h, held } = setup();
    try {
      const source = change === "added" ? undefined : h.start(h.proposal());
      const plan = h.proposal();
      if (change === "added") h.start(h.proposal());
      else if (source !== undefined && change === "removed") h.lifecycle.transition({ commandId: h.ids.uuid(), runId: source.envelope.runId,
        expectedVersion: source.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: h.clock.now().toISOString() } });
      else if (source !== undefined && change === "revised") h.kernel.execute({ commandId: h.ids.uuid(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
        source: "dashboard", family: "run", type: "rename", target: { runId: source.envelope.runId, expectedVersion: source.version }, payload: { displayName: "Changed" } });
      else if (source !== undefined) {
        const active = h.database.authority.runtimeConfig.get(); assert.ok(active);
        const { workerId, workerLifetime } = testWorkerLifetime(h.database, h.descriptor.id, 1);
        const claimed = h.lifecycle.claimNext({ commandId: h.ids.uuid(), workflow: h.descriptor.id, workerId, workerLifetime, runtimeConfig: {
          generation: active.generation, settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } });
        assert.ok(claimed.state === "applied" || claimed.state === "applied-already");
      }
      const roots = h.queueRoots; const generation = h.database.getMeta().authorityGeneration;
      const result = h.kernel.execute(h.command(plan)); assert.ok(result.state === "rejected"); assert.equal(result.code, "replan-required");
      assert.deepEqual(h.queueRoots, roots); assert.equal(h.database.getMeta().authorityGeneration, generation);
      assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
      if (source !== undefined && change === "claimed") {
        const current = h.fresh(source), claim = runClaim(current);
        assert.ok(claim);
        assert.deepEqual(h.database.authority.writeIntents.listByRun(source.envelope.runId), []);
        assert.equal(h.lifecycle.requeue({ commandId: h.ids.uuid(), runId: current.envelope.runId, expectedVersion: current.version,
          claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, cause: 'recovery' }).state, 'applied');
        assert.equal(runClaim(h.fresh(source)), undefined);
      }
    } catch (error) {
      held.primary = { error };
      held.failure = retainAuthoritySourceClosure([error], { admission: held });
      throw held.failure;
    }
  });
  }
  it("late batch drift preserves all earlier active runs and refuses the entire vector", () => {
    const { h, held } = setup();
    try {
      const first = h.start(h.proposal()); const second = h.start(h.proposal(undefined, undefined, true, "10812346"));
    const plan = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }, { eid: "10812346" }], dryRun: true });
    h.lifecycle.transition({ commandId: h.ids.uuid(), runId: second.envelope.runId, expectedVersion: second.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: h.clock.now().toISOString() } });
    const before = JSON.stringify({ first: h.fresh(first), second: h.fresh(second), roots: h.queueRoots });
    assert.equal(h.kernel.execute(h.command(plan)).state, "rejected");
    assert.equal(JSON.stringify({ first: h.fresh(first), second: h.fresh(second), roots: h.queueRoots }), before);
    assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    } catch (error) {
      held.primary = { error };
      held.failure = retainAuthoritySourceClosure([error], { admission: held });
      throw held.failure;
    }
  });
  it("reopens and replays an accepted plan without a supersede review basis", () => {

    const { h, held } = setup("reject-active");
    try {
    const plan = h.proposal(); assert.equal(plan.planned[0].supersedeTargets, undefined);
    const command = h.command(plan); const accepted = h.kernel.execute(command); assert.equal(accepted.state, "applied");
    h.database.close();
    const reopened = AuthorityDatabase.open({ path: h.authorityPath, busyTimeoutMs: 250, migrationOwner: "launch-replay-proof" }, h.clock);
    held.reopened = reopened;
      const descriptor = launchDescriptor("supersede-active");
      const lifecycle = new RunRecordService({ database: reopened, clock: h.clock, ids: h.lifecycleIds, publishQueued: () => { throw new Error("replay published new work"); } });
      const kernel = createCommandKernel({ lifecycle, authority: reopened, clock: h.clock, ids: h.ids, appVersion: "0.1.0",
        descriptors: { resolve: () => descriptor }, configIdentity: UNSTORED_CONFIG_IDENTITY,
        intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
        workerRuntime: { pool: { planPoolWorkerCount: () => { throw new Error("unexpected worker command"); }, spawnPoolWorker: () => { throw new Error("unexpected worker command"); }, refreshPoolBrowser: () => { throw new Error("unexpected worker command"); }, reopenPoolBrowser: () => { throw new Error("unexpected worker command"); }, stopPoolWorker: () => { throw new Error("unexpected worker command"); }, pausePoolWorker: () => { throw new Error("unexpected worker command"); }, resumePoolWorker: () => { throw new Error("unexpected worker command"); } } }, writeResolution: h.resolution });
      const before = JSON.stringify({ meta: reopened.getMeta(), runs: reopened.authority.runs.listByWorkflow(descriptor.id), plan: reopened.authority.startPlans.get(plan.startPlanId) });
      assert.deepEqual(kernel.execute(command), { ...accepted, state: "already-applied" });
      assert.equal(JSON.stringify({ meta: reopened.getMeta(), runs: reopened.authority.runs.listByWorkflow(descriptor.id), plan: reopened.authority.startPlans.get(plan.startPlanId) }), before);

    } catch (error) {
      held.primary = { error };
      held.failure = retainAuthoritySourceClosure([error], { admission: held });
      throw held.failure;
    }
  });

});
