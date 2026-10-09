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
 * The canonical registry (ref data-intake-and-edit-data §1) already owns coercion, schema and
 * redaction for `eid`, `fullName`, `cellPhone` and the rest. An OCR field names
 * the canonical field it produces, so an extracted EID is validated by exactly
 * the schema an intake column would be — one definition, two sources.
 */
import { z } from "zod";
import { CANONICAL_FIELDS, CanonicalFieldIdSchema, type CanonicalFieldId } from "../fields/registry.js";

export const OcrFormTypeSchema = z.enum(["oath", "emergency-contact", "i9"]);
export type OcrFormType = z.infer<typeof OcrFormTypeSchema>;

/**
 * What a page turned out to BE, decided before any field is read.
 *
 * A scanned stack is mixed — operators feed it loose paper — so without this a
 * producer handed an emergency-contact page during an oath run has two bad
 * options: invent oath answers, or fail the page. Neither is true.
 *
 * The vocabulary is derived from the real corpus at
 * `hr-automation/data/documents`, not guessed:
 *
 * - `oath` — a UC State Oath of Allegiance, UPAY 585 or 586. One person.
 * - `emergency-contact` — a UCSD HDH Emergency Contact form. One person.
 * - `i9-section1` / `i9-section2` — the only two data-bearing pages of a
 *   NINE-page I-9 packet, and they are separated here because a scanned stack
 *   carries them loose: in the corpus, page 1 of `i9.pdf` is a Section 2 for one
 *   person and page 2 is a Section 1 for a DIFFERENT one. Pairing them is a
 *   grouping problem above this gate, not something a page can answer.
 * - `boilerplate` — a printed page of a real form that carries no data: the
 *   I-9 instructions and Lists of Acceptable Documents (seven of every nine
 *   pages in a packet), an oath's pre-printed legal text overflow.
 * - `unrelated` — a real document that is not one of these forms at all; the
 *   corpus has a Kronos sick-hours report sitting in the same folder.
 * - `blank` — a separator or an empty scan.
 *
 * `boilerplate`, `unrelated` and `blank` are kept apart on purpose. All three
 * mean "no data here", but only `unrelated` means the operator put something in
 * the stack that does not belong, and only `blank` might mean the scanner
 * double-fed.
 */
export const OcrPageKindSchema = z.enum([
  "oath",
  "emergency-contact",
  "i9-section1",
  "i9-section2",
  "boilerplate",
  "unrelated",
  "blank",
]);
export type OcrPageKind = z.infer<typeof OcrPageKindSchema>;

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
   * advisory one is surfaced and may be accepted (ref operator-trust's evidence rule).
   * Blocking applies only on the page kinds that carry the field.
   */
  mandatory: z.boolean(),
  /**
   * The page kinds this field's box exists on, or `null` for every data page
   * of the form. Non-null only on a sectioned form: an I-9's date of birth is
   * a Section 1 box, so on a Section 2 page the only truthful answer is
   * `not-on-form` — and the gate can REFUSE a value claimed to be read from a
   * box the page does not have, which is a value from nowhere.
   */
  onPageKinds: z.array(OcrPageKindSchema).min(1).nullable(),
});
export type OcrFieldSpec = z.infer<typeof OcrFieldSpecSchema>;

export const OcrFormSpecSchema = z.strictObject({
  formType: OcrFormTypeSchema,
  title: z.string().min(1),
  /**
   * The data-bearing page kinds of this form. One kind for a one-page form;
   * the I-9 spans two, because a scanned stack carries its Section 1 and
   * Section 2 loose and each is classified — and extracted — on its own.
   * Pairing them into one subject is grouping's job, above the gate.
   */
  pageKinds: z.array(OcrPageKindSchema).min(1),
  /** One paragraph of orientation, prepended to every generated instruction. */
  description: z.string().min(1),
  /**
   * Cross-field rules that reach every route verbatim — digit-accuracy
   * warnings, address handling, what NOT to infer. These are the parts of
   * legacy's prompts that were learned from real misreads, and they belong with
   * the form rather than in one route's prompt string.
   */
  extractionNotes: z.array(z.string().min(1)),
  fields: z.array(OcrFieldSpecSchema).min(1),
});
export type OcrFormSpec = z.infer<typeof OcrFormSpecSchema>;

