/** Request authorization for a terminal run settlement, preserving the exact pre-terminal CAS and claim so a later replay cannot substitute a stale one. */
import { z } from "zod";
import {
  FailureIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  RunIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";

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
