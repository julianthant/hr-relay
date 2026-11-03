import assert from "node:assert/strict";
import { it } from "vitest";
import { CrmDownloadedPeopleSchema } from "../../../src/models/systems/crm/document-tasks.js";
import { CrmDocumentRowsSchema, CrmDocumentRowChoiceSchema } from "../../../src/models/workflows/crm-doc-download/read-document-rows.js";
import { bindCrmWorksheetPeople, crmDocumentReferenceKeys, resolveCrmDocumentRows } from "../../../src/rules/crm-doc-download/reference.js";
import { CRM_DOCUMENT_RECORDS_FIXTURE as records, crmDocumentReferenceFixture as reference } from "../../support/fixtures/crm-doc-download.js";

it("resolves an EID-learned email and mixed batch to only their exact worksheet rows and reference names", () => {
  assert.deepEqual(crmDocumentReferenceKeys(records), ["one@example.test", "two@example.test", "other@example.test"]);
  const resolved = resolveCrmDocumentRows(records, reference());
  assert.deepEqual(resolved.map(person => person.resolution.state), ["resolved", "resolved"]);
  assert.deepEqual(resolved.map(person => person.resolution.state === "resolved" ? person.resolution.selected.row : null), [
    { worksheetId: "july", worksheetName: "July 6", rowId: "row-0", names: { legalName: { firstName: "Legal", lastName: "Fixture", middleName: "" }, livedName: null } },
    { worksheetId: "august", worksheetName: "August 2", rowId: "row-1", names: { legalName: { firstName: "Second", lastName: "Fixture", middleName: "" }, livedName: null } },
  ]);
});

it("keeps missing rows and every duplicate or alternative-email match unresolved", () => {
  const missing = reference(); missing.snapshot.rows[0] = { key: "one@example.test", state: "missing", matches: [] };
  assert.deepEqual(resolveCrmDocumentRows(records, missing)[0]?.resolution, { state: "resolve-required", reason: "row-missing", candidates: [] });
  const duplicate = reference(), row = duplicate.snapshot.rows[0]; assert.ok(row?.matches[0]);
  row.state = "ambiguous"; row.matches.push({ ...row.matches[0], sheetId: "august", rowId: "duplicate" });
  const ambiguous = resolveCrmDocumentRows(records, duplicate)[0]?.resolution;
  assert.equal(ambiguous?.state, "resolve-required");
  assert.equal(ambiguous?.state === "resolve-required" && ambiguous.candidates.length, 2);
  const alternative = reference(), other = alternative.snapshot.rows[2], source = alternative.snapshot.rows[1]?.matches[0]; assert.ok(other && source);
  other.state = "matched"; other.matches.push({ ...source, rowId: "alternative", values: { ...source.values, email: other.key } });
  assert.equal(resolveCrmDocumentRows(records, alternative)[1]?.resolution.state, "resolve-required");
});

it("refuses unverified identities, absent verified email, missing names and foreign or repeated membership", () => {
  const first = records.records[0]; assert.ok(first);
  for (const identity of [{ ...first.identity, eid: "10000009" }, { ...first.identity, workEmail: null }]) {
    assert.throws(() => crmDocumentReferenceKeys({ records: [{ ...first, identity }] }));
  }
  for (const change of ["name", "foreign", "duplicate", "key"] as const) {
    const value = reference(), row = value.snapshot.rows[0], match = row?.matches[0]; assert.ok(row && match);
    if (change === "name") match.values.firstName = null;
    if (change === "foreign") match.sheetId = "foreign";
    if (change === "duplicate") { row.state = "ambiguous"; row.matches.push({ ...match }); }
    if (change === "key") match.values.email = "foreign@example.test";
    assert.throws(() => resolveCrmDocumentRows(records, value));
  }
});

it("binds each downloaded identity to its retained row and refuses swapped PDFs or fabricated row choices", () => {
  const downloads = CrmDownloadedPeopleSchema.parse({ people: records.records.map(person => ({ ...person, totalDocuments: 1,
    documents: [{ index: 0, fileName: "Signed Offer Letter.pdf", artifact: {
      id: "11111111-1111-4111-8111-111111111111", sha256: "a".repeat(64), bytes: 10, mediaType: "application/pdf",
    } }],
  })) });
  const value = reference(), first = value.snapshot.rows[0], match = first?.matches[0]; assert.ok(first && match);
  first.state = "ambiguous"; first.matches.push({ ...match, sheetId: "august", rowId: "operator-choice" });
  const rows = CrmDocumentRowsSchema.parse({ referenceDigest: "a".repeat(64), state: "resolve-required", people: resolveCrmDocumentRows(records, value) });
  assert.throws(() => bindCrmWorksheetPeople(downloads, rows));
  const choice = CrmDocumentRowChoiceSchema.parse({ ...rows, state: "resolved", decision: "selected", people: rows.people.map(person => {
    if (person.resolution.state === "resolved") return person;
    const selected = person.resolution.candidates[1]; assert.ok(selected);
    return { ...person, resolution: { state: "resolved", selected } };
  }) });
  const people = bindCrmWorksheetPeople(downloads, rows, choice);
  assert.deepEqual(people.map(person => [person.identity.recordId, person.reference.worksheetId, person.reference.rowId]), [
    ["one", "august", "operator-choice"], ["two", "august", "row-1"],
  ]);
  assert.throws(() => bindCrmWorksheetPeople({ people: downloads.people.toReversed() }, rows, choice));
  assert.throws(() => bindCrmWorksheetPeople(downloads, rows, { ...choice, referenceDigest: "b".repeat(64) }));
  const forged = structuredClone(choice), selected = forged.people[0]?.resolution; assert.ok(selected?.state === "resolved");
  selected.selected.row.names.legalName.firstName = "Invented";
  assert.throws(() => bindCrmWorksheetPeople(downloads, rows, forged));
  selected.selected.row.rowId = "foreign";
  assert.throws(() => bindCrmWorksheetPeople(downloads, rows, forged));
});
