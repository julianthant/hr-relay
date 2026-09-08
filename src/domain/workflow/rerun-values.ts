import { z } from "zod";
import { NodeIdSchema } from "../ids.js";
import { ContractFieldPathSchema } from "../contracts/base.js";

/** Optional source attribution for a new assertion; never a checkpoint patch. */
export const RerunValueMappingSchema = z.strictObject({
  nodeId: NodeIdSchema,
  fieldPath: ContractFieldPathSchema,
  label: z.string().min(1),
  targetFieldPath: ContractFieldPathSchema,
  targetStepKey: z.string().min(1).optional(),
});
export type RerunValueMappingSpec = z.input<typeof RerunValueMappingSchema>;
export type RerunValueMapping = z.infer<typeof RerunValueMappingSchema>;

export const RerunValueMappingsSchema = z.array(RerunValueMappingSchema).superRefine((mappings, ctx) => {
  const keys = mappings.map(({ nodeId, fieldPath, targetFieldPath, targetStepKey }) =>
    JSON.stringify([nodeId, fieldPath, targetFieldPath, targetStepKey]));
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "duplicate Rerun value mapping" });
});
