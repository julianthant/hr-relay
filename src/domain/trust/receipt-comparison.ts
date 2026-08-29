import { z } from "zod";
import { ContractFieldPathSchema } from "../contracts/base.js";
import { deepFreeze } from "../immutability.js";
import { NodeIdSchema, TaskIdSchema, WorkflowIdSchema } from "../ids.js";
import {
  DataClassificationSchema,
  EvidenceTransformSchema,
  refineEvidenceTransformPair,
} from "../redaction-policy.js";

export const ReceiptComparisonFactIdSchema = z.string()
  .regex(/^separations\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/u)
  .brand<"ReceiptComparisonFactId">();

const ReceiptComparisonDisclosureSchema = z.strictObject({
  posture: z.enum(["allow", "withhold"]),
  classification: DataClassificationSchema,
  transform: EvidenceTransformSchema,
}).superRefine((disclosure, context) => {
  refineEvidenceTransformPair(disclosure, context);
  if (
    disclosure.posture === "allow"
    && (disclosure.classification !== "safe-diagnostic" || disclosure.transform !== "allow")
  ) {
    context.addIssue({
      code: "custom",
      path: ["posture"],
      message: "only safe-diagnostic/allow facts may cross the comparison boundary",
    });
  }
});

export const ReceiptComparisonFactDeclarationSchema = z.strictObject({
  id: ReceiptComparisonFactIdSchema,
  label: z.string().min(1),
  disclosure: ReceiptComparisonDisclosureSchema,
  binding: z.strictObject({
    collection: z.literal("observations"),
    sourceKinds: z.array(z.enum(["system", "checkpoint"])).min(1),
    nodeId: NodeIdSchema,
    taskId: TaskIdSchema,
    fieldPath: ContractFieldPathSchema,
  }).superRefine((binding, context) => {
    if (new Set(binding.sourceKinds).size !== binding.sourceKinds.length) {
      context.addIssue({ code: "custom", path: ["sourceKinds"], message: "source kinds must be unique" });
    }
  }),
});

const ReceiptComparisonRegistryInputSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  facts: z.array(ReceiptComparisonFactDeclarationSchema).min(1),
});

export type ReceiptComparisonFactDeclaration = z.infer<typeof ReceiptComparisonFactDeclarationSchema>;
export type ReceiptComparisonRegistry = z.infer<typeof ReceiptComparisonRegistryInputSchema>;

interface ComparisonDescriptorNode {
  readonly id: string;
  readonly kind: string;
  readonly uses?: Readonly<{ id: string }>;
  readonly commit?: Readonly<{ uses: Readonly<{ id: string }> }>;
}

interface ComparisonDescriptor {
  readonly id: string;
  readonly nodes: readonly ComparisonDescriptorNode[];
}

function taskIdOf(node: ComparisonDescriptorNode): string | undefined {
  if (node.kind === "task") return node.uses?.id;
  if (node.kind === "transaction") return node.commit?.uses.id;
  return undefined;
}

/**
 * Seal one closed receipt-comparison registry against the descriptor it claims
 * to describe. A receipt stores a task/source/field coordinate but no node id,
 * so the declaration is accepted only when the CURRENT descriptor proves that
 * the named node owns that exact task.
 */
export function defineReceiptComparisonRegistry(
  descriptor: ComparisonDescriptor,
  input: unknown,
): ReceiptComparisonRegistry {
  const registry = ReceiptComparisonRegistryInputSchema.parse(input);
  if (String(registry.workflowId) !== descriptor.id) {
    throw new Error(
      `comparison registry ${registry.workflowId} cannot be sealed against descriptor ${descriptor.id}`,
    );
  }
  const factIds = registry.facts.map(({ id }) => String(id));
  if (new Set(factIds).size !== factIds.length) {
    throw new Error(`comparison registry ${registry.workflowId} declares a fact id more than once`);
  }
  for (const fact of registry.facts) {
    const node = descriptor.nodes.find((candidate) => candidate.id === String(fact.binding.nodeId));
    if (node === undefined) {
      throw new Error(
        `comparison fact ${fact.id} names node ${fact.binding.nodeId}, which the current ${descriptor.id} descriptor does not declare`,
      );
    }
    const actualTaskId = taskIdOf(node);
    if (actualTaskId !== String(fact.binding.taskId)) {
      throw new Error(
        `comparison fact ${fact.id} binds node ${fact.binding.nodeId} to task ${fact.binding.taskId}, `
        + `but the current ${descriptor.id} descriptor binds that node to ${actualTaskId ?? "no task"}`,
      );
    }
  }
  return deepFreeze(registry);
}
