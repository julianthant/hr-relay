import { WorkerRetirementProofSchema, type WorkerRetirementProof } from "../../../models/run/worker-slot.js";
import { mintWorkerSupervisorEffect, type WorkerSupervisorEffect } from "../../storage/sqlite/worker-control.js";
import { WorkerLifecycleBindingSchema, type WorkerLifecycleBinding } from "../../../models/run/worker-control.js";
import { WorkerControlRefusal } from "../../../models/run/worker-control.js";

import { isAbsolute } from "node:path";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import { CommandIdSchema, IsoInstantSchema } from "../../../rules/identity/ids.js";
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
  readonly browserControl?: Readonly<{ request(commandId: string): Promise<string>; closeForRemoval(commandId: string): Promise<void> }>;
  readonly spawn: WorkerProcessSpawner;
  readonly leases: WorkerLeaseProbe;
  readonly gracefulStop: WorkerGracefulStopChannel;
  readonly clock: Clock;
  readonly scheduler: MonotonicDeadlineScheduler;
  /** Birth-proof polling: re-probe the lease every `pollMs`, give up at `timeoutMs`. */
  readonly birth: Readonly<{ pollMs: number; timeoutMs: number }>;

  readonly standingRecoverySettled?: (commandId: string) => boolean;
  readonly assertRetainedOwnerDeath?: (member: WorkerPoolMember, lifetime: Readonly<{ leaseGeneration: number; processId: number; startedAt: string }>, birthCommandId?: string) => void;
  readonly proveRetirement: (member: WorkerPoolMember) => WorkerRetirementProof;
  readonly onFault: (error: Error) => void;
}

/* ── the argv contract ───────────────────────────────────────────────────── */

export const WORKER_CLI_SUBCOMMAND = "worker";
export const WORKER_CLI_POOL_INDEX_FLAG = "--pool-index";
/** Bound the OS exit event observation after an accepted SIGKILL during shutdown. */
export const WORKER_EXIT_OBSERVATION_TIMEOUT_MS = 5_000;

/** The member-derived argv tail: `worker <workflow-id> --pool-index <n>`. */
export function workerCliArgv(member: WorkerPoolMember, commandId: string): readonly string[] {
  const launchCommandId = CommandIdSchema.parse(commandId);
  return Object.freeze([
    WORKER_CLI_SUBCOMMAND,
    member.workflowId,
    WORKER_CLI_POOL_INDEX_FLAG,
    String(member.poolIndex),
    "--worker-id", member.workerId,
    "--ordinal", String(member.ordinal),
    "--membership-revision", String(member.membershipRevision),
    "--launch-command-id", launchCommandId,
  ]);
}

/* ── evidence ────────────────────────────────────────────────────────────── */

// Absent ownership cannot distinguish an external process from no process; neither grants control.
interface MemberRecord {
  readonly member: WorkerPoolMember;
  state: "awaiting-birth" | "running" | "stopping" | "stop-uncertain" | "kill-undelivered" | "exited";
  readonly child: SpawnedWorkerHandle;
  pid: number | undefined;
  bornAt?: string;
  leaseStartedAt?: string;
  // Failed pre-birth kill retains the blocked member until an OS exit is observed.
  killUndelivered?: { at: string; cause: string };
  // A throwing durable stop request has unknown landing; refuse further control instead of retrying.
  stopUncertain?: { at: string; cause: string };
  // Mark stopping before awaiting the directive so another command cannot race its in-flight write.
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
    // Only an OS exit or proof that a child cannot run permits an exited state.
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

  restoreStandingWorker(binding: WorkerLifecycleBinding): Promise<void>;
  drainOwnedChildren(directive: WorkerStopDirectiveContext): Promise<void>;

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

  const spawnWorker = async (member: WorkerPoolMember, commandId: string): Promise<WorkerSupervisorAcknowledgement> => {
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
      args: Object.freeze([...deps.launch.prefixArgs, ...workerCliArgv(member, commandId)]),
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
      // A failed spawn-abort kill leaves the child uncertain and the member slot blocked.
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

          deps.onFault(new Error(
            `worker ${member.workerId} (pid ${String(record.pid)}) process errored after its lease `
            + `birth settled: ${error.message}`,
          ));
          return;
        }
        // Spawn ENOENT may emit no exit event; record the pre-birth failure explicitly.
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
            // An undelivered SIGKILL does not prove exit; keep the slot occupied.
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
          // A throwing birth probe must reject the pending launch rather than escape a scheduler callback.
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
      // An exit between birth resolution and continuation must not be overwritten by running state.
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


