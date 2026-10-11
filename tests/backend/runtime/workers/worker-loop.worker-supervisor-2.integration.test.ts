import { randomUUID } from "node:crypto";
import { admitWorkerPoolRoster } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { openAuthorityHarness } from "../../../support/helpers/phase1f-executor-harness.js";

import assert from "node:assert/strict";
import { describe,expect,it } from "vitest";
import {
createWorkerPoolRuntimeExecutor,
WORKER_GRACEFUL_STOP_TIMEOUT_MS,
WORKER_SIGTERM_TIMEOUT_MS,
WorkerPoolMemberSchema,
WorkerStopDirectiveContextSchema,
WorkerStopEscalationPolicySchema,
type WorkerPoolMember,
type WorkerStopDirectiveContext,
type WorkerStopEscalationPolicy,
} from "../../../../src/backend/runtime/workers/worker-loop.js";
import {
createDashboardWorkerProcessSupervisor,
WORKER_EXIT_OBSERVATION_TIMEOUT_MS,
type DashboardWorkerProcessSupervisor,
type SpawnedWorkerHandle,
type WorkerDurableStopReceipt,
type WorkerLeaseBirthFact,
type WorkerProcessSpawnRequest
} from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import type { WorkerId } from "../../../../src/rules/identity/ids.js";
import { BrowserSessionIdSchema,PositiveIntSchema,WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import type { TestClock } from "../../../../src/rules/time/clock.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { ManualScheduler } from "../../../support/helpers/phase1f-executor-harness.js";

const WORKFLOW = WorkflowIdSchema.parse("person-lookup");
const NOW = "2026-08-26T09:00:00.000Z";

function member(poolIndex: number): WorkerPoolMember {
  const index = PositiveIntSchema.parse(poolIndex);
  return WorkerPoolMemberSchema.parse({
    workflowId: WORKFLOW,
    poolIndex: index,
    workerId: `${WORKFLOW}-worker-${index}`, ordinal: index, membershipRevision: 1,
  });
}

/* ── fakes at the process boundary ───────────────────────────────────────── */

type ExitListener = (code: number | null, signal: string | null) => void;
type ErrorListener = (error: Error) => void;

class FakeWorkerChild implements SpawnedWorkerHandle {
  readonly pid: number | undefined;
  readonly signalsSent: string[] = [];
  killResult = true;
  #exitListeners: ExitListener[] = [];
  #errorListeners: ErrorListener[] = [];
  #exited = false;

  constructor(pid: number | undefined) {
    this.pid = pid;
  }

  kill(signal: "SIGTERM" | "SIGKILL"): boolean {
    this.signalsSent.push(signal);
    return this.killResult;
  }

  onExit(listener: ExitListener): void {
    this.#exitListeners.push(listener);
  }

  onError(listener: ErrorListener): void {
    this.#errorListeners.push(listener);
  }

  emitExit(code: number | null, signal: string | null): void {
    if (this.#exited) throw new Error("fake child already exited");
    this.#exited = true;
    for (const listener of this.#exitListeners) listener(code, signal);
  }

  emitError(error: Error): void {
    for (const listener of this.#errorListeners) listener(error);
  }
}

interface Harness {
  readonly supervisor: DashboardWorkerProcessSupervisor;
  readonly clock: TestClock;
  readonly scheduler: ManualScheduler;
  readonly spawnRequests: WorkerProcessSpawnRequest[];
  readonly children: FakeWorkerChild[];
  readonly gracefulRequests: WorkerPoolMember[];
  readonly faults: Error[];
  readonly leases: Map<WorkerId, WorkerLeaseBirthFact>;
  /** The next spawner behavior; default mints a fake child at the next pid. */
  nextSpawn: (request: WorkerProcessSpawnRequest) => FakeWorkerChild;
  /** The lease probe behavior; default reads the `leases` map. */
  observeLease: (workerId: WorkerId) => WorkerLeaseBirthFact | undefined;
  /** The graceful-stop channel behavior; default echoes the directive's own requestedAt (a well-behaved channel). */
  nextGracefulStop: (
    target: WorkerPoolMember,
    directive: WorkerStopDirectiveContext,
  ) => Promise<WorkerDurableStopReceipt> | WorkerDurableStopReceipt;
}


const DIRECTIVE_WRITE_VERSIONS = Object.freeze({ before: 1, after: 2 });

function stopReceipt(requestedAt: string): WorkerDurableStopReceipt {
  return Object.freeze({ requestedAt, leaseVersions: DIRECTIVE_WRITE_VERSIONS });
}

const LAUNCH = Object.freeze({
  command: "/usr/local/bin/node-worker-cli",
  prefixArgs: Object.freeze(["--import", "tsx", "src/cli.ts"]),
  cwd: "/repo/worktree",
});

function openHarness(overrides?: Readonly<{
  launchCommand?: string;
  /** `true` (default) publishes the child's lease synchronously at spawn. */
  publishLeaseOnSpawn?: boolean;
}>): Harness {
  const clock = manualClock(new Date(NOW));
  const scheduler = new ManualScheduler(clock, 0);
  const spawnRequests: WorkerProcessSpawnRequest[] = [];
  const children: FakeWorkerChild[] = [];
  const gracefulRequests: WorkerPoolMember[] = [];
  const faults: Error[] = [];
  const leases = new Map<WorkerId, WorkerLeaseBirthFact>();
  let nextPid = 4000;
  const publish = overrides?.publishLeaseOnSpawn ?? true;
  const harness: Harness = {
    clock,
    scheduler,
    spawnRequests,
    children,
    gracefulRequests,
    faults,
    leases,
    nextSpawn: (request): FakeWorkerChild => {
      const child = new FakeWorkerChild(nextPid += 1);
      if (publish && child.pid !== undefined) {
        leases.set(request.member.workerId, {
          processId: child.pid,
          startedAt: clock.now().toISOString(),
        });
      }
      return child;
    },
    observeLease: (workerId): WorkerLeaseBirthFact | undefined => leases.get(workerId),
    nextGracefulStop: (_target, directive): WorkerDurableStopReceipt =>
      stopReceipt(directive.requestedAt),
    supervisor: createDashboardWorkerProcessSupervisor({
      launch: {
        environment: {},
        command: overrides?.launchCommand ?? LAUNCH.command,
        prefixArgs: LAUNCH.prefixArgs,
        cwd: LAUNCH.cwd,
      },
      spawn: (request) => {
        spawnRequests.push(request);
        const child = harness.nextSpawn(request);
        children.push(child);
        return child;
      },
      leases: { observe: (workerId) => harness.observeLease(workerId) },
      gracefulStop: {
        request: (target, directive) => {
          gracefulRequests.push(target);
          return harness.nextGracefulStop(target, directive);
        },
      },
      clock,
      scheduler,
      birth: { pollMs: 250, timeoutMs: 10_000 },
      proveRetirement: member => { throw new Error(`fixture native profile retirement not available: ${member.workerId}`); },
      onFault: (error) => {
        faults.push(error);
      },
    }),
  };
  return harness;
}



function stopPolicy(): WorkerStopEscalationPolicy {
  return WorkerStopEscalationPolicySchema.parse([
    { stage: "graceful-stop-requested", timeoutMs: WORKER_GRACEFUL_STOP_TIMEOUT_MS },
    { stage: "sigterm-sent", timeoutMs: WORKER_SIGTERM_TIMEOUT_MS },
    { stage: "sigkill-sent" },
  ]);
}

/** The kernel command's stop identity — `requestedAt` IS the command's now. */
function stopDirective(at: string): WorkerStopDirectiveContext {
  return WorkerStopDirectiveContextSchema.parse({ requestedAt: at, requestedBy: "local-operator" });
}

/** A stop-worker request minted at the harness clock's current instant, as the kernel's executor would. */
function stopRequest(harness: Harness, target: WorkerPoolMember): {
  command: "stop-worker";
  member: WorkerPoolMember;
  escalation: WorkerStopEscalationPolicy;
  directive: WorkerStopDirectiveContext;
} {
  return {
    command: "stop-worker",
    member: target,
    escalation: stopPolicy(),
    directive: stopDirective(harness.clock.now().toISOString()),
  };
}

async function runningHarness(): Promise<{ harness: Harness; target: WorkerPoolMember }> {
  const harness = openHarness();
  const target = member(1);
  await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target });
  return { harness, target };
}



describe("through createWorkerPoolRuntimeExecutor", () => {
  function workerBrowserCommand(request: Readonly<Record<string, unknown>>) {
    const parsed = CommandRequestSchema.parse({
      commandId: randomUUID(),
      requestedBy: "local-operator",
      requestedAt: NOW,
      source: "dashboard",
      family: "worker-browser",
      ...request,
    });
    if (parsed.family !== "worker-browser") throw new Error("fixture must be a worker-browser command");
    return parsed;
  }

  it("admits native slots for spawn and stop but refuses plan completion without native retirement proof", async () => {
    const harness = openHarness();
    const authority = openAuthorityHarness();
    try {
    const initial = workerBrowserCommand({ type: "plan-worker-count", target: { workflowId: WORKFLOW, expectedVersion: 0 }, payload: { desiredWorkers: 2 } });
    if (initial.type !== "plan-worker-count") throw new Error("fixture plan required");
    authority.database.withAuthorityTransaction(repositories => { repositories.commands.insert(initial); admitWorkerPoolRoster(repositories, initial, NOW); });
    const executor = createWorkerPoolRuntimeExecutor(harness.supervisor, authority.database.authority.workerSlots);

    for (const poolIndex of [1, 2]) {
      await expect(executor.spawnPoolWorker({
        command: workerBrowserCommand({
          type: "spawn-worker",
          target: { workflowId: WORKFLOW, expectedVersion: 1 },
          payload: { workerId: member(poolIndex).workerId },
        }),
        now: NOW,
      })).resolves.toEqual({ state: "accepted" });
    }

    await expect(executor.stopPoolWorker({
      command: workerBrowserCommand({
        type: "stop-worker",
        target: { workerId: member(2).workerId, expectedVersion: 1 },
      }),
      now: NOW,
    })).resolves.toEqual({ state: "accepted", directiveLeaseVersions: DIRECTIVE_WRITE_VERSIONS });


    const plan = workerBrowserCommand({ type: "plan-worker-count", target: { workflowId: WORKFLOW, expectedVersion: authority.database.authority.workerPools.get(WORKFLOW)!.version }, payload: { desiredWorkers: 1 } });
    if (plan.type !== "plan-worker-count") throw new Error("fixture plan required");
    const roster = authority.database.withAuthorityTransaction(repositories => { repositories.commands.insert(plan); return admitWorkerPoolRoster(repositories, plan, NOW); });
    const pending = executor.planPoolWorkerCount({ command: plan, now: NOW, roster });
    const refused = expect(pending).rejects.toThrow(/fixture native profile retirement not available/);
    await Promise.resolve(); await Promise.resolve();
    harness.children[1]?.emitExit(0, null);
    harness.leases.delete(member(2).workerId);
    await refused;
    expect(harness.gracefulRequests).toHaveLength(1);
    } finally { authority.dispose(); }
  });
});



describe("drainOwnedChildren", () => {
  it("requests the durable graceful stop and resolves only after the owned child's real exit", async () => {
    const { harness, target } = await runningHarness();
    let drained = false;
    const pending = harness.supervisor.drainOwnedChildren(stopDirective(NOW)).then(() => { drained = true; });

    await Promise.resolve();
    expect(harness.gracefulRequests).toEqual([target]);
    expect(drained).toBe(false);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({ state: "stopping" });

    harness.children[0]?.emitExit(0, null);
    await pending;

    expect(drained).toBe(true);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "exited",
      outcome: "stopped",
      reportedBy: "os",
      observedStop: [{ stage: "graceful-stop-requested", at: NOW }],
    });
  });

  it("keeps escalation active until a real exit follows SIGKILL", async () => {
    const { harness, target } = await runningHarness();
    let drained = false;
    const pending = harness.supervisor.drainOwnedChildren(stopDirective(NOW)).then(() => { drained = true; });
    await Promise.resolve();
    harness.clock.advanceMonotonic(WORKER_GRACEFUL_STOP_TIMEOUT_MS);
    harness.clock.advanceWall(WORKER_GRACEFUL_STOP_TIMEOUT_MS);
    harness.scheduler.pending()[0]?.fire();
    expect(harness.children[0]?.signalsSent).toEqual(["SIGTERM"]);
    harness.clock.advanceMonotonic(WORKER_SIGTERM_TIMEOUT_MS);
    harness.clock.advanceWall(WORKER_SIGTERM_TIMEOUT_MS);
    harness.scheduler.pending()[0]?.fire();
    expect(harness.children[0]?.signalsSent).toEqual(["SIGTERM", "SIGKILL"]);
    expect(drained).toBe(false);

    harness.children[0]?.emitExit(null, "SIGKILL");
    await pending;
    expect(drained).toBe(true);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({ state: "exited", reportedBy: "os" });
  });

  it("fails visibly when SIGKILL was delivered but no OS exit arrives within the observation bound", async () => {
    const { harness, target } = await runningHarness();
    const pending = harness.supervisor.drainOwnedChildren(stopDirective(NOW));
    await Promise.resolve();
    harness.clock.advanceMonotonic(WORKER_GRACEFUL_STOP_TIMEOUT_MS);
    harness.scheduler.pending()[0]?.fire();
    harness.clock.advanceMonotonic(WORKER_SIGTERM_TIMEOUT_MS);
    harness.scheduler.pending()[0]?.fire();
    const failed = expect(pending).rejects.toThrow(/could not observe every owned worker exit/);

    harness.clock.advanceMonotonic(WORKER_EXIT_OBSERVATION_TIMEOUT_MS);
    harness.scheduler.pending()[0]?.fire();
    await failed;

    expect(harness.faults.some(({ message }) => /no OS exit was observed/.test(message))).toBe(true);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({ state: "stopping", pid: harness.children[0]?.pid });
    harness.supervisor.close();
  });
});

