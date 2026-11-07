import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { EmergencyContactResultSchema } from "./result.js";
export const ReadEmergencyContactResult = defineTaskContract({ id: taskId("workflow:emergency-contact/read-result"),
  title: "Account for approved contact members", effect: "read", input: EmergencyContactResultSchema, output: EmergencyContactResultSchema,
  errorCodes: ["OCR_REVIEW_REFUSED", "CONTACT_APPROVED_PLAN_CONFLICT", "CONTACT_APPROVED_FIELDS_INVALID"], subject: { kind: "none", reason: "Retains the released snapshot reference and exact settled member outcomes" },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [],
  example: { approval: { snapshotId: "00000000-0000-4000-8000-000000000001", sourceRunId: "00000000-0000-4000-8000-000000000002", revision: 1, digest: "a".repeat(64) }, members: [] },
});
