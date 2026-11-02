import { z } from "zod";
import { FingerprintSchema, GateIdSchema, NodeIdSchema, PositiveIntSchema, RunIdSchema } from "../../rules/identity/ids.js";

export const RunContinuationSchema = z.strictObject({
  sources: z.array(z.strictObject({ runId: RunIdSchema, version: PositiveIntSchema, attempt: PositiveIntSchema })).min(1).max(32),
  checkpoints: z.array(z.strictObject({ nodeId: NodeIdSchema, runId: RunIdSchema,
    attempt: PositiveIntSchema, claimGeneration: PositiveIntSchema, digest: FingerprintSchema })).max(256),
  gates: z.array(z.strictObject({ nodeId: NodeIdSchema, gateId: GateIdSchema, runId: RunIdSchema, digest: FingerprintSchema })).max(256),
}).superRefine((value, context) => {
  if (new Set(value.sources.map(source => source.runId)).size !== value.sources.length
    || new Set(value.checkpoints.map(row => row.nodeId)).size !== value.checkpoints.length
    || new Set(value.gates.map(row => row.nodeId)).size !== value.gates.length
    || [...value.checkpoints, ...value.gates].some(row => !value.sources.some(source => source.runId === row.runId))) {
    context.addIssue({ code: "custom", message: "Continuation evidence must have unique nodes and exact source membership" });
  }
});
export type RunContinuation = z.infer<typeof RunContinuationSchema>;
