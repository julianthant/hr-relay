/**
 * Request authorization for a terminal run settlement. The run completion preserves the
 * exact pre-terminal CAS and claim so a later replay cannot substitute a stale
 * or unrelated authorization after the run has dropped its live claim fields.
 */
import { z } from "zod";
import {
  FailureIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  RunIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../ids.js";

export const TerminalizationClaimSchema = z.strictObject({
  workerId: WorkerIdSchema,
  claimGeneration: PositiveIntSchema,
});

const TerminalAuthorizationIdentity = {
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  attempt: PositiveIntSchema,
  descriptorVersion: PositiveIntSchema,
  contractFingerprint: FingerprintSchema,
  expectedVersion: PositiveIntSchema,
  claim: TerminalizationClaimSchema,
  authorizedAt: IsoInstantSchema,
} as const;

export const FailureTerminalAuthorizationRecordSchema = z.strictObject({
  kind: z.literal("failed"),
  ...TerminalAuthorizationIdentity,
  failureId: FailureIdSchema,
});

export const SuccessTerminalAuthorizationRecordSchema = z.strictObject({
  kind: z.literal("done"),
  ...TerminalAuthorizationIdentity,
  resultDigest: FingerprintSchema,
});

export const TerminalAuthorizationRecordSchema = z.discriminatedUnion("kind", [
  FailureTerminalAuthorizationRecordSchema,
  SuccessTerminalAuthorizationRecordSchema,
]);

export type FailureTerminalAuthorizationRecord = z.infer<typeof FailureTerminalAuthorizationRecordSchema>;
export type SuccessTerminalAuthorizationRecord = z.infer<typeof SuccessTerminalAuthorizationRecordSchema>;
export type TerminalAuthorizationRecord = z.infer<typeof TerminalAuthorizationRecordSchema>;
