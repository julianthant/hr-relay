import { ArtifactRefSchema } from "../../../../src/models/artifacts/artifacts.js";
import { ocrForm, type OcrPageKind } from "../../../../src/models/ocr/form-registry.js";
import { admitOcrExtraction, type SubmittedExtraction } from "../../../../src/models/ocr/extraction.js";
import { IsoInstantSchema, ItemIdSchema, RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { buildOcrSourceManifest, ocrPageInputs, type OcrPageInput } from "../../../../src/models/workflows/ocr/source-manifest.js";
import { bindOcrPageReading, ocrExtractionItemId, OcrPageOutcomeSchema } from "../../../../src/models/workflows/ocr/page-accounting.js";

export const READING_ID = ItemIdSchema.parse("00000000-0000-4000-8000-000000000101");
export const SOURCE_RUN_ID = RunIdSchema.parse("00000000-0000-4000-8000-000000000102");
export const READ_AT = IsoInstantSchema.parse("2026-11-01T10:00:00.000Z");
export const DOCUMENT = ArtifactRefSchema.parse({ id: "00000000-0000-4000-8000-000000000103",
  sha256: sha256Hex("synthetic contact document"), bytes: 200, mediaType: "application/pdf" });

export function sourceFixture(pageCount = 2) {
  const manifest = buildOcrSourceManifest(DOCUMENT, { pageCount,
    pages: Array.from({ length: pageCount }, (_, index) => ({ sourcePage: index + 1,
      image: ArtifactRefSchema.parse({ id: `00000000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`,
        sha256: sha256Hex(`synthetic contact page ${index + 1}`), bytes: 100, mediaType: "image/png" }) })) });
  return { manifest, inputs: ocrPageInputs(manifest, READING_ID) };
}

export function submittedPage(input: OcrPageInput, name = "Example, Avery", pageKind: OcrPageKind = "emergency-contact"): SubmittedExtraction {
  return { formType: "emergency-contact", source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "synthetic-test-model" },
    readAt: READ_AT, sourceSha256: input.image.sha256, sourcePage: input.sourcePage, pageKind,
    record: pageKind !== "emergency-contact" ? null : { answers: Object.fromEntries(ocrForm("emergency-contact").fields.map(field => {
      const value = field.path === "employee.name" ? name : field.path === "contact.name" ? "Example, Robin"
        : field.path === "contact.relationship" ? "Spouse" : null;
      return [field.path, value === null ? { state: "absent", reason: "blank" } : { state: "read", raw: value, confidence: 0.9 }];
    })) } };
}

export function admittedPage(input: OcrPageInput, name?: string, pageKind?: OcrPageKind) {
  const admission = admitOcrExtraction(submittedPage(input, name, pageKind));
  if (!admission.admitted) throw new Error(admission.problems.join("; "));
  return admission.extraction;
}

export function donePage(input: OcrPageInput, name?: string, pageKind?: OcrPageKind) {
  return OcrPageOutcomeSchema.parse({ state: "done",
    runId: `00000000-0000-4000-8000-${String(input.sourcePage + 300).padStart(12, "0")}`,
    itemId: ocrExtractionItemId(input), output: bindOcrPageReading(input, admittedPage(input, name, pageKind)) });
}
