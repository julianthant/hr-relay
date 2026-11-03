import { z } from "zod";
import { defineTaskContract, ContractFieldPathSchema } from "../../task/task-contract.js";
import { taskId, TaskIdSchema } from "../../../rules/identity/ids.js";
import { UcpathHireTargetSchema, UcpathHireIdentitySchema, UcpathHireProofSchema, UcpathHireScanSchema, UcpathHireVerdictSchema,
  UcpathHireStagingSchema, UCPATH_HIRE_SUBJECT, UCPATH_HIRE_STAGED, UCPATH_HIRE_PROOF_EXAMPLE, ucpathHireKey } from "../../ui/ucpath-hire.js";

const discovery = { kind: "none", reason: "Independently scans and verifies every exact hire transaction before reporting saved-effect evidence" } as const;
const subject = { kind: "person", expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
  observe: UCPATH_HIRE_SUBJECT, match: "normalized-exact-name", requiredAt: "after-prepare-before-fence" } as const;
const read = { effect: "read", errorCodes: ["UCPATH_HIRE_REFUSED"], subject: discovery,
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "live" }, scenarios: ["onboarding/write-transactions"] } as const;
export const UcpathReadHireFindings = defineTaskContract({ ...read, id: taskId("ucpath/read-hire-findings"), title: "Read UCPath hire transactions",
  input: UcpathHireIdentitySchema, output: UcpathHireScanSchema,
  example: { state: "complete", rows: [], observedAt: "2026-09-01T18:00:00.000Z", source: "ss-smart-hr-list-and-detail" } });
export const UcpathMatchHire = defineTaskContract({ ...read, id: taskId("ucpath/match-hire"), title: "Check for an existing UCPath hire",
  input: UcpathHireTargetSchema, output: UcpathHireVerdictSchema,
  example: { state: "present", proof: UCPATH_HIRE_PROOF_EXAMPLE } });
export const UcpathVerifyHire = defineTaskContract({ ...read, id: taskId("ucpath/verify-hire"), title: "Verify the filed UCPath hire",
  input: UcpathHireTargetSchema, output: UcpathHireVerdictSchema,
  example: { state: "present", proof: UCPATH_HIRE_PROOF_EXAMPLE } });
export const UcpathStageHire = defineTaskContract({ id: taskId("ucpath/stage-hire"), title: "Fill UCPath hire wizard", effect: "prepare",
  input: UcpathHireTargetSchema, output: UcpathHireStagingSchema, subject, errorCodes: ["UCPATH_HIRE_REFUSED"],
  checkpoint: "in-memory-only", scenarios: ["onboarding/write-transactions"],
  example: { stagedPageState: UCPATH_HIRE_STAGED, observedName: "Fixture Hire", transactionIdDisplay: "NEW",
    template: "UC_FULL_HIRE", reason: "Hire - No Prior UC Affiliation" } });
const Output = z.strictObject({ receipt: UcpathHireProofSchema });
export const UcpathCreateHire = defineTaskContract({ id: taskId("ucpath/create-hire"), title: "Submit UCPath hire", effect: "commit",
  input: UcpathHireTargetSchema, output: Output, subject, errorCodes: ["UCPATH_HIRE_REFUSED"], scenarios: ["onboarding/write-transactions"],
  writeSafety: {
    completion: { kind: "save-verify", verify: { taskId: TaskIdSchema.parse("ucpath/verify-hire"), effect: "read" }, proofSchema: UcpathHireProofSchema,
      proofFromOutput: (output: z.output<typeof Output>) => output.receipt,
      proofFromPresentProbe: (verdict: { proof: z.output<typeof UcpathHireProofSchema> }) => verdict.proof,
      outputFromProof: (proof: z.output<typeof UcpathHireProofSchema>) => ({ receipt: proof }) },
    idempotency: { probe: { taskId: TaskIdSchema.parse("ucpath/match-hire"), effect: "read" }, key: ucpathHireKey,
      recoveryAbsence: { kind: "operator-only", reason: "UCPath hire propagation has no verified negative-recovery window; uncertain submissions require operator resolution" } },
  }, example: { receipt: UCPATH_HIRE_PROOF_EXAMPLE } });
