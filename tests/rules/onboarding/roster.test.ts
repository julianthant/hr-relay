import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RunWorkbookReferenceSchema, RunWorkbookSelectedRowReferenceSchema } from "../../../src/models/dashboard/workbooks.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { ONBOARDING_ROSTER_FIELDS, ONBOARDING_ROSTER_NAME_FIELDS } from "../../../src/models/workflows/onboarding/roster.js";
import { bindOnboardingRoster } from "../../../src/rules/onboarding/roster.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";

const key = "hire@example.test", capturedAt = "2026-10-31T01:02:03.000Z";
const values = { email: key, fullName: "Legal Hire", livedName: null, eid: "10800000", transactionNumber: "T009000001" };
const OLD_FIELDS = ["email", "firstName", "lastName", "middleName", "roster.livedFirstName", "roster.livedLastName", "roster.livedMiddleName",
  "eid", "i9ProfileId", "transactionNumber", "transactionApprovalStatus"];
const oldValues = { email: key, firstName: "Legal", lastName: "Hire", middleName: "", "roster.livedFirstName": null, "roster.livedLastName": null,
  "roster.livedMiddleName": null, eid: "10800000", i9ProfileId: "900001", transactionNumber: "T009000001", transactionApprovalStatus: "Pending" };
const reference = { request: { typeId: "onboarding-roster", keys: [key], fields: [...ONBOARDING_ROSTER_FIELDS] },
  snapshot: { libraryId: "roster", version: 1, worksheets: [{ sheetId: "people", name: "People" }],
    type: { id: "onboarding-roster", name: "Onboarding roster", keyFieldId: "email", fields: [...ONBOARDING_ROSTER_FIELDS], defaultWorkbookId: "roster" },
    rows: [{ key, state: "matched", matches: [{ sheetId: "people", rowId: "person", values }] }] } };
const boundReference = (value: unknown = reference, selection?: { sheetId: string; rowId: string }) => {
  const parsed = RunWorkbookReferenceSchema.parse(value);
  return selection === undefined ? { schemaHash: deriveSchemaHash(RunWorkbookReferenceSchema, "output"), value: parsed }
    : { schemaHash: deriveSchemaHash(RunWorkbookSelectedRowReferenceSchema, "output"), value: { request: { ...parsed.request,
      libraryId: parsed.snapshot.libraryId, versionId: "selected", selectedRow: selection },
      snapshot: { ...parsed.snapshot, versionId: "selected", versionName: "Selected" } } };
};
const bind = (value: unknown = reference, selection?: { sheetId: string; rowId: string }) => bindOnboardingRoster(boundReference(value, selection), key, capturedAt);
const withValues = (changed: Record<string, unknown>) => ({ ...reference, snapshot: { ...reference.snapshot,
  rows: [{ ...reference.snapshot.rows[0], matches: [{ ...reference.snapshot.rows[0].matches[0], values: changed }] }] } });
const resolvedReferences = (changed: Record<string, unknown>) => {
  const output = bind(withValues(changed));
  if (output.state !== "resolved") throw new Error("row not resolved");
  return output.row.references;
};

