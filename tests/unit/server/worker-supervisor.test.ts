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
  WorkerStopDirectiveContextSchema,
  poolWorkerId,
  WORKER_GRACEFUL_STOP_TIMEOUT_MS,
  WORKER_SIGTERM_TIMEOUT_MS,
  WorkerPoolMemberSchema,
  WorkerStopEscalationPolicySchema,
  type WorkerPoolMember,
  type WorkerStopDirectiveContext,
  type WorkerStopEscalationPolicy,
} from "../../../src/core/worker-loop.js";
import {
  createDashboardWorkerProcessSupervisor,
  workerCliArgv,
  type DashboardWorkerProcessSupervisor,
  type SpawnedWorkerHandle,
  type WorkerDurableStopReceipt,
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
  /** The graceful-stop channel behavior; default echoes the directive's own requestedAt (a well-behaved channel). */
  nextGracefulStop: (
    target: WorkerPoolMember,
    directive: WorkerStopDirectiveContext,
  ) => Promise<WorkerDurableStopReceipt> | WorkerDurableStopReceipt;
}

/**
 * The directive write's lease versions a well-behaved channel reports: the
 * fake authority's lease is born at version 1, so the stop write is 1 → 2.
 */
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
      reportedBy: "os",
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
    // The exit evidence is supervisor-SYNTHESIZED (there is no OS exit event
    // for a child whose abort SIGKILL was delivered) and says so.
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: harness.children[0]?.pid,
      outcome: "crashed",
      exitCode: null,
      signal: null,
      at: NOW,
      reportedBy: "supervisor",
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
      reportedBy: "supervisor",
      observedStop: [],
    });
    expect(harness.faults).toHaveLength(0);
  });

  it("never fabricates exit evidence when the pre-birth abort SIGKILL was NOT delivered — the possibly-live child blocks the slot", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const child = new FakeWorkerChild(4321);
    child.killResult = false;
    harness.nextSpawn = (): FakeWorkerChild => child;
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .rejects.toThrow(/process errored before proving its lease birth: spawn EPERM; the unproved child was NOT killed/);
    child.emitError(new Error("spawn EPERM"));
    await expectation;

    expect(harness.faults).toHaveLength(1);
    expect(harness.faults[0]?.message).toMatch(/spawn-abort SIGKILL was not delivered/);
    // NOT recorded "exited": the child may still be alive, and synthesizing an
    // exit would free the slot for a replacement beside the live orphan.
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "kill-undelivered",
      pid: 4321,
      at: NOW,
      cause: "spawn EPERM",
    });
    // Respawn is BLOCKED until the child's real exit is observed.
    await expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .rejects.toThrow(/a replacement cannot run beside a possibly-live orphan/);
    expect(harness.spawnRequests).toHaveLength(1);
    // So are stop, pause and plan coverage — each refuses by name.
    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/stop-worker refused: .*spawn-abort SIGKILL was not delivered/);
    await expect(harness.supervisor.execute({ command: "pause-worker", member: target }))
      .rejects.toThrow(/pause-worker refused: .*spawn-abort SIGKILL was not delivered/);
    await expect(harness.supervisor.execute(planRequest(1, [target], [])))
      .rejects.toThrow(/plan-worker-count refused: .*spawn-abort SIGKILL was not delivered/);
    expect(harness.gracefulRequests).toHaveLength(0);
    // The child stays visible to close()'s caller as still possibly live.
    // The REAL exit, when it lands, resolves the uncertainty with OS evidence
    // and frees the slot.
    child.emitExit(null, "SIGKILL");
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "exited",
      outcome: "crashed",
      signal: "SIGKILL",
      reportedBy: "os",
    });
    harness.nextSpawn = (request): FakeWorkerChild => {
      const replacement = new FakeWorkerChild(4322);
      harness.leases.set(request.member.workerId, { processId: 4322, startedAt: NOW });
      return replacement;
    };
    await expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .resolves.toMatchObject({ command: "spawn-worker", state: "acknowledged" });
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
    // Asserted BEFORE awaiting the rejection: a swallowed birth-probe catch
    // would leave the spawn pending forever, so awaiting first would turn
    // that mutation into a 30s test timeout instead of a real diff here.
    expect(harness.children[0]?.signalsSent).toEqual(["SIGKILL"]);
    expect(harness.scheduler.pending()).toHaveLength(0);
    await expectation;

    // The killed child's real exit still lands as evidence and frees the slot.
    harness.children[0]?.emitExit(null, "SIGKILL");
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "exited",
      outcome: "crashed",
      signal: "SIGKILL",
      reportedBy: "os",
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
      reportedBy: "os",
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
  await harness.supervisor.execute({ command: "spawn-worker", member: target });
  return { harness, target };
}

