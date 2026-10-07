/**
 * OCR extraction admission — ONE gate, whoever did the reading.
 *
 * An extraction can be produced three ways, and the operator must be able to
 * use any of them interchangeably:
 *
 *   1. a provider model reached through the admitted client (ref task-contract §3.4);
 *   2. an agent the operator runs in their own terminal;
 *   3. the operator, reading the page themselves.
 *
 * `admitOcrExtraction` is the only way any of them becomes a record. The source
 * is recorded as PROVENANCE and never as permission: there is deliberately no
 * branch in this function on who produced the value, so a route cannot acquire
 * a weaker rule by being more convenient. Two extractions of the same page that
 * agree on the facts produce byte-identical accepted records whatever their
 * source — the guard proves exactly that.
 *
 * ## "Nobody skips anything" is the completeness rule
 *
 * Every path the form declares must appear, and each answer is either a value
 * or a TYPED absence (`not-on-form`, `blank`, `illegible`). A result missing a
 * path is refused; so is one carrying a path the form does not declare. There
 * is no `.optional()` anywhere in the answer shape, because an optional field
 * is precisely a field a producer can skip in silence.
 *
 * The three absences are not interchangeable and the distinction is the whole
 * point. `not-on-form` says the page has no such box. `blank` says the box is
 * there and empty — a fact about the employee. `illegible` says the box has
 * something in it that could not be read — a fact about the SCAN, and the only
 * one that a human re-read can fix. Legacy collapsed all three into `null` and
 * reconstructed the difference afterwards by diffing snapshots.
 *
 * ## Values are validated by the canonical schema, not by the producer
 *
 * A field bound to a canonical id runs the SAME `coerce` + `schema` an intake
 * column runs. So a model that returns `10-4567` for an EID is refused here for
 * the same reason and with the same message a spreadsheet cell would be — the
 * producer's confidence in its own output buys it nothing.
 */
import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import {
  FingerprintSchema,
  IntakeTargetFieldIdSchema,
  IsoInstantSchema,
  WorkflowIdSchema,
  type Fingerprint,
} from "../../rules/identity/ids.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { CANONICAL_FIELDS } from "../fields/registry.js";
import { isCellCoercionError, type CellLocation } from "../fields/cell-coercion.js";
import {
  OcrFieldPathSchema,
  OcrFormTypeSchema,
  OcrPageKindSchema,
  fieldOnPageKind,
  ocrForm,
  type OcrFieldSpec,
} from "./form-registry.js";

/**
 * Who read the page. Provenance, never permission.
 *
 * `local-agent` names the tool by id and records the exact invocation the
 * operator ran, so a result can be reproduced or attributed later. `operator`
 * is a person attesting to what they read — the strongest provenance and the
 * least scalable, which is why it is a peer of the others rather than a
 * fallback that engages when the others fail.
 */
export const ExtractionSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("provider"),
    providerId: z.string().min(1),
    modelId: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("local-agent"),
    agentId: z.string().min(1),
    invocation: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("operator"),
    actorId: z.string().min(1),
  }),
]);
export type ExtractionSource = z.infer<typeof ExtractionSourceSchema>;

/** The reasons a declared field can have no value. Closed, and not equivalent. */
export const AbsenceReasonSchema = z.enum(["not-on-form", "blank", "illegible"]);
export type AbsenceReason = z.infer<typeof AbsenceReasonSchema>;

/** One answer, as a producer submits it. Exactly one of the two arms. */
export const SubmittedAnswerSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("read"),
    /** Verbatim text as it appears on the page — never pre-normalized. */
    raw: z.string().min(1),
    /** The producer's own 0–1 confidence. Advisory; it gates nothing here. */
    confidence: z.number().min(0).max(1),
  }),
  z.strictObject({
    state: z.literal("absent"),
    reason: AbsenceReasonSchema,
  }),
]);
export type SubmittedAnswer = z.infer<typeof SubmittedAnswerSchema>;

export const SubmittedRecordSchema = z.strictObject({
  /** `path -> answer`. Checked against the form's declared set, both ways. */
  answers: z.record(OcrFieldPathSchema, SubmittedAnswerSchema),
});
export type SubmittedRecord = z.infer<typeof SubmittedRecordSchema>;

