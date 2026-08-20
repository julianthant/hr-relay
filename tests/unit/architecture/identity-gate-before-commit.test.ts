/**
 * Ref write-safety §14.6 #2 — the identity-approval gate cannot be bypassed by graph
 * shape: in a separation-class descriptor, a commit AND the terminal result are
 * graph-reachable ONLY through an operator gate node. The checker walks every
 * dependsOn ancestry path from a sink toward the graph roots; any path that
 * reaches a root without crossing an operator gate leaves that sink un-gated.
 *
 * **The terminal half landed with separations chunk 3 (2026-08-12).** Until then
 * only transaction nodes were audited, which was the whole truth while every
 * separation-class descriptor that existed was read-only and gate-free. It stops
 * being the whole truth the moment a read-only chunk produces an APPROVED
 * SUBJECT that a later composition consumes as a write's `expected` side: a
 * terminal result reachable without the gate would hand that composition an
 * identity no human ever confirmed, and the transaction it eventually feeds
 * would be perfectly gated on a graph that never asked. Both sinks are audited,
 * and the terminal arm is what `separations-identity-check` — the first
 * registered separation-class descriptor with a gate — actually exercises.
 *
 * ALWAYS-GATE is ratified for separations (D77): every registered descriptor
 * whose id names the separation class MUST pass. The checker is also executed
 * against fixtures BOTH ways — the graph fixture's gated transaction passes and
 * an ungated separation-shaped graph fails — which keeps the sweep non-vacuous
 * even for the arms no registered descriptor reaches yet.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../src/base/workflow.js";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import { IdentityApprovalResultSchema } from "../../../src/domain/separations/identity-approval.js";
import { deriveSchemaHash } from "../../../src/domain/schema-bound-value.js";
import type { RuntimeFlowNode } from "../../../src/domain/workflow/graph.js";
import { fixtureDescriptor } from "./helpers/descriptor-fixtures.js";
import {
  writeFixtureDescriptor,
  writeFixtureSaveDescriptor,
} from "../fixtures/write-sequencer-fixtures.js";

/** Workflow ids that carry ref write-safety §14's ALWAYS-GATE separation policy. */
const SEPARATION_CLASS_PATTERN = /separation|termination|offboard/iu;

interface UngatedPath {
  readonly transactionId: string;
  readonly path: readonly string[];
}

/**
 * The nodes the gate's decision was made IN THE PRESENCE OF: every operator gate
 * plus its whole transitive `dependsOn` closure.
 *
 * This set is what makes the walk below mean the right thing. The property that
 * matters is not "the gate is literally on every edge" — a post-gate node has to
 * be able to read the evidence it is checking the approval against, so it
 * necessarily also depends on the node that produced that evidence. What must
 * never happen is data reaching a sink that the OPERATOR NEVER SAW: a side read
 * hanging off the graph root, feeding the commit, invisible at the gate. A node
 * inside the gate's own ancestry was, by the descriptor's own declaration, part
 * of the decision; a node outside it was not.
 */
function gateAncestry(nodes: readonly RuntimeFlowNode[]): ReadonlySet<string> {
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = byId.get(id);
    if (node === undefined) throw new Error(`gate ancestry reached unknown node "${id}"`);
    for (const dependency of node.dependsOn) visit(String(dependency));
  };
  for (const node of nodes) {
    if (node.kind === "gate" && node.resolvedBy === "operator") visit(String(node.id));
  }
  return seen;
}

function walkToRoots(
  nodes: readonly RuntimeFlowNode[],
  sinkId: string,
  starts: readonly string[],
): readonly UngatedPath[] {
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const gated = gateAncestry(nodes);
  const violations: UngatedPath[] = [];
  const walk = (node: RuntimeFlowNode, path: readonly string[]): void => {
    if (gated.has(String(node.id))) return;
    if (node.dependsOn.length === 0) {
      violations.push({ transactionId: sinkId, path: [...path, String(node.id)] });
      return;
    }
    for (const dependency of node.dependsOn) {
      const parent = byId.get(String(dependency));
      if (parent === undefined) {
        throw new Error(`node "${node.id}" depends on unknown node "${dependency}"`);
      }
      walk(parent, [...path, String(node.id)]);
    }
  };
  for (const start of starts) {
    const node = byId.get(start);
    if (node === undefined) throw new Error(`"${sinkId}" depends on unknown node "${start}"`);
    walk(node, sinkId === start ? [] : [sinkId]);
  }
  return violations;
}

