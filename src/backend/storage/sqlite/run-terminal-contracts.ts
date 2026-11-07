
import { z } from "zod";
import { RunRecordSchema } from "../../../models/run/record.js";
import { RunResultRecordSchema, terminalEvidenceResult } from "../../../models/run/result.js";
import {
  FailureTerminalAuthorizationRecordSchema,
  SuccessTerminalAuthorizationRecordSchema,
} from "../../../models/run/terminal-authorization.js";
import { FailureRecordSchema } from "../../../models/trust/failure.js";

export const FailureTerminalizationRequestSchema = z.strictObject({
  failure: FailureRecordSchema,
  authorization: FailureTerminalAuthorizationRecordSchema,
}).superRefine((request, context) => {
  if (request.failure.runId !== request.authorization.runId
    || request.failure.workflowId !== request.authorization.workflowId
    || request.failure.attempt !== request.authorization.attempt
    || request.failure.failureId !== request.authorization.failureId) {
    context.addIssue({
      code: "custom",
      path: ["authorization"],
      message: "failure authorization must bind the exact failure/run identity",
    });
  }
});

export const SuccessTerminalizationRequestSchema = z.strictObject({
  result: RunResultRecordSchema,
  authorization: SuccessTerminalAuthorizationRecordSchema,
}).superRefine((request, context) => {
  if (terminalEvidenceResult(request.result) !== undefined
    || request.result.runId !== request.authorization.runId
    || request.result.workflowId !== request.authorization.workflowId
    || request.result.attempt !== request.authorization.attempt
    || request.result.descriptorVersion !== request.authorization.descriptorVersion
    || request.result.contractFingerprint !== request.authorization.contractFingerprint
    || request.result.resultDigest !== request.authorization.resultDigest) {
    context.addIssue({ code: "custom", path: ["authorization"], message: "success authorization must bind the exact result identity" });
  }
});

export const FailureTerminalizationReportSchema = z.strictObject({
  state: z.enum(["applied", "replayed"]),
  authorization: FailureTerminalAuthorizationRecordSchema,
  failure: FailureRecordSchema,
  result: RunResultRecordSchema,
  run: RunRecordSchema,
});

export const SuccessTerminalizationReportSchema = z.strictObject({
  state: z.enum(["applied", "replayed"]),
  authorization: SuccessTerminalAuthorizationRecordSchema,
  result: RunResultRecordSchema,
  run: RunRecordSchema,
});

export const FailureTerminalizationStorageStepSchema = z.enum(["failure", "result", "run"]);
export const SuccessTerminalizationStorageStepSchema = z.enum(["result", "run"]);

export type FailureTerminalizationReport = z.infer<typeof FailureTerminalizationReportSchema>;
export type SuccessTerminalizationReport = z.infer<typeof SuccessTerminalizationReportSchema>;
export type FailureTerminalizationStorageStep = z.infer<typeof FailureTerminalizationStorageStepSchema>;
export type SuccessTerminalizationStorageStep = z.infer<typeof SuccessTerminalizationStorageStepSchema>;
