import assert from "node:assert/strict";
import { it } from "vitest";
import { composeProfileActivity } from "../../../../src/backend/app/composition/storage-compose.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

type Input = Parameters<typeof composeProfileActivity>[0];
const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
type Facts = { runs: unknown[]; writeIntents: unknown[]; duoLeases: unknown[]; pendingArtifacts: unknown[]; slots: unknown[]; exclusiveSessionLeases: unknown[] };

function stop(initial: Partial<Facts> = {}) {
  const facts: Facts = { runs: [], writeIntents: [], duoLeases: [], pendingArtifacts: [], slots: [], exclusiveSessionLeases: [], ...initial };
  const reads = { custody: 0, activity: 0 }, paused: { runId: string; expectedVersion: number }[] = [];
  let changeOnRead: number | undefined;
  const database = {
    readProfileResourceCustody: () => {
      reads.custody++;
      return Object.freeze({ ...facts, changed: reads.custody === changeOnRead });
    },
    readApplicationActivity: () => {
      reads.activity++;
      return Object.freeze({ runs: facts.runs, writeIntents: facts.writeIntents, duoLeases: facts.duoLeases, pendingArtifacts: facts.pendingArtifacts });
    },
    withAuthorityTransaction: <Result>(work: (repositories: unknown) => Result): Result => work({
      runs: { admission: () => ({ state: "held" }), holdAdmission() { throw new Error("admission is already held"); } },
      runtimeConfig: { get: () => ({ generation: 1 }) },
    }),
  };
  const activity = composeProfileActivity({
    admission: { profileBinding: { profileId: PROFILE_ID }, assertLive() {} } as unknown as Input["admission"],
    database: database as unknown as Input["database"],
    clock: manualClock(new Date("2026-11-16T08:00:00.000Z")),
    supervisor: { state: "not-constructed" },
    lifecycle: {
      read: (runId: string) => ({ state: "present", run: (facts.runs as { envelope: { runId: string } }[]).find(run => run.envelope.runId === runId) }),
      pause: (request: { runId: string; expectedVersion: number }) => { paused.push({ runId: request.runId, expectedVersion: request.expectedVersion }); return { state: "applied", run: {} }; },
      transition: () => { throw new Error("no transition expected"); },
    } as unknown as Input["lifecycle"],
  });
  return { activity, facts, reads, paused, changeOnReadNumber: (read: number) => { changeOnRead = read; } };
}

const run = (runId: string, state: string, version: number) => ({ envelope: { runId }, lifecycle: { state }, version });

it("one stop reads the full custody four times: the transaction lists only runs, and each quiet check reads twice", async () => {
  const { activity, reads } = stop();
  activity.requestShutdown(PROFILE_ID);
  await activity.awaitCancellation();
  assert.equal(activity.hasUnquiescedWork(PROFILE_ID), false);
  assert.deepEqual(reads, { custody: 4, activity: 1 });
});

it("the shutdown transaction pauses each live run at the version it read inside that transaction", async () => {
  const { activity, paused } = stop({ runs: [run("live", "running", 3), run("done", "terminal", 1), run("parked", "parked-write", 2)] });
  activity.requestShutdown(PROFILE_ID);
  await assert.rejects(activity.awaitCancellation(), /profile-resource-shutdown-unproved/u);
  assert.deepEqual(paused, [{ runId: "live", expectedVersion: 3 }]);
});

it("work that appears after the shutdown request still defers the closure", async () => {
  const { activity, facts } = stop();
  activity.requestShutdown(PROFILE_ID);
  await activity.awaitCancellation();
  facts.pendingArtifacts = [{}];
  assert.equal(activity.hasUnquiescedWork(PROFILE_ID), true);
  assert.equal(activity.busyReason(PROFILE_ID), "busy-artifacts-1");
});

it("a custody that changes between the two readings of a quiet check still refuses the stop", async () => {
  const { activity, reads, changeOnReadNumber } = stop();
  activity.requestShutdown(PROFILE_ID);
  await activity.awaitCancellation();
  changeOnReadNumber(reads.custody + 2);
  assert.throws(() => activity.hasUnquiescedWork(PROFILE_ID), /profile-resource-custody-changed/u);
});

it("the busy check and the logout cancellation read the custody as before", async () => {
  const busy = stop();
  assert.equal(busy.activity.hasUnquiescedWork(PROFILE_ID), false);
  assert.deepEqual(busy.reads, { custody: 2, activity: 0 });
  const cancel = stop({ runs: [run("done", "terminal", 1)] });
  cancel.activity.requestCancellation(PROFILE_ID);
  await cancel.activity.awaitCancellation();
  assert.deepEqual(cancel.reads, { custody: 3, activity: 0 });
});
