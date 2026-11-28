import { randomUUID } from "node:crypto";
import { ErrorCatalogCodeSchema, type ErrorCatalogCode } from "../../../models/failures/error-catalog.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import { WorkerLogChannelError, type LogMutation } from "../../storage/events/log-mutations.js";
import { WorkerLogAckSchema, WorkerParentMessageSchema, type WorkerActivity, type WorkerChildBrowserObservation, type WorkerChildMessage, type WorkerLogMessage,
  type WorkerControlRequest, type WorkerReplyOutcome, type WorkerStopReason } from "./worker-messages.js";
import { WorkerIpcProtocolError } from "./worker-ipc-router.js";

export interface WorkerChildControlHandlers {
  refreshBrowser(browserSessionId: string): Promise<JsonValue>;
  reopenBrowser(browserSessionId: string): Promise<JsonValue>;
  checkParkedWrite(command: JsonValue): Promise<JsonValue>;
  closeForRemoval(): Promise<JsonValue>;
  pause(): JsonValue;
  resume(): JsonValue;
}

const refused = (code: ErrorCatalogCode): WorkerReplyOutcome => ({ state: "refused", code, message: code });
const catalogCodeOf = (error: unknown): ErrorCatalogCode | undefined =>
  error instanceof Error && "code" in error ? ErrorCatalogCodeSchema.safeParse(error.code).data : undefined;

export function createWorkerLogChannel(onFailure?: (error: WorkerLogChannelError) => void) {
  type Append = Extract<WorkerLogMessage, { kind: "worker-log-append" }>;
  const retained = new Map<number, Append>();
  const barriers = new Map<string, { throughSeq: number; finish(error?: Error): void }>();
  let tail = 0, acknowledged = 0, send: ((message: WorkerLogMessage) => void) | undefined;
  const unsent: WorkerLogMessage[] = [];
  const sendOrQueue = (message: WorkerLogMessage) => { if (send === undefined) unsent.push(message); else send(message); };
  let failure: WorkerLogChannelError | undefined;
  const fail = (error: unknown) => {
    if (failure !== undefined) return;
    failure = error instanceof WorkerLogChannelError ? error : new WorkerLogChannelError(error);
    onFailure?.(failure);
    for (const barrier of barriers.values()) barrier.finish(failure);
    barriers.clear();
  };
  const flush = (final = false): Promise<void> => {
    if (failure !== undefined) return Promise.reject(failure);
    if (tail === acknowledged && !final) return Promise.resolve();
    const requestId = randomUUID(), throughSeq = tail;
    const barrier = Promise.withResolvers<void>();
    const timer = setTimeout(() => fail(new Error("worker-log-flush-deadline")), 5000);
    barriers.set(requestId, { throughSeq, finish(error) {
      clearTimeout(timer);
      if (error === undefined) barrier.resolve();
      else barrier.reject(error);
    } });
    sendOrQueue({ kind: "worker-log-flush", requestId, throughSeq, ...(final ? { final: true } : {}) });
    return barrier.promise;
  };
  return {
    publish: (mutation: LogMutation): void => {
      if (mutation.kind !== "append" || failure !== undefined) return;
      const seq = ++tail;
      const message: Append = { kind: "worker-log-append", seq, row: mutation.row };
      retained.set(seq, message);
      sendOrQueue(message);
    },
    attach(deliver: (message: WorkerLogMessage) => void): void {
      if (send !== undefined) throw new Error("worker-log-channel-already-attached");
      send = deliver;
      for (const message of unsent.splice(0)) send(message);
    },
    receive(input: unknown): void {
      const reply = WorkerLogAckSchema.parse(input);
      if (reply.throughSeq > tail || (reply.kind === "worker-log-ack" && reply.throughSeq < acknowledged)) {
        throw new Error("worker-log-acknowledgment-invalid");
      }
      for (const seq of retained.keys()) {
        if (seq > reply.throughSeq) break;
        retained.delete(seq);
      }
      acknowledged = Math.max(acknowledged, reply.throughSeq);
      if (reply.kind === "worker-log-flushed") {
        const barrier = barriers.get(reply.requestId);
        if (barrier?.throughSeq !== reply.throughSeq) throw new Error("worker-log-flush-acknowledgment-invalid");
        barriers.delete(reply.requestId);
        barrier.finish();
      }
    },
    flush: () => flush(),
    drain: () => flush(true),
    fail,
  };
}

