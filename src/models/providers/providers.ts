import { z } from "zod";
import { SchemaBoundCanonicalValueSchema } from "../validation/schema-bound-value.js";
import { ProviderCapabilityIdSchema } from "../../rules/identity/ids.js";
import {
  ProviderMeasuredUsageSchema,
  ProviderUnavailableReasonSchema,
  RedactedProviderEvidenceSchema,
} from "../../rules/providers/provider-admission.js";

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
  usage: ProviderMeasuredUsageSchema,
  evidence: RedactedProviderEvidenceSchema,
});

export type ProviderRequestEnvelope = z.infer<typeof ProviderRequestEnvelopeSchema>;
export type ProviderResponseEnvelope = z.infer<typeof ProviderResponseEnvelopeSchema>;
export type ProviderAdapterOutcome = z.infer<typeof ProviderAdapterOutcomeSchema>;
