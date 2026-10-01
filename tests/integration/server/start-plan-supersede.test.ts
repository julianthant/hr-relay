import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { RunRecordService } from "../../../src/backend/runs/run-record-service.js";
import { createCommandKernel } from "../../../src/backend/runs/command-kernel.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { UNWIRED_ARCHIVE_SNAPSHOTS } from "../../fixtures/archive-fixtures.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { launchHarness, launchDescriptor } from "../../fixtures/run-launch-fixtures.js";
import { derivePlannedInputFingerprint, StartPlanRecordSchema } from "../../../src/domain/run/start-plan.js";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
function setup() { const h = launchHarness("supersede-active"); cleanup.push(h.dispose); return h; }
describe("start-specific supersede review is atomic", () => {
  it("names exact generations and replaces them only on final submission; replay is stable", () => {
    const h = setup(); const source = h.start(h.proposal()); const plan = h.proposal();
    assert.deepEqual(plan.planned[0].supersedeTargets, [{ runId: source.envelope.runId, traceId: source.envelope.traceId,
      version: source.version, attempt: source.envelope.attempt, claimGeneration: source.claimGeneration }]);
    assert.equal(h.fresh(source).lifecycle.state, "queued");
    const command = h.command(plan); assert.equal(h.kernel.execute(command).state, "applied");
    assert.deepEqual(h.fresh(source).lifecycle, { state: "terminal", outcome: "superseded", endedAt: h.clock.now().toISOString() });
    assert.equal(h.kernel.execute(command).state, "already-applied"); assert.equal(h.queueRoots.length, 2);
  });
  for (const change of ["added", "removed", "revised", "claimed"] as const) {
    it(`refuses ${change} membership/generation before consumption or publication`, () => {
      const h = setup(); const source = change === "added" ? undefined : h.start(h.proposal());
      const plan = h.proposal();
      if (change === "added") h.start(h.proposal());
      else if (source !== undefined && change === "removed") h.lifecycle.transition({ commandId: h.ids.uuid(), runId: source.envelope.runId,
        expectedVersion: source.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: h.clock.now().toISOString() } });
      else if (source !== undefined && change === "revised") h.kernel.execute({ commandId: h.ids.uuid(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
        source: "dashboard", family: "run", type: "rename", target: { runId: source.envelope.runId, expectedVersion: source.version }, payload: { displayName: "Changed" } });
      else if (source !== undefined) {
        const active = h.database.authority.runtimeConfig.get(); assert.ok(active);
        h.lifecycle.claimNext({ commandId: h.ids.uuid(), workflow: h.descriptor.id, workerId: "proof-worker", runtimeConfig: {
          generation: active.generation, settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } });
      }
      const roots = h.queueRoots; const generation = h.database.getMeta().authorityGeneration;
      const result = h.kernel.execute(h.command(plan)); assert.ok(result.state === "rejected"); assert.equal(result.code, "replan-required");
      assert.deepEqual(h.queueRoots, roots); assert.equal(h.database.getMeta().authorityGeneration, generation);
      assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
    });
  }
  it("late batch drift preserves all earlier active runs and refuses the entire vector", () => {
    const h = setup(); const first = h.start(h.proposal()); const second = h.start(h.proposal(undefined, undefined, true, "10812346"));
    const plan = h.planner.plan({ workflowId: h.descriptor.id, submissions: [{ eid: "10812345" }, { eid: "10812346" }], dryRun: true });
    h.lifecycle.transition({ commandId: h.ids.uuid(), runId: second.envelope.runId, expectedVersion: second.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: h.clock.now().toISOString() } });
    const before = JSON.stringify({ first: h.fresh(first), second: h.fresh(second), roots: h.queueRoots });
    assert.equal(h.kernel.execute(h.command(plan)).state, "rejected");
    assert.equal(JSON.stringify({ first: h.fresh(first), second: h.fresh(second), roots: h.queueRoots }), before);
    assert.equal(h.database.authority.startPlans.get(plan.startPlanId)?.consumedBy, undefined);
  });
  it("historical unconsumed plans without review basis stay readable but require replanning", () => {
    const h = setup(); const wire = h.proposal(); const record = h.database.authority.startPlans.get(wire.startPlanId); assert.ok(record);
    const planned = record.planned.map(({ supersedeTargets: _targets, ...entry }) => entry);
    const old = StartPlanRecordSchema.parse({ ...record, startPlanId: h.planIds.uuid(), planned,
      inputFingerprint: derivePlannedInputFingerprint(planned, record.ingressSchemaHash, record.canonicalInputSchemaHash) });
    h.database.authority.startPlans.create(old);
    const result = h.kernel.execute(h.command({ ...wire, startPlanId: old.startPlanId, fingerprints: { ...wire.fingerprints, inputFingerprint: old.inputFingerprint } }));
    assert.ok(result.state === "rejected"); assert.equal(result.code, "replan-required"); assert.equal(h.queueRoots.length, 0);
  });
  it("reopens and replays an accepted historical plan without a supersede review basis", async () => {
    // The pre-basis persisted format is identical for both policies. Produce
    // an actual accepted command/audit with that format, then reopen under
    // the supersede descriptor to prove replay never runs current admission.
    const h = launchHarness("reject-active"); cleanup.push(h.dispose);
    const plan = h.proposal(); assert.equal(plan.planned[0].supersedeTargets, undefined);
    const command = h.command(plan); const accepted = h.kernel.execute(command); assert.equal(accepted.state, "applied");
    const root = mkdtempSync(join(tmpdir(), "launch-historical-")); const path = join(root, "authority.sqlite");
    await h.database.onlineBackupTo(path);
    const reopened = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "launch-replay-proof" }, h.clock);
    try {
      const descriptor = launchDescriptor("supersede-active");
      const lifecycle = new RunRecordService({ database: reopened, clock: h.clock, ids: h.lifecycleIds, publishQueued: () => { throw new Error("replay published new work"); } });
      const unused = () => { throw new Error("historical replay invoked a runtime operation"); };
      const kernel = createCommandKernel({ lifecycle, authority: reopened, clock: h.clock, ids: h.ids, appVersion: "0.1.0",
        descriptors: { resolve: () => descriptor }, archiveSnapshots: UNWIRED_ARCHIVE_SNAPSHOTS, configIdentity: UNSTORED_CONFIG_IDENTITY,
        intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
        workerRuntime: { planWorkerCount: unused, spawnWorker: unused, refreshBrowser: unused, reopenBrowser: unused }, writeResolution: h.resolution });
      const before = JSON.stringify({ meta: reopened.getMeta(), runs: reopened.authority.runs.listByWorkflow(descriptor.id), plan: reopened.authority.startPlans.get(plan.startPlanId) });
      assert.deepEqual(kernel.execute(command), { ...accepted, state: "already-applied" });
      assert.equal(JSON.stringify({ meta: reopened.getMeta(), runs: reopened.authority.runs.listByWorkflow(descriptor.id), plan: reopened.authority.startPlans.get(plan.startPlanId) }), before);
    } finally { reopened.close(); rmSync(root, { recursive: true, force: true }); }
  });

});
