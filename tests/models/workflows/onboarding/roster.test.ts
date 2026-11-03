import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { OnboardingReadHirePlan } from "../../../../src/models/workflows/onboarding/read-hire-plan.js";
import {
  OnboardingRosterReadInputSchema,
  OnboardingRosterReadOutputSchema,
  OnboardingRosterSnapshotRowSchema,
  OnboardingRosterWriteInputSchema,
  OnboardingRosterWriteOutputSchema,
} from "../../../../src/models/workflows/onboarding/roster.js";
import { auditContractBoundarySchema } from "../../../../src/models/validation/contract-boundary.js";

const binding = OnboardingReadHirePlan.example.roster;
const row = {
  binding,
  references: { legalName: { firstName: "Fixture", lastName: "Hire", middleName: "" }, livedName: null },
};
const write = { target: "master", source: binding, cells: { i9ProfileId: "fixture-profile" } };

describe("onboarding roster task boundaries", () => {
  it("declares strict run-start reference inputs and resolved or unresolved snapshot outputs", () => {
    assert.deepEqual(OnboardingRosterReadInputSchema.parse({
      runId: binding.runId, workbookType: binding.workbookType, workbookId: binding.workbookId, rowKey: binding.rowKey,
    }).rowKey, binding.rowKey);
    assert.deepEqual(OnboardingRosterReadOutputSchema.parse({ state: "resolved", row }), { state: "resolved", row });
    for (const reason of ["row-missing", "row-ambiguous"]) {
      assert.deepEqual(OnboardingRosterReadOutputSchema.parse({ state: "resolve-required", binding, reason }),
        { state: "resolve-required", binding, reason });
    }
    assert.equal(OnboardingRosterSnapshotRowSchema.safeParse({ ...row, references: { legalName: null, livedName: null } }).success, false);
  });

  it("addresses the live master by key and declares distinct fill and resolve results", () => {
    assert.deepEqual(OnboardingRosterWriteInputSchema.parse(write), write);
    assert.deepEqual(OnboardingRosterWriteOutputSchema.parse({
      state: "filled", workbookId: binding.workbookId, rowKey: binding.rowKey, changeLogId: "fixture-change",
    }), { state: "filled", workbookId: binding.workbookId, rowKey: binding.rowKey, changeLogId: "fixture-change" });
    for (const reason of ["row-missing", "row-ambiguous", "operator-edited-cell"]) {
      const output = { state: "resolve-required", workbookId: binding.workbookId, rowKey: binding.rowKey, reason };
      assert.deepEqual(OnboardingRosterWriteOutputSchema.parse(output), output);
    }
  });

  it("refuses disk paths, row positions, per-run versions, reference-cell overwrites and empty fills", () => {
    for (const input of [
      { ...write, path: "/tmp/roster.xlsx" },
      { ...write, version: 2 },
      { ...write, rowNumber: 4 },
      { ...write, source: { ...binding, rowKey: { rowNumber: 4 } } },
      { ...write, cells: {} },
      { ...write, cells: { transactionNumber: "T002216675" } },
      { ...write, cells: { transactionApprovalStatus: "Pending" } },
      { ...write, cells: { legalName: "Replacement" } },
      { ...write, target: "snapshot" },
    ]) assert.equal(OnboardingRosterWriteInputSchema.safeParse(input).success, false);
    assert.deepEqual(OnboardingRosterWriteInputSchema.parse({ ...write,
      cells: { transactionNumber: "T002216675", transactionApprovalStatus: "Pending" },
    }).cells, { transactionNumber: "T002216675", transactionApprovalStatus: "Pending" });
  });

  it("keeps every declared input and output boundary recursively strict", () => {
    for (const schema of [OnboardingRosterReadInputSchema, OnboardingRosterReadOutputSchema,
      OnboardingRosterWriteInputSchema, OnboardingRosterWriteOutputSchema]) {
      assert.deepEqual(auditContractBoundarySchema(schema, "onboarding roster"), []);
    }
  });
});
