/**
 * The dashboard-owned child-process worker supervisor (ref execution-and-sessions
 * §11, D271): spawns the EXACT worker CLI, proves child birth against the
 * durable worker lease (authority is the only coordination channel — §11.3),
 * records exit/crash/stop-escalation evidence as it occurs, never restarts a
 * crashed child, and never adopts a process it did not spawn.
 *
 * Every process edge is a recording fake at the system boundary: the spawner,
 * the lease probe, the graceful-stop channel, the clock and the scheduler.
 */
import { describe, expect, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import type { TestClock } from "../../../src/domain/clock.js";
import { BrowserSessionIdSchema, PositiveIntSchema, WorkflowIdSchema } from "../../../src/domain/ids.js";
import type { WorkerId } from "../../../src/domain/ids.js";
import { CommandRequestSchema } from "../../../src/domain/commands.js";
import {
  createWorkerPoolRuntimeExecutor,
  poolWorkerId,
  WORKER_GRACEFUL_STOP_TIMEOUT_MS,
  WORKER_SIGTERM_TIMEOUT_MS,
  WorkerPoolMemberSchema,
  WorkerStopEscalationPolicySchema,
  type WorkerPoolMember,
  type WorkerStopEscalationPolicy,
} from "../../../src/core/worker-loop.js";
import {
  createDashboardWorkerProcessSupervisor,
  workerCliArgv,
  type DashboardWorkerProcessSupervisor,
  type SpawnedWorkerHandle,
  type WorkerLeaseBirthFact,
  type WorkerProcessSpawnRequest,
} from "../../../src/server/dashboard/worker-supervisor.js";
import { ManualScheduler } from "../fixtures/phase1f-executor-harness.js";

const WORKFLOW = WorkflowIdSchema.parse("person-lookup");
const NOW = "2026-08-26T09:00:00.000Z";

function member(poolIndex: number): WorkerPoolMember {
  const index = PositiveIntSchema.parse(poolIndex);
  return WorkerPoolMemberSchema.parse({
    workflowId: WORKFLOW,
    poolIndex: index,
    workerId: poolWorkerId(WORKFLOW, index),
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
  /** The graceful-stop channel behavior; default acknowledges at the current wall clock. */
  nextGracefulStop: (
    target: WorkerPoolMember,
  ) => Promise<Readonly<{ requestedAt: string }>> | Readonly<{ requestedAt: string }>;
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
    nextGracefulStop: (): Readonly<{ requestedAt: string }> => ({ requestedAt: clock.now().toISOString() }),
    supervisor: createDashboardWorkerProcessSupervisor({
      launch: {
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
        request: (target) => {
          gracefulRequests.push(target);
          return harness.nextGracefulStop(target);
        },
      },
      clock,
      scheduler,
      birth: { pollMs: 250, timeoutMs: 10_000 },
      onFault: (error) => {
        faults.push(error);
      },
    }),
  };
  return harness;
}

/* ── spawn: exact argv and birth proof ───────────────────────────────────── */

describe("spawn-worker", () => {
  it("launches the exact worker CLI argv and acknowledges only after the durable lease proves the child pid", async () => {
    const harness = openHarness();
    const target = member(1);

    const acknowledgement = await harness.supervisor.execute({
      command: "spawn-worker",
      member: target,
    });

    expect(harness.spawnRequests).toHaveLength(1);
    const request = harness.spawnRequests[0];
    expect(request?.command).toBe("/usr/local/bin/node-worker-cli");
    expect(request?.args).toEqual([
      "--import", "tsx", "src/cli.ts",
      "worker", "person-lookup", "--pool-index", "1",
    ]);
    expect(request?.cwd).toBe("/repo/worktree");
    expect(acknowledgement).toEqual({
      command: "spawn-worker",
      state: "acknowledged",
      member: target,
      ownership: "supervised",
      stage: "started",
    });
    const evidence = harness.supervisor.memberEvidence(target);
    expect(evidence).toMatchObject({
      state: "running",
      pid: harness.children[0]?.pid,
      bornAt: NOW,
      leaseStartedAt: NOW,
    });
  });

  it("derives the argv tail from the member alone", () => {
    expect(workerCliArgv(member(3))).toEqual(["worker", "person-lookup", "--pool-index", "3"]);
  });

  it("refuses a relative launch command at construction — PATH lookup is an ambiguity", () => {
    expect(() => openHarness({ launchCommand: "npm" })).toThrow(/not an absolute path/);
  });

  it("refuses to spawn over a live lease it did not create — no adoption of external workers", async () => {
    const harness = openHarness();
    const target = member(1);
    harness.leases.set(target.workerId, { processId: 999, startedAt: NOW });

    await expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .rejects.toThrow(/externally started worker is never adopted/);
    expect(harness.spawnRequests).toHaveLength(0);
  });

  it("refuses a second spawn while it already owns a live child for the member", async () => {
    const harness = openHarness();
    const target = member(1);
    await harness.supervisor.execute({ command: "spawn-worker", member: target });
    harness.leases.delete(target.workerId);

    await expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .rejects.toThrow(/already owns a running child/);
    expect(harness.spawnRequests).toHaveLength(1);
  });

  it("rejects with exit evidence when the child dies before proving birth", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .rejects.toThrow(/exited with code 1 signal null before proving its lease birth/);
    harness.children[0]?.emitExit(1, null);
    await expectation;

    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "exited",
      outcome: "crashed",
      exitCode: 1,
      signal: null,
      at: NOW,
    });
  });

  it("rejects on a process error before birth", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .rejects.toThrow(/process errored before proving its lease birth: spawn ENOENT/);
    harness.children[0]?.emitError(new Error("spawn ENOENT"));
    await expectation;
  });

  it("records crash evidence, kills the child, and frees the slot on a pre-birth process error", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .rejects.toThrow(/process errored before proving its lease birth: spawn EACCES/);
    harness.children[0]?.emitError(new Error("spawn EACCES"));
    await expectation;

    expect(harness.children[0]?.signalsSent).toEqual(["SIGKILL"]);
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: harness.children[0]?.pid,
      outcome: "crashed",
      exitCode: null,
      signal: null,
      at: NOW,
      observedStop: [],
    });
    // The slot is NOT bricked: an explicit new spawn-worker replaces the record.
    harness.nextSpawn = (request): FakeWorkerChild => {
      const replacement = new FakeWorkerChild(4002);
      harness.leases.set(request.member.workerId, { processId: 4002, startedAt: NOW });
      return replacement;
    };
    await expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .resolves.toMatchObject({ command: "spawn-worker", state: "acknowledged" });
    expect(harness.spawnRequests).toHaveLength(2);
  });

  it("records crash evidence without attempting a kill when the errored child never got a pid", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    harness.nextSpawn = (): FakeWorkerChild => new FakeWorkerChild(undefined);
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .rejects.toThrow(/process errored before proving its lease birth: spawn ENOENT/);
    harness.children[0]?.emitError(new Error("spawn ENOENT"));
    await expectation;

    expect(harness.children[0]?.signalsSent).toEqual([]);
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      outcome: "crashed",
      exitCode: null,
      signal: null,
      at: NOW,
      observedStop: [],
    });
    expect(harness.faults).toHaveLength(0);
  });

  it("forwards a post-birth process error to the fault sink instead of letting it vanish", async () => {
    const harness = openHarness();
    const target = member(1);
    await harness.supervisor.execute({ command: "spawn-worker", member: target });

    harness.children[0]?.emitError(new Error("kill EPERM"));

    expect(harness.faults).toHaveLength(1);
    expect(harness.faults[0]?.message).toMatch(
      new RegExp(`worker ${target.workerId} \\(pid ${String(harness.children[0]?.pid)}\\) process errored after`),
    );
    expect(harness.faults[0]?.message).toMatch(/kill EPERM/);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({ state: "running" });
  });

  it("kills the child and rejects when a birth probe throws on a scheduler tick", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .rejects.toThrow(/birth probe threw before proving its lease birth: lease store unreadable/);

    harness.observeLease = (): WorkerLeaseBirthFact | undefined => {
      throw new Error("lease store unreadable");
    };
    harness.clock.advanceMonotonic(250);
    const poll = harness.scheduler.pending()[0];
    if (poll === undefined) throw new Error("expected a scheduled birth poll");
    poll.fire();
    await expectation;

    expect(harness.children[0]?.signalsSent).toEqual(["SIGKILL"]);
    expect(harness.scheduler.pending()).toHaveLength(0);
    // The killed child's real exit still lands as evidence and frees the slot.
    harness.children[0]?.emitExit(null, "SIGKILL");
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "exited",
      outcome: "crashed",
      signal: "SIGKILL",
    });
  });

  it("routes an undelivered spawn-abort SIGKILL to the fault sink and words the rejection honestly", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const child = new FakeWorkerChild(4321);
    child.killResult = false;
    harness.nextSpawn = (): FakeWorkerChild => child;
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .rejects.toThrow(/proved no lease birth within 10000ms; the unproved child was NOT killed \(SIGKILL was not delivered\)/);

    harness.clock.advanceMonotonic(10_000);
    const poll = harness.scheduler.pending()[0];
    if (poll === undefined) throw new Error("expected a scheduled birth poll");
    poll.fire();
    await expectation;

    expect(harness.faults).toHaveLength(1);
    expect(harness.faults[0]?.message).toMatch(/spawn-abort SIGKILL was not delivered/);
  });

  it("propagates a synchronous spawner failure and leaves no phantom record", async () => {
    const harness = openHarness();
    const target = member(1);
    harness.nextSpawn = () => {
      throw new Error("EAGAIN: process table full");
    };

    await expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .rejects.toThrow(/EAGAIN/);
    expect(harness.supervisor.memberEvidence(target)).toBeUndefined();
  });

  it("kills the child and rejects when no lease birth is proved within the bound", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .rejects.toThrow(/proved no lease birth within 10000ms; the unproved child was killed/);

    harness.clock.advanceMonotonic(10_000);
    const poll = harness.scheduler.pending()[0];
    if (poll === undefined) throw new Error("expected a scheduled birth poll");
    poll.fire();
    await expectation;
    expect(harness.children[0]?.signalsSent).toEqual(["SIGKILL"]);
  });

  it("rejects rather than claiming a child that exited in the same tick it proved birth", async () => {
    const harness = openHarness();
    const target = member(1);
    const pending = harness.supervisor.execute({ command: "spawn-worker", member: target });
    // The lease was published synchronously at spawn, so birth already
    // resolved — but the exit lands before the acknowledgement continuation.
    harness.children[0]?.emitExit(1, null);

    await expect(pending).rejects.toThrow(/exited .*after proving its lease birth/);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "exited",
      outcome: "crashed",
      exitCode: 1,
    });
  });

  it("kills the child and rejects when the lease is owned by a different pid", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .rejects.toThrow(/lease is owned by pid 777, not the spawned child/);

    harness.leases.set(target.workerId, { processId: 777, startedAt: NOW });
    harness.clock.advanceMonotonic(250);
    const poll = harness.scheduler.pending()[0];
    if (poll === undefined) throw new Error("expected a scheduled birth poll");
    poll.fire();
    await expectation;
    expect(harness.children[0]?.signalsSent).toEqual(["SIGKILL"]);
  });
});

