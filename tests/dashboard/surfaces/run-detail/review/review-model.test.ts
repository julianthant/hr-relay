import assert from "node:assert/strict";
import { it } from "vitest";
import { correctedOcrRecord, ocrReviewCards } from "../../../../../src/dashboard/surfaces/run-detail/review/review-model.js";
import { ocrReviewPageFixture } from "../../../../support/fixtures/dashboard/ocr-review.js";

it("re-admits operator corrections without changing other answers or original source evidence", () => {
  const page = ocrReviewPageFixture(); assert.ok(page.ocr);
  const before = structuredClone(page), record = page.ocr.revision.records[0];
  const corrected = correctedOcrRecord(page, record.recordId, { "contact.name": "Edited Contact", "employee.employeeId": "10800000" });
  assert.equal(corrected.assertedEid, "10800000");
  assert.deepEqual(corrected.fields.answers.find(answer => answer.path === "contact.name"), {
    state: "read", path: "contact.name", raw: "Edited Contact", value: "Edited Contact", confidence: 1,
  });
  assert.deepEqual(corrected.fields.answers.filter(answer => !["contact.name", "employee.employeeId"].includes(answer.path)),
    record.fields.answers.filter(answer => !["contact.name", "employee.employeeId"].includes(answer.path)));
  assert.notEqual(corrected.fields.answersFingerprint, record.fields.answersFingerprint);
  assert.deepEqual(page, before);
  const invalid = correctedOcrRecord(page, record.recordId, { "employee.employeeId": "123" });
  assert.equal(invalid.assertedEid, null);
  assert.equal(invalid.fields.answers.find(answer => answer.path === "employee.employeeId")?.state, "unreadable");
  assert.throws(() => correctedOcrRecord(page, record.recordId, { "foreign.field": "forged" }), /RUN_REVIEW_FIELD_UNAVAILABLE/u);
  assert.throws(() => correctedOcrRecord(page, "foreign-record", {}), /RUN_REVIEW_SOURCE_UNAVAILABLE/u);
});

it("keeps source identity stable across revisions and maps drafts without changing persisted fields", () => {
  const page = ocrReviewPageFixture(); assert.ok(page.ocr);
  const record = page.ocr.revision.records[0];
  const url = (runId: string, revision: number, sourcePage: number) => `/runs/${runId}/pages/${sourcePage}?revision=${revision}`;
  const original = ocrReviewCards(page, url);
  const edited = ocrReviewCards(page, url, { [record.recordId]: { "contact.name": "Unsaved" } });
  assert.equal(edited[0].record.fields.find(field => field.key === "contact.name")?.value, "Unsaved");
  const answer = record.fields.answers.find(answer => answer.path === "contact.name"); assert.ok(answer?.state === "read");
  assert.equal(original[0].record.fields.find(field => field.key === "contact.name")?.value, String(answer.value));
  const next = ocrReviewCards(ocrReviewPageFixture(page.runId, 2), url);
  assert.equal(next[0].pages[0].identity, original[0].pages[0].identity);
  assert.notEqual(next[0].pages[0].imageUrl, original[0].pages[0].imageUrl);
  assert.equal(original[0].record.fields.find(field => field.key === "contact.relationship")?.kind, "relationship");
});
