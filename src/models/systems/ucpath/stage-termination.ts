/**
 * `ucpath/stage-termination` — the PREPARE arm of chunk 4's transaction
 * (ref write-safety §3 beat ②). Ref write-safety §12's worked example calls it `fill-termination`;
 * the shape is the same and this tree's naming rule wins.
 *
 * ## It stages the WHOLE wizard, and that is a finding, not a shortcut
 *
 * The 2026-08-13 live check proved there is **zero durable footprint** anywhere
 * in the Smart HR wizard before an explicit Save: the *Transactions in
 * Progress* grid was byte-identical after Page A, after `Create Transaction`,
 * after Page B, after `Continue`, and after Page C was fully staged, and
 * `Transaction ID` read the literal `"NEW"` throughout. So all three pages sit
 * on the reversible side of the fence and the commit is one click.
 *
 * ## What it proves before it returns
 *
 *  - **The subject.** Page B's `#PERSON_NAME_NAME_DISPLAY` is UCPath's own
 *    answer to the typed Empl ID, and it is returned as `observedName` for the
 *    kernel to bind at beat ③. Reading the Empl ID field back would prove
 *    nothing — it is the run's own input echoed to itself. **S48:** an Empl ID
 *    UCPath rejects never resolves a name, so it fails here by name rather than
 *    ten seconds later as an opaque timeout on the next page's first field
 *    (which is exactly how legacy discovers it).
 *  - **The reason option.** The control's whole option list is returned
 *    (§3.2 MAP EVERYTHING) together with the option the reason resolved to, so
 *    a map entry that no longer names a live option fails before the fence.
 *  - **S49, the read-back gate.** `lastDateWorkedOverridden` is a literal
 *    `true`: the override checkbox must read back CHECKED with the date field
 *    agreeing, or this refuses. Legacy already treats that as fatal, and it is
 *    the model the rest of this family follows.
 *  - **The crux itself.** `transactionIdDisplay` must read `"NEW"`. A staged
 *    wizard that already shows a `T…` is not a staged wizard.
 */
import { EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import {
  UCPATH_SMART_HR_DISPLAYED_PERSON_NAME,
  UCPATH_SMART_HR_TERMINATION_STAGED,
  UcpathTerminationStagingSchema,
  UcpathTerminationTargetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

export const UcpathStageTermination = defineTaskContract({
  id: taskId("ucpath/stage-termination"),
  title: "Stage UCPath Termination",
  effect: "prepare",
  input: UcpathTerminationTargetSchema,
  output: UcpathTerminationStagingSchema,
  errorCodes: [
    "ucpath-unavailable",
    "unexpected-page-state",
    "subject-mismatch",
    "emplid-not-recognized",
    "reason-code-not-offered",
    "last-date-worked-not-verified",
    "stage-not-persisted",
  ],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: ObservationIdSchema.parse(UCPATH_SMART_HR_DISPLAYED_PERSON_NAME),
    match: "normalized-exact-name",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: ["separations-ucpath-termination/dry-run-preview"],
  checkpoint: "in-memory-only",
  example: {
    stagedPageState: UCPATH_SMART_HR_TERMINATION_STAGED,
    emplId: EidSchema.parse("10800000"),
    observedName: "Deterministic Person",
    observedEmplRecord: "0",
    template: "UC_VOL_TERM",
    transactionDate: "06/11/2026",
    effectiveDate: "06/11/2026",
    resolvedReasonOption: "Resign - No Reason Given",
    observedReasonOptions: ["Resign - No Reason Given"],
    lastDateWorked: "06/10/2026",
    lastDateWorkedOverridden: true,
    transactionIdDisplay: "NEW",
    observedAt: "2026-08-13T10:18:00.000Z",
  },
});