/* ── crash evidence and the no-restart rule (D271) ───────────────────────── */

describe("a crashed child", () => {
  async function crashedHarness(): Promise<{ harness: Harness; target: WorkerPoolMember }> {
    const harness = openHarness();
    const target = member(1);
    await harness.supervisor.execute({ command: "spawn-worker", member: target });
    harness.clock.advanceWall(60_000);
    harness.children[0]?.emitExit(1, null);
    harness.leases.delete(target.workerId);
    return { harness, target };
  }

  it("records exit code, signal and instant as crash evidence", async () => {
    const { harness, target } = await crashedHarness();

    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: harness.children[0]?.pid,
      outcome: "crashed",
      exitCode: 1,
      signal: null,
      at: "2026-08-26T09:01:00.000Z",
      observedStop: [],
    });
  });

  it("is never restarted automatically — no new process until an explicit spawn command", async () => {
    const { harness } = await crashedHarness();

    expect(harness.spawnRequests).toHaveLength(1);
    expect(harness.scheduler.pending()).toHaveLength(0);
    expect(harness.faults).toHaveLength(0);
  });

  it("is replaced only by an explicit new spawn-worker command", async () => {
    const { harness, target } = await crashedHarness();

    const acknowledgement = await harness.supervisor.execute({ command: "spawn-worker", member: target });

    expect(acknowledgement).toMatchObject({ command: "spawn-worker", state: "acknowledged" });
    expect(harness.spawnRequests).toHaveLength(2);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "running",
      pid: harness.children[1]?.pid,
    });
  });
});

