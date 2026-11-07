import type { WorkerMemberView, WorkerProcessPort } from "../../../../src/backend/runtime/workers/worker-pool.js";
import { workerPoolMember, type WorkerSlotRecord } from "../../../../src/models/run/worker-slot.js";
import type { WorkerControlRequest, WorkerParentMessage, WorkerReplyOutcome } from "../../../../src/backend/runtime/workers/worker-messages.js";
import type { WorkerSpawnRequest } from "../../../../src/backend/app/composition/dashboard/worker-process.js";

export interface ScriptedWorkerBehavior {
  /** Sends `worker-ready` on the next turn after spawn. */
  readonly ready: boolean;
  /** Exits with code 0 on `worker-stop`. */
  readonly exitOnStop: boolean;
  readonly reply: (request: WorkerControlRequest) => WorkerReplyOutcome;
}

/** A child process that speaks the worker IPC protocol in-process; tests drive exits and crashes by hand. */
export class ScriptedWorkerChild implements WorkerProcessPort {
  readonly sent: WorkerParentMessage[] = [];
  readonly kills: (string | undefined)[] = [];
  readonly workerId: string;
  #exit: ((code: number | null, signal: string | null) => void) | undefined;
  #message: ((message: unknown) => void) | undefined;
  #exited = false;

  constructor(readonly pid: number | undefined, readonly request: WorkerSpawnRequest, private readonly behavior: ScriptedWorkerBehavior) {
    this.workerId = argValue(request.args, "--worker-id");
    if (behavior.ready) setImmediate(() => { this.ready(); });
  }

  get exited(): boolean { return this.#exited; }

  send(message: WorkerParentMessage, callback: (error: Error | null) => void): void {
    this.sent.push(message);
    callback(null);
    setImmediate(() => {
      if (this.#exited) return;
      if (message.kind === "worker-stop") { if (this.behavior.exitOnStop) this.exit(0, null); }
      else if (message.kind === "worker-pause" || message.kind === "worker-resume") {
        this.emit({ kind: "worker-reply", requestId: message.requestId, outcome: { state: "done", result: { directive: message.kind === "worker-pause" ? "pause" : "run" } } });
      } else this.emit({ kind: "worker-reply", requestId: message.requestId, outcome: this.behavior.reply(message.request) });
    });
  }

  kill(signal: "SIGTERM" | "SIGKILL" | undefined): boolean {
    this.kills.push(signal);
    if (signal !== "SIGTERM") setImmediate(() => { this.exit(null, signal ?? "SIGKILL"); });
    return true;
  }

  disconnect(): void {}
  onDisconnect(): void {}
  onError(): void {}
  onExit(listener: (code: number | null, signal: string | null) => void): void { this.#exit = listener; }
  onWorkerMessage(listener: (message: unknown) => void): void { this.#message = listener; }

  ready(overrides: Readonly<Record<string, unknown>> = {}): void {
    this.emit({ kind: "worker-ready", workerId: this.workerId, pid: this.pid, profileId: argValue(this.request.args, "--profile-id"),
      sessionGeneration: Number(argValue(this.request.args, "--session-generation")), browserSystems: [], activity: { state: "idle" }, ...overrides });
  }

  emit(message: unknown): void { this.#message?.(message); }

  /** The OS exit event; a crash is any exit the parent did not ask for. */
  exit(code: number | null, signal: string | null): void {
    if (this.#exited) return;
    this.#exited = true;
    this.#exit?.(code, signal);
  }
}

export function argValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined) throw new Error(`worker spawn args carry no ${flag}`);
  return value;
}

export function scriptedWorkerSpawner(children: ScriptedWorkerChild[], behavior: Partial<ScriptedWorkerBehavior> = {}, firstPid = 6000) {
  let pid = firstPid;
  const resolved: ScriptedWorkerBehavior = { ready: true, exitOnStop: true, reply: () => ({ state: "done", result: null }), ...behavior };
  return (request: WorkerSpawnRequest): ScriptedWorkerChild => {
    const child = new ScriptedWorkerChild(pid += 1, request, resolved);
    children.push(child);
    return child;
  };
}

/** A pool member view for a slot whose process the fixture treats as running in this process. */
export function runningWorkerView(slot: WorkerSlotRecord, input: Partial<WorkerMemberView> = {}): WorkerMemberView {
  return { member: workerPoolMember(slot), lifetimeId: "aaaaaaaa-0001-4000-8000-000100000000", version: 0, state: "running", directive: slot.paused ? "pause" : "run",
    pid: process.pid, startedAt: slot.createdAt, activity: { state: "idle" }, browsers: [], exit: undefined, held: undefined, ...input };
}
