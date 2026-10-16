/** The OCR form registry — what a form HAS, declared once, which is the reason three different producers can be trusted to return the same thing. */
import { z } from "zod";
import { CANONICAL_FIELDS, CanonicalFieldIdSchema, type CanonicalFieldId } from "../fields/registry.js";

export const OcrFormTypeSchema = z.enum(["oath", "emergency-contact", "i9"]);
export type OcrFormType = z.infer<typeof OcrFormTypeSchema>;

/** What a page turned out to BE, decided before any field was read; a scanned stack is mixed — operators feed it loose paper — so a misclassified page is refused rather than read. */
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
    /** Null canonical fields are form-local values with their own schema. */
  canonicalFieldId: CanonicalFieldIdSchema.nullable(),
  /** Form-local shape, required exactly when `canonicalFieldId` is null. */
  localKind: z.enum(["boolean", "text"]).nullable(),
    /** Mandatory unreadable fields block approval only on page kinds carrying the field. */
  mandatory: z.boolean(),
    /** Off-kind fields must be not-on-form; blank or illegible would claim a box exists. */
  onPageKinds: z.array(OcrPageKindSchema).min(1).nullable(),
});
export type OcrFieldSpec = z.infer<typeof OcrFieldSpecSchema>;

export const OcrFormSpecSchema = z.strictObject({
  formType: OcrFormTypeSchema,
  title: z.string().min(1),
    /** Classify/extract loose pages independently; subject pairing belongs to grouping. */
  pageKinds: z.array(OcrPageKindSchema).min(1),
  /** One paragraph of orientation, prepended to every generated instruction. */
  description: z.string().min(1),
    /** Share form-owned cross-field rules across every extraction route. */
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
      + "adjacent digits — 8↔9 and 3↔8 are the observed misreads (`10493848` reported when the paper "
      + "said `10493849`; `10493038` for `10493088`). Ignore stray marks and crossed-out characters; "
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

/** One UNIFORM record across both sections, as the prompt demanded: every record has the SAME fields, and which ones are filled depends on the page kind. */
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

/** Frozen at runtime while keeping the schema-derived static type: a second hand-written interface for "the same thing but readonly" would be a boundary shape with no schema. */
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

// Page kinds have one form owner so grouping cannot duplicate pages across runs.
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
