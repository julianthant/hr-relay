import { z } from "zod";
import { SchemaBoundCanonicalValueSchema } from "./schema-bound-value.js";
import { ProviderCapabilityIdSchema } from "./ids.js";

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
    reason: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("invalid-response"),
    reason: z.string().min(1),
  }),
]);

export type ProviderRequestEnvelope = z.infer<typeof ProviderRequestEnvelopeSchema>;
export type ProviderResponseEnvelope = z.infer<typeof ProviderResponseEnvelopeSchema>;
