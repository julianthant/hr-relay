/** Strict inputs and reports for D110/D114's composite terminal mutations. */
import { z } from "zod";
import { IsoInstantSchema, NodeIdSchema, PositiveIntSchema, TaskIdSchema } from "../../domain/ids.js";
import { RunRecordSchema } from "../../domain/run/record.js";
import { RunResultRecordSchema } from "../../domain/run/result.js";
import { RunTerminalOutboxRecordSchema } from "../../domain/run/terminal-outbox.js";
import { FailureRecordSchema } from "../../domain/trust/failure.js";
import { RunClaimTokenSchema } from "./run-store-contracts.js";

export const FailureExecutionIdentitySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run") }),
  z.strictObject({
    kind: z.literal("node"),
    nodeId: NodeIdSchema,
    taskId: TaskIdSchema.optional(),
  }),
]);

export const FailureTerminalizationRequestSchema = z.strictObject({
  failure: FailureRecordSchema,
  execution: FailureExecutionIdentitySchema,
  expectedVersion: PositiveIntSchema,
  claim: RunClaimTokenSchema,
  now: IsoInstantSchema,
}).superRefine((request, context) => {
  const { failure, execution } = request;
  if (execution.kind === "run") {
    if (failure.nodeId !== undefined || failure.taskId !== undefined) {
      context.addIssue({ code: "custom", path: ["execution"], message: "run-level failure cannot carry node or task identity" });
    }
    return;
  }
  if (failure.nodeId !== execution.nodeId || failure.taskId !== execution.taskId) {
    context.addIssue({
      code: "custom",
      path: ["execution"],
      message: "failure node/task identity must equal the current execution identity",
    });
  }
});

export const SuccessTerminalizationRequestSchema = z.strictObject({
  result: RunResultRecordSchema,
  outbox: RunTerminalOutboxRecordSchema,
  expectedVersion: PositiveIntSchema,
  claim: RunClaimTokenSchema,
  now: IsoInstantSchema,
}).superRefine((request, context) => {
  if (request.outbox.projection.state !== "pending") {
    context.addIssue({
      code: "custom",
      path: ["outbox", "projection", "state"],
      message: "a successful terminalization must create its outbox pending",
    });
  }
});

export const FailureTerminalizationReportSchema = z.strictObject({
  state: z.enum(["applied", "replayed"]),
  failure: FailureRecordSchema,
  run: RunRecordSchema,
});

export const SuccessTerminalizationReportSchema = z.strictObject({
  state: z.enum(["applied", "replayed"]),
  result: RunResultRecordSchema,
  outbox: RunTerminalOutboxRecordSchema,
  run: RunRecordSchema,
});

export const FailureTerminalizationStorageStepSchema = z.enum(["failure", "run"]);
export const SuccessTerminalizationStorageStepSchema = z.enum(["result", "outbox", "run"]);

export type FailureTerminalizationReport = z.infer<typeof FailureTerminalizationReportSchema>;
export type SuccessTerminalizationReport = z.infer<typeof SuccessTerminalizationReportSchema>;
export type FailureTerminalizationStorageStep = z.infer<typeof FailureTerminalizationStorageStepSchema>;
export type SuccessTerminalizationStorageStep = z.infer<typeof SuccessTerminalizationStorageStepSchema>;
