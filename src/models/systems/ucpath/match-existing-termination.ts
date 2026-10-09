/** The IDEMPOTENCY PROBE for the UCPath termination: does this person ALREADY have a termination transaction on this effective date — a four-state verdict, never a boolean. */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import {
  UCPATH_SS_SMART_HR_DISPLAYED_NAME,
  UcpathTerminationProofSchema,
  UcpathTerminationTargetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import { probeVerdictSchema } from "../../../rules/write-safety/write-safety-primitives.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

export const UcpathTerminationVerdictSchema = probeVerdictSchema(UcpathTerminationProofSchema);
export type UcpathTerminationVerdict = z.infer<typeof UcpathTerminationVerdictSchema>;

export const UcpathMatchExistingTermination = defineTaskContract({
  id: taskId("ucpath/match-existing-termination"),
  title: "Probe UCPath Termination",
  effect: "read",
  input: UcpathTerminationTargetSchema,
  output: UcpathTerminationVerdictSchema,
  errorCodes: ["ucpath-unavailable", "unexpected-page-state", "subject-mismatch"],
  subject: {
    kind: "person",
    // Verify the displayed name; the EID merely echoes this run's filter.
    expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: ObservationIdSchema.parse(UCPATH_SS_SMART_HR_DISPLAYED_NAME),
    match: "normalized-exact-name",
    requiredAt: "before-subject-read",
  },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  scenarios: [
    "separations-ucpath-termination/dry-run-preview",
    "separations-ucpath-termination/already-present",
  ],
  example: {
    state: "absent",
    evidence: {
      idempotencyKeyDigest: "0".repeat(64),
      source: UCPATH_SS_SMART_HR_DISPLAYED_NAME,
      sourceState: "ucpath.ss-smart-hr.transaction-ready",
      observedAt: "2026-08-13T10:18:00.000Z",
      queryDigest: "1".repeat(64),
      evidenceRef: "observation:00000000-0000-4000-8000-000000000000",
    },
  },
});

export { EidSchema, UcpathTerminationTargetSchema };
