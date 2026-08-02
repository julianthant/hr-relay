/**
 * Fresh-identity minting, injected the same way time is (doc 11).
 *
 * `crypto.randomUUID()` is as untestable as `Date.now()` and for the same
 * reason: a value the caller cannot pin makes a durable record impossible to
 * assert against byte for byte. Every id a service mints comes from an injected
 * `IdFactory`, so a test drives the exact ids that land in authority and a
 * fixture stays a fixture.
 */
import { randomUUID } from "node:crypto";
import type { Clock } from "./clock.js";
import { TraceIdSchema } from "./ids.js";
import type { TraceId } from "./ids.js";

export interface IdFactory {
  /** A fresh RFC-4122 v4 UUID, in the lowercase form every branded id expects. */
  readonly uuid: () => string;
}

export const systemIdFactory: IdFactory = Object.freeze({
  uuid: () => randomUUID(),
});

/**
 * `<workflow-code>-<HHMMSS>-<runId4>` (doc 03 §1.1), frozen at enqueue and
 * never recomputed. The last group is the run id's own first four hex digits,
 * so a trace id read off a screen leads back to exactly one run rather than to
 * whatever was running at that second.
 */
export function deriveTraceId(code: string, runId: string, clock: Clock): TraceId {
  return TraceIdSchema.parse(`${code}-${clock.timeOfDayCode()}-${runId.slice(0, 4)}`);
}
