/** The PREPARE arm of the termination: it stages the WHOLE wizard, proves the subject, the reason option, the read-back gate and the `"NEW"` display, and commits nothing. */
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
