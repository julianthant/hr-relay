import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";
import { UcpathHireTargetSchema, UcpathHireVerdictSchema, UCPATH_HIRE_PROOF_EXAMPLE } from "../../ui/ucpath-hire.js";
import { UCPATH_HIRE_READ_CONTRACT } from "./hire-contract.js";

export const UcpathMatchHire = defineTaskContract({ ...UCPATH_HIRE_READ_CONTRACT, id: taskId("ucpath/match-hire"), title: "Check for an existing UCPath hire",
  input: UcpathHireTargetSchema, output: UcpathHireVerdictSchema,
  example: { state: "present", proof: UCPATH_HIRE_PROOF_EXAMPLE } });
