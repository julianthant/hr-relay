import { ERROR_CATALOG, type ErrorCatalogCode } from "../../../models/failures/error-catalog.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import { IsoInstantSchema, type BrowserSystemId } from "../../../rules/identity/ids.js";
import type { MonotonicDeadlineHandle, MonotonicDeadlineScheduler } from "../scheduling/deadline-scheduler.js";
import { WorkerChildMessageSchema, type WorkerActivity, type WorkerChildBrowserObservation, type WorkerControlRequest,
  type WorkerDirective, type WorkerParentMessage, type WorkerStopReason } from "./worker-messages.js";
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
  onDisconnect(listener: () => void): void;
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  onError(listener: (error: Error) => void): void;
  onWorkerMessage(listener: (message: unknown) => void): void;
}

export interface WorkerExitFact {
  readonly code: number | null;
  readonly signal: string | null;
  readonly at: string;
  readonly outcome: "stopped" | "crashed";
  /** The stop request that ended a stopped member. */
  readonly reason?: WorkerStopReason;
  /** The catalog code a crashed child reported before it exited. */
  readonly failureCode?: ErrorCatalogCode;
}

export interface WorkerMemberView {
  readonly member: WorkerPoolMember;
  readonly lifetimeId: string;
  readonly version: number;
  readonly state: "starting" | "running" | "stopping" | "exited";
  readonly directive: WorkerDirective;
  readonly pid: number | undefined;
  readonly startedAt: string;
  readonly activity: WorkerActivity | undefined;
  readonly browsers: readonly WorkerChildBrowserObservation[];
  /** The descriptor's browser systems, as the child reported them when ready. */
  readonly browserSystems?: readonly BrowserSystemId[];
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
  directive: WorkerDirective;
  /** Set for the whole settlement retry, before its await, so a second start cannot spawn. */
  settling: boolean;
  activity: WorkerActivity | undefined;
  readonly browsers: Map<string, WorkerChildBrowserObservation>;
  browserSystems: readonly BrowserSystemId[] | undefined;
  stopReason: WorkerStopReason | undefined;
  failureCode: ErrorCatalogCode | undefined;
  held: WorkerMemberView["held"];
  exit: WorkerMemberView["exit"];
  settlementFailure: unknown;
  readonly pending: Map<string, PendingReply>;
  timers: MonotonicDeadlineHandle[];
  stopping: Promise<void> | undefined;
  /** Resolves when the OS exit is observed or the bounded observation window closes. */
  readonly exited: Promise<void>;
  resolveExited(): void;
  /** Resolves only when the first settlement of an observed OS exit has finished. */
  readonly settled: Promise<void>;
  resolveSettled(): void;
  ready: ((error: Error | undefined) => void) | undefined;
}

