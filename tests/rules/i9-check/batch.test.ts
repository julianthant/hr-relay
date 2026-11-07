import { expect, it } from "vitest";
import { i9CheckApprovedPeople, i9CheckPersonRequests, i9CheckBatchRows } from "../../../src/rules/i9-check/batch.js";
import { I9CheckStartInput, i9CheckStartMatchKey, I9_CHECK_REFERENCE } from "../../../src/models/workflows/i9-check/start.js";
import { ReadI9CheckRows } from "../../../src/models/workflows/i9-check-start/read-rows.js";
import { WorkbookReferenceReadSchema } from "../../../src/models/processing/workbooks/read-reference.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { deriveItemId } from "../../../src/rules/identity/logical-item.js";
import { i9CheckMatchKey } from "../../../src/models/workflows/i9-check/input.js";
import { i9RetentionRow } from "../../../src/rules/i9-check/retention.js";
import { i9ApprovedSource } from "../../support/fixtures/i9-check-start.js";
import { i9Search } from "../../support/fixtures/i9-check.js";
import { operatorOcrFields, operatorOcrRecordId, OcrApprovedSnapshotSchema } from "../../../src/models/ocr/review.js";
import { OcrOperatorPagesSchema } from "../../../src/models/ocr/review-record.js";
import { SubmittedRecordSchema } from "../../../src/models/ocr/extraction.js";

function fixture() {
  const first = i9ApprovedSource(1, [{ eid: "10000001", kind: "i9-section1", dob: "01/15/2000" }, { eid: "10000001", kind: "i9-section2", hireDate: "06/01/2020" }]);
  const second = i9ApprovedSource(2, [{ eid: "10000002", firstName: "Blair", kind: "i9-section2", hireDate: "06/01/2020" }]);
  const request = I9CheckStartInput.parse({ documents: [first.requestDocument, second.requestDocument], asOf: "2026-11-01", reviewerName: "Example Reviewer" });
  const selection = { state: "ready" as const, sources: [first.source, second.source] };
  return { request, selection, people: i9CheckApprovedPeople({ request, selection }) };
}

