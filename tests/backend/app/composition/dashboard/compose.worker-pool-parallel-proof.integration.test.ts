import { WorkerStopDirectiveContextSchema } from "../../../../../src/backend/runtime/workers/worker-loop.js";
import { createDashboardChildTestWorld } from "../../../../support/helpers/backend/dashboard-child-world.js";
import { instrumentPool,kernelOver,type PoolEffectEvent } from "../../../../support/helpers/backend/dashboard-pool-world.js";

import { workerPoolMember } from "../../../../../src/models/run/worker-slot.js";
import { seedSyntheticRuntimeConfig } from "../../../../support/fixtures/operator-command-fixtures.js";
import { releaseAdmissionFixture,releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";

import assert from "node:assert/strict";
import { mkdtempSync,realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { composeWorkerProcessControl } from "../../../../../src/backend/app/composition/dashboard/compose.js";

import { type CommandKernel,type WorkerPoolRuntimeSeam } from "../../../../../src/backend/runs/commands/command-kernel.js";

import { type WorkerPoolMember } from "../../../../../src/backend/runtime/workers/worker-loop.js";
import type { SpawnedWorkerHandle,WorkerProcessSpawnRequest } from "../../../../../src/backend/runtime/workers/worker-supervisor.js";

import { WorkflowIdSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock,type Clock,type TestClock } from "../../../../../src/rules/time/clock.js";


import { AuthorityDatabase } from "../../../../support/helpers/admission-fixture.js";
import { ManualScheduler } from "../../../../support/helpers/phase1f-executor-harness.js";

function servedControlBasis(database: AuthorityDatabase, workerId: string) {
  const lease = database.authority.workerLeases.get(workerId);
  assert.ok(lease?.controlRevision, "the fixture must serve a real control basis");
  return { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision };
}

const NOW = "2026-08-26T09:00:00.000Z";
const PL = WorkflowIdSchema.parse("person-lookup");
const SEP = WorkflowIdSchema.parse("separations");

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the proof expected ${what} to exist`);
  return value;
}

/* ── shared cleanup: kill every child even on failure, then sweep roots ──── */

const { roots, openDatabases, cleanups, cleanup } = createDashboardChildTestWorld(releaseAdmissionFixtures, releaseAdmissionFixture);

afterEach(cleanup, 30_000);

/* ── shared command plumbing ─────────────────────────────────────────────── */

let commandSequence = 0;
function nextCommandId(): string {
  commandSequence += 1;
  const tail = String(commandSequence).padStart(4, "0");
  return `eeeeeeee-${tail}-4000-8000-${tail}00000000`;
}

function envelope(clock: Clock, commandId = nextCommandId()) {
  return {
    commandId,
    requestedAt: clock.now().toISOString(),
    requestedBy: "local-operator",
    source: "dashboard",
    family: "worker-browser",
  } as const;
}

/** One pool-effect boundary crossing, in door order. */


function eventOf(events: readonly PoolEffectEvent[], commandId: string, phase: "enter" | "exit"): PoolEffectEvent {
  return required(
    events.find((event) => event.commandId === commandId && event.phase === phase),
    `a pool-effect ${phase} event for command ${commandId}`,
  );
}





/** Journal truth: an applied command has its row and its applied audit; a refusal has neither. */
function assertJournaled(database: AuthorityDatabase, commandId: string): void {
  assert.notEqual(database.authority.commands.get(commandId), undefined, `command ${commandId} journal row`);
  assert.equal(
    database.authority.commandAudits.findByCommand(commandId)?.result.state,
    "applied",
    `command ${commandId} audit`,
  );
}
function assertUnacknowledged(database: AuthorityDatabase, commandId: string): void {
  assert.notEqual(database.authority.commands.get(commandId), undefined, `command ${commandId} retains admission`);
  assert.equal(database.authority.workerControls.get(commandId)?.phase.state, "uncertain");
  assert.equal(
    database.authority.commandAudits.findByCommand(commandId),
    undefined,
    `command ${commandId} must not audit`,
  );
}

class FakeWorkerChild implements SpawnedWorkerHandle {
  readonly pid: number | undefined;
  readonly signalsSent: string[] = [];
  readonly #killResult: boolean;
  #exitListeners: ((code: number | null, signal: string | null) => void)[] = [];
  #errorListeners: ((error: Error) => void)[] = [];

  constructor(pid: number | undefined, killResult = true) {
    this.pid = pid;
    this.#killResult = killResult;
  }

  kill(signal: "SIGTERM" | "SIGKILL"): boolean {
    this.signalsSent.push(signal);
    return this.#killResult;
  }

  onExit(listener: (code: number | null, signal: string | null) => void): void {
    this.#exitListeners.push(listener);
  }

  onError(listener: (error: Error) => void): void {
    this.#errorListeners.push(listener);
  }

  emitExit(code: number | null, signal: string | null): void {
    for (const listener of this.#exitListeners) listener(code, signal);
  }

  emitError(error: Error): void {
    for (const listener of this.#errorListeners) listener(error);
  }
}

interface SoakHarness {
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly scheduler: ManualScheduler;
  readonly kernel: CommandKernel;
  readonly control: ReturnType<typeof composeWorkerProcessControl>;
  readonly children: FakeWorkerChild[];
  readonly spawnRequests: WorkerProcessSpawnRequest[];
  readonly faults: Error[];
  readonly events: PoolEffectEvent[];
}

interface SoakHarnessOptions {
  /** Per-worker fake-child behavior; default is a healthy signalable child. */
  readonly childFor?: (member: WorkerPoolMember, pid: number) => FakeWorkerChild;

  readonly interceptPool?: (
    pool: WorkerPoolRuntimeSeam,
    edges: Readonly<{ database: AuthorityDatabase; clock: TestClock }>,
  ) => WorkerPoolRuntimeSeam;
}

function openSoakHarness(options?: SoakHarnessOptions): SoakHarness {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-w5-soak-"));
  roots.push(root);
  const clock = manualClock(new Date(NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  seedSyntheticRuntimeConfig(database);
  openDatabases.push(database);
  const scheduler = new ManualScheduler(clock, 0);
  const children: FakeWorkerChild[] = [];
  const spawnRequests: WorkerProcessSpawnRequest[] = [];
  const faults: Error[] = [];
  const events: PoolEffectEvent[] = [];
  let nextPid = 7000;
  const control = composeWorkerProcessControl({
    onExit: () => undefined,
    profileRoot: join(root, "browsers"), processLockRoot: join(root, "locks"),
    database,
    clock,
    scheduler,
    launch: {
      environment: {},
      command: "/usr/bin/fake-worker-node",
      prefixArgs: Object.freeze(["--import", "tsx", "src/cli.ts"]),
      cwd: root,
    },
    spawn: (request) => {
      spawnRequests.push(request);
      nextPid += 1;
      const child = options?.childFor === undefined
        ? new FakeWorkerChild(nextPid)
        : options.childFor(request.member, nextPid);
      children.push(child);
      return child;
    },
    birth: { pollMs: 250, timeoutMs: 10_000 },
    onFault: (error) => {
      faults.push(error);
    },
  });
  cleanups.push(() => {
    control.supervisor.close();
  });
  const intercepted = options?.interceptPool === undefined
    ? control.workerRuntime.pool
    : options.interceptPool(control.workerRuntime.pool, { database, clock });
  const kernel = kernelOver(database, clock, instrumentPool(intercepted, clock, events));
  return { database, clock, scheduler, kernel, control, children, spawnRequests, faults, events };
}

const settleMicrotasks = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function fireBirthPoll(harness: SoakHarness): void {
  for (const entry of harness.scheduler.pending()) entry.fire();
}

/** Prove the last-spawned fake child's birth the way the real worker CLI does. */
function proveBirth(harness: SoakHarness, member: WorkerPoolMember): void {
  const child = required(harness.children.at(-1), "a spawned fake child");
  const pid = required(child.pid, "the fake child's pid");
  assert.equal(harness.database.authority.workerLeases.start({
    workerId: member.workerId,
    workflow: member.workflowId,
    browserSystems: member.workflowId === PL ? ["crm", "ucpath"] : ["ucpath"],
    processId: pid,
    requestedBy: "local-operator",
    now: harness.clock.now().toISOString(),
  }).state, "started");
  fireBirthPoll(harness);
}

function currentMember(harness: SoakHarness, workflow: string, poolIndex: number) {
  const slot = harness.database.authority.workerSlots.list(workflow).find(value => value.poolIndex === poolIndex && value.retiredAt === null);
  return workerPoolMember(required(slot, "current admitted worker slot"));
}

async function planFixture(harness: SoakHarness, workflow: string, desiredWorkers = 1) {
  const planned = await harness.kernel.executeWorkerPool({ ...envelope(harness.clock), type: "plan-worker-count",
    target: { workflowId: workflow, expectedVersion: harness.database.authority.workerPools.get(workflow)?.version ?? 0 },
    payload: { desiredWorkers } });
  assert.equal(planned.state, "applied");
  return currentMember(harness, workflow, 1);
}

describe("soak: overlapping command sequences over the composed pool door (deterministic)", () => {
  it(
    "serializes SAME-workflow commands, interleaves DIFFERENT workflows, and every acknowledgement is truthful",
    async () => {
      const harness = openSoakHarness();

      // ── plan up, both workflows, driven concurrently ────────────────────
      const planPlId = nextCommandId();
      const planSepId = nextCommandId();
      const planPl = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, planPlId),
        type: "plan-worker-count",
        target: { workflowId: PL, expectedVersion: 0 },
        payload: { desiredWorkers: 2 },
      });
      const planSep = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, planSepId),
        type: "plan-worker-count",
        target: { workflowId: SEP, expectedVersion: 0 },
        payload: { desiredWorkers: 1 },
      });
      const [planPlResult, planSepResult] = await Promise.all([planPl, planSep]);
      assert.equal(planPlResult.state, "applied");
      assert.equal(planSepResult.state, "applied");
      const PL_1 = currentMember(harness, PL, 1);
      const PL_2 = currentMember(harness, PL, 2);
      const SEP_1 = currentMember(harness, SEP, 1);
      assert.equal(harness.database.authority.workerPools.get(PL)?.desiredWorkers, 2);
      assert.equal(harness.database.authority.workerPools.get(SEP)?.desiredWorkers, 1);

      // ── DIFFERENT workflows interleave: SEP-1's whole spawn lands INSIDE
      //    PL-1's still-open birth window ───────────────────────────────────
      const spawnPl1Id = nextCommandId();
      const spawnPl1 = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, spawnPl1Id),
        type: "spawn-worker",
        target: { workflowId: PL, expectedVersion: 1 },
        payload: { workerId: PL_1.workerId },
      });
      await settleMicrotasks();
      const spawnSep1Id = nextCommandId();
      const spawnSep1 = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, spawnSep1Id),
        type: "spawn-worker",
        target: { workflowId: SEP, expectedVersion: 1 },
        payload: { workerId: SEP_1.workerId },
      });
      await settleMicrotasks();
      proveBirth(harness, SEP_1);
      assert.equal((await spawnSep1).state, "applied");
      // PL-1 is STILL awaiting birth while SEP-1 settled end to end.
      const pl1Child = required(harness.children[0], "PL-1's child");
      const pl1Pid = required(pl1Child.pid, "PL-1's pid");
      assert.equal(harness.database.authority.workerLeases.start({
        workerId: PL_1.workerId, workflow: PL, browserSystems: ["crm", "ucpath"], processId: pl1Pid,
        requestedBy: "local-operator", now: harness.clock.now().toISOString(),
      }).state, "started");
      fireBirthPoll(harness);
      assert.equal((await spawnPl1).state, "applied");
      assert.ok(
        eventOf(harness.events, spawnSep1Id, "enter").seq > eventOf(harness.events, spawnPl1Id, "enter").seq
        && eventOf(harness.events, spawnSep1Id, "exit").seq < eventOf(harness.events, spawnPl1Id, "exit").seq,
        `SEP-1's spawn effect must nest inside PL-1's: ${JSON.stringify(harness.events)}`,
      );

      // ── SAME workflow serializes: a pause issued during PL-2's in-flight
      //    spawn must not even ENTER the door until that spawn exits ────────
      harness.clock.advanceWall(1_000);
      const spawnPl2Id = nextCommandId();
      const spawnPl2 = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, spawnPl2Id),
        type: "spawn-worker",
        target: { workflowId: PL, expectedVersion: 1 },
        payload: { workerId: PL_2.workerId },
      });
      await settleMicrotasks();
      const pausePl1Id = nextCommandId();
      const pausePl1 = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, pausePl1Id),
        type: "pause-worker",
        target: { workerId: PL_1.workerId, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, PL_1.workerId) },
        reason: "w5 soak pause",
      });
      await settleMicrotasks();
      // Queued behind the same-workflow spawn: no effect entered, no durable
      // directive, no journal row — the acknowledgement has not been minted.
      assert.equal(harness.events.some((event) => event.commandId === pausePl1Id), false);
      assert.equal(harness.database.authority.workerLeases.get(PL_1.workerId)?.control.directive, "run");
      assert.equal(harness.database.authority.commands.get(pausePl1Id), undefined);
      proveBirth(harness, PL_2);
      assert.equal((await spawnPl2).state, "applied");
      assert.equal((await pausePl1).state, "applied");
      assert.ok(
        eventOf(harness.events, pausePl1Id, "enter").seq > eventOf(harness.events, spawnPl2Id, "exit").seq,
        "the pause may enter the door only after the same-workflow spawn exits",
      );
      const pausedAt = harness.clock.now().toISOString();
      assert.deepEqual(harness.database.authority.workerLeases.get(PL_1.workerId)?.control, {
        directive: "pause", requestedAt: pausedAt, requestedBy: "local-operator", reason: "w5 soak pause",
      });
      const resumePl1Id = nextCommandId();
      assert.equal((await harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, resumePl1Id),
        type: "resume-worker",
        target: { workerId: PL_1.workerId, expectedVersion: 2, controlBasis: servedControlBasis(harness.database, PL_1.workerId) },
      })).state, "applied");
      assert.equal(harness.database.authority.workerLeases.get(PL_1.workerId)?.control.directive, "run");

      // ── scale PL down to 1 while SEP still works, then pause SEP — driven
      //    concurrently across the two workflows ────────────────────────────
      harness.clock.advanceWall(1_000);
      const scaleDownAt = harness.clock.now().toISOString();
      const shrinkPlId = nextCommandId();
      const pauseSepId = nextCommandId();
      const shrinkPl = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, shrinkPlId),
        type: "plan-worker-count",
        target: { workflowId: PL, expectedVersion: 1 },
        payload: { desiredWorkers: 1 },
      });
      const pauseSep = harness.kernel.executeWorkerPool({
        ...envelope(harness.clock, pauseSepId),
        type: "pause-worker",
        target: { workerId: SEP_1.workerId, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, SEP_1.workerId) },
        reason: "sep pause",
      });
      await settleMicrotasks();
      const retiring = required(harness.database.authority.workerLeases.get(PL_2.workerId), "retiring PL-2 lease");
      assert.equal(retiring.control.directive, "stop");
      assert.equal(harness.database.authority.workerLeases.reportLifecycle({ workerId: PL_2.workerId,
        leaseGeneration: retiring.leaseGeneration, lifecycle: { state: "stopped", startedAt: retiring.lifecycle.startedAt,
          stoppedAt: scaleDownAt, reason: "operator" }, now: scaleDownAt }).state, "applied");
      required(harness.children[2], "PL-2 child").emitExit(0, null);
      await settleMicrotasks();
      const [shrinkResult, pauseSepResult] = await Promise.all([shrinkPl, pauseSep]);
      assert.equal(shrinkResult.state, "applied");
      assert.equal(pauseSepResult.state, "applied");

      assert.deepEqual(harness.database.authority.workerLeases.get(PL_2.workerId)?.control, {
        directive: "stop", requestedAt: scaleDownAt, requestedBy: "local-operator",
      });
      assert.equal(harness.database.authority.workerLeases.get(PL_1.workerId)?.control.directive, "run");
      assert.equal(harness.database.authority.workerPools.get(PL)?.desiredWorkers, 1);
      assert.equal(harness.database.authority.workerPools.get(PL)?.version, 2);
      assert.equal(harness.control.supervisor.memberEvidence(PL_2)?.state, "exited");
      assert.notEqual(harness.database.authority.workerSlots.get(PL_2.workerId)?.retiredAt, null);
      assert.deepEqual(harness.database.authority.workerLeases.get(SEP_1.workerId)?.control, {
        directive: "pause", requestedAt: scaleDownAt, requestedBy: "local-operator", reason: "sep pause",
      });

      // Internal drain owns process shutdown after the command interleaving proof.
      const stopPl1Id = nextCommandId();
      const drain = harness.control.supervisor.drainOwnedChildren(WorkerStopDirectiveContextSchema.parse({ requestedAt: harness.clock.now().toISOString(),
        requestedBy: "local-operator", reason: "pl teardown" }));
      await settleMicrotasks();
      assert.equal(harness.database.authority.commands.get(stopPl1Id), undefined);
      assert.equal(harness.database.authority.commandAudits.findByCommand(stopPl1Id), undefined);
      for (const member of [PL_1, SEP_1]) {
        const lease = required(harness.database.authority.workerLeases.get(member.workerId), "stopping lease");
        assert.equal(lease.control.directive, "stop");
        assert.equal(harness.database.authority.workerLeases.reportLifecycle({ workerId: member.workerId,
          leaseGeneration: lease.leaseGeneration, lifecycle: { state: "stopped", startedAt: lease.lifecycle.startedAt,
            stoppedAt: harness.clock.now().toISOString(), reason: "operator" }, now: harness.clock.now().toISOString() }).state, "applied");
      }
      required(harness.children[0], "PL-1 child").emitExit(0, null);
      required(harness.children[1], "SEP-1 child").emitExit(0, null);
      await drain;
      for (const member of [PL_1, PL_2, SEP_1]) {
        const evidence = harness.control.supervisor.memberEvidence(member);
        assert.equal(evidence?.state, "exited", member.workerId);
        if (evidence?.state !== "exited") throw new Error("unreachable");
        assert.equal(evidence.outcome, "stopped", member.workerId);
        assert.equal(evidence.reportedBy, "os", member.workerId);
      }
      assert.deepEqual(harness.control.supervisor.close(), []);
      const closedCommand = { ...envelope(harness.clock), type: "spawn-worker",
        target: { workflowId: PL, expectedVersion: 2 }, payload: { workerId: PL_1.workerId } };
      const closed = await harness.kernel.executeWorkerPool(closedCommand);
      assert.equal(closed.state, "rejected");
      if (closed.state === "rejected") assert.match(closed.message, /this worker supervisor is closed; a shutting-down supervisor acknowledges nothing/);
      assert.equal(harness.database.authority.workerControls.get(closedCommand.commandId)?.phase.state, "refused");
      assert.equal(harness.database.authority.commandAudits.findByCommand(closedCommand.commandId)?.result.state, "rejected");

      // ── truthfulness sweep: every applied command journaled + audited ────
      for (const commandId of [
        planPlId, planSepId, spawnPl1Id, spawnSep1Id, spawnPl2Id,
        pausePl1Id, resumePl1Id, shrinkPlId, pauseSepId,
      ]) {
        assertJournaled(harness.database, commandId);
      }
      assert.deepEqual(harness.faults, []);
    },
  );

  it("a spawn ENOENT surfaces typed with retained admission while the sibling workflow's in-flight spawn still lands", async () => {
    const harness = openSoakHarness();
    const SEP_1 = await planFixture(harness, SEP);
    const PL_1 = await planFixture(harness, PL);
    const spawnSepId = nextCommandId();
    const spawnSep = harness.kernel.executeWorkerPool({
      ...envelope(harness.clock, spawnSepId),
      type: "spawn-worker",
      target: { workflowId: SEP, expectedVersion: 1 },
      payload: { workerId: SEP_1.workerId },
    });
    const spawnSepRejected = assert.rejects(spawnSep, /process errored before proving its lease birth: spawn ENOENT; the unproved child was killed/);
    await settleMicrotasks();
    const spawnPlId = nextCommandId();
    const spawnPl = harness.kernel.executeWorkerPool({
      ...envelope(harness.clock, spawnPlId),
      type: "spawn-worker",
      target: { workflowId: PL, expectedVersion: 1 },
      payload: { workerId: PL_1.workerId },
    });
    await settleMicrotasks();
    // The OS refuses SEP-1's launch while PL-1's spawn is mid-flight.
    required(harness.children[0], "SEP-1 child").emitError(new Error("spawn ENOENT"));
    await spawnSepRejected;
    proveBirth(harness, PL_1);
    assert.equal((await spawnPl).state, "applied");
    assertUnacknowledged(harness.database, spawnSepId);
    assertJournaled(harness.database, spawnPlId);
    assert.equal(harness.database.authority.workerLeases.get(SEP_1.workerId), undefined);
    const sepEvidence = harness.control.supervisor.memberEvidence(SEP_1);
    assert.equal(sepEvidence?.state, "exited");
    if (sepEvidence?.state !== "exited") throw new Error("unreachable");
    assert.equal(sepEvidence.outcome, "crashed");
    assert.equal(sepEvidence.reportedBy, "supervisor");
  });

  it("an undelivered escalation SIGTERM reaches the fault sink and records NO stage that did not happen", async () => {
    const harness = openSoakHarness({
      childFor: (_member, pid) => new FakeWorkerChild(pid, false),
    });
    const PL_1 = await planFixture(harness, PL);
    const spawnId = nextCommandId();
    const spawn = harness.kernel.executeWorkerPool({
      ...envelope(harness.clock, spawnId),
      type: "spawn-worker",
      target: { workflowId: PL, expectedVersion: 1 },
      payload: { workerId: PL_1.workerId },
    });
    await settleMicrotasks();
    proveBirth(harness, PL_1);
    assert.equal((await spawn).state, "applied");
    const stopAt = harness.clock.now().toISOString(), stopId = nextCommandId();
    const drain = assert.rejects(harness.control.supervisor.drainOwnedChildren(WorkerStopDirectiveContextSchema.parse({ requestedAt: stopAt,
      requestedBy: "local-operator", reason: "w5 wedge" })), error => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /dashboard could not observe every owned worker exit/);
      assert.equal(error.errors.length, 1);
      assert.match(String(error.errors[0]), /escalation SIGTERM was not delivered/);
      return true;
    });
    await settleMicrotasks();
    assert.equal(harness.database.authority.workerLeases.get(PL_1.workerId)?.control.directive, "stop");

    harness.clock.advanceMonotonic(120_000);
    for (const entry of harness.scheduler.pending()) entry.fire();
    await drain;
    assert.equal(harness.faults.length, 1);
    assert.match(
      required(harness.faults[0], "the wedged-stop fault").message,
      /escalation SIGTERM was not delivered and the child has not reported exit; the stop is wedged/,
    );
    // The evidence records ONLY the stage that actually happened.
    const evidence = harness.control.supervisor.memberEvidence(PL_1);
    assert.equal(evidence?.state, "stopping");
    if (evidence?.state !== "stopping") throw new Error("unreachable");
    assert.deepEqual(evidence.observedStop, [{ stage: "graceful-stop-requested", at: stopAt }]);

    assert.equal(harness.scheduler.pending().length, 0);
    assert.equal(harness.database.authority.commands.get(stopId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(stopId), undefined);
  });

  it("a worker that dies before supervisor admission is durably refused without a pause effect", async () => {
    const harness = openSoakHarness({
      interceptPool: (pool, edges) => ({
        ...pool,
        pausePoolWorker: async (context) => {

          const lease = required(
            edges.database.authority.workerLeases.get(PL_1.workerId),
            "PL-1's lease",
          );
          const now = edges.clock.now().toISOString();
          assert.equal(edges.database.authority.workerLeases.reportLifecycle({
            workerId: PL_1.workerId,
            leaseGeneration: lease.leaseGeneration,
            lifecycle: { state: "stopped", startedAt: lease.lifecycle.startedAt, stoppedAt: now, reason: "crashed" },
            now,
          }).state, "applied");
          return pool.pausePoolWorker(context);
        },
      }),
    });
    const PL_1 = await planFixture(harness, PL);
    const spawnId = nextCommandId();
    const spawn = harness.kernel.executeWorkerPool({
      ...envelope(harness.clock, spawnId),
      type: "spawn-worker",
      target: { workflowId: PL, expectedVersion: 1 },
      payload: { workerId: PL_1.workerId },
    });
    await settleMicrotasks();
    proveBirth(harness, PL_1);
    assert.equal((await spawn).state, "applied");

    const stopId = nextCommandId();
    const result = await harness.kernel.executeWorkerPool({
      ...envelope(harness.clock, stopId), type: "pause-worker",
      target: { workerId: PL_1.workerId, expectedVersion: 1, controlBasis: servedControlBasis(harness.database, PL_1.workerId) }, reason: "w5 refused",
    });
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.match(result.message, /worker-control-basis-changed-before-effect/);
    assert.equal(harness.database.authority.workerControls.get(stopId)?.phase.state, "refused");
    assert.equal(harness.database.authority.commandAudits.findByCommand(stopId)?.result.state, "rejected");
    assert.equal(harness.database.authority.workerLeases.get(PL_1.workerId)?.lifecycle.state, "stopped");
    assert.deepEqual(harness.database.authority.commandAudits.findByCommand(stopId)?.versionChanges, []);
    assert.equal(harness.control.supervisor.memberEvidence(PL_1)?.state, "running");

  });
});
