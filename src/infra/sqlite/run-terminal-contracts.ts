/** Strict inputs and reports for D110/D114's composite terminal mutations. */
import { z } from "zod";
import { RunRecordSchema } from "../../domain/run/record.js";
import { RunResultRecordSchema } from "../../domain/run/result.js";
import {
  FailureTerminalAuthorizationRecordSchema,
  SuccessTerminalAuthorizationRecordSchema,
} from "../../domain/run/terminal-authorization.js";
import { RunTerminalOutboxRecordSchema } from "../../domain/run/terminal-outbox.js";
import { FailureRecordSchema } from "../../domain/trust/failure.js";

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
  outbox: RunTerminalOutboxRecordSchema,
  authorization: SuccessTerminalAuthorizationRecordSchema,
}).superRefine((request, context) => {
  if (request.outbox.projection.state !== "pending") {
    context.addIssue({
      code: "custom",
      path: ["outbox", "projection", "state"],
      message: "a successful terminalization must create its outbox pending",
    });
  }
  if (request.result.runId !== request.authorization.runId
    || request.result.workflowId !== request.authorization.workflowId
    || request.result.attempt !== request.authorization.attempt
    || request.result.descriptorVersion !== request.authorization.descriptorVersion
    || request.result.contractFingerprint !== request.authorization.contractFingerprint
    || request.result.resultDigest !== request.authorization.resultDigest
    || request.outbox.outboxId !== request.authorization.outboxId) {
    context.addIssue({
      code: "custom",
      path: ["authorization"],
      message: "success authorization must bind the exact result and outbox identity",
    });
  }
});

export const FailureTerminalizationReportSchema = z.strictObject({
  state: z.enum(["applied", "replayed"]),
  authorization: FailureTerminalAuthorizationRecordSchema,
  failure: FailureRecordSchema,
  run: RunRecordSchema,
});

export const SuccessTerminalizationReportSchema = z.strictObject({
  state: z.enum(["applied", "replayed"]),
  authorization: SuccessTerminalAuthorizationRecordSchema,
  result: RunResultRecordSchema,
  outbox: RunTerminalOutboxRecordSchema,
  run: RunRecordSchema,
});

export const FailureTerminalizationStorageStepSchema = z.enum(["authorization", "failure", "run"]);
export const SuccessTerminalizationStorageStepSchema = z.enum(["authorization", "result", "outbox", "run"]);

export type FailureTerminalizationReport = z.infer<typeof FailureTerminalizationReportSchema>;
export type SuccessTerminalizationReport = z.infer<typeof SuccessTerminalizationReportSchema>;
export type FailureTerminalizationStorageStep = z.infer<typeof FailureTerminalizationStorageStepSchema>;
export type SuccessTerminalizationStorageStep = z.infer<typeof SuccessTerminalizationStorageStepSchema>;
