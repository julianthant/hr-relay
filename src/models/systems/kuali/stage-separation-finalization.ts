/** The PREPARE arm of the finalization transaction: it stages every field in one pass, proves the document, the subject, the department option and every read-back field, and saves nothing. */
import { EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import { KUALI_RRSS_DISPLAYED_EID } from "../../ui/kuali-rrss-document.js";
import {
  KUALI_RRSS_FINALIZATION_STAGED,
  KualiFinalizationStagingSchema,
  KualiFinalizationTargetSchema,
} from "../../ui/kuali-separation-finalization.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";
import { EXAMPLE_KUALI_FINALIZATION_FIELDS } from "./match-separation-finalization.js";

export const KualiStageSeparationFinalization = defineTaskContract({
  id: taskId("kuali/stage-separation-finalization"),
  title: "Stage Kuali Separation Finalization",
  effect: "prepare",
  input: KualiFinalizationTargetSchema,
  output: KualiFinalizationStagingSchema,
  // Every declared refusal must have a producer.
  errorCodes: [
    "unexpected-page-state",
    "subject-mismatch",
    "department-option-not-offered",
    "comments-changed-since-read",
    "stage-not-persisted",
  ],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("emplId"), identity: "eid" },
    observe: ObservationIdSchema.parse(KUALI_RRSS_DISPLAYED_EID),
    match: "normalized-exact-eid",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: ["separations-kuali-finalization/stage-refusals"],
  checkpoint: "in-memory-only",
  example: {
    stagedPageState: KUALI_RRSS_FINALIZATION_STAGED,
    actionId: "0123456789abcdef01234567",
    documentNumber: "4444",
    observedEid: EidSchema.parse("10800000"),
    previousFields: {
      department: "- - -",
      payrollTitleCode: "",
      payrollTitle: "",
      requestAcknowledged: false,
      timekeeperName: "",
      lastDayWorked: "",
      separationDate: "",
      terminationEffectiveDate: "",
      submittedTerminationTemplate: false,
      transactionNumber: "",
      finalPay: null,
      timekeeperComments: "",
    },
    stagedFields: EXAMPLE_KUALI_FINALIZATION_FIELDS,
    observedDepartmentOptions: ["- - -", "000412 - Housing/Dining/Hospitality"],
    observedAt: "2026-08-14T10:18:00.000Z",
  },
});
