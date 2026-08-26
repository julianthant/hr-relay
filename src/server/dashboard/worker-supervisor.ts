/**
 * The dashboard-owned child-process worker supervisor (ref execution-and-sessions
 * §11, D271) — the REAL process effect behind the W1 pool contract's awaitable
 * `WorkerPoolProcessSupervisor.execute` seam.
 *
 * What it owns:
 * - launching the EXACT worker CLI as argv arrays (an absolute command path, a
 *   fixed prefix, and the member-derived `worker <workflow> --pool-index <n>`
 *   tail) — never a shell string, never a PATH lookup;
 * - proving child BIRTH before anything is acknowledged: the durable worker
 *   lease (authority — §11.3's only coordination channel) must carry the
 *   spawned child's OS pid. "spawn returned" is not birth; a child that never
 *   proves its lease is killed and the command rejects;
 * - durable supervisor ownership: only a child THIS supervisor spawned and
 *   proved may be stopped, paused, resumed, or covered by a plan as
 *   `supervised`; anything else refuses BY NAME (no adoption — D271);
 * - stop escalation exactly as D271 ratified: the graceful between-items stop
 *   first (the injected durable-directive channel), SIGTERM after the policy's
 *   graceful bound, SIGKILL after the SIGTERM bound — each stage recorded with
 *   its instant WHEN IT HAPPENS, never promised in advance;
 * - crash evidence with NO auto-restart: a child that exits outside a stop is
 *   recorded `crashed` with its exit code/signal/instant and stays down until
 *   an explicit new `spawn-worker` replaces it.
 *
 * What it does NOT own: writing authority (the kernel writes leases and
 * directives; the graceful-stop channel is injected so composition can route
 * it through the kernel), the browser session arms (`refresh-browser` /
 * `reopen-browser` refuse by name until a cross-process browser channel
 * exists), and its own wiring into `compose.ts` (a separate unit).
 */
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { IsoInstantSchema } from "../../domain/ids.js";
import type { WorkerId } from "../../domain/ids.js";
import type {
  MonotonicDeadlineHandle,
  MonotonicDeadlineScheduler,
} from "../../core/deadline-scheduler.js";
import {
  WorkerPoolMemberSchema,
  WorkerSupervisorAcknowledgementSchema,
  type WorkerPoolMember,
  type WorkerPoolProcessSupervisor,
  type WorkerSupervisorAcknowledgement,
  type WorkerSupervisorRequest,
} from "../../core/worker-loop.js";

/* ── the process edges (injected; composition binds the real ones) ───────── */

/** The exact spawn request handed to the process boundary — argv, never a shell string. */
export interface WorkerProcessSpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly member: WorkerPoolMember;
}

/**
 * The structural subset of a spawned OS child this supervisor consumes.
 * `node:child_process.ChildProcess` satisfies it through a thin adapter;
 * tests satisfy it with deterministic fakes.
 */
export interface SpawnedWorkerHandle {
  readonly pid: number | undefined;
  kill(signal: "SIGTERM" | "SIGKILL"): boolean;
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  onError(listener: (error: Error) => void): void;
}

export type WorkerProcessSpawner = (request: WorkerProcessSpawnRequest) => SpawnedWorkerHandle;

/** The durable worker lease's birth-relevant slice: a LIVE lease's owner pid and start instant. */
export const WorkerLeaseBirthFactSchema = z.strictObject({
  processId: z.number().int().positive(),
  startedAt: IsoInstantSchema,
});
export type WorkerLeaseBirthFact = z.infer<typeof WorkerLeaseBirthFactSchema>;

export interface WorkerLeaseProbe {
  /** The LIVE lease under this worker id, or undefined when none is live. */
  observe(workerId: WorkerId): WorkerLeaseBirthFact | undefined;
}

/**
 * The durable graceful-stop request (the worker lease's `stop` directive,
 * observed by the worker between items). Injected because directives are
 * authority only commands write; the channel resolves with the DURABLE
 * `requestedAt` instant, which is what the observed graceful stage records.
 */
export interface WorkerGracefulStopChannel {
  request(member: WorkerPoolMember): Promise<Readonly<{ requestedAt: string }>> | Readonly<{ requestedAt: string }>;
}

export interface WorkerCliLaunchSpec {
  /** Absolute path to the interpreter/binary; a relative command is a PATH ambiguity and refuses. */
  readonly command: string;
  /** The fixed argv prefix up to (not including) the `worker` subcommand. */
  readonly prefixArgs: readonly string[];
  readonly cwd: string;
}

export interface DashboardWorkerSupervisorDependencies {
  readonly launch: WorkerCliLaunchSpec;
  readonly spawn: WorkerProcessSpawner;
  readonly leases: WorkerLeaseProbe;
  readonly gracefulStop: WorkerGracefulStopChannel;
  readonly clock: Clock;
  readonly scheduler: MonotonicDeadlineScheduler;
  /** Birth-proof polling: re-probe the lease every `pollMs`, give up at `timeoutMs`. */
  readonly birth: Readonly<{ pollMs: number; timeoutMs: number }>;
  /**
   * The structured sink for a failure observed OUTSIDE a command (an
   * escalation timer firing after the acknowledgement returned). Required:
   * an unobserved fault has nowhere honest to go, and swallowing it is the
   * exact silent failure this tree bans.
   */
  readonly onFault: (error: Error) => void;
}