/**
 * Every dependsOn ancestry path from each transaction node must reach the gate's
 * ancestry before a root. Returns each violating path.
 */
export function ungatedTransactionPaths(nodes: readonly RuntimeFlowNode[]): readonly UngatedPath[] {
  return nodes.flatMap((node) => (
    node.kind === "transaction" ? walkToRoots(nodes, String(node.id), [String(node.id)]) : []
  ));
}

/**
 * The same walk from the TERMINAL RESULT's declared dependencies.
 *
 * A read-only separation chunk has no transaction node, and its product — an
 * approved subject — is exactly what a later composition binds a real write's
 * `expected` side to. So the terminal result is a sink in its own right, and the
 * gate must dominate it too.
 */
export function ungatedTerminalPaths(
  nodes: readonly RuntimeFlowNode[],
  terminalDependsOn: readonly string[],
): readonly UngatedPath[] {
  return walkToRoots(nodes, "<terminal>", terminalDependsOn.map(String));
}

function terminalDependsOnOf(descriptor: AnyWorkflowDescriptor): readonly string[] {
  const result = Reflect.get(descriptor, "result") as { readonly dependsOn: readonly string[] };
  return result.dependsOn.map(String);
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

  it("routes every separation-class TERMINAL RESULT through the gate too", () => {
    let audited = 0;
    for (const descriptor of DESCRIPTORS) {
      if (!SEPARATION_CLASS_PATTERN.test(String(descriptor.id))) continue;
      const nodes = descriptorRuntimeNodes(descriptor);
      // Only descriptors that HAVE a gate owe this: chunks 1 and 2 read a
      // timecard and a document and resolve no person, so §14.8's two checkable
      // facts hold for them and the sweep must not claim otherwise.
      if (!nodes.some((node) => node.kind === "gate" && node.resolvedBy === "operator")) continue;
      audited += 1;
      assert.deepEqual(
        ungatedTerminalPaths(nodes, terminalDependsOnOf(descriptor)),
        [],
        `${descriptor.id}: the terminal result is derivable without the identity-approval gate`,
      );
    }
    assert.ok(audited > 0, "no registered separation-class descriptor declares an operator gate");
  });

  it("flags a separation-shaped graph whose terminal result reads what the gate never saw (negative arm)", () => {
    const nodes = [
      { kind: "task", id: "job-summary", dependsOn: [] },
      { kind: "gate", id: "identity-approval", resolvedBy: "operator", dependsOn: ["job-summary"] },
      { kind: "task", id: "approval", dependsOn: ["job-summary", "identity-approval"] },
      // A read hanging off the graph root that the gate does NOT depend on:
      // the operator's decision was made without ever seeing it.
      { kind: "task", id: "side-read", dependsOn: [] },
    ] as unknown as readonly RuntimeFlowNode[];
    // The post-gate node may read the evidence it is checking: `job-summary` is
    // inside the gate's own ancestry, so that path is part of the decision.
    assert.deepEqual(ungatedTerminalPaths(nodes, ["approval"]), []);
    const violations = ungatedTerminalPaths(nodes, ["approval", "side-read"]);
    assert.equal(violations.length, 1);
    assert.deepEqual(violations[0].path, ["<terminal>", "side-read"]);
  });

  it("binds the registered gate to ref write-safety §14.4's typed result, not to a free-form payload", () => {
    // §14.6 risk 5: a gate result that is not schema-bound becomes free-form
    // control state. The kernel compares an incoming payload against THIS hash,
    // so asserting the registered gate carries the identity-approval schema is
    // what makes "only an IdentityApprovalResult resolves this gate" true.
    const expected = deriveSchemaHash(IdentityApprovalResultSchema, "output");
    const gates = DESCRIPTORS
      .filter((descriptor) => SEPARATION_CLASS_PATTERN.test(String(descriptor.id)))
      .flatMap((descriptor) => descriptorRuntimeNodes(descriptor)
        .filter((node) => node.kind === "gate" && node.resolvedBy === "operator")
        .map((node) => ({ workflow: String(descriptor.id), node })));
    assert.ok(gates.length > 0, "no separation-class operator gate is registered");
    for (const { workflow, node } of gates) {
      assert.equal(
        node.kind === "gate" ? deriveSchemaHash(node.result, "output") : "not-a-gate",
        expected,
        `${workflow}: gate "${String(node.id)}" is not bound to IdentityApprovalResultSchema`,
      );
    }
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
