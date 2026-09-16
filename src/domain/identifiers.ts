/**
 * Fresh-identity minting, injected the same way time is (ref clock-config-secrets).
 *
 * `crypto.randomUUID()` is as untestable as `Date.now()` and for the same
 * reason: a value the caller cannot pin makes a durable record impossible to
 * assert against byte for byte. Every id a service mints comes from an injected
 * `IdFactory`, so a test drives the exact ids that land in authority and a
 * fixture stays a fixture.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Clock } from "./clock.js";
import { ItemIdSchema, TraceIdSchema } from "./ids.js";
import type { TraceId } from "./ids.js";
export { lifecycleCommandId } from "./lifecycle-command-id.js";

export interface IdFactory {
  /** A fresh RFC-4122 v4 UUID, in the lowercase form every branded id expects. */
  readonly uuid: () => string;
}

export const systemIdFactory: IdFactory = Object.freeze({
  uuid: () => randomUUID(),
});

/**
 * `<workflow-code>-<HHMMSS>-<runId4>` (ref dashboard-surfaces §1.1), frozen at enqueue and
 * never recomputed. The last group is the run id's own first four hex digits,
 * so a trace id read off a screen leads back to exactly one run rather than to
 * whatever was running at that second.
 */
export function deriveTraceId(code: string, runId: string, clock: Clock): TraceId {
  return TraceIdSchema.parse(`${code}-${clock.timeOfDayCode()}-${runId.slice(0, 4)}`);
}

/**
 * The logical item id, DERIVED rather than minted (ref workflow-model §5.7).
 *
 * `(workflow, itemId)` is the key retries share and a rerun-with-different-input
 * does not, so the id has to be a function of the identity the workflow itself
 * declares — its `matchKey`. Minting a fresh UUID per submission would make
 * every retry a new logical item and quietly orphan its checkpoints.
 *
 * The digest is folded into UUID shape so `ItemId` stays one id kind rather
 * than growing a second spelling.
 */
/**
 * A UUID-shaped id that is a pure function of what it names.
 *
 * Durable replay work cannot use `ids.uuid()` because a retry would mint a
 * different identity. Fold the caller's stable namespace and key instead so
 * the first attempt and every replay address the same record.
 */
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
