import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RunWorkbookReferenceSchema } from "../../../src/models/dashboard/workbooks.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { ONBOARDING_ROSTER_FIELDS } from "../../../src/models/workflows/onboarding/roster.js";
import { bindOnboardingRoster } from "../../../src/rules/onboarding/roster.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";

const key = "hire@example.test", capturedAt = "2026-10-31T01:02:03.000Z";
const values = { email: key, firstName: "Legal", lastName: "Hire", middleName: "",
  "roster.livedFirstName": null, "roster.livedLastName": null, "roster.livedMiddleName": null, eid: "10800000", i9ProfileId: "900001", transactionNumber: "T009000001", transactionApprovalStatus: "Pending" };
const reference = { request: { typeId: "onboarding-roster", keys: [key], fields: [...ONBOARDING_ROSTER_FIELDS] },
  snapshot: { libraryId: "roster", version: 1, worksheets: [{ sheetId: "people", name: "People" }],
    type: { id: "onboarding-roster", name: "Onboarding roster", keyFieldId: "email", fields: [...ONBOARDING_ROSTER_FIELDS], defaultWorkbookId: "roster" },
    rows: [{ key, state: "matched", matches: [{ sheetId: "people", rowId: "person", values }] }] } };
const bind = (value: unknown = reference, selection?: { sheetId: string; rowId: string }) => bindOnboardingRoster({
  schemaHash: deriveSchemaHash(RunWorkbookReferenceSchema, "output"), value: RunWorkbookReferenceSchema.parse(value) }, key, capturedAt, selection);

