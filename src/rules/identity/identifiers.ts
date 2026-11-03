/** Fresh-identity minting, injected the same way time is: a caller who cannot pin a value makes a durable record impossible to assert against, so every id comes from an injected factory. */
import { randomUUID } from "node:crypto";
import type { Clock } from "../time/clock.js";
import { TraceIdSchema } from "./ids.js";
import type { TraceId } from "./ids.js";
export { lifecycleCommandId } from "../commands/lifecycle-command-id.js";

export interface IdFactory {
  /** A fresh RFC-4122 v4 UUID, in the lowercase form every branded id expects. */
  readonly uuid: () => string;
}

export const systemIdFactory: IdFactory = Object.freeze({
  uuid: () => randomUUID(),
});

/** `<workflow-code>-<HHMMSS>-<runId4>`, frozen at enqueue and never recomputed; the last group is the run id's own first four hex digits. */
export function deriveTraceId(code: string, runId: string, clock: Clock): TraceId {
  return TraceIdSchema.parse(`${code}-${clock.timeOfDayCode()}-${runId.slice(0, 4)}`);
}

export { deriveStableUuid } from "./stable-uuid.js";
export { deriveItemId } from "./logical-item.js";