/* ── bounded stop escalation (D271: graceful → SIGTERM → SIGKILL) ────────── */

function stopPolicy(): WorkerStopEscalationPolicy {
  return WorkerStopEscalationPolicySchema.parse([
    { stage: "graceful-stop-requested", timeoutMs: WORKER_GRACEFUL_STOP_TIMEOUT_MS },
    { stage: "sigterm-sent", timeoutMs: WORKER_SIGTERM_TIMEOUT_MS },
    { stage: "sigkill-sent" },
  ]);
}

async function runningHarness(): Promise<{ harness: Harness; target: WorkerPoolMember }> {
  const harness = openHarness();
  const target = member(1);
  await harness.supervisor.execute({ command: "spawn-worker", member: target });
  return { harness, target };
}

describe("stop-worker", () => {
  it("requests the durable graceful stop and acknowledges only the observed graceful stage", async () => {
    const { harness, target } = await runningHarness();
    harness.clock.advanceWall(5_000);

    const acknowledgement = await harness.supervisor.execute({
      command: "stop-worker",
      member: target,
      escalation: stopPolicy(),
    });

    expect(harness.gracefulRequests).toEqual([target]);
    expect(acknowledgement).toEqual({
      command: "stop-worker",
      state: "acknowledged",
      member: target,
      ownership: "supervised",
      escalation: stopPolicy(),
      observed: [{ stage: "graceful-stop-requested", at: "2026-08-26T09:00:05.000Z" }],
    });
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "stopping",
      observedStop: [{ stage: "graceful-stop-requested", at: "2026-08-26T09:00:05.000Z" }],
    });
  });

  it("escalates to SIGTERM after the graceful bound and SIGKILL after the SIGTERM bound, recording each stage as it happens", async () => {
    const { harness, target } = await runningHarness();
    await harness.supervisor.execute({ command: "stop-worker", member: target, escalation: stopPolicy() });
    const child = harness.children[0];
    if (child === undefined) throw new Error("expected a spawned child");
    expect(child.signalsSent).toEqual([]);

    harness.clock.advanceMonotonic(WORKER_GRACEFUL_STOP_TIMEOUT_MS);
    harness.clock.advanceWall(WORKER_GRACEFUL_STOP_TIMEOUT_MS);
    const sigterm = harness.scheduler.pending()[0];
    if (sigterm === undefined) throw new Error("expected the armed SIGTERM deadline");
    sigterm.fire();
    expect(child.signalsSent).toEqual(["SIGTERM"]);

    harness.clock.advanceMonotonic(WORKER_SIGTERM_TIMEOUT_MS);
    harness.clock.advanceWall(WORKER_SIGTERM_TIMEOUT_MS);
    const sigkill = harness.scheduler.pending()[0];
    if (sigkill === undefined) throw new Error("expected the armed SIGKILL deadline");
    sigkill.fire();
    expect(child.signalsSent).toEqual(["SIGTERM", "SIGKILL"]);

    harness.clock.advanceWall(1_000);
    child.emitExit(null, "SIGKILL");
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: child.pid,
      outcome: "stopped",
      exitCode: null,
      signal: "SIGKILL",
      at: "2026-08-26T09:02:31.000Z",
      observedStop: [
        { stage: "graceful-stop-requested", at: NOW },
        { stage: "sigterm-sent", at: "2026-08-26T09:02:00.000Z" },
        { stage: "sigkill-sent", at: "2026-08-26T09:02:30.000Z" },
      ],
    });
    expect(harness.faults).toHaveLength(0);
  });

  it("never signals a child that exits gracefully before the bound — the deadline is cancelled", async () => {
    const { harness, target } = await runningHarness();
    await harness.supervisor.execute({ command: "stop-worker", member: target, escalation: stopPolicy() });
    const child = harness.children[0];
    if (child === undefined) throw new Error("expected a spawned child");

    harness.clock.advanceWall(30_000);
    child.emitExit(0, null);

    expect(harness.scheduler.pending()).toHaveLength(0);
    expect(child.signalsSent).toEqual([]);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "exited",
      outcome: "stopped",
      exitCode: 0,
      observedStop: [{ stage: "graceful-stop-requested", at: NOW }],
    });
  });

  it("records the DURABLE requestedAt in the graceful stage, not its own clock reading", async () => {
    const { harness, target } = await runningHarness();
    const durableAt = new Date(Date.parse(NOW) + 1234).toISOString();
    harness.nextGracefulStop = (): Readonly<{ requestedAt: string }> => ({ requestedAt: durableAt });

    const acknowledgement = await harness.supervisor.execute({
      command: "stop-worker",
      member: target,
      escalation: stopPolicy(),
    });

    expect(acknowledgement).toMatchObject({
      observed: [{ stage: "graceful-stop-requested", at: "2026-08-26T09:00:01.234Z" }],
    });
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      observedStop: [{ stage: "graceful-stop-requested", at: "2026-08-26T09:00:01.234Z" }],
    });
  });

  it("refuses a stop whose durable request raced the child's exit, preserving the exit evidence", async () => {
    const { harness, target } = await runningHarness();
    harness.nextGracefulStop = async (): Promise<Readonly<{ requestedAt: string }>> => {
      // The child dies while the durable directive is still being requested:
      // the stop must refuse rather than record a stage over a dead child.
      harness.children[0]?.emitExit(1, null);
      return { requestedAt: harness.clock.now().toISOString() };
    };

    await expect(harness.supervisor.execute({ command: "stop-worker", member: target, escalation: stopPolicy() }))
      .rejects.toThrow(/graceful stop for person-lookup-worker-1 raced: .*now exited/);
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: harness.children[0]?.pid,
      outcome: "crashed",
      exitCode: 1,
      signal: null,
      at: NOW,
      observedStop: [],
    });
    expect(harness.scheduler.pending()).toHaveLength(0);
  });

  it("refuses the second of two concurrent stops — the in-flight guard is synchronous", async () => {
    const { harness, target } = await runningHarness();
    harness.nextGracefulStop = async (): Promise<Readonly<{ requestedAt: string }>> => {
      await Promise.resolve();
      return { requestedAt: harness.clock.now().toISOString() };
    };

    const first = harness.supervisor.execute({ command: "stop-worker", member: target, escalation: stopPolicy() });
    const second = harness.supervisor.execute({ command: "stop-worker", member: target, escalation: stopPolicy() });

    await expect(second).rejects.toThrow(/a stop is already in flight for person-lookup-worker-1/);
    await expect(first).resolves.toMatchObject({ command: "stop-worker", state: "acknowledged" });
    expect(harness.gracefulRequests).toHaveLength(1);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "stopping",
      observedStop: [{ stage: "graceful-stop-requested", at: NOW }],
    });
  });

  it("clears the in-flight guard when the durable stop request itself throws, so a retry can stop", async () => {
    const { harness, target } = await runningHarness();
    harness.nextGracefulStop = (): Readonly<{ requestedAt: string }> => {
      throw new Error("directive store unavailable");
    };

    await expect(harness.supervisor.execute({ command: "stop-worker", member: target, escalation: stopPolicy() }))
      .rejects.toThrow(/directive store unavailable/);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({ state: "running" });

    harness.nextGracefulStop = (): Readonly<{ requestedAt: string }> => ({
      requestedAt: harness.clock.now().toISOString(),
    });
    await expect(harness.supervisor.execute({ command: "stop-worker", member: target, escalation: stopPolicy() }))
      .resolves.toMatchObject({ command: "stop-worker", state: "acknowledged" });
  });

  it("refuses a second stop while an escalation is already in flight", async () => {
    const { harness, target } = await runningHarness();
    await harness.supervisor.execute({ command: "stop-worker", member: target, escalation: stopPolicy() });

    await expect(harness.supervisor.execute({ command: "stop-worker", member: target, escalation: stopPolicy() }))
      .rejects.toThrow(/a stop is already in flight/);
    expect(harness.gracefulRequests).toHaveLength(1);
  });

  it("refuses to stop a member it never spawned — external workers are not controlled", async () => {
    const harness = openHarness();

    await expect(harness.supervisor.execute({ command: "stop-worker", member: member(2), escalation: stopPolicy() }))
      .rejects.toThrow(/never spawned .* externally started worker is never adopted or controlled/);
  });

  it("refuses to stop a child that already exited, naming its evidence", async () => {
    const { harness, target } = await runningHarness();
    harness.children[0]?.emitExit(1, null);

    await expect(harness.supervisor.execute({ command: "stop-worker", member: target, escalation: stopPolicy() }))
      .rejects.toThrow(/already exited \(crashed, code 1, signal null\)/);
  });

  it("routes a failed escalation signal to the fault sink instead of recording an unsent stage", async () => {
    const { harness, target } = await runningHarness();
    await harness.supervisor.execute({ command: "stop-worker", member: target, escalation: stopPolicy() });
    const child = harness.children[0];
    if (child === undefined) throw new Error("expected a spawned child");
    child.killResult = false;

    harness.clock.advanceMonotonic(WORKER_GRACEFUL_STOP_TIMEOUT_MS);
    const sigterm = harness.scheduler.pending()[0];
    if (sigterm === undefined) throw new Error("expected the armed SIGTERM deadline");
    sigterm.fire();

    expect(harness.faults).toHaveLength(1);
    expect(harness.faults[0]?.message).toMatch(/escalation SIGTERM was not delivered/);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "stopping",
      observedStop: [{ stage: "graceful-stop-requested", at: NOW }],
    });
  });
});

