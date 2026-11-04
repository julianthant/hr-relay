import { ArtifactRefSchema } from "../../../../src/models/artifacts/artifacts.js";
import { ocrForm, fieldOnPageKind, type OcrFormType, type OcrPageKind } from "../../../../src/models/ocr/form-registry.js";
import { admitOcrExtraction, type SubmittedExtraction, type SubmittedAnswer, type AdmittedExtraction } from "../../../../src/models/ocr/extraction.js";
import { IsoInstantSchema, ItemIdSchema, RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { buildOcrSourceManifest, ocrPageInputs, type OcrPageInput } from "../../../../src/models/workflows/ocr/source-manifest.js";
import { bindOcrPageReading, ocrExtractionItemId, OcrPageOutcomeSchema } from "../../../../src/models/workflows/ocr/page-accounting.js";

export const READING_ID = ItemIdSchema.parse("00000000-0000-4000-8000-000000000101");
export const SOURCE_RUN_ID = RunIdSchema.parse("00000000-0000-4000-8000-000000000102");
export const READ_AT = IsoInstantSchema.parse("2026-11-01T10:00:00.000Z");
export const DOCUMENT = ArtifactRefSchema.parse({ id: "00000000-0000-4000-8000-000000000103",
  sha256: sha256Hex("synthetic contact document"), bytes: 200, mediaType: "application/pdf" });

export function sourceFixture(pageCount = 2, formType: OcrFormType = "emergency-contact") {
  const manifest = buildOcrSourceManifest(DOCUMENT, { pageCount,
    pages: Array.from({ length: pageCount }, (_, index) => ({ sourcePage: index + 1,
      image: ArtifactRefSchema.parse({ id: `00000000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`,
        sha256: sha256Hex(`synthetic contact page ${index + 1}`), bytes: 100, mediaType: "image/png" }) })) });
  return { manifest, inputs: ocrPageInputs(manifest, READING_ID, formType) };
}

export function submittedPage(input: OcrPageInput, name = "Example, Avery", pageKind: OcrPageKind = ocrForm(input.formType).pageKinds[0]): SubmittedExtraction {
  return { formType: input.formType, source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "synthetic-test-model" },
    readAt: READ_AT, sourceSha256: input.image.sha256, sourcePage: input.sourcePage, pageKind,
    record: !ocrForm(input.formType).pageKinds.includes(pageKind) ? null : { answers: Object.fromEntries(ocrForm(input.formType).fields.map((field): [string, SubmittedAnswer] => {
      if (!fieldOnPageKind(field, pageKind)) return [field.path, { state: "absent", reason: "not-on-form" }];
      const value = ["employee.name", "printedName"].includes(field.path) ? name
        : field.path === "lastName" ? "Example" : field.path === "firstName" ? "Avery"
        : ["employeeSigned", "officerSigned"].includes(field.path) ? "yes" : field.path === "contact.name" ? "Example, Robin"
        : field.path === "contact.relationship" ? "Spouse" : null;
      return [field.path, value === null ? { state: "absent", reason: "blank" } : { state: "read", raw: value, confidence: 0.9 }];
    })) } };
}

export function admittedPage(input: OcrPageInput, name?: string, pageKind?: OcrPageKind) {
  const admission = admitOcrExtraction(submittedPage(input, name, pageKind));
  if (!admission.admitted) throw new Error(admission.problems.join("; "));
  return admission.extraction;
}

export function correctOcrField(extraction: AdmittedExtraction, path: string, raw: string) {
  if (extraction.record === null || !extraction.record.answers.some(answer => answer.path === path)) throw new Error("OCR correction fixture requires its source field");
  const { record, pageFingerprint: _pageFingerprint, ...metadata } = extraction;
  const corrected = admitOcrExtraction({ ...metadata, record: { answers: Object.fromEntries(record.answers.map(answer => [answer.path,
    answer.path === path ? { state: "read", raw, confidence: 1 }
      : answer.state === "absent" ? { state: "absent", reason: answer.reason } : { state: "read", raw: answer.raw, confidence: answer.confidence }])) } });
  if (!corrected.admitted || corrected.extraction.record === null) throw new Error("OCR correction fixture must be admitted");
  return corrected.extraction.record;
}

export function donePage(input: OcrPageInput, name?: string, pageKind?: OcrPageKind) {
  const outcome = OcrPageOutcomeSchema.parse({ state: "done",
    runId: `00000000-0000-4000-8000-${String(input.sourcePage + 300).padStart(12, "0")}`,
    itemId: ocrExtractionItemId(input), output: bindOcrPageReading(input, admittedPage(input, name, pageKind)) });
  if (outcome.state !== "done") throw new Error("OCR completed-page fixture has no output");
  return outcome;
}
