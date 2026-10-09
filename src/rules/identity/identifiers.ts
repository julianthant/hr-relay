/** Fresh-identity minting, injected the same way time is: a caller who cannot pin a value makes a durable record impossible to assert against, so every id comes from an injected factory. */
import { createHash, randomUUID } from "node:crypto";
import type { Clock } from "../time/clock.js";
import { ItemIdSchema, TraceIdSchema } from "./ids.js";
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

/** The logical item id, DERIVED from the workflow's own `matchKey` rather than minted, so retries share it and a rerun-with-different-input does not. */
/** A UUID-shaped id that is a pure function of what it names, so the first attempt and every replay address the same record. */
export function deriveStableUuid(namespace: string, key: string): string {
  const digest = createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(key)
    .digest("hex");
  const variant = "89ab"[Number.parseInt(digest[16], 16) % 4];
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export function deriveItemId(workflowId: string, matchKey: string): string {
  const digest = createHash("sha256")
    .update("hrauto:logical-item:v1\0")
    .update(workflowId)
    .update("\0")
    .update(matchKey)
    .digest("hex");
  const version = "5";
  const variant = "89ab"[Number.parseInt(digest[16], 16) % 4];
  return ItemIdSchema.parse([
    digest.slice(0, 8),
    digest.slice(8, 12),
    `${version}${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-"));
}
