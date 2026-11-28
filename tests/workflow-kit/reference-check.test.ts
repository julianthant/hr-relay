import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CompareReferenceFields } from "../../src/models/processing/workbooks/reference-fields.js";
import { evaluateNodeCondition } from "../../src/models/workflow/node-condition.js";
import { compileWorkflow } from "../../src/workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes } from "../../src/workflow-kit/workflow.js";
import { compareReferenceCapture, compareReferenceFields, defineReferenceCheck, newReferenceFields, referenceFieldsAt } from "../../src/workflow-kit/reference-check.js";
import { onboardingWorkflow } from "../../src/workflows/onboarding/workflow.js";

const captureInput = CompareReferenceFields.input.parse({ keyField: "eid", read: null, sheets: null, fields: [{ field: "fullName", value: "Jordan Smith" }], approved: [], last: true });

describe("shared reference comparisons", () => {
  const sheets = [
    { source: "first", sheet: "Roster", rows: [{ row: 2, values: [
      { field: "fullName", value: "Jordan Lee" }, { field: "dob", value: "2000-01-01" }, { field: "email", value: "fixture@example.test" },
    ] }] },
    { source: "second", sheet: "Archive", rows: [] },
    { source: "third", sheet: "Rehires", rows: [{ row: 7, values: [{ field: "fullName", value: "Jordan Gray" }] }] },
  ];

  it("compares all returned sheets and skips absent fields and rows", () => {
    const compared = compareReferenceFields(sheets, [
      { field: "fullName", value: "Lee, Jordan" }, { field: "email", value: "fixture@example.test" }, { field: "firstName", value: "Jordan" },
    ], []);
    assert.deepEqual(compared.matches.map(({ sheet, row, field }) => ({ sheet, row, field })), [
      { sheet: "Roster", row: 2, field: "fullName" }, { sheet: "Roster", row: 2, field: "email" },
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

  it("validates and freezes a workflow's column mappings and key selection", () => {
    const check = defineReferenceCheck({ key: "email", input: { email: "contact.email" }, outputs: { "read-person": { fullName: ["first", "last"] } } });
    assert.deepEqual(check.selection, { id: "reference-check", keyFieldId: "email" });
    assert.ok(Object.isFrozen(check.outputs["read-person"].fullName));
    assert.throws(() => defineReferenceCheck({ key: "eid", outputs: { "read-person": { unknownField: "name" } } }), /SPREADSHEET_FIELD_NOT_FOUND/u);
  });

  it("compares equivalent email and date formats once and still compares a new value", () => {
    const fields = [{ field: "email", value: "FIXTURE@example.test" }, { field: "email", value: "fixture@example.test" },
      { field: "dob", value: "1/1/2000" }, { field: "dob", value: "2000-01-01" }, { field: "dob", value: "2001-01-01" }];
    const compared = compareReferenceFields(sheets, fields, []);
    assert.deepEqual(compared.matches, [{ sheet: "Roster", row: 2, field: "email" }, { sheet: "Roster", row: 2, field: "dob" }]);
    assert.deepEqual(compared.mismatches, [{ source: "first", sheet: "Roster", row: 2, field: "dob", expected: "2000-01-01", actual: "2001-01-01" }]);
    assert.deepEqual(newReferenceFields(fields.slice(1), fields.slice(0, 3)), [{ field: "dob", value: "2001-01-01" }]);
  });

  it("logs an unresolved key only at the end and makes no comparisons", () => {
    const empty = { captured: null, matches: [], mismatches: [], review: null };
    assert.deepEqual(compareReferenceCapture({ ...captureInput, last: false }, null), { output: empty, lines: [] });
    assert.deepEqual(compareReferenceCapture(captureInput, null), { output: empty, lines: ["Reference not checked: no Employee ID"] });
    assert.deepEqual(compareReferenceCapture({ ...captureInput, keyField: "email" }, null), { output: empty, lines: ["Reference not checked: no email address"] });
  });

  it("logs a missing row just at capture and continues", () => {
    const missing = [{ source: "first", sheet: "Roster", rows: [] }];
    assert.deepEqual(compareReferenceCapture(captureInput, missing), {
      output: { captured: missing, matches: [], mismatches: [], review: null }, lines: ["Not in Roster"],
    });
    assert.deepEqual(compareReferenceCapture({ ...captureInput, sheets: missing }, null), {
      output: { captured: null, matches: [], mismatches: [], review: null }, lines: [],
    });
  });

  it("marks both hire branches terminal and opens the review on a live or dry-run mismatch", () => {
    const nodes = descriptorRuntimeNodes(compileWorkflow(onboardingWorkflow).descriptor);
    for (const [stage, last] of [["start", false], ["hire-receipt", true], ["concurrent-hire-receipt", true]] as const) {
      const node = nodes.find(candidate => candidate.id === `reference-fields-${stage}`);
      assert.ok(node?.kind === "task");
      assert.equal(CompareReferenceFields.input.parse(node.bind({ input: { email: "fixture@example.test" }, outputs: {} })).last, last);
    }
    const gate = nodes.find(node => node.id === "reference-field-review-hire-receipt");
    assert.ok(gate?.kind === "gate" && gate.resolvedBy === "operator" && gate.when !== undefined);
    const { output, lines } = compareReferenceCapture(captureInput, sheets);
    assert.deepEqual(lines, ["Not in Archive", "Roster, row 2: Legal name differs", "Rehires, row 7: Legal name differs"]);
    for (const dryRun of [undefined, { transactions: [] }]) {
      const scope = { input: {}, outputs: { "reference-fields-hire-receipt": output }, dryRun };
      assert.equal(evaluateNodeCondition(gate.when, scope), true);
    }
  });
});
