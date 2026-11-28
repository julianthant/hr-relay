import { Worker } from "node:worker_threads";
import { workerBootstrapEnvironment } from "../../../models/config/secrets.js";
import { TimelineDiagnosticBudgetError } from "../../../models/events/timeline.js";
import { workerExecArgv } from "../sqlite/backup-inspection-worker.js";
import { LogWriterReplySchema, type DebugTimelineAppend, type LogMutation, type LogWriterRequest } from "./log-mutations.js";

export function startLogWriter(input: { statePath: string; root: string; onFault(error: Error): void; maxWaitMs?: number }) {
  const worker = new Worker(new URL("./log-writer-thread.js", import.meta.url), {
    name: "relay-log-writer", execArgv: workerExecArgv(), env: workerBootstrapEnvironment(),
    workerData: { statePath: input.statePath, root: input.root, maxWaitMs: input.maxWaitMs ?? 250 },
  });
  const ready = Promise.withResolvers<void>();
  void ready.promise.catch(() => {});
  const exited = Promise.withResolvers<number>();
  const acknowledgments = new Map<number, { committed(): void; failed(error: Error): void }>();
  const debug = new Map<number, { record: DebugTimelineAppend; receipt: PromiseWithResolvers<"inserted" | "existing"> }>();
  let sent = 0, through = 0, readySeen = false, failure: Error | undefined, closure: Promise<void> | undefined;
  const fail = (error: unknown) => {
    if (failure !== undefined) return;
    failure = new Error("log-writer-failed", { cause: error });
    ready.reject(failure);
    for (const pending of acknowledgments.values()) pending.failed(failure);
    acknowledgments.clear();
    for (const { receipt } of debug.values()) receipt.reject(failure);
    debug.clear();
    input.onFault(failure);
  };
  worker.on("error", fail);
  worker.on("messageerror", error => { fail(error); void worker.terminate(); });
  worker.on("exit", code => {
    exited.resolve(code);
    if (closure === undefined || code !== 0 || !readySeen || through !== sent) fail(new Error("log-writer-exited-before-drain"));
  });
  worker.on("message", (raw: unknown) => {
    try {
      const reply = LogWriterReplySchema.parse(raw);
      if (reply.kind === "ready") {
        if (readySeen) throw new Error("log-writer-duplicate-ready");
        readySeen = true;
        ready.resolve();
        return;
      }
      if (!readySeen || reply.through <= through || reply.through > sent) throw new Error("log-writer-acknowledgment-invalid");
      const results = new Map(reply.debug.map(result => [result.sequence, result]));
      if (results.size !== reply.debug.length) throw new Error("log-writer-debug-acknowledgment-invalid");
      for (const [sequence, result] of results) {
        if (sequence > reply.through || debug.get(sequence)?.record.eventId !== result.eventId) {
          throw new Error("log-writer-debug-acknowledgment-invalid");
        }
      }
      for (const [sequence, { receipt }] of debug) {
        if (sequence > reply.through) break;
        const result = results.get(sequence)?.result;
        if (result === undefined) throw new Error("log-writer-debug-acknowledgment-missing");
        debug.delete(sequence);
        if (result === "inserted" || result === "existing") receipt.resolve(result);
        else receipt.reject(result === "budget-full" ? new TimelineDiagnosticBudgetError() : new Error(result));
      }
      through = reply.through;
      for (const [sequence, pending] of acknowledgments) {
        if (sequence > through) break;
        acknowledgments.delete(sequence);
        pending.committed();
      }
    } catch (error) {
      fail(error);
      void worker.terminate();
    }
  });
  const send = (request: LogWriterRequest) => {
    sent = request.sequence;
    try { worker.postMessage(request); }
    catch (error) { fail(error); void worker.terminate(); }
  };
  const request = (kind: "flush" | "reconcile" | "close"): Promise<void> => {
    if (failure !== undefined) return Promise.reject(failure);
    const result = Promise.withResolvers<void>(), sequence = sent + 1;
    acknowledgments.set(sequence, { committed: () => result.resolve(), failed: result.reject });
    send({ kind, sequence });
    return result.promise;
  };
  return {
    ready: ready.promise,
    publish: (mutation: LogMutation, acknowledged?: (error?: Error) => void): void => {
      if (failure !== undefined || closure !== undefined) {
        acknowledged?.(failure ?? new Error("log-writer-closing"));
        return;
      }
      const sequence = sent + 1;
      if (acknowledged !== undefined) acknowledgments.set(sequence, { committed: () => acknowledged(), failed: acknowledged });
      send({ kind: "append", sequence, mutation });
    },
    appendDebug: (record: DebugTimelineAppend): Promise<"inserted" | "existing"> => {
      if (failure !== undefined || closure !== undefined) return Promise.reject(failure ?? new Error("log-writer-closing"));
      const receipt = Promise.withResolvers<"inserted" | "existing">(), sequence = sent + 1;
      debug.set(sequence, { record, receipt });
      send({ kind: "append", sequence, mutation: { kind: "append-debug", record } });
      return receipt.promise;
    },
    flush: () => closure ?? request("flush"),
    reconcile: () => closure === undefined ? request("reconcile") : Promise.reject(new Error("log-writer-closing")),
    reportFault: (error: unknown): void => { fail(error); void worker.terminate(); },
    close: (): Promise<void> => {
      closure ??= (async () => {
        try { await request("close"); }
        finally { await exited.promise; }
        if (failure !== undefined) throw failure;
      })();
      return closure;
    },
  };
}

export type LogWriter = ReturnType<typeof startLogWriter>;
