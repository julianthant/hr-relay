/** Contact normalization advice retains its rule/provider provenance for operator review. */
import { z } from "zod";
import { IsoInstantSchema, ProviderCapabilityIdSchema, taskId } from "../../../rules/identity/ids.js";
import { CanonicalRelationshipSchema, ContactFieldIdSchema, NormalizationRuleIdSchema } from "../../../rules/normalization/contact-rules.js";
import { GeocodeConfidenceSchema } from "../../../rules/normalization/geocode.js";
import { ProviderUnavailableReasonSchema } from "../../providers/providers.js";
import { DataClassificationSchema } from "../../../rules/redaction/redaction.js";
import { defineTaskContract } from "../../task/task-contract.js";

export { ContactFieldIdSchema } from "../../../rules/normalization/contact-rules.js";
export type { ContactFieldId } from "../../../rules/normalization/contact-rules.js";

/** Raw operator/OCR values; absent means the form did not carry the field. */
export const ContactFieldsInputSchema = z.strictObject({
  relationship: z.string().min(1).optional(),
  cellPhone: z.string().min(1).optional(),
  homePhone: z.string().min(1).optional(),
  address1: z.string().min(1).optional(),
  address2: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  postalCode: z.string().min(1).optional(),
  country: z.string().min(1).optional(),
});

/** `RedactedValueSchema` narrowed to what a contact field can produce: every contact value is a STRING, so the open `JsonValue` arm cannot put a decision-bearing record inside a contract boundary. */
export const RedactedContactValueSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("redacted"),
    classification: DataClassificationSchema,
    transform: z.literal("drop"),
  }),
  z.strictObject({
    state: z.literal("transformed"),
    classification: DataClassificationSchema,
    transform: z.enum(["digest", "last4", "basename", "count"]),
    value: z.union([z.string(), z.number().int().nonnegative()]),
  }),
  z.strictObject({
    state: z.literal("allowed"),
    classification: DataClassificationSchema,
    transform: z.literal("allow"),
    value: z.string(),
  }),
]);

export const NormalizationChangeSchema = z.strictObject({
  field: ContactFieldIdSchema,
  /** Redacted under the canonical field's own classification/transform. */
  before: RedactedContactValueSchema,
  after: z.string().min(1),
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("rule"), ruleId: NormalizationRuleIdSchema }),
    z.strictObject({
      kind: z.enum(["census", "nominatim"]),
      observedAt: IsoInstantSchema,
      confidence: GeocodeConfidenceSchema,
    }),
  ]),
});
export type NormalizationChange = z.infer<typeof NormalizationChangeSchema>;

export const ProviderFailureSchema = z.strictObject({
  capability: ProviderCapabilityIdSchema,
  reason: ProviderUnavailableReasonSchema,
});

export const NormalizeContactOutputSchema = z.strictObject({
  /** The advised end-state per field; untouched fields pass through. */
  normalized: ContactFieldsInputSchema,
  /** Relationship advice is typed, never free text. */
  relationshipCanonical: CanonicalRelationshipSchema.nullable(),
  changes: z.array(NormalizationChangeSchema),
  disposition: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("complete") }),
    z.strictObject({
      kind: z.literal("advisory-unavailable"),
      unavailable: z.array(ProviderFailureSchema).min(1),
    }),
    z.strictObject({
      kind: z.literal("ambiguous"),
      fields: z.array(ContactFieldIdSchema).min(1),
    }),
  ]),
});
export type NormalizeContactOutput = z.infer<typeof NormalizeContactOutputSchema>;

export const NormalizeContactInputSchema = z.strictObject({
  contact: ContactFieldsInputSchema,
  /** The caller's declared provider policy: no flag, no remote reads. */
  geocode: z.boolean(),
  /** When the contact is being read — replay resolves rules identically. */
  readAt: IsoInstantSchema,
});

/** The task READS a contact and returns advice, so the id says that rather than naming an illegal read verb. */
export const NormalizeContact = defineTaskContract({
  id: taskId("normalization/read-contact-advice"),
  title: "Normalizing contact",
  effect: "read",
  input: NormalizeContactInputSchema,
  output: NormalizeContactOutputSchema,
  errorCodes: ["empty-contact"],
  providers: ["geocode.census", "geocode.nominatim"] as const,
  subject: { kind: "none", reason: "pure per-record normalization advice resolves no person" },
  freshness: {
    // Provider-derived facts age; a day-old geocode observation must not ride
    // a resume into a write unexamined (ref data-intake-and-edit-data §4.2's finite budget).
    defaultMaxAgeMs: 24 * 60 * 60_000,
  },
  provenance: { default: "derived" },
  scenarios: [
    "normalization/contact/rule-only",
    "normalization/contact/census-advice",
    "normalization/contact/nominatim-fallback",
    "normalization/contact/advisory-unavailable",
    "normalization/contact/ambiguous",
  ],
  example: {
    normalized: { cellPhone: "8585551212", state: "CA", postalCode: "92093" },
    relationshipCanonical: null,
    changes: [{
      field: "state",
      before: { state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "california" },
      after: "CA",
      source: { kind: "rule", ruleId: "state-usps-code" },
    }],
    disposition: { kind: "complete" },
  },
});
