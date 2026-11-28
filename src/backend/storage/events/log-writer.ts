import { Worker } from "node:worker_threads";
import { workerBootstrapEnvironment } from "../../../models/config/secrets.js";
import { workerExecArgv } from "../sqlite/backup-inspection-worker.js";
import { LogWriterReplySchema, type LogMutation, type LogWriterRequest } from "./log-mutations.js";

export function startLogWriter(input: { statePath: string; root: string; onFault(error: Error): void; maxWaitMs?: number }) {
  const worker = new Worker(new URL("./log-writer-thread.js", import.meta.url), {
    name: "relay-log-writer", execArgv: workerExecArgv(), env: workerBootstrapEnvironment(),
    workerData: { statePath: input.statePath, root: input.root, maxWaitMs: input.maxWaitMs ?? 250 },
  });
  const ready = Promise.withResolvers<void>();
  void ready.promise.catch(() => {});
  const exited = Promise.withResolvers<number>();
  const acknowledgments = new Map<number, { committed(): void; failed(error: Error): void }>();
  let sent = 0, through = 0, readySeen = false, failure: Error | undefined, closure: Promise<void> | undefined;
  const fail = (error: unknown) => {
    if (failure !== undefined) return;
    failure = new Error("log-writer-failed", { cause: error });
    ready.reject(failure);
    for (const pending of acknowledgments.values()) pending.failed(failure);
    acknowledgments.clear();
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
    flush: () => closure ?? request("flush"),
    reconcile: () => closure === undefined ? request("reconcile") : Promise.reject(new Error("log-writer-closing")),
    reportFault: (error: unknown): void => { fail(error); void worker.terminate(); },
    close: (): Promise<void> => {
      closure ??= (async () => {
        try { if (failure === undefined) await request("close"); }
        finally { await exited.promise; }
      })();
      return closure;
    },
  };
}

export type LogWriter = ReturnType<typeof startLogWriter>;
