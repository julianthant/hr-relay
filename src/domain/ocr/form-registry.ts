/**
 * The OCR form registry — what a form HAS, declared once.
 *
 * This file is the reason three different producers can be trusted to return
 * the same thing. An extraction may be performed by a provider model, by an
 * agent the operator runs in their terminal, or by the operator themselves; all
 * three are told what to extract by an instruction GENERATED from this
 * registry, and all three are admitted by one function that checks the result
 * against this same registry. There is no second list to drift.
 *
 * ## Every declared field must be answered — absence is a value
 *
 * A field is never "optional and missing". A producer must return, for every
 * declared field, either a value or a typed reason it has none:
 * `not-on-form`, `blank`, or `illegible`. That is what makes "nobody skips
 * anything" mechanical rather than aspirational — a result that omits a field
 * fails to parse, and a result that quietly returned `null` for a field the
 * form clearly shows has to say WHICH kind of nothing it saw.
 *
 * Legacy could not make this promise. Its OCR record schemas were built from
 * `.nullable().optional()` fields, so "the model did not look" and "the form is
 * blank" were the same value, and `originallyMissing` was reconstructed
 * afterwards by comparing snapshots.
 *
 * ## A form field binds to a canonical field where one exists
 *
 * The canonical registry (doc 06 §1) already owns coercion, schema and
 * redaction for `eid`, `fullName`, `cellPhone` and the rest. An OCR field names
 * the canonical field it produces, so an extracted EID is validated by exactly
 * the schema an intake column would be — one definition, two sources.
 */
import { z } from "zod";
import { CANONICAL_FIELDS, CanonicalFieldIdSchema, type CanonicalFieldId } from "../fields/registry.js";

export const OcrFormTypeSchema = z.enum(["oath", "emergency-contact"]);
export type OcrFormType = z.infer<typeof OcrFormTypeSchema>;

/** A dotted path inside one extracted record. Same grammar as an intake target. */
export const OcrFieldPathSchema = z.string().regex(
  /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/,
  "an OCR field path must be dotted camelCase",
);
export type OcrFieldPath = z.infer<typeof OcrFieldPathSchema>;

export const OcrFieldSpecSchema = z.strictObject({
  path: OcrFieldPathSchema,
  /** What the producer is told to look for. Reaches every route verbatim. */
  prompt: z.string().min(1),
  /**
   * The canonical field this produces, when one exists. `null` means the value
   * is form-local (a checkbox, a page ordinal) and carries its own schema.
   */
  canonicalFieldId: CanonicalFieldIdSchema.nullable(),
  /** Form-local shape, required exactly when `canonicalFieldId` is null. */
  localKind: z.enum(["boolean", "text"]).nullable(),
  /**
   * Whether a HUMAN must resolve an unanswered field before the record may be
   * used. A mandatory field that came back `illegible` blocks approval; an
   * advisory one is surfaced and may be accepted (doc 12's evidence rule).
   */
  mandatory: z.boolean(),
});
export type OcrFieldSpec = z.infer<typeof OcrFieldSpecSchema>;

export const OcrFormSpecSchema = z.strictObject({
  formType: OcrFormTypeSchema,
  title: z.string().min(1),
  /** One paragraph of orientation, prepended to every generated instruction. */
  description: z.string().min(1),
  fields: z.array(OcrFieldSpecSchema).min(1),
});
export type OcrFormSpec = z.infer<typeof OcrFormSpecSchema>;

function field(
  path: string,
  prompt: string,
  canonicalFieldId: CanonicalFieldId | null,
  options: { localKind?: "boolean" | "text"; mandatory?: boolean } = {},
): z.input<typeof OcrFieldSpecSchema> {
  return {
    path,
    prompt,
    canonicalFieldId,
    localKind: canonicalFieldId === null ? options.localKind ?? "text" : null,
    mandatory: options.mandatory ?? false,
  };
}

const OATH: z.input<typeof OcrFormSpecSchema> = {
  formType: "oath",
  title: "Oath / Patent Policy signature roster",
  description:
    "A printed roster page. Each ROW is one employee who signed the oath. Read one row at a time and "
    + "report every declared field for that row, even when the cell is empty.",
  fields: [
    field("printedName", "The employee's printed name exactly as written, including any comma form.", "fullName", { mandatory: true }),
    field("employeeId", "The UCPath employee ID beside the name — eight digits beginning 10.", "eid"),
    field("signatureDate", "The date written beside the signature.", "signatureDate"),
    field("employeeSigned", "Whether the employee's signature box contains a signature.", null, { localKind: "boolean", mandatory: true }),
    field("officerSigned", "Whether the officer/witness signature box contains a signature.", null, { localKind: "boolean", mandatory: true }),
  ],
};

