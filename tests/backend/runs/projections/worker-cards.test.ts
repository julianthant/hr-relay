import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { workerCardOf } from "../../../../src/backend/runs/projections/worker-cards.js";
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
  health: "ready", observedAt: STARTED, openedAt: STARTED, profileRevision: 1 });

function memberView(input: Partial<WorkerMemberView> = {}): WorkerMemberView {
  return { member: workerPoolMember(slot), lifetimeId: LIFETIME, version: 0, state: "running", directive: "run", pid: 4242, startedAt: STARTED,
    activity: { state: "idle" }, browsers: [], exit: undefined, held: undefined, ...input };
}
function card(input: Readonly<{ view?: WorkerMemberView; slot?: typeof slot; foldRevision?: number; resolveRun?: (runId: string) => typeof running | undefined }> = {}) {
  return workerCardOf({ slot: input.slot ?? slot, view: input.view ?? memberView(), foldRevision: input.foldRevision ?? 0, resolveRun: input.resolveRun ?? (() => undefined) });
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

  it("serves the member, its directive from the slot and the in-memory fence beside the running run", () => {
    const value = card({ view: memberView({ version: 3, activity: { state: "busy", runId: RUN } }), slot: { ...slot, paused: true },
      foldRevision: 12, resolveRun: () => running });
    assert.deepEqual(value.member, workerPoolMember(slot));
    assert.equal(value.directive, "pause");
    assert.deepEqual(value.controls, { basis: { state: "present", value: { lifetimeId: LIFETIME, version: 3 } } });
    assert.deepEqual(value.currentRun, { state: "present", runId: RUN, traceId: TRACE });
    assert.equal(value.revision, 16);
    assert.equal(workerDirectiveNote(value), "Pausing after this item");
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
    assert.equal(canStopWorker(card()), true);
  });

  it("counts ended uptime to the observed exit and live uptime to the current time", () => {
    const dead = card({ view: memberView({ state: "exited", exit: { code: 0, signal: null, at: "2026-08-20T16:01:00.000Z", outcome: "stopped", settlement: "settled" } }) });
    assert.equal(workerElapsedSeconds(dead, "2026-08-20T18:00:00.000Z"), 60);
    assert.equal(workerElapsedSeconds(card(), "2026-08-20T16:00:45.000Z"), 45);
  });
});
