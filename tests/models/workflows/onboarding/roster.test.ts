import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { OnboardingReadHirePlan } from "../../../../src/models/workflows/onboarding/read-hire-plan.js";
import { OnboardingRosterReadInputSchema, OnboardingRosterReadOutputSchema, OnboardingRosterSnapshotRowSchema,
  OnboardingRosterCellsSchema } from "../../../../src/models/workflows/onboarding/roster.js";
import { WorkbookReferenceWriteSchema } from "../../../../src/models/processing/workbooks/read-result.js";
import { auditContractBoundarySchema } from "../../../../src/models/validation/contract-boundary.js";
import { DRY_RUN_TRANSACTION_NUMBER } from "../../../../src/models/workflow/dry-run.js";

const binding = OnboardingReadHirePlan.example.roster;
const { sheetId: _sheetId, rowId: _rowId, ...referenceBinding } = binding;
const row = { binding, references: { legalName: "Fixture Hire", livedName: null } };
const patch = { kind: "patch-reference", writeId: "onboarding-results", typeId: binding.workbookType,
  referenceDigest: binding.referenceDigest, key: binding.rowKey.email,
  values: [{ fieldId: "transactionNumber", value: "T009000001" }] };
describe("onboarding roster task boundaries", () => {
  it("declares strict run-start reference inputs and resolved or unresolved snapshot outputs", () => {
    assert.deepEqual(OnboardingRosterReadInputSchema.parse({ runId: "aaaaaaaa-0001-4000-8000-000100000000",
      workbookType: binding.workbookType, workbookId: binding.workbookId, rowKey: binding.rowKey }).rowKey, binding.rowKey);
    assert.deepEqual(OnboardingRosterReadOutputSchema.parse({ state: "resolved", row }), { state: "resolved", row });
    for (const reason of ["row-missing", "row-ambiguous"]) assert.deepEqual(OnboardingRosterReadOutputSchema.parse({ state: "resolve-required", binding: referenceBinding, reason }),
      { state: "resolve-required", binding: referenceBinding, reason });
    assert.deepEqual(OnboardingRosterSnapshotRowSchema.parse({ ...row, references: { legalName: "Hire, Fixture", livedName: "Fix Hire" } }).references,
      { legalName: "Hire, Fixture", livedName: "Fix Hire" });
    for (const references of [{ legalName: null, livedName: null }, { legalName: "", livedName: null }, { legalName: " Fixture Hire", livedName: null },
      { legalName: "Fixture  Hire", livedName: null }, { legalName: "Fixture Hire", livedName: "" }, { legalName: "Fixture Hire", livedName: "Fix\tHire" },
      { legalName: { firstName: "Fixture", lastName: "Hire", middleName: "" }, livedName: null }]) {
      assert.equal(OnboardingRosterSnapshotRowSchema.safeParse({ ...row, references }).success, false);
    }
  });
  it("uses the existing run-bound reference command and admits only the two result cells", () => {
    assert.deepEqual(WorkbookReferenceWriteSchema.parse(patch), patch);
    assert.deepEqual(OnboardingRosterCellsSchema.parse({ transactionNumber: "T009000001" }), { transactionNumber: "T009000001" });
    assert.deepEqual(OnboardingRosterCellsSchema.parse({ eid: "10800000", transactionNumber: "T009000001" }), { eid: "10800000", transactionNumber: "T009000001" });
    for (const value of [{ ...patch, path: "/tmp/roster.xlsx" }, { ...patch, version: 2 }, { ...patch, rowNumber: 4 },
      { ...patch, key: { rowNumber: 4 } }, { ...patch, values: [] }, { ...patch, kind: "snapshot" }]) assert.equal(WorkbookReferenceWriteSchema.safeParse(value).success, false);
  });
  it("refuses fills without a transaction, run-only result cells, reference-cell overwrites and preview samples", () => {
    for (const cells of [{}, { eid: "10800000" }, { transactionNumber: "T009000001", i9ProfileId: "900001" },
      { transactionNumber: "T009000001", transactionApprovalStatus: "Pending" }, { transactionNumber: "T009000001", fullName: "Replacement" },
      { transactionNumber: "T009000001", eid: "bad" }, { transactionNumber: DRY_RUN_TRANSACTION_NUMBER }]) {
      assert.equal(OnboardingRosterCellsSchema.safeParse(cells).success, false);
    }
  });
  it("keeps every declared input and output boundary recursively strict", () => {
    for (const schema of [OnboardingRosterReadInputSchema, OnboardingRosterReadOutputSchema, OnboardingRosterCellsSchema, WorkbookReferenceWriteSchema])
      assert.deepEqual(auditContractBoundarySchema(schema, "onboarding roster"), []);
  });
});