describe("close", () => {
  it("cancels every armed escalation timer and returns the still-live children's evidence", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: member(1) });
    await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: member(2) });
    await harness.supervisor.execute(stopRequest(harness, member(1)));
    expect(harness.scheduler.pending()).toHaveLength(1);

    const live = harness.supervisor.close();

    expect(harness.scheduler.pending()).toHaveLength(0);
    expect(live).toEqual([
      {
        state: "stopping",
        pid: harness.children[0]?.pid,
        bornAt: NOW,
        observedStop: [{ stage: "graceful-stop-requested", at: NOW }],
      },
      {
        state: "running",
        pid: harness.children[1]?.pid,
        bornAt: NOW,
        leaseStartedAt: NOW,
      },
    ]);
    // Idempotent: a second close has nothing left to cancel and reports the
    // same still-live children.
    expect(harness.supervisor.close()).toEqual(live);
  });

  it("returns no evidence when every child already exited", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: member(1) });
    harness.children[0]?.emitExit(0, null);

    expect(harness.supervisor.close()).toEqual([]);
  });

  it("includes a kill-undelivered child's evidence in close() — a possibly-live child is never hidden from teardown", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const child = new FakeWorkerChild(4321);
    child.killResult = false;
    harness.nextSpawn = (): FakeWorkerChild => child;
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: target }))
      .rejects.toThrow(/process errored before proving its lease birth/);
    child.emitError(new Error("spawn EPERM"));
    await expectation;
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({ state: "kill-undelivered" });

    const live = harness.supervisor.close();

    expect(live).toEqual([{
      state: "kill-undelivered",
      pid: 4321,
      at: NOW,
      cause: "spawn EPERM",
    }]);
  });

  it("refuses every command after close — a closed supervisor acknowledges nothing", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: member(1) });
    harness.supervisor.close();

    await expect(harness.supervisor.execute({ command: "spawn-worker", commandId: "00000000-0000-4000-8000-000000000003", member: member(2) }))
      .rejects.toThrow(/supervisor is closed/);
    await expect(harness.supervisor.execute(stopRequest(harness, member(1))))
      .rejects.toThrow(/supervisor is closed/);
    expect(harness.spawnRequests).toHaveLength(1);
    expect(harness.gracefulRequests).toHaveLength(0);
    // Evidence stays readable after close: the record is history, not a command.
    expect(harness.supervisor.memberEvidence(member(1))).toMatchObject({ state: "running" });
  });
});

