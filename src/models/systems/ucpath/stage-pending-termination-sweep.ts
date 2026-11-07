/** Stage and read back selections only; refuse settled or wrong-person rows. */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import {
  UCPATH_SMART_HR_IN_PROGRESS_NAME,
  UCPATH_SMART_HR_TERMINATION_STAGED,
  UcpathPendingSweepStagingSchema,
  UcpathPendingSweepTargetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

export const UcpathStagePendingTerminationSweep = defineTaskContract({
  id: taskId("ucpath/stage-pending-termination-sweep"),
  title: "Select Pending UCPath Terminations",
  effect: "prepare",
  input: UcpathPendingSweepTargetSchema,
  output: UcpathPendingSweepStagingSchema,
  errorCodes: [
    "ucpath-unavailable",
    "unexpected-page-state",
    "subject-mismatch",
    "selection-not-persisted",
  ],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: ObservationIdSchema.parse(UCPATH_SMART_HR_IN_PROGRESS_NAME),
    match: "normalized-exact-name",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: ["separations-ucpath-termination/pending-sweep-nothing-to-do"],
  checkpoint: "in-memory-only",
  example: {
    stagedPageState: UCPATH_SMART_HR_TERMINATION_STAGED,
    emplId: EidSchema.parse("10800000"),
    observedName: "Deterministic Person",
    selected: [{
      transactionType: "JOB",
      effectiveDate: "06/11/2026",
      displayedName: "Deterministic Person",
      emplId: EidSchema.parse("10800000"),
      action: "Terminatn",
      country: "United States",
      transactionId: "T009000001",
    }],
    observedAt: "2026-08-13T10:18:00.000Z",
  },
});

export type UcpathPendingSweepPrepareOutput = z.output<typeof UcpathPendingSweepStagingSchema>;
