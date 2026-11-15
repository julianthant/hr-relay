/** The PREPARE arm of the PayPath work-study transaction: fills Position Data and both comments and reads them back; saves nothing. */
import { z } from "zod";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import {
  UCPATH_PAYPATH_DISPLAYED_NAME, UCPATH_PAYPATH_REFUSAL_CODES, UCPATH_PAYPATH_WORK_STUDY_STAGED,
  UcpathPayPathStagedSchema, UcpathPayPathWorkStudyTargetSchema,
} from "../../ui/ucpath-paypath.js";

export const UcpathStagePayPathWorkStudyOutputSchema = z.strictObject({
  staged: UcpathPayPathStagedSchema,
  stagedPageState: z.literal(UCPATH_PAYPATH_WORK_STUDY_STAGED),
});

export const UcpathStagePayPathWorkStudy = defineTaskContract({
  id: taskId("ucpath/stage-paypath-work-study"),
  title: "Stage PayPath work-study transaction",
  effect: "prepare",
  input: UcpathPayPathWorkStudyTargetSchema,
  output: UcpathStagePayPathWorkStudyOutputSchema,
  errorCodes: [...UCPATH_PAYPATH_REFUSAL_CODES, "BROWSER_SCREENSHOT_CAPTURE_FAILED"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: UCPATH_PAYPATH_DISPLAYED_NAME,
    match: "normalized-exact-name",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: ["work-study/planned-transaction"],
  checkpoint: "in-memory-only",
  example: {
    stagedPageState: UCPATH_PAYPATH_WORK_STUDY_STAGED,
    staged: {
      pageStateId: UCPATH_PAYPATH_WORK_STUDY_STAGED, emplId: "10000001", displayedName: "Lee, Jordan", observedAt: "2026-08-03T18:00:00.000Z",
      values: {
        effectiveDate: "08/03/2026", positionChangeReason: "JRL", positionPool: "F",
        jobDataComments: "Updated pool id to F per work study award 08/03/2026",
        initiatorComments: "Updated pool id to F per work study award 08/03/2026",
      },
    },
  },
});
