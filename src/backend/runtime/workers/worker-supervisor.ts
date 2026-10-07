import { WorkerControlRefusal } from "../../../models/run/worker-control.js";
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
import type { Clock } from "../../../rules/time/clock.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import type { WorkerId } from "../../../rules/identity/ids.js";
import type {
  MonotonicDeadlineHandle,
  MonotonicDeadlineScheduler,
} from "../scheduling/deadline-scheduler.js";
import {
  WORKER_GRACEFUL_STOP_TIMEOUT_MS,
  WORKER_SIGTERM_TIMEOUT_MS,
  WorkerDirectiveLeaseVersionsSchema,
  WorkerPoolMemberReconciliationFactSchema,
  WorkerPoolMemberSchema,
  WorkerStopDirectiveContextSchema,
  WorkerStopEscalationPolicySchema,
  WorkerSupervisorAcknowledgementSchema,
  type WorkerDirectiveLeaseVersions,
  type WorkerPoolMember,
  type WorkerPoolPlanRequest,
  type WorkerPoolProcessSupervisor,
  type WorkerStopDirectiveContext,
  type WorkerStopEscalationPolicy,
  type WorkerSupervisorAcknowledgement,
  type WorkerSupervisorRequest,
} from "./worker-loop.js";

/* ── the process edges (injected; composition binds the real ones) ───────── */

