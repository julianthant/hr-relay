import { Server } from "node:net";
import type { LogWriter } from "../../storage/events/log-writer.js";
import { WorkerLogMessageSchema, type WorkerLogAck } from "./worker-messages.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";

export class WorkerIpcProtocolError extends Error {
  readonly code = "WORKER_IPC_PROTOCOL_INVALID";
  constructor(readonly kind: string) { super(ERROR_CATALOG.WORKER_IPC_PROTOCOL_INVALID.text); this.name = "WorkerIpcProtocolError"; }
}

/** Either end of the parent/child pipe: a ChildProcess in the parent, `process` in the child. */
export interface IpcEndpoint {
  on(event: "message", listener: (message: unknown, handle: unknown) => void): unknown;
  off(event: "message", listener: (message: unknown, handle: unknown) => void): unknown;
  disconnect(): void;
}

export type IpcFamilyHandler = (message: Readonly<{ kind: string }>, handle: unknown) => void;

/**
 * The one `message` listener for a pipe end. A family is an exact kind or a prefix ending in "-";
 * a message no family owns is a protocol failure, while a family's own malformed message fails in its owner.
 */
export function createIpcRouter(endpoint: IpcEndpoint, onInvalid: (error: WorkerIpcProtocolError) => void) {
  const families = new Map<string, IpcFamilyHandler>();
  const owner = (kind: string): IpcFamilyHandler | undefined => families.get(kind)
    ?? [...families].find(([key]) => key.endsWith("-") && kind.startsWith(key))?.[1];
  const receive = (message: unknown, handle: unknown): void => {
    const kind = typeof message === "object" && message !== null && "kind" in message && typeof message.kind === "string" ? message.kind : undefined;
    const handler = kind === undefined ? undefined : owner(kind);
    if (kind === undefined || handler === undefined) {
      if (handle instanceof Server) handle.close();
      endpoint.disconnect();
      onInvalid(new WorkerIpcProtocolError(kind ?? "missing-kind"));
      return;
    }
    handler({ ...(message as Record<string, unknown>), kind }, handle);
  };
  endpoint.on("message", receive);
  return Object.freeze({
    register(family: string, handler: IpcFamilyHandler): void {
      if (families.has(family) || [...families.keys()].some(key => key.startsWith(family) || family.startsWith(key))) throw new Error("ipc-family-overlaps");
      families.set(family, handler);
    },
    close(): void { endpoint.off("message", receive); families.clear(); },
  });
}
export type IpcRouter = ReturnType<typeof createIpcRouter>;

export function createWorkerLogReceiver(writer: Pick<LogWriter, "publish" | "flush">, send: (reply: WorkerLogAck) => void, onFault: (error: unknown) => void) {
  let received = 0, committed = 0, replyScheduled = false, drained = false;
  return {
    receive(raw: unknown): void {
      const entry = WorkerLogMessageSchema.parse(raw);
      if (entry.kind === "worker-log-flush") {
        if (entry.throughSeq !== received) throw new Error("worker-log-flush-sequence-invalid");
        void writer.flush().then(() => {
          if (entry.final && received === entry.throughSeq) drained = true;
          send({ kind: "worker-log-flushed", requestId: entry.requestId, throughSeq: entry.throughSeq });
        }, onFault);
        return;
      }
      if (entry.seq !== received + 1) throw new Error("worker-log-sequence-gap");
      drained = false;
      received = entry.seq;
      writer.publish({ kind: "append", row: entry.row }, error => {
        if (error !== undefined) { onFault(error); return; }
        committed = entry.seq;
        if (replyScheduled) return;
        replyScheduled = true;
        queueMicrotask(() => {
          replyScheduled = false;
          send({ kind: "worker-log-ack", throughSeq: committed });
        });
      });
    },
    get drained() { return drained; },
  };
}
