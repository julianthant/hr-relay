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
import { PositiveIntSchema, WorkflowIdSchema } from "../../../src/domain/ids.js";
import type { WorkerId } from "../../../src/domain/ids.js";
import {
  poolWorkerId,
  WorkerPoolMemberSchema,
  type WorkerPoolMember,
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
      leases: { observe: (workerId) => leases.get(workerId) },
      gracefulStop: {
        request: (target) => {
          gracefulRequests.push(target);
          return { requestedAt: clock.now().toISOString() };
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
});
