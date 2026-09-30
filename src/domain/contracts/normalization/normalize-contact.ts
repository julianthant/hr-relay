/**
 * `normalization/normalize-contact` — ref data-intake-and-edit-data §4.2's typed-advice contract.
 *
 * Legacy's `normalize-contact.ts` mixed deterministic cleanup, geocoder
 * fallback, and LLM inference, and a provider failure collapsed to `null` —
 * indistinguishable from "nothing needed changing." This contract makes
 * every arm distinct: deterministic rules run first and each change names
 * its rule id; geocoder advice is individually observed with its instant;
 * provider exhaustion is the `advisory-unavailable` disposition, never an
 * empty change list; and a field the rules cannot decide is `ambiguous` for
 * the operator — never a guess. Nothing here APPLIES advice: the review
 * gate shows before/after/source, and accepted changes become operator-
 * correction provenance (ref data-intake-and-edit-data §4.2).
 *
 * As-built deviations from the §4.2 sketch, recorded under D165 and D178:
 * - the `ai` source arm landed at D178 behind its own `ai` input flag, and it
 *   is NARROWER than legacy's LLM fallback by construction: a field may be
 *   asked about only when its canonical classification permits the `allow`
 *   transform, so `relationship` (`sensitive-hr`) is never sent and stays
 *   `ambiguous` for the operator — the declared classification decides, not
 *   the usefulness of the answer;
 * - `before` uses the canonical field's OWN classification/redaction
 *   transform (`redactValue`), so a durable checkpoint never carries a raw
 *   direct-identifier address line;
 * - the provider policy is the input's `geocode` flag plus the declared
 *   census-before-nominatim order pinned by this contract's scenarios — the
 *   caller opts into geocode advice, the task owns the sequencing.
 */
import { z } from "zod";
import {
  AiModelIdSchema,
  AiProviderIdSchema,
  IsoInstantSchema,
  ProviderCapabilityIdSchema,
  taskId,
} from "../../ids.js";
import {
  CanonicalRelationshipSchema,
  ContactFieldIdSchema,
  NormalizationRuleIdSchema,
} from "../../normalization/contact-rules.js";
import { GeocodeConfidenceSchema } from "../../normalization/geocode.js";
import { ProviderUnavailableReasonSchema } from "../../provider-admission.js";
import { DataClassificationSchema } from "../../redaction.js";
import { defineTaskContract } from "../base.js";

export { ContactFieldIdSchema } from "../../normalization/contact-rules.js";
export type { ContactFieldId } from "../../normalization/contact-rules.js";

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

/**
 * `RedactedValueSchema` narrowed to what a contact field can produce: every
 * contact value is a STRING, so the allowed/transformed arms carry string
 * (or count) values — the open `JsonValue` arm would put a decision-bearing
 * record inside a contract boundary. The TRANSFORMS still come from the one
 * `redactValue` implementation; only the boundary narrows.
 */
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
    /**
     * D178 unparks the `ai` arm ref data-intake-and-edit-data §4.2 sketched. `confidence` is the
     * MODEL's own number and is labelled as such on the review gate — it is
     * not a verdict, and an ai-sourced change can never be auto-applied.
     */
    z.strictObject({
      kind: z.literal("ai"),
      provider: AiProviderIdSchema,
      model: AiModelIdSchema,
      confidence: z.number().min(0).max(1),
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
  /**
   * The second declared provider policy (D178): ask an `ai.advisory` provider
   * about the fields the deterministic rules could not decide. It is separate
   * from `geocode` because the two spend different budgets against different
   * remote systems, and a caller that wants address verification has not
   * thereby consented to a model reading the record.
   */
  ai: z.boolean(),
  /** When the contact is being read — replay resolves rules identically. */
  readAt: IsoInstantSchema,
});

/**
 * Ref data-intake-and-edit-data §4.2 sketches the id as `normalization/normalize-contact`, but
 * "normalize" is not a legal read verb (ref task-contract's grammar) — the same defect
 * D149 fixed for `extraction/parse-csv`. The task READS a contact and
 * returns advice, so the id says that.
 */
export const NormalizeContact = defineTaskContract({
  id: taskId("normalization/read-contact-advice"),
  title: "Normalizing contact",
  effect: "read",
  input: NormalizeContactInputSchema,
  output: NormalizeContactOutputSchema,
  errorCodes: ["empty-contact"],
  providers: ["geocode.census", "geocode.nominatim", "ai.advisory"] as const,
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
    "normalization/contact/ai-advice",
    "normalization/contact/ai-complete-classified-field",
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
