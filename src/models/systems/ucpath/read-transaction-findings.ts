import { z } from "zod";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";
import { EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import { UCPATH_SS_SMART_HR_DISPLAYED_NAME } from "../../ui/ucpath-smart-hr-termination.js";
import { UcpathTransactionFindingsReadSchema } from "../../ui/ucpath-transaction-findings.js";

export const UcpathReadTransactionFindingsInputSchema = z.strictObject({
  emplId: EidSchema,
  expectedName: z.string().min(1),
});

export const UcpathReadTransactionFindings = defineTaskContract({
  id: taskId("ucpath/read-transaction-findings"),
  title: "Read UCPath Transaction Findings",
  effect: "read",
  input: UcpathReadTransactionFindingsInputSchema,
  output: UcpathTransactionFindingsReadSchema,
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
  scenarios: ["separations-ucpath-termination/pending-sweep-nothing-to-do"],
  example: {
    state: "read",
    emplId: EidSchema.parse("10800000"),
    rows: [],
    scannedRowCount: 0,
    completeness: { state: "complete", reportedRowCount: 0 },
    observedAt: "2026-11-02T18:00:00.000Z",
    source: "ss-smart-hr-list-and-detail",
  },
});
