/** The canonical field registry: the closed vocabulary an operator can bind a spreadsheet column to, one entry per fact a workflow can be about. */
import { z } from "zod";
import { DateOnlySchema, EidSchema, IntakeTargetFieldIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";
import { DataClassificationSchema, EvidenceTransformSchema, evidenceTransformAllowed } from "../../rules/redaction/redaction.js";
import {
  CellCoercionError,
  collapseWhitespace,
  displayPersonName,
  normalizeEidDigits,
  normalizePhoneDigits,
  parseUsOrIsoDate,
  parseUsStateCode,
  type CellLocation,
} from "./cell-coercion.js";

export const CanonicalFieldIdSchema = z.enum([
  // Identity
  "eid",
  "ppsEid",
  "pid",
  "ssn",
  "dob",
  "fullName",
  "firstName",
  "lastName",
  "middleName",
  "middleInitial",
  "livedName",
  "suffix",
  // Contact
  "email",
  "workEmail",
  "personalEmail",
  "cellPhone",
  "homePhone",
  "workPhone",
  "address1",
  "address2",
  "city",
  "state",
  "postalCode",
  "country",
  "relationship",
  // Organization / employment
  "deptId",
  "department",
  "departmentCode",
  "jobTitle",
  "jobCode",
  "jobDescription",
  "positionNumber",
  "appointment",
  "recruitmentNumber",
  "workLocation",
  "supervisor",
  "viceChancellor",
  "viceChancellorCode",
  "employeeStatus",
  // Dates
  "effectiveDate",
  "hireDate",
  "separationDate",
  "lastDayWorked",
  "signatureDate",
  // Document / transaction
  "kualiDocId",
  "terminationType",
  "transactionNumber",
]);
export type CanonicalFieldId = z.infer<typeof CanonicalFieldIdSchema>;

/** How much evidence stands behind this field's schema: `resolved` is pinned by a reviewed decision or live verification, and each level names who decided. */
export const CanonicalFieldEvidenceSchema = z.enum(["resolved", "audit-at-migration"]);
export type CanonicalFieldEvidence = z.infer<typeof CanonicalFieldEvidenceSchema>;

export interface CanonicalField<S extends z.ZodType = z.ZodType> {
  readonly id: CanonicalFieldId;
  readonly label: string;
  /** THE schema. A workflow input field composes from this exact object. */
  readonly schema: S;
    /* One raw cell → a pre-parse value; throws naming the row, column and value, never substituting a default. */
  readonly coerce: (raw: string, location: CellLocation) => unknown;
  /** Header hints for the SUGGESTION engine only — never auto-applied (§2.5). */
  readonly aliases: readonly string[];
  /** Canonical sample values powering the grid preview and the scorer. */
  readonly examples: readonly string[];
  readonly classification: z.infer<typeof DataClassificationSchema>;
  /** The widest transform this field's value may take in a durable manifest. */
  readonly redactTransform: z.infer<typeof EvidenceTransformSchema>;
  readonly evidence: CanonicalFieldEvidence;
  /** Why the shape is conservative; required when `evidence` is not resolved. */
  readonly auditNote?: string;
}

const FACTORY_DEFINED_FIELDS = new WeakSet<CanonicalField>();

/** Seal one canonical field, refusing a declaration that cannot hold; every check here is one a broken registry would otherwise pass silently. */
export function defineCanonicalField<S extends z.ZodType>(spec: {
  id: CanonicalFieldId;
  label: string;
  schema: S;
  coerce: (raw: string, location: CellLocation) => unknown;
  aliases: readonly string[];
  examples: readonly string[];
  classification: z.infer<typeof DataClassificationSchema>;
  redactTransform: z.infer<typeof EvidenceTransformSchema>;
  evidence: CanonicalFieldEvidence;
  auditNote?: string;
}): CanonicalField<S> {
  CanonicalFieldIdSchema.parse(spec.id);
  DataClassificationSchema.parse(spec.classification);
  EvidenceTransformSchema.parse(spec.redactTransform);
  if (spec.label.trim().length === 0) throw new Error(`canonical field ${spec.id} needs a label`);
  if (!evidenceTransformAllowed(spec.classification, spec.redactTransform)) {
    throw new Error(
      `canonical field ${spec.id} declares transform ${spec.redactTransform}, forbidden for ${spec.classification}`,
    );
  }
  if (spec.evidence === "audit-at-migration" && (spec.auditNote ?? "").trim().length === 0) {
    throw new Error(`canonical field ${spec.id} defers its shape and must say why in auditNote`);
  }
  if (spec.evidence === "resolved" && spec.auditNote !== undefined) {
    throw new Error(`canonical field ${spec.id} is resolved and must not carry an auditNote`);
  }
  if (spec.aliases.length === 0) throw new Error(`canonical field ${spec.id} needs at least one alias`);
  const normalizedAliases = spec.aliases.map((alias) => normalizeHeader(alias));
  if (new Set(normalizedAliases).size !== normalizedAliases.length) {
    throw new Error(`canonical field ${spec.id} repeats an alias`);
  }
  if (normalizedAliases.some((alias) => alias.length === 0)) {
    throw new Error(`canonical field ${spec.id} declares a blank alias`);
  }
  if (spec.examples.length === 0) throw new Error(`canonical field ${spec.id} needs at least one example`);
  const probeLocation: CellLocation = {
    // Parse probe locations so self-checks use the intake boundary's actual shape.
    workflow: WorkflowIdSchema.parse("registry-self-check"),
    // A FIXED instant: the self-check must not change answer with the calendar,
    // or a declared example could start failing on New Year's Day.
    readAt: "2026-01-01T00:00:00.000Z",
    sourceRow: 1,
    header: spec.label,
    targetFieldId: IntakeTargetFieldIdSchema.parse("selfCheck"),
  };
  for (const example of spec.examples) {
    const coerced = spec.coerce(example, probeLocation);
    const parsed = spec.schema.safeParse(coerced);
    if (!parsed.success) {
      throw new Error(
        `canonical field ${spec.id} example ${JSON.stringify(example)} does not survive its own coerce+parse`,
      );
    }
  }
  const field: CanonicalField<S> = {
    id: spec.id,
    label: spec.label,
    schema: spec.schema,
    coerce: spec.coerce,
    aliases: Object.freeze([...spec.aliases]),
    examples: Object.freeze([...spec.examples]),
    classification: spec.classification,
    redactTransform: spec.redactTransform,
    evidence: spec.evidence,
    ...(spec.auditNote === undefined ? {} : { auditNote: spec.auditNote }),
  };
  Object.freeze(field);
  FACTORY_DEFINED_FIELDS.add(field);
  return field;
}

export function isFactoryDefinedCanonicalField(candidate: CanonicalField): boolean {
  return FACTORY_DEFINED_FIELDS.has(candidate);
}

/** Ref data-intake-and-edit-data's header normalization — one definition, used everywhere. */
export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

function refuse(location: CellLocation, id: CanonicalFieldId, raw: string, reason: string): never {
  throw new CellCoercionError({ location, canonicalFieldId: id, raw, reason });
}

/** A conservative trimmed-text schema for fields whose real width is unaudited. */
const TextSchema = z.string().min(1);

function textCoercer(id: CanonicalFieldId) {
  return (raw: string, location: CellLocation): unknown => {
    const value = collapseWhitespace(raw);
    if (value.length === 0) refuse(location, id, raw, "is blank");
    return value;
  };
}

function nameCoercer(id: CanonicalFieldId) {
  return (raw: string, location: CellLocation): unknown => {
    const value = displayPersonName(raw);
    if (value.length === 0) refuse(location, id, raw, "is not a person name");
    return value;
  };
}

function dateCoercer(id: CanonicalFieldId) {
  return (raw: string, location: CellLocation): unknown => {
    // The observation instant resolves a two-digit year, so a replayed read
    // resolves its dates exactly as the original read did.
    const value = parseUsOrIsoDate(raw, location.readAt);
    if (value === null) {
      refuse(location, id, raw, "is not a calendar date (expected M/D/YY, M-D-YY, MM/DD/YYYY or YYYY-MM-DD)");
    }
    return value;
  };
}

function phoneCoercer(id: CanonicalFieldId) {
  return (raw: string, location: CellLocation): unknown => {
    const digits = normalizePhoneDigits(raw);
    if (digits.length === 0) refuse(location, id, raw, "contains no digits");
    return digits;
  };
}

function emailCoercer(id: CanonicalFieldId) {
  return (raw: string, location: CellLocation): unknown => {
    const value = collapseWhitespace(raw).toLowerCase();
    if (value.length === 0) refuse(location, id, raw, "is blank");
    return value;
  };
}

/** A text field whose real width is not yet evidenced, kept together so the deferral is visible as one decision rather than scattered as a habit. */
function auditedText(spec: {
  id: CanonicalFieldId;
  label: string;
  aliases: readonly string[];
  examples: readonly string[];
  classification: z.infer<typeof DataClassificationSchema>;
  redactTransform: z.infer<typeof EvidenceTransformSchema>;
  auditNote: string;
}) {
  return defineCanonicalField({
    ...spec,
    schema: TextSchema,
    coerce: textCoercer(spec.id),
    evidence: "audit-at-migration",
  });
}

const LEGACY_LOOSE_WIDTH =
  "legacy stores this as free text across its call sites; the consuming migration must scan its real "
  + "fixtures through this schema and report every rejection before a narrower shape is adopted";

export const SsnSchema = z.string().regex(/^\d{9}$/, "SSN must be nine digits");
export const PostalCodeSchema = z.string().regex(/^\d{5}(?:-\d{4})?$/, "postal code must be XXXXX or XXXXX-XXXX");
export const UsStateCodeSchema = z.string().regex(/^[A-Z]{2}$/, "state must be a two-letter USPS code");
export const PhoneDigitsSchema = z.string().regex(/^\d{7,15}$/, "phone must be 7–15 digits");
export const EmailSchema = z.email();
export const MiddleInitialSchema = z.string().regex(/^[A-Za-z]$/, "middle initial must be one letter");
/** The zero-padded PPS identifier a pre-UCPath roster carries; a DIFFERENT identifier from `Eid`, not a looser spelling of one. */
export const PpsEidSchema = z.string().regex(/^\d+$/, "PPS EID must be digits").brand<"PpsEid">();

export const CANONICAL_FIELDS = Object.freeze({
  eid: defineCanonicalField({
    id: "eid",
    label: "Employee ID (EID)",
    schema: EidSchema,
    coerce: (raw, location) => {
      const digits = normalizeEidDigits(raw);
      if (digits.length === 0) refuse(location, "eid", raw, "contains no digits");
      if (!/^10\d{6}$/.test(digits)) {
        refuse(location, "eid", raw, "is not a UCPath EID (must be 10xxxxxx, 8 digits)");
      }
      return digits;
    },
    aliases: ["UCPath ID", "Employee ID", "Empl ID", "Employee ID#", "EID", "UCPath Employee ID", "Empl ID#"],
    examples: ["10873698", "10456712"],
    classification: "direct-identifier",
    // last4 keeps the operator's habitual handle on a row (legacy prints
    // "EID 10873698"), which is what a rejection list has to be scannable by.
    redactTransform: "last4",
    evidence: "resolved",
  }),
  ppsEid: defineCanonicalField({
    id: "ppsEid",
    label: "PPS ID",
    schema: PpsEidSchema,
    coerce: (raw, location) => {
      const digits = collapseWhitespace(raw);
      if (!/^\d+$/.test(digits)) refuse(location, "ppsEid", raw, "is not a numeric PPS ID");
      return digits;
    },
    aliases: ["PPS ID", "PPS EID", "PPS Employee ID"],
    examples: ["00123456", "123456"],
    classification: "direct-identifier",
    redactTransform: "last4",
    evidence: "resolved",
  }),
  pid: auditedText({
    id: "pid",
    label: "UCSD PID",
    aliases: ["PID", "UCSD PID", "Student PID"],
    examples: ["A12345678"],
    classification: "direct-identifier",
    redactTransform: "digest",
    auditNote: LEGACY_LOOSE_WIDTH,
  }),
  ssn: defineCanonicalField({
    id: "ssn",
    label: "Social Security Number",
    schema: SsnSchema,
    coerce: (raw, location) => {
      const digits = raw.replace(/\D+/g, "");
      if (digits.length !== 9) refuse(location, "ssn", raw, "is not a nine-digit SSN");
      return digits;
    },
    aliases: ["SSN", "Social Security Number", "National ID", "NID"],
    examples: ["123456789"],
    classification: "direct-identifier",
    // Never last4: the last four of an SSN is itself a widely used identifier,
    // so the durable manifest keeps only an equality-comparable digest.
    redactTransform: "digest",
    evidence: "resolved",
  }),
  dob: defineCanonicalField({
    id: "dob",
    label: "Date of Birth",
    schema: DateOnlySchema,
    coerce: dateCoercer("dob"),
    aliases: ["DOB", "Date of Birth", "Birth Date", "Birthdate"],
    examples: ["01/14/1998", "1998-01-14"],
    classification: "direct-identifier",
    redactTransform: "digest",
    evidence: "resolved",
  }),
  fullName: defineCanonicalField({
    id: "fullName",
    label: "Full Name",
    schema: TextSchema,
    coerce: nameCoercer("fullName"),
    aliases: [
      "Name", "Legal Name", "Employee Name", "Employee Name Current", "Student Name",
      "Full Name", "Printed Name", "Contact Name",
    ],
    examples: ["Battistessa, Johnnie", "Johnnie Battistessa"],
    classification: "direct-identifier",
    redactTransform: "digest",
    evidence: "resolved",
  }),
  firstName: defineCanonicalField({
    id: "firstName",
    label: "First Name",
    schema: TextSchema,
    coerce: nameCoercer("firstName"),
    aliases: ["First Name", "First", "Given Name"],
    examples: ["Johnnie"],
    classification: "direct-identifier",
    redactTransform: "digest",
    evidence: "resolved",
  }),
  lastName: defineCanonicalField({
    id: "lastName",
    label: "Last Name",
    schema: TextSchema,
    coerce: nameCoercer("lastName"),
    aliases: ["Last Name", "Last", "Surname", "Family Name"],
    examples: ["Battistessa"],
    classification: "direct-identifier",
    redactTransform: "digest",
    evidence: "resolved",
  }),
  middleName: defineCanonicalField({
    id: "middleName",
    label: "Middle Name",
    schema: TextSchema,
    coerce: nameCoercer("middleName"),
    aliases: ["Middle Name", "Middle"],
    examples: ["Rae"],
    classification: "direct-identifier",
    redactTransform: "digest",
    evidence: "resolved",
  }),
  middleInitial: defineCanonicalField({
    id: "middleInitial",
    label: "Middle Initial",
    schema: MiddleInitialSchema,
    coerce: (raw, location) => {
      const value = collapseWhitespace(raw).replace(/\.$/, "");
      if (!/^[A-Za-z]$/.test(value)) refuse(location, "middleInitial", raw, "is not a single letter");
      return value.toUpperCase();
    },
    aliases: ["Middle Initial", "MI"],
    examples: ["R", "R."],
    classification: "direct-identifier",
    redactTransform: "digest",
    evidence: "resolved",
  }),
  livedName: defineCanonicalField({
    id: "livedName",
    label: "Lived Name",
    schema: TextSchema,
    coerce: nameCoercer("livedName"),
    aliases: ["Lived Name", "Preferred Name", "Chosen Name"],
    examples: ["Johnnie"],
    classification: "direct-identifier",
    redactTransform: "digest",
    evidence: "resolved",
  }),
  suffix: defineCanonicalField({
    id: "suffix",
    label: "Name Suffix",
    schema: TextSchema,
    coerce: textCoercer("suffix"),
    aliases: ["Suffix", "Name Suffix"],
    examples: ["Jr", "III"],
    classification: "direct-identifier",
    redactTransform: "digest",
    evidence: "resolved",
  }),
  email: defineCanonicalField({
    id: "email",
    label: "Email",
    schema: EmailSchema,
    coerce: emailCoercer("email"),
    aliases: ["Email", "Email Address", "E-mail"],
    examples: ["person@example.edu"],
    classification: "direct-identifier",
    redactTransform: "digest",
    evidence: "resolved",
  }),
  workEmail: defineCanonicalField({
    id: "workEmail",
    label: "Work Email",
    schema: EmailSchema,
    coerce: emailCoercer("workEmail"),
    aliases: ["Work Email", "Business Email", "Campus Email"],
    examples: ["person@example.edu"],
    classification: "direct-identifier",
    redactTransform: "digest",
    evidence: "resolved",
  }),
  personalEmail: defineCanonicalField({
    id: "personalEmail",
    label: "Personal Email",
    schema: EmailSchema,
    coerce: emailCoercer("personalEmail"),
    aliases: ["Personal Email", "Home Email"],
    examples: ["johnnie@example.com"],
    classification: "direct-identifier",
    redactTransform: "digest",
    evidence: "resolved",
  }),
  cellPhone: defineCanonicalField({
    id: "cellPhone",
    label: "Cell Phone",
    schema: PhoneDigitsSchema,
    coerce: phoneCoercer("cellPhone"),
    aliases: ["Cell Phone", "Mobile", "Mobile Phone", "Cell"],
    examples: ["8585550134", "(858) 555-0134"],
    classification: "direct-identifier",
    redactTransform: "last4",
    evidence: "resolved",
  }),
  homePhone: defineCanonicalField({
    id: "homePhone",
    label: "Home Phone",
    schema: PhoneDigitsSchema,
    coerce: phoneCoercer("homePhone"),
    aliases: ["Home Phone", "Home Telephone"],
    examples: ["8585550134"],
    classification: "direct-identifier",
    redactTransform: "last4",
    evidence: "resolved",
  }),
  workPhone: defineCanonicalField({
    id: "workPhone",
    label: "Work Phone",
    schema: PhoneDigitsSchema,
    coerce: phoneCoercer("workPhone"),
    aliases: ["Work Phone", "Business Phone", "Office Phone"],
    examples: ["8585550134"],
    classification: "direct-identifier",
    redactTransform: "last4",
    evidence: "resolved",
  }),
  address1: defineCanonicalField({
    id: "address1",
    label: "Street Address",
    schema: TextSchema,
    coerce: textCoercer("address1"),
    aliases: ["Street", "Address", "Address 1", "Address Line 1", "Street Address"],
    examples: ["9500 Gilman Dr"],
    classification: "direct-identifier",
    redactTransform: "digest",
    evidence: "resolved",
  }),
  address2: defineCanonicalField({
    id: "address2",
    label: "Address Line 2",
    schema: TextSchema,
    coerce: textCoercer("address2"),
    aliases: ["Address 2", "Address Line 2", "Apt", "Unit"],
    examples: ["Apt 4B"],
    classification: "direct-identifier",
    redactTransform: "digest",
    evidence: "resolved",
  }),
  city: defineCanonicalField({
    id: "city",
    label: "City",
    schema: TextSchema,
    coerce: textCoercer("city"),
    aliases: ["City", "Town"],
    examples: ["La Jolla"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    evidence: "resolved",
  }),
  state: defineCanonicalField({
    id: "state",
    label: "State",
    schema: UsStateCodeSchema,
    coerce: (raw, location) => {
      const code = parseUsStateCode(raw);
      if (code === null) refuse(location, "state", raw, "is not a US state code or state name");
      return code;
    },
    aliases: ["State", "State/Province", "ST"],
    examples: ["CA", "California"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    evidence: "resolved",
  }),
  postalCode: defineCanonicalField({
    id: "postalCode",
    label: "Postal Code",
    schema: PostalCodeSchema,
    coerce: (raw, location) => {
      const value = collapseWhitespace(raw).replace(/\s/g, "");
      if (!/^\d{5}(?:-\d{4})?$/.test(value)) {
        refuse(location, "postalCode", raw, "is not a US ZIP (XXXXX or XXXXX-XXXX)");
      }
      return value;
    },
    aliases: ["Zip", "ZIP Code", "Postal", "Postal Code", "Zipcode"],
    examples: ["92093", "92093-0021"],
    classification: "direct-identifier",
    redactTransform: "last4",
    evidence: "resolved",
  }),
  country: defineCanonicalField({
    id: "country",
    label: "Country",
    schema: TextSchema,
    coerce: textCoercer("country"),
    aliases: ["Country"],
    examples: ["US", "United States"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    evidence: "resolved",
  }),
  relationship: auditedText({
    id: "relationship",
    label: "Relationship",
    aliases: ["Relationship", "Relation", "Contact Relationship"],
    examples: ["Mother", "Parent"],
    classification: "sensitive-hr",
    redactTransform: "digest",
    auditNote:
      "legacy carries the raw form text and maps it to the UCPath dropdown at runtime; the emergency-contact "
      + "migration owns that closed mapping and must supply the enumerated shape",
  }),
  deptId: auditedText({
    id: "deptId",
    label: "Department ID",
    aliases: ["Dept ID", "Department ID", "DeptID", "Department Number", "Dept"],
    examples: ["012345"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote:
      "legacy separations reads this from UCPath as free text while onboarding validates 4–6 digits; the two "
      + "have never been reconciled against real rows",
  }),
  department: auditedText({
    id: "department",
    label: "Department",
    aliases: ["Department", "Department Name", "Dept Name", "Department Description"],
    examples: ["Housing Dining Hospitality"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote: LEGACY_LOOSE_WIDTH,
  }),
  departmentCode: auditedText({
    id: "departmentCode",
    label: "Department Code",
    aliases: ["Department Code", "Dept Code"],
    examples: ["HDH"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote: LEGACY_LOOSE_WIDTH,
  }),
  jobTitle: auditedText({
    id: "jobTitle",
    label: "Job Title",
    aliases: ["Job Title", "Title", "Position Title"],
    examples: ["Dining Assistant"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote: LEGACY_LOOSE_WIDTH,
  }),
  jobCode: auditedText({
    id: "jobCode",
    label: "Job Code",
    aliases: ["Job Code", "Jobcode"],
    examples: ["004920"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote: LEGACY_LOOSE_WIDTH,
  }),
  jobDescription: auditedText({
    id: "jobDescription",
    label: "Job Description",
    aliases: ["Job Description", "Job Desc"],
    examples: ["FOOD SVC WORKER"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote: LEGACY_LOOSE_WIDTH,
  }),
  positionNumber: auditedText({
    id: "positionNumber",
    label: "Position Number",
    aliases: ["Position Number", "Position #", "Position"],
    examples: ["40123456"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote: LEGACY_LOOSE_WIDTH,
  }),
  appointment: auditedText({
    id: "appointment",
    label: "Appointment",
    aliases: ["Appointment", "Appointment Type"],
    examples: ["Casual/Restricted"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote: LEGACY_LOOSE_WIDTH,
  }),
  recruitmentNumber: auditedText({
    id: "recruitmentNumber",
    label: "Recruitment Number",
    aliases: ["Recruitment Number", "Recruitment #", "Requisition"],
    examples: ["JR123456"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote: LEGACY_LOOSE_WIDTH,
  }),
  workLocation: auditedText({
    id: "workLocation",
    label: "Work Location",
    aliases: ["Work Location", "Location"],
    examples: ["Sixth College"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote: LEGACY_LOOSE_WIDTH,
  }),
  supervisor: defineCanonicalField({
    id: "supervisor",
    label: "Supervisor",
    schema: TextSchema,
    coerce: nameCoercer("supervisor"),
    aliases: ["Supervisor", "Manager", "Reports To"],
    examples: ["Battistessa, Johnnie"],
    classification: "direct-identifier",
    redactTransform: "digest",
    evidence: "resolved",
  }),
  viceChancellor: auditedText({
    id: "viceChancellor",
    label: "Vice Chancellor",
    aliases: ["Vice Chancellor", "VC"],
    examples: ["Student Affairs"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote: LEGACY_LOOSE_WIDTH,
  }),
  viceChancellorCode: auditedText({
    id: "viceChancellorCode",
    label: "Vice Chancellor Code",
    aliases: ["Vice Chancellor Code", "VC Code"],
    examples: ["VCSA"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote: LEGACY_LOOSE_WIDTH,
  }),
  employeeStatus: auditedText({
    id: "employeeStatus",
    label: "Employee Status",
    aliases: ["Employee Status", "HR Status", "Status"],
    examples: ["Active"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote:
      "the rebuild's own `UcpathCandidate.employeeStatus` is already a closed enum read from UCPath; an intake "
      + "column carries whatever the operator's export spells, and the two have not been reconciled",
  }),
  effectiveDate: defineCanonicalField({
    id: "effectiveDate",
    label: "Effective Date",
    schema: DateOnlySchema,
    coerce: dateCoercer("effectiveDate"),
    aliases: ["Effective Date", "Eff Date", "Effective"],
    examples: ["07/01/2026", "2026-07-01"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    evidence: "resolved",
  }),
  hireDate: defineCanonicalField({
    id: "hireDate",
    label: "Hire Date",
    schema: DateOnlySchema,
    coerce: dateCoercer("hireDate"),
    aliases: ["Hire Date", "First Day of Service", "Start Date", "Employment Date"],
    examples: ["07/01/2026"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    evidence: "resolved",
  }),
  separationDate: defineCanonicalField({
    id: "separationDate",
    label: "Separation Date",
    schema: DateOnlySchema,
    coerce: dateCoercer("separationDate"),
    aliases: ["Separation Date", "Sep Date", "Termination Date"],
    examples: ["08/15/2026"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    evidence: "resolved",
  }),
  lastDayWorked: defineCanonicalField({
    id: "lastDayWorked",
    label: "Last Day Worked",
    schema: DateOnlySchema,
    coerce: dateCoercer("lastDayWorked"),
    aliases: ["Last Day Worked", "LDW", "Last Day"],
    examples: ["08/14/2026"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    evidence: "resolved",
  }),
  signatureDate: defineCanonicalField({
    id: "signatureDate",
    label: "Signature Date",
    schema: DateOnlySchema,
    coerce: dateCoercer("signatureDate"),
    aliases: ["Signature Date", "Date Signed", "Oath Date", "Signed"],
    examples: ["07/21/2026"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    evidence: "resolved",
  }),
  kualiDocId: auditedText({
    id: "kualiDocId",
    label: "Kuali Document Number",
    aliases: ["Kuali Doc", "Kuali Document", "Doc ID", "Document Number", "Form #"],
    examples: ["4489"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote:
      "the rebuild has verified Kuali document numbers only as the level-1 heading text of the documents it has "
      + "opened; no reviewed width exists for the identifier itself",
  }),
  terminationType: auditedText({
    id: "terminationType",
    label: "Termination Type",
    aliases: ["Termination Type", "Separation Reason", "Reason"],
    examples: ["Accepted Another Job"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote:
      "legacy maps this free text to a UCPath reason code through a fuzzy fallback chain the rebuild will not "
      + "port; the separations migration owns the closed mapping",
  }),
  transactionNumber: auditedText({
    id: "transactionNumber",
    label: "Transaction Number",
    aliases: ["Transaction Number", "Txn #", "Transaction #"],
    examples: ["01234567"],
    classification: "safe-diagnostic",
    redactTransform: "allow",
    auditNote: LEGACY_LOOSE_WIDTH,
  }),
} satisfies Record<CanonicalFieldId, CanonicalField>);

export const CANONICAL_FIELD_IDS: readonly CanonicalFieldId[] = Object.freeze(
  CanonicalFieldIdSchema.options,
);

export function canonicalField(id: CanonicalFieldId): CanonicalField {
  return CANONICAL_FIELDS[id];
}
