/**
 * Doc 09 §14.6 #2 — the identity-approval gate cannot be bypassed by graph
 * shape: a separation-class commit is graph-reachable ONLY through an
 * operator gate node. The checker walks every dependsOn ancestry path from a
 * transaction node toward the graph roots; any path that reaches a root
 * without crossing an operator gate leaves the commit un-gated.
 *
 * ALWAYS-GATE is ratified for separations (D77): every registered descriptor
 * whose id names the separation class MUST pass; no such descriptor exists in
 * Phase 1f, so the checker is executed against fixtures BOTH ways — the graph
 * fixture's gated transaction passes and an ungated separation-shaped graph
 * fails — which keeps the sweep non-vacuous.
 *
 * NOTE (directed resolution): doc 02 owns gate-result plumbing generically
 * (schema-bound stored results), but the typed `IdentityApprovalResult`
 * payload of doc 09 §14.4 has no registered gate yet — it lands with the
 * first gated separation workflow. Until then ONLY this graph-structural
 * property is truthfully enforceable, and this guard enforces exactly that.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../src/base/workflow.js";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import type { RuntimeFlowNode } from "../../../src/domain/workflow/graph.js";
import { fixtureDescriptor } from "./helpers/descriptor-fixtures.js";
import {
  writeFixtureDescriptor,
  writeFixtureSaveDescriptor,
} from "../fixtures/write-sequencer-fixtures.js";

/** Workflow ids that carry doc 09 §14's ALWAYS-GATE separation policy. */
const SEPARATION_CLASS_PATTERN = /separation|termination|offboard/iu;

interface UngatedPath {
  readonly transactionId: string;
  readonly path: readonly string[];
}

/**
 * Every dependsOn ancestry path from each transaction node must cross an
 * operator gate before reaching a root. Returns each violating path.
 */
export function ungatedTransactionPaths(nodes: readonly RuntimeFlowNode[]): readonly UngatedPath[] {
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const violations: UngatedPath[] = [];
  const walk = (node: RuntimeFlowNode, transactionId: string, path: readonly string[]): void => {
    if (node.kind === "gate" && node.resolvedBy === "operator") return; // this path is gated
    if (node.dependsOn.length === 0) {
      violations.push({ transactionId, path: [...path, String(node.id)] });
      return;
    }
    for (const dependency of node.dependsOn) {
      const parent = byId.get(String(dependency));
      if (parent === undefined) {
        throw new Error(`node "${node.id}" depends on unknown node "${dependency}"`);
      }
      walk(parent, transactionId, [...path, String(node.id)]);
    }
  };
  for (const node of nodes) {
    if (node.kind !== "transaction") continue;
    walk(node, String(node.id), []);
  }
  return violations;
}

function auditDescriptor(descriptor: AnyWorkflowDescriptor): readonly UngatedPath[] {
  return ungatedTransactionPaths(descriptorRuntimeNodes(descriptor));
}

describe("identity gate before commit", () => {
  it("every separation-class registered descriptor routes its commits through an operator gate", () => {
    for (const descriptor of DESCRIPTORS) {
      if (!SEPARATION_CLASS_PATTERN.test(String(descriptor.id))) continue;
      const violations = auditDescriptor(descriptor);
      assert.deepEqual(
        violations,
        [],
        `${descriptor.id}: a separation commit is reachable without the identity-approval gate`,
      );
    }
  });

  it("accepts the gated fixture transaction (positive executable arm)", () => {
    // fixture-graph's "submit" transaction depends on the "approval" operator
    // gate: every ancestry path crosses it.
    assert.deepEqual(auditDescriptor(fixtureDescriptor), []);
  });

  it("flags an ungated transaction (negative executable arm)", () => {
    // The write-fixture descriptors are deliberately gate-free (they are NOT
    // separation-class workflows); the checker must SEE that, or the sweep
    // above could pass by being blind.
    for (const descriptor of [writeFixtureDescriptor, writeFixtureSaveDescriptor]) {
      assert.ok(
        !SEPARATION_CLASS_PATTERN.test(String(descriptor.id)),
        `${descriptor.id} must not claim the separation class while ungated`,
      );
      const violations = auditDescriptor(descriptor);
      assert.equal(violations.length, 1, String(descriptor.id));
      assert.equal(violations[0].transactionId, "submit-write");
    }
  });

  it("catches a gate that guards only ONE of two paths to the commit", () => {
    const nodes = [
      { kind: "task", id: "resolve", dependsOn: [] },
      { kind: "gate", id: "identity-approval", resolvedBy: "operator", dependsOn: ["resolve"] },
      { kind: "task", id: "side-read", dependsOn: [] },
      { kind: "transaction", id: "terminate", dependsOn: ["identity-approval", "side-read"] },
    ] as unknown as readonly RuntimeFlowNode[];
    const violations = ungatedTransactionPaths(nodes);
    assert.equal(violations.length, 1);
    assert.deepEqual(violations[0].path, ["terminate", "side-read"]);
  });

  it("keeps the separation-class pattern anchored to real vocabulary", () => {
    for (const sample of ["separation", "i9-separation", "kuali-separation", "ucpath-termination"]) {
      assert.ok(SEPARATION_CLASS_PATTERN.test(sample), sample);
    }
    for (const sample of ["person-lookup", "write-fixture", "onboarding"]) {
      assert.ok(!SEPARATION_CLASS_PATTERN.test(sample), sample);
    }
  });
});
