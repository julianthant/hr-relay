import assert from "node:assert/strict";
import { it } from "vitest";
import { initialOcrReviewRecords } from "../../../src/models/ocr/review.js";
import { OcrResultSchema } from "../../../src/models/workflows/ocr/result.js";
import { buildOcrReviewSeed } from "../../../src/models/workflows/ocr/review-seed.js";
import { accountOcrPages, bindOcrPageReading } from "../../../src/models/workflows/ocr/page-accounting.js";
import { ocrLookupRequests, bindOcrLookupOutcomes, ocrLookupItemId } from "../../../src/models/workflows/ocr/lookup.js";
import { admitOcrExtraction } from "../../../src/models/ocr/extraction.js";
import { ReadActiveStatus } from "../../../src/models/workflows/person-lookup/read-active-status.js";
import { donePage, sourceFixture, submittedPage, READING_ID } from "../../support/fixtures/ocr/source-pages.js";

function result(documentEid?: string) {
  const { manifest, inputs } = sourceFixture(1);
  const page = inputs[0]; assert.ok(page);
  const submitted = submittedPage(page); assert.ok(submitted.record);
  const admission = admitOcrExtraction({ ...submitted, record: { answers: { ...submitted.record.answers,
    ...(documentEid === undefined ? {} : { "employee.employeeId": { state: "read", raw: documentEid, confidence: 1 } }) } } });
  assert.ok(admission.admitted);
  const review = buildOcrReviewSeed({ accounting: accountOcrPages(manifest, READING_ID,
    [{ ...donePage(page), output: bindOcrPageReading(page, admission.extraction) }]), roster: null });
  const request = ocrLookupRequests(review)[0]; assert.ok(request);
  return OcrResultSchema.parse({ review, identities: bindOcrLookupOutcomes(review, [{ state: "done",
    itemId: ocrLookupItemId(request.input), runId: "00000000-0000-4000-8000-000000000777", output: {
      activeStatus: { ...ReadActiveStatus.example, ucpathSelection: "resolved", state: "found", candidateEids: ["10800000"],
        code: null, reason: "Verified in UCPath.",
        details: { ...ReadActiveStatus.example.details, ucpath: "Found", foundInUcpath: true, eid: "10800000", name: "Example, Avery" } },
      crmDates: { state: "not-requested" },
    } }]) });
}

it("retains a proved UCPath identity in the initial review without requiring a correction", () => {
  assert.equal(initialOcrReviewRecords(result())[0]?.assertedEid, "10800000");
});
it("holds a resolved lookup whose name conflicts with or cannot corroborate the document", () => {
  const seed = result();
  const identity = seed.identities[0]; assert.ok(identity && identity.outcome.state === "done" && "activeStatus" in identity.outcome.output);
  identity.outcome.output.activeStatus.details.name = "Example, Morgan";
  assert.equal(initialOcrReviewRecords(seed)[0]?.assertedEid, null);
  identity.outcome.output.activeStatus.details.name = null;
  assert.equal(initialOcrReviewRecords(seed)[0]?.assertedEid, null);
});
it("holds a conflicting document identity and an unresolved lookup for explicit operator review", () => {
  assert.equal(initialOcrReviewRecords(result("10800001"))[0]?.assertedEid, null);
  const seed = result();
  const identity = seed.identities[0]; assert.ok(identity && identity.outcome.state === "done" && "activeStatus" in identity.outcome.output);
  identity.outcome.output.activeStatus.ucpathSelection = "ambiguous";
  assert.equal(initialOcrReviewRecords(seed)[0]?.assertedEid, null);
});
