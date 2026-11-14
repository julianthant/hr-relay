import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const CrmHireFieldsSchema = z.strictObject({
  positionNumber: z.string(), firstName: z.string(), lastName: z.string(), middleName: z.string(),
  ssn: z.string(), address: z.string(), addressLine2: z.string(), city: z.string(), state: z.string(),
  postalCode: z.string(), wage: z.string(), dob: z.string(), phone: z.string(), email: z.string(),
  appointment: z.string(), effectiveDate: z.string(), expectedJobEndDate: z.string(),
});
export type CrmHireFields = z.infer<typeof CrmHireFieldsSchema>;

export const CrmHireDataSchema = z.strictObject({
  recordId: z.string().min(1), recordUrl: z.url(),
  requestedEmail: z.email(), personalEmail: z.string(), workEmail: z.string(),
  recordFirstName: z.string().min(1), recordLastName: z.string().min(1),
  department: z.string(), recruitmentNumber: z.string(), fields: CrmHireFieldsSchema,
}).superRefine((data, ctx) => {
  const emails = [data.personalEmail, data.workEmail].map(value => value.trim().toLowerCase());
  if (!emails.includes(data.requestedEmail.toLowerCase()) || data.fields.email.trim() === ""
    || !emails.includes(data.fields.email.trim().toLowerCase())
    || data.fields.firstName.trim().toLowerCase() !== data.recordFirstName.trim().toLowerCase()
    || data.fields.lastName.trim().toLowerCase() !== data.recordLastName.trim().toLowerCase()) {
    ctx.addIssue({ code: "custom", message: "CRM hire data has inconsistent displayed identity evidence" });
  }
  if (!URL.canParse(data.recordUrl)) {
    ctx.addIssue({ code: "custom", path: ["recordUrl"], message: "CRM record URL is invalid" });
    return;
  }
  const url = new URL(data.recordUrl);
  if (url.origin !== "https://act-crm.my.site.com" || url.username !== "" || url.password !== "" || url.pathname !== "/hr/ONB_ViewOnboarding"
    || url.searchParams.get("id") !== data.recordId) {
    ctx.addIssue({ code: "custom", path: ["recordUrl"], message: "CRM hire data has an inconsistent record URL" });
  }
});
export type CrmHireData = z.infer<typeof CrmHireDataSchema>;

export const CrmReadHireData = defineTaskContract({
  id: taskId("crm/read-hire-data"), title: "Read CRM hire data", effect: "read",
  input: z.strictObject({ email: z.email() }), output: CrmHireDataSchema,
  errorCodes: ["ONBOARDING_CRM_READ_FAILED"],
  subject: { kind: "none", reason: "new hires have no EID; extraction verifies the record's displayed email and name before returning data" },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["onboarding/crm-extraction"],
  example: {
    recordId: "fixture-hire", recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=fixture-hire",
    requestedEmail: "hire@example.test", personalEmail: "hire@example.test", workEmail: "",
    recordFirstName: "Fixture", recordLastName: "Hire", department: "Dining (000412)", recruitmentNumber: "R123",
    fields: {
      positionNumber: "12345678", firstName: "Fixture", lastName: "Hire", middleName: "", ssn: "",
      address: "123 Example St", addressLine2: "", city: "San Diego", state: "CA", postalCode: "92093",
      wage: "$17.75 per hour", dob: "01/14/2000", phone: "", email: "hire@example.test",
      appointment: "5 Student: Casual/Restricted", effectiveDate: "09/11/2026", expectedJobEndDate: "06/30/2027",
    },
  },
});
