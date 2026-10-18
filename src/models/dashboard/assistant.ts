import { z } from "zod";

const ReferenceSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u);
export const AssistantSubjectSchema = z.strictObject({
  subjectRef: ReferenceSchema, displayName: z.string().min(1).max(160), employeeId: z.string().regex(/^\d{8}$/u).optional(),
});
export type AssistantSubject = z.infer<typeof AssistantSubjectSchema>;
export const AssistantCitationSchema = z.strictObject({
  path: z.string().min(1).max(200), revision: z.string().regex(/^[a-f0-9]{40}$/u),
  startLine: z.number().int().positive(), endLine: z.number().int().positive(), quote: z.string().min(1).max(4000),
});
export const AssistantTurnSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("answer"), text: z.string().min(1).max(8000), citations: z.array(AssistantCitationSchema).max(8) }),
  z.strictObject({ action: z.literal("read-subjects"), query: z.string().min(1).max(120) }),
  z.strictObject({ action: z.literal("propose"), workflowId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u), intent: z.literal("dry-run") }),
]);
export type AssistantTurn = z.infer<typeof AssistantTurnSchema>;
export const AssistantInferenceRequestSchema = z.strictObject({
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u), input: z.string().min(1).max(80_000),
});
export type AssistantInferenceRequest = z.infer<typeof AssistantInferenceRequestSchema>;
export const AssistantRequestSchema = z.strictObject({
  message: z.string().min(1).max(4000), subjectRef: ReferenceSchema.optional(),
});
export type AssistantRequest = z.infer<typeof AssistantRequestSchema>;
export const ASSISTANT_FAILURES = Object.freeze({
  ASSISTANT_INVALID: "The assistant request or response was invalid.",
  ASSISTANT_CONTEXT_UNAVAILABLE: "Verified public source context is unavailable.",
  ASSISTANT_CONTEXT_STALE: "The public source context does not match this runtime.",
  ASSISTANT_MODEL_UNVERIFIED: "The assistant model and ChatGPT plan permission need verification.",
  ASSISTANT_USAGE_LIMIT: "The ChatGPT plan usage limit was reached.",
  ASSISTANT_PLAN_DISABLED: "Enable ChatGPT plan usage before using the assistant.",
  ASSISTANT_ACCOUNT_EXPIRED: "Reconnect the ChatGPT account before using the assistant.",
  ASSISTANT_UNAVAILABLE: "The assistant is unavailable. Check the ChatGPT connection.",
  ASSISTANT_CANCELLED: "The assistant request was cancelled.",
  ASSISTANT_LIMIT: "The assistant reached its request limit.",
  ASSISTANT_SUBJECT_REQUIRED: "Select an unambiguous subject before preparing a proposal.",
  ASSISTANT_PROPOSAL_REFUSED: "The current planner refused this proposal. Review it in Run.",
});
export type AssistantFailureCode = keyof typeof ASSISTANT_FAILURES;
export const AssistantProposalSchema = z.strictObject({
  workflowId: z.string(), subject: AssistantSubjectSchema, intent: z.literal("dry-run"),
  descriptorVersion: z.number().int().positive(), descriptorFingerprint: z.string(), configSnapshotId: z.string(),
  configFingerprint: z.string(), inputFingerprint: z.string(), optionsFingerprint: z.string(),
  expiresAt: z.string().datetime(), stopBefore: z.strictObject({ nodeId: z.string().min(1), phase: z.literal("commit"),
    afterPrepareTaskId: z.string().min(1), commitTaskId: z.string().min(1) }),
  effects: z.strictObject({ workflowExecuted: z.literal(false), transactionCommitted: z.literal(false) }), confirmation: z.literal("required-in-run"),
});
export const AssistantResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("answered"), text: z.string().max(8000), citations: z.array(AssistantCitationSchema).max(8) }),
  z.strictObject({ state: z.literal("proposal"), proposal: AssistantProposalSchema }),
  z.strictObject({ state: z.literal("resolution-required"), candidates: z.array(AssistantSubjectSchema).max(20) }),
  z.strictObject({ state: z.literal("refused"), code: z.enum(Object.keys(ASSISTANT_FAILURES) as [AssistantFailureCode, ...AssistantFailureCode[]]), message: z.string() }),
]);
export type AssistantResult = z.infer<typeof AssistantResultSchema>;
