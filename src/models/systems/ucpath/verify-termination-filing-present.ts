/** Freshly prove that the exact durable UCPath filing still exists before a Kuali finalization may cite it; this read never files or repairs anything. */
import { taskId, ObservationIdSchema } from "../../../rules/identity/ids.js";
import { TerminationReceiptSchema } from "../../../rules/separations/termination-receipt.js";
import {
  UCPATH_SS_SMART_HR_DISPLAYED_NAME,
  UcpathTerminationFilingPresenceProofSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

export const UcpathVerifyTerminationFilingPresent = defineTaskContract({
  id: taskId("ucpath/verify-termination-filing-present"),
  title: "Verify Current UCPath Termination Filing",
  effect: "read",
  input: TerminationReceiptSchema,
  output: UcpathTerminationFilingPresenceProofSchema,
  errorCodes: ["ucpath-unavailable", "unexpected-page-state", "subject-mismatch", "filing-not-current"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("displayedName"), identity: "name" },
    observe: ObservationIdSchema.parse(UCPATH_SS_SMART_HR_DISPLAYED_NAME),
    match: "normalized-exact-name",
    requiredAt: "before-subject-read",
  },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  scenarios: ["separations/finalization-committed"],
  example: {
    kind: "ucpath-termination-filing-presence",
    transactionId: "T002209631",
    emplId: "10800000",
    effectiveDate: "06/11/2026",
    approvalStatus: "Pending",
    displayedName: "Deterministic Person",
    observedAt: "2026-09-02T17:35:51.000Z",
    source: "ss-smart-hr-detail-read",
    receiptDisposition: "committed",
    authority: "kuali-finalization-precondition",
  },
});