/**
 * The child end of the worker family. Claims and controls share one turn: a control never starts while a run is
 * claimed or another control runs, and a run is never claimed while a control runs. Pause and resume are their own messages and take no turn.
 */
export function createWorkerChildChannel(input: Readonly<{
  send(message: WorkerChildMessage): void;
  clock: Clock;
  handlers: WorkerChildControlHandlers;
  onStop(reason: WorkerStopReason): void;
}>) {
  let turn: "free" | "run" | "control" | Readonly<{ removalReply: Extract<WorkerReplyOutcome, { state: "done" }> }> = "free";
  let lastRequestSequence = 0;
  let workAvailable = new AbortController();

  const run = async (request: WorkerControlRequest): Promise<JsonValue> => {
    switch (request.type) {
      case "refresh-browser": return await input.handlers.refreshBrowser(request.browserSessionId);
      case "reopen-browser": return await input.handlers.reopenBrowser(request.browserSessionId);
      case "check-parked-write": return await input.handlers.checkParkedWrite(request.command);
      case "close-for-removal": return await input.handlers.closeForRemoval();
    }
  };
  const outcomeOf = (error: unknown): WorkerReplyOutcome => refused(catalogCodeOf(error) ?? "INTERNAL_FAILURE");

  return Object.freeze({
    /** Throws `WorkerIpcProtocolError` for a malformed worker message; the caller exits the process. */
    receive(raw: unknown): void {
      const parsed = WorkerParentMessageSchema.safeParse(raw);
      if (!parsed.success) throw new WorkerIpcProtocolError(typeof raw === "object" && raw !== null && "kind" in raw ? String(raw.kind) : "invalid");
      const message = parsed.data;
      if (message.kind === "worker-stop") {
        input.onStop(message.reason);
        if (typeof turn === "object") workAvailable.abort();
        return;
      }
      if (message.kind === "worker-work-available") { workAvailable.abort(); return; }
      const reply = (outcome: WorkerReplyOutcome): void => { input.send({ kind: "worker-reply", requestId: message.requestId, outcome }); };
      if (message.sequence <= lastRequestSequence) { reply(refused("WORKER_IPC_PROTOCOL_INVALID")); return; }
      lastRequestSequence = message.sequence;
      if (message.kind === "worker-pause" || message.kind === "worker-resume") {
        let outcome: WorkerReplyOutcome;
        try { outcome = { state: "done", result: message.kind === "worker-pause" ? input.handlers.pause() : input.handlers.resume() }; }
        catch (error) { outcome = outcomeOf(error); }
        reply(outcome);
        if (message.kind === "worker-resume" && outcome.state === "done") workAvailable.abort();
        return;
      }
      if (input.clock.nowMs() >= Date.parse(message.sentAt) + message.deadlineMs) { reply(refused("WORKER_REQUEST_EXPIRED")); return; }
      if (typeof turn === "object" && message.request.type === "close-for-removal") { reply(turn.removalReply); return; }
      if (turn !== "free") { reply(refused("WORKER_BUSY")); return; }
      turn = "control";
      const settle = (outcome: WorkerReplyOutcome): void => {
        try { reply(outcome); }
        finally {
          // Keep the claim fence and the close acknowledgment if the parent timed out before receiving it.
          turn = message.request.type === "close-for-removal" && outcome.state === "done" ? { removalReply: outcome } : "free";
          workAvailable.abort();
        }
      };
      void run(message.request).then(result => settle({ state: "done", result }), error => settle(outcomeOf(error)));
    },
    /** Capture before claiming so a wake during an empty claim also interrupts the next idle wait. */
    watchForWork(): AbortSignal {
      if (workAvailable.signal.aborted) workAvailable = new AbortController();
      return workAvailable.signal;
    },
    /** The claim loop asks before each claim. A control or removal can hold the turn. */
    beginRun(): boolean {
      if (turn !== "free") return false;
      turn = "run";
      return true;
    },
    endRun(): void { if (turn === "run") turn = "free"; },
    ready(fact: Omit<Extract<WorkerChildMessage, { kind: "worker-ready" }>, "kind">): void { input.send({ kind: "worker-ready", ...fact }); },
    activity(activity: WorkerActivity): void { input.send({ kind: "worker-activity", activity }); },
    browser(observation: WorkerChildBrowserObservation): void { input.send({ kind: "worker-browser", observation }); },
    failed(error: unknown): void { const code = catalogCodeOf(error); if (code !== undefined) input.send({ kind: "worker-failed", code }); },
  });
}
export type WorkerChildChannel = ReturnType<typeof createWorkerChildChannel>;