/* ── pause / resume attestation ──────────────────────────────────────────── */

describe("pause-worker / resume-worker", () => {
  it("attests durable ownership of a running child for pause", async () => {
    const { harness, target } = await runningHarness();

    await expect(harness.supervisor.execute({ command: "pause-worker", member: target })).resolves.toEqual({
      command: "pause-worker",
      state: "acknowledged",
      member: target,
      ownership: "supervised",
      stage: "pause-requested",
    });
  });

  it("attests durable ownership of a running child for resume", async () => {
    const { harness, target } = await runningHarness();

    await expect(harness.supervisor.execute({ command: "resume-worker", member: target })).resolves.toEqual({
      command: "resume-worker",
      state: "acknowledged",
      member: target,
      ownership: "supervised",
      stage: "resume-requested",
    });
  });

  it("refuses to pause a member it never spawned", async () => {
    const harness = openHarness();

    await expect(harness.supervisor.execute({ command: "pause-worker", member: member(1) }))
      .rejects.toThrow(/never spawned .* never adopted or controlled/);
  });

  it("refuses to pause a child whose stop escalation is in flight", async () => {
    const { harness, target } = await runningHarness();
    await harness.supervisor.execute({ command: "stop-worker", member: target, escalation: stopPolicy() });

    await expect(harness.supervisor.execute({ command: "pause-worker", member: target }))
      .rejects.toThrow(/stop is already in flight/);
  });
});

