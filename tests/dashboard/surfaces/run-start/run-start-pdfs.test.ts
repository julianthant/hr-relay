import { expect, it } from "vitest";
import { previewPdfRun } from "../../../../src/dashboard/surfaces/run-start/run-start-pdfs.js";
import { I9CheckStartInput, I9_CHECK_START_EXAMPLE } from "../../../../src/models/workflows/i9-check/start.js";
import { i9CheckStartWorkflow } from "../../../../src/workflows/i9-check-start/workflow.js";
import { OcrSourceUploadSchema } from "../../../../src/models/ocr/review.js";

it("plans all attached PDFs as one strict parent input and retains their reading identities across confirmation", () => {
  const surface = i9CheckStartWorkflow.surfaces?.uploadRun;
  expect(surface).toBeDefined();
  if (surface === undefined) throw new Error("PDF start not declared");
  const original = I9_CHECK_START_EXAMPLE.documents[0];
  const files = [original, { ...original, readingId: "00000000-0000-4000-8000-000000000099", fileName: "second.pdf",
    document: { ...original.document, id: "00000000-0000-4000-8000-000000000098", sha256: "c".repeat(64) } }].map(file => ({ readingId: file.readingId,
      source: OcrSourceUploadSchema.parse({ artifact: file.document, fileName: file.fileName, uploadedAt: "2026-11-03T00:00:00.000Z", uploadedBy: "local-operator" }) }));
  const draft = { files, asOf: "2026-11-03", reviewer: "Example Reviewer" };
  const preview = previewPdfRun(surface, draft);
  expect(preview.entries).toHaveLength(1);
  expect(preview.submissions).toHaveLength(1);
  const input = I9CheckStartInput.parse(preview.submissions[0]);
  expect(input.documents.map(file => [file.fileName, file.readingId])).toEqual(files.map(file => [file.source.fileName, file.readingId]));
  expect(input).toMatchObject({ asOf: draft.asOf, reviewerName: draft.reviewer });
  expect(previewPdfRun(surface, structuredClone(draft))).toEqual(preview);
  expect(previewPdfRun(surface, null).submissions).toHaveLength(0);
  expect(previewPdfRun(surface, { ...draft, files: [] }).entries).toHaveLength(0);
});
