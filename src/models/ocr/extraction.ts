/** OCR extraction admission — ONE gate, whoever did the reading, so an operator can trust any of the three producing routes. */
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

/** Who read the page: provenance, never permission; the producer id and exact invocation are recorded. */
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
    /* What the page turned out to BE, decided before any field was read; a scanned stack is mixed, so a page that is not the expected form carries NO records, and that is a correct outcome. */
  pageKind: OcrPageKindSchema,
    /* The one person on this page, or `null` when the page is not this form; every form the operator actually scans is one person per page. */
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
    /* Paths a human must resolve before this record may be used; empty means ready for review, not "approved" — the gate still applies. */
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
  // Data pages follow declared page kinds, not equality with the form ID.
  const dataBearing = ocrForm(extraction.formType).pageKinds.includes(extraction.pageKind);
  if (dataBearing && extraction.record === null) {
    issue(`a page classified as ${extraction.pageKind} must carry its record`);
  }
  if (!dataBearing && extraction.record !== null) {
    issue(`a page classified as ${extraction.pageKind} cannot carry a ${extraction.formType} record`);
  }
});
export type AdmittedExtraction = z.infer<typeof AdmittedExtractionSchema>;

/** The gate's verdict, schema-derived because it is served: the correction list is what a producer reads to fix its submission. */
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

/** The single admission gate: refuses rather than repairing, and returns EVERY problem rather than the first, because a producer reads all of them. */
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

  // Non-data pages carry no record; demanding another form's fields would invent observations.
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
  // Off-kind fields are not-on-form; blank and illegible both claim the box exists.
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
    // Mandatory fields block only on page kinds that carry them.
    const onThisKind = fieldOnPageKind(spec, submission.pageKind);
    if (answer.state === "absent") {
      answers.push(AdmittedAnswerSchema.parse({ state: "absent", path: spec.path, reason: answer.reason }));
      if (spec.mandatory && onThisKind) blockingPaths.push(spec.path);
      continue;
    }
    const admitted = admitValue(spec, answer.raw, { ...location, header: spec.path });
    if (!admitted.ok) {
      // Preserve unreadable values and raw text for human resolution.
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

/** A digest of WHAT WAS READ, excluding who read it and when, so two producers that agree on the page produce the same fingerprint. */
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
