import assert from "node:assert/strict";
import { it } from "vitest";
import { CRM_DOCUMENT_INPUT_PARSER, CrmDocDownloadCanonicalInput, CrmDocDownloadInput } from "../../../../src/models/workflows/crm-doc-download/input.js";
import { parseInputRunText, toRawSubmission } from "../../../../src/models/workflow/ingress.js";

it("emits one canonical batch for a Start containing mixed employee IDs and emails", () => {
  const entries = parseInputRunText(CRM_DOCUMENT_INPUT_PARSER, "10000001, FIXTURE@example.test; 10000002");
  assert.equal(entries.length, 1);
  const entry = entries[0]; assert.ok(entry);
  const parsed = CrmDocDownloadInput.parse(toRawSubmission(entry));
  assert.deepEqual(parsed.people, [{ kind: "eid", value: "10000001" }, { kind: "email", value: "fixture@example.test" }, { kind: "eid", value: "10000002" }]);
  assert.deepEqual(CrmDocDownloadCanonicalInput.parse(parsed), parsed);
  assert.equal(CrmDocDownloadCanonicalInput.safeParse({ people: "10000001" }).success, false);
});

it("refuses invalid or repeated people and excludes spreadsheet data from workflow input", () => {
  for (const text of ["", "10000001,not an identity", "10000001,10000001", "fixture@example.test,FIXTURE@example.test"]) {
    assert.equal(CrmDocDownloadInput.safeParse({ people: text }).success, false);
  }
  assert.equal(CrmDocDownloadInput.safeParse({ people: "10000001", workbook: "roster" }).success, false);
  assert.equal(CrmDocDownloadCanonicalInput.safeParse({ people: [{ kind: "email", value: "FIXTURE@example.test" }] }).success, false);
});
