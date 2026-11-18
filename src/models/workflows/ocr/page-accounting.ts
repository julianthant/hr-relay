import { z } from "zod";
import { AdmittedExtractionSchema, admitOcrExtraction, answersFingerprint, type AdmittedRecord, type AdmittedExtraction } from "../../ocr/extraction.js";
import { OcrFormTypeSchema, type OcrFormType } from "../../ocr/form-registry.js";
import { childRunOutcomeSchema } from "../../workflow/graph.js";
import { FingerprintSchema, ItemIdSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { deriveItemId } from "../../../rules/identity/logical-item.js";
import { OcrPageInputSchema, OcrSourceManifestSchema, ocrExtractionId, ocrPageInputs,
  type OcrPageInput, type OcrSourceManifest } from "./source-manifest.js";

function readSubmission(extraction: AdmittedExtraction) {
  const { pageFingerprint: _fingerprint, record, ...metadata } = extraction;
  return { ...metadata, record: record === null ? null : {
    answers: Object.fromEntries(record.answers.map(answer => [answer.path,
      answer.state === "absent" ? { state: "absent", reason: answer.reason }
        : { state: "read", raw: answer.raw, confidence: answer.confidence }])) } };
}

export function hasRetainedAnswerEvidence(record: AdmittedRecord): boolean {
  const unresolved = new Set(record.answers.filter(answer => answer.state !== "read").map(answer => answer.path));
  return record.answersFingerprint === answersFingerprint(record.answers)
    && record.answers.every((answer, index) => index === 0 || record.answers[index - 1].path.localeCompare(answer.path) < 0)
    && new Set(record.blockingPaths).size === record.blockingPaths.length && record.blockingPaths.every(path => unresolved.has(path));
}

export const RetainedOcrPageReadingSchema = z.strictObject({
  input: OcrPageInputSchema,
  extractionId: FingerprintSchema,
  extraction: AdmittedExtractionSchema,
}).superRefine((reading, context) => {
  if (!OcrPageInputSchema.safeParse(reading.input).success) return;
  const { input, extraction } = reading;
  if (reading.extractionId !== ocrExtractionId(input) || extraction.formType !== input.formType
    || extraction.sourcePage !== input.sourcePage || extraction.sourceSha256 !== input.image.sha256) {
    context.addIssue({ code: "custom", message: "OCR reading does not match its exact source request" });
  }
  if (extraction.source.kind === "local-agent" || (extraction.source.kind === "provider"
    && extraction.source.providerId !== "chatgpt-subscription")) {
    context.addIssue({ code: "custom", message: "OCR reading requires subscription provider or operator provenance" });
  }
  const pageDigest = sha256Hex(`hrauto:ocr-page:v1\0${canonicalJsonStringify({
    pageKind: extraction.pageKind, answers: extraction.record?.answersFingerprint ?? null,
  })}`);
  if (extraction.pageFingerprint !== pageDigest || extraction.record !== null && !hasRetainedAnswerEvidence(extraction.record)) {
    context.addIssue({ code: "custom", message: "OCR reading is not canonical admitted source evidence" });
  }
});

export const OcrPageReadingSchema = RetainedOcrPageReadingSchema.superRefine(({ extraction }, context) => {
  const admitted = admitOcrExtraction(readSubmission(extraction));
  if (!admitted.admitted || canonicalJsonStringify(admitted.extraction) !== canonicalJsonStringify(extraction)) {
    context.addIssue({ code: "custom", message: "OCR reading is not canonical admitted source evidence" });
  }
});
export type OcrPageReading = z.infer<typeof OcrPageReadingSchema>;

export function bindOcrPageReading(input: OcrPageInput, candidate: unknown): OcrPageReading {
  const extraction = AdmittedExtractionSchema.parse(candidate);
  if (extraction.source.kind !== "provider" || extraction.source.providerId !== "chatgpt-subscription") {
    throw new Error("OCR provider reading requires subscription provider provenance");
  }
  return deepFreeze(OcrPageReadingSchema.parse({ input, extractionId: ocrExtractionId(input), extraction }));
}

export function bindManualOcrPageReading(input: OcrPageInput, actorId: string, candidate: unknown): OcrPageReading {
  const admission = admitOcrExtraction(candidate);
  if (!admission.admitted) throw new Error(`Manual OCR source reading refused: ${admission.problems.join("; ")}`);
  return bindCanonicalManualOcrReading(input, actorId, admission.extraction);
}

export function bindCanonicalManualOcrReading(input: OcrPageInput, actorId: string, extraction: AdmittedExtraction): OcrPageReading {
  if (extraction.source.kind !== "operator" || extraction.source.actorId !== actorId) {
    throw new Error("Manual OCR reading requires the asserting operator's provenance");
  }
  return deepFreeze(OcrPageReadingSchema.parse({ input, extractionId: ocrExtractionId(input), extraction }));
}

export const OcrPageOutcomeSchema = childRunOutcomeSchema(OcrPageReadingSchema);
export type OcrPageOutcome = z.infer<typeof OcrPageOutcomeSchema>;

export const OcrPageAccountingSchema = z.strictObject({
  formType: OcrFormTypeSchema,
  manifest: OcrSourceManifestSchema,
  readingId: ItemIdSchema,
  outcomes: z.array(OcrPageOutcomeSchema).min(1),
}).superRefine((accounting, context) => {
  if (!OcrSourceManifestSchema.safeParse(accounting.manifest).success || !ItemIdSchema.safeParse(accounting.readingId).success) return;
  const requests = ocrPageInputs(accounting.manifest, accounting.readingId, accounting.formType);
  if (accounting.outcomes.length !== requests.length) {
    context.addIssue({ code: "custom", message: "OCR accounting requires one retained outcome per original page" });
  }
  const runIds = new Set<string>();
  for (const [index, outcome] of accounting.outcomes.entries()) {
    const request = requests[index];
    if (request === undefined || outcome.itemId !== ocrExtractionItemId(request)
      || (outcome.state === "done" && canonicalJsonStringify(outcome.output.input) !== canonicalJsonStringify(request))) {
      context.addIssue({ code: "custom", message: "OCR child outcome does not match the original page in manifest order" });
    }
    if (runIds.has(outcome.runId)) context.addIssue({ code: "custom", message: "OCR child run is retained for more than one page" });
    runIds.add(outcome.runId);
  }
});
export const RetainedOcrPageAccountingSchema = OcrPageAccountingSchema.safeExtend({
  outcomes: z.array(childRunOutcomeSchema(RetainedOcrPageReadingSchema)).min(1),
});
export type OcrPageAccounting = z.infer<typeof OcrPageAccountingSchema>;

export function ocrExtractionItemId(input: OcrPageInput) {
  return ItemIdSchema.parse(deriveItemId("ocr-page", ocrExtractionId(input)));
}

export function accountOcrPages(manifest: OcrSourceManifest, readingId: z.input<typeof ItemIdSchema>, outcomes: readonly OcrPageOutcome[], formType: OcrFormType = "emergency-contact"): OcrPageAccounting {
  return deepFreeze(OcrPageAccountingSchema.parse({ formType, manifest, readingId, outcomes }));
}