describe("stop-worker", () => {
  it("requests the durable graceful stop and acknowledges only the observed graceful stage", async () => {
    const { harness, target } = await runningHarness();
    harness.clock.advanceWall(5_000);

    const acknowledgement = await harness.supervisor.execute(stopRequest(harness, target));

    expect(harness.gracefulRequests).toEqual([target]);
    expect(acknowledgement).toEqual({
      command: "stop-worker",
      state: "acknowledged",
      member: target,
      ownership: "supervised",
      escalation: stopPolicy(),
      observed: [{ stage: "graceful-stop-requested", at: "2026-08-26T09:00:05.000Z" }],
      directiveLeaseVersions: DIRECTIVE_WRITE_VERSIONS,
    });
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "stopping",
      observedStop: [{ stage: "graceful-stop-requested", at: "2026-08-26T09:00:05.000Z" }],
    });
  });

  it("escalates to SIGTERM after the graceful bound and SIGKILL after the SIGTERM bound, recording each stage as it happens", async () => {
    const { harness, target } = await runningHarness();
    const stoppedAtMonotonic = harness.clock.monotonicMs();
    await harness.supervisor.execute(stopRequest(harness, target));
    const child = harness.children[0];
    if (child === undefined) throw new Error("expected a spawned child");
    expect(child.signalsSent).toEqual([]);

    harness.clock.advanceMonotonic(WORKER_GRACEFUL_STOP_TIMEOUT_MS);
    harness.clock.advanceWall(WORKER_GRACEFUL_STOP_TIMEOUT_MS);
    const sigterm = harness.scheduler.pending()[0];
    if (sigterm === undefined) throw new Error("expected the armed SIGTERM deadline");
    // D271: the SIGTERM deadline is EXACTLY the graceful bound past the stop.
    expect(sigterm.deadlineMonotonicMs).toBe(stoppedAtMonotonic + 120_000);
    sigterm.fire();
    expect(child.signalsSent).toEqual(["SIGTERM"]);

    harness.clock.advanceMonotonic(WORKER_SIGTERM_TIMEOUT_MS);
    harness.clock.advanceWall(WORKER_SIGTERM_TIMEOUT_MS);
    const sigkill = harness.scheduler.pending()[0];
    if (sigkill === undefined) throw new Error("expected the armed SIGKILL deadline");
    // D271: the SIGKILL deadline is EXACTLY the SIGTERM bound past the SIGTERM send.
    expect(sigkill.deadlineMonotonicMs).toBe(stoppedAtMonotonic + 120_000 + 30_000);
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
      reportedBy: "os",
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
    await harness.supervisor.execute(stopRequest(harness, target));
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

  it("refuses a durable requestedAt that is not the command's now, and blocks the member until exit", async () => {
    // The W1/W2 seam pin: the kernel bounds observed stages by the command's
    // `now`, so a channel that lands the directive at any OTHER instant would
    // record a stage the kernel must reject. The supervisor refuses it by name
    // and blocks the member — the directive DID land, so nothing may attest or
    // re-stop over it until the child's real exit is observed.
    const { harness, target } = await runningHarness();
    const durableAt = new Date(Date.parse(NOW) + 1234).toISOString();
    harness.nextGracefulStop = (): WorkerDurableStopReceipt => stopReceipt(durableAt);

    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/durable requestedAt 2026-08-26T09:00:01\.234Z that is not the command's now/);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "stop-uncertain",
      cause: expect.stringContaining("landed at 2026-08-26T09:00:01.234Z, not the command's now") as unknown,
    });
    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/durable stop directive is UNCERTAIN/);
  });

  it("refuses a stop whose durable request raced the child's exit, preserving the exit evidence", async () => {
    const { harness, target } = await runningHarness();
    harness.nextGracefulStop = async (): Promise<WorkerDurableStopReceipt> => {
      // The child dies while the durable directive is still being requested:
      // the stop must refuse rather than record a stage over a dead child.
      harness.children[0]?.emitExit(1, null);
      return stopReceipt(harness.clock.now().toISOString());
    };

    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/graceful stop for person-lookup-worker-1 raced: .*now exited/);
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: harness.children[0]?.pid,
      outcome: "crashed",
      exitCode: 1,
      signal: null,
      at: NOW,
      reportedBy: "os",
      observedStop: [],
    });
    expect(harness.scheduler.pending()).toHaveLength(0);
  });

  it("refuses the second of two concurrent stops — the in-flight guard is synchronous", async () => {
    const { harness, target } = await runningHarness();
    harness.nextGracefulStop = async (): Promise<WorkerDurableStopReceipt> => {
      await Promise.resolve();
      return stopReceipt(harness.clock.now().toISOString());
    };

    const first = harness.supervisor.execute(stopRequest(harness, target));
    const second = harness.supervisor.execute(stopRequest(harness, target));

    await expect(second).rejects.toThrow(/a stop is already in flight for person-lookup-worker-1/);
    await expect(first).resolves.toMatchObject({ command: "stop-worker", state: "acknowledged" });
    expect(harness.gracefulRequests).toHaveLength(1);
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "stopping",
      observedStop: [{ stage: "graceful-stop-requested", at: NOW }],
    });
  });

  it("marks the record stop-uncertain when the durable stop channel throws — a possibly-landed directive is never masked as running", async () => {
    const { harness, target } = await runningHarness();
    harness.nextGracefulStop = (): WorkerDurableStopReceipt => {
      throw new Error("directive store unavailable");
    };

    // A throw AFTER the durable directive landed is indistinguishable from
    // one before it: the record must not revert to plain "running".
    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/is UNCERTAIN: the durable stop channel threw \(directive store unavailable\)/);
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "stop-uncertain",
      pid: harness.children[0]?.pid,
      bornAt: NOW,
      leaseStartedAt: NOW,
      at: NOW,
      cause: "directive store unavailable",
    });

    // A retry does NOT double-write the durable directive…
    harness.nextGracefulStop = (): WorkerDurableStopReceipt =>
      stopReceipt(harness.clock.now().toISOString());
    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/stop-worker refused: .*durable stop directive is UNCERTAIN/);
    expect(harness.gracefulRequests).toHaveLength(1);
    // …plan coverage refuses to attest a healthy member over a possibly-landed
    // stop, and pause/resume refuse the same way.
    await expect(harness.supervisor.execute(planRequest(1, [target], [])))
      .rejects.toThrow(/plan-worker-count refused: .*durable stop directive is UNCERTAIN/);
    await expect(harness.supervisor.execute({ command: "pause-worker", member: target }))
      .rejects.toThrow(/pause-worker refused: .*durable stop directive is UNCERTAIN/);

    // The child's REAL exit resolves the uncertainty. "stopped" is claimed
    // only for an observed stop escalation, and this supervisor never
    // observed one — the exit is OS-reported crash evidence.
    harness.children[0]?.emitExit(0, null);
    harness.leases.delete(target.workerId);
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: harness.children[0]?.pid,
      outcome: "crashed",
      exitCode: 0,
      signal: null,
      at: NOW,
      reportedBy: "os",
      observedStop: [],
    });
  });

  it("keeps exited/os evidence when the child exits WHILE the durable stop channel is in flight and the channel then throws — the guard is conditional on state, not unconditional", async () => {
    const { harness, target } = await runningHarness();
    const child = harness.children[0];
    if (child === undefined) throw new Error("expected a spawned child");
    // The channel's throw happens AFTER the child's real exit already landed
    // (and transitioned the record to "exited" with OS evidence): the
    // stop-uncertain assignment must be conditional on the record still being
    // "running" at that point, or it would clobber real exit evidence.
    harness.nextGracefulStop = (): WorkerDurableStopReceipt => {
      child.emitExit(0, null);
      throw new Error("directive store unavailable after exit");
    };

    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/is UNCERTAIN: the durable stop channel threw \(directive store unavailable after exit\)/);

    // Never clobbered to stop-uncertain: the exit is real OS-reported evidence.
    expect(harness.supervisor.memberEvidence(target)).toEqual({
      state: "exited",
      pid: child.pid,
      outcome: "crashed",
      exitCode: 0,
      signal: null,
      at: NOW,
      reportedBy: "os",
      observedStop: [],
    });
  });

  it("refuses a second stop while an escalation is already in flight", async () => {
    const { harness, target } = await runningHarness();
    await harness.supervisor.execute(stopRequest(harness, target));

    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/a stop is already in flight/);
    expect(harness.gracefulRequests).toHaveLength(1);
  });

  it("refuses to stop a member it never spawned — external workers are not controlled", async () => {
    const harness = openHarness();

    await expect(harness.supervisor.execute(stopRequest(harness, member(2))))
      .rejects.toThrow(
        `stop-worker refused: this supervisor never spawned ${member(2).workerId}; `
        + "an externally started worker is never adopted or controlled",
      );
  });

  it("refuses to stop or pause a child still awaiting its lease birth — ownership is unproved", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const pendingSpawn = harness.supervisor.execute({ command: "spawn-worker", member: target });
    const settled = expect(pendingSpawn).rejects.toThrow(/exited/);

    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(new RegExp(
        `stop-worker refused: worker ${target.workerId} \\(pid \\d+\\) has not proved its lease birth`,
      ));
    await expect(harness.supervisor.execute({ command: "pause-worker", member: target }))
      .rejects.toThrow(new RegExp(
        `pause-worker refused: worker ${target.workerId} \\(pid \\d+\\) has not proved its lease birth`,
      ));
    expect(harness.gracefulRequests).toHaveLength(0);

    harness.children[0]?.emitExit(1, null);
    await settled;
  });

  it("refuses to stop a child that already exited, naming its evidence", async () => {
    const { harness, target } = await runningHarness();
    harness.children[0]?.emitExit(1, null);

    await expect(harness.supervisor.execute(stopRequest(harness, target)))
      .rejects.toThrow(/already exited \(crashed, code 1, signal null\)/);
  });

  it("routes a failed escalation signal to the fault sink instead of recording an unsent stage", async () => {
    const { harness, target } = await runningHarness();
    await harness.supervisor.execute(stopRequest(harness, target));
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
      .rejects.toThrow(
        `pause-worker refused: this supervisor never spawned ${member(1).workerId}; `
        + "an externally started worker is never adopted or controlled",
      );
  });

  it("refuses to pause a child whose stop escalation is in flight", async () => {
    const { harness, target } = await runningHarness();
    await harness.supervisor.execute(stopRequest(harness, target));

    await expect(harness.supervisor.execute({ command: "pause-worker", member: target }))
      .rejects.toThrow(/stop is already in flight/);
  });
});

