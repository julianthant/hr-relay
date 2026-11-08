import { WorkerControlRecordSchema, WorkerBrowserObservationSchema } from "../../../../src/models/run/worker-control.js";
import { workerPoolMember } from "../../../../src/models/run/worker-slot.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { lastRunOf, workerCardOf } from "../../../../src/backend/runs/projections/worker-cards.js";
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
  it("serves login in progress and retains proven closure without minting an open session", () => {
    const observation = WorkerBrowserObservationSchema.parse({ workerId: member.workerId, leaseGeneration: leaseOf().leaseGeneration,
      sessionId: "00000000-0000-4000-8000-000000009991", system: "crm", configFingerprint: "a".repeat(64),
      signInFingerprint: "b".repeat(64), browserMode: "headless", acceptDownloads: false, exclusive: false,
      health: "starting", observedAt: STARTED, openedAt: STARTED, profileRevision: 1 });
    const opening = card({ observations: [observation] });
    assert.equal(opening.browsers[0]?.observation?.state, "present");
    if (opening.browsers[0]?.observation?.state === "present") assert.equal(opening.browsers[0].observation.health, "starting");
    const closed = card({ observations: [{ ...observation, health: "closed" }] });
    assert.deepEqual(closed.browsers, []);
    assert.deepEqual(closed.closedBrowserSystems, ["crm"]);
  });
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

  it("attributes a stop to shutdown when Relay's drain wrote the directive, whatever the lifecycle stored", () => {
    const cases = [["operator", "application-shutdown", "shutdown"], ["operator", "profile-logout", "shutdown"], ["operator", undefined, "operator"],
      ["operator", "shift over", "operator"], ["crashed", "application-shutdown", "crashed"]] as const;
    for (const [stored, directive, shown] of cases) assert.equal(card({ ownerAlive: false, lease: leaseOf({ lifecycle: { state: "stopped", startedAt: STARTED,
      stoppedAt: "2026-08-20T16:05:00.000Z", reason: stored }, control: { directive: "stop", requestedAt: STARTED, requestedBy: "local-operator",
      ...(directive === undefined ? {} : { reason: directive }) } }) }).stopReason, shown, `${stored} + ${String(directive)}`);
  });

  it("serves a stopped member as failed with its actual terminal time and no live resources", () => {
    for (const reason of ["operator", "shutdown", "crashed"] as const) {
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
    assert.deepEqual(value.browserRequirements, { state: "present", systems: ["ucpath", "crm"], missing: ["ucpath", "crm"] });
    assert.deepEqual(value.browsers, []);
  });

  it("states standing directive beside state and retains Stop availability", () => {
    const value = card();
    assert.equal(workerDirectiveNote(value), undefined);
    assert.equal(canStopWorker(value), true);
    const pausing = card({ lease: leaseOf({ control: { directive: "pause", requestedAt: STARTED, requestedBy: "local-operator" } }) });
    assert.equal(workerDirectiveNote(pausing), undefined);
    assert.equal(workerDirectiveNote({ ...pausing, interrupt: { action: "pause", step: "cancel" } }), "This step will restart");
    assert.equal(workerDirectiveNote({ ...pausing, interrupt: { action: "stop", step: "cancel" } }), "This step is cancelled");
    assert.equal(workerDirectiveNote({ ...pausing, interrupt: { action: "pause", step: "finish-write" } }), "Finishing the save first");
    assert.equal(workerDirectiveNote({ ...pausing, state: "failed", interrupt: { action: "pause", step: "cancel" } }), undefined);
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

describe("sessions panel card data", () => {
  const SESSION_A = "00000000-0000-4000-8000-00000000000a", SESSION_B = "00000000-0000-4000-8000-00000000000b";
  const observed = (health: "starting" | "authenticated" | "unknown" | "failed" | "closed", system = "crm", sessionId = SESSION_A, leaseGeneration = 1) =>
    WorkerBrowserObservationSchema.parse({ workerId: member.workerId, leaseGeneration, sessionId, system, configFingerprint: "a".repeat(64),
      signInFingerprint: "b".repeat(64), browserMode: "headless", acceptDownloads: false, exclusive: false,
      health, observedAt: STARTED, openedAt: STARTED, profileRevision: 1 });
  const stopped = leaseOf({ lifecycle: { state: "stopped", startedAt: STARTED, stoppedAt: STARTED, reason: "crashed" },
    control: { directive: "stop", requestedAt: STARTED, requestedBy: "local-operator" } });

  it("serves a crashed lease's failure code and omits the key without one", () => {
    const crashed = (failureCode?: "BROWSER_ROOT_UNAVAILABLE") => card({ ownerAlive: false, lease: leaseOf({ control: stopped.control,
      lifecycle: { state: "stopped", startedAt: STARTED, stoppedAt: STARTED, reason: "crashed", ...(failureCode === undefined ? {} : { failureCode }) } }) });
    const withCode = crashed("BROWSER_ROOT_UNAVAILABLE");
    assert.equal(withCode.stopReason, "crashed"); assert.equal(withCode.failureCode, "BROWSER_ROOT_UNAVAILABLE");
    assert.equal("failureCode" in crashed(), false);
  });

  it("keeps a stopped card's final-generation sessions as lastBrowsers while browsers stays empty", () => {
    const value = card({ ownerAlive: false, lease: stopped, observations: [observed("authenticated"), observed("closed", "ucpath", SESSION_B),
      observed("authenticated", "crm", "00000000-0000-4000-8000-00000000000c", 2)] });
    assert.deepEqual(value.browsers, []);
    assert.deepEqual(value.lastBrowsers?.map(browser => [browser.sessionId, browser.system, browser.signIn]),
      [[SESSION_A, "crm", "signed-in"], [SESSION_B, "ucpath", "unknown"]]);
    assert.equal(card({ observations: [observed("authenticated")] }).lastBrowsers, undefined);
  });

  it("serves missing as the required systems minus open, authenticated sessions", () => {
    const lease = leaseOf({ browserSystems: ["ucpath", "crm", "kuali"] });
    const value = card({ lease, observations: [observed("authenticated", "crm"), observed("starting", "ucpath", SESSION_B)] });
    assert.deepEqual(value.browserRequirements, { state: "present", systems: ["ucpath", "crm", "kuali"], missing: ["ucpath", "kuali"] });
    assert.deepEqual(card({ ownerAlive: false, lease: stopped, observations: [observed("authenticated")] }).browserRequirements,
      { state: "present", systems: ["ucpath"], missing: ["ucpath"] });
  });

  it("serves one sign-in state per session and the lease's waiting activity", () => {
    const signIn = (input: Partial<Parameters<typeof workerCardOf>[0]>) => card(input).browsers.map(browser => browser.signIn);
    assert.deepEqual(signIn({ observations: [observed("authenticated")] }), ["signed-in"]);
    assert.deepEqual(signIn({ observations: [observed("starting")] }), ["signing-in"]);
    assert.deepEqual(signIn({ observations: [observed("unknown")] }), ["unknown"]);
    const authenticating = leaseOf({ lifecycle: { state: "waiting", startedAt: STARTED, heartbeatAt: STARTED, activity: "authenticating" } });
    assert.deepEqual(signIn({ lease: authenticating, observations: [observed("unknown")] }), ["signing-in"]);
    assert.deepEqual(signIn({ observations: [observed("starting"), observed("starting", "ucpath", SESSION_B)], duoSystems: ["ucpath"] }), ["signing-in", "needs-duo"]);
    assert.equal(card({ lease: authenticating }).waitingActivity, "authenticating");
    assert.equal(card().waitingActivity, undefined);
  });

  it("serves the last run's terminal outcome and the step its worker last ran on that claimed attempt", () => {
    const terminal = RunRecordSchema.parse({ ...running, version: 3, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: "2026-08-20T16:09:00.000Z" } });
    const span = (spanPath: string, startedAt: string, outcome?: "done" | "failed" | "skipped" | "interrupted", attempt = 1) =>
      ({ attempt, spanPath, name: spanPath, startedAt, ...(outcome === undefined ? {} : { endedAt: startedAt, outcome }) });
    const spans = [span(`${TRACE}/lookup#1`, "2026-08-20T16:01:00.000Z", "done"), span(`${TRACE}/verify#1`, "2026-08-20T16:02:00.000Z", "failed"),
      span(`${TRACE}/later#1`, "2026-08-20T16:03:00.000Z", "done", 2)];
    const taskIdOf = (nodeId: string) => nodeId === "verify" ? "crm/verify-record" : undefined;
    assert.deepEqual(lastRunOf({ claim: { runId: RUN, attempt: 1 }, run: terminal, spans, taskIdOf }), { state: "present", runId: RUN, traceId: TRACE,
      outcome: "cancelled", endedAt: "2026-08-20T16:09:00.000Z", step: { nodeId: "verify", taskId: "crm/verify-record", state: "failed", startedAt: "2026-08-20T16:02:00.000Z" } });
    const crashed = lastRunOf({ claim: { runId: RUN, attempt: 1 }, run: running, taskIdOf,
      spans: [span(`${TRACE}/lookup#1`, "2026-08-20T16:01:00.000Z"), span(`${TRACE}/verify#1`, "2026-08-20T16:02:00.000Z", "interrupted")] });
    assert.deepEqual(crashed, { state: "present", runId: RUN, traceId: TRACE, step: { nodeId: "lookup", state: "open", startedAt: "2026-08-20T16:01:00.000Z" } });
    assert.deepEqual(lastRunOf({ claim: undefined, run: undefined, spans: undefined, taskIdOf }), { state: "unavailable", reason: "no-run-recorded" });
    assert.deepEqual(lastRunOf({ claim: { runId: RUN, attempt: 1 }, run: undefined, spans, taskIdOf }), { state: "unavailable", reason: "run-unavailable" });
    assert.deepEqual(card({ lastRun: crashed }).lastRun, crashed);
  });
});
