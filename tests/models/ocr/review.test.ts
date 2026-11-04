import assert from "node:assert/strict";
import { it } from "vitest";
import { initialOcrReviewRecords, rebuildOcrReviewRecords } from "../../../src/models/ocr/review.js";
import { OcrResultSchema } from "../../../src/models/workflows/ocr/result.js";
import { buildOcrReviewSeed } from "../../../src/models/workflows/ocr/review-seed.js";
import { accountOcrPages, bindOcrPageReading, ocrExtractionItemId, OcrPageOutcomeSchema } from "../../../src/models/workflows/ocr/page-accounting.js";
import { ocrLookupRequests, bindOcrLookupOutcomes, ocrLookupItemId } from "../../../src/models/workflows/ocr/lookup.js";
import { admitOcrExtraction } from "../../../src/models/ocr/extraction.js";
import { ReadActiveStatus } from "../../../src/models/workflows/person-lookup/read-active-status.js";
import { EidSchema, PositiveIntSchema } from "../../../src/rules/identity/ids.js";
import { correctOcrField, donePage, sourceFixture, submittedPage, READING_ID } from "../../support/fixtures/ocr/source-pages.js";

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

function correctedReview() {
  const seed = result();
  const page = seed.review.accounting.outcomes[0]; assert.ok(page?.state === "done");
  const records = initialOcrReviewRecords(seed).map(record => ({ ...record, assertedEid: EidSchema.parse("10800001"), discarded: true,
    fields: correctOcrField(page.output.extraction, "contact.name", "Corrected, Taylor") }));
  return { seed, records, revision: PositiveIntSchema.parse(2) };
}

it("retains corrected fields, discard and asserted identity when a new review has the same record evidence", () => {
  const previous = correctedReview();
  const seed = OcrResultSchema.parse({ ...previous.seed, review: { ...previous.seed.review,
    sourceRunId: "00000000-0000-4000-8000-000000000102" } });
  const rebuilt = rebuildOcrReviewRecords(seed, previous);
  assert.deepEqual(rebuilt.records, previous.records);
  assert.deepEqual(rebuilt.invalidatedCorrections, []);
});

it("resets only changed record evidence and identifies the earlier review choices that no longer apply", () => {
  const previous = correctedReview();
  const seed = OcrResultSchema.parse({ ...previous.seed, identities: previous.seed.identities.map(identity => ({ ...identity,
    outcome: { ...identity.outcome, runId: "00000000-0000-4000-8000-000000000778" } })) });
  const rebuilt = rebuildOcrReviewRecords(seed, previous);
  assert.deepEqual(rebuilt.records, initialOcrReviewRecords(seed));
  assert.deepEqual(rebuilt.invalidatedCorrections, [{ recordId: previous.records[0]?.recordId, sourcePage: 1, revision: 3 }]);
  assert.deepEqual(previous, correctedReview());
});

it("identifies corrections to a record removed by a new page reading", () => {
  const previous = correctedReview();
  const { manifest, inputs } = sourceFixture(1); const page = inputs[0]; assert.ok(page);
  const seed = OcrResultSchema.parse({ review: buildOcrReviewSeed({ accounting: accountOcrPages(manifest, READING_ID,
    [donePage(page, undefined, "blank")]), roster: null }), identities: [] });
  assert.deepEqual(rebuildOcrReviewRecords(seed, previous), { records: [],
    invalidatedCorrections: [{ recordId: previous.records[0]?.recordId, sourcePage: 1, revision: 3 }] });
});

it("retains a record's choices when another page adds a duplicate subject to its shared lookup", () => {
  const { manifest, inputs } = sourceFixture(2); const first = inputs[0], second = inputs[1]; assert.ok(first && second);
  const failed = OcrPageOutcomeSchema.parse({ state: "failed", itemId: ocrExtractionItemId(second),
    runId: "00000000-0000-4000-8000-000000000302", failureId: "00000000-0000-4000-8000-000000000402" });
  const before = buildOcrReviewSeed({ accounting: accountOcrPages(manifest, READING_ID, [donePage(first), failed]), roster: null });
  const after = buildOcrReviewSeed({ accounting: accountOcrPages(manifest, READING_ID, [donePage(first), donePage(second)]), roster: null });
  const outcome = result().identities[0]?.outcome; assert.ok(outcome);
  const previous = { ...correctedReview(), seed: OcrResultSchema.parse({ review: before, identities: bindOcrLookupOutcomes(before, [outcome]) }) };
  const seed = OcrResultSchema.parse({ review: after, identities: bindOcrLookupOutcomes(after, [outcome]) });
  assert.equal(before.records[0]?.issues.includes("duplicate-subject"), false);
  assert.equal(after.records[0]?.issues.includes("duplicate-subject"), true);
  assert.equal(previous.seed.identities[0]?.recordIds.length, 1);
  assert.equal(seed.identities[0]?.recordIds.length, 2);
  const rebuilt = rebuildOcrReviewRecords(seed, previous);
  assert.deepEqual(rebuilt.records[0], previous.records[0]);
  assert.deepEqual(rebuilt.invalidatedCorrections, []);
});
