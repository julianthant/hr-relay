import { z } from "zod";
import { AdmittedExtractionSchema, admitOcrExtraction, type AdmittedExtraction } from "../../ocr/extraction.js";
import { childRunOutcomeSchema } from "../../workflow/graph.js";
import { FingerprintSchema, ItemIdSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { OcrPageInputSchema, OcrSourceManifestSchema, ocrExtractionId, ocrPageInputs,
  type OcrPageInput, type OcrSourceManifest } from "./source-manifest.js";

function readSubmission(extraction: AdmittedExtraction) {
  const { pageFingerprint: _fingerprint, record, ...metadata } = extraction;
  return { ...metadata, record: record === null ? null : {
    answers: Object.fromEntries(record.answers.map(answer => [answer.path,
      answer.state === "absent" ? { state: "absent", reason: answer.reason }
        : { state: "read", raw: answer.raw, confidence: answer.confidence }])) } };
}

export const OcrPageReadingSchema = z.strictObject({
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
  if (admission.extraction.source.kind !== "operator" || admission.extraction.source.actorId !== actorId) {
    throw new Error("Manual OCR reading requires the asserting operator's provenance");
  }
  return deepFreeze(OcrPageReadingSchema.parse({ input, extractionId: ocrExtractionId(input), extraction: admission.extraction }));
}

export const OcrPageOutcomeSchema = childRunOutcomeSchema(OcrPageReadingSchema);
export type OcrPageOutcome = z.infer<typeof OcrPageOutcomeSchema>;

export const OcrPageAccountingSchema = z.strictObject({
  manifest: OcrSourceManifestSchema,
  readingId: ItemIdSchema,
  outcomes: z.array(OcrPageOutcomeSchema).min(1),
}).superRefine((accounting, context) => {
  if (!OcrSourceManifestSchema.safeParse(accounting.manifest).success || !ItemIdSchema.safeParse(accounting.readingId).success) return;
  const requests = ocrPageInputs(accounting.manifest, accounting.readingId);
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
export type OcrPageAccounting = z.infer<typeof OcrPageAccountingSchema>;

export function ocrExtractionItemId(input: OcrPageInput) {
  const hash = ocrExtractionId(input);
  return ItemIdSchema.parse(`${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`);
}

export function accountOcrPages(manifest: OcrSourceManifest, readingId: z.input<typeof ItemIdSchema>, outcomes: readonly OcrPageOutcome[]): OcrPageAccounting {
  return deepFreeze(OcrPageAccountingSchema.parse({ manifest, readingId, outcomes }));
}
