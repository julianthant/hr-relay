import { z } from "zod";
import { CANONICAL_FIELDS } from "../../fields/registry.js";
import { EidSchema, FingerprintSchema, IsoInstantSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

export const UcpathContactRelationshipSchema = z.enum([
  "Child", "Contact if Detained/Arrested", "Domestic Partner Adult", "Domestic Partner Child",
  "Emerg/Detention/Arrest Contact", "Friend", "Grand Parent", "Grandchild", "Medical Provider",
  "Neighbor", "Other", "Other Relative", "Parent", "Roommate", "Sibling", "Spouse", "Ward",
]);

export const UcpathContactAddressFieldsSchema = z.strictObject({
  address1: CANONICAL_FIELDS.address1.schema.nullable(),
  address2: CANONICAL_FIELDS.address2.schema.nullable(),
  city: CANONICAL_FIELDS.city.schema.nullable(),
  state: z.string().min(1).nullable(),
  postalCode: z.string().min(1).nullable(),
  country: CANONICAL_FIELDS.country.schema.nullable(),
});

export const UcpathContactAddressSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("unspecified") }),
  z.strictObject({ kind: z.literal("explicit"), fields: UcpathContactAddressFieldsSchema }),
  z.strictObject({ kind: z.literal("same-as-employee"), fields: UcpathContactAddressFieldsSchema }),
]);

export const UcpathEmergencyContactInputSchema = z.strictObject({
  emplId: EidSchema,
  expectedName: CANONICAL_FIELDS.fullName.schema,
  contact: z.strictObject({
    name: CANONICAL_FIELDS.fullName.schema,
    relationship: CANONICAL_FIELDS.relationship.schema,
    primary: z.boolean(),
    cellPhone: CANONICAL_FIELDS.cellPhone.schema.nullable(),
    homePhone: CANONICAL_FIELDS.homePhone.schema.nullable(),
    workPhone: CANONICAL_FIELDS.workPhone.schema.nullable(),
    address: UcpathContactAddressSchema,
  }),
});
export type UcpathEmergencyContactInput = z.infer<typeof UcpathEmergencyContactInputSchema>;

export const UcpathContactEffectSchema = z.strictObject({
  name: CANONICAL_FIELDS.fullName.schema,
  relationship: UcpathContactRelationshipSchema,
  primary: z.boolean(),
  phone: CANONICAL_FIELDS.cellPhone.schema.nullable(),
  address: UcpathContactAddressSchema,
});
export type UcpathContactEffect = z.infer<typeof UcpathContactEffectSchema>;
export function contactEffectIdentity(effect: UcpathContactEffect): string {
  return canonicalJsonStringify({ ...effect, name: effect.name.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US") });
}

export const UcpathContactRowSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("blank"), rowIndex: z.number().int().nonnegative(),
    primary: z.boolean(), sameAddressAsEmployee: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("contact"), rowIndex: z.number().int().nonnegative(), effect: UcpathContactEffectSchema,
  }),
]);
export type UcpathContactRow = z.infer<typeof UcpathContactRowSchema>;

export const UcpathContactSetSchema = z.strictObject({
  pageStateId: z.literal("ucpath.emergency-contact.editor-ready"),
  emplId: EidSchema,
  displayedName: CANONICAL_FIELDS.fullName.schema,
  observation: z.enum(["persisted", "staged"]),
  viewAll: z.enum(["already-complete", "expanded"]),
  rows: z.array(UcpathContactRowSchema).min(1),
  rowCount: z.number().int().positive(),
  observedAt: IsoInstantSchema,
}).superRefine((set, ctx) => {
  if (set.rowCount !== set.rows.length || set.rows.some((row, i) => row.rowIndex !== i)) {
    ctx.addIssue({ code: "custom", path: ["rows"], message: "contact rows must be complete and consecutively indexed" });
  }
});
export type UcpathContactSet = z.infer<typeof UcpathContactSetSchema>;

export const UcpathContactConflictCodeSchema = z.enum([
  "multiple-primary-contacts", "ambiguous-contact", "contact-conflict", "primary-change-required",
  "ambiguous-blank-rows",
]);

export const UcpathContactDecisionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("already-present"), rowIndex: z.number().int().nonnegative() }),
  z.strictObject({
    state: z.literal("conflict"), code: UcpathContactConflictCodeSchema,
    rowIndices: z.array(z.number().int().nonnegative()).min(1),
  }),
  z.strictObject({
    state: z.literal("add"), setFingerprint: FingerprintSchema,
    target: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("reuse-blank"), rowIndex: z.number().int().nonnegative() }),
      z.strictObject({ kind: z.literal("insert-row") }),
    ]),
    effect: UcpathContactEffectSchema,
  }),
]);
export type UcpathContactDecision = z.infer<typeof UcpathContactDecisionSchema>;

export const UcpathContactPlanSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("already-present"), before: UcpathContactSetSchema,
    setFingerprint: FingerprintSchema, effect: UcpathContactEffectSchema, rowIndex: z.number().int().nonnegative() }),
  z.strictObject({ state: z.literal("prepare"), before: UcpathContactSetSchema,
    setFingerprint: FingerprintSchema, effect: UcpathContactEffectSchema,
    demotion: z.strictObject({ rowIndex: z.number().int().nonnegative(), effect: UcpathContactEffectSchema }).nullable(),
    target: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("insert-row") }),
      z.strictObject({ kind: z.literal("reuse-blank"), rowIndex: z.number().int().nonnegative() })]),
  }),
]);
export type UcpathContactPlan = z.infer<typeof UcpathContactPlanSchema>;
export const UcpathContactWriteTargetSchema = UcpathEmergencyContactInputSchema.extend({ plan: UcpathContactPlanSchema });
export type UcpathContactWriteTarget = z.infer<typeof UcpathContactWriteTargetSchema>;
export const UcpathContactEffectProofSchema = z.strictObject({
  kind: z.literal("ucpath-emergency-contact"), emplId: EidSchema, displayedName: CANONICAL_FIELDS.fullName.schema,
  effect: UcpathContactEffectSchema, contacts: UcpathContactSetSchema,
  source: z.literal("complete-contact-set-read"),
}).superRefine((proof, context) => {
  if (proof.contacts.observation !== "persisted" || proof.contacts.emplId !== proof.emplId
    || proof.contacts.displayedName !== proof.displayedName
    || proof.contacts.rows.filter(row => row.kind === "contact" && contactEffectIdentity(row.effect) === contactEffectIdentity(proof.effect)).length !== 1
    || proof.contacts.rows.filter(row => row.kind === "contact" && row.effect.primary).length > 1) {
    context.addIssue({ code: "custom", message: "A contact proof requires one complete persisted exact effect for its subject" });
  }
});
export type UcpathContactEffectProof = z.infer<typeof UcpathContactEffectProofSchema>;

export const UCPATH_CONTACT_REFUSAL_CODES = [
  "unexpected-contact-page", "contact-identity-unreadable", "contact-subject-mismatch",
  "contact-name-mismatch", "contact-set-incomplete", "unreadable-contact-row",
  "relationship-unmapped", "address-choice-unresolved", "contact-set-changed",
  "contact-plan-refused", "blank-row-unavailable", "contact-name-lost", "staged-effect-mismatch",
] as const;
export const UcpathContactRefusalCodeSchema = z.enum(UCPATH_CONTACT_REFUSAL_CODES);
export type UcpathContactRefusalCode = z.infer<typeof UcpathContactRefusalCodeSchema>;

export class UcpathContactRefusedError extends Error {
  constructor(readonly code: UcpathContactRefusalCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "UcpathContactRefusedError";
  }
}
