import { z } from "zod";
import { NodeIdSchema } from "../../rules/identity/ids.js";
import { JsonValueSchema } from "../../rules/validation/canonical-json.js";
import { TransactionDryRunPreviewSchema } from "../../rules/write-safety/write-safety-primitives.js";

export const DRY_RUN_TRANSACTION_NUMBER = "T000000000000";

export const DryRunSampleSchema = z.strictObject({
  label: z.literal("dry-run sample"),
  sourceNodeId: NodeIdSchema,
  field: z.string().min(1),
  value: JsonValueSchema,
});
export type DryRunSample = z.infer<typeof DryRunSampleSchema>;

export const DryRunStepSchema = z.discriminatedUnion("state", [
  z.strictObject({ nodeId: NodeIdSchema, state: z.literal("exercised") }),
  z.strictObject({ nodeId: NodeIdSchema, state: z.literal("transaction-preview"), preview: TransactionDryRunPreviewSchema,
    samples: z.array(DryRunSampleSchema) }),
  z.strictObject({ nodeId: NodeIdSchema, state: z.literal("unavailable"), reason: z.literal("requires-unsubmitted-output") }),
  z.strictObject({ nodeId: NodeIdSchema, state: z.literal("not-run"), reason: z.enum(["condition-false", "branch-not-selected", "step-omitted", "operator-asserted"]) }),
]);
export type DryRunStep = z.infer<typeof DryRunStepSchema>;

export interface DryRunBinding {
  readonly prepare: unknown;
  readonly commit: unknown;
  readonly samples: readonly DryRunSample[];
}
export interface DryRunScope {
  readonly transactions: readonly Extract<DryRunStep, { state: "transaction-preview" }>[];
}

export function containsDryRunSample(value: unknown): boolean {
  if (typeof value === "string") return value === DRY_RUN_TRANSACTION_NUMBER || value.includes("dry-run sample");
  if (Array.isArray(value)) return value.some(containsDryRunSample);
  return value !== null && typeof value === "object" && Object.values(value).some(containsDryRunSample);
}