describe("Onboarding roster reference mapping", () => {
  it("retains exact reference authority and treats only a complete null lived-name triple as absence", () => {
    const output = bind(); assert.equal(output.state, "resolved"); if (output.state !== "resolved") throw new Error("row not resolved");
    assert.equal(output.row.binding.workbookId, "roster"); assert.equal(output.row.binding.workbookVersion, 1);
    assert.equal(output.row.binding.sheetId, "people"); assert.equal(output.row.binding.rowId, "person");
    assert.equal(output.row.binding.capturedAt, capturedAt); assert.equal(output.row.binding.referenceDigest.length, 64);
    assert.deepEqual(output.row.references, { legalName: { firstName: "Legal", lastName: "Hire", middleName: "" }, livedName: null });
    for (const changed of [{ ...values, "roster.livedFirstName": "Lived" }, { ...values, middleName: null },
      { ...values, firstName: " Legal" }, { ...values, email: key.toUpperCase() }]) {
      assert.throws(() => bind({ ...reference, snapshot: { ...reference.snapshot,
        rows: [{ ...reference.snapshot.rows[0], matches: [{ ...reference.snapshot.rows[0].matches[0], values: changed }] }] } }));
    }
  });

  it("keeps missing/ambiguous states, validates every candidate and refuses duplicate or foreign membership", () => {
    const missing = bind({ ...reference, snapshot: { ...reference.snapshot, rows: [{ key, state: "missing", matches: [] }] } });
    assert.equal(missing.state, "resolve-required"); if (missing.state !== "resolve-required") throw new Error("missing not held");
    assert.equal(missing.reason, "row-missing");
    const second = { ...reference.snapshot.rows[0].matches[0], rowId: "second" };
    const ambiguous = { ...reference, snapshot: { ...reference.snapshot,
      rows: [{ key, state: "ambiguous", matches: [...reference.snapshot.rows[0].matches, second] }] } };
    assert.equal(bind(ambiguous).state, "resolve-required");
    for (const candidate of [{ ...second, sheetId: "foreign" }, { ...second, rowId: "person" },
      { ...second, values: { ...values, lastName: false } }]) {
      assert.throws(() => bind({ ...ambiguous, snapshot: { ...ambiguous.snapshot,
        rows: [{ key, state: "ambiguous", matches: [...reference.snapshot.rows[0].matches, candidate] }] } }));
    }
    assert.throws(() => bindOnboardingRoster({ schemaHash: FingerprintSchema.parse("b".repeat(64)), value: RunWorkbookReferenceSchema.parse(reference) }, key, capturedAt));
  });

  it("binds the exact selected physical row in matched and ambiguous references", () => {
    const selection = { sheetId: "people", rowId: "person" };
    const matched = bind(reference, selection);
    assert.equal(matched.state, "resolved");
    const second = { ...reference.snapshot.rows[0].matches[0], sheetId: "other-people", values: { ...values,
      firstName: "Second", "roster.livedFirstName": "Lived", "roster.livedLastName": "Name", "roster.livedMiddleName": "" } };
    const ambiguous = { ...reference, snapshot: { ...reference.snapshot,
      worksheets: [...reference.snapshot.worksheets, { sheetId: "other-people", name: "Other people" }],
      rows: [{ key, state: "ambiguous", matches: [...reference.snapshot.rows[0].matches, second] }] } };
    const selected = bind(ambiguous, { ...selection, sheetId: "other-people" });
    assert.equal(selected.state, "resolved");
    if (selected.state !== "resolved" || matched.state !== "resolved") throw new Error("selection not resolved");
    assert.deepEqual(selected.row.binding, { ...matched.row.binding, sheetId: "other-people", referenceDigest: selected.row.binding.referenceDigest });
    assert.notEqual(selected.row.binding.referenceDigest, matched.row.binding.referenceDigest);
    assert.equal(selected.row.binding.referenceDigest, sha256Hex(canonicalJsonStringify({
      schemaHash: deriveSchemaHash(RunWorkbookReferenceSchema, "output"), value: RunWorkbookReferenceSchema.parse(ambiguous) })));
    assert.deepEqual(selected.row.references, { legalName: { firstName: "Second", lastName: "Hire", middleName: "" },
      livedName: { firstName: "Lived", lastName: "Name", middleName: "" } });
    assert.equal(bind(ambiguous).state, "resolve-required");
  });

  it("refuses unavailable selections without choosing another row", () => {
    for (const selection of [{ sheetId: "people", rowId: "missing" }, { sheetId: "foreign", rowId: "person" }]) {
      assert.throws(() => bind(reference, selection), /onboarding-roster-row-unavailable/u);
    }
    assert.throws(() => bind({ ...reference, snapshot: { ...reference.snapshot,
      rows: [{ key, state: "missing", matches: [] }] } }, { sheetId: "people", rowId: "person" }), /onboarding-roster-row-unavailable/u);
  });

  it("validates the whole selected reference, including unselected candidates", () => {
    const selection = { sheetId: "people", rowId: "person" };
    for (const changed of [
      { ...reference, request: { ...reference.request, keys: ["other@example.test"] } },
      { ...reference, request: { ...reference.request, keys: ["other@example.test"] }, snapshot: { ...reference.snapshot,
        rows: [{ key: "other@example.test", state: "matched", matches: [{ ...reference.snapshot.rows[0].matches[0],
          values: { ...values, email: "other@example.test" } }] }] } },
      { ...reference, request: { ...reference.request, typeId: "other" }, snapshot: { ...reference.snapshot,
        type: { ...reference.snapshot.type, id: "other" } } },
      { ...reference, snapshot: { ...reference.snapshot, type: { ...reference.snapshot.type, keyFieldId: "firstName" } } },
      { ...reference, request: { ...reference.request, fields: ONBOARDING_ROSTER_FIELDS.slice(0, -1) } },
      { ...reference, snapshot: { ...reference.snapshot, worksheets: [{ sheetId: "foreign", name: "Foreign" }] } },
    ]) assert.throws(() => bind(changed, selection));
    for (const changed of [{ ...values, email: "other@example.test" }, { ...values, firstName: " Legal" },
      { ...values, lastName: "" }, { ...values, middleName: null }, { ...values, "roster.livedFirstName": "Lived" }]) {
      assert.throws(() => bind({ ...reference, snapshot: { ...reference.snapshot,
        rows: [{ key, state: "matched", matches: [{ ...reference.snapshot.rows[0].matches[0], values: changed }] }] } }, selection));
    }
    for (const candidate of [{ ...reference.snapshot.rows[0].matches[0] },
      { ...reference.snapshot.rows[0].matches[0], rowId: "second", values: { ...values, firstName: false } }]) {
      assert.throws(() => bind({ ...reference, snapshot: { ...reference.snapshot,
        rows: [{ key, state: "ambiguous", matches: [...reference.snapshot.rows[0].matches, candidate] }] } }, selection));
    }
  });
});
