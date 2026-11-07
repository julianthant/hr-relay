import { CommandRequestSchema, type CommandRequest, type ParkedWriteCheckAcknowledgement } from "../../../rules/commands/commands.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import { WorkerControlRefusal } from "../../../models/run/worker-control.js";
import type { WorkerChildControlHandlers } from "./worker-child-channel.js";
import type { WorkerSessionManager } from "./worker-sessions.js";

/** The child's answers to parent requests; the channel runs them only between runs, one at a time. */
export function createWorkerChildControls(input: Readonly<{
  sessions(): WorkerSessionManager;
  signal: AbortSignal;
  checkParkedWrite?: (sessions: WorkerSessionManager, request: Extract<CommandRequest, { type: "check-parked-write" }>) => Promise<ParkedWriteCheckAcknowledgement>;
  pause(): JsonValue;
  resume(): JsonValue;
}>): WorkerChildControlHandlers {
  const browser = async (type: "refresh-browser" | "reopen-browser", browserSessionId: string): Promise<JsonValue> => {
    const sessions = input.sessions();
    sessions.assertControlTarget(browserSessionId);
    return { browserSessionId: (await sessions.controlBrowser(type, browserSessionId, input.signal)).sessionId };
  };
  return Object.freeze({
    refreshBrowser: (browserSessionId: string) => browser("refresh-browser", browserSessionId),
    reopenBrowser: (browserSessionId: string) => browser("reopen-browser", browserSessionId),
    async checkParkedWrite(command: JsonValue): Promise<JsonValue> {
      const request = CommandRequestSchema.parse(command);
      if (request.type !== "check-parked-write" || input.checkParkedWrite === undefined) throw new WorkerControlRefusal("PARKED_CHECK_UNAVAILABLE");
      return structuredClone(await input.checkParkedWrite(input.sessions(), request));
    },
    async closeForRemoval(): Promise<JsonValue> {
      await input.sessions().closeAll("worker-stop");
      return { closed: true };
    },
    pause: input.pause,
    resume: input.resume,
  });
}
