/**
 * Small shared server-side derivations. `deterministicUuid` folds a SHA-256
 * of a namespaced seed into RFC-4122 v5-style shape — the same technique as
 * `deriveItemId` — so wire records that require a UUID id (timeline events,
 * note pages) get a STABLE identity derived from what they identify, never a
 * fresh mint that would churn on every query.
 */
import { createHash } from "node:crypto";

export function deterministicUuid(seed: string): string {
  const digest = createHash("sha256").update("hrauto:server-derived-id:v1\0").update(seed).digest("hex");
  const variant = "89ab"[Number.parseInt(digest[16], 16) % 4];
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The NODE ID inside a task span's path (doc 03 §1.1: `<trace>/<node>#<attempt>`).
 *
 * It lives here rather than beside either of its two callers — the queue
 * projector and the run-detail query — because the ARCHIVE read path reaches
 * the query, and D179's whole claim is that an archived run renders with the
 * originating descriptor absent. Importing the projector's copy made the read
 * path value-reach `src/base/workflow.ts` through the projector's own
 * descriptor helpers, which `archive-invariants` correctly refused. One pure
 * string function, one home, no layer inversion.
 *
 * Returns `undefined` for a path that carries no `#attempt` marker — a span
 * whose path is not a node path is not a node, and guessing one from the last
 * segment would attribute work to a node that never ran.
 */
export function nodeIdOfTaskSpanPath(spanPath: string): string | undefined {
  const segment = spanPath.split("/").at(-1);
  if (segment === undefined || !segment.includes("#")) return undefined;
  return segment.slice(0, segment.lastIndexOf("#"));
}