  const controls = new Map<string, Promise<void>>();

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
    if (canonicalJsonStringify(record.member) !== canonicalJsonStringify(member)) throw new WorkerControlRefusal("worker-control-owned-member-changed");
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

  // Record escalation only after the signal is delivered; failed delivery is a fault, never an observed stage.
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
    const child = record.child;
    const memberIdentity = canonicalJsonStringify(record.member);
    const pid = record.pid;
    const bornAt = record.bornAt;
    const leaseStartedAt = record.leaseStartedAt;
    record.stopInFlight = true;
    let durable: WorkerDurableStopReceipt | undefined;
    try {
      durable = await deps.gracefulStop.request(record.member, directive);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      // A stop-channel throw leaves directive landing unknown; preserve that uncertainty.
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
      // A landed stop without its exact write receipt cannot be safely re-initiated or attested.
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
    if (records.get(record.member.workerId) !== record || canonicalJsonStringify(record.member) !== memberIdentity
      || record.child !== child || record.pid !== pid
      || record.bornAt !== bornAt || record.leaseStartedAt !== leaseStartedAt
      || record.stopUncertain !== undefined || record.killUndelivered !== undefined) {
      throw new WorkerControlRefusal("worker-stop-owner-changed");
    }
    if (record.state === "exited" && record.exit?.reportedBy === "os") {
      if (closed) throw new WorkerControlRefusal("worker-supervisor-closed");
      record.observedStop.push({ stage: "graceful-stop-requested", at: requestedAt });
      record.exit = { ...record.exit, outcome: "stopped" };
      return parsedVersions.data;
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
      // Teardown during a durable stop request must not arm new escalation timers.
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


  const canonicalEscalation = (): z.infer<typeof WorkerStopEscalationPolicySchema> => WorkerStopEscalationPolicySchema.parse([
    { stage: "graceful-stop-requested", timeoutMs: WORKER_GRACEFUL_STOP_TIMEOUT_MS },
    { stage: "sigterm-sent", timeoutMs: WORKER_SIGTERM_TIMEOUT_MS },
    { stage: "sigkill-sent" },
  ]);


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
          if (record.exit !== undefined) {
            return { member, stage: "unmet", reason: record.exit.outcome === "crashed" ? "crashed" : "not-started" };
          }
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
      if (canonicalJsonStringify(record.member) !== canonicalJsonStringify(member)) throw new WorkerControlRefusal("worker-control-owned-member-changed");
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
    for (const member of excess) {
      await planMemberFact(member, true, directive);
      const record = records.get(member.workerId);
      if (record !== undefined && record.state !== "exited") {
        await new Promise<void>((resolve, reject) => {
          const timeout = deps.scheduler.schedule(deps.clock.monotonicMs()
            + WORKER_GRACEFUL_STOP_TIMEOUT_MS + WORKER_SIGTERM_TIMEOUT_MS + WORKER_EXIT_OBSERVATION_TIMEOUT_MS,
          () => reject(new Error("worker-retirement-exit-not-observed")));
          void record.exitObserved.then(() => { timeout.cancel(); resolve(); });
        });
      }
      const proof = WorkerRetirementProofSchema.parse(deps.proveRetirement(member));
      if (proof.workerId !== member.workerId || proof.membershipRevision !== member.membershipRevision) throw new Error("worker-retirement-proof-identity-mismatch");
      facts.push({ member, stage: "retired", proof });
    }
    return WorkerSupervisorAcknowledgementSchema.parse({
      command: "plan-worker-count",
      state: "acknowledged",
      desiredWorkers: request.desiredWorkers,
      members: facts,
    });
  };

  // Pause and resume require attested ownership of the supervisor's own live child.
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

  const spawnReplacement = async (input: WorkerLifecycleBinding) => {
      const binding = WorkerLifecycleBindingSchema.parse(input);
      if (closed || draining !== undefined) throw new WorkerControlRefusal("worker-lifecycle-supervisor-unavailable");
      if (binding.operation.kind !== "retry") throw new WorkerControlRefusal("worker-retry-binding-required");
      const { member, commandId } = binding;
      const record = records.get(member.workerId);
      if (record === undefined) {
        if (deps.assertRetainedOwnerDeath === undefined) throw new WorkerControlRefusal("worker-retry-death-unproved");
        deps.assertRetainedOwnerDeath(member, binding.lifetime, binding.birthCommandId);
      } else if (record.state !== "exited" || record.exit?.reportedBy !== "os"
        || record.pid !== binding.lifetime.processId || record.leaseStartedAt !== binding.lifetime.startedAt
        || canonicalJsonStringify(record.member) !== canonicalJsonStringify(member) || deps.leases.observe(member.workerId) !== undefined) throw new WorkerControlRefusal("worker-retry-death-unproved");
      deps.proveRetirement(member);
      const request = { command: "spawn-worker" as const, member, commandId };
      await deps.prepareAdmission?.(request);
      if (closed || draining !== undefined) throw new WorkerControlRefusal("worker-lifecycle-supervisor-unavailable");
      if (records.get(member.workerId) !== record || record !== undefined && (record.state !== "exited" || record.exit?.reportedBy !== "os")) throw new WorkerControlRefusal("worker-retry-owner-changed");
      if (record === undefined) deps.assertRetainedOwnerDeath?.(member, binding.lifetime, binding.birthCommandId);
      deps.admission?.(request);
      await spawnWorker(member, commandId);
      const born = requireLiveOwnedChild("spawn-worker", member);
      if (born.pid === undefined || born.leaseStartedAt === undefined) throw new WorkerControlRefusal("worker-retry-birth-unproved");
      return { binding, born, birth: { processId: born.pid, startedAt: born.leaseStartedAt } };
  };

  return Object.freeze({
    assertLifecycleOwner(operation: "remove" | "retry", member: WorkerPoolMember, lifetime: Readonly<{ leaseGeneration: number; processId: number; startedAt: string }>): void {
      if (closed || draining !== undefined) throw new WorkerControlRefusal("worker-lifecycle-supervisor-unavailable");
      const record = records.get(member.workerId);
      if (operation === "remove") {
        const current = requireLiveOwnedChild("stop-worker", member);
        if (current.state !== "running" || current.stopInFlight || current.pid !== lifetime.processId || current.leaseStartedAt !== lifetime.startedAt) throw new WorkerControlRefusal("worker-removal-owner-unavailable");
      } else if (record === undefined) {
        if (deps.assertRetainedOwnerDeath === undefined) throw new WorkerControlRefusal("worker-retry-death-unproved");
        deps.assertRetainedOwnerDeath(member, lifetime);
      } else if (record.state !== "exited" || record.exit?.reportedBy !== "os"
        || record.pid !== lifetime.processId || record.leaseStartedAt !== lifetime.startedAt
        || canonicalJsonStringify(record.member) !== canonicalJsonStringify(member) || deps.leases.observe(member.workerId) !== undefined) throw new WorkerControlRefusal("worker-retry-death-unproved");
    },
    ownWorkerControl(commandId: string, work: () => Promise<void>): void {
      if (closed || draining !== undefined) throw new WorkerControlRefusal("worker-lifecycle-supervisor-unavailable");
      if (controls.has(commandId)) return;
      const operation = Promise.resolve().then(work);
      controls.set(commandId, operation);
      void operation.catch(error => { deps.onFault(error instanceof Error ? error : new Error("worker-lifecycle-failed", { cause: error })); });
    },
    async removeWorker(input: WorkerLifecycleBinding, directive: WorkerStopDirectiveContext): Promise<WorkerSupervisorEffect> {
      const binding = WorkerLifecycleBindingSchema.parse(input);
      if (closed || draining !== undefined) throw new WorkerControlRefusal("worker-lifecycle-supervisor-unavailable");
      if (binding.operation.kind !== "remove") throw new WorkerControlRefusal("worker-removal-binding-required");
      const { member, commandId } = binding;
      if (deps.browserControl === undefined) throw new WorkerControlRefusal("worker-removal-channel-unavailable");
      const owned = requireLiveOwnedChild("stop-worker", member);
      if (owned.pid !== binding.lifetime.processId || owned.leaseStartedAt !== binding.lifetime.startedAt || directive.commandId !== commandId) throw new WorkerControlRefusal("worker-removal-lifetime-conflict");
      await deps.browserControl.closeForRemoval(commandId);
      if (closed || draining !== undefined) throw new WorkerControlRefusal("worker-lifecycle-supervisor-unavailable");
      if (requireLiveOwnedChild("stop-worker", member) !== owned) throw new WorkerControlRefusal("worker-removal-owner-changed");
      await stopWorker(member, canonicalEscalation(), directive);
      if (owned.state !== "exited") await new Promise<void>((resolve, reject) => {
        const timer = deps.scheduler.schedule(deps.clock.monotonicMs() + WORKER_GRACEFUL_STOP_TIMEOUT_MS + WORKER_SIGTERM_TIMEOUT_MS + WORKER_EXIT_OBSERVATION_TIMEOUT_MS,
          () => { reject(new Error("worker-removal-exit-unproved")); });
        void owned.exitObserved.then(() => { timer.cancel(); resolve(); });
      });
      if (owned.exit?.reportedBy !== "os") throw new WorkerControlRefusal("worker-removal-death-unproved");
      const retirement = WorkerRetirementProofSchema.parse(deps.proveRetirement(member));
      return mintWorkerSupervisorEffect(binding, { kind: "remove", retirement }, () => records.get(member.workerId) === owned && owned.state === "exited" && owned.exit?.reportedBy === "os");
    },
    async retryWorker(input: WorkerLifecycleBinding): Promise<WorkerSupervisorEffect> {
      const { binding, born, birth } = await spawnReplacement(input), member = binding.member;
      return mintWorkerSupervisorEffect(binding, { kind: "retry", leaseGeneration: binding.lifetime.leaseGeneration + 1,
        ...birth }, () => records.get(member.workerId) === born && born.state === "running"
          && deps.leases.observe(member.workerId)?.processId === born.pid && deps.leases.observe(member.workerId)?.startedAt === born.leaseStartedAt);
    },
    async restoreStandingWorker(input: WorkerLifecycleBinding): Promise<void> {
      if (deps.standingRecoverySettled === undefined) throw new WorkerControlRefusal("worker-standing-recovery-owner-unavailable");
      const { binding, born } = await spawnReplacement(input);
      const deadline = deps.clock.monotonicMs() + deps.birth.timeoutMs;
      while (!deps.standingRecoverySettled(binding.commandId)) {
        if (closed || draining !== undefined || records.get(binding.member.workerId) !== born || born.state !== "running"
          || deps.clock.monotonicMs() >= deadline) throw new WorkerControlRefusal("worker-standing-recovery-settlement-unproved");
        await new Promise<void>(resolve => { deps.scheduler.schedule(Math.min(deadline, deps.clock.monotonicMs() + deps.birth.pollMs), resolve); });
      }
    },
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
          return spawnWorker(WorkerPoolMemberSchema.parse(request.member), CommandIdSchema.parse(request.commandId));
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
    assertResetOwner(member: WorkerPoolMember, lifetime: Readonly<{ leaseGeneration: number; processId: number; startedAt: string }>): void {
      if (closed || draining !== undefined) throw new WorkerControlRefusal("worker-reset-supervisor-unavailable");
      const owned = requireLiveOwnedChild("stop-worker", WorkerPoolMemberSchema.parse(member));
      const current = deps.leases.observe(member.workerId);
      if (owned.state !== "running" || owned.stopInFlight || current === undefined || current.processId !== lifetime.processId
        || current.startedAt !== lifetime.startedAt) throw new WorkerControlRefusal("worker-reset-owned-lifetime-unavailable");
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
                `owned worker ${record.member.workerId} is stopping without an active escalation`,
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
        for (const outcome of await Promise.allSettled(controls.values())) {
          if (outcome.status === "rejected") failures.push(outcome.reason instanceof Error ? outcome.reason : new Error("worker-control-drain-failed", { cause: outcome.reason }));
        }
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
