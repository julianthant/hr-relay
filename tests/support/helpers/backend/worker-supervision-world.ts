import { ManualScheduler } from "../phase1f-executor-harness.js";
import { WORKER_GRACEFUL_STOP_TIMEOUT_MS, WORKER_SIGTERM_TIMEOUT_MS, WorkerPoolMemberSchema, WorkerStopDirectiveContextSchema, WorkerStopEscalationPolicySchema, type WorkerPoolMember, type WorkerStopDirectiveContext, type WorkerStopEscalationPolicy } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { createDashboardWorkerProcessSupervisor, type DashboardWorkerProcessSupervisor, type SpawnedWorkerHandle, type WorkerDurableStopReceipt, type WorkerLeaseBirthFact, type WorkerProcessSpawnRequest } from "../../../../src/backend/runtime/workers/worker-supervisor.js";
import { type WorkerId, PositiveIntSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { type TestClock, manualClock } from "../../../../src/rules/time/clock.js";

type ExitListener = (code: number | null, signal: string | null) => void;

type ErrorListener = (error: Error) => void;

export interface Harness {
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

export class FakeWorkerChild implements SpawnedWorkerHandle {
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

export function createWorkerSupervisionTestWorld() {
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

  function stopDirective(at: string): WorkerStopDirectiveContext {
    return WorkerStopDirectiveContextSchema.parse({ requestedAt: at, requestedBy: "local-operator" });
  }

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
  return { planRequest, WORKFLOW, NOW, member, DIRECTIVE_WRITE_VERSIONS, openHarness, stopDirective, stopRequest, stopReceipt, stopPolicy };
}
