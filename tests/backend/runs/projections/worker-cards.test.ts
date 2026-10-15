import { WorkerControlRecordSchema } from "../../../../src/models/run/worker-control.js";
import { workerPoolMember } from "../../../../src/models/run/worker-slot.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { workerCardOf } from "../../../../src/backend/runs/projections/worker-cards.js";
import { WorkerSlotRecordSchema } from "../../../../src/models/run/worker-slot.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { canStopWorker, workerDirectiveNote, workerElapsedSeconds } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { createWorkerLeaseFixtures } from "../../../support/helpers/backend/worker-lease-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

const STARTED = "2026-08-20T16:00:00.000Z";
const RUN = QUEUED_RUN.envelope.runId;
const TRACE = QUEUED_RUN.envelope.traceId;
const { leaseOf } = createWorkerLeaseFixtures(STARTED);
const member = WorkerSlotRecordSchema.parse({ workerId: "person-lookup-worker-1", workflow: "person-lookup",
  ordinal: 1, poolIndex: 1, membershipRevision: 1, phase: "idle", retiredAt: null,
  retirementCommandId: null, reservationCommandId: null, createdAt: STARTED, updatedAt: STARTED });
const running = RunRecordSchema.parse({ ...QUEUED_RUN, claimGeneration: 1, lifecycle: { state: "running", workerId: member.workerId,
  claimedAt: STARTED, heartbeatAt: STARTED, currentNodeId: "lookup", workerLifetime: { leaseGeneration: 1, membershipRevision: 1 } } });
function card(input: Partial<Parameters<typeof workerCardOf>[0]> = {}) {
  return workerCardOf({ lease: leaseOf(), member, ownerAlive: true, fold: undefined, resolveRun: () => undefined, ...input });
}