describe("Onboarding roster reference mapping", () => {
  it("retains exact reference authority and reads the legal and lived name cells whole", () => {
    const output = bind(); assert.equal(output.state, "resolved"); if (output.state !== "resolved") throw new Error("row not resolved");
    assert.equal(output.row.binding.workbookId, "roster"); assert.equal(output.row.binding.workbookVersion, 1);
    assert.equal(output.row.binding.sheetId, "people"); assert.equal(output.row.binding.rowId, "person");
    assert.equal(output.row.binding.capturedAt, capturedAt); assert.equal(output.row.binding.referenceDigest.length, 64);
    assert.deepEqual(output.row.references, { legalName: "Legal Hire", livedName: null });
    assert.deepEqual(resolvedReferences({ ...values, fullName: "  Legal \t Middle   Hire ", livedName: " Lived   Name " }),
      { legalName: "Legal Middle Hire", livedName: "Lived Name" });
    assert.deepEqual(resolvedReferences({ ...values, livedName: "   " }), { legalName: "Legal Hire", livedName: null });
    for (const changed of [{ ...values, fullName: null }, { ...values, fullName: "  " }, { ...values, fullName: 7 },
      { ...values, email: key.toUpperCase() }]) {
      assert.throws(() => bind(withValues(changed)));
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
      { ...second, values: { ...values, fullName: false } }]) {
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
      fullName: "Second Hire", livedName: "Lived Name" } };
    const ambiguous = { ...reference, snapshot: { ...reference.snapshot,
      worksheets: [...reference.snapshot.worksheets, { sheetId: "other-people", name: "Other people" }],
      rows: [{ key, state: "ambiguous", matches: [...reference.snapshot.rows[0].matches, second] }] } };
    const selected = bind(ambiguous, { ...selection, sheetId: "other-people" });
    assert.equal(selected.state, "resolved");
    if (selected.state !== "resolved" || matched.state !== "resolved") throw new Error("selection not resolved");
    assert.deepEqual(selected.row.binding, { ...matched.row.binding, sheetId: "other-people", referenceDigest: selected.row.binding.referenceDigest });
    assert.notEqual(selected.row.binding.referenceDigest, matched.row.binding.referenceDigest);
    assert.equal(selected.row.binding.referenceDigest, sha256Hex(canonicalJsonStringify(boundReference(ambiguous, { sheetId: "other-people", rowId: "person" }))));
    assert.deepEqual(selected.row.references, { legalName: "Second Hire", livedName: "Lived Name" });
    assert.equal(bind(ambiguous).state, "resolve-required");
  });

  it("reads retained fifth references without selectors but does not grant historical name-only captures new outputs", () => {
    const fifth = (value: unknown) => ({ schemaHash: deriveSchemaHash(RunWorkbookSelectedRowReferenceSchema, "output"),
      value: RunWorkbookSelectedRowReferenceSchema.parse(value) });
    assert.equal(bindOnboardingRoster(fifth(reference), key, capturedAt).state, "resolved");
    for (const state of ["missing", "ambiguous"] as const) {
      const row = reference.snapshot.rows[0];
      const matches = state === "missing" ? [] : [...row.matches, { ...row.matches[0], rowId: "second" }];
      const retained = fifth({ ...reference, snapshot: { ...reference.snapshot, rows: [{ key, state, matches }] } });
      assert.equal(bindOnboardingRoster(retained, key, capturedAt).state, "resolve-required");
    }
    const names = { request: { ...reference.request, fields: [...ONBOARDING_ROSTER_NAME_FIELDS] },
      snapshot: { ...reference.snapshot, type: { ...reference.snapshot.type, fields: [...ONBOARDING_ROSTER_NAME_FIELDS] },
        rows: reference.snapshot.rows.map(row => ({ ...row, matches: row.matches.map(match => ({ ...match,
          values: Object.fromEntries(ONBOARDING_ROSTER_NAME_FIELDS.map(field => [field, match.values[field]])),
        })) })) } };
    const eleven = { request: { ...reference.request, fields: OLD_FIELDS },
      snapshot: { ...reference.snapshot, type: { ...reference.snapshot.type, fields: OLD_FIELDS },
        rows: [{ ...reference.snapshot.rows[0], matches: [{ ...reference.snapshot.rows[0].matches[0], values: oldValues }] }] } };
    for (const schema of [RunWorkbookReferenceSchema, RunWorkbookSelectedRowReferenceSchema]) {
      for (const retainedValue of [names, eleven]) {
        const retained = { schemaHash: deriveSchemaHash(schema, "output"), value: schema.parse(retainedValue) };
        assert.throws(() => bindOnboardingRoster(retained, key, capturedAt), /onboarding-roster-reference-invalid/u);
      }
    }
  });

  it("refuses unavailable selections without choosing another row", () => {
    for (const selection of [{ sheetId: "people", rowId: "missing" }, { sheetId: "foreign", rowId: "person" }]) {
      assert.throws(() => bind(reference, selection), /run workbook reference must retain its exact requested values and membership/u);
    }
    assert.throws(() => bind({ ...reference, snapshot: { ...reference.snapshot,
      rows: [{ key, state: "missing", matches: [] }] } }, { sheetId: "people", rowId: "person" }), /run workbook reference must retain its exact requested values and membership/u);
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
      { ...reference, snapshot: { ...reference.snapshot, type: { ...reference.snapshot.type, keyFieldId: "fullName" } } },
      { ...reference, request: { ...reference.request, fields: ONBOARDING_ROSTER_FIELDS.slice(0, -1) } },
      { ...reference, snapshot: { ...reference.snapshot, worksheets: [{ sheetId: "foreign", name: "Foreign" }] } },
    ]) assert.throws(() => bind(changed, selection));
    for (const changed of [{ ...values, email: "other@example.test" }, { ...values, fullName: "" }, { ...values, fullName: null },
      { ...values, livedName: false }]) {
      assert.throws(() => bind({ ...reference, snapshot: { ...reference.snapshot,
        rows: [{ key, state: "matched", matches: [{ ...reference.snapshot.rows[0].matches[0], values: changed }] }] } }, selection));
    }
    for (const candidate of [{ ...reference.snapshot.rows[0].matches[0] },
      { ...reference.snapshot.rows[0].matches[0], rowId: "second", values: { ...values, fullName: false } }]) {
      assert.throws(() => bind({ ...reference, snapshot: { ...reference.snapshot,
        rows: [{ key, state: "ambiguous", matches: [...reference.snapshot.rows[0].matches, candidate] }] } }, selection));
    }
  });
});
