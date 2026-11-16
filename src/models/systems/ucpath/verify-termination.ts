import { UcpathTransactionReceiptSchema } from "../../ui/ucpath-ss-smart-hr.js";
/** The `save-verify` READ-BACK: `present` requires the `T…` AND an approval status, and every non-`present` verdict parks. */
import { EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import {
  UCPATH_SS_SMART_HR_DISPLAYED_NAME,
  UcpathTerminationTargetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";
import { UcpathTerminationVerdictSchema } from "./match-existing-termination.js";

export const UcpathVerifyTermination = defineTaskContract({
  id: taskId("ucpath/verify-termination"),
  title: "Verify Filed UCPath Termination",
  effect: "read",
  input: UcpathTerminationTargetSchema.extend({ transactionId: UcpathTransactionReceiptSchema.optional() }),
  output: UcpathTerminationVerdictSchema,
  errorCodes: ["ucpath-unavailable", "unexpected-page-state", "subject-mismatch"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: ObservationIdSchema.parse(UCPATH_SS_SMART_HR_DISPLAYED_NAME),
    match: "normalized-exact-name",
    requiredAt: "before-subject-read",
  },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  scenarios: ["separations-ucpath-termination/dry-run-preview"],
  example: {
    state: "present",
    proof: {
      kind: "ucpath-termination",
      emplId: EidSchema.parse("10800000"),
      effectiveDate: "06/11/2026",
      transactionId: "T002209631",
      approvalStatus: "Pending",
      displayedName: "Deterministic Person",
      source: "ss-smart-hr-detail-read",
    },
  },
});

export { UcpathTerminationTargetSchema };
