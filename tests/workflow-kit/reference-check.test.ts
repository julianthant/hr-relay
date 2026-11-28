import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { compareReferenceFields, referenceFieldsAt } from "../../src/workflow-kit/reference-check.js";

describe("shared reference comparisons", () => {
  const sheets = [
    { source: "first", sheet: "Roster", rows: [{ row: 2, values: [
      { field: "fullName", value: "Jordan Lee" }, { field: "dob", value: "2000-01-01" },
    ] }] },
    { source: "second", sheet: "Archive", rows: [] },
    { source: "third", sheet: "Rehires", rows: [{ row: 7, values: [{ field: "fullName", value: "Jordan Gray" }] }] },
  ];

  it("compares all returned sheets and skips absent fields and rows", () => {
    const compared = compareReferenceFields(sheets, [
      { field: "fullName", value: "Lee, Jordan" }, { field: "email", value: "fixture@example.test" },
    ], []);
    assert.deepEqual(compared.matches.map(({ sheet, row, field }) => ({ sheet, row, field })), [
      { sheet: "Roster", row: 2, field: "fullName" },
    ]);
    assert.deepEqual(compared.mismatches.map(({ sheet, row, expected, actual }) => ({ sheet, row, expected, actual })), [
      { sheet: "Rehires", row: 7, expected: "Jordan Gray", actual: "Lee, Jordan" },
    ]);
  });

  it("carries approval for one field and sheet forward", () => {
    const values = [{ field: "fullName", value: "Jordan Smith" }, { field: "dob", value: "2001-01-01" }];
    const result = compareReferenceFields(sheets, values, [{ source: "first", field: "fullName" }]);
    assert.deepEqual(result.mismatches.map(({ source, field }) => ({ source, field })), [
      { source: "first", field: "dob" }, { source: "third", field: "fullName" },
    ]);
  });

  it("reads an identifier only from a single confirmed match", () => {
    const fields = { eid: "confirmed[].emplId" };
    const person = { emplId: "10000001" };
    assert.deepEqual(referenceFieldsAt(fields, { confirmed: [] }), []);
    assert.deepEqual(referenceFieldsAt(fields, { confirmed: [person, { emplId: "10000002" }] }), []);
    assert.deepEqual(referenceFieldsAt(fields, { confirmed: [person] }), [{ field: "eid", value: person.emplId }]);
  });
});