const EMERGENCY_CONTACT: z.input<typeof OcrFormSpecSchema> = {
  formType: "emergency-contact",
  title: "Emergency contact form",
  description:
    "A single-employee form in two halves: the EMPLOYEE's own details, and the EMERGENCY CONTACT they "
    + "named. Keep the two halves separate — a phone number in the contact half is the contact's, never "
    + "the employee's. Report every declared field for both halves.",
  fields: [
    field("employee.name", "The employee's printed name.", "fullName", { mandatory: true }),
    field("employee.employeeId", "The employee's UCPath ID — eight digits beginning 10.", "eid"),
    field("employee.pid", "The employee's UCSD PID, if the form shows one.", "pid"),
    field("employee.homePhone", "The employee's home telephone number.", "homePhone"),
    field("employee.cellPhone", "The employee's mobile telephone number.", "cellPhone"),
    field("employee.address1", "The employee's street address line.", "address1"),
    field("employee.city", "The employee's city.", "city"),
    field("employee.state", "The employee's state.", "state"),
    field("employee.postalCode", "The employee's ZIP code.", "postalCode"),
    field("contact.name", "The EMERGENCY CONTACT's printed name.", "fullName", { mandatory: true }),
    field("contact.relationship", "How the emergency contact is related to the employee.", "relationship", { mandatory: true }),
    field("contact.cellPhone", "The emergency contact's mobile telephone number.", "cellPhone"),
    field("contact.homePhone", "The emergency contact's home telephone number.", "homePhone"),
    field("contact.workPhone", "The emergency contact's work telephone number.", "workPhone"),
    field("contact.address1", "The emergency contact's street address line, if given.", "address1"),
    field("contact.city", "The emergency contact's city, if given.", "city"),
    field("contact.state", "The emergency contact's state, if given.", "state"),
    field("contact.postalCode", "The emergency contact's ZIP code, if given.", "postalCode"),
  ],
};

/**
 * Frozen at runtime while keeping the schema-derived static type: a second
 * hand-written interface for "the same thing but readonly" would be a boundary
 * shape with no schema, which is exactly what this tree refuses.
 */
function sealForm(input: z.input<typeof OcrFormSpecSchema>): OcrFormSpec {
  const spec = OcrFormSpecSchema.parse(input);
  const paths = spec.fields.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) throw new Error(`${spec.formType} declares a field path twice`);
  for (const entry of spec.fields) {
    if (entry.canonicalFieldId !== null && entry.localKind !== null) {
      throw new Error(`${spec.formType}.${entry.path} cannot be both canonical and form-local`);
    }
    if (entry.canonicalFieldId === null && entry.localKind === null) {
      throw new Error(`${spec.formType}.${entry.path} must declare a canonical field or a local kind`);
    }
    if (entry.canonicalFieldId !== null && CANONICAL_FIELDS[entry.canonicalFieldId] === undefined) {
      throw new Error(`${spec.formType}.${entry.path} names unknown canonical field ${entry.canonicalFieldId}`);
    }
  }
  for (const entry of spec.fields) Object.freeze(entry);
  Object.freeze(spec.fields);
  return Object.freeze(spec);
}

export const OCR_FORMS: Readonly<Record<OcrFormType, OcrFormSpec>> = Object.freeze({
  oath: sealForm(OATH),
  "emergency-contact": sealForm(EMERGENCY_CONTACT),
});

export const OCR_FORM_TYPES: readonly OcrFormType[] = Object.freeze(OcrFormTypeSchema.options);

export function ocrForm(formType: OcrFormType): OcrFormSpec {
  return OCR_FORMS[formType];
}

/** Every declared path for a form, sorted — the completeness rule's input. */
export function declaredPaths(formType: OcrFormType): readonly OcrFieldPath[] {
  return OCR_FORMS[formType].fields.map(({ path }) => path).toSorted((left, right) => left.localeCompare(right));
}
