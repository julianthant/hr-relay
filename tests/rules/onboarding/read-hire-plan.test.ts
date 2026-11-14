import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CrmReadHireData } from "../../../src/models/systems/crm/read-hire-data.js";
import { OnboardingReadHirePlan } from "../../../src/models/workflows/onboarding/read-hire-plan.js";
import { OnboardingRosterSnapshotRowSchema } from "../../../src/models/workflows/onboarding/roster.js";
import { readHirePlan } from "../../../src/rules/onboarding/read-hire-plan.js";
import { RosterNameUnresolvedError } from "../../../src/rules/onboarding/roster-name.js";

const roster = OnboardingRosterSnapshotRowSchema.parse({
  binding: OnboardingReadHirePlan.example.roster,
  references: { legalName: "Fixture Hire", livedName: null },
});
const input = { crm: CrmReadHireData.example, roster, configuredJobEndDate: "06/30/2027" };

describe("hire plan validation", () => {
  it("validates the complete CRM record without mutating it", () => {
    const before = structuredClone(input);
    assert.deepEqual(readHirePlan(input), OnboardingReadHirePlan.example);
    assert.deepEqual(input, before);
    assert.equal(readHirePlan({ ...input, crm: { ...input.crm, fields: { ...input.crm.fields, effectiveDate: "9/1/2026" } } }).employee.effectiveDate, "09/01/2026");
  });

  it("keeps an explicit run postal override and normalizes only the documented incomplete suffix", () => {
    const crm = { ...input.crm, fields: { ...input.crm.fields, postalCode: "92093-123" } };
    assert.equal(readHirePlan({ ...input, crm }).employee.postalCode, "92093");
    const result = readHirePlan({ ...input, crm, postalCodeOverride: "10001-1234" });
    assert.equal(result.employee.postalCode, "10001-1234");
    assert.equal(result.postalCodeOverride, "10001-1234");
    assert.equal(crm.fields.postalCode, "92093-123");
    assert.throws(() => readHirePlan({ ...input, postalCodeOverride: "bad" }));
  });

  it("handles CRM placeholders and the no-SSN/ITIN path explicitly", () => {
    for (const ssn of ["", "N/A", "902-48-1357", "902-48-1357 "]) {
      const result = readHirePlan({ ...input, crm: { ...input.crm, fields: { ...input.crm.fields, ssn, middleName: "N/A" } } });
      assert.equal(result.employee.ssn, null);
      assert.equal(result.employee.middleName, "");
      assert.equal(result.ssnState, ssn.startsWith("9") ? "itin-or-placeholder" : "absent");
    }
    const result = readHirePlan({ ...input, crm: { ...input.crm, fields: { ...input.crm.fields, ssn: "123-45-6789" } } });
    assert.equal(result.employee.ssn, "123456789");
    assert.equal(result.ssnState, "provided");
  });

  it("uses the configured end date only for a blank CRM end date", () => {
    const result = readHirePlan({ ...input, crm: { ...input.crm, fields: { ...input.crm.fields, expectedJobEndDate: "" } } });
    assert.equal(result.jobEndDateSource, "configured");
    assert.equal(result.employee.expectedJobEndDate, input.configuredJobEndDate);
    assert.equal(readHirePlan({ ...input, configuredJobEndDate: "06/30/2026" }).jobEndDateSource, "crm");
    assert.equal(readHirePlan({ crm: input.crm, roster }).jobEndDateSource, "crm");
    assert.throws(() => readHirePlan({ crm: { ...input.crm, fields: { ...input.crm.fields, expectedJobEndDate: "" } }, roster }));
  });

  it("takes the legal name from the roster cell and splits both names against the CRM record", () => {
    const crm = { ...input.crm, recordFirstName: "Jon", fields: { ...input.crm.fields, firstName: "Jon" } };
    const startSnapshot = structuredClone(roster);
    startSnapshot.references = { legalName: "Jonathan Hire", livedName: "Jon" };
    const result = readHirePlan({ ...input, crm, roster: startSnapshot });
    assert.deepEqual(result.roster, startSnapshot.binding);
    assert.equal(result.employee.firstName, "Jonathan");
    assert.equal(result.employee.lastName, "Hire");
    assert.equal(result.employee.middleName, "");
    assert.equal(result.employee.preferredFirstName, "Jon");
    assert.equal(result.employee.preferredLastName, "Hire");
    assert.equal(result.employee.preferredMiddleName, "");
    startSnapshot.references.legalName = "Later Edit";
    startSnapshot.binding.referenceDigest = FingerprintSchema.parse("b".repeat(64));
    assert.equal(result.employee.firstName, "Jonathan");
    assert.equal(result.roster.referenceDigest, roster.binding.referenceDigest);
  });

  it("uses the legal name when the lived name is absent and refuses missing or foreign snapshot identity", () => {
    const result = readHirePlan(input);
    assert.equal(result.employee.preferredFirstName, "Fixture");
    assert.equal(result.employee.preferredLastName, "Hire");
    assert.equal(result.employee.preferredMiddleName, "");
    const foreign = { ...roster, binding: { ...roster.binding, rowKey: { email: "other@example.test" } } };
    assert.throws(() => readHirePlan({ ...input, roster: foreign }), /row key does not match/u);
    assert.equal(OnboardingReadHirePlan.input.safeParse({ crm: input.crm }).success, false);
    assert.throws(() => readHirePlan({ ...input, roster: { ...roster, references: { ...roster.references, legalName: " " } } }),
      (error: unknown) => !(error instanceof RosterNameUnresolvedError));
  });

  it("throws the unresolved-name error when the CRM record cannot prove the split", () => {
    for (const references of [{ legalName: "Fixture Other", livedName: null }, { legalName: "Fixture Hire", livedName: "Alex" }]) {
      assert.throws(() => readHirePlan({ ...input, roster: { ...roster, references } }), RosterNameUnresolvedError);
    }
  });

  it("takes the classification number leading the live appointment text", () => {
    assert.equal(input.crm.fields.appointment, "5 Student: Casual/Restricted");
    assert.equal(readHirePlan(input).employee.employeeClassification, "5");
  });

  it.each([
    { appointment: "Student" }, { appointment: "Casual/Restricted 5" }, { appointment: "5" }, { appointment: "" }, { wage: "$17.75 annually" }, { wage: "$0.00 per hour" },
    { postalCode: "bad" }, { dob: "02/30/2000" }, { effectiveDate: "02/30/2026" },
    { expectedJobEndDate: "06/30/2026" }, { expectedJobEndDate: "02/30/2027" }, { ssn: "bad" },
  ])("refuses invalid source values %j", fields => {
    assert.throws(() => readHirePlan({ ...input, crm: { ...input.crm, fields: { ...input.crm.fields, ...fields } } }),
      (error: unknown) => !(error instanceof RosterNameUnresolvedError));
  });
});
