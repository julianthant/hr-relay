import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { lastRunOf, workerCardOf } from "../../../../src/backend/runs/projections/worker-cards.js";
import type { WorkerMemberView } from "../../../../src/backend/runtime/workers/worker-pool.js";
import { WorkerBrowserObservationSchema } from "../../../../src/models/run/worker-control.js";
import { WorkerSlotRecordSchema, workerPoolMember } from "../../../../src/models/run/worker-slot.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { canStopWorker, workerDirectiveNote, workerElapsedSeconds } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { BrowserSessionIdSchema, IsoInstantSchema, RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

const STARTED = IsoInstantSchema.parse("2026-08-20T16:00:00.000Z");
const RUN = RunIdSchema.parse(QUEUED_RUN.envelope.runId);
const TRACE = QUEUED_RUN.envelope.traceId;
const LIFETIME = "aaaaaaaa-0001-4000-8000-000100000000";
const slot = WorkerSlotRecordSchema.parse({ workerId: "person-lookup-worker-1", workflow: "person-lookup",
  ordinal: 1, poolIndex: 1, paused: false, retiredAt: null, createdAt: STARTED, updatedAt: STARTED });
const running = RunRecordSchema.parse({ ...QUEUED_RUN, claimGeneration: 1, lifecycle: { state: "running", workerId: slot.workerId,
  claimedAt: STARTED, heartbeatAt: STARTED, currentNodeId: "lookup" } });
const observation = WorkerBrowserObservationSchema.parse({ workerId: slot.workerId, sessionId: "00000000-0000-4000-8000-000000009991", system: "crm",
  configFingerprint: "a".repeat(64), signInFingerprint: "b".repeat(64), browserMode: "headless", acceptDownloads: false, exclusive: false,
  health: "authenticated", observedAt: STARTED, openedAt: STARTED, profileRevision: 1 });

function memberView(input: Partial<WorkerMemberView> = {}): WorkerMemberView {
  return { member: workerPoolMember(slot), lifetimeId: LIFETIME, version: 0, state: "running", directive: "run", pid: 4242, startedAt: STARTED,
    activity: { state: "idle" }, browsers: [], exit: undefined, held: undefined, ...input };
}
function card(input: Readonly<{ view?: WorkerMemberView | undefined; slot?: typeof slot; foldRevision?: number; resolveRun?: (runId: string) => typeof running | undefined;
  duoSystems?: readonly string[]; lastRun?: Parameters<typeof workerCardOf>[0]["lastRun"]; writeInFlight?: (runId: string) => boolean; startupPending?: boolean }> = {}) {
  return workerCardOf({ slot: input.slot ?? slot, view: "view" in input ? input.view : memberView(), foldRevision: input.foldRevision ?? 0, resolveRun: input.resolveRun ?? (() => undefined),
    ...(input.startupPending === undefined ? {} : { startupPending: input.startupPending }),
    ...(input.duoSystems === undefined ? {} : { duoSystems: input.duoSystems }), ...(input.lastRun === undefined ? {} : { lastRun: input.lastRun }),
    ...(input.writeInFlight === undefined ? {} : { writeInFlight: input.writeInFlight }) });
}

