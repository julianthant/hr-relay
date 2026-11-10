import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { CANONICAL_FIELDS } from "../../fields/registry.js";
import { CrmHireDataSchema } from "../../systems/crm/read-hire-data.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { UsDateSchema } from "../../config/schema.js";
import { HireEmployeeSchema } from "../../people/hire-employee.js";
import { OnboardingRosterBindingSchema, OnboardingRosterSnapshotRowSchema } from "./roster.js";

export const OnboardingPostalCodeSchema = CANONICAL_FIELDS.postalCode.schema;

export const HirePlanSchema = z.strictObject({
  recordId: z.string().min(1), roster: OnboardingRosterBindingSchema, employee: HireEmployeeSchema,
  postalCodeOverride: OnboardingPostalCodeSchema.nullable(),
  jobEndDateSource: z.enum(["crm", "configured"]), ssnState: z.enum(["provided", "absent", "itin-or-placeholder"]),
});

export const OnboardingReadHirePlan = defineTaskContract({
  id: taskId("workflow:onboarding/read-hire-plan"), title: "Validate hire data", effect: "read",
  input: z.strictObject({
    crm: CrmHireDataSchema, roster: OnboardingRosterSnapshotRowSchema,
    postalCodeOverride: OnboardingPostalCodeSchema.optional(),
    configuredJobEndDate: UsDateSchema.optional(),
  }), output: HirePlanSchema, errorCodes: ["ONBOARDING_DATA_INVALID", "ONBOARDING_NAME_UNRESOLVED"],
  subject: { kind: "none", reason: "pure validation over the email-bound CRM extraction, run-start roster snapshot and retained run configuration" },
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "derived" }, scenarios: [],
  example: {
    recordId: "fixture-hire", postalCodeOverride: null, jobEndDateSource: "crm", ssnState: "absent",
    roster: {
      workbookType: "onboarding-roster", workbookId: "fixture-onboarding-roster", referenceDigest: "a".repeat(64),
      workbookVersion: 1, sheetId: "fixture-people", rowId: "fixture-hire", capturedAt: "2026-09-01T18:00:00.000Z",
      rowKey: { email: "hire@example.test" },
    },
    employee: {
      firstName: "Fixture", lastName: "Hire", middleName: "", ssn: null, dob: "2000-01-14",
      preferredFirstName: "Fixture", preferredLastName: "Hire", preferredMiddleName: "",
      address: "123 Example St", addressLine2: "", city: "San Diego", state: "CA", postalCode: "92093",
      phone: "", email: "hire@example.test", positionNumber: "12345678", departmentNumber: "000412",
      recruitmentNumber: "R123", employeeClassification: "5", hourlyRateMinor: 1775,
      effectiveDate: "09/11/2026", expectedJobEndDate: "06/30/2027",
    },
  },
});
