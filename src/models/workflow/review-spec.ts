import { z } from "zod";
import { NodeIdSchema } from "../../rules/identity/ids.js";
import { ContractFieldPathSchema } from "../task/task-contract.js";
import { OperatorFieldDisplaySchema } from "./presentation.js";

const ReviewIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const ReviewTextSchema = z.string().trim().min(1);
const ReviewReadLocationSchema = z.strictObject({
  stepKey: ReviewIdSchema,
  page: ReviewTextSchema,
  field: ReviewTextSchema,
});
export const WorkflowReviewSourceSchema = z.strictObject({
  origin: ReviewTextSchema,
  detail: ReviewTextSchema,
  read: ReviewReadLocationSchema.optional(),
  chain: z.array(z.strictObject({ label: ReviewTextSchema, detail: ReviewTextSchema,
    read: ReviewReadLocationSchema.optional() })),
});
const FieldSchema = {
  id: ReviewIdSchema,
  source: WorkflowReviewSourceSchema,
};
export const WorkflowReviewFieldSchema = z.union([
  z.strictObject({ ...FieldSchema, operatorField: ReviewTextSchema }),
  z.strictObject({ ...FieldSchema, label: ReviewTextSchema, example: ReviewTextSchema.optional(), display: OperatorFieldDisplaySchema.optional(),
    transactionFields: z.array(z.strictObject({ nodeId: NodeIdSchema, kind: z.enum(["input", "output"]), fieldPath: ContractFieldPathSchema })).min(1) }),
  z.strictObject({ ...FieldSchema, label: ReviewTextSchema, example: ReviewTextSchema.optional(),
    constant: z.strictObject({ nodeIds: z.array(NodeIdSchema).min(1), value: z.union([z.string().min(1), z.boolean(), z.number().finite()]) }) }),
]);
export const WorkflowReviewPageSchema = z.strictObject({
  id: ReviewIdSchema,
  title: ReviewTextSchema,
  mode: z.enum(["Fill form", "Read only"]),
  nodeIds: z.array(NodeIdSchema).min(1),
  lines: z.array(z.strictObject({ id: ReviewIdSchema, kind: z.enum(["action", "check", "read"]),
    text: ReviewTextSchema, nodeIds: z.array(NodeIdSchema).min(1) })),
  fields: z.array(WorkflowReviewFieldSchema),
});
export const WorkflowStepReviewSchema = z.strictObject({
  pages: z.array(WorkflowReviewPageSchema),
  branchLabels: z.array(z.strictObject({ nodeId: NodeIdSchema, outcome: ReviewTextSchema, label: ReviewTextSchema })),
});
type ReadonlyReview<Value> = Value extends readonly (infer Item)[] ? readonly ReadonlyReview<Item>[]
  : Value extends object ? { readonly [Key in keyof Value]: ReadonlyReview<Value[Key]> } : Value;
export type WorkflowStepReview = ReadonlyReview<z.input<typeof WorkflowStepReviewSchema>>;