/* ── plan-worker-count reconciliation (W1 exact-excess-coverage contract) ── */

function planRequest(desired: number, members: readonly WorkerPoolMember[], excess: readonly WorkerPoolMember[]) {
  return {
    command: "plan-worker-count" as const,
    workflowId: WORKFLOW,
    desiredWorkers: PositiveIntSchema.parse(desired),
    members,
    excessMembers: excess,
  };
}

describe("plan-worker-count", () => {
  it("covers the full roster in order: running desired, initiating stop for a running excess member, honest unmet for a member with no process", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", member: member(1) });
    await harness.supervisor.execute({ command: "spawn-worker", member: member(2) });
    harness.clock.advanceWall(2_000);

    const acknowledgement = await harness.supervisor.execute(
      planRequest(1, [member(1)], [member(2), member(3)]),
    );

    expect(acknowledgement).toEqual({
      command: "plan-worker-count",
      state: "acknowledged",
      desiredWorkers: 1,
      members: [
        { member: member(1), stage: "running", ownership: "supervised" },
        {
          member: member(2),
          stage: "graceful-stop-requested",
          ownership: "supervised",
          phase: "initiating",
          escalation: stopPolicy(),
          observed: [{ stage: "graceful-stop-requested", at: "2026-08-26T09:00:02.000Z" }],
        },
        { member: member(3), stage: "unmet", reason: "not-started" },
      ],
    });
    expect(harness.gracefulRequests).toEqual([member(2)]);
    expect(harness.supervisor.memberEvidence(member(2))).toMatchObject({ state: "stopping" });
    // The excess member's SIGTERM bound is armed, exactly one deadline.
    expect(harness.scheduler.pending()).toHaveLength(1);
  });

  it("attests a stop already in flight as reconciling, reporting the escalation prefix that already occurred", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", member: member(1) });
    await harness.supervisor.execute({ command: "spawn-worker", member: member(2) });
    await harness.supervisor.execute({ command: "stop-worker", member: member(2), escalation: stopPolicy() });
    harness.clock.advanceMonotonic(WORKER_GRACEFUL_STOP_TIMEOUT_MS);
    harness.clock.advanceWall(WORKER_GRACEFUL_STOP_TIMEOUT_MS);
    harness.scheduler.pending()[0]?.fire();

    const acknowledgement = await harness.supervisor.execute(
      planRequest(1, [member(1)], [member(2), member(3)]),
    );

    expect(acknowledgement.command).toBe("plan-worker-count");
    if (acknowledgement.command !== "plan-worker-count") throw new Error("unreachable");
    expect(acknowledgement.members[1]).toEqual({
      member: member(2),
      stage: "graceful-stop-requested",
      ownership: "supervised",
      phase: "reconciling",
      escalation: stopPolicy(),
      observed: [
        { stage: "graceful-stop-requested", at: NOW },
        { stage: "sigterm-sent", at: "2026-08-26T09:02:00.000Z" },
      ],
    });
    expect(harness.gracefulRequests).toHaveLength(1);
  });

  it("reports a crashed member as unmet/crashed — evidence, not silently re-created capacity", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", member: member(1) });
    await harness.supervisor.execute({ command: "spawn-worker", member: member(2) });
    harness.children[0]?.emitExit(1, null);
    harness.leases.delete(member(1).workerId);

    const acknowledgement = await harness.supervisor.execute(
      planRequest(2, [member(1), member(2)], [member(3)]),
    );

    expect(acknowledgement.command).toBe("plan-worker-count");
    if (acknowledgement.command !== "plan-worker-count") throw new Error("unreachable");
    expect(acknowledgement.members[0]).toEqual({ member: member(1), stage: "unmet", reason: "crashed" });
    expect(acknowledgement.members[1]).toEqual({
      member: member(2), stage: "running", ownership: "supervised",
    });
    expect(harness.spawnRequests).toHaveLength(2);
  });

  it("reads a member whose stop completed as unmet/not-started, not crashed", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", member: member(1) });
    await harness.supervisor.execute({ command: "stop-worker", member: member(1), escalation: stopPolicy() });
    harness.children[0]?.emitExit(0, null);
    harness.leases.delete(member(1).workerId);

    const acknowledgement = await harness.supervisor.execute(planRequest(1, [member(1)], [member(2), member(3)]));

    expect(acknowledgement.command).toBe("plan-worker-count");
    if (acknowledgement.command !== "plan-worker-count") throw new Error("unreachable");
    expect(acknowledgement.members[0]).toEqual({ member: member(1), stage: "unmet", reason: "not-started" });
  });

  it("refuses a roster whose desired member count disagrees with desiredWorkers", async () => {
    const harness = openHarness();

    await expect(harness.supervisor.execute(planRequest(2, [member(1)], [member(3)])))
      .rejects.toThrow(/names 1 desired members for desiredWorkers 2/);
  });

  it("refuses to plan over a child that has not proved birth yet", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const pendingSpawn = harness.supervisor.execute({ command: "spawn-worker", member: member(2) });
    const settled = expect(pendingSpawn).rejects.toThrow(/exited/);

    await expect(harness.supervisor.execute(planRequest(1, [member(1)], [member(2), member(3)])))
      .rejects.toThrow(/has not proved its lease birth/);

    harness.children[0]?.emitExit(1, null);
    await settled;
  });
});

