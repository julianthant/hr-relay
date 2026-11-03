import { OcrInputSchema } from "../../../src/models/workflows/ocr/input.js";
import { OcrApprovedSnapshotSchema } from "../../../src/models/ocr/review.js";
import { admitOcrExtraction, type SubmittedAnswer } from "../../../src/models/ocr/extraction.js";
import { buildOcrSourceManifest, ocrPageInputs, type OcrPageInput } from "../../../src/models/workflows/ocr/source-manifest.js";
import { buildOcrReviewSeed } from "../../../src/models/workflows/ocr/review-seed.js";
import { accountOcrPages, bindOcrPageReading, ocrExtractionItemId, OcrPageOutcomeSchema } from "../../../src/models/workflows/ocr/page-accounting.js";
import { ItemIdSchema, RunIdSchema } from "../../../src/rules/identity/ids.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { sourceFixture, submittedPage, READ_AT } from "./ocr/source-pages.js";

export type I9FixturePage = Readonly<{
  eid: string; firstName?: string; lastName?: string; kind: "i9-section1" | "i9-section2"; dob?: string; hireDate?: string; failed?: boolean;
}>;
export function i9PageSubmission(page: OcrPageInput, facts: I9FixturePage) {
  const submitted = submittedPage(page, undefined, facts.kind);
  if (submitted.record === null) throw new Error("Missing synthetic I-9 page");
  const answers: Record<string, SubmittedAnswer> = { ...submitted.record.answers };
  for (const [path, value] of Object.entries({ firstName: facts.firstName ?? "Avery", lastName: facts.lastName ?? "Example",
    ...(facts.kind === "i9-section1" && facts.dob !== undefined ? { dateOfBirth: facts.dob } : {}),
    ...(facts.kind === "i9-section2" && facts.hireDate !== undefined ? { hireDate: facts.hireDate } : {}),
  })) answers[path] = { state: "read", raw: value, confidence: 1 };
  return { ...submitted, record: { answers } };
}
export function i9ApprovedSource(index: number, pages: readonly I9FixturePage[]) {
  const id = (offset: number) => `00000000-0000-4000-8000-${String(index * 100 + offset).padStart(12, "0")}`;
  const rendered = sourceFixture(pages.length, "i9");
  const document = OcrInputSchema.shape.document.parse({ ...rendered.manifest.document, id: id(1), sha256: sha256Hex(`I-9 synthetic document ${index}`) });
  const manifest = buildOcrSourceManifest(document, { pageCount: pages.length, pages: rendered.manifest.pages });
  const readingId = ItemIdSchema.parse(id(2)), sourceRunId = RunIdSchema.parse(id(3));
  const inputs = ocrPageInputs(manifest, readingId, "i9");
  const outcomes = inputs.map((page, pageIndex) => {
    const facts = pages[pageIndex];
    if (facts.failed === true) return OcrPageOutcomeSchema.parse({ state: "failed", itemId: ocrExtractionItemId(page), runId: id(10 + pageIndex), failureId: id(90) });
    const admitted = admitOcrExtraction(i9PageSubmission(page, facts));
    if (!admitted.admitted) throw new Error(admitted.problems.join("; "));
    return OcrPageOutcomeSchema.parse({ state: "done", runId: id(10 + pageIndex), itemId: ocrExtractionItemId(page), output: bindOcrPageReading(page, admitted.extraction) });
  });
  const review = buildOcrReviewSeed({ sourceRunId, roster: null, accounting: accountOcrPages(manifest, readingId, outcomes, "i9") });
  const records = review.records.map(record => ({ recordId: record.recordId, fields: record.fields,
    assertedEid: pages[record.sourcePage - 1].eid, discarded: false }));
  const snapshot = OcrApprovedSnapshotSchema.parse({ snapshotId: id(4), sourceRunId, revision: 1,
    reviewDigest: sha256Hex(`I-9 synthetic revision ${index}`), selectedRecordIds: records.map(record => record.recordId), records,
    approvedBy: "local-operator", approvedAt: READ_AT });
  return { requestDocument: { document, readingId, fileName: `source-${index}.pdf`, reading: { kind: "subscription" as const } }, source: { snapshot, review } };
}