/** The exact spawn request handed to the process boundary — argv, never a shell string. */
export interface WorkerProcessSpawnRequest {
  readonly command: string;
  readonly environment: NodeJS.ProcessEnv;
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
export type WorkerLeaseBirthFact = z.input<typeof WorkerLeaseBirthFactSchema>;

export interface WorkerLeaseProbe {
  /** The LIVE lease under this worker id, or undefined when none is live. */
  observe(workerId: WorkerId): WorkerLeaseBirthFact | undefined;
}

/**
 * The durable graceful-stop request (the worker lease's `stop` directive,
 * observed by the worker between items). Injected because directives are
 * authority only commands write; composition routes it through the kernel's
 * directive write. The channel MUST write the directive at exactly
 * `directive.requestedAt` — the kernel command's own `now` — and resolve with
 * the DURABLE instant, which is what the observed graceful stage records; the
 * supervisor refuses a durable instant that differs from the command's now,
 * because an observed stage that postdates the command's `now` is a claim the
 * kernel's `requireObservedNotAfterNow` bound rightly rejects. The receipt
 * also carries the directive WRITE's own lease versions (before → after), so
 * command authority audits the write's change rather than a later lease read.
 */
export interface WorkerDurableStopReceipt {
  readonly requestedAt: string;
  readonly leaseVersions: z.input<typeof WorkerDirectiveLeaseVersionsSchema>;
}

export interface WorkerGracefulStopChannel {
  request(
    member: WorkerPoolMember,
    directive: WorkerStopDirectiveContext,
  ): Promise<WorkerDurableStopReceipt> | WorkerDurableStopReceipt;
}

export interface WorkerCliLaunchSpec {
  /** Absolute path to the interpreter/binary; a relative command is a PATH ambiguity and refuses. */
  readonly command: string;
  readonly environment: NodeJS.ProcessEnv;
  /** The fixed argv prefix up to (not including) the `worker` subcommand. */
  readonly prefixArgs: readonly string[];
  readonly cwd: string;
}

export interface DashboardWorkerSupervisorDependencies {
  readonly launch: WorkerCliLaunchSpec;
  readonly admission?: (request: WorkerSupervisorRequest) => void;
  readonly prepareAdmission?: (request: WorkerSupervisorRequest) => Promise<void>;
  readonly browserControl?: Readonly<{ request(commandId: string): Promise<string> }>;
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
/** Bound the OS exit event observation after an accepted SIGKILL during shutdown. */
export const WORKER_EXIT_OBSERVATION_TIMEOUT_MS = 5_000;

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
  state: "awaiting-birth" | "running" | "stopping" | "stop-uncertain" | "kill-undelivered" | "exited";
  readonly child: SpawnedWorkerHandle;
  pid: number | undefined;
  bornAt?: string;
  leaseStartedAt?: string;
  /**
   * Set when a pre-birth spawn-abort SIGKILL could NOT be delivered: the
   * child may still be alive, so no exit is synthesized and the slot stays
   * blocked until the child's REAL exit event is observed.
   */
  killUndelivered?: { at: string; cause: string };
  /**
   * Set when the durable stop channel THREW mid-request: whether the stop
   * directive landed is unknown, so the record refuses plans, re-stops,
   * pause and resume until the child's real exit is observed.
   */
  stopUncertain?: { at: string; cause: string };
  /**
   * Set SYNCHRONOUSLY when a stop begins, before the durable graceful-stop
   * request is awaited: `state` only becomes "stopping" after that await, so
   * without this flag two concurrent stops both pass the state guard and
   * request the durable directive twice.
   */
  stopInFlight: boolean;
  observedStop: { stage: "graceful-stop-requested" | "sigterm-sent" | "sigkill-sent"; at: string }[];
  escalationTimer?: MonotonicDeadlineHandle;
  drainExitTimer?: MonotonicDeadlineHandle;
  exitObserved: Promise<void>;
  resolveExitObserved: () => void;
  drainFailure?: { promise: Promise<void>; reject: (error: Error) => void };
  exit?: {
    exitCode: number | null;
    signal: string | null;
    at: string;
    outcome: "stopped" | "crashed";
    /**
     * "os" = a real exit event from the process boundary; "supervisor" =
     * synthesized for a child that provably cannot run (it never got a pid,
     * or its spawn-abort SIGKILL was delivered) — a launch failure must never
     * read as a normal worker crash.
     */
    reportedBy: "os" | "supervisor";
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
    /**
     * Present only while a stop's durable directive request is in flight —
     * close()'s returned evidence must never hide a pending stop behind
     * plain "running".
     */
    stopInFlight: z.literal(true).optional(),
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
    state: z.literal("stop-uncertain"),
    pid: z.number().int().positive(),
    bornAt: IsoInstantSchema,
    leaseStartedAt: IsoInstantSchema,
    at: IsoInstantSchema,
    cause: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("kill-undelivered"),
    pid: z.number().int().positive(),
    at: IsoInstantSchema,
    cause: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("exited"),
    pid: z.number().int().positive().optional(),
    outcome: z.enum(["stopped", "crashed"]),
    exitCode: z.number().int().nullable(),
    signal: z.string().min(1).nullable(),
    at: IsoInstantSchema,
    /** "os" = a real exit event; "supervisor" = synthesized launch-failure evidence. */
    reportedBy: z.enum(["os", "supervisor"]),
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
  ownsWorker(workerId: string, processId: number, startedAt: string): boolean;
  /** Durably request D271 stops for owned live children and resolve only when their OS exits are observed. */
  drainOwnedChildren(directive: WorkerStopDirectiveContext): Promise<void>;
  /**
   * The teardown seam (W3 composition): cancels every armed escalation timer,
   * refuses all further commands, and returns the evidence of every child
   * still live at close — the caller decides what to do with them; this
   * supervisor never pretends they stopped. Idempotent. A spawn still
   * awaiting birth keeps its birth poll (cancelling it would strand the
   * pending command) and is reported here as awaiting-birth; a running child
   * whose stop's durable directive request is still in flight is reported
   * with `stopInFlight: true` — and if that directive lands after close, no
   * escalation is armed (the landed fact goes to onFault and the stop
   * command rejects).
   */
  close(): readonly WorkerChildEvidence[];
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
  let closed = false;
  let draining: Promise<void> | undefined;

  const onChildExit = (record: MemberRecord, exitCode: number | null, signal: string | null): void => {
    record.escalationTimer?.cancel();
    record.escalationTimer = undefined;
    record.drainExitTimer?.cancel();
    record.drainExitTimer = undefined;
    const outcome: "stopped" | "crashed" = record.state === "stopping" ? "stopped" : "crashed";
    record.exit = { exitCode, signal, at: instant(), outcome, reportedBy: "os" };
    record.state = "exited";
    record.resolveExitObserved();
  };

  /** The channel-throw cause of a stop-uncertain record; a missing one is registry corruption, never defaulted. */
  const stopUncertainCause = (record: MemberRecord): string => {
    if (record.stopUncertain === undefined) {
      throw new Error(
        `worker ${record.member.workerId} is recorded stop-uncertain without its channel-throw evidence; `
        + "the supervisor registry is corrupt",
      );
    }
    return record.stopUncertain.cause;
  };

  const spawnWorker = async (member: WorkerPoolMember): Promise<WorkerSupervisorAcknowledgement> => {
    const existing = records.get(member.workerId);
    if (existing !== undefined && existing.state !== "exited") {
      if (existing.state === "kill-undelivered") {
        throw new Error(
          `spawn-worker refused: worker ${member.workerId}'s previous child (pid ${String(existing.pid)}) `
          + "may still be alive — its spawn-abort SIGKILL was not delivered and no exit has been observed; "
          + "a replacement cannot run beside a possibly-live orphan under the same worker id",
        );
      }
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
      environment: deps.launch.environment,
      command: deps.launch.command,
      args: Object.freeze([...deps.launch.prefixArgs, ...workerCliArgv(member)]),
      cwd: deps.launch.cwd,
      member,
    }));
    let resolveExitObserved!: () => void;
    const exitObserved = new Promise<void>((resolve) => { resolveExitObserved = resolve; });
    const record: MemberRecord = {
      member,
      state: "awaiting-birth",
      child,
      pid: child.pid,
      observedStop: [],
      stopInFlight: false,
      exitObserved,
      resolveExitObserved,
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
      /**
       * Abort an unproved spawn: SIGKILL the child (when the OS gave it a
       * pid) and say honestly whether the kill was delivered. An undelivered
       * abort goes to the fault sink — the child may still be alive, and the
       * rejection must never claim a kill that did not happen.
       * `childCannotRun` is true only when the child provably cannot be
       * running (it never got a pid, or the SIGKILL was delivered) — the only
       * cases where synthesizing exit evidence is honest.
       */
      const killUnprovenChild = (): Readonly<{ childCannotRun: boolean; description: string }> => {
        if (record.pid === undefined) {
          return { childCannotRun: true, description: "the child has no pid to kill" };
        }
        if (child.kill("SIGKILL")) {
          return { childCannotRun: true, description: "the unproved child was killed" };
        }
        deps.onFault(new Error(
          `worker ${member.workerId} (pid ${String(record.pid)}) spawn-abort SIGKILL was not delivered; `
          + "the unproved child may still be alive",
        ));
        return {
          childCannotRun: false,
          description: "the unproved child was NOT killed (SIGKILL was not delivered)",
        };
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
        if (settled) {
          // The birth already settled: this is a live child's process error
          // (e.g. a failed signal delivery). It has no command to reject, so
          // the fault sink is the only honest place for it.
          deps.onFault(new Error(
            `worker ${member.workerId} (pid ${String(record.pid)}) process errored after its lease `
            + `birth settled: ${error.message}`,
          ));
          return;
        }
        // A pre-birth process error (spawn ENOENT is the common case) leaves
        // no exit event to transition the record: without evidence here the
        // record would stay awaiting-birth forever and brick the worker slot.
        const killed = killUnprovenChild();
        if (record.state === "awaiting-birth") {
          if (killed.childCannotRun) {
            // Synthesized exit evidence, marked reportedBy: "supervisor" —
            // honest ONLY because the child provably cannot be running.
            record.exit = {
              exitCode: null,
              signal: null,
              at: instant(),
              outcome: "crashed",
              reportedBy: "supervisor",
            };
            record.state = "exited";
            record.resolveExitObserved();
          } else {
            // The abort SIGKILL was NOT delivered: the child may still be
            // alive. Recording "exited" would free the slot and let a
            // replacement run beside a live orphan under the same worker id —
            // instead the record enters kill-undelivered, which blocks
            // respawn, stop, pause, resume and plan coverage until the
            // child's REAL exit event is observed.
            record.state = "kill-undelivered";
            record.killUndelivered = { at: instant(), cause: error.message };
          }
        }
        settle(() => {
          reject(new Error(
            `spawn-worker failed: worker ${member.workerId} process errored before proving its lease `
            + `birth: ${error.message}; ${killed.description}`,
          ));
        });
      });
      const deadline = deps.clock.monotonicMs() + deps.birth.timeoutMs;
      const poll = (): void => {
        if (settled) return;
        try {
          const fact = deps.leases.observe(member.workerId);
          if (fact !== undefined) {
            if (child.pid !== undefined && fact.processId === child.pid) {
              const proved = WorkerLeaseBirthFactSchema.parse(fact);
              settle(() => {
                resolve(proved);
              });
              return;
            }
            const killed = killUnprovenChild();
            settle(() => {
              reject(new Error(
                `spawn-worker failed: worker ${member.workerId} lease is owned by pid `
                + `${String(fact.processId)}, not the spawned child pid ${String(child.pid)}; the identity is `
                + `externally held and ${killed.description}`,
              ));
            });
            return;
          }
          if (deps.clock.monotonicMs() >= deadline) {
            const killed = killUnprovenChild();
            settle(() => {
              reject(new Error(
                `spawn-worker failed: worker ${member.workerId} (pid ${String(child.pid)}) proved no lease `
                + `birth within ${String(deps.birth.timeoutMs)}ms; ${killed.description}`,
              ));
            });
            return;
          }
          pollHandle = deps.scheduler.schedule(deps.clock.monotonicMs() + deps.birth.pollMs, poll);
        } catch (error) {
          // A birth probe that throws (the lease store unreadable, a corrupt
          // birth fact) on a scheduler tick would otherwise escape into the
          // scheduler, never re-schedule, and leave the spawn pending forever
          // with the child alive and unsupervised.
          const probe = error instanceof Error ? error : new Error(String(error));
          const killed = killUnprovenChild();
          settle(() => {
            reject(new Error(
              `spawn-worker failed: worker ${member.workerId} (pid ${String(record.pid)}) birth probe `
              + `threw before proving its lease birth: ${probe.message}; ${killed.description}`,
            ));
          });
        }
      };
      poll();
    });

    if (record.state !== "awaiting-birth") {
      // The exit event landed between birth resolution and this continuation;
      // promoting to running would erase the exit evidence and claim a child
      // that is already dead.
      const exit = record.exit;
      throw new Error(
        `spawn-worker failed: worker ${member.workerId} (pid ${String(record.pid)}) exited `
        + `(code ${String(exit?.exitCode)}, signal ${String(exit?.signal)}) after proving its lease birth `
        + "but before it could be acknowledged",
      );
    }
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

  /**
   * A member this supervisor durably owns as a LIVE child. Anything else —
   * never spawned (possibly externally running: indistinguishable on purpose),
   * still unproved, or already exited — refuses BY NAME with its evidence.
   */
  const requireLiveOwnedChild = (
    command: WorkerSupervisorRequest["command"],
    member: WorkerPoolMember,
  ): MemberRecord => {
    const record = records.get(member.workerId);
    if (record === undefined) {
      throw new WorkerControlRefusal(
        `${command} refused: this supervisor never spawned ${member.workerId}; an externally started `
        + "worker is never adopted or controlled",
      );
    }
    if (record.state === "awaiting-birth") {
      throw new WorkerControlRefusal(
        `${command} refused: worker ${member.workerId} (pid ${String(record.pid)}) has not proved its `
        + "lease birth yet",
      );
    }
    if (record.state === "kill-undelivered") {
      throw new WorkerControlRefusal(
        `${command} refused: worker ${member.workerId} (pid ${String(record.pid)}) may still be alive — `
        + "its spawn-abort SIGKILL was not delivered and no exit has been observed; no command is honest "
        + "until its real exit lands",
      );
    }
    if (record.state === "stop-uncertain") {
      throw new WorkerControlRefusal(
        `${command} refused: worker ${member.workerId}'s durable stop directive is UNCERTAIN — the stop `
        + `channel threw mid-request (${stopUncertainCause(record)}); the directive may `
        + "have landed, so nothing is re-initiated until the child's exit is observed",
      );
    }
    if (record.state === "exited") {
      const exit = record.exit;
      throw new WorkerControlRefusal(
        `${command} refused: worker ${member.workerId} already exited `
        + `(${exit?.outcome ?? "unknown"}, code ${String(exit?.exitCode)}, signal ${String(exit?.signal)}) `
        + `at ${exit?.at ?? "unknown"}; there is no live child to control`,
      );
    }
    const current = deps.leases.observe(member.workerId);
    if (current === undefined || current.processId !== record.pid || current.startedAt !== record.leaseStartedAt) throw new WorkerControlRefusal("worker-control-owned-lifetime-changed");
    return record;
  };

  /**
   * Arm the next escalation deadline. Each stage is recorded only AFTER its
   * signal was actually delivered; an undeliverable signal goes to the fault
   * sink and records nothing — never a stage that did not happen.
   */
  const armEscalation = (
    record: MemberRecord,
    signal: "SIGTERM" | "SIGKILL",
    stage: "sigterm-sent" | "sigkill-sent",
    delayMs: number,
    next?: () => void,
  ): void => {
    record.escalationTimer = deps.scheduler.schedule(deps.clock.monotonicMs() + delayMs, () => {
      record.escalationTimer = undefined;
      if (record.state !== "stopping") return;
      if (!record.child.kill(signal)) {
        const error = new Error(
          `worker ${record.member.workerId} (pid ${String(record.pid)}) escalation ${signal} was not `
          + "delivered and the child has not reported exit; the stop is wedged",
        );
        deps.onFault(error);
        record.drainFailure?.reject(error);
        return;
      }
      record.observedStop.push({ stage, at: instant() });
      if (stage === "sigkill-sent" && draining !== undefined) armDrainExitTimeout(record);
      next?.();
    });
  };

  const armDrainExitTimeout = (record: MemberRecord): void => {
    record.drainExitTimer?.cancel();
    record.drainExitTimer = deps.scheduler.schedule(
      deps.clock.monotonicMs() + WORKER_EXIT_OBSERVATION_TIMEOUT_MS,
      () => {
        record.drainExitTimer = undefined;
        if (record.state === "exited" || record.drainFailure === undefined) return;
        const error = new Error(
          `worker ${record.member.workerId} (pid ${String(record.pid)}) received SIGKILL but no OS exit `
          + `was observed within ${String(WORKER_EXIT_OBSERVATION_TIMEOUT_MS)}ms`,
        );
        deps.onFault(error);
        record.drainFailure.reject(error);
      },
    );
  };

  const beginStopEscalation = async (
    record: MemberRecord,
    escalation: WorkerStopEscalationPolicy,
    directive: WorkerStopDirectiveContext,
  ): Promise<WorkerDirectiveLeaseVersions> => {
    if (record.stopInFlight) {
      throw new Error(
        `graceful stop refused: a stop is already in flight for ${record.member.workerId} `
        + "(the durable stop directive has been requested); its escalation stages are recorded as "
        + "they occur, not re-initiated",
      );
    }
    record.stopInFlight = true;
    let durable: WorkerDurableStopReceipt | undefined;
    try {
      durable = await deps.gracefulStop.request(record.member, directive);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      // A throw AFTER the durable directive landed is indistinguishable from
      // one before it. Releasing the flag and reverting to plain "running"
      // would let a plan attest a healthy member over a possibly-landed stop
      // and let a retry double-write the directive — instead the record
      // enters stop-uncertain, which refuses plans, re-stops, pause and
      // resume until the child's real exit is observed. stopInFlight stays
      // true on purpose: a stop with an unknown durable outcome IS still in
      // flight. (An exit that landed during the request keeps its own
      // evidence.)
      if (record.state === "running") {
        record.state = "stop-uncertain";
        record.stopUncertain = { at: instant(), cause };
      }
      throw new Error(
        `graceful stop for ${record.member.workerId} is UNCERTAIN: the durable stop channel threw `
        + `(${cause}); the directive may or may not have landed, so this worker refuses plan coverage `
        + "and further stop commands until its exit is observed",
        { cause: error },
      );
    }
    if (durable === undefined) {
      record.stopInFlight = false;
      throw new Error(
        `graceful stop for ${record.member.workerId} produced no durable acknowledgement; `
        + "the stop directive channel returned nothing",
      );
    }
    const requestedAt = IsoInstantSchema.parse(durable.requestedAt);
    const parsedVersions = WorkerDirectiveLeaseVersionsSchema.safeParse(durable.leaseVersions);
    if (!parsedVersions.success) {
      // The channel RESOLVED, so the durable directive stands — but its
      // receipt cannot say which write it was. Re-initiating or attesting
      // over a landed stop would double-write or lie, so the record is
      // blocked exactly like a stop-uncertain until the child's exit.
      if (record.state === "running") {
        record.state = "stop-uncertain";
        record.stopUncertain = {
          at: instant(),
          cause: `the durable stop directive landed but its receipt carries no valid lease versions: `
            + parsedVersions.error.message,
        };
      }
      throw new Error(
        `graceful stop for ${record.member.workerId} landed a durable directive whose receipt carries no valid `
        + `lease versions (${parsedVersions.error.message}); the write cannot be audited, so this worker refuses `
        + "plan coverage and further stop commands until its exit is observed",
      );
    }
    if (requestedAt !== directive.requestedAt) {
      // The directive DID land (the channel resolved), but at an instant that
      // is not the kernel command's `now` — the exact W1/W2 gap this seam
      // closes, because `requireObservedNotAfterNow` bounds observed stages by
      // that `now`. The record is blocked like a stop-uncertain (the durable
      // stop stands; re-initiating or attesting over it would double-write or
      // lie) and the command refuses by name.
      if (record.state === "running") {
        record.state = "stop-uncertain";
        record.stopUncertain = {
          at: instant(),
          cause: `the durable stop directive landed at ${requestedAt}, not the command's now `
            + `${directive.requestedAt}`,
        };
      }
      throw new Error(
        `graceful stop for ${record.member.workerId} recorded a durable requestedAt ${requestedAt} that is `
        + `not the command's now ${directive.requestedAt}; the observed graceful stage must carry the kernel `
        + "command's own instant, so this worker refuses plan coverage and further stop commands until its "
        + "exit is observed",
      );
    }
    if (record.state !== "running") {
      throw new Error(
        `graceful stop for ${record.member.workerId} raced: the child left the running state while the `
        + `durable directive was being requested (now ${record.state})`,
      );
    }
    record.state = "stopping";
    record.observedStop.push({ stage: "graceful-stop-requested", at: requestedAt });
    if (closed) {
      // close() ran while the durable request was in flight: the directive
      // landed and its stage is recorded above, but arming SIGTERM/SIGKILL
      // timers after teardown would resurrect the supervisor. close()
      // already reported this child stop-in-flight; the landed-directive
      // fact goes to the fault sink, and the command refuses instead of
      // acknowledging an escalation it will never run.
      deps.onFault(new Error(
        `worker ${record.member.workerId} durable stop directive landed at ${requestedAt}, but `
        + "the supervisor closed while the request was in flight; no escalation will be armed",
      ));
      throw new Error(
        `stop for ${record.member.workerId} was interrupted by close(): the durable stop directive landed `
        + `at ${requestedAt} and is recorded, but this closed supervisor arms no escalation`,
      );
    }
    armEscalation(record, "SIGTERM", "sigterm-sent", escalation[0].timeoutMs, () => {
      armEscalation(record, "SIGKILL", "sigkill-sent", escalation[1].timeoutMs);
    });
    return parsedVersions.data;
  };

  const stopWorker = async (
    member: WorkerPoolMember,
    escalation: WorkerStopEscalationPolicy,
    directive: WorkerStopDirectiveContext,
  ): Promise<WorkerSupervisorAcknowledgement> => {
    const record = requireLiveOwnedChild("stop-worker", member);
    if (record.state === "stopping") {
      throw new Error(
        `stop-worker refused: a stop is already in flight for ${member.workerId} `
        + `(observed: ${record.observedStop.map(({ stage }) => stage).join(" → ")}); its later escalation `
        + "stages are recorded as they occur, not re-initiated",
      );
    }
    const directiveLeaseVersions = await beginStopEscalation(record, escalation, directive);
    return WorkerSupervisorAcknowledgementSchema.parse({
      command: "stop-worker",
      state: "acknowledged",
      member,
      ownership: "supervised",
      escalation,
      observed: [...record.observedStop],
      directiveLeaseVersions,
    });
  };

  /** The canonical D271 escalation policy: 120s graceful, SIGTERM, 30s, SIGKILL. */
  const canonicalEscalation = (): z.infer<typeof WorkerStopEscalationPolicySchema> => WorkerStopEscalationPolicySchema.parse([
    { stage: "graceful-stop-requested", timeoutMs: WORKER_GRACEFUL_STOP_TIMEOUT_MS },
    { stage: "sigterm-sent", timeoutMs: WORKER_SIGTERM_TIMEOUT_MS },
    { stage: "sigkill-sent" },
  ]);

  /**
   * The truthful reconciliation fact for one roster member. A member this
   * supervisor never spawned, or one whose stop completed, has no process and
   * reads `unmet/not-started`; a crash stays visibly `crashed` (D271 — a crash
   * is evidence, never silently erased capacity); a stop already in flight is
   * attested `reconciling` with exactly the escalation prefix that already
   * occurred. `initiateStopForRunning` is set only for EXCESS members: a
   * running excess member gets its bounded graceful stop initiated here, while
   * a running desired member is simply `running`.
   */
  const planMemberFact = async (
    member: WorkerPoolMember,
    initiateStopForRunning: boolean,
    directive: WorkerStopDirectiveContext,
  ): Promise<z.input<typeof WorkerPoolMemberReconciliationFactSchema>> => {
    const record = records.get(member.workerId);
    if (record === undefined) {
      return { member, stage: "unmet", reason: "not-started" };
    }
    switch (record.state) {
      case "awaiting-birth":
        throw new Error(
          `plan-worker-count refused: worker ${member.workerId} (pid ${String(record.pid)}) has not proved `
          + "its lease birth; a plan cannot truthfully cover a spawn still in flight",
        );
      case "kill-undelivered":
        throw new Error(
          `plan-worker-count refused: worker ${member.workerId} (pid ${String(record.pid)}) may still be `
          + "alive — its spawn-abort SIGKILL was not delivered and no exit has been observed; a plan cannot "
          + "truthfully cover a possibly-live unproven child",
        );
      case "stop-uncertain":
        throw new Error(
          `plan-worker-count refused: worker ${member.workerId}'s durable stop directive is UNCERTAIN `
          + `(the stop channel threw mid-request: ${stopUncertainCause(record)}); `
          + "a plan cannot attest a member whose stop may have landed",
        );
      case "running":
        if (initiateStopForRunning) {
          const escalation = canonicalEscalation();
          await beginStopEscalation(record, escalation, directive);
          return {
            member,
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "initiating",
            escalation,
            observed: [...record.observedStop],
          };
        }
        return { member, stage: "running", ownership: "supervised" };
      case "stopping":
        return {
          member,
          stage: "graceful-stop-requested",
          ownership: "supervised",
          phase: "reconciling",
          escalation: canonicalEscalation(),
          observed: [...record.observedStop],
        };
      case "exited":
        return {
          member,
          stage: "unmet",
          reason: record.exit?.outcome === "crashed" ? "crashed" : "not-started",
        };
    }
  };

  const planWorkerCount = async (request: WorkerPoolPlanRequest): Promise<WorkerSupervisorAcknowledgement> => {
    const desired = request.members.map((member) => WorkerPoolMemberSchema.parse(member));
    const excess = request.excessMembers.map((member) => WorkerPoolMemberSchema.parse(member));
    const directive = WorkerStopDirectiveContextSchema.parse(request.directive);
    if (desired.length !== request.desiredWorkers) {
      throw new Error(
        `plan-worker-count refused: the request names ${String(desired.length)} desired members for `
        + `desiredWorkers ${String(request.desiredWorkers)}`,
      );
    }
    // EVERY refusal is pre-scanned before the first fact or stop: initiating
    // an excess member's durable stop and then refusing the plan would leave
    // that stop durably requested but unacknowledged.
    const roster = [...desired, ...excess];
    const seen = new Set<string>();
    for (const member of roster) {
      if (member.workflowId !== request.workflowId) {
        throw new Error(
          `plan-worker-count refused: member ${member.workerId} belongs to workflow ${member.workflowId}, `
          + `not the planned workflow ${request.workflowId}`,
        );
      }
      if (seen.has(member.workerId)) {
        throw new Error(
          `plan-worker-count refused: worker ${member.workerId} appears more than once across the `
          + "desired and excess rosters; one plan cannot both keep and stop (or doubly cover) the same worker",
        );
      }
      seen.add(member.workerId);
    }
    for (const member of roster) {
      const record = records.get(member.workerId);
      if (record === undefined) {
        if (deps.leases.observe(member.workerId) !== undefined) throw new WorkerControlRefusal(`plan-worker-count refused: ${member.workerId} is externally owned; no worker was adopted`);
        continue;
      }
      if (record.state === "running" || record.state === "stopping") requireLiveOwnedChild("plan-worker-count", member);
      if (record.state === "awaiting-birth") {
        throw new Error(
          `plan-worker-count refused: worker ${member.workerId} (pid ${String(record.pid)}) has not proved `
          + "its lease birth; a plan cannot truthfully cover a spawn still in flight",
        );
      }
      if (record.state === "kill-undelivered") {
        throw new Error(
          `plan-worker-count refused: worker ${member.workerId} (pid ${String(record.pid)}) may still be `
          + "alive — its spawn-abort SIGKILL was not delivered and no exit has been observed; a plan cannot "
          + "truthfully cover a possibly-live unproven child",
        );
      }
      if (record.state === "stop-uncertain") {
        throw new Error(
          `plan-worker-count refused: worker ${member.workerId}'s durable stop directive is UNCERTAIN `
          + `(the stop channel threw mid-request: ${stopUncertainCause(record)}); `
          + "a plan cannot attest a member whose stop may have landed",
        );
      }
      if (record.state === "running" && record.stopInFlight) {
        throw new Error(
          `plan-worker-count refused: worker ${member.workerId} has a stop in flight whose durable `
          + "directive has not yet been acknowledged; a plan cannot truthfully cover it",
        );
      }
    }
    const facts: z.input<typeof WorkerPoolMemberReconciliationFactSchema>[] = [];
    for (const member of desired) facts.push(await planMemberFact(member, false, directive));
    for (const member of excess) facts.push(await planMemberFact(member, true, directive));
    return WorkerSupervisorAcknowledgementSchema.parse({
      command: "plan-worker-count",
      state: "acknowledged",
      desiredWorkers: request.desiredWorkers,
      members: facts,
    });
  };

  /**
   * The kernel writes the durable pause/resume directive itself; this seam's
   * duty is the OWNERSHIP attestation — proving the directive targets a child
   * this supervisor durably owns and is not mid-stop, so a directive can never
   * be acknowledged against an external or dead process.
   */
  const attestDirective = (
    command: "pause-worker" | "resume-worker",
    member: WorkerPoolMember,
    stage: "pause-requested" | "resume-requested",
  ): WorkerSupervisorAcknowledgement => {
    const record = requireLiveOwnedChild(command, member);
    if (record.state === "stopping") {
      throw new Error(
        `${command} refused: a stop is already in flight for ${member.workerId} `
        + `(observed: ${record.observedStop.map(({ stage: observed }) => observed).join(" → ")})`,
      );
    }
    return WorkerSupervisorAcknowledgementSchema.parse({
      command,
      state: "acknowledged",
      member,
      ownership: "supervised",
      stage,
    });
  };

  const recordEvidence = (record: MemberRecord): WorkerChildEvidence => {
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
          ...(record.stopInFlight ? { stopInFlight: true } : {}),
        });
      case "stopping":
        return WorkerChildEvidenceSchema.parse({
          state: "stopping",
          pid: record.pid,
          bornAt: record.bornAt,
          observedStop: record.observedStop,
        });
      case "stop-uncertain": {
        if (record.stopUncertain === undefined) {
          throw new Error(
            `worker ${record.member.workerId} is recorded stop-uncertain without its channel-throw evidence; `
            + "the supervisor registry is corrupt",
          );
        }
        return WorkerChildEvidenceSchema.parse({
          state: "stop-uncertain",
          pid: record.pid,
          bornAt: record.bornAt,
          leaseStartedAt: record.leaseStartedAt,
          at: record.stopUncertain.at,
          cause: record.stopUncertain.cause,
        });
      }
      case "kill-undelivered": {
        if (record.killUndelivered === undefined) {
          throw new Error(
            `worker ${record.member.workerId} is recorded kill-undelivered without its abort evidence; `
            + "the supervisor registry is corrupt",
          );
        }
        return WorkerChildEvidenceSchema.parse({
          state: "kill-undelivered",
          pid: record.pid,
          at: record.killUndelivered.at,
          cause: record.killUndelivered.cause,
        });
      }
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
          reportedBy: record.exit.reportedBy,
          observedStop: record.observedStop,
        });
      }
    }
  };

  return Object.freeze({
    async execute(request: WorkerSupervisorRequest): Promise<WorkerSupervisorAcknowledgement> {
      if (closed || draining !== undefined) {
        throw new WorkerControlRefusal(
          `${request.command} refused: this worker supervisor is ${closed ? "closed" : "draining"}; `
          + "a shutting-down supervisor acknowledges nothing",
        );
      }
      if (deps.prepareAdmission !== undefined) await deps.prepareAdmission(request);
      if (closed || draining !== undefined) {
        throw new WorkerControlRefusal(
          `${request.command} refused: this worker supervisor is ${closed ? "closed" : "draining"}; `
          + "a shutting-down supervisor acknowledges nothing",
        );
      }
      deps.admission?.(request);
      switch (request.command) {
        case "plan-worker-count":
          return planWorkerCount(request);
        case "spawn-worker":
          return spawnWorker(WorkerPoolMemberSchema.parse(request.member));
        case "stop-worker":
          return stopWorker(
            WorkerPoolMemberSchema.parse(request.member),
            WorkerStopEscalationPolicySchema.parse(request.escalation),
            WorkerStopDirectiveContextSchema.parse(request.directive),
          );
        case "pause-worker":
          return attestDirective("pause-worker", WorkerPoolMemberSchema.parse(request.member), "pause-requested");
        case "resume-worker":
          return attestDirective("resume-worker", WorkerPoolMemberSchema.parse(request.member), "resume-requested");
        case "refresh-browser":
        case "reopen-browser": {
          const member = WorkerPoolMemberSchema.parse(request.member);
          const owned = requireLiveOwnedChild(request.command, member);
          if (owned.state !== "running" || owned.stopInFlight) throw new WorkerControlRefusal("worker-browser-worker-stopping");
          if (deps.browserControl === undefined || request.commandId === undefined) throw new WorkerControlRefusal("worker-browser-channel-unavailable: no admitted cross-process command");
          await deps.browserControl.request(request.commandId);
          return WorkerSupervisorAcknowledgementSchema.parse({ command: request.command, state: "acknowledged", member,
            ownership: "supervised", browserSessionId: request.browserSessionId,
            stage: request.command === "refresh-browser" ? "refreshed" : "reopened" });
        }
      }
      throw new Error(
        `worker supervisor received an unknown request: ${JSON.stringify(request)}`,
      );
    },
    ownsWorker(workerId: string, processId: number, startedAt: string): boolean {
      const record = records.get(workerId);
      return !closed && record !== undefined && (record.state === "running" || record.state === "stopping") && record.pid === processId && record.leaseStartedAt === startedAt;
    },
    memberEvidence(member: WorkerPoolMember): WorkerChildEvidence | undefined {
      const record = records.get(member.workerId);
      if (record === undefined) return undefined;
      return recordEvidence(record);
    },
    drainOwnedChildren(directive: WorkerStopDirectiveContext): Promise<void> {
      if (closed) return Promise.reject(new Error("cannot drain a closed worker supervisor"));
      if (draining !== undefined) return draining;
      const parsedDirective = WorkerStopDirectiveContextSchema.parse(directive);
      draining = (async () => {
        const live = [...records.values()].filter((record) => record.state !== "exited");
        const failures: Error[] = [];
        const stopRequests: Promise<void>[] = [];
        for (const record of live) {
          let rejectDrain!: (error: Error) => void;
          const promise = new Promise<void>((_resolve, reject) => { rejectDrain = reject; });
          // The promise is raced below after all stop requests have been started.
          void promise.catch(() => undefined);
          const drainFailure = { promise, reject: rejectDrain };
          record.drainFailure = drainFailure;
          if (record.state === "running") {
            stopRequests.push(beginStopEscalation(record, canonicalEscalation(), parsedDirective).then(() => undefined).catch((error: unknown) => {
              const failure = error instanceof Error ? error : new Error(String(error));
              failures.push(failure);
              if (record.state !== "exited") drainFailure.reject(failure);
            }));
          } else if (record.state === "stopping") {
            const finalSignalSent = record.observedStop.at(-1)?.stage === "sigkill-sent";
            if (record.stopInFlight || (record.escalationTimer === undefined && !finalSignalSent)) {
              const failure = new Error(
                `owned worker ${record.member.workerId} is stopping without an active D271 escalation`,
              );
              failures.push(failure);
              record.drainFailure.reject(failure);
            } else if (finalSignalSent) {
              armDrainExitTimeout(record);
            }
          } else {
            const failure = new Error(
              `owned worker ${record.member.workerId} cannot be safely drained from ${record.state}`,
            );
            failures.push(failure);
            record.drainFailure.reject(failure);
          }
        }
        await Promise.all(stopRequests);
        const outcomes = await Promise.allSettled(live.map(async (record) => {
          if (record.state === "exited") return;
          await Promise.race([record.exitObserved, record.drainFailure?.promise ?? Promise.resolve()]);
        }));
        for (const outcome of outcomes) {
          if (outcome.status === "rejected") {
            const failure = outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason));
            if (!failures.includes(failure)) failures.push(failure);
          }
        }
        if (failures.length > 0) {
          throw new AggregateError(failures, "dashboard could not observe every owned worker exit", { cause: failures[0] });
        }
      })();
      return draining;
    },
    close(): readonly WorkerChildEvidence[] {
      closed = true;
      const live: WorkerChildEvidence[] = [];
      for (const record of records.values()) {
        record.escalationTimer?.cancel();
        record.escalationTimer = undefined;
        record.drainExitTimer?.cancel();
        record.drainExitTimer = undefined;
        if (record.state !== "exited") live.push(recordEvidence(record));
      }
      return Object.freeze(live);
    },
  });
}
