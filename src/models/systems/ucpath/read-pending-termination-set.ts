/**
 * Capture the exact stable-ID transaction set a pending sweep may act on.
 * This is a live read after identity authority, not an approval or a caller
 * bypass. The transaction probe re-reads the same question before any fence.
 */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import {
  UCPATH_SS_SMART_HR_DISPLAYED_NAME,
  UcpathPendingTransactionSetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

export const UcpathReadPendingTerminationSetInputSchema = z.strictObject({
  emplId: EidSchema,
  expectedName: z.string().min(1),
});

export const UcpathReadPendingTerminationSet = defineTaskContract({
  id: taskId("ucpath/read-pending-termination-set"),
  title: "Read Exact Pending UCPath Termination Set",
  effect: "read",
  input: UcpathReadPendingTerminationSetInputSchema,
  output: UcpathPendingTransactionSetSchema,
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
    kind: "ucpath-pending-termination-set",
    emplId: EidSchema.parse("10800000"),
    eligible: [],
    protected: [],
    observedAt: "2026-09-02T17:35:51.000Z",
    source: "ss-smart-hr-detail-read",
  },
});
