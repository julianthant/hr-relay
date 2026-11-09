import { z } from "zod";
import { BrowserSystemIdSchema, ErrorCodeSchema, NodeIdSchema, TaskIdSchema, WorkflowIdSchema } from "../../rules/identity/ids.js";
import { ContractSchemaLeafKindSchema } from "../validation/contract-boundary.js";
import { ContractFieldPathSchema } from "../task/task-contract.js";
import { SessionNeedSchema } from "../sessions/session.js";
import { FileAcceptSpecSchema, SurfaceFieldSchema, UploadFieldSpecSchema } from "../workflow/ingress.js";
import { OperatorFieldDisplaySchema } from "../workflow/presentation.js";
import { WorkflowReviewSourceSchema } from "../workflow/review-spec.js";

const TextSchema = z.string().min(1);
const ReviewLabelSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("authored"), text: TextSchema }),
  z.strictObject({ state: z.literal("unavailable"), reason: TextSchema }),
]);
export const ExplorerReviewDecisionSchema = z.strictObject({
  id: TextSchema,
  nodeId: NodeIdSchema,
  kind: z.enum(["task", "condition", "branch", "gate", "delegation", "transaction", "parallel", "failure"]),
  outcome: TextSchema,
  action: z.enum(["continue", "ask", "stop"]),
  label: ReviewLabelSchema,
  taskId: TaskIdSchema.optional(),
  failureCode: ErrorCodeSchema.optional(),
});
export type ExplorerReviewDecision = z.infer<typeof ExplorerReviewDecisionSchema>;
export const ExplorerReviewSpecSchema = z.strictObject({
  unlistedFailure: z.literal("Anything not listed stops the run with a failure card"),
  runOptions: z.strictObject({
    start: z.strictObject({ input: z.boolean(), upload: z.boolean(), emptyOpensUpload: z.boolean() }),
    supportsDryRun: z.boolean(),
    mode: z.strictObject({ field: TextSchema, label: TextSchema, initial: TextSchema.nullable(),
      options: z.array(z.strictObject({ value: TextSchema, label: TextSchema, defaults: z.array(SurfaceFieldSchema) })).min(1) }).optional(),
    controls: z.array(z.strictObject({ field: TextSchema, label: TextSchema, placement: z.enum(["input", "step"]),
      modes: z.array(TextSchema).min(1), requires: z.array(TextSchema), kind: ContractSchemaLeafKindSchema,
      options: z.array(z.string()).min(1).optional() })),
    upload: z.strictObject({ fields: z.array(UploadFieldSpecSchema), accepts: z.array(FileAcceptSpecSchema).min(1) }).optional(),
  }),
  sessionStep: z.strictObject({
    id: z.literal("browser-sessions"), title: z.literal("Open browser sessions"),
    unavailableDelegations: z.array(z.strictObject({ workflowId: WorkflowIdSchema, nodeId: NodeIdSchema, reason: TextSchema })),
    requirements: z.array(z.strictObject({
      id: TextSchema, workflowId: WorkflowIdSchema, stepKey: TextSchema, stepTitle: TextSchema,
      nodeId: NodeIdSchema, taskId: TaskIdSchema, need: SessionNeedSchema,
      scope: z.enum(["direct", "delegated"]),
      timing: z.enum(["when-step-runs", "when-delegated-step-runs"]),
      delegationPath: z.array(z.strictObject({ workflowId: WorkflowIdSchema, stepKey: TextSchema, nodeId: NodeIdSchema })),
      signIn: z.literal("required-by-declaration"), lock: z.enum(["exclusive-required", "not-exclusive"]),
    })),
  }),
  steps: z.array(z.strictObject({
    id: TextSchema, title: TextSchema, system: z.union([BrowserSystemIdSchema, z.literal("local")]).optional(),
    pages: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("unavailable"), reason: TextSchema }),
      z.strictObject({ state: z.literal("authored"), items: z.array(z.strictObject({
        id: TextSchema, title: TextSchema, mode: z.enum(["Fill form", "Read only"]), nodeIds: z.array(NodeIdSchema).min(1),
        lines: z.array(z.strictObject({ id: TextSchema, kind: z.enum(["action", "check", "read"]), text: TextSchema,
          nodeIds: z.array(NodeIdSchema).min(1) })),
        fields: z.array(z.strictObject({ id: TextSchema, label: TextSchema, example: TextSchema.optional(),
          display: OperatorFieldDisplaySchema.optional(), options: z.array(z.string()).min(1).optional(),
          sources: z.array(z.strictObject({ nodeId: NodeIdSchema, kind: z.enum(["input", "output"]), fieldPath: ContractFieldPathSchema })).min(1),
          source: WorkflowReviewSourceSchema,
        })),
      })) }),
    ]),
    decisions: z.array(ExplorerReviewDecisionSchema),
  })).min(1),
});
export type ExplorerReviewSpec = z.infer<typeof ExplorerReviewSpecSchema>;
