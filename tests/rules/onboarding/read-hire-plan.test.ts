import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CrmReadHireData } from "../../../src/models/systems/crm/read-hire-data.js";
import { OnboardingReadHirePlan } from "../../../src/models/workflows/onboarding/read-hire-plan.js";
import { OnboardingRosterSnapshotRowSchema } from "../../../src/models/workflows/onboarding/roster.js";
import { readHirePlan } from "../../../src/rules/onboarding/read-hire-plan.js";

const roster = OnboardingRosterSnapshotRowSchema.parse({
  binding: OnboardingReadHirePlan.example.roster,
  references: { legalName: { firstName: "Fixture", lastName: "Hire", middleName: "" }, livedName: null },
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
    for (const ssn of ["", "N/A", "999-99-9999", "912-34-5678"]) {
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

  it("uses only the supplied roster snapshot for legal and lived names", () => {
    const startSnapshot = structuredClone(roster);
    startSnapshot.references.legalName = { firstName: "Legal", lastName: "Snapshot", middleName: "Middle" };
    startSnapshot.references.livedName = { firstName: "Lived", lastName: "Snapshot", middleName: "" };
    const result = readHirePlan({ ...input, roster: startSnapshot });
    assert.deepEqual(result.roster, startSnapshot.binding);
    assert.equal(result.employee.firstName, "Legal");
    assert.equal(result.employee.lastName, "Snapshot");
    assert.equal(result.employee.middleName, "Middle");
    assert.equal(result.employee.preferredFirstName, "Lived");
    assert.equal(result.employee.preferredLastName, "Snapshot");
    assert.equal(result.employee.preferredMiddleName, "");
    assert.equal(input.crm.fields.firstName, "Fixture");
    startSnapshot.references.legalName.firstName = "Later edit";
    startSnapshot.binding.snapshotId = "later-snapshot";
    assert.equal(result.employee.firstName, "Legal");
    assert.equal(result.roster.snapshotId, roster.binding.snapshotId);
  });

  it("uses legal names when lived names are explicitly absent and refuses missing or foreign snapshot identity", () => {
    const result = readHirePlan(input);
    assert.equal(result.employee.preferredFirstName, roster.references.legalName.firstName);
    assert.equal(result.employee.preferredLastName, roster.references.legalName.lastName);
    assert.equal(result.employee.preferredMiddleName, roster.references.legalName.middleName);
    const foreign = { ...roster, binding: { ...roster.binding, rowKey: { email: "other@example.test" } } };
    assert.throws(() => readHirePlan({ ...input, roster: foreign }), /row key does not match/u);
    assert.equal(OnboardingReadHirePlan.input.safeParse({ crm: input.crm }).success, false);
    assert.throws(() => readHirePlan({ ...input, roster: { ...roster, references: { ...roster.references,
      legalName: { firstName: " ", lastName: "Hire", middleName: "" },
    } } }));
  });

  it.each([
    { appointment: "Student" }, { wage: "$17.75 annually" }, { wage: "$0.00 per hour" },
    { postalCode: "bad" }, { dob: "02/30/2000" }, { effectiveDate: "02/30/2026" },
    { expectedJobEndDate: "06/30/2026" }, { expectedJobEndDate: "02/30/2027" }, { ssn: "bad" },
  ])("refuses invalid source values %j", fields => {
    assert.throws(() => readHirePlan({ ...input, crm: { ...input.crm, fields: { ...input.crm.fields, ...fields } } }));
  });
});
