/** Immutable settlement evidence on the run. Envelope identity belongs to the enclosing row. */
import { z } from "zod";
import { FailureIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../../rules/identity/ids.js";
import { TerminalizationClaimSchema, type TerminalAuthorizationRecord } from "./terminal-authorization.js";
const Common = {
  schemaVersion: z.literal(1),
  expectedVersion: PositiveIntSchema,
  claim: TerminalizationClaimSchema,
  authorizedAt: IsoInstantSchema,
} as const;
export const RunCompletionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...Common, kind: z.literal("done"), resultDigest: FingerprintSchema }),
  z.strictObject({ ...Common, kind: z.literal("failed"), failureId: FailureIdSchema }),
]);
export type RunCompletion = z.infer<typeof RunCompletionSchema>;

export function completionFromAuthorization(authorization: TerminalAuthorizationRecord): RunCompletion {
  const { runId: _run, workflowId: _workflow, attempt: _attempt,
    descriptorVersion: _descriptor, contractFingerprint: _fingerprint, ...settlement } = authorization;
  return RunCompletionSchema.parse({ schemaVersion: 1, ...settlement });
}