describe("the exact current worker authority card", () => {
  it("refuses a lease missing required launch-time browser systems", () => {
    assert.throws(() => leaseOf({ browserSystems: undefined }));
  });

  it("serves exactly the six phases from current owner observations", () => {
    const cases = [
      [{ state: "busy", startedAt: STARTED, heartbeatAt: STARTED, runId: RUN }, "running"],
      [{ state: "starting", startedAt: STARTED }, "starting"],
      [{ state: "idle", startedAt: STARTED, heartbeatAt: STARTED }, "idle"],
      [{ state: "waiting", startedAt: STARTED, heartbeatAt: STARTED, activity: "authenticating", runId: RUN }, "waiting"],
      [{ state: "paused", startedAt: STARTED, heartbeatAt: STARTED, pausedAt: STARTED }, "paused"],
      [{ state: "stopped", startedAt: STARTED, stoppedAt: STARTED, reason: "crashed" }, "failed"],
    ] as const;
    for (const [lifecycle, state] of cases) assert.equal(card({ lease: leaseOf({ lifecycle, ...(lifecycle.state === "stopped" ? { control: { directive: "stop", requestedAt: STARTED, requestedBy: "local-operator" } } : {}) }), resolveRun: () => running }).state, state);
  });

  it("reads the exact member, directive and CAS basis beside real running activity", () => {
    const value = card({ lease: leaseOf({ lifecycle: { state: "busy", startedAt: STARTED, heartbeatAt: STARTED, runId: RUN },
      control: { directive: "pause", requestedAt: STARTED, requestedBy: "local-operator" } }),
      fold: { revision: 12, browsers: [] }, resolveRun: () => running });
    assert.equal(value.workflowId, "person-lookup");
    assert.equal(value.member.membershipRevision, 1);
    assert.equal(value.state, "running");
    assert.equal(value.directive, "pause");
    assert.equal(value.leaseVersion, 5);
    assert.equal(value.revision, 12);
    assert.deepEqual(value.currentRun, { state: "present", runId: RUN, traceId: TRACE });
  });

  it("refuses a missing, historical unbound or prior-generation current run instead of joining its subject", () => {
    const lease = leaseOf({ lifecycle: { state: "busy", startedAt: STARTED, heartbeatAt: STARTED, runId: RUN } });
    assert.throws(() => card({ lease }), /worker-current-run-authority-unavailable/);
    for (const workerLifetime of [undefined, { leaseGeneration: 2, membershipRevision: 1 }, { leaseGeneration: 1, membershipRevision: 2 }]) {
      assert.throws(() => card({ lease, resolveRun: () => RunRecordSchema.parse({ ...running,
        lifecycle: { ...running.lifecycle, workerLifetime } }) }), /worker-current-run-authority-unavailable/);
    }
  });

  it("does not infer a current run or browser from historical spans", () => {
    const value = card({ fold: { revision: 8, currentRunId: RUN,
      browsers: [{ sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", system: "ucpath", openedAt: STARTED }] }, resolveRun: () => running });
    assert.deepEqual(value.currentRun, { state: "absent", reason: "no current claimed run" });
    assert.deepEqual(value.browsers, []);
    assert.equal(value.state, "idle");
  });

  it("refuses dead-owner idle, retired membership and an unobserved stopping phase", () => {
    assert.throws(() => card({ ownerAlive: false }), /worker-current-owner-unavailable/);
    assert.throws(() => card({ member: WorkerSlotRecordSchema.parse({ ...member, retiredAt: STARTED,
      retirementCommandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) }), /worker-member-authority-unavailable/);
    assert.throws(() => card({ lease: leaseOf({ lifecycle: { state: "stopping", startedAt: STARTED, heartbeatAt: STARTED } }) }), /worker-current-phase-unavailable/);
  });

  it("serves browserless initialization waiting without inventing a run", () => {
    const value = card({ lease: leaseOf({ lifecycle: { state: "waiting", startedAt: STARTED,
      heartbeatAt: STARTED, activity: "acquiring" } }) });
    assert.equal(value.state, "waiting");
    assert.equal(value.currentRun.state, "absent");
  });

  it("serves a stopped member as failed with its actual terminal time and no live resources", () => {
    for (const reason of ["operator", "shutdown", "crashed", "lease-expired"] as const) {
      const value = card({ ownerAlive: false, lease: leaseOf({ lifecycle: { state: "stopped", startedAt: STARTED,
        stoppedAt: "2026-08-20T16:05:00.000Z", reason }, control: { directive: "stop", requestedAt: STARTED, requestedBy: "local-operator" } }) });
      assert.equal(value.state, "failed");
      assert.equal(value.stopReason, reason);
      assert.equal(value.endedAt, "2026-08-20T16:05:00.000Z");
      assert.deepEqual(value.browsers, []);
      assert.equal(canStopWorker(value), false);
    }
  });

  it("retains launch requirements without claiming required browsers are open", () => {
    const value = card({ lease: leaseOf({ lifecycle: { state: "starting", startedAt: STARTED }, browserSystems: ["ucpath", "crm"] }) });
    assert.equal(value.state, "starting");
    assert.equal(value.revision, 1);
    assert.deepEqual(value.browserRequirements, { state: "present", systems: ["ucpath", "crm"] });
    assert.deepEqual(value.browsers, []);
  });

  it("states standing directive beside state and retains Stop availability", () => {
    const value = card();
    assert.equal(workerDirectiveNote(value), undefined);
    assert.equal(canStopWorker(value), true);
    const pausing = card({ lease: leaseOf({ control: { directive: "pause", requestedAt: STARTED, requestedBy: "local-operator" } }) });
    assert.equal(workerDirectiveNote(pausing), "Pausing after this item");
    assert.equal(canStopWorker(card({ lease: leaseOf({ control: { directive: "stop", requestedAt: STARTED, requestedBy: "local-operator" } }) })), false);
  });

  it("counts ended uptime to the actual end and live uptime to the current time", () => {
    const dead = card({ lease: leaseOf({ lifecycle: { state: "stopped", startedAt: STARTED,
      stoppedAt: "2026-08-20T16:01:00.000Z", reason: "operator" }, control: { directive: "stop", requestedAt: STARTED, requestedBy: "local-operator" } }) });
    assert.equal(workerElapsedSeconds(dead, "2026-08-20T18:00:00.000Z"), 60);
    assert.equal(workerElapsedSeconds(card(), "2026-08-20T16:00:45.000Z"), 45);
  });
});


it("projects ordinary controls only for their authenticated exact member and full process lifetime", () => {
  const lease = leaseOf();
  const record = WorkerControlRecordSchema.parse({ commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", scope: "worker-pool:person-lookup", executorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    request: { commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", family: "worker-browser", type: "refresh-browser", source: "dashboard", requestedBy: "local-operator", requestedAt: STARTED,
      target: { workerId: member.workerId, browserSessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", expectedVersion: 5, controlBasis: { leaseGeneration: 1, controlRevision: 1 } } },
    admittedAt: STARTED, expiresAt: "2026-08-20T16:03:00.000Z", basisVersion: 5, phase: { state: "ready" },
    control: { member: workerPoolMember(member), lifetime: { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt } } });
  const binding = record.control; assert(binding);
  assert.equal(card({ operations: [record] }).controls?.operation?.commandId, record.commandId);
  for (const change of [
    { member: { ...binding.member, membershipRevision: 2 } },
    { member: { ...binding.member, poolIndex: 2 } },
    { lifetime: { ...binding.lifetime, processId: 999 } },
    { lifetime: { ...binding.lifetime, startedAt: "2026-08-20T16:01:00.000Z" } },
  ]) {
    const wrong = WorkerControlRecordSchema.parse({ ...record, control: { ...record.control, ...change } });
    assert.equal(card({ operations: [wrong] }).controls?.operation, undefined);
  }
  assert.equal(card({ lease: leaseOf({ leaseGeneration: 2 }), operations: [record] }).controls?.operation, undefined);
  const { control: _control, ...historical } = record;
  assert.equal(card({ operations: [historical] }).controls?.operation, undefined);
});