export const SubmittedExtractionSchema = z.strictObject({
  formType: OcrFormTypeSchema,
  source: ExtractionSourceSchema,
  readAt: IsoInstantSchema,
  /** Content identity of the page image or PDF that was read. */
  sourceSha256: FingerprintSchema,
  /** 1-based page of the source document these records came from. */
  sourcePage: z.number().int().positive(),
  /**
   * What the page turned out to BE, decided before any field was read. A
   * scanned stack is mixed, so this is not a formality: a page that is not the
   * expected form carries NO records, and that is a correct outcome rather than
   * a failed one.
   */
  pageKind: OcrPageKindSchema,
  /**
   * The one person on this page, or `null` when the page is not this form.
   *
   * Every form the operator actually scans is one person per page — the
   * multi-row sign-in sheet legacy supported is used by no workflow. A page is
   * therefore this form or it is not, and an array would be generality with no
   * user. An I-9 subject DOES span two pages, but that is a grouping problem
   * above this gate rather than several records inside one page.
   */
  record: SubmittedRecordSchema.nullable(),
});
export type SubmittedExtraction = z.infer<typeof SubmittedExtractionSchema>;

/** One admitted answer: the canonical value, or the typed absence, plus its raw. */
export const AdmittedAnswerSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("read"),
    path: OcrFieldPathSchema,
    raw: z.string().min(1),
    /** Coerced and parsed by the canonical field, or the form-local shape. */
    value: z.union([z.string(), z.boolean()]),
    confidence: z.number().min(0).max(1),
  }),
  z.strictObject({
    state: z.literal("absent"),
    path: OcrFieldPathSchema,
    reason: AbsenceReasonSchema,
  }),
  z.strictObject({
    state: z.literal("unreadable"),
    path: OcrFieldPathSchema,
    raw: z.string().min(1),
    /** Why the value the producer read is not a valid value for this field. */
    reason: z.string().min(1),
    confidence: z.number().min(0).max(1),
  }),
]);
export type AdmittedAnswer = z.infer<typeof AdmittedAnswerSchema>;

export const AdmittedRecordSchema = z.strictObject({
  /** Sorted by path, so two agreeing readings are byte-identical. */
  answers: z.array(AdmittedAnswerSchema).min(1),
  /**
   * Paths a human must resolve before this record may be used: a MANDATORY
   * field that came back absent or unreadable. Empty means ready for review,
   * not "approved" — ref operator-trust's gate still applies.
   */
  blockingPaths: z.array(OcrFieldPathSchema),
  /** Digest of the admitted answers, for cross-producer comparison. */
  answersFingerprint: FingerprintSchema,
});
export type AdmittedRecord = z.infer<typeof AdmittedRecordSchema>;

export const AdmittedExtractionSchema = z.strictObject({
  formType: OcrFormTypeSchema,
  source: ExtractionSourceSchema,
  readAt: IsoInstantSchema,
  sourceSha256: FingerprintSchema,
  sourcePage: z.number().int().positive(),
  pageKind: OcrPageKindSchema,
  /** Null exactly when the page is not the expected form. */
  record: AdmittedRecordSchema.nullable(),
  /** Digest of the page's reading, for cross-producer comparison. */
  pageFingerprint: FingerprintSchema,
}).superRefine((extraction, context) => {
  const issue = (message: string): void => { context.addIssue({ code: "custom", message }); };
  // Data-bearing is a property of the FORM's declared page kinds, not of
  // `pageKind === formType`: the I-9's two sections both carry records while
  // neither kind spells "i9".
  const dataBearing = ocrForm(extraction.formType).pageKinds.includes(extraction.pageKind);
  if (dataBearing && extraction.record === null) {
    issue(`a page classified as ${extraction.pageKind} must carry its record`);
  }
  if (!dataBearing && extraction.record !== null) {
    issue(`a page classified as ${extraction.pageKind} cannot carry a ${extraction.formType} record`);
  }
});
export type AdmittedExtraction = z.infer<typeof AdmittedExtractionSchema>;

/**
 * The gate's verdict. Schema-derived because it is served: the correction list
 * is what a producer — model, agent or person — reads to fix its submission.
 */
export const OcrAdmissionSchema = z.discriminatedUnion("admitted", [
  z.strictObject({ admitted: z.literal(true), extraction: AdmittedExtractionSchema }),
  z.strictObject({ admitted: z.literal(false), problems: z.array(z.string().min(1)).min(1) }),
]);
export type OcrAdmission = z.infer<typeof OcrAdmissionSchema>;

