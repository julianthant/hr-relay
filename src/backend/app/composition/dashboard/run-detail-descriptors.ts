import { descriptorRuntimeNodes, runtimeNodeLabel, type AnyWorkflowDescriptor } from "../../../../workflow-kit/workflow.js";
import { reachableCommits, resolveFreshnessBound } from "../../../../models/workflow/checkpoint.js";

import { deriveSchemaHash } from "../../../../models/validation/schema-bound-value.js";

import type {
  RunDetailDataOriginView,
  RunDetailWriteContractView,
} from "../../../runs/queries/run-detail.js";
import { describeProofShape } from "../../../../models/validation/proof-shape.js";
import type { RegisteredTaskStore } from "../../../../workflow-kit/task-registry.js";

// Hash the result with the same output derivation used by gate execution.
export function gateNodeViewsOf(descriptor: AnyWorkflowDescriptor): readonly Readonly<{
  nodeId: string;
  label: string;
  dependsOn: readonly string[];
  resultSchemaHash: string;
}>[] {
  return descriptorRuntimeNodes(descriptor).flatMap((node) => (
    node.kind === "gate"
      ? [{
        nodeId: String(node.id),
        label: node.label,
        dependsOn: node.dependsOn.map(String),
        resultSchemaHash: deriveSchemaHash(node.result, "output"),
      }]
      : []
  ));
}

// Hash the proof with the same output derivation used by write resolution.
export function writeContractViewsOf(descriptor: AnyWorkflowDescriptor): readonly RunDetailWriteContractView[] {
  return descriptorRuntimeNodes(descriptor).flatMap((node) => {
    if (node.kind !== "transaction") return [];
    const completion = node.commit.uses.writeSafety.completion;
    return [{
      commitTaskId: String(node.commit.uses.id),
      completionKind: completion.kind,
      proofSchemaHash: deriveSchemaHash(completion.proofSchema, "output"),
      proof: describeProofShape(completion.proofSchema),
    }];
  });
}


export function dataOriginViewsOf(module: {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly stores: readonly RegisteredTaskStore[];
}): readonly RunDetailDataOriginView[] {
  const { descriptor } = module;
  const systemByTaskId = new Map<string, string>();
  for (const store of module.stores) {
    if (store.kind !== "browser") continue;
    for (const task of Object.values(store.tasks)) {
      systemByTaskId.set(String(task.contract.id), String(store.driver.system));
    }
  }
  const nodes = descriptorRuntimeNodes(descriptor);
  const commitNodeIds = new Set(
    nodes.filter((node) => node.kind === "transaction").map((node) => String(node.id)),
  );
  const editData = descriptor.capabilities?.editData;
  const declaredPaths = new Map<string, Set<string>>();
  const declare = (nodeId: string, fieldPath: string): void => {
    const existing = declaredPaths.get(nodeId);
    if (existing === undefined) declaredPaths.set(nodeId, new Set([fieldPath]));
    else existing.add(fieldPath);
  };
  for (const detail of descriptor.details) if ("nodeId" in detail.source) declare(String(detail.source.nodeId), detail.source.fieldPath);
  if (typeof editData === "object") {
    for (const field of editData.fields) declare(String(field.nodeId), field.fieldPath);
  }

  return nodes.flatMap((node) => {
    if (node.kind !== "task" && node.kind !== "transaction") return [];
    const paths = declaredPaths.get(String(node.id));
    const feeds = reachableCommits(nodes, node.id, commitNodeIds).map((sink) => {
      const target = nodes.find((candidate) => String(candidate.id) === String(sink.nodeId));
      return {
        nodeId: String(sink.nodeId),
        label: target === undefined ? String(sink.nodeId) : runtimeNodeLabel(target),
      };
    });
    const contracts = node.kind === "task"
      ? [{ role: "task" as const, contract: node.uses }]
      : [
        { role: "probe" as const, contract: node.commit.uses.writeSafety.idempotency.probe },
        { role: "prepare" as const, contract: node.prepare.uses },
        { role: "commit" as const, contract: node.commit.uses },
        ...(node.commit.uses.writeSafety.completion.kind === "receipt"
          ? []
          : [{ role: "verify" as const, contract: node.commit.uses.writeSafety.completion.verify }]),
      ];
    return contracts.map(({ role, contract }) => {
      const taskId = "id" in contract ? String(contract.id) : String(contract.taskId);
      return {
        nodeId: String(node.id),
        step: runtimeNodeLabel(node),
        taskId,
        role,
        operatorFields: descriptor.timeline.flatMap(group => (group.operatorFields ?? []).flatMap((field, index) =>
          field.sources.filter(source => source.nodeId === node.id).map(source => ({ label: field.label, kind: source.kind, fieldPath: source.fieldPath,
            declaration: `${descriptor.id}/${group.key}/${String(index)}`,
            ...(field.display === undefined ? {} : { display: field.display }) })))),
        dir: contract.effect === "read" ? "read" as const : "write" as const,
        ...(systemByTaskId.has(taskId) ? { system: systemByTaskId.get(taskId) } : {}),
        ...(role === "task" && "freshness" in contract && paths !== undefined
          ? {
            freshness: [...paths].sort().map((fieldPath) => {
              const bound = resolveFreshnessBound(contract.freshness, fieldPath);
              return {
                fieldPath,
                maxAge: Number.isFinite(bound.maxAgeMs) ? bound.maxAgeMs : "unbounded" as const,
                override: bound.override,
              };
            }),
          }
          : {}),
        feeds,
      };
    });
  });
}
