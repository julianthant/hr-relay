import { ERROR_CATALOG, type ErrorCatalogCode } from "../../../models/failures/error-catalog.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import type { MonotonicDeadlineHandle, MonotonicDeadlineScheduler } from "../scheduling/deadline-scheduler.js";
import { WorkerChildMessageSchema, type WorkerActivity, type WorkerChildBrowserObservation, type WorkerControlRequest,
  type WorkerParentMessage, type WorkerStopReason } from "./worker-messages.js";
import { WorkerIpcProtocolError } from "./worker-ipc-router.js";

export interface WorkerPoolMember {
  readonly workflowId: string;
  readonly workerId: string;
  readonly ordinal: number;
  readonly poolIndex: number;
}

/** The pool's view of one spawned OS process; composition binds it to a ChildProcess and the pipe's IPC router. */
export interface WorkerProcessPort {
  readonly pid: number | undefined;
  send(message: WorkerParentMessage, callback: (error: Error | null) => void): void;
  /** `undefined` on Windows, where the only kill is TerminateProcess. */
  kill(signal: "SIGTERM" | "SIGKILL" | undefined): boolean;
  disconnect(): void;
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  onError(listener: (error: Error) => void): void;
  onWorkerMessage(listener: (message: unknown) => void): void;
}

export interface WorkerExitFact {
  readonly code: number | null;
  readonly signal: string | null;
  readonly at: string;
  readonly outcome: "stopped" | "crashed";
}

export interface WorkerMemberView {
  readonly member: WorkerPoolMember;
  readonly lifetimeId: string;
  readonly version: number;
  readonly state: "starting" | "running" | "stopping" | "exited";
  readonly pid: number | undefined;
  readonly startedAt: string;
  readonly activity: WorkerActivity | undefined;
  readonly browsers: readonly WorkerChildBrowserObservation[];
  readonly exit: (WorkerExitFact & { readonly settlement: "settled" | "failed" }) | undefined;
  /** A stop whose OS exit was not observed in time, or whose kill could not be delivered; no replacement may start. */
  readonly held: "exit-unobserved" | "kill-undelivered" | undefined;
}

export interface WorkerTarget {
  readonly workerId: string;
  readonly lifetimeId: string;
  readonly expectedVersion: number;
}

export const WORKER_READY_TIMEOUT_MS = 60_000;
export const WORKER_GRACEFUL_STOP_TIMEOUT_MS = 120_000;
export const WORKER_SIGTERM_TIMEOUT_MS = 30_000;
export const WORKER_EXIT_OBSERVATION_TIMEOUT_MS = 5_000;

export class WorkerPoolError extends Error {
  constructor(readonly code: ErrorCatalogCode, options?: ErrorOptions) { super(ERROR_CATALOG[code].text, options); this.name = "WorkerPoolError"; }
}

export interface WorkerPoolDependencies {
  readonly profileId: string;
  readonly sessionGeneration: number;
  readonly spawn: (member: WorkerPoolMember) => WorkerProcessPort;
  /** Settles the runs and leases of a process that existed; runs once per exit and again only on an explicit retry. */
  readonly settleExit: (member: WorkerPoolMember, exit: WorkerExitFact) => void | Promise<void>;
  readonly clock: Clock;
  readonly scheduler: MonotonicDeadlineScheduler;
  readonly platform: NodeJS.Platform;
  readonly ids: Readonly<{ uuid(): string }>;
  readonly timeouts?: Partial<Readonly<{ readyMs: number; gracefulMs: number; sigtermMs: number; exitObservationMs: number }>>;
  readonly onChange?: (view: WorkerMemberView) => void;
  readonly onFault?: (member: WorkerPoolMember, error: unknown) => void;
}

interface PendingReply {
  resolve(result: JsonValue): void;
  reject(error: Error): void;
  timer: MonotonicDeadlineHandle;
}

interface MemberRecord {
  readonly member: WorkerPoolMember;
  readonly lifetimeId: string;
  readonly port: WorkerProcessPort;
  readonly startedAt: string;
  version: number;
  state: WorkerMemberView["state"];
  activity: WorkerActivity | undefined;
  readonly browsers: Map<string, WorkerChildBrowserObservation>;
  held: WorkerMemberView["held"];
  exit: WorkerMemberView["exit"];
  settlementFailure: unknown;
  readonly pending: Map<string, PendingReply>;
  timers: MonotonicDeadlineHandle[];
  stopping: Promise<void> | undefined;
  readonly exited: Promise<void>;
  resolveExited(): void;
  ready: ((error: Error | undefined) => void) | undefined;
}

