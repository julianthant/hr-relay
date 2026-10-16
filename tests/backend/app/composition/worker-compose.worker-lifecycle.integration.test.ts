import { deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { createWorkerCompositionTestWorld } from "../../../support/helpers/backend/worker-composition-world.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { releaseAdmissionFixture, releaseAdmissionFixtures } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { composeWorkerRuntime } from "../../../../src/backend/app/composition/worker-compose.js";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { ITEM_ID, RUN_ID, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { happySessionHarness, healthyCrmDriver, personLookupQueuedRun, sessionFactoryHarness, type SessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const {NOW, POOL_INDEX_1, repoRootWithState, seedQueuedRun, reopen, composeInput, cleanup } = createWorkerCompositionTestWorld(() => releaseAdmissionFixtures(), (root) => releaseAdmissionFixture(root));


afterEach(cleanup);
const POOL_INDEX_2 = PositiveIntSchema.parse(2);

function admittedWorkerId(stateRoot: string, clock: TestClock, poolIndex = 1) {
  const database = reopen(stateRoot, clock);
  const existing = database.authority.workerSlots.list(WORKFLOW_ID)
    .find(slot => slot.poolIndex === poolIndex && slot.retiredAt === null);
  if (existing !== undefined) return existing.workerId;
  return database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
    commandId: randomUUID(), workflow: WORKFLOW_ID, poolIndex,
    expectedPoolVersion: repositories.workerPools.get(WORKFLOW_ID)?.version ?? 0,
    processId: process.pid, processAcquisitionId: randomUUID(),
    authorityPath: join(stateRoot, "state.db"),
    processLockRoot: join(stateRoot, "locks"), now: clock.now().toISOString(),
  }, randomUUID())).workerId;
}

