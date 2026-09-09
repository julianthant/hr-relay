/** Historical schema <=40 receipt. Never created by current settlement. */
import { z } from "zod";
import {
  FingerprintSchema,
  IsoInstantSchema,
  OutboxIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from "../ids.js";

export const HistoricalTerminalOutboxRecordSchema = z.strictObject({
  outboxId: OutboxIdSchema,
  payload: z.strictObject({
    kind: z.literal("run-terminal-result"),
    runId: RunIdSchema,
    workflowId: WorkflowIdSchema,
    attempt: PositiveIntSchema,
    resultDigest: FingerprintSchema,
  }),
  projection: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("pending") }),
    z.strictObject({
      state: z.literal("projected"),
      projectedAt: IsoInstantSchema,
      projectionFingerprint: FingerprintSchema,
    }),
  ]),
  createdAt: IsoInstantSchema,
});

export type HistoricalTerminalOutboxRecord = z.infer<typeof HistoricalTerminalOutboxRecordSchema>;

import { FailureTerminalAuthorizationRecordSchema, SuccessTerminalAuthorizationRecordSchema } from "./terminal-authorization.js";
export const HistoricalSuccessAuthorizationSchema = SuccessTerminalAuthorizationRecordSchema.extend({ outboxId: OutboxIdSchema });
export const HistoricalTerminalAuthorizationSchema = z.discriminatedUnion("kind", [
  FailureTerminalAuthorizationRecordSchema, HistoricalSuccessAuthorizationSchema,
]);
