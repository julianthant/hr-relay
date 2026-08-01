/**
 * A pure walk over a descriptor's graph.
 *
 * Phase 1e has no executor — workers land in 1f — but a descriptor's decisions
 * are pure functions, and they are exactly the part a scenario needs to
 * exercise: `bind`, `when`, `choose`, gate `resolve`, delegation planning and
 * joining, and the terminal `derive`. Walking them against supplied node
 * outputs proves the path end to end without a browser, and produces the
 * coverage-point ids the path actually exercised — so a scenario's claim is
 * observed rather than asserted.
 *
 * Everything the walk touches is re-parsed through the schema that owns it: a
 * bound input through the contract's input schema, a supplied output through
 * the contract's output schema, a gate result through the gate's result schema,
 * a child input through the TARGET's input schema. That is the same wall the
 * kernel puts around a real run (doc 02 §3), so a scenario cannot pass on a
 * value the runtime would reject.
 */
import type { z } from "zod";
import { descriptorRuntimeNodes } from "../../../src/base/workflow.js";
import type { AnyWorkflowDescriptor } from "../../../src/base/workflow.js";
import type { RuntimeFlowNode, RuntimeScope } from "../../../src/domain/workflow/graph.js";
import {
  joinDelegationOutcomes,
  planDelegationFanOut,
} from "../../../src/domain/workflow/delegation.js";

export interface WalkSupply {
  /** Node id → the value that node produces on this path. */
  readonly outputs: Readonly<Record<string, unknown>>;
  /** Child-run node id → the terminal outcomes its children reached. */
  readonly childOutcomes?: Readonly<Record<string, readonly unknown[]>>;
}

export interface WalkResult {
  readonly visited: readonly string[];
  readonly skipped: readonly string[];
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly result: unknown;
  /** Coverage-point ids this path actually exercised. */
  readonly covered: readonly string[];
}

function scopeFor(
  input: unknown,
  outputs: Readonly<Record<string, unknown>>,
  dependsOn: readonly string[],
): RuntimeScope {
  const visible: { [key: string]: unknown } = {};
  for (const id of dependsOn) visible[id] = outputs[id];
  // The walk mirrors the kernel: a node sees ONLY what it declared.
  return { input, outputs: visible } as unknown as RuntimeScope;
}

function requireSupplied(supply: WalkSupply, nodeId: string): unknown {
  if (!Object.hasOwn(supply.outputs, nodeId)) {
    throw new Error(`scenario supplied no output for node ${nodeId}`);
  }
  return supply.outputs[nodeId];
}

export function walkDescriptor(
  descriptor: AnyWorkflowDescriptor,
  rawInput: unknown,
  supply: WalkSupply,
): WalkResult {
  const input: unknown = descriptor.input.parse(rawInput);
  const nodes: readonly RuntimeFlowNode[] = descriptorRuntimeNodes(descriptor);
  const outputs: { [key: string]: unknown } = {};
  const visited: string[] = [];
  const skipped: string[] = [];
  const covered: string[] = [];

  for (const node of nodes) {
    const id = String(node.id);
    const dependsOn = node.dependsOn.map(String);
    const scope = scopeFor(input, outputs, dependsOn);

    switch (node.kind) {
      case "task": {
        if (node.when !== undefined && !node.when(scope)) {
          skipped.push(id);
          outputs[id] = undefined;
          continue;
        }
        node.uses.input.parse(node.bind(scope));
        outputs[id] = node.uses.output.parse(requireSupplied(supply, id));
        visited.push(id);
        break;
      }
      case "transaction": {
        node.prepare.uses.input.parse(node.prepare.bind(scope));
        node.commit.uses.input.parse(node.commit.bind(scope));
        const supplied = requireSupplied(supply, id);
        const outcome = supplied as { disposition: string; output: unknown };
        node.commit.uses.output.parse(outcome.output);
        outputs[id] = supplied;
        visited.push(id);
        covered.push(`transaction:${id}/${outcome.disposition === "committed" ? "committed" : "already-present"}`);
        break;
      }
      case "branch": {
        const selected = node.choose(scope);
        if (!Object.hasOwn(node.cases, selected)) {
          throw new Error(`branch ${id} chose "${selected}", which is not one of its cases`);
        }
        outputs[id] = { selected };
        visited.push(id);
        covered.push(`branch-case:${id}/${selected}`);
        break;
      }
      case "parallel": {
        outputs[id] = {
          join: node.join,
          branches: Object.fromEntries(node.branches.map((branch) => [branch.id, branch.nodes.map(String)])),
        };
        visited.push(id);
        break;
      }
      case "child-run": {
        const plan = planDelegationFanOut({
          edgeId: node.edgeId,
          target: node.target,
          cardinality: node.cardinality,
          join: node.join,
          policy: node.policy,
          bound: node.bind(scope),
          deriveChildItemId: node.deriveChildItemId,
        });
        const size = plan.children.length === 0 ? "zero" : plan.children.length === 1 ? "one" : "many";
        covered.push(`delegation:${id}/fan-out-${size}`);
        if (node.await === "none") {
          outputs[id] = { manifestId: plan.planFingerprint, edgeId: plan.edgeId, childCount: plan.children.length };
          visited.push(id);
          break;
        }
        const outcomes = (supply.childOutcomes?.[id] ?? []).map((outcome) =>
          Object.freeze(outcome as Readonly<{ state: string; itemId: string }>));
        const joined = joinDelegationOutcomes(
          plan,
          outcomes as never,
        );
        covered.push(`delegation:${id}/on-child-failed-${node.policy.onChildFailed}`);
        covered.push(`delegation:${id}/cascade-cancel-${node.policy.cascadeCancel}`);
        covered.push(`delegation:${id}/after-child-retry-${node.policy.afterChildRetry}`);
        outputs[id] = node.cardinality === "one" ? joined.outcomes[0] : joined.outcomes;
        visited.push(id);
        break;
      }
      case "gate": {
        const supplied = requireSupplied(supply, id);
        outputs[id] = node.resolvedBy === "operator"
          ? node.result.parse(supplied)
          : node.result.parse(node.resolve(node.subscribes.event.parse(supplied)));
        visited.push(id);
        covered.push(`gate:${id}/opened`, `gate:${id}/resolved`);
        break;
      }
    }
  }

  const resultSpec = Reflect.get(descriptor, "result") as {
    readonly schema: z.ZodType;
    readonly dependsOn: readonly string[];
    readonly derive: (scope: RuntimeScope) => unknown;
  };
  const result: unknown = resultSpec.schema.parse(
    resultSpec.derive(scopeFor(input, outputs, resultSpec.dependsOn)),
  );

  return {
    visited: Object.freeze(visited),
    skipped: Object.freeze(skipped),
    outputs: Object.freeze({ ...outputs }),
    result,
    covered: Object.freeze([...new Set(covered)]),
  };
}
