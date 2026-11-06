import { ErrorCatalogCodeSchema, type ErrorCatalogCode } from "../../../models/failures/error-catalog.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import { WorkerParentMessageSchema, type WorkerActivity, type WorkerChildBrowserObservation, type WorkerChildMessage,
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
  let turn: "free" | "run" | "control" = "free";
  const seen = new Set<string>();

  const run = async (request: WorkerControlRequest): Promise<JsonValue> => {
    switch (request.type) {
      case "refresh-browser": return await input.handlers.refreshBrowser(request.browserSessionId);
      case "reopen-browser": return await input.handlers.reopenBrowser(request.browserSessionId);
      case "check-parked-write": return await input.handlers.checkParkedWrite(request.command);
      case "close-for-removal": return await input.handlers.closeForRemoval();
    }
  };
  const outcomeOf = (error: unknown): WorkerReplyOutcome => {
    const code = error instanceof Error && "code" in error ? ErrorCatalogCodeSchema.safeParse(error.code) : undefined;
    return refused(code?.success === true ? code.data : "INTERNAL_FAILURE");
  };

  return Object.freeze({
    /** Throws `WorkerIpcProtocolError` for a malformed worker message; the caller exits the process. */
    receive(raw: unknown): void {
      const parsed = WorkerParentMessageSchema.safeParse(raw);
      if (!parsed.success) throw new WorkerIpcProtocolError(typeof raw === "object" && raw !== null && "kind" in raw ? String(raw.kind) : "invalid");
      const message = parsed.data;
      if (message.kind === "worker-stop") { input.onStop(message.reason); return; }
      const reply = (outcome: WorkerReplyOutcome): void => { input.send({ kind: "worker-reply", requestId: message.requestId, outcome }); };
      if (seen.has(message.requestId)) { reply(refused("WORKER_IPC_PROTOCOL_INVALID")); return; }
      seen.add(message.requestId);
      if (message.kind === "worker-pause" || message.kind === "worker-resume") {
        reply({ state: "done", result: message.kind === "worker-pause" ? input.handlers.pause() : input.handlers.resume() });
        return;
      }
      if (input.clock.nowMs() >= Date.parse(message.sentAt) + message.deadlineMs) { reply(refused("WORKER_REQUEST_EXPIRED")); return; }
      if (turn !== "free") { reply(refused("WORKER_BUSY")); return; }
      turn = "control";
      void run(message.request).then(result => { reply({ state: "done", result }); }, error => { reply(outcomeOf(error)); })
        .finally(() => { turn = "free"; });
    },
    /** The claim loop asks before each claim; false while a control runs. */
    beginRun(): boolean {
      if (turn !== "free") return false;
      turn = "run";
      return true;
    },
    endRun(): void { if (turn === "run") turn = "free"; },
    ready(fact: Omit<Extract<WorkerChildMessage, { kind: "worker-ready" }>, "kind">): void { input.send({ kind: "worker-ready", ...fact }); },
    activity(activity: WorkerActivity): void { input.send({ kind: "worker-activity", activity }); },
    browser(observation: WorkerChildBrowserObservation): void { input.send({ kind: "worker-browser", observation }); },
  });
}
export type WorkerChildChannel = ReturnType<typeof createWorkerChildChannel>;
