import { canonicalJsonStringify } from "../../../../domain/canonical-json.js";
import { sha256Hex } from "../../../../domain/sha256.js";
import type { VersionChange } from "../../../../domain/archive/change-record.js";
import type { CommandRequest } from "../../../../domain/commands.js";
import { FingerprintSchema, IsoInstantSchema, SourceSurfaceIdSchema } from "../../../../domain/ids.js";

type Apply = Extract<CommandRequest, { type: "apply-version-bump" }>;

/** The immutable proposal ID binds the public review without hashing private source values.
 * Membership changes create a replacement proposal; private source checks remain in the kernel.
 */
export function publicVersionReviewFingerprint(row: Pick<VersionChange, "changeId">): string {
  return sha256Hex(canonicalJsonStringify(["archive-version-review:v1", row.changeId]));
}

/** Reconstruct only an envelope authenticated by the existing durable claim.
 * Missing identity or unrepresented optional fields cannot be inferred.
 */
export function authenticatedVersionApplyRequest(row: VersionChange) {
  const application = row.application;
  if (application === undefined) return undefined;
  for (const source of ["dashboard", "archive"] as const) {
    const request = { commandId: application.commandId, requestedAt: application.startedAt, requestedBy: application.actorId,
      source, family: "version-archive" as const, type: "apply-version-bump" as const,
      target: { versionPlanId: row.changeId, expectedVersion: 1 }, payload: { planFingerprint: row.reviewFingerprint } };
    if (sha256Hex(canonicalJsonStringify(request)) === application.requestFingerprint) return request;
  }
  return undefined;
}

/** Translate the served binding before the kernel sees or journals the command.
 * Stored proposals, private fingerprints and previously accepted envelopes are unchanged.
 */
export function bindVersionApplyRequest(row: VersionChange, request: Apply): Apply | undefined {
  if (request.target.versionPlanId !== row.changeId || request.payload.planFingerprint !== publicVersionReviewFingerprint(row)) return undefined;
  const bound = { ...request, payload: { planFingerprint: FingerprintSchema.parse(row.reviewFingerprint) } };
  const application = row.application;
  if (application?.commandId === request.commandId) {
    // BFF ingress owns provenance. Recover its already accepted timestamp/source
    // only when the complete caller intent still authenticates that exact claim.
    for (const source of ["dashboard", "archive"] as const) {
      const resumed = { ...bound, requestedAt: IsoInstantSchema.parse(application.startedAt), source: SourceSurfaceIdSchema.parse(source) };
      if (sha256Hex(canonicalJsonStringify(resumed)) === application.requestFingerprint) return resumed;
    }
  }
  return bound;
}