it("retains both approved section coordinates for one operator-added I-9 person without inventing extraction membership", () => {
  const f = i9ApprovedSource(1, [{ eid: "10000001", kind: "i9-section1", dob: "01/15/2000" },
    { eid: "10000001", kind: "i9-section2", hireDate: "06/01/2020" }]);
  const [first, second] = f.source.snapshot.records;
  if (first === undefined || second === undefined) throw new Error("Missing paired fixture");
  const seed = { review: f.source.review, identities: [] }, commandId = "00000000-0000-4000-8000-000000000906";
  const pages = OcrOperatorPagesSchema.parse([{ pageKind: "i9-section1", sourcePage: 1 }, { pageKind: "i9-section2", sourcePage: 2 }]);
  const values = SubmittedRecordSchema.parse({ answers: Object.fromEntries(first.fields.answers.map(answer => {
    const held = answer.state === "absent" && answer.reason === "not-on-form" ? second.fields.answers.find(other => other.path === answer.path) : answer;
    if (held === undefined) throw new Error("Missing paired field");
    return [held.path, held.state === "absent" ? { state: "absent", reason: held.reason } : { state: "read", raw: held.raw, confidence: held.confidence }];
  })) }).answers;
  const manual = { recordId: operatorOcrRecordId(seed, commandId), assertedEid: first.assertedEid, discarded: false,
    fields: operatorOcrFields(seed, pages, values, f.source.snapshot.approvedAt),
    provenance: { kind: "operator-added", commandId, createdAt: f.source.snapshot.approvedAt, pages } };
  const snapshot = OcrApprovedSnapshotSchema.parse({ ...f.source.snapshot, selectedRecordIds: [manual.recordId], records: [manual] });
  const request = I9CheckStartInput.parse({ documents: [f.requestDocument], asOf: "2026-11-01", reviewerName: "Example Reviewer" });
  const people = i9CheckApprovedPeople({ request, selection: { state: "ready", sources: [{ ...f.source, snapshot }] } });
  expect(f.source.review.records.some(record => record.recordId === manual.recordId)).toBe(false);
  expect(people.people).toHaveLength(1);
  expect(people.people[0].person).toMatchObject({ dob: "2000-01-15", hireDate: "2020-06-01", sourcePages: [1, 2] });
  expect(people.people[0].sources.map(source => [source.recordId, source.sourcePage])).toEqual([[manual.recordId, 1], [manual.recordId, 2]]);
  expect(() => i9CheckApprovedPeople({ request, selection: { state: "ready", sources: [{ ...f.source,
    snapshot: { ...snapshot, records: [{ ...manual, provenance: undefined }] } }] } })).toThrow("ocr-review-record-source-missing");
});
function reference(f: ReturnType<typeof fixture>) {
  return WorkbookReferenceReadSchema.shape.reference.parse({ request: { typeId: "action-history", libraryId: "action-history", versionId: "earlier-version",
    keys: f.people.people.map(person => person.eid), fields: [...I9_CHECK_REFERENCE.fields] }, snapshot: { libraryId: "action-history", version: 8, versionId: "earlier-version", versionName: "Fall review",
    type: { id: "action-history", name: "Action History", keyFieldId: "eid", fields: [...I9_CHECK_REFERENCE.fields], defaultWorkbookId: "action-history" }, worksheets: [{ sheetId: "history", name: "Action History" }],
    rows: f.people.people.map(person => ({ key: person.eid, state: "matched", matches: [{ sheetId: "history", rowId: `history-${person.eid}`,
      values: [{ fieldId: "eid", value: person.eid }, { fieldId: "ppsEid", value: "000012345" },
        { fieldId: "separationDate", value: { type: "date", value: "2024-01-01T00:00:00.000Z" } }, { fieldId: "roster.action", value: "TER" }] }] })),
  } });
}
it("groups sections from multiple PDFs into one person each while retaining source coordinates and immutable version facts", () => {
  const f = fixture();
  expect(f.people.people).toHaveLength(2);
  expect(new Set(f.people.people.map(person => person.recordId)).size).toBe(2);
  for (const person of f.people.people) expect(person.recordId).not.toContain(person.eid);
  expect(f.people.people[0].person).toMatchObject({ name: "Example, Avery", dob: "2000-01-15", hireDate: "2020-06-01", useMatch: true, sourcePages: [1, 2] });
  expect(f.people.people[0].sources.map(source => source.sourcePage)).toEqual([1, 2]);
  expect(f.people.people[1].person.useMatch).toBe(false);
  const prepared = i9CheckPersonRequests({ request: f.request, people: f.people, reference: { state: "read", referenceDigest: FingerprintSchema.parse("a".repeat(64)), reference: reference(f) } });
  expect(prepared.children.map(child => child.roster.rows[0])).toEqual([
    { eid: "10000001", ppsEid: "000012345", separationDate: "2024-01-01", action: "TER" },
    { eid: "10000002", ppsEid: "000012345", separationDate: "2024-01-01", action: "TER" },
  ]);
  expect(prepared.reference.snapshot).toMatchObject({ versionId: "earlier-version", versionName: "Fall review" });
  expect(prepared.reference.snapshot.rows[0].matches[0]).toMatchObject({ sheetId: "history", rowId: "history-10000001" });
});
it("merges the same approved person across PDFs and refuses contradictory identifiers or incomplete source accounting", () => {
  const f = fixture(), first = f.selection.sources[0];
  const other = i9ApprovedSource(3, [{ eid: "10000001", kind: "i9-section2", hireDate: "06/01/2020" }]);
  const request = I9CheckStartInput.parse({ ...f.request, documents: [f.request.documents[0], other.requestDocument] });
  const people = i9CheckApprovedPeople({ request, selection: { state: "ready", sources: [first, other.source] } });
  expect(people.people).toHaveLength(1);
  expect(people.people[0].sources).toHaveLength(3);
  expect(people.people[0].person.sourcePages).toEqual([1, 2]);
  const contradicts = i9ApprovedSource(4, [{ eid: "10000001", kind: "i9-section1", dob: "01/15/2001" }]);
  expect(() => i9CheckApprovedPeople({ request: { ...request, documents: [request.documents[0], contradicts.requestDocument] },
    selection: { state: "ready", sources: [first, contradicts.source] } })).toThrow("i9-check-contradictory-person-fields");
  const partial = i9ApprovedSource(5, [{ eid: "10000001", kind: "i9-section1" }, { eid: "10000001", kind: "i9-section2", failed: true }]);
  expect(() => i9CheckApprovedPeople({ request: { ...request, documents: [partial.requestDocument] }, selection: { state: "ready", sources: [partial.source] } })).toThrow("i9-check-incomplete-source-accounting");
  expect(() => i9CheckApprovedPeople({ request, selection: { state: "ready", sources: [first, first] } })).toThrow();
  expect(() => i9CheckApprovedPeople({ request, selection: { state: "refused", code: "OCR_REVIEW_REFUSED" } })).toThrow();
});
it("rejects roster membership, malformed dates and missing fields rather than inventing retention facts", () => {
  const f = fixture(), facts = reference(f);
  expect(() => i9CheckPersonRequests({ request: f.request, people: f.people, reference: { state: "read", referenceDigest: FingerprintSchema.parse("a".repeat(64)), reference: { ...facts, snapshot: { ...facts.snapshot, rows: facts.snapshot.rows.toReversed() } } } })).toThrow("i9-check-reference-membership-mismatch");
  for (const field of ["eid", "ppsEid", "separationDate", "roster.action"]) {
    const rows = facts.snapshot.rows.map(row => ({ ...row, matches: row.matches.map(match => ({ ...match, values: match.values.filter(cell => cell.fieldId !== field) })) }));
    expect(() => i9CheckPersonRequests({ request: f.request, people: f.people, reference: { state: "read", referenceDigest: FingerprintSchema.parse("a".repeat(64)), reference: { ...facts, snapshot: { ...facts.snapshot, rows } } } })).toThrow("i9-check-reference-field-unavailable");
  }
  const rows = facts.snapshot.rows.map(row => ({ ...row, matches: row.matches.map(match => ({ ...match, values: match.values.map(cell => cell.fieldId === "separationDate" ? { ...cell, value: "invalid" } : cell) })) }));
  expect(() => i9CheckPersonRequests({ request: f.request, people: f.people, reference: { state: "read", referenceDigest: FingerprintSchema.parse("a".repeat(64)), reference: { ...facts, snapshot: { ...facts.snapshot, rows } } } })).toThrow("i9-check-roster-date-invalid");
});
it("accepts exact numeric spreadsheet IDs while preserving text IDs and refusing fractional IDs", () => {
  const f = fixture(), facts = reference(f);
  const numeric = (pps: number) => ({ ...facts, snapshot: { ...facts.snapshot, rows: facts.snapshot.rows.map(row => ({ ...row, matches: row.matches.map(match => ({ ...match,
    values: match.values.map(cell => cell.fieldId === "eid" ? { ...cell, value: Number(row.key) } : cell.fieldId === "ppsEid" ? { ...cell, value: pps } : cell),
  })) })) } });
  expect(i9CheckPersonRequests({ request: f.request, people: f.people, reference: { state: "read", referenceDigest: FingerprintSchema.parse("a".repeat(64)), reference: numeric(12345) } })
    .children.map(child => child.roster.rows[0].ppsEid)).toEqual(["12345", "12345"]);
  expect(() => i9CheckPersonRequests({ request: f.request, people: f.people, reference: { state: "read", referenceDigest: FingerprintSchema.parse("a".repeat(64)), reference: numeric(12345.5) } })).toThrow();
});
it("accounts for every person child and refuses failed, foreign, reordered or mismatched employee outcomes", () => {
  const f = fixture(), prepared = i9CheckPersonRequests({ request: f.request, people: f.people, reference: { state: "read", referenceDigest: FingerprintSchema.parse("a".repeat(64)), reference: reference(f) } });
  const outcomes = prepared.children.map((child, index) => ({ state: "done", itemId: deriveItemId("i9-check", i9CheckMatchKey(child)),
    runId: `00000000-0000-4000-8000-${String(index + 900).padStart(12, "0")}`,
    output: i9RetentionRow({ input: child, initial: { status: "found", eid: prepared.people[index].eid, name: child.person.name } }),
  }));
  const input = ReadI9CheckRows.input.parse({ batchKey: i9CheckStartMatchKey(f.request), prepared, outcomes });
  const rows = i9CheckBatchRows(input);
  expect(rows.personCount).toBe(2);
  expect(rows.tracker.rows.map(row => row.action)).toEqual(["Keep", "Keep"]);
  expect(JSON.stringify(rows.tracker)).not.toContain("dateOfBirth");
  expect(() => i9CheckBatchRows({ ...input, outcomes: input.outcomes.slice(1) })).toThrow("i9-check-child-membership-mismatch");
  expect(() => i9CheckBatchRows({ ...input, outcomes: input.outcomes.toReversed() })).toThrow("i9-check-child-result-mismatch");
  const failed = ReadI9CheckRows.input.parse({ ...input, outcomes: [{ state: "failed", itemId: input.outcomes[0].itemId, runId: input.outcomes[0].runId,
    failureId: "00000000-0000-4000-8000-000000000999" }, input.outcomes[1]] });
  expect(() => i9CheckBatchRows(failed)).toThrow("i9-check-child-result-mismatch");
  const first = input.outcomes[0];
  if (first.state !== "done") throw new Error("Missing completed fixture child");
  for (const altered of [
    { ...first, itemId: input.outcomes[1].itemId },
    { ...first, output: { ...first.output, row: { ...first.output.row, recordId: "foreign" } } },
    { ...first, output: { ...first.output, identity: { status: "found", eid: "10000002", name: "Foreign Person" } } },
  ]) expect(() => i9CheckBatchRows(ReadI9CheckRows.input.parse({ ...input, outcomes: [altered, input.outcomes[1]] }))).toThrow("i9-check-child-result-mismatch");
  const absent = i9RetentionRow({ input: prepared.children[0], initial: { status: "not-found", candidateCount: 0 }, search: i9Search([]) });
  const notFound = i9CheckBatchRows(ReadI9CheckRows.input.parse({ ...input, outcomes: [{ ...first, output: absent }, input.outcomes[1]] }));
  expect(notFound.personCount).toBe(2);
  expect(notFound.tracker.rows[0]).toMatchObject({ foundInUcpath: "Not found in UCPath", action: "Shred" });
});