describe("the worker card from the pool member and its slot", () => {
  it("serves each card state from the member's process state and reported activity", () => {
    const cases = [
      [memberView({ state: "starting", activity: undefined }), "starting"],
      [memberView(), "idle"],
      [memberView({ activity: { state: "busy", runId: RUN } }), "running"],
      [memberView({ activity: { state: "waiting" } }), "waiting"],
      [memberView({ activity: { state: "paused" } }), "paused"],
      [memberView({ state: "exited", exit: { code: 1, signal: null, at: STARTED, outcome: "crashed", settlement: "settled" } }), "failed"],
    ] as const;
    for (const [view, state] of cases) assert.equal(card({ view, resolveRun: () => running }).state, state);
  });

  it("serves a preflight refusal on an idle card and clears it once the worker claims", () => {
    const refusal = { code: "PREFLIGHT_BLOCKED" as const, summary: "Readiness checks blocked this worker.", retryAt: STARTED };
    const refused = card({ view: memberView({ activity: { state: "idle", refusal } }) });
    assert.equal(refused.state, "idle");
    assert.deepEqual(refused.refusal, refusal);
    assert.equal(card({ view: memberView({ activity: { state: "busy", runId: RUN } }), resolveRun: () => running }).refusal, undefined);
    assert.equal(card({ view: memberView({ activity: { state: "idle" } }) }).refusal, undefined);
    const catalog = card({ view: memberView({ activity: { state: "idle", refusal: { code: "PREFLIGHT_TIMEOUT", retryAt: STARTED } } }) });
    assert.equal(catalog.refusal?.code, "PREFLIGHT_TIMEOUT");
    assert.equal(catalog.refusal?.summary, "A readiness check took too long. Check again.");
    assert.equal(catalog.refusal?.retryAt, STARTED);
  });

  it("serves the member, its directive from the slot and the in-memory fence beside the running run", () => {
    const value = card({ view: memberView({ version: 3, activity: { state: "busy", runId: RUN } }), slot: { ...slot, paused: true },
      foldRevision: 12, resolveRun: () => running });
    assert.deepEqual(value.member, workerPoolMember(slot));
    assert.equal(value.directive, "pause");
    assert.deepEqual(value.controls, { basis: { state: "present", value: { lifetimeId: LIFETIME, version: 3 } } });
    assert.deepEqual(value.currentRun, { state: "present", runId: RUN, traceId: TRACE });
    assert.equal(value.revision, 16);
    assert.equal(workerDirectiveNote(value), undefined, "a directive alone names no step outcome");
  });

  it("serves a stopping member's stop directive, which offers no second Stop", () => {
    const value = card({ view: memberView({ state: "stopping", activity: { state: "busy", runId: RUN } }), slot: { ...slot, paused: true }, resolveRun: () => running });
    assert.equal(value.state, "running");
    assert.equal(value.directive, "stop");
    assert.equal(workerDirectiveNote(value), undefined, "a directive alone names no step outcome");
    assert.equal(canStopWorker(value), false);
  });

  it("names the served step interrupt of the current run beside state and retains Stop availability", () => {
    const busy = memberView({ activity: { state: "busy", runId: RUN } });
    const pause = { state: "requested", commandId: "aaaaaaaa-0002-4000-8000-000200000000", requestedAt: STARTED } as const;
    const served = (run: typeof running, writeInFlight = false) => card({ view: busy, resolveRun: () => run, writeInFlight: () => writeInFlight });
    assert.equal(served(running).interrupt, undefined);
    assert.equal(workerDirectiveNote(served(running)), undefined);
    assert.equal(canStopWorker(served(running)), true);
    const pausing = RunRecordSchema.parse({ ...running, pause });
    assert.deepEqual(served(pausing).interrupt, { action: "pause", step: "cancel" });
    assert.equal(workerDirectiveNote(served(pausing)), "This step will restart");
    assert.deepEqual(served(pausing, true).interrupt, { action: "pause", step: "finish-write" });
    assert.equal(workerDirectiveNote(served(pausing, true)), "Finishing the save first");
    const stopping = RunRecordSchema.parse({ ...running, pause, cancelRequested: true });
    assert.deepEqual(served(stopping).interrupt, { action: "stop", step: "cancel" }, "a pending cancel wins over a pause");
    assert.equal(workerDirectiveNote(served(stopping)), "This step is cancelled");
    assert.equal(workerDirectiveNote({ ...served(pausing), state: "failed" }), undefined);
  });

  it("refuses to join a run another worker owns", () => {
    const foreign = RunRecordSchema.parse({ ...running, lifecycle: { ...running.lifecycle, workerId: "person-lookup-worker-2" } });
    assert.equal(card({ view: memberView({ activity: { state: "busy", runId: RUN } }), resolveRun: () => foreign }).currentRun.state, "absent");
  });

  it("refuses a retired slot or a view of another member", () => {
    assert.throws(() => card({ slot: { ...slot, retiredAt: STARTED } }), /worker-member-authority-unavailable|worker-slot-retired/);
    assert.throws(() => card({ view: memberView({ member: { ...workerPoolMember(slot), workerId: "person-lookup-worker-2", ordinal: 2 } }) }), /worker-member-authority-unavailable/);
  });

  it("serves open browsers only while the process lives", () => {
    const live = card({ view: memberView({ browsers: [observation, { ...observation, sessionId: BrowserSessionIdSchema.parse("00000000-0000-4000-8000-000000009992"), health: "closed" as const }] }) });
    assert.deepEqual(live.browsers.map(browser => browser.sessionId), [observation.sessionId]);
    const exited = card({ view: memberView({ state: "exited", browsers: [observation], exit: { code: 0, signal: null, at: STARTED, outcome: "stopped", settlement: "settled" } }) });
    assert.deepEqual(exited.browsers, []);
  });

  it("serves an exited member as failed with its observed exit time and reason", () => {
    for (const [outcome, reason] of [["stopped", "operator"], ["crashed", "crashed"]] as const) {
      const value = card({ view: memberView({ state: "exited", exit: { code: null, signal: "SIGKILL", at: "2026-08-20T16:05:00.000Z", outcome, settlement: "settled" } }) });
      assert.equal(value.state, "failed");
      assert.equal(value.stopReason, reason);
      assert.equal(value.endedAt, "2026-08-20T16:05:00.000Z");
      assert.equal(canStopWorker(value), false);
      assert.equal(workerDirectiveNote(value), undefined);
    }
    assert.equal(workerDirectiveNote(card()), undefined);
    assert.equal(canStopWorker(card()), true);
  });

  it("serves a member whose startup is still pending as starting, not failed", () => {
    const planned = card({ view: undefined, startupPending: true, foldRevision: 4 });
    assert.deepEqual([planned.state, planned.stopReason, planned.endedAt, planned.startedAt, planned.revision], ["starting", undefined, undefined, slot.createdAt, 5]);
    assert.deepEqual(planned.controls, { basis: { state: "present", value: { lifetimeId: null, version: 0 } } });
    const exited = memberView({ state: "exited", version: 3, exit: { code: 1, signal: null, at: STARTED, outcome: "crashed", settlement: "settled" } });
    const restarting = card({ view: exited, startupPending: true });
    assert.deepEqual([restarting.state, restarting.stopReason, restarting.lastBrowsers], ["starting", undefined, undefined]);
    assert.deepEqual(restarting.controls, { basis: { state: "present", value: { lifetimeId: LIFETIME, version: 3 } } });
    assert.equal(card({ view: memberView(), startupPending: true }).state, "idle");
    assert.equal(card({ view: exited, startupPending: false }).state, "failed");
  });

  it("serves a slot with no process this boot as not started, with the null-lifetime fence Retry cites", () => {
    const value = card({ view: undefined, slot: { ...slot, paused: true }, foldRevision: 4 });
    assert.equal(value.state, "failed");
    assert.equal(value.stopReason, "not-started");
    assert.equal(value.endedAt, undefined);
    assert.equal(value.startedAt, slot.createdAt);
    assert.equal(value.directive, "pause");
    assert.deepEqual(value.controls, { basis: { state: "present", value: { lifetimeId: null, version: 0 } } });
    assert.deepEqual(value.currentRun, { state: "absent", reason: "no current claimed run" });
    assert.deepEqual(value.browsers, []);
    assert.equal(value.revision, 5);
    assert.equal(canStopWorker(value), false);
    assert.equal(workerElapsedSeconds(value, "2026-08-20T18:00:00.000Z"), 0);
  });

  it("counts ended uptime to the observed exit and live uptime to the current time", () => {
    const dead = card({ view: memberView({ state: "exited", exit: { code: 0, signal: null, at: "2026-08-20T16:01:00.000Z", outcome: "stopped", settlement: "settled" } }) });
    assert.equal(workerElapsedSeconds(dead, "2026-08-20T18:00:00.000Z"), 60);
    assert.equal(workerElapsedSeconds(card(), "2026-08-20T16:00:45.000Z"), 45);
  });
});

