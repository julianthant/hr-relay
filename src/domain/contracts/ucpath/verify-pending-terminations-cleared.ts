/**
 * `ucpath/verify-pending-terminations-cleared` — the sweep's beat-⑥ read-back.
 *
 * A separate contract from `ucpath/match-pending-terminations` for the same
 * reason the termination's verifier is separate from its probe: the kernel
 * calls them at different beats with different leases, and a contract that
 * pointed its `verify` at its own probe would be a verifier that never
 * re-read.
 *
 * Its `present` arm is the honest one to state plainly: it means the grid, read
 * again after the delete, shows **no in-progress termination rows for this
 * person**. Anything else parks — including a scan that could not be read,
 * because "we could not check whether the rows are gone" and "the rows are
 * gone" are the two answers a delete verifier must never merge.
 */
import { EidSchema, ObservationIdSchema, taskId } from "../../ids.js";
import {
  UCPATH_SS_SMART_HR_DISPLAYED_NAME,
  UcpathPendingSweepTargetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";
import { UcpathPendingSweepVerdictSchema } from "./match-pending-terminations.js";

export const UcpathVerifyPendingTerminationsCleared = defineTaskContract({
  id: taskId("ucpath/verify-pending-terminations-cleared"),
  title: "Verify Pending UCPath Terminations Cleared",
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
  scenarios: ["separations-ucpath-termination/pending-sweep-nothing-to-do"],
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
