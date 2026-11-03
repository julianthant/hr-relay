import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RunWorkbookReferenceSchema } from "../../../src/models/dashboard/workbooks.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { ONBOARDING_ROSTER_FIELDS } from "../../../src/models/workflows/onboarding/roster.js";
import { bindOnboardingRoster } from "../../../src/rules/onboarding/roster.js";

const key = "hire@example.test", capturedAt = "2026-10-31T01:02:03.000Z";
const values = { email: key, firstName: "Legal", lastName: "Hire", middleName: "",
  "roster.livedFirstName": null, "roster.livedLastName": null, "roster.livedMiddleName": null };
const reference = { request: { typeId: "onboarding-roster", keys: [key], fields: [...ONBOARDING_ROSTER_FIELDS] },
  snapshot: { libraryId: "roster", version: 1, worksheets: [{ sheetId: "people", name: "People" }],
    type: { id: "onboarding-roster", name: "Onboarding roster", keyFieldId: "email", fields: [...ONBOARDING_ROSTER_FIELDS], defaultWorkbookId: "roster" },
    rows: [{ key, state: "matched", matches: [{ sheetId: "people", rowId: "person", values }] }] } };
const bind = (value: unknown = reference) => bindOnboardingRoster({ schemaHash: deriveSchemaHash(RunWorkbookReferenceSchema, "output"),
  value: RunWorkbookReferenceSchema.parse(value) }, key, capturedAt);

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
});
