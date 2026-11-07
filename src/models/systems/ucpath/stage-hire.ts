import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { UcpathHireTargetSchema, UcpathHireStagingSchema, UCPATH_HIRE_STAGED } from "../../ui/ucpath-hire.js";
import { UCPATH_HIRE_SUBJECT_CONTRACT } from "./hire-contract.js";

export const UcpathStageHire = defineTaskContract({ id: taskId("ucpath/stage-hire"), title: "Fill UCPath hire wizard", effect: "prepare",
  input: UcpathHireTargetSchema, output: UcpathHireStagingSchema, subject: UCPATH_HIRE_SUBJECT_CONTRACT, errorCodes: ["UCPATH_HIRE_REFUSED"],
  checkpoint: "in-memory-only", scenarios: ["onboarding/write-transactions"],
  example: { stagedPageState: UCPATH_HIRE_STAGED, observedName: "Fixture Hire", transactionIdDisplay: "NEW",
    template: "UC_FULL_HIRE", reason: "Hire - No Prior UC Affiliation" } });
