import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RunWorkbookAllRowsReferenceSchema, WorkbookAllRowsRequestSchema } from "../../../../src/models/dashboard/workbooks.js";
import { OcrWorkbookRosterEvidenceSchema } from "../../../../src/models/workflows/ocr/roster.js";
import { bindOcrRoster } from "../../../../src/rules/spreadsheets/ocr-roster.js";
import { OcrCanonicalInput } from "../../../../src/models/workflows/ocr/input.js";
import { workbookInputBinding } from "../../../../src/backend/runs/workbooks.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";

const readAt = "2026-11-01T12:00:00.000Z";
function reference() {
  return RunWorkbookAllRowsReferenceSchema.parse({
    request: { typeId: "ocr-roster", libraryId: "roster", expectedVersion: 4, mode: "all", fields: ["eid", "fullName"] },
    snapshot: { libraryId: "roster", version: 4, type: { id: "ocr-roster", name: "Roster", keyFieldId: "eid",
      fields: ["eid", "fullName"], defaultWorkbookId: "roster" }, worksheets: [{ sheetId: "people", name: "People" }],
    rows: ["first", "duplicate", "missing"].map((id, index) => ({ key: id, state: "matched", matches: [{ sheetId: "people", rowId: id,
      values: { eid: index === 2 ? null : "10000001", fullName: index === 2 ? null : "Example, Avery" } }] })) },
  });
}
function bound(value = reference()) { return { schemaHash: deriveSchemaHash(RunWorkbookAllRowsReferenceSchema, "output"), value }; }
function readRoster(value = reference()) { return bindOcrRoster([bound(value)], readAt).roster; }

describe("OCR captured workbook roster", () => {
  it("coerces finite numeric Excel EIDs and reads any unusable ID cell as missing instead of refusing the roster", () => {
    const numeric = reference(); numeric.snapshot.rows[0].matches[0].values.eid = 10000001;
    assert.equal(readRoster(numeric).rows[0].eid, "10000001");
    assert.equal(numeric.snapshot.rows[0].matches[0].values.eid, 10000001);
    for (const eid of [true, -10000001, 10000001.5, "invalid", "12345", "see note", "note:10000001", "10000001 (left)", "1000-0001", "-10000001", "10000001.5", { type: "date", value: readAt }]) {
      const unusable = reference(); Reflect.set(unusable.snapshot.rows[0].matches[0].values, "eid", eid);
      const rows = readRoster(unusable).rows;
      assert.equal(rows[0].eid, null); assert.equal(rows[0].name, "Example, Avery"); assert.equal(rows[1].eid, "10000001");
    }
  });
  it("accepts a whole-cell EID with surrounding spaces", () => {
    const padded = reference(); padded.snapshot.rows[0].matches[0].values.eid = " 10000001 ";
    assert.equal(readRoster(padded).rows[0].eid, "10000001");
  });
  it("treats a whitespace-only EID or name as missing", () => {
    const blank = reference(); Object.assign(blank.snapshot.rows[0].matches[0].values, { eid: " ", fullName: "  " });
    const row = readRoster(blank).rows[0];
    assert.equal(row.eid, null); assert.equal(row.name, null);
  });
  it("retains the exact version and missing values while collapsing agreeing copies", () => {
    const captured = reference(), roster = readRoster(captured);
    assert.equal(roster.workbookVersion, 4);
    assert.equal(roster.rows.length, 2);
    assert.deepEqual(roster.rows.map(row => row.eid), ["10000001", null]);
    assert.equal(roster.referenceDigest, sha256Hex(canonicalJsonStringify(bound(captured))));
    assert.equal(OcrWorkbookRosterEvidenceSchema.safeParse({ ...roster, rows: roster.rows.slice(1) }).success, false);
    assert.equal(OcrWorkbookRosterEvidenceSchema.safeParse({ ...roster, rows: [roster.rows[0], roster.rows[0]] }).success, false);
  });
  it("refuses mismatched type, version, fields, duplicate source membership and invalid names", () => {
    for (const change of [
      (value: ReturnType<typeof reference>) => { value.snapshot.version++; },
      (value: ReturnType<typeof reference>) => { Reflect.deleteProperty(value.request, "mode"); },
      (value: ReturnType<typeof reference>) => { value.snapshot.type.keyFieldId = "fullName"; },
      (value: ReturnType<typeof reference>) => { value.snapshot.rows[1] = value.snapshot.rows[0]; },
      (value: ReturnType<typeof reference>) => { value.snapshot.rows[0].matches[0].values.fullName = true; },
    ]) {
      const value = reference(); change(value);
      assert.throws(() => readRoster(value));
    }
    assert.equal(WorkbookAllRowsRequestSchema.safeParse({ ...reference().request, expectedVersion: undefined }).success, false);
    assert.equal(WorkbookAllRowsRequestSchema.safeParse({ ...reference().request, keys: ["10000001"] }).success, false);
  });
  it("the production input binding rejects supplied snapshots and binds only captured authority", () => {
    const binding = workbookInputBinding(OcrCanonicalInput); assert.ok(binding);
    const roster = readRoster();
    assert.throws(() => binding.assertSubmission({ roster }), /caller-supplied/);
    binding.assertSubmission({ roster: null });
    assert.deepEqual(binding.bind({ roster: null }, [bound()], readAt), { roster, rosterChoice: "not-required" });
    assert.throws(() => binding.bind({}, [], readAt));
    assert.throws(() => binding.assertSubmission({ roster: { artifact: {}, rows: [] } }), /caller-supplied/);
  });
});