function field(
  path: string,
  prompt: string,
  canonicalFieldId: CanonicalFieldId | null,
  options: { localKind?: "boolean" | "text"; mandatory?: boolean; on?: readonly OcrPageKind[] } = {},
): z.input<typeof OcrFieldSpecSchema> {
  return {
    path,
    prompt,
    canonicalFieldId,
    localKind: canonicalFieldId === null ? options.localKind ?? "text" : null,
    mandatory: options.mandatory ?? false,
    onPageKinds: options.on === undefined ? null : [...options.on],
  };
}

const OATH: z.input<typeof OcrFormSpecSchema> = {
  formType: "oath",
  pageKinds: ["oath"],
  title: "Oath / Patent Policy signature roster",
  description:
    "A UC State Oath of Allegiance / Patent Policy form (UPAY 585 or UPAY 586) — ONE person per "
    + "page. The employee's name is written at the top; the oath itself is pre-printed boilerplate "
    + "and carries no data. The lower block records who administered the oath and when.",
  extractionNotes: [
    "The EMPLOYEE ID box is very often BLANK on a real oath — that is `blank`, and it is normal, "
      + "not a reading failure. Do not fill it from the DEPARTMENT number printed beside it.",
    "When an employee id IS present it is exactly eight digits beginning `10`. Copy every digit and "
      + "do NOT drop the leading `10`. Check the top margin and any handwritten note outside the "
      + "printed box before reporting it absent.",
    "A signed-but-unwitnessed oath is a real and common state: the employee has signed, while the "
      + "date, the authorized official's signature, the title and the county are all still blank. "
      + "Report each of those as `blank`. Do NOT infer that the oath was administered.",
    "Transcribe a handwritten name letter by letter; read it aloud to yourself. Faint or awkward "
      + "writing is still `read` — `illegible` means you genuinely cannot make it out, and `blank` "
      + "means there is no writing at all.",
  ],
  fields: [
    field("printedName", "The employee's name from the EMPLOYEE'S NAME box at the top, exactly as written (usually `Last, First, Middle`).", "fullName", { mandatory: true }),
    field("employeeId", "The EMPLOYEE ID box under the name. Frequently blank on a real form.", "eid"),
    field("signatureDate", "The date beside `Taken and subscribed before me on`, exactly as written — `11/3/21` and `4-23-26` are both normal. Blank when the oath has not been administered yet.", "signatureDate"),
    field("employeeSigned", "Whether the `Signature of Officer or Employee` line holds any writing or scribble. An empty line is `no`, not absent.", null, { localKind: "boolean", mandatory: true }),
    field("officerSigned", "Whether the `Signature of Authorized Official` line is filled. Commonly empty on a form the employee signed but nobody has witnessed.", null, { localKind: "boolean", mandatory: true }),
  ],
};