describe("sessions panel card data", () => {
  const SESSION_A = BrowserSessionIdSchema.parse("00000000-0000-4000-8000-00000000000a"), SESSION_B = BrowserSessionIdSchema.parse("00000000-0000-4000-8000-00000000000b");
  const observed = (health: "starting" | "authenticated" | "unknown" | "failed" | "closed", system: WorkerMemberView["browsers"][number]["system"] = "crm", sessionId = SESSION_A) =>
    ({ ...observation, health, system, sessionId });
  const exited = { code: 1, signal: null, at: STARTED, outcome: "crashed", settlement: "settled" } as const;

  it("keeps an exited member's last reported sessions as lastBrowsers while browsers stays empty", () => {
    const value = card({ view: memberView({ state: "exited", exit: exited, browsers: [observed("authenticated"), observed("failed", "ucpath", SESSION_B)] }) });
    assert.deepEqual(value.browsers, []);
    assert.deepEqual(value.lastBrowsers?.map(browser => [browser.sessionId, browser.system, browser.signIn]),
      [[SESSION_A, "crm", "signed-in"], [SESSION_B, "ucpath", "unknown"]]);
    assert.equal(card({ view: memberView({ browsers: [observed("authenticated")] }) }).lastBrowsers, undefined);
  });

  it("serves one sign-in state per session from its health, a held Duo lease and the member's waiting activity", () => {
    const signIn = (browsers: WorkerMemberView["browsers"], input: Partial<Parameters<typeof card>[0]> & { activity?: WorkerMemberView["activity"] } = {}) =>
      card({ ...input, view: memberView({ browsers, ...(input.activity === undefined ? {} : { activity: input.activity }) }) }).browsers.map(browser => browser.signIn);
    assert.deepEqual(signIn([observed("authenticated")]), ["signed-in"]);
    assert.deepEqual(signIn([observed("starting")]), ["signing-in"]);
    assert.deepEqual(signIn([observed("unknown")]), ["unknown"]);
    assert.deepEqual(signIn([observed("failed")]), ["unknown"]);
    assert.deepEqual(signIn([observed("unknown")], { activity: { state: "waiting" } }), ["signing-in"]);
    assert.deepEqual(signIn([observed("starting"), observed("starting", "ucpath", SESSION_B)], { duoSystems: ["ucpath"] }), ["signing-in", "needs-duo"]);
    assert.deepEqual(signIn([observed("authenticated", "ucpath")], { duoSystems: ["ucpath"] }), ["signed-in"]);
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

  it("serves every built card as available, with or without a process", () => {
    assert.deepEqual(card().availability, { state: "available" });
    assert.deepEqual(card({ view: undefined }).availability, { state: "available" });
  });
});

describe("worker custody card data", () => {
  const exitOf = (fact: Partial<NonNullable<WorkerMemberView["exit"]>>) =>
    ({ code: null, signal: null, at: STARTED, outcome: "stopped", settlement: "settled", ...fact }) as NonNullable<WorkerMemberView["exit"]>;
  const exitedCard = (fact: Partial<NonNullable<WorkerMemberView["exit"]>>) => card({ view: memberView({ state: "exited", exit: exitOf(fact) }) });

  it("maps a stopped member's reason and a crash to the served stop reason", () => {
    for (const [reason, expected] of [["operator", "operator"], ["reset", "operator"], ["remove", "operator"], ["shutdown", "shutdown"],
      ["logout", "shutdown"], ["fault", "crashed"], [undefined, "operator"]] as const)
      assert.equal(exitedCard({ outcome: "stopped", ...(reason === undefined ? {} : { reason }) }).stopReason, expected, String(reason));
    assert.equal(exitedCard({ outcome: "crashed" }).stopReason, "crashed");
  });

  it("serves a crashed exit's failure code and never a stopped exit's", () => {
    assert.equal(exitedCard({ outcome: "crashed", failureCode: "BROWSER_ROOT_UNAVAILABLE" }).failureCode, "BROWSER_ROOT_UNAVAILABLE");
    assert.equal("failureCode" in exitedCard({ outcome: "crashed" }), false);
    assert.equal("failureCode" in exitedCard({ outcome: "stopped", reason: "operator", failureCode: "BROWSER_ROOT_UNAVAILABLE" }), false);
  });

  it("serves the required browser systems with those not yet signed in, only when the view names them", () => {
    assert.deepEqual(card({ view: memberView({ browserSystems: ["crm", "ucpath"], browsers: [observation] }) }).browserRequirements,
      { state: "present", systems: ["crm", "ucpath"], missing: ["ucpath"] });
    assert.equal("browserRequirements" in card({ view: memberView({ browsers: [observation] }) }), false);
  });

  it("serves what a waiting member waits on, and keeps a closing wait from reading as signing in", () => {
    const waiting = card({ view: memberView({ activity: { state: "waiting", waiting: "acquiring" } }) });
    assert.equal(waiting.state, "waiting");
    assert.equal(waiting.waitingActivity, "acquiring");
    assert.equal("waitingActivity" in card({ view: memberView({ activity: { state: "waiting" } }) }), false);
    const signIn = (waitingOn: "closing" | "authenticating") =>
      card({ view: memberView({ activity: { state: "waiting", waiting: waitingOn }, browsers: [{ ...observation, health: "unknown" }] }) }).browsers.map(browser => browser.signIn);
    assert.deepEqual(signIn("closing"), ["unknown"]);
    assert.deepEqual(signIn("authenticating"), ["signing-in"]);
  });
});
