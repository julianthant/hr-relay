/**
 * `ucpath/match-existing-termination` — ref write-safety §5's IDEMPOTENCY PROBE for the UCPath
 * termination, and chunk 4's **S44** read.
 *
 * It answers exactly one question: does this person ALREADY have a termination
 * transaction on this effective date? The answer is a four-state
 * `ProbeVerdict`, never a boolean, and the two states legacy collapses are the
 * two that matter here:
 *
 *  - `present`   — a `Terminat*` row with this exact effective date ⇒ typed
 *                  proof carrying its `T…` AND its approval status. The number
 *                  alone is never the proof: a **Denied** transaction carries a
 *                  perfectly well-formed `T…` (live `T002204014`), so legacy's
 *                  `/^T\d{6,}$/` test stamps a refused write as a receipt.
 *  - `absent`    — the scan completed and no such row exists ⇒ typed evidence.
 *  - `ambiguous` — more than one `Terminat*` row on that date ⇒ park. Two
 *                  terminations on one date is not a state this may pick from.
 *  - `unknown`   — the scan could not be read ⇒ park. **S45/S46:** legacy
 *                  propagates a probe throw (sound) but treats a matched row
 *                  whose `T#` could not be read as NO MATCH and proceeds to
 *                  create — an unreadable receipt is not an absent transaction.
 *
 * ## The page, and the page it is deliberately NOT
 *
 * `UC_EXTENSIONS.UC_SS_TBH.GBL` — the "SS Smart HR Transactions" search — read
 * live 2026-08-13. The "Smart HR Transaction Status" dashboard is **not** used:
 * it carries no Transaction ID column at all and returned **0 rows** for a
 * subject with two known real transactions, so a probe built on it would report
 * "no duplicate" about a person who has one.
 */
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
    // The NAME, not the EID. The EID is the run's own filter echoed back to it;
    // the name is UCPath's own answer to that filter, and it is the only thing
    // on this page that can catch a probe reading the wrong person's list.
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
