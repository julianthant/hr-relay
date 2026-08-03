/** The dedicated pending projection handoff created with a successful run. */
import { z } from "zod";
import {
  FingerprintSchema,
  IsoInstantSchema,
  OutboxIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from "../ids.js";

export const RunTerminalOutboxRecordSchema = z.strictObject({
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

export type RunTerminalOutboxRecord = z.infer<typeof RunTerminalOutboxRecordSchema>;