/* ── the argv contract ───────────────────────────────────────────────────── */

export const WORKER_CLI_SUBCOMMAND = "worker";
export const WORKER_CLI_POOL_INDEX_FLAG = "--pool-index";

/** The member-derived argv tail: `worker <workflow-id> --pool-index <n>`. */
export function workerCliArgv(member: WorkerPoolMember): readonly string[] {
  return Object.freeze([
    WORKER_CLI_SUBCOMMAND,
    member.workflowId,
    WORKER_CLI_POOL_INDEX_FLAG,
    String(member.poolIndex),
  ]);
}

/* ── evidence ────────────────────────────────────────────────────────────── */

/**
 * What this supervisor can truthfully say about a member it spawned. Absent
 * (undefined) means "never spawned by this supervisor" — deliberately
 * indistinguishable from an externally started worker, because adopting or
 * describing a process it does not own is exactly what D271 forbids.
 */
interface MemberRecord {
  readonly member: WorkerPoolMember;
  state: "awaiting-birth" | "running" | "stopping" | "exited";
  readonly child: SpawnedWorkerHandle;
  pid: number | undefined;
  bornAt?: string;
  leaseStartedAt?: string;
  observedStop: { stage: "graceful-stop-requested" | "sigterm-sent" | "sigkill-sent"; at: string }[];
  escalationTimer?: MonotonicDeadlineHandle;
  exit?: {
    exitCode: number | null;
    signal: string | null;
    at: string;
    outcome: "stopped" | "crashed";
  };
}

export const WorkerChildEvidenceSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("awaiting-birth"),
    pid: z.number().int().positive().optional(),
  }),
  z.strictObject({
    state: z.literal("running"),
    pid: z.number().int().positive(),
    bornAt: IsoInstantSchema,
    leaseStartedAt: IsoInstantSchema,
  }),
  z.strictObject({
    state: z.literal("stopping"),
    pid: z.number().int().positive(),
    bornAt: IsoInstantSchema,
    observedStop: z.array(z.strictObject({
      stage: z.enum(["graceful-stop-requested", "sigterm-sent", "sigkill-sent"]),
      at: IsoInstantSchema,
    })).min(1),
  }),
  z.strictObject({
    state: z.literal("exited"),
    pid: z.number().int().positive().optional(),
    outcome: z.enum(["stopped", "crashed"]),
    exitCode: z.number().int().nullable(),
    signal: z.string().min(1).nullable(),
    at: IsoInstantSchema,
    observedStop: z.array(z.strictObject({
      stage: z.enum(["graceful-stop-requested", "sigterm-sent", "sigkill-sent"]),
      at: IsoInstantSchema,
    })),
  }),
]);
export type WorkerChildEvidence = z.infer<typeof WorkerChildEvidenceSchema>;

export interface DashboardWorkerProcessSupervisor extends WorkerPoolProcessSupervisor {
  execute(request: WorkerSupervisorRequest): Promise<WorkerSupervisorAcknowledgement>;
  /** Evidence about a member THIS supervisor spawned; undefined = never spawned here. */
  memberEvidence(member: WorkerPoolMember): WorkerChildEvidence | undefined;
}

/* ── the supervisor ──────────────────────────────────────────────────────── */

