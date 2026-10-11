import { z } from "zod";
import { SchemaBoundCanonicalValueSchema } from "../validation/schema-bound-value.js";
import { ProviderCapabilityIdSchema } from "../../rules/identity/ids.js";
import { IsoInstantSchema, RunIdSchema, PositiveIntSchema, NodeIdSchema, TaskIdSchema } from "../../rules/identity/ids.js";

export const ProviderUnavailableReasonSchema = z.strictObject({
  code: z.enum(["aborted", "timeout", "adapter-unavailable"]),
  message: z.string().min(1),
});
export const ProviderExecutionIdentitySchema = z.strictObject({
  runId: RunIdSchema, attempt: PositiveIntSchema, nodeId: NodeIdSchema, taskId: TaskIdSchema,
});
export const ProviderEvidenceSchema = z.strictObject({
  summary: z.string().min(1), providerRequestId: z.string().min(1).max(256).optional(), capturedAt: IsoInstantSchema,
});

export const ProviderRequestEnvelopeSchema = z.strictObject({
  capability: ProviderCapabilityIdSchema,
  payload: SchemaBoundCanonicalValueSchema,
});

export const ProviderResponseEnvelopeSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("produced"),
    value: SchemaBoundCanonicalValueSchema,
  }),
  z.strictObject({
    state: z.literal("unavailable"),
    reason: ProviderUnavailableReasonSchema,
  }),
  z.strictObject({
    state: z.literal("invalid-response"),
    reason: z.string().min(1),
  }),
]);

export const ProviderAdapterOutcomeSchema = z.strictObject({
  response: ProviderResponseEnvelopeSchema,
  evidence: ProviderEvidenceSchema,
});

export type ProviderRequestEnvelope = z.infer<typeof ProviderRequestEnvelopeSchema>;
export type ProviderResponseEnvelope = z.infer<typeof ProviderResponseEnvelopeSchema>;
export type ProviderAdapterOutcome = z.infer<typeof ProviderAdapterOutcomeSchema>;