function admitValue(spec: OcrFieldSpec, raw: string, location: CellLocation):
  { ok: true; value: string | boolean } | { ok: false; reason: string } {
  if (spec.canonicalFieldId === null) {
    const text = raw.trim();
    if (spec.localKind === "boolean") {
      if (/^(?:y|yes|true|signed|x|✓)$/i.test(text)) return { ok: true, value: true };
      if (/^(?:n|no|false|unsigned|blank)$/i.test(text)) return { ok: true, value: false };
      return { ok: false, reason: `${JSON.stringify(raw)} is not a yes/no answer` };
    }
    if (text.length === 0) return { ok: false, reason: "is blank" };
    return { ok: true, value: text };
  }
  const field = CANONICAL_FIELDS[spec.canonicalFieldId];
  try {
    const parsed: z.ZodSafeParseResult<unknown> = field.schema.safeParse(field.coerce(raw, location));
    if (!parsed.success) return { ok: false, reason: `did not satisfy the ${spec.canonicalFieldId} schema` };
    const value: unknown = parsed.data;
    return { ok: true, value: typeof value === "boolean" ? value : String(value) };
  } catch (error) {
    // A refused cell is the measurement, exactly as in intake. Anything else is
    // a fault in a coercer and must reach the top.
    if (!isCellCoercionError(error)) throw error;
    return { ok: false, reason: error.reason };
  }
}

/**
 * The single admission gate. Refuses rather than repairing.
 *
 * It returns EVERY problem rather than the first, because a producer — human or
 * model — should get one complete correction list, not one round trip per
 * mistake.
 */
export function admitOcrExtraction(candidate: unknown): OcrAdmission {
  const parsed = SubmittedExtractionSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      admitted: false,
      problems: parsed.error.issues.map((issue) =>
        `${issue.path.join(".") || "<root>"}: ${issue.message}`),
    };
  }
  const submission = parsed.data;
  const form = ocrForm(submission.formType);
  const problems: string[] = [];

  // A page that is not a data page of this form carries no record, and that is
  // a correct outcome: a scanned stack is loose paper, and demanding oath
  // answers from an emergency-contact page would force a producer to invent
  // them. Data-bearing means one of the FORM's declared page kinds — the I-9's
  // two sections both qualify.
  if (!form.pageKinds.includes(submission.pageKind)) {
    if (submission.record !== null) {
      problems.push(
        `pageKind ${submission.pageKind} does not match this ${submission.formType} run, `
        + "so the page cannot also carry a record",
      );
      return { admitted: false, problems };
    }
    return { admitted: true, extraction: buildAdmitted(submission, null) };
  }

  if (submission.record === null) {
    problems.push(`a page classified as ${submission.pageKind} must carry its record`);
    return { admitted: false, problems };
  }

  const declared = new Map(form.fields.map((spec) => [spec.path, spec]));
  const submitted = new Set(Object.keys(submission.record.answers));
  for (const path of declared.keys()) {
    if (!submitted.has(path)) {
      problems.push(
        `${path} not answered — every declared field needs a value or one of `
        + "not-on-form / blank / illegible",
      );
    }
  }
  for (const path of submitted) {
    if (!declared.has(path)) problems.push(`${path} is not a field of the ${submission.formType} form`);
  }
  // A sectioned form's field exists on SOME of its pages. On a page whose kind
  // does not carry the box, the only truthful answer is `not-on-form`: a value
  // "read" from a box the page does not have is a value from nowhere, and
  // `blank`/`illegible` both claim the box exists.
  for (const [path, spec] of declared) {
    if (fieldOnPageKind(spec, submission.pageKind)) continue;
    const answer = submission.record.answers[path];
    if (answer === undefined) continue;
    if (answer.state !== "absent" || answer.reason !== "not-on-form") {
      problems.push(
        `${path} is not on a ${submission.pageKind} page — the only truthful answer there is not-on-form`,
      );
    }
  }
  if (problems.length > 0) return { admitted: false, problems };

  return {
    admitted: true,
    extraction: buildAdmitted(submission, admitRecord(submission, form.fields, submission.record)),
  };
}