export function createDashboardWorkerProcessSupervisor(
  deps: DashboardWorkerSupervisorDependencies,
): DashboardWorkerProcessSupervisor {
  if (!isAbsolute(deps.launch.command)) {
    throw new Error(
      `worker supervisor launch command ${JSON.stringify(deps.launch.command)} is not an absolute path; `
      + "a PATH-resolved worker CLI is an ambiguity this supervisor refuses",
    );
  }
  const records = new Map<string, MemberRecord>();
  const instant = (): string => deps.clock.now().toISOString();

  const onChildExit = (record: MemberRecord, exitCode: number | null, signal: string | null): void => {
    record.escalationTimer?.cancel();
    record.escalationTimer = undefined;
    const outcome: "stopped" | "crashed" = record.state === "stopping" ? "stopped" : "crashed";
    record.exit = { exitCode, signal, at: instant(), outcome };
    record.state = "exited";
  };

  const spawnWorker = async (member: WorkerPoolMember): Promise<WorkerSupervisorAcknowledgement> => {
    const existing = records.get(member.workerId);
    if (existing !== undefined && existing.state !== "exited") {
      throw new Error(
        `spawn-worker refused: this supervisor already owns a ${existing.state} child for `
        + `${member.workerId}; a second process may not answer to the same worker id`,
      );
    }
    const preexistingLease = deps.leases.observe(member.workerId);
    if (preexistingLease !== undefined) {
      throw new Error(
        `spawn-worker refused: worker ${member.workerId} already holds a live lease under pid `
        + `${String(preexistingLease.processId)} started ${preexistingLease.startedAt}, and this supervisor `
        + "did not spawn it; an externally started worker is never adopted or controlled",
      );
    }
    const child = deps.spawn(Object.freeze({
      command: deps.launch.command,
      args: Object.freeze([...deps.launch.prefixArgs, ...workerCliArgv(member)]),
      cwd: deps.launch.cwd,
      member,
    }));
    const record: MemberRecord = {
      member,
      state: "awaiting-birth",
      child,
      pid: child.pid,
      observedStop: [],
    };
    records.set(member.workerId, record);

    const birth = await new Promise<WorkerLeaseBirthFact>((resolve, reject) => {
      let settled = false;
      let pollHandle: MonotonicDeadlineHandle | undefined;
      const settle = (outcome: () => void): void => {
        if (settled) return;
        settled = true;
        pollHandle?.cancel();
        outcome();
      };
      child.onExit((exitCode, signal) => {
        onChildExit(record, exitCode, signal);
        settle(() => {
          reject(new Error(
            `spawn-worker failed: worker ${member.workerId} (pid ${String(record.pid)}) exited with `
            + `code ${String(exitCode)} signal ${String(signal)} before proving its lease birth`,
          ));
        });
      });
      child.onError((error) => {
        settle(() => {
          reject(new Error(
            `spawn-worker failed: worker ${member.workerId} process errored before proving its lease `
            + `birth: ${error.message}`,
          ));
        });
      });
      const deadline = deps.clock.monotonicMs() + deps.birth.timeoutMs;
      const poll = (): void => {
        if (settled) return;
        const fact = deps.leases.observe(member.workerId);
        if (fact !== undefined) {
          if (child.pid !== undefined && fact.processId === child.pid) {
            settle(() => {
              resolve(WorkerLeaseBirthFactSchema.parse(fact));
            });
            return;
          }
          child.kill("SIGKILL");
          settle(() => {
            reject(new Error(
              `spawn-worker failed: worker ${member.workerId} lease is owned by pid `
              + `${String(fact.processId)}, not the spawned child pid ${String(child.pid)}; the identity is `
              + "externally held and the unproved child was killed",
            ));
          });
          return;
        }
        if (deps.clock.monotonicMs() >= deadline) {
          child.kill("SIGKILL");
          settle(() => {
            reject(new Error(
              `spawn-worker failed: worker ${member.workerId} (pid ${String(child.pid)}) proved no lease `
              + `birth within ${String(deps.birth.timeoutMs)}ms; the unproved child was killed`,
            ));
          });
          return;
        }
        pollHandle = deps.scheduler.schedule(deps.clock.monotonicMs() + deps.birth.pollMs, poll);
      };
      poll();
    });

    record.state = "running";
    record.bornAt = instant();
    record.leaseStartedAt = birth.startedAt;
    return WorkerSupervisorAcknowledgementSchema.parse({
      command: "spawn-worker",
      state: "acknowledged",
      member,
      ownership: "supervised",
      stage: "started",
    });
  };

  return Object.freeze({
    async execute(request: WorkerSupervisorRequest): Promise<WorkerSupervisorAcknowledgement> {
      switch (request.command) {
        case "spawn-worker":
          return spawnWorker(WorkerPoolMemberSchema.parse(request.member));
        default:
          throw new Error(`worker supervisor cannot execute ${request.command} yet`);
      }
    },
    memberEvidence(member: WorkerPoolMember): WorkerChildEvidence | undefined {
      const record = records.get(member.workerId);
      if (record === undefined) return undefined;
      switch (record.state) {
        case "awaiting-birth":
          return WorkerChildEvidenceSchema.parse({
            state: "awaiting-birth",
            ...(record.pid === undefined ? {} : { pid: record.pid }),
          });
        case "running":
          return WorkerChildEvidenceSchema.parse({
            state: "running",
            pid: record.pid,
            bornAt: record.bornAt,
            leaseStartedAt: record.leaseStartedAt,
          });
        case "stopping":
          return WorkerChildEvidenceSchema.parse({
            state: "stopping",
            pid: record.pid,
            bornAt: record.bornAt,
            observedStop: record.observedStop,
          });
        case "exited": {
          if (record.exit === undefined) {
            throw new Error(
              `worker ${record.member.workerId} is recorded exited without exit evidence; `
              + "the supervisor registry is corrupt",
            );
          }
          return WorkerChildEvidenceSchema.parse({
            state: "exited",
            ...(record.pid === undefined ? {} : { pid: record.pid }),
            outcome: record.exit.outcome,
            exitCode: record.exit.exitCode,
            signal: record.exit.signal,
            at: record.exit.at,
            observedStop: record.observedStop,
          });
        }
      }
    },
  });
}