export function createWorkerPool(deps: WorkerPoolDependencies) {
  const timeouts = { readyMs: WORKER_READY_TIMEOUT_MS, gracefulMs: WORKER_GRACEFUL_STOP_TIMEOUT_MS,
    sigtermMs: WORKER_SIGTERM_TIMEOUT_MS, exitObservationMs: WORKER_EXIT_OBSERVATION_TIMEOUT_MS, ...deps.timeouts };
  const records = new Map<string, MemberRecord>();
  const at = () => IsoInstantSchema.parse(deps.clock.now().toISOString());
  const after = (ms: number, run: () => void): MonotonicDeadlineHandle => deps.scheduler.schedule(deps.clock.monotonicMs() + ms, run);

  const view = (record: MemberRecord): WorkerMemberView => Object.freeze({
    member: record.member, lifetimeId: record.lifetimeId, version: record.version, state: record.state, directive: record.directive, pid: record.port.pid,
    startedAt: record.startedAt, activity: record.activity, browsers: Object.freeze([...record.browsers.values()]), exit: record.exit, held: record.held,
    ...(record.browserSystems === undefined ? {} : { browserSystems: record.browserSystems }),
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
    const fact: WorkerExitFact = record.stopping === undefined
      ? { code, signal, at: at(), outcome: "crashed", ...(record.failureCode === undefined ? {} : { failureCode: record.failureCode }) }
      : { code, signal, at: at(), outcome: "stopped", ...(record.stopReason === undefined ? {} : { reason: record.stopReason }) };
    record.state = "exited"; record.held = undefined;
    rejectPending(record, new WorkerPoolError("WORKER_EXITED"));
    record.ready?.(new WorkerPoolError("WORKER_EXITED"));
    try { await deps.settleExit(record.member, fact); record.exit = { ...fact, settlement: "settled" }; }
    catch (error) { record.settlementFailure = error; record.exit = { ...fact, settlement: "failed" }; deps.onFault?.(record.member, error); }
    changed(record);
    record.resolveSettled();
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
    record.stopReason = reason;
    record.state = "stopping"; changed(record);
    record.stopping = record.exited;
    const lastResort = (): void => { kill(record, "SIGKILL"); observeExit(record); };
    if (immediate) { lastResort(); return record.stopping; }
    record.port.send({ kind: "worker-stop", reason, mode: "after-run" }, error => { if (error !== null) deps.onFault?.(record.member, error); });
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
      record.activity = message.activity;
      record.browserSystems = Object.freeze(message.browserSystems);
      record.directive = message.activity.state === "paused" ? "pause" : "run";
      record.state = "running";
      cancelTimers(record); changed(record);
      record.ready?.(undefined); record.ready = undefined;
    } else if (message.kind === "worker-activity") {
      if (record.state === "exited") return;
      record.activity = message.activity; changed(record);
    } else if (message.kind === "worker-browser") {
      if (message.observation.health === "closed") record.browsers.delete(message.observation.sessionId);
      else record.browsers.set(message.observation.sessionId, message.observation);
      changed(record);
    } else if (message.kind === "worker-failed") {
      record.failureCode = message.code;
    } else {
      const pending = record.pending.get(message.requestId);
      if (pending === undefined) { deps.onFault?.(record.member, new WorkerPoolError("WORKER_REQUEST_TIMED_OUT")); return; }
      record.pending.delete(message.requestId); pending.timer.cancel();
      if (message.outcome.state === "done") {
        const directive = directiveOf(message.outcome.result);
        if (directive !== undefined) { record.directive = directive; changed(record); }
        pending.resolve(message.outcome.result);
      } else pending.reject(new WorkerPoolError(message.outcome.code));
    }
  };

  const directiveOf = (result: JsonValue): WorkerDirective | undefined => {
    if (typeof result !== "object" || result === null || Array.isArray(result) || !("directive" in result)) return undefined;
    return result.directive === "run" || result.directive === "pause" ? result.directive : undefined;
  };
  const rejectPending = (record: MemberRecord, error: Error): void => {
    for (const pending of record.pending.values()) { pending.timer.cancel(); pending.reject(error); }
    record.pending.clear();
  };
  const awaitReply = (record: MemberRecord, message: Exclude<WorkerParentMessage, { kind: "worker-stop" }>, deadlineMs: number): Promise<JsonValue> =>
    new Promise((resolve, reject) => {
      const timer = after(deadlineMs, () => {
        if (record.pending.delete(message.requestId)) reject(new WorkerPoolError("WORKER_REQUEST_TIMED_OUT"));
      });
      record.pending.set(message.requestId, { resolve, reject, timer });
      record.port.send(message, error => {
        if (error === null || !record.pending.delete(message.requestId)) return;
        timer.cancel();
        reject(error);
        fault(record, error);
      });
    });

  const current = (target: WorkerTarget): MemberRecord => {
    const record = records.get(target.workerId);
    if (record === undefined || record.lifetimeId !== target.lifetimeId || record.version !== target.expectedVersion) throw new WorkerPoolError("WORKER_TARGET_STALE");
    return record;
  };
  const settlementOf = (record: MemberRecord) => record.exit?.settlement;
  const exitFact = (record: MemberRecord): WorkerExitFact => {
    if (record.exit === undefined || record.held !== undefined) throw new WorkerPoolError("WORKER_EXIT_UNOBSERVED");
    if (record.exit.settlement === "failed") throw new WorkerPoolError("WORKER_EXIT_SETTLEMENT_FAILED", { cause: record.settlementFailure });
    return record.exit;
  };

  return Object.freeze({
    snapshot(): readonly WorkerMemberView[] { return Object.freeze([...records.values()].map(view)); },

    async start(member: WorkerPoolMember): Promise<WorkerMemberView> {
      const exiting = records.get(member.workerId);
      // An observed exit stays reserved until its first settlement finishes; a failure stays the member's refusal.
      if (exiting?.state === "exited" && exiting.exit === undefined) {
        await exiting.settled;
        if (settlementOf(exiting) !== "settled") throw new WorkerPoolError("WORKER_EXIT_SETTLEMENT_FAILED", { cause: exiting.settlementFailure });
      }
      const prior = records.get(member.workerId);
      if (prior !== undefined && (prior.state !== "exited" || prior.settling)) throw new WorkerPoolError(prior.held === undefined ? "WORKER_ALREADY_RUNNING" : "WORKER_EXIT_UNOBSERVED");
      if (prior?.exit?.settlement === "failed") {
        prior.settling = true;
        try { await deps.settleExit(prior.member, prior.exit); prior.exit = { ...prior.exit, settlement: "settled" }; prior.settlementFailure = undefined; changed(prior); }
        catch (error) { prior.settlementFailure = error; prior.settling = false; throw new WorkerPoolError("WORKER_EXIT_SETTLEMENT_FAILED", { cause: error }); }
      }
      // A settled prior stays reserved until its replacement is published, so a start from onChange cannot spawn twice.
      let port: WorkerProcessPort;
      try { port = deps.spawn(member); }
      catch (error) { if (prior !== undefined) prior.settling = false; throw error; }
      let resolveExited!: () => void;
      const exited = new Promise<void>(resolve => { resolveExited = resolve; });
      let resolveSettled!: () => void;
      const settled = new Promise<void>(resolve => { resolveSettled = resolve; });
      const record: MemberRecord = { member, lifetimeId: deps.ids.uuid(), port, startedAt: at(), version: 0, state: "starting", directive: "run", settling: false,
        activity: undefined, browsers: new Map(), browserSystems: undefined, stopReason: undefined, failureCode: undefined, held: undefined, exit: undefined, settlementFailure: undefined,
        pending: new Map(), timers: [], stopping: undefined, exited, resolveExited, settled, resolveSettled, ready: undefined };
      records.set(member.workerId, record);
      const readiness = new Promise<Error | undefined>(resolve => { record.ready = resolve; });
      if (port.pid === undefined) {
        // Only a spawn the OS refused has no pid; that process never existed, so it claimed nothing.
        const failure = await new Promise<Error>(resolve => { port.onError(resolve); });
        cancelTimers(record);
        record.state = "exited";
        record.exit = { code: null, signal: null, at: at(), outcome: "crashed", settlement: "settled" };
        changed(record); record.resolveSettled(); record.resolveExited();
        throw new WorkerPoolError("WORKER_START_FAILED", { cause: failure });
      }
      port.onExit((code, signal) => { void onExit(record, code, signal); });
      port.onDisconnect(() => { if (record.state !== "exited") rejectPending(record, new WorkerPoolError("WORKER_EXITED")); });
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
      return await awaitReply(record, { kind: "worker-request", requestId: deps.ids.uuid(), sentAt: at(), deadlineMs, request }, deadlineMs);
    },

    async pause(target: WorkerTarget): Promise<WorkerMemberView> {
      const record = current(target);
      if (record.state !== "running") throw new WorkerPoolError(record.state === "exited" ? "WORKER_EXITED" : "WORKER_BUSY");
      await awaitReply(record, { kind: "worker-pause", requestId: deps.ids.uuid() }, timeouts.readyMs);
      return view(record);
    },

    async resume(target: WorkerTarget): Promise<WorkerMemberView> {
      const record = current(target);
      if (record.state !== "running") throw new WorkerPoolError(record.state === "exited" ? "WORKER_EXITED" : "WORKER_BUSY");
      await awaitReply(record, { kind: "worker-resume", requestId: deps.ids.uuid() }, timeouts.readyMs);
      return view(record);
    },

    /** Stops every member that has not exited, waits for any first exit settlement, and waits only within each member's bounded escalation. */
    async stopAll(reason: WorkerStopReason): Promise<readonly WorkerMemberView[]> {
      // Sweep until quiet: a Start that was waiting on a first settlement may publish a member mid-shutdown.
      for (;;) {
        const open = [...records.values()].filter(record => record.state === "exited" ? record.exit === undefined : record.held === undefined);
        if (open.length === 0) break;
        await Promise.all(open.map(record => record.state === "exited" ? record.settled : escalate(record, reason, false)));
      }
      return Object.freeze([...records.values()].map(view));
    },
  });
}
export type WorkerPool = ReturnType<typeof createWorkerPool>;

/** Refuses unless every member's exit was observed and settled; shutdown, logout and account switch require it. */
export function requireStoppedPool(views: readonly WorkerMemberView[]): void {
  const unobserved = views.filter(view => view.state !== "exited" || view.held !== undefined || view.exit === undefined);
  if (unobserved.length !== 0) throw new WorkerPoolError("WORKER_EXIT_UNOBSERVED", { cause: unobserved.map(view => ({ workerId: view.member.workerId, pid: view.pid })) });
  if (views.some(view => view.exit?.settlement === "failed")) throw new WorkerPoolError("WORKER_EXIT_SETTLEMENT_FAILED");
}