const EMERGENCY_CONTACT: z.input<typeof OcrFormSpecSchema> = {
  formType: "emergency-contact",
  pageKinds: ["emergency-contact"],
  title: "Emergency contact form",
  description:
    "A UCSD R&R Emergency Contact Information form — ONE person per page, in two halves: the "
    + "EMPLOYEE's own details, and the EMERGENCY CONTACT they named. Keep the halves separate: a "
    + "phone number in the contact half is the contact's, never the employee's.",
  extractionNotes: [
    "Employee ID digits are read one at a time. Eight digits beginning `10`. Do NOT transpose "
      + "adjacent digits — 8↔9 and 3↔8 are the observed misreads (`10843962` reported when the paper "
      + "said `10002337`; `10983978` for `10002339`). Ignore stray marks and crossed-out characters; "
      + "read the final intended digits.",
    "Transcribe names letter by letter — do not drop or swap letters (`Sharaf`, not `Shaaf`; "
      + "`Cecillia`, not `Cecilia`). If only a first name is written for the contact, report exactly "
      + "that; never invent a surname.",
    "NEVER skip the contact's address because it resembles the employee's — report what is written in "
      + "the Emergency Contact address field. A blank contact address is `blank`; it does NOT mean "
      + "`same as the employee`, which is computed later from what you report.",
    "Include unit and mailstop prefixes in the street line (`0918, 3939 Miramar Street`, `Apt 5328`, "
      + "`H309`). A contact address may be foreign; report the parts that separate and leave the rest "
      + "`not-on-form` rather than forcing them into US fields.",
  ],
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
 * Ported from `legacy:src/services/ocr/forms/i9.ts` at `4deabc5a` (D160). One
 * UNIFORM record across both sections, as legacy's prompt demanded ("Every
 * record has the SAME fields; which ones are filled depends on the page kind")
 * — here the section-absent fields are typed `not-on-form` instead of a `null`
 * that also meant blank and illegible. The extraction notes are legacy's
 * accuracy rule, learned from real misreads: live 2026-07-13 a degraded scan
 * produced a confident-looking fabricated SSN and DOB (page 51 read
 * `02/28/1972` + `950-75-2168` off illegible paper), searched UCPath, and
 * returned a false "not found" — which is indistinguishable from "this person
 * does not work here". Legacy's "never round a 2-digit year" note is
 * deliberately NOT ported: `raw` is reported verbatim here and D155 resolves
 * the century against the observation instant, by documented rule.
 *
 * Legacy's `"i9 ssn"` supplemental sheet (a UCRS 419 statement) has no page
 * kind here on purpose: D154 derives the vocabulary from the real corpus, and
 * the corpus has none. Such a sheet classifies as `unrelated` today — surfaced
 * to the operator by name rather than silently folded into a record.
 */
const I9: z.input<typeof OcrFormSpecSchema> = {
  formType: "i9",
  pageKinds: ["i9-section1", "i9-section2"],
  title: "Form I-9 employment eligibility verification",
  description:
    "A USCIS Form I-9. Only two of a packet's nine pages carry data, and a scanned stack carries "
    + "them LOOSE: a Section 1 (Employee Information and Attestation — the employee's own name, "
    + "date of birth and U.S. Social Security Number) or a Section 2 (Employer Review and "
    + "Verification — the employee's name re-written at the top, the documents examined under "
    + "Lists A/B/C, and the first day of employment). ONE person per page; the two sections of one "
    + "person are usually NOT adjacent. Classify which section this page is, then read it.",
  extractionNotes: [
    "These values search a real HR system, and a single wrong DIGIT does not produce a wrong "
      + "answer — it produces NO answer, which is indistinguishable from `this person does not work "
      + "here`. A guess is therefore WORSE than an admission. For the SSN and the date of birth: "
      + "transcribe ONLY digits you can actually SEE; if ANY digit is smudged, cut off, overwritten "
      + "or ambiguous, report the WHOLE field `illegible`. An `illegible` costs the operator one "
      + "manual check; a wrong digit silently reports a real employee as a stranger.",
    "Handwritten digits in boxed fields are commonly confused: 0/6, 9/4, 8/9, 1/7, 3/5. If you are "
      + "choosing between two digits, you are NOT confident — that field is `illegible`.",
    "Transcribe the WHOLE name: do not drop a trailing letter (`Kimi` is not `Kim`) and do not drop "
      + "a compound surname (`Torres Perez` is not `Perez`). On a Section 2 page the employee's name "
      + "is the `Employee Last Name, First Name and Middle Initial from Section 1` line at the TOP — "
      + "NEVER the employer or authorized representative's own name from the Certification block.",
    "On a Section 2 page the Document Number under LIST C is the employee's SSN ONLY when the List "
      + "C document's title mentions Social Security. Any other List C document (a birth "
      + "certificate, for example) is NOT an SSN — report `ssn` as `not-on-form` on such a page. "
      + "When the employer used a LIST A document and the List C column is entirely empty — the "
      + "common case on the real scans — report `ssn` as `blank`: the box exists and holds nothing.",
    "Do NOT confuse the date of birth with the employee's signature date or with the first day of "
      + "employment — they sit near each other and all three are handwritten dates.",
  ],
  fields: [
    field("lastName", "The employee's LAST name (family name) as THIS page writes it. Section 1: the `Last Name (Family Name)` box. Section 2: the employee-name line at the top of the sheet.", "lastName", { mandatory: true }),
    field("firstName", "The employee's FIRST name (given name), from the same per-section source as the last name.", "firstName", { mandatory: true }),
    field("middleInitial", "The employee's middle initial, from the same per-section source as the last name. A single letter; very often blank.", "middleInitial"),
    field("dateOfBirth", "Section 1's `Date of Birth (mm/dd/yyyy)` box, exactly as printed.", "dob", { on: ["i9-section1"] }),
    field("ssn", "The SSN THIS page carries. Section 1: the `U.S. Social Security Number` box; blank or masked is `blank`, never a partial number. Section 2: the List C Document Number, only when List C is a Social Security card.", "ssn"),
    field("hireDate", "Section 2's `The employee's first day of employment (mm/dd/yyyy)`, from the Certification block.", "hireDate", { on: ["i9-section2"] }),
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
  if (new Set(spec.pageKinds).size !== spec.pageKinds.length) {
    throw new Error(`${spec.formType} declares a page kind twice`);
  }
  for (const kind of spec.pageKinds) {
    // A data-bearing kind must be able to carry a record; the three no-data
    // kinds are shared vocabulary no form may claim.
    if (kind === "boilerplate" || kind === "unrelated" || kind === "blank") {
      throw new Error(`${spec.formType} claims the no-data page kind ${kind}`);
    }
  }
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
    if (entry.onPageKinds !== null) {
      for (const kind of entry.onPageKinds) {
        if (!spec.pageKinds.includes(kind)) {
          throw new Error(`${spec.formType}.${entry.path} claims page kind ${kind}, which the form does not declare`);
        }
      }
      if (entry.onPageKinds.length === spec.pageKinds.length) {
        // Two spellings of "on every page" would make the generated brief
        // annotate one and not the other.
        throw new Error(`${spec.formType}.${entry.path} lists every page kind; declare null instead`);
      }
    }
  }
  for (const entry of spec.fields) Object.freeze(entry);
  Object.freeze(spec.fields);
  return Object.freeze(spec);
}

export const OCR_FORMS: Readonly<Record<OcrFormType, OcrFormSpec>> = Object.freeze({
  oath: sealForm(OATH),
  "emergency-contact": sealForm(EMERGENCY_CONTACT),
  i9: sealForm(I9),
});

export const OCR_FORM_TYPES: readonly OcrFormType[] = Object.freeze(OcrFormTypeSchema.options);

// A page kind names exactly one form's page, or grouping could put one page in
// two runs. Checked over the sealed registry so a new form cannot land claiming
// an owned kind.
{
  const owners = new Map<OcrPageKind, OcrFormType>();
  for (const formType of OCR_FORM_TYPES) {
    for (const kind of OCR_FORMS[formType].pageKinds) {
      const owner = owners.get(kind);
      if (owner !== undefined) {
        throw new Error(`page kind ${kind} is claimed by both ${owner} and ${formType}`);
      }
      owners.set(kind, formType);
    }
  }
}

export function ocrForm(formType: OcrFormType): OcrFormSpec {
  return OCR_FORMS[formType];
}

/** Whether this field's box exists on a page of the given kind. */
export function fieldOnPageKind(field: OcrFieldSpec, pageKind: OcrPageKind): boolean {
  return field.onPageKinds === null || field.onPageKinds.includes(pageKind);
}

/** Every declared path for a form, sorted — the completeness rule's input. */
export function declaredPaths(formType: OcrFormType): readonly OcrFieldPath[] {
  return OCR_FORMS[formType].fields.map(({ path }) => path).toSorted((left, right) => left.localeCompare(right));
}