/* ── browser arms: no cross-process channel exists yet ───────────────────── */

describe("browser session arms", () => {
  it("refuses refresh-browser and reopen-browser by name — no effect is acknowledged that cannot happen", async () => {
    const { harness, target } = await runningHarness();
    const browserSessionId = BrowserSessionIdSchema.parse("11111111-2222-4333-8444-555555555555");

    await expect(harness.supervisor.execute({ command: "refresh-browser", member: target, browserSessionId }))
      .rejects.toThrow(/worker-browser-channel-unavailable/);
    await expect(harness.supervisor.execute({ command: "reopen-browser", member: target, browserSessionId }))
      .rejects.toThrow(/worker-browser-channel-unavailable/);
  });
});

it("observes an early drain rejection on the original promise and still refuses shutdown", async () => {
  const { harness } = await runningHarness();
  const failure = new Error("durable stop unavailable");
  harness.nextGracefulStop = () => { throw failure; };
  await assert.rejects(harness.supervisor.drainOwnedChildren(stopDirective(NOW)), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.message, "dashboard could not observe every owned worker exit");
    assert.ok(error.errors.some((cause: unknown) => cause instanceof Error && cause.message.includes("durable stop unavailable")));
    return true;
  });
  expect(harness.children[0]?.signalsSent).toEqual([]);
  harness.children[0]?.emitExit(0, null); harness.supervisor.close();
});
