import { z } from "zod";
import { ProviderCapabilityIdSchema, RunIdSchema, PositiveIntSchema, NodeIdSchema, TaskIdSchema } from "../../rules/identity/ids.js";

/** Parse-only identities for durable provider accounting recorded before AI retirement. */
export const HistoricalProviderCapabilitySchema = z.union([ProviderCapabilityIdSchema, z.literal("ai.advisory")]);
export const ProviderRunNodeExecutionIdentitySchema = z.strictObject({
  runId: RunIdSchema, attempt: PositiveIntSchema, nodeId: NodeIdSchema, taskId: TaskIdSchema,
});
export const HistoricalProviderExecutionIdentitySchema = z.union([
  ProviderRunNodeExecutionIdentitySchema,
  z.strictObject({ runId: RunIdSchema, attempt: PositiveIntSchema, surface: z.enum(["failure-triage", "contact-normalization"]) }),
]);