describe("composed worker runtime", () => {

  it("builds the whole dependency graph and drains a queued run to done", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const sessions = happySessionHarness();
    const lines: string[] = [];

    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions, lines, poolIndex: POOL_INDEX_1,
    }));

    assert.equal(report.workflowId, WORKFLOW_ID);
    assert.equal(report.workerId, admittedWorkerId(stateRoot, clock));
    assert.equal(report.stopped, "idle");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);

    const database = reopen(stateRoot, clock);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    assert.equal(run.lifecycle.outcome, "done");
    // The terminal result authority is the composition's, not a fixture's.
    assert.ok(database.authority.runResults.get(RUN_ID));

    // The durable lease: started by this process, settled honestly at exit.
    const lease = database.authority.workerLeases.get(report.workerId);
    assert.ok(lease && lease.lifecycle.state === "stopped");
    assert.equal(lease.lifecycle.reason, "shutdown");
    assert.equal(lease.processId, 4242);
    assert.equal(lease.workflow, WORKFLOW_ID);

    // Composition persists its own cross-process timeline in authority.
    assert.ok(database.authority.timelineEvents.page({ workflow: WORKFLOW_ID }).length > 0);

    // One browser session per system, closed exactly once at worker stop.
    assert.equal(sessions.opens("ucpath"), 1);
    assert.deepEqual(sessions.closeReasons(), ["worker-stop", "worker-stop"]);
  });

  it("composes distinct stable identities for members of one workflow pool", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));

    const first = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
    }));
    const second = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_2,
    }));

    const expected = [
      admittedWorkerId(stateRoot, clock, POOL_INDEX_1),
      admittedWorkerId(stateRoot, clock, POOL_INDEX_2),
    ];
    const database = reopen(stateRoot, clock);
    assert.deepEqual({
      reports: [first.workerId, second.workerId],
      authorityLeases: expected.map((workerId) => database.authority.workerLeases.get(workerId)?.workerId),
    }, {
      reports: expected,
      authorityLeases: expected,
    });
  });

  it("refuses a second process answering to the same worker id", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = admittedWorkerId(stateRoot, clock, POOL_INDEX_1);
    const database = reopen(stateRoot, clock);
    assert.equal(database.authority.workerLeases.start({
      workerId,
      workflow: WORKFLOW_ID,
      browserSystems: ["crm", "ucpath"],
      processId: 999,
      requestedBy: "local-operator",
      now: NOW,
    }).state, "started");

    await assert.rejects(
      composeWorkerRuntime(composeInput({
        repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
      })),
      /a second process may not answer to the same worker id/,
    );
  });

  it("reclaims a lease whose process died without settling, instead of bricking the workflow", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = admittedWorkerId(stateRoot, clock);
    const seed = reopen(stateRoot, clock);

    assert.equal(seed.authority.workerLeases.start({
      workerId, workflow: WORKFLOW_ID, browserSystems: ["crm", "ucpath"], processId: 999,
      requestedBy: "local-operator", now: NOW,
    }).state, "started");
    assert.equal(seed.authority.workerLeases.reportLifecycle({
      workerId,
      leaseGeneration: 1,
      lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: NOW },
      now: NOW,
    }).state, "applied");
    clock.advanceWall(120_000);
    clock.advanceMonotonic(120_000);

    const lines: string[] = [];
    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), lines, poolIndex: POOL_INDEX_1,
    }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    const lease = seed.authority.workerLeases.get(workerId);
    assert.ok(lease && lease.leaseGeneration === 2 && lease.processId === 4242);
    assert.ok(lines.some((line) => line.includes("stale worker lease reclaimed before start")));
  });

  it("sweeps its own orphaned claim at startup and then claims it, same workflow", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = admittedWorkerId(stateRoot, clock);
    const crashed = reopen(stateRoot, clock);
    const claimed = crashed.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId, now: NOW });
    assert.equal(claimed.state, "claimed", "the crashed process must actually own the row");
    // The clock barely moves: the heartbeat this row carries is FRESH, which is
    // precisely why the staleness-gated boot sweep skips it.
    clock.advanceWall(2_000);
    clock.advanceMonotonic(2_000);

    const lines: string[] = [];
    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), lines, poolIndex: POOL_INDEX_1,
    }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    assert.ok(
      lines.some((line) => line.includes("orphaned claim released before the first poll")),
      "the startup self-sweep did not report releasing the row",
    );
    const run = crashed.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "terminal");
    assert.equal(run.lifecycle.outcome, "done");
    assert.equal(run.envelope.attempt, 1, "recovery preserves the immutable item attempt");
  });

  for (const recovery of ["startup", "global"] as const) it(`${recovery} recovery publishes cancellation once without claiming or opening browsers`, async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = admittedWorkerId(stateRoot, clock, recovery === "startup" ? 1 : 2);
    const database = reopen(stateRoot, clock);
    if (recovery === "global" && database.authority.workerLeases.get(workerId) === undefined) assert.equal(database.authority.workerLeases.start({ workerId, workflow: WORKFLOW_ID,
      browserSystems: ["crm", "ucpath"], processId: process.pid, requestedBy: "local-operator", now: NOW }).state, "started");
    const claimed = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId, now: NOW });
    assert.ok(claimed.state === "claimed");
    const service = testRunService(database, clock);
    assert.equal(service.transition({ commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      runId: RUN_ID, expectedVersion: claimed.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() } }).state, "applied");
    if (recovery === "global") clock.advanceWall(600_000);
    const sessions = happySessionHarness();
    const report = await composeWorkerRuntime(composeInput({ repoRoot, clock, sessions, poolIndex: POOL_INDEX_1 }));
    assert.deepEqual(report.outcomes, []);
    assert.equal(sessions.opens("ucpath"), 0);
    assert.equal(sessions.opens("crm"), 0);
    const settled = database.authority.runs.get(RUN_ID);
    assert.ok(settled);
    assert.deepEqual(settled.lifecycle, { state: "terminal", outcome: "cancelled", endedAt: clock.now().toISOString() });
    assert.equal(settled.envelope.attempt, claimed.run.envelope.attempt);
    assert.equal(settled.claimGeneration, claimed.run.claimGeneration);
    // A fresh process repeating startup/global maintenance must not duplicate the terminal event.
    await composeWorkerRuntime(composeInput({ repoRoot, clock, sessions, poolIndex: POOL_INDEX_1 }));
    const terminal = database.authority.timelineEvents.page({ runId: RUN_ID })
      .flatMap((record) => record.payload.kind === "span" ? [record.payload.event] : [])
      .flatMap((event) => event.t === "span.ended" && event.kind === "run" && event.runId === RUN_ID ? [event] : []);
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0]?.outcome, "cancelled");
    assert.equal(terminal[0]?.attempt, claimed.run.envelope.attempt);
    assert.equal(terminal[0]?.traceId, claimed.run.envelope.traceId);
  });

  it("parks — never requeues — its own orphaned claim that holds an attempting write intent", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = admittedWorkerId(stateRoot, clock);
    const crashed = reopen(stateRoot, clock);
    const claimed = crashed.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId, now: NOW });
    assert.ok(claimed.state === "claimed");
    const validating = crashed.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: claimed.run.version,
      claim: { workerId, claimGeneration: 1 },
      lifecycle: { state: "validating", workerId, claimedAt: NOW, heartbeatAt: NOW },
      now: NOW,
    });
    assert.ok(validating.state === "applied");
    const running = crashed.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: validating.run.version,
      claim: { workerId, claimGeneration: 1 },
      lifecycle: { state: "running", workerId, claimedAt: NOW, heartbeatAt: NOW, currentNodeId: "searching" },
      now: NOW,
    });
    assert.ok(running.state === "applied");
    const bindingProof = { ...WRITE_INTENT_ATTEMPTING.bindingProof,
      afterPrepareSpanPath: `${running.run.envelope.traceId}/termination/prepare` };
    const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
    fenceWriteFixture(crashed, {
      intent: { ...WRITE_INTENT_ATTEMPTING, workflowId: WORKFLOW_ID, itemId: ITEM_ID, bindingProof, bindingProofDigest },
      attempt: { ...WRITE_ATTEMPT, bindingProof, bindingProofDigest },
    });
    clock.advanceWall(2_000);
    clock.advanceMonotonic(2_000);

    const lines: string[] = [];
    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), lines, poolIndex: POOL_INDEX_1,
    }));

    assert.deepEqual(report.outcomes, []);
    assert.equal(report.stopped, "idle");
    assert.ok(
      lines.some((line) => line.includes("orphaned claim routed to ref write-safety recovery")),
      "the startup self-sweep did not report the recovery routing",
    );
    const run = crashed.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state === "parked-write");
    assert.equal(run.lifecycle.writeIntentId, WRITE_INTENT_ATTEMPTING.writeIntentId);
    assert.equal(run.envelope.attempt, 1, "a parked write must never take a new attempt");
  });

  it("stops gracefully mid-run: the run is abandoned, never terminalized over a lost claim", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    let started: (() => void) | undefined;
    const driverStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const sessions = sessionFactoryHarness({
      ucpath: () => Object.freeze({
        system: "ucpath" as const,
        searchPersonOrg: (): Promise<never> => {
          started?.();
          return new Promise<never>(() => undefined);
        },
      }),
      crm: () => healthyCrmDriver(),
    });
    const stop = new AbortController();

    const running = composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions, stopSignal: stop.signal, poolIndex: POOL_INDEX_1,
    }));
    await Promise.race([driverStarted, running.then(() => { throw new Error("worker settled before driver start"); })]);
    stop.abort(new Error("operator pressed Ctrl-C"));
    const report = await running;

    assert.equal(report.stopped, "stop-signal");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["abandoned"]);

    assert.deepEqual(sessions.closeReasons(), ["poisoned"]);

    const database = reopen(stateRoot, clock);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run && run.lifecycle.state !== "terminal");
    const lease = database.authority.workerLeases.get(admittedWorkerId(stateRoot, clock));
    assert.ok(lease && lease.lifecycle.state === "stopped");
    assert.equal(lease.lifecycle.reason, "shutdown");
  });

  it("returns unproved closure when worker-stop cannot prove closure, and records the lease as crashed", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const sessions = happySessionHarness();
    const unprovable: SessionFactoryHarness = {
      ...sessions,
      factory: {
        open: async (input) => {
          const resource = await sessions.factory.open(input);
          return {
            ...resource,
            // An unproven close retains the registered resource and reports uncertainty.
            close: () => Promise.reject(new Error(
              `${resource.system} context did not close within its bounded deadline`,
            )),
          };
        },
      },
    };

    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: unprovable, poolIndex: POOL_INDEX_1,
    }));
    assert.equal(report.closure, "unproved");
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);

    const database = reopen(stateRoot, clock);
    const lease = database.authority.workerLeases.get(admittedWorkerId(stateRoot, clock));
    assert.ok(lease && lease.lifecycle.state === "stopped");
    // An unprovable teardown is a crash, never a clean shutdown.
    assert.equal(lease.lifecycle.reason, "crashed");
  });

  it("starts a NEW lease generation over a settled one and drains normally", async () => {
    const { repoRoot, stateRoot } = repoRootWithState();
    const clock = manualClock(new Date(NOW));
    seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
    const workerId = admittedWorkerId(stateRoot, clock);
    const seed = reopen(stateRoot, clock);
    assert.equal(seed.authority.workerLeases.start({
      workerId, workflow: WORKFLOW_ID, browserSystems: ["crm", "ucpath"], processId: 7,
      requestedBy: "local-operator", now: NOW,
    }).state, "started");
    assert.equal(seed.authority.workerLeases.reportLifecycle({
      workerId,
      leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: NOW, stoppedAt: NOW, reason: "operator" },
      now: NOW,
    }).state, "applied");

    const report = await composeWorkerRuntime(composeInput({
      repoRoot, clock, sessions: happySessionHarness(), poolIndex: POOL_INDEX_1,
    }));
    assert.deepEqual(report.outcomes.map(({ state }) => state), ["done"]);
    const lease = seed.authority.workerLeases.get(workerId);
    assert.ok(lease && lease.leaseGeneration === 2 && lease.processId === 4242);
  });
});
