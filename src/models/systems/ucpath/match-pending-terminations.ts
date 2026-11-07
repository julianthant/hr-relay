/** The DATE-AGNOSTIC probe: does this person have ANY in-progress termination at all, with polarity inverted — no rows means `already-present`. */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import {
  UCPATH_SS_SMART_HR_DISPLAYED_NAME,
  UcpathPendingSweepSettlementProofSchema,
  UcpathPendingSweepTargetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import { probeVerdictSchema } from "../../../rules/write-safety/write-safety-primitives.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

export const UcpathPendingSweepVerdictSchema = probeVerdictSchema(
  UcpathPendingSweepSettlementProofSchema,
);
export type UcpathPendingSweepVerdict = z.infer<typeof UcpathPendingSweepVerdictSchema>;

export const UcpathMatchPendingTerminations = defineTaskContract({
  id: taskId("ucpath/match-pending-terminations"),
  title: "Probe Pending UCPath Terminations",
  effect: "read",
  input: UcpathPendingSweepTargetSchema,
  output: UcpathPendingSweepVerdictSchema,
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
  scenarios: [
    "separations-ucpath-termination/pending-sweep-nothing-to-do",
    "separations-ucpath-termination/pending-sweep-refuses-unreadable-scan",
  ],
  example: {
    state: "present",
    proof: {
      kind: "ucpath-pending-terminations-clear",
      emplId: EidSchema.parse("10800000"),
      scannedRowCount: 3,
      observedAt: "2026-08-13T10:18:00.000Z",
      source: "ss-smart-hr-detail-read",
      version: 2,
      selectedTransactionIds: "none",
      protectedTransactionIds: "T002204014",
      setDigest: "0".repeat(64),
    },
  },
});
