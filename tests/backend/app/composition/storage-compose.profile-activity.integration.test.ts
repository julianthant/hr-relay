import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { composeProfileActivity, composeSelectedProfileStorage } from "../../../../src/backend/app/composition/storage-compose.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import type { WorkerMemberView } from "../../../../src/backend/runtime/workers/worker-pool.js";
import type { WorkerStopReason } from "../../../../src/backend/runtime/workers/worker-messages.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

const AT = "2026-10-21T12:00:00.000Z";
const member = { workflowId: "person-lookup", workerId: "person-lookup-worker-1", ordinal: 1, poolIndex: 1 };
const live: WorkerMemberView = { member, lifetimeId: "aaaaaaaa-0001-4000-8000-000100000000", version: 0, state: "running", directive: "run", pid: 4242,
  startedAt: AT, activity: { state: "idle" }, browsers: [], exit: undefined, held: undefined };

/** A pool whose stopAll waits for the test to release it, then reports the given end state. */
function heldPool(views: WorkerMemberView[], end: Partial<WorkerMemberView> = {}) {
  const stops: WorkerStopReason[] = [];
  let release = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  let current = views;
  return { stops, release, pool: {
    snapshot: () => current,
    async stopAll(reason: WorkerStopReason) {
      stops.push(reason);
      await released;
      current = current.map(view => ({ ...view, state: "exited", exit: { code: 0, signal: null, at: AT, outcome: "stopped", settlement: "settled" }, ...end }));
      return current;
    },
  } };
}

async function fixture() {
  const f = await createBoundProfileFixture();
  const clock = manualClock(new Date(AT));
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission, credentials: boundProfileCredentials(f.admission), clock, hostFacts: { primaryDisplay: null } });
  const lifecycle = new RunRecordService({ database: context.database, clock, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("activity proof cannot enqueue"); } });
  const input = { admission: f.admission, database: context.database, clock, lifecycle };
  return { ...f, context, input, profileId: f.admission.profileBinding.profileId,
    async cleanup() { await context.account.close(); context.database.close(); await f.close(); } };
}

it("is quiescent with no owners, refuses another person, and drains a logout through the pool", async () => {
  const f = await fixture(), pool = heldPool([]);
  try {
    const activity = composeProfileActivity({ ...f.input, supervisor: pool.pool });
    assert.equal(activity.hasUnquiescedWork(f.profileId), false);
    assert.throws(() => activity.hasUnquiescedWork(randomUUID()), /owner-mismatch/u);
    activity.requestCancellation(f.profileId);
    assert.equal(activity.hasUnquiescedWork(f.profileId), true);
    assert.deepEqual(pool.stops, ["logout"]);
    pool.release();
    await activity.awaitCancellation();
    assert.equal(activity.hasUnquiescedWork(f.profileId), false);
  } finally { pool.release(); await f.cleanup(); }
});

it("a live member keeps the person busy until its exit is observed", async () => {
  const f = await fixture(), pool = heldPool([live]);
  try {
    const activity = composeProfileActivity({ ...f.input, supervisor: pool.pool });
    assert.equal(activity.hasUnquiescedWork(f.profileId), true);
    activity.requestCancellation(f.profileId);
    pool.release();
    await activity.awaitCancellation();
    assert.equal(activity.hasUnquiescedWork(f.profileId), false);
  } finally { pool.release(); await f.cleanup(); }
});

it("holds shutdown admission before stopping workers and rejects a late enqueue", async () => {
  const f = await fixture(), pool = heldPool([live]);
  try {
    const activity = composeProfileActivity({ ...f.input, supervisor: pool.pool });
    assert.equal(f.context.database.authority.runs.admission().state, "open");
    activity.requestShutdown(f.profileId);
    assert.equal(f.context.database.authority.runs.admission().state, "draining");
    assert.throws(() => f.context.database.authority.runs.enqueue(QUEUED_RUN), /application-admission-draining/u);
    assert.equal(activity.hasUnquiescedWork(f.profileId), true);
    await new Promise(resolve => { setImmediate(resolve); });
    assert.deepEqual(pool.stops, ["shutdown"]);
    pool.release();
    await activity.awaitCancellation();
    assert.equal(activity.hasUnquiescedWork(f.profileId), false);
    assert.equal(f.context.database.authority.runs.admission().state, "draining");
  } finally { pool.release(); await f.cleanup(); }
});

it("fails shutdown when a member's exit was never observed", async () => {
  const f = await fixture(), pool = heldPool([live], { held: "exit-unobserved", exit: undefined });
  try {
    const activity = composeProfileActivity({ ...f.input, supervisor: pool.pool });
    activity.requestShutdown(f.profileId);
    pool.release();
    await assert.rejects(activity.awaitCancellation(), (error: unknown) => error instanceof AggregateError
      && error.errors.some(cause => cause instanceof Error && "code" in cause && cause.code === "WORKER_EXIT_UNOBSERVED"));
    assert.throws(() => activity.hasUnquiescedWork(f.profileId), AggregateError);
  } finally { pool.release(); await f.cleanup(); }
});

for (const failure of ["none", "command"] as const) it(`shutdown awaits command custody beside the pool with ${failure} failure`, async () => {
  const f = await fixture(), pool = heldPool([]);
  let finishCommand = () => {}, rejectCommand = (_error: Error) => {};
  const commandCompletion = new Promise<void>((resolve, reject) => { finishCommand = resolve; rejectCommand = reject; });
  const commandFailure = new Error("fixture shutdown command failure");
  let commandBusy = true, commandCancelled = false;
  try {
    const command = {
      hasUnquiescedWork(id: string) { assert.equal(id, f.profileId); return commandBusy; },
      requestCancellation(id: string) { assert.equal(id, f.profileId); commandCancelled = true; },
      awaitCancellation: () => commandCompletion,
    };
    const activity = composeProfileActivity({ ...f.input, commandActivities: new Set([command]), supervisor: pool.pool });
    activity.requestShutdown(f.profileId);
    assert.equal(commandCancelled, true);
    pool.release();
    assert.equal(activity.hasUnquiescedWork(f.profileId), true);
    commandBusy = false;
    if (failure === "command") rejectCommand(commandFailure); else finishCommand();
    if (failure === "none") {
      await activity.awaitCancellation(); assert.equal(activity.hasUnquiescedWork(f.profileId), false);
    } else {
      await assert.rejects(activity.awaitCancellation(), (error: unknown) => error instanceof AggregateError && error.errors.includes(commandFailure));
    }
  } finally { pool.release(); finishCommand(); await f.cleanup(); }
});
