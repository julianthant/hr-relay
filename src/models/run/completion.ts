/** Immutable settlement evidence on the run. Envelope identity belongs to the enclosing row. */
import { z } from "zod";
import { FailureIdSchema, FingerprintSchema, IsoInstantSchema, PositiveIntSchema } from "../../rules/identity/ids.js";
import { TerminalizationClaimSchema, type TerminalAuthorizationRecord } from "./terminal-authorization.js";
import { HistoricalTerminalAuthorizationSchema, HistoricalTerminalOutboxRecordSchema } from "./completion-history.js";

const HistoricalCompletionEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(40),
  authorizationJson: z.string().min(1),
  outboxJson: z.string().min(1).optional(),
}).superRefine((evidence, context) => {
  try {
    const authorization = HistoricalTerminalAuthorizationSchema.parse(JSON.parse(evidence.authorizationJson));
    if (authorization.kind === "done") {
      const outbox = HistoricalTerminalOutboxRecordSchema.parse(JSON.parse(evidence.outboxJson ?? "null"));
      if (outbox.outboxId !== authorization.outboxId || outbox.payload.runId !== authorization.runId
        || outbox.payload.workflowId !== authorization.workflowId || outbox.payload.attempt !== authorization.attempt
        || outbox.payload.resultDigest !== authorization.resultDigest) throw new Error("historical receipt mismatch");
    } else if (evidence.outboxJson !== undefined) throw new Error("failure cannot have a success receipt");
  } catch {
    context.addIssue({ code: "custom", message: "invalid historical completion evidence" });
  }
});

const Common = {
  schemaVersion: z.literal(1),
  expectedVersion: PositiveIntSchema,
  claim: TerminalizationClaimSchema,
  authorizedAt: IsoInstantSchema,
  historical: HistoricalCompletionEvidenceSchema.optional(),
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