export function createWorkerPool(deps: WorkerPoolDependencies) {
  const timeouts = { readyMs: WORKER_READY_TIMEOUT_MS, gracefulMs: WORKER_GRACEFUL_STOP_TIMEOUT_MS,
    sigtermMs: WORKER_SIGTERM_TIMEOUT_MS, exitObservationMs: WORKER_EXIT_OBSERVATION_TIMEOUT_MS, ...deps.timeouts };
  const records = new Map<string, MemberRecord>();
  const at = () => IsoInstantSchema.parse(deps.clock.now().toISOString());
  const after = (ms: number, run: () => void): MonotonicDeadlineHandle => deps.scheduler.schedule(deps.clock.monotonicMs() + ms, run);

  const view = (record: MemberRecord): WorkerMemberView => Object.freeze({
    member: record.member, lifetimeId: record.lifetimeId, version: record.version, state: record.state, pid: record.port.pid,
    startedAt: record.startedAt, activity: record.activity, browsers: Object.freeze([...record.browsers.values()]), exit: record.exit, held: record.held,
  });
  const changed = (record: MemberRecord): void => {
    record.version += 1;
    try { deps.onChange?.(view(record)); } catch (error) { deps.onFault?.(record.member, error); }
  };
  const cancelTimers = (record: MemberRecord): void => { for (const timer of record.timers) timer.cancel(); record.timers = []; };

  // The OS exit event is the only proof of death; nothing else moves a spawned member to exited.
  const onExit = async (record: MemberRecord, code: number | null, signal: string | null): Promise<void> => {
    if (record.state === "exited") return;
    cancelTimers(record);
    const fact: WorkerExitFact = { code, signal, at: at(), outcome: record.stopping === undefined ? "crashed" : "stopped" };
    record.state = "exited"; record.held = undefined;
    for (const pending of record.pending.values()) { pending.timer.cancel(); pending.reject(new WorkerPoolError("WORKER_EXITED")); }
    record.pending.clear();
    record.ready?.(new WorkerPoolError("WORKER_EXITED"));
    try { await deps.settleExit(record.member, fact); record.exit = { ...fact, settlement: "settled" }; }
    catch (error) { record.settlementFailure = error; record.exit = { ...fact, settlement: "failed" }; deps.onFault?.(record.member, error); }
    changed(record);
    record.resolveExited();
  };

  const observeExit = (record: MemberRecord): void => {
    record.timers.push(after(timeouts.exitObservationMs, () => {
      if (record.state === "exited") return;
      record.held ??= "exit-unobserved";
      changed(record);
      record.resolveExited();
    }));
  };
  const kill = (record: MemberRecord, signal: "SIGTERM" | "SIGKILL"): void => {
    if (record.state === "exited") return;
    if (!record.port.kill(deps.platform === "win32" ? undefined : signal)) { record.held = "kill-undelivered"; changed(record); }
  };

  /** Bounded escalation; resolves when the OS exit is observed or the observation window closes. */
  const escalate = (record: MemberRecord, reason: WorkerStopReason, immediate: boolean): Promise<void> => {
    if (record.stopping !== undefined) return record.stopping;
    record.state = "stopping"; changed(record);
    record.stopping = record.exited;
    const lastResort = (): void => { kill(record, "SIGKILL"); observeExit(record); };
    if (immediate) { lastResort(); return record.stopping; }
    record.port.send({ kind: "worker-stop", reason }, error => { if (error !== null) deps.onFault?.(record.member, error); });
    record.timers.push(after(timeouts.gracefulMs, () => {
      if (deps.platform === "win32") { lastResort(); return; }
      kill(record, "SIGTERM");
      record.timers.push(after(timeouts.sigtermMs, lastResort));
    }));
    return record.stopping;
  };

  const fault = (record: MemberRecord, error: unknown, immediate = record.state === "starting"): void => {
    deps.onFault?.(record.member, error);
    if (immediate && record.stopping !== undefined && record.state !== "exited") { kill(record, "SIGKILL"); observeExit(record); return; }
    void escalate(record, "fault", immediate);
  };

  const receive = (record: MemberRecord, raw: unknown): void => {
    const parsed = WorkerChildMessageSchema.safeParse(raw);
    if (!parsed.success) {
      record.port.disconnect();
      fault(record, new WorkerIpcProtocolError(typeof raw === "object" && raw !== null && "kind" in raw ? String(raw.kind) : "invalid"), true);
      return;
    }
    const message = parsed.data;
    if (message.kind === "worker-ready") {
      if (record.state !== "starting" || message.workerId !== record.member.workerId || message.pid !== record.port.pid
        || message.profileId !== deps.profileId || message.sessionGeneration !== deps.sessionGeneration) {
        const error = new WorkerPoolError("WORKER_IDENTITY_MISMATCH");
        record.ready?.(error); record.ready = undefined;
        fault(record, error);
        return;
      }
      record.activity = message.activity; record.state = "running";
      cancelTimers(record); changed(record);
      record.ready?.(undefined); record.ready = undefined;
    } else if (message.kind === "worker-activity") {
      if (record.state === "exited") return;
      record.activity = message.activity; changed(record);
    } else if (message.kind === "worker-browser") {
      if (message.observation.health === "closed") record.browsers.delete(message.observation.sessionId);
      else record.browsers.set(message.observation.sessionId, message.observation);
      changed(record);
    } else {
      const pending = record.pending.get(message.requestId);
      if (pending === undefined) return;
      record.pending.delete(message.requestId); pending.timer.cancel();
      if (message.outcome.state === "done") pending.resolve(message.outcome.result);
      else pending.reject(new WorkerPoolError(message.outcome.code));
    }
  };

  const current = (target: WorkerTarget): MemberRecord => {
    const record = records.get(target.workerId);
    if (record === undefined || record.lifetimeId !== target.lifetimeId || record.version !== target.expectedVersion) throw new WorkerPoolError("WORKER_TARGET_STALE");
    return record;
  };
  const exitFact = (record: MemberRecord): WorkerExitFact => {
    if (record.exit === undefined || record.held !== undefined) throw new WorkerPoolError("WORKER_EXIT_UNOBSERVED");
    if (record.exit.settlement === "failed") throw new WorkerPoolError("WORKER_EXIT_SETTLEMENT_FAILED", { cause: record.settlementFailure });
    return record.exit;
  };

  return Object.freeze({
    snapshot(): readonly WorkerMemberView[] { return Object.freeze([...records.values()].map(view)); },

    async start(member: WorkerPoolMember): Promise<WorkerMemberView> {
      const prior = records.get(member.workerId);
      if (prior !== undefined && prior.state !== "exited") throw new WorkerPoolError(prior.held === undefined ? "WORKER_ALREADY_RUNNING" : "WORKER_EXIT_UNOBSERVED");
      if (prior?.exit?.settlement === "failed") {
        try { await deps.settleExit(prior.member, prior.exit); prior.exit = { ...prior.exit, settlement: "settled" }; prior.settlementFailure = undefined; changed(prior); }
        catch (error) { prior.settlementFailure = error; throw new WorkerPoolError("WORKER_EXIT_SETTLEMENT_FAILED", { cause: error }); }
      }
      const port = deps.spawn(member);
      let resolveExited!: () => void;
      const exited = new Promise<void>(resolve => { resolveExited = resolve; });
      const record: MemberRecord = { member, lifetimeId: deps.ids.uuid(), port, startedAt: at(), version: 0, state: "starting",
        activity: undefined, browsers: new Map(), held: undefined, exit: undefined, settlementFailure: undefined,
        pending: new Map(), timers: [], stopping: undefined, exited, resolveExited, ready: undefined };
      records.set(member.workerId, record);
      const readiness = new Promise<Error | undefined>(resolve => { record.ready = resolve; });
      if (port.pid === undefined) {
        // Only a spawn the OS refused has no pid; that process never existed, so it claimed nothing.
        const failure = await new Promise<Error>(resolve => { port.onError(resolve); });
        cancelTimers(record);
        record.state = "exited";
        record.exit = { code: null, signal: null, at: at(), outcome: "crashed", settlement: "settled" };
        changed(record); record.resolveExited();
        throw new WorkerPoolError("WORKER_START_FAILED", { cause: failure });
      }
      port.onExit((code, signal) => { void onExit(record, code, signal); });
      port.onError(error => { if (record.state !== "exited") fault(record, error); });
      port.onWorkerMessage(raw => { receive(record, raw); });
      record.timers.push(after(timeouts.readyMs, () => {
        if (record.state !== "starting") return;
        const error = new WorkerPoolError("WORKER_START_TIMED_OUT");
        record.ready?.(error); record.ready = undefined;
        void escalate(record, "fault", true);
      }));
      changed(record);
      const failure = await readiness;
      if (failure === undefined) return view(record);
      await record.exited;
      if (record.held !== undefined) throw new WorkerPoolError("WORKER_EXIT_UNOBSERVED", { cause: failure });
      throw failure;
    },

    async stop(target: WorkerTarget, reason: WorkerStopReason): Promise<WorkerExitFact> {
      const record = current(target);
      if (record.state !== "exited") await escalate(record, reason, false);
      return exitFact(record);
    },

    async request(target: WorkerTarget, request: WorkerControlRequest, deadlineMs: number): Promise<JsonValue> {
      const record = current(target);
      if (record.state !== "running") throw new WorkerPoolError(record.state === "exited" ? "WORKER_EXITED" : "WORKER_BUSY");
      const requestId = deps.ids.uuid();
      return await new Promise<JsonValue>((resolve, reject) => {
        const timer = after(deadlineMs, () => {
          if (record.pending.delete(requestId)) reject(new WorkerPoolError("WORKER_REQUEST_TIMED_OUT"));
        });
        record.pending.set(requestId, { resolve, reject, timer });
        record.port.send({ kind: "worker-request", requestId, sentAt: at(), deadlineMs, request }, error => {
          if (error === null || !record.pending.delete(requestId)) return;
          timer.cancel();
          reject(new WorkerPoolError("WORKER_EXITED", { cause: error }));
        });
      });
    },

    /** Stops every member that has not exited and waits only within each member's bounded escalation. */
    async stopAll(reason: WorkerStopReason): Promise<readonly WorkerMemberView[]> {
      await Promise.all([...records.values()].filter(record => record.state !== "exited").map(record => escalate(record, reason, false)));
      return Object.freeze([...records.values()].map(view));
    },
  });
}
export type WorkerPool = ReturnType<typeof createWorkerPool>;
