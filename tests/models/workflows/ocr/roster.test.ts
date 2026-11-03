import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RunWorkbookAllRowsReferenceSchema, WorkbookAllRowsRequestSchema } from "../../../../src/models/dashboard/workbooks.js";
import { bindOcrRoster, OcrWorkbookRosterEvidenceSchema } from "../../../../src/models/workflows/ocr/roster.js";
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

describe("OCR captured workbook roster", () => {
  it("retains the exact version, duplicate identities and missing values without rereading the library", () => {
    const captured = reference(), roster = bindOcrRoster(bound(captured), readAt);
    assert.equal(roster.workbookVersion, 4);
    assert.equal(roster.rows.length, 3);
    assert.deepEqual(roster.rows.map(row => row.eid), ["10000001", "10000001", null]);
    assert.equal(roster.referenceDigest, sha256Hex(canonicalJsonStringify(bound(captured))));
    assert.equal(OcrWorkbookRosterEvidenceSchema.safeParse({ ...roster, rows: roster.rows.slice(1) }).success, false);
    assert.equal(OcrWorkbookRosterEvidenceSchema.safeParse({ ...roster, rows: [roster.rows[0], roster.rows[0]] }).success, false);
  });
  it("refuses mismatched type, version, fields, duplicate source membership and invalid identity values", () => {
    for (const change of [
      (value: ReturnType<typeof reference>) => { value.snapshot.version++; },
      (value: ReturnType<typeof reference>) => { Reflect.deleteProperty(value.request, "mode"); },
      (value: ReturnType<typeof reference>) => { value.snapshot.type.keyFieldId = "fullName"; },
      (value: ReturnType<typeof reference>) => { value.snapshot.rows[1] = value.snapshot.rows[0]; },
      (value: ReturnType<typeof reference>) => { value.snapshot.rows[0].matches[0].values.eid = "invalid"; },
      (value: ReturnType<typeof reference>) => { value.snapshot.rows[0].matches[0].values.fullName = true; },
    ]) {
      const value = reference(); change(value);
      assert.throws(() => bindOcrRoster(bound(value), readAt));
    }
    assert.equal(WorkbookAllRowsRequestSchema.safeParse({ ...reference().request, expectedVersion: undefined }).success, false);
    assert.equal(WorkbookAllRowsRequestSchema.safeParse({ ...reference().request, keys: ["10000001"] }).success, false);
  });
  it("the production input binding rejects supplied snapshots and binds only captured authority", () => {
    const binding = workbookInputBinding(OcrCanonicalInput); assert.ok(binding);
    const roster = bindOcrRoster(bound(), readAt);
    assert.throws(() => binding.assertSubmission({ roster }), /caller-supplied/);
    binding.assertSubmission({ roster: null });
    assert.deepEqual(binding.bind({ roster: null }, [bound()], readAt), { roster });
    assert.throws(() => binding.bind({}, [], readAt));
    assert.throws(() => binding.assertSubmission({ roster: { artifact: {}, rows: [] } }), /caller-supplied/);
  });
});
