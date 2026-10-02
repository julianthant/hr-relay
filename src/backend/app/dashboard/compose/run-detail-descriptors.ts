import { descriptorRuntimeNodes, runtimeNodeLabel, type AnyWorkflowDescriptor } from "../../../../base/workflow.js";
import { reachableCommits, resolveFreshnessBound } from "../../../../domain/workflow/checkpoint.js";

import { deriveSchemaHash } from "../../../../domain/schema-bound-value.js";

import type {
  RunDetailDataOriginView,
  RunDetailWriteContractView,
} from "../../../runs/dashboard/queries/run-detail.js";
import { describeProofShape } from "../../../../domain/validation/proof-shape.js";
import type { RegisteredTaskStore } from "../../../../base/store.js";

/**
 * The gate nodes of a descriptor, in the shape the identity-gate section reads.
 *
 * `resultSchemaHash` is `deriveSchemaHash(node.result, "output")` — byte for
 * byte the value `executeResolveGate` compares an incoming payload against, so a
 * surface that echoes it back cannot be refused for naming a schema this build
 * does not have.
 */
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

/**
 * The transaction nodes of a descriptor, in the shape the parked-write
 * section's proof form reads (D245, ref write-safety §4.1).
 *
 * `proofSchemaHash` is `deriveSchemaHash(completion.proofSchema, "output")` —
 * byte for byte the value `resolvePresent` compares an incoming
 * `proof.schemaHash` against — and `proof` is that same schema described as a
 * field list, or the named reason this build cannot describe it. Both are
 * derived HERE for the reason stated on `gateNodeViewsOf`: the queries never
 * reach the descriptor builders, and a query that re-walked a proof schema
 * would be a second copy of the contract's identity.
 */
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

/**
 * D252/L3 — every ordinary task and every real transaction role, with the facts
 * the rail's origin line draws: the step's label, whether its task READS or
 * WRITES, the system it runs against, and the reuse bound its own contract
 * declares per field.
 *
 * Nothing here is inferred. `dir` is the node's task `effect` (ref task-contract's own
 * word for what a contract does to the world) — the rail's header comment used
 * to record direction as unservable because "nothing durable says whether a
 * recorded field was read or written", which is true of the CHECKPOINT ROW and
 * false of the descriptor that wrote it. `system` comes from the module's own
 * store list, the same binding the explorer's node panel reads, and a headless
 * store contributes none rather than a fabricated label. The bound is resolved
 * through `resolveFreshnessBound`, which is the function `auditCheckpointFreshness`
 * itself calls, and `feeds` through `reachableCommits` for the same reason —
 * the sentence the operator reads is the rule the executor applies.
 *
 * Probe/prepare/commit/verify each retain their invoked task id; this is what
 * lets an observed row resolve system without treating the transaction node's
 * commit as every beat. Only the field paths a Data entry can actually carry are resolved, which is
 * exactly `details[].source` ∪ `capabilities.editData.fields`: a bound for a
 * path no surface serves is a fact nobody reads.
 */
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
  for (const detail of descriptor.details) declare(String(detail.source.nodeId), detail.source.fieldPath);
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