function admitRecord(
  submission: SubmittedExtraction,
  fields: readonly OcrFieldSpec[],
  record: SubmittedRecord,
): z.infer<typeof AdmittedRecordSchema> {
  const location: CellLocation = {
    workflow: WorkflowIdSchema.parse(`ocr-${submission.formType}`),
    // The submission's OWN read instant, so re-admitting a stored submission
    // resolves its two-digit years exactly as the first admission did.
    readAt: submission.readAt,
    sourceRow: submission.sourcePage,
    header: submission.formType,
    targetFieldId: IntakeTargetFieldIdSchema.parse("ocrField"),
  };

  const answers: AdmittedAnswer[] = [];
  const blockingPaths: string[] = [];
  for (const spec of fields) {
    const answer = record.answers[spec.path];
    // A mandatory field blocks only on pages that CARRY it: an I-9 Section 2's
    // `not-on-form` date of birth is the correct answer, not a gap a human must
    // resolve. Off-kind fields reach here as `not-on-form` only — the gate has
    // already refused anything else.
    const onThisKind = fieldOnPageKind(spec, submission.pageKind);
    if (answer.state === "absent") {
      answers.push(AdmittedAnswerSchema.parse({ state: "absent", path: spec.path, reason: answer.reason }));
      if (spec.mandatory && onThisKind) blockingPaths.push(spec.path);
      continue;
    }
    const admitted = admitValue(spec, answer.raw, { ...location, header: spec.path });
    if (!admitted.ok) {
      // NOT a rejection of the whole record: an unreadable value is a real
      // outcome a human resolves. It is kept with its raw text so the reviewer
      // sees what the producer actually saw.
      answers.push(AdmittedAnswerSchema.parse({
        state: "unreadable",
        path: spec.path,
        raw: answer.raw,
        reason: admitted.reason,
        confidence: answer.confidence,
      }));
      if (spec.mandatory) blockingPaths.push(spec.path);
      continue;
    }
    answers.push(AdmittedAnswerSchema.parse({
      state: "read",
      path: spec.path,
      raw: answer.raw,
      value: admitted.value,
      confidence: answer.confidence,
    }));
  }

  answers.sort((left, right) => left.path.localeCompare(right.path));
  return AdmittedRecordSchema.parse({
    answers,
    blockingPaths: blockingPaths.toSorted((left, right) => left.localeCompare(right)),
    answersFingerprint: answersFingerprint(answers),
  });
}

function buildAdmitted(
  submission: SubmittedExtraction,
  record: z.infer<typeof AdmittedRecordSchema> | null,
): AdmittedExtraction {
  return AdmittedExtractionSchema.parse({
    formType: submission.formType,
    source: submission.source,
    readAt: submission.readAt,
    sourceSha256: submission.sourceSha256,
    sourcePage: submission.sourcePage,
    pageKind: submission.pageKind,
    record,
    // Folds the CLASSIFICATION as well as the answers: two producers that read
    // the same values but disagree about what the page IS have not agreed.
    pageFingerprint: FingerprintSchema.parse(sha256Hex(
      `hrauto:ocr-page:v1\0${canonicalJsonStringify({
        pageKind: submission.pageKind,
        answers: record === null ? null : record.answersFingerprint,
      })}`,
    )),
  });
}

/**
 * A digest of WHAT WAS READ, excluding who read it and when.
 *
 * Two producers that agree on the page produce the same fingerprint, which is
 * what makes "the same result no matter who does it" checkable rather than
 * asserted — and what a later cross-check between routes compares. Confidence
 * is excluded on purpose: it is the producer's opinion of itself, not a fact
 * about the page, and including it would make agreement impossible to detect.
 */
export function answersFingerprint(answers: readonly AdmittedAnswer[]): Fingerprint {
  const facts = answers
    .toSorted((left, right) => left.path.localeCompare(right.path))
    .map((answer) => (answer.state === "read"
      ? { path: answer.path, state: answer.state, value: answer.value }
      : answer.state === "absent"
        ? { path: answer.path, state: answer.state, reason: answer.reason }
        : { path: answer.path, state: answer.state, raw: answer.raw }));
  return FingerprintSchema.parse(sha256Hex(`hrauto:ocr-answers:v1\0${canonicalJsonStringify(facts)}`));
}

/** Whether two admitted extractions read the same page the same way. */
export function extractionsAgree(left: AdmittedExtraction, right: AdmittedExtraction): boolean {
  return left.formType === right.formType
    && left.sourceSha256 === right.sourceSha256
    && left.sourcePage === right.sourcePage
    && left.pageFingerprint === right.pageFingerprint;
}
