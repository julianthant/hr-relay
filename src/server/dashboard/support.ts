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
