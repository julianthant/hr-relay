import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { admitOcrExtraction } from "../../../../src/models/ocr/extraction.js";
import { accountOcrPages, bindManualOcrPageReading, bindOcrPageReading, OcrPageOutcomeSchema } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { buildOcrReviewSeed, OcrReviewSeedSchema, OcrRosterEvidenceSchema } from "../../../../src/models/workflows/ocr/review-seed.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { DOCUMENT, donePage, READ_AT, READING_ID, SOURCE_RUN_ID, sourceFixture, submittedPage } from "../../../support/fixtures/ocr/source-pages.js";

describe("OCR explicit review seed", () => {
  it("retains separate duplicate pages, unresolved names, typed absences and original fields", () => {
    const { manifest, inputs } = sourceFixture(3);
    const outcomes = [donePage(inputs[0]), donePage(inputs[1]), donePage(inputs[2], "A")];
    const seed = buildOcrReviewSeed({ sourceRunId: SOURCE_RUN_ID, accounting: accountOcrPages(manifest, READING_ID, outcomes), roster: null });
    assert.equal(seed.records.length, 3);
    assert.equal(seed.grouping.subjects[0].completeness, "duplicate");
    assert.deepEqual(seed.grouping.subjects[0].pages.map(page => page.sourcePage), [1, 2]);
    assert.deepEqual(seed.grouping.unidentified, [3]);
    assert.notEqual(seed.records[0].recordId, seed.records[1].recordId);
    assert.equal(seed.records[0].recordId, `${DOCUMENT.sha256}#emergency-contact#1`);
    assert.deepEqual(seed.records[0].issues, ["duplicate-subject", "identity-unverified"]);
    assert.deepEqual(seed.records[2].issues, ["unidentified-subject", "identity-unverified"]);
    assert.equal(seed.records[0].fields.answers.find(answer => answer.path === "contact.address1")?.state, "absent");
    assert.equal(Object.isFrozen(seed.records[0].fields.answers), true);
    assert.throws(() => { seed.records[0].fields.answers.pop(); });
  });

  it("proposes roster matches with source evidence and preserves conflicts, ties and no-match", () => {
    const { manifest, inputs } = sourceFixture(4);
    const names = ["Example, Avery", "Conflict, Casey", "Tie, Taylor", "Unknown, Morgan"];
    const outcomes = inputs.map((input, index) => {
      if (index !== 1) return donePage(input, names[index]);
      const submitted = submittedPage(input, names[index]);
      if (submitted.record === null) throw new Error("expected contact record");
      submitted.record.answers["employee.employeeId"] = { state: "read", raw: "10000001", confidence: 0.9 };
      const admission = admitOcrExtraction(submitted);
      if (!admission.admitted) throw new Error("expected admitted assertion");
      return OcrPageOutcomeSchema.parse({ ...donePage(input), output: bindOcrPageReading(input, admission.extraction) });
    });
    const roster = OcrRosterEvidenceSchema.parse({ artifact: { ...DOCUMENT, mediaType: "text/csv" }, readAt: READ_AT,
      rows: [
        { sourceRow: 2, eid: "10000002", name: names[0] },
        { sourceRow: 3, eid: "10000003", name: names[1] },
        { sourceRow: 4, eid: "10000004", name: names[2] },
        { sourceRow: 5, eid: "10800000", name: names[2] },
      ] });
    const seed = buildOcrReviewSeed({ sourceRunId: SOURCE_RUN_ID, accounting: accountOcrPages(manifest, READING_ID, outcomes), roster });
    assert.deepEqual(seed.records.map(record => record.rosterMatch?.mismatch), ["none", "name-eid-conflict", "ambiguous", "no-match"]);
    assert.equal(seed.records[0].assertedEid, null);
    assert.deepEqual(seed.records[0].lookup, { state: "required", name: names[0], eid: "10000002" });
    assert.equal(seed.records[1].assertedEid, EidSchema.parse("10000001"));
    assert.equal(seed.records[1].rosterMatch?.matchedEid, null);
    assert.deepEqual(seed.roster, roster);
    assert.equal(seed.records.every(record => record.issues.includes("identity-unverified")), true);
    assert.equal(OcrRosterEvidenceSchema.safeParse({ ...roster, rows: [roster.rows[0], roster.rows[0]] }).success, false);
  });

  it("keeps manual identity unverified and mandatory illegible fields visible", () => {
    const { manifest, inputs } = sourceFixture(1);
    const submitted = submittedPage(inputs[0]);
    if (submitted.record === null) throw new Error("expected contact record");
    submitted.record.answers["employee.name"] = { state: "absent", reason: "illegible" };
    submitted.record.answers["contact.name"] = { state: "absent", reason: "illegible" };
    const reading = bindManualOcrPageReading(inputs[0], "local-operator", { ...submitted, source: { kind: "operator", actorId: "local-operator" } });
    const outcome = OcrPageOutcomeSchema.parse({ ...donePage(inputs[0]), output: reading });
    const seed = buildOcrReviewSeed({ sourceRunId: SOURCE_RUN_ID, accounting: accountOcrPages(manifest, READING_ID, [outcome]), roster: null });
    assert.equal(seed.records[0].identitySource, "operator");
    assert.deepEqual(seed.records[0].lookup, { state: "unavailable", reason: "missing-identity" });
    assert.deepEqual(seed.records[0].fields.blockingPaths, ["contact.name", "employee.name"]);
    assert.deepEqual(seed.records[0].issues, ["mandatory-fields", "unidentified-subject", "identity-unverified"]);
  });

  it("keeps empty documents explicit and refuses invented review fields, record identity or roster matches", () => {
    const { manifest, inputs } = sourceFixture(1);
    const empty = buildOcrReviewSeed({ sourceRunId: SOURCE_RUN_ID,
      accounting: accountOcrPages(manifest, READING_ID, [donePage(inputs[0], "Example, Avery", "blank")]), roster: null });
    assert.deepEqual(empty.records, []);
    assert.deepEqual(empty.pages, [{ sourcePage: 1, disposition: "blank" }]);
    const seed = buildOcrReviewSeed({ sourceRunId: SOURCE_RUN_ID,
      accounting: accountOcrPages(manifest, READING_ID, [donePage(inputs[0])]), roster: null });
    assert.equal(OcrReviewSeedSchema.safeParse({ ...seed, records: [] }).success, false);
    assert.equal(OcrReviewSeedSchema.safeParse({ ...seed, records: [{ ...seed.records[0], issues: ["identity-unverified"], sourcePage: 2 }] }).success, false);
    assert.equal(OcrReviewSeedSchema.safeParse({ ...seed, pages: [{ sourcePage: 1, disposition: "failed" }] }).success, false);
    assert.equal(OcrReviewSeedSchema.safeParse({ ...seed, records: [{ ...seed.records[0], assertedEid: "10000001" }] }).success, false);
    assert.equal(OcrReviewSeedSchema.safeParse({ ...seed, approved: true }).success, false);
    const outcome = seed.accounting.outcomes[0];
    if (outcome.state !== "done" || outcome.output.extraction.record === null) throw new Error("expected source record");
    const altered = { ...outcome, output: { ...outcome.output, extraction: { ...outcome.output.extraction,
      record: { ...outcome.output.extraction.record, answers: outcome.output.extraction.record.answers.map(answer =>
        answer.path === "employee.employeeId" ? { state: "read", path: answer.path, raw: "bad EID", value: "bad EID", confidence: 1 } : answer) },
    } } };
    assert.equal(OcrReviewSeedSchema.safeParse({ ...seed, accounting: { ...seed.accounting, outcomes: [altered] } }).success, false);
  });

  it("retains all-failed pages without inventing extracted records or classifications", () => {
    const { manifest, inputs } = sourceFixture(1);
    const child = donePage(inputs[0]);
    const outcome = OcrPageOutcomeSchema.parse({ state: "failed", runId: child.runId, itemId: child.itemId,
      failureId: "00000000-0000-4000-8000-000000000777" });
    const seed = buildOcrReviewSeed({ sourceRunId: SOURCE_RUN_ID, accounting: accountOcrPages(manifest, READING_ID, [outcome]), roster: null });
    assert.deepEqual(seed.records, []);
    assert.deepEqual(seed.pages, [{ sourcePage: 1, disposition: "failed" }]);
    assert.deepEqual(seed.grouping, { formType: "emergency-contact", subjects: [], unidentified: [], otherForms: [], dataless: [] });
  });
});
