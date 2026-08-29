import { z } from "zod";
import { canonicalJsonStringify, type JsonValue } from "../canonical-json.js";
import { ContractFieldPathSchema } from "../contracts/base.js";
import { deepFreeze } from "../immutability.js";
import { NodeIdSchema, TaskIdSchema, WorkflowIdSchema } from "../ids.js";
import {
  DataClassificationSchema,
  EvidenceTransformSchema,
  refineEvidenceTransformPair,
} from "../redaction-policy.js";
import type { RunEvidenceReceipt } from "./evidence.js";

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
export interface ChangedReceiptComparisonFact {
  readonly state: "changed";
  readonly factId: z.infer<typeof ReceiptComparisonFactIdSchema>;
  readonly label: string;
  readonly before: JsonValue;
  readonly after: JsonValue;
}

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

function allowedValue(
  fact: RunEvidenceReceipt["observations"][number],
  declaration: ReceiptComparisonFactDeclaration,
): JsonValue {
  if (fact.state !== "satisfied") {
    throw new Error(`comparison fact ${declaration.id} is unresolved in receipt ${fact.id}`);
  }
  const { value } = fact;
  if (
    value.classification !== declaration.disclosure.classification
    || value.transform !== declaration.disclosure.transform
  ) {
    throw new Error(
      `comparison fact ${declaration.id} expected ${declaration.disclosure.classification}/`
      + `${declaration.disclosure.transform}, but receipt fact ${fact.id} carries `
      + `${value.classification}/${value.transform}`,
    );
  }
  if (value.state !== "allowed" || value.transform !== "allow") {
    throw new Error(`comparison fact ${declaration.id} is not an allowed receipt value`);
  }
  return value.value;
}

function exactFacts(
  receipt: RunEvidenceReceipt,
  declaration: ReceiptComparisonFactDeclaration,
): readonly RunEvidenceReceipt["observations"][number][] {
  const { binding } = declaration;
  return receipt.observations.filter((fact) => (
    fact.state === "satisfied"
    && fact.field === String(binding.fieldPath).split(".").at(-1)
    && fact.value.key === binding.fieldPath
    && (fact.source.kind === "system" || fact.source.kind === "checkpoint")
    && binding.sourceKinds.includes(fact.source.kind)
    && fact.source.taskId === binding.taskId
  ));
}

/** Compare only coordinates the sealed registry explicitly reviewed. */
export function compareReceiptFacts(
  registry: ReceiptComparisonRegistry,
  prior: RunEvidenceReceipt,
  current: RunEvidenceReceipt,
): readonly ChangedReceiptComparisonFact[] {
  if (prior.workflowId !== registry.workflowId || current.workflowId !== registry.workflowId) {
    throw new Error(
      `comparison registry ${registry.workflowId} cannot compare receipts for `
      + `${prior.workflowId} and ${current.workflowId}`,
    );
  }
  const changes: ChangedReceiptComparisonFact[] = [];
  for (const declaration of registry.facts) {
    const beforeFacts = exactFacts(prior, declaration);
    const afterFacts = exactFacts(current, declaration);
    if (beforeFacts.length !== 1 || afterFacts.length !== 1) {
      throw new Error(
        `comparison fact ${declaration.id} requires one exact fact in each receipt; found `
        + `${String(beforeFacts.length)} in ${prior.receiptId} and ${String(afterFacts.length)} in ${current.receiptId}`,
      );
    }
    const beforeFact = beforeFacts[0];
    const afterFact = afterFacts[0];
    if (beforeFact === undefined || afterFact === undefined) {
      throw new Error(`comparison fact ${declaration.id} lost an exact fact after cardinality validation`);
    }
    const before = allowedValue(beforeFact, declaration);
    const after = allowedValue(afterFact, declaration);
    if (canonicalJsonStringify(before) !== canonicalJsonStringify(after)) {
      changes.push({ state: "changed", factId: declaration.id, label: declaration.label, before, after });
    }
  }
  return deepFreeze(changes);
}