/* ── plan-worker-count reconciliation (W1 exact-excess-coverage contract) ── */

function planRequest(
  desired: number,
  members: readonly WorkerPoolMember[],
  excess: readonly WorkerPoolMember[],
  at: string = NOW,
) {
  return {
    command: "plan-worker-count" as const,
    workflowId: WORKFLOW,
    desiredWorkers: PositiveIntSchema.parse(desired),
    members,
    excessMembers: excess,
    directive: stopDirective(at),
  };
}

describe("plan-worker-count", () => {
  it("covers the full roster in order: running desired, initiating stop for a running excess member, honest unmet for a member with no process", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", member: member(1) });
    await harness.supervisor.execute({ command: "spawn-worker", member: member(2) });
    harness.clock.advanceWall(2_000);

    const acknowledgement = await harness.supervisor.execute(
      planRequest(1, [member(1)], [member(2), member(3)], harness.clock.now().toISOString()),
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
    await harness.supervisor.execute(stopRequest(harness, member(2)));
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
    await harness.supervisor.execute(stopRequest(harness, member(1)));
    harness.children[0]?.emitExit(0, null);
    harness.leases.delete(member(1).workerId);

    const acknowledgement = await harness.supervisor.execute(planRequest(1, [member(1)], [member(2), member(3)]));

    expect(acknowledgement.command).toBe("plan-worker-count");
    if (acknowledgement.command !== "plan-worker-count") throw new Error("unreachable");
    expect(acknowledgement.members[0]).toEqual({ member: member(1), stage: "unmet", reason: "not-started" });
  });

  it("refuses a member listed as both desired and excess before emitting any fact or initiating any stop", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", member: member(1) });

    await expect(harness.supervisor.execute(planRequest(1, [member(1)], [member(1)])))
      .rejects.toThrow(new RegExp(`plan-worker-count refused: worker ${member(1).workerId} appears more than once`));
    expect(harness.gracefulRequests).toHaveLength(0);
    expect(harness.supervisor.memberEvidence(member(1))).toMatchObject({ state: "running" });
  });

  it("refuses a duplicated workerId within the desired roster", async () => {
    const harness = openHarness();

    await expect(harness.supervisor.execute(planRequest(2, [member(1), member(1)], [])))
      .rejects.toThrow(/appears more than once/);
  });

  it("pre-scans every refusal before initiating any stop — an unprovable roster leaves no dangling durable stop", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", member: member(1) });
    await harness.supervisor.execute({ command: "spawn-worker", member: member(2) });
    // member(3) is a spawn still awaiting birth: its lease never publishes.
    harness.nextSpawn = (): FakeWorkerChild => new FakeWorkerChild(5000);
    const pendingSpawn = harness.supervisor.execute({ command: "spawn-worker", member: member(3) });
    const settled = expect(pendingSpawn).rejects.toThrow(/exited/);

    // The excess roster stops member(2) BEFORE reaching the unprovable
    // member(3): without the pre-scan, member(2)'s durable stop would be
    // requested and then abandoned unacknowledged by the refusal.
    await expect(harness.supervisor.execute(planRequest(1, [member(1)], [member(2), member(3)])))
      .rejects.toThrow(/has not proved its lease birth/);

    expect(harness.gracefulRequests).toHaveLength(0);
    expect(harness.supervisor.memberEvidence(member(2))).toMatchObject({ state: "running" });

    harness.children[2]?.emitExit(1, null);
    await settled;
  });

  it("pre-scans a kill-undelivered excess member before initiating any stop for a RUNNING excess member ordered ahead of it", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", member: member(1) });
    // member(2) is the running excess member, ordered AHEAD of the
    // kill-undelivered member in the excess roster below.
    await harness.supervisor.execute({ command: "spawn-worker", member: member(2) });
    const target = member(3);
    const child = new FakeWorkerChild(9999);
    child.killResult = false;
    harness.nextSpawn = (): FakeWorkerChild => child;
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
      .rejects.toThrow(/process errored before proving its lease birth/);
    child.emitError(new Error("spawn EPERM"));
    await expectation;
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({ state: "kill-undelivered" });

    // Without the whole-roster pre-scan, member(2)'s durable graceful stop
    // would be requested (it is processed first) before the refusal on
    // member(3) is ever reached.
    await expect(harness.supervisor.execute(planRequest(1, [member(1)], [member(2), target])))
      .rejects.toThrow(/may still be alive/);

    expect(harness.gracefulRequests).toHaveLength(0);
    expect(harness.supervisor.memberEvidence(member(2))).toMatchObject({ state: "running" });

    child.emitExit(null, "SIGKILL");
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
    })).resolves.toEqual({ state: "accepted", directiveLeaseVersions: DIRECTIVE_WRITE_VERSIONS });

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

