import { z } from "zod";
import { NodeIdSchema } from "../../rules/identity/ids.js";
import { ContractFieldPathSchema } from "../task/task-contract.js";
import { OperatorFieldDisplaySchema } from "./presentation.js";

const ReviewIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const ReviewTextSchema = z.string().trim().min(1);
/** Shows a part when any alternative holds: each key (an Explorer option or decision id) holds one of its values. */
export const ReviewWhenSchema = z.array(z.record(z.string().min(1), z.array(z.string()).min(1))).min(1);
const Gate = { when: ReviewWhenSchema.optional() };
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
const NodeFieldSchema = z.strictObject({ nodeId: NodeIdSchema, kind: z.enum(["input", "output"]), fieldPath: ContractFieldPathSchema });
const FieldSchema = {
  id: ReviewIdSchema,
  source: WorkflowReviewSourceSchema,
  ...Gate,
};
const LabelledFieldSchema = { ...FieldSchema, label: ReviewTextSchema, example: ReviewTextSchema.optional() };
export const WorkflowReviewFieldSchema = z.union([
  z.strictObject({ ...FieldSchema, operatorField: ReviewTextSchema }),
  z.strictObject({ ...LabelledFieldSchema, display: OperatorFieldDisplaySchema.optional(), transactionFields: z.array(NodeFieldSchema).min(1) }),
  z.strictObject({ ...LabelledFieldSchema, display: OperatorFieldDisplaySchema.optional(), taskFields: z.array(NodeFieldSchema).min(1) }),
  /** A value the operator typed when the run started, read from the workflow input. */
  z.strictObject({ ...LabelledFieldSchema, inputField: ContractFieldPathSchema }),
  z.strictObject({ ...LabelledFieldSchema,
    constant: z.strictObject({ nodeIds: z.array(NodeIdSchema).min(1), value: z.union([z.string().min(1), z.boolean(), z.number().finite()]) }) }),
]);
const LineBase = { id: ReviewIdSchema, nodeIds: z.array(NodeIdSchema).min(1), ...Gate };
export const WorkflowReviewLineSchema = z.union([
  z.strictObject({ ...LineBase, kind: z.enum(["action", "check", "read"]), text: ReviewTextSchema }),
  /** The control the step presses on the page, drawn as "Clicks <target>". */
  z.strictObject({ ...LineBase, kind: z.literal("click"), target: ReviewTextSchema }),
]);
export const WorkflowReviewPageSchema = z.strictObject({
  id: ReviewIdSchema,
  title: ReviewTextSchema,
  mode: z.enum(["Fill form", "Read only"]),
  nodeIds: z.array(NodeIdSchema).min(1),
  ...Gate,
  lines: z.array(WorkflowReviewLineSchema),
  fields: z.array(WorkflowReviewFieldSchema),
});
/**
 * One decision point the step's run takes from one closed output of a task in the step. Each outcome names a value that output
 * can hold; its label defaults to the operator field display of that output, and `then` says what the run does next
 * (omitted only for an outcome that simply continues).
 */
export const WorkflowReviewDecisionSchema = z.strictObject({
  id: ReviewIdSchema,
  label: ReviewTextSchema,
  reads: z.strictObject({ nodeId: NodeIdSchema, fieldPath: ContractFieldPathSchema }),
  /** The step's nodes whose declared failures stop the run at this decision point. */
  nodeIds: z.array(NodeIdSchema).min(1),
  initial: z.union([z.string(), z.strictObject({ by: ReviewIdSchema, values: z.record(z.string(), z.string()), otherwise: z.string() })]),
  ...Gate,
  outcomes: z.array(z.strictObject({ value: z.string(), label: ReviewTextSchema.optional(), then: ReviewTextSchema.optional(),
    stops: z.literal(true).optional(), ...Gate })).min(1),
});
export const WorkflowStepReviewSchema = z.strictObject({
  /** When the step runs, beyond what its selection, omission and input conditions already say; for conditions on earlier outcomes. */
  ...Gate,
  pages: z.array(WorkflowReviewPageSchema),
  starts: z.array(z.strictObject({ nodeId: NodeIdSchema, each: ReviewTextSchema, ...Gate })).optional(),
  branchLabels: z.array(z.strictObject({ nodeId: NodeIdSchema, outcome: ReviewTextSchema, label: ReviewTextSchema })),
  decisions: z.array(WorkflowReviewDecisionSchema).optional(),
});
type ReadonlyReview<Value> = Value extends readonly (infer Item)[] ? readonly ReadonlyReview<Item>[]
  : Value extends object ? { readonly [Key in keyof Value]: ReadonlyReview<Value[Key]> } : Value;
export type WorkflowStepReview = ReadonlyReview<z.input<typeof WorkflowStepReviewSchema>>;