/* ── the W1 contract round-trip: this supervisor's acks survive the pool executor's validators ── */

describe("through createWorkerPoolRuntimeExecutor", () => {
  function workerBrowserCommand(request: Readonly<Record<string, unknown>>) {
    const parsed = CommandRequestSchema.parse({
      commandId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      requestedBy: "local-operator",
      requestedAt: NOW,
      source: "dashboard",
      family: "worker-browser",
      ...request,
    });
    if (parsed.family !== "worker-browser") throw new Error("fixture must be a worker-browser command");
    return parsed;
  }

  it("spawn, stop and reconciling plan acknowledgements all pass W1 validation end to end", async () => {
    const harness = openHarness();
    const executor = createWorkerPoolRuntimeExecutor(harness.supervisor);

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
    })).resolves.toEqual({ state: "accepted" });

    // The scale-down plan: member 1 stays, member 2's stop is attested
    // reconciling, member 3 is honestly unmet — all under W1's validators.
    await expect(executor.planPoolWorkerCount({
      command: workerBrowserCommand({
        type: "plan-worker-count",
        target: { workflowId: WORKFLOW, expectedVersion: 1 },
        payload: { desiredWorkers: 1 },
      }),
      now: NOW,
    })).resolves.toEqual({ state: "accepted", workerIds: [member(1).workerId] });
  });
});

/* ── browser arms: no cross-process channel exists yet ───────────────────── */

describe("browser session arms", () => {
  it("refuses refresh-browser and reopen-browser by name — no effect is acknowledged that cannot happen", async () => {
    const { harness, target } = await runningHarness();
    const browserSessionId = BrowserSessionIdSchema.parse("11111111-2222-4333-8444-555555555555");

    await expect(harness.supervisor.execute({ command: "refresh-browser", member: target, browserSessionId }))
      .rejects.toThrow(/refresh-browser .* no cross-process channel into a live worker's browser sessions/);
    await expect(harness.supervisor.execute({ command: "reopen-browser", member: target, browserSessionId }))
      .rejects.toThrow(/reopen-browser .* no cross-process channel into a live worker's browser sessions/);
  });
});