/* ── close(): the W3 teardown seam ───────────────────────────────────────── */

describe("close", () => {
  it("cancels every armed escalation timer and returns the still-live children's evidence", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", member: member(1) });
    await harness.supervisor.execute({ command: "spawn-worker", member: member(2) });
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

  it("racing an in-flight stop: reports the stop-in-flight, and the directive landing after teardown arms NO escalation", async () => {
    const harness = openHarness();
    const target = member(1);
    await harness.supervisor.execute({ command: "spawn-worker", member: target });
    let land: ((ack: WorkerDurableStopReceipt) => void) | undefined;
    harness.nextGracefulStop = (): Promise<WorkerDurableStopReceipt> =>
      new Promise((resolve) => {
        land = resolve;
      });
    const pendingStop = harness.supervisor.execute(stopRequest(harness, target));
    const settled = expect(pendingStop).rejects.toThrow(/interrupted by close\(\): the durable stop directive landed/);

    // close() runs while the durable stop request is still in flight — its
    // returned evidence must not hide the pending stop behind plain running.
    const live = harness.supervisor.close();
    expect(live).toEqual([{
      state: "running",
      pid: harness.children[0]?.pid,
      bornAt: NOW,
      leaseStartedAt: NOW,
      stopInFlight: true,
    }]);

    // The durable directive lands AFTER teardown: no fresh SIGTERM/SIGKILL
    // timers may be armed, the landed-directive fact goes to the fault sink,
    // and the stage itself is still recorded as evidence.
    if (land === undefined) throw new Error("expected the durable stop request to be in flight");
    land(stopReceipt(NOW));
    await settled;

    expect(harness.scheduler.pending()).toHaveLength(0);
    expect(harness.faults).toHaveLength(1);
    expect(harness.faults[0]?.message).toMatch(
      /durable stop directive landed .* the supervisor closed while the request was in flight; no escalation will be armed/,
    );
    expect(harness.supervisor.memberEvidence(target)).toMatchObject({
      state: "stopping",
      observedStop: [{ stage: "graceful-stop-requested", at: NOW }],
    });
  });

  it("returns no evidence when every child already exited", async () => {
    const harness = openHarness();
    await harness.supervisor.execute({ command: "spawn-worker", member: member(1) });
    harness.children[0]?.emitExit(0, null);

    expect(harness.supervisor.close()).toEqual([]);
  });

  it("includes a kill-undelivered child's evidence in close() — a possibly-live child is never hidden from teardown", async () => {
    const harness = openHarness({ publishLeaseOnSpawn: false });
    const target = member(1);
    const child = new FakeWorkerChild(4321);
    child.killResult = false;
    harness.nextSpawn = (): FakeWorkerChild => child;
    const expectation = expect(harness.supervisor.execute({ command: "spawn-worker", member: target }))
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
    await harness.supervisor.execute({ command: "spawn-worker", member: member(1) });
    harness.supervisor.close();

    await expect(harness.supervisor.execute({ command: "spawn-worker", member: member(2) }))
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
      .rejects.toThrow(/refresh-browser .* no cross-process channel into a live worker's browser sessions/);
    await expect(harness.supervisor.execute({ command: "reopen-browser", member: target, browserSessionId }))
      .rejects.toThrow(/reopen-browser .* no cross-process channel into a live worker's browser sessions/);
  });
});
