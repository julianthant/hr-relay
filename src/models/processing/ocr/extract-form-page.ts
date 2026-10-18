/** `ocr/extract-form-page`: a peer of the CLI that builds the same generated instruction and runs the answer through the same admission gate, so there is no second "provider result" shape. */
import { z } from "zod";
import { ArtifactRefSchema } from "../../artifacts/artifacts.js";
import { deriveSchemaHash } from "../../validation/schema-bound-value.js";
import { AdmittedExtractionSchema, SubmittedExtractionSchema } from "../../ocr/extraction.js";
import { OcrFormTypeSchema } from "../../ocr/form-registry.js";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const ExtractFormPageInputSchema = z.strictObject({
  formType: OcrFormTypeSchema,
  /** The page image or single-page PDF being read. */
  page: ArtifactRefSchema,
  /** 1-based page of the source document, carried onto the record. */
  sourcePage: z.number().int().positive(),
});

export const OcrExtractionRequestSchema = ExtractFormPageInputSchema.extend({ instruction: z.string().min(1) });
export const OCR_EXTRACTION_REQUEST_HASH = deriveSchemaHash(OcrExtractionRequestSchema, "input");
export const OCR_EXTRACTION_RESPONSE_HASH = deriveSchemaHash(SubmittedExtractionSchema, "output");

export const ExtractFormPage = defineTaskContract({
  id: taskId("ocr/extract-form-page"),
  title: "Reading form page",
  effect: "read",
  input: ExtractFormPageInputSchema,
  output: AdmittedExtractionSchema,
  errorCodes: [
    "provider-unavailable",
    "incomplete-extraction",
    "unreadable-page",
  ],
  subject: {
    kind: "none",
    reason: "the extraction resolves identity rather than confirming a known subject",
  },
  freshness: {
    // Four hours: long enough that a same-batch replay reuses the read, short
    // enough that a model change cannot silently ride into a later write.
    defaultMaxAgeMs: 4 * 60 * 60 * 1000,
    defaultOverride: "forbidden",
  },
  provenance: { default: "live" },
  providers: ["ocr.extract"],
  artifacts: "content-addressed",
  scenarios: [
    "ocr/extract/complete",
    "ocr/extract/illegible-mandatory",
    "ocr/extract/skipped-field-refused",
    "ocr/extract/provider-unavailable",
  ],
  example: {
    formType: "oath",
    source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "fixture-1" },
    readAt: "2026-08-06T09:00:00.000Z",
    sourceSha256: "3f1c0a2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
    sourcePage: 1,
    pageKind: "oath",
    record: {
      answers: [
        { state: "read", path: "employeeId", raw: "10873698", value: "10873698", confidence: 0.93 },
        { state: "read", path: "employeeSigned", raw: "yes", value: true, confidence: 0.99 },
        { state: "absent", path: "officerSigned", reason: "blank" },
        { state: "read", path: "printedName", raw: "Battistessa, Johnnie", value: "Battistessa, Johnnie", confidence: 0.97 },
        { state: "read", path: "signatureDate", raw: "07/21/2026", value: "2026-07-21", confidence: 0.95 },
      ],
      blockingPaths: ["officerSigned"],
      answersFingerprint: "933d327efcaa17cab1a137969fac76a6379f8eb3cabab2ebecd6240518b2746e",
    },
    pageFingerprint: "48632e1a2505e1b77b9f5aa1f2d0f78237ac8fc04ff2bcd935a52366d74e4947",
  },
});
