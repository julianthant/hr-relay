
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { SeparationsVerifyIdentityApproval } from "../../../src/models/workflows/separations/verify-identity-approval.js";
import { IdentityApprovalResultSchema } from "../../../src/rules/separations/identity-approval.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import type { RuntimeFlowNode } from "../../../src/models/workflow/graph.js";
import {
  writeFixtureDescriptor,
  writeFixtureSaveDescriptor,
} from "../../support/fixtures/write-sequencer-fixtures.js";

const SEPARATION_CLASS_PATTERN = /separation|termination|offboard/iu;
const IDENTITY_AUTHORITY_TASK_ID = String(SeparationsVerifyIdentityApproval.id);
const IDENTITY_GATE_ID = "identity-approval";
const IDENTITY_GATE_CONDITION = {
  kind: "is-true",
  of: { from: "node", nodeId: "comparison", path: "approvalRequired" },
} as const;

interface UnauthorisedPath {
  readonly transactionId: string;
  readonly path: readonly string[];
}

function isIdentityAuthorityNode(node: RuntimeFlowNode): boolean {
  return node.kind === "task" && String(node.uses.id) === IDENTITY_AUTHORITY_TASK_ID;
}

/** The identity authority task and every fact it consumed. */
function identityAuthorityAncestry(nodes: readonly RuntimeFlowNode[]): ReadonlySet<string> {
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = byId.get(id);
    if (node === undefined) throw new Error(`identity authority ancestry reached unknown node "${id}"`);
    for (const dependency of node.dependsOn) visit(String(dependency));
  };
  for (const node of nodes) {
    if (isIdentityAuthorityNode(node)) visit(String(node.id));
  }
  return seen;
}

function walkToRoots(
  nodes: readonly RuntimeFlowNode[],
  sinkId: string,
  starts: readonly string[],
): readonly UnauthorisedPath[] {
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const authorised = identityAuthorityAncestry(nodes);
  const violations: UnauthorisedPath[] = [];
  const walk = (node: RuntimeFlowNode, path: readonly string[]): void => {
    if (authorised.has(String(node.id))) return;
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

export function unauthorisedTransactionPaths(
  nodes: readonly RuntimeFlowNode[],
): readonly UnauthorisedPath[] {
  return nodes.flatMap((node) => (
    node.kind === "transaction" ? walkToRoots(nodes, String(node.id), [String(node.id)]) : []
  ));
}

export function unauthorisedTerminalPaths(
  nodes: readonly RuntimeFlowNode[],
  terminalDependsOn: readonly string[],
): readonly UnauthorisedPath[] {
  return walkToRoots(nodes, "<terminal>", terminalDependsOn.map(String));
}

function terminalDependsOnOf(descriptor: AnyWorkflowDescriptor): readonly string[] {
  const result = Reflect.get(descriptor, "result") as { readonly dependsOn: readonly string[] };
  return result.dependsOn.map(String);
}

function auditDescriptor(descriptor: AnyWorkflowDescriptor): readonly UnauthorisedPath[] {
  return unauthorisedTransactionPaths(descriptorRuntimeNodes(descriptor));
}

function authorityFixtureNodes(withSideRead = false): readonly RuntimeFlowNode[] {
  return [
    { kind: "task", id: "comparison", dependsOn: [], uses: { id: "fixture:comparison" } },
    {
      kind: "gate",
      id: IDENTITY_GATE_ID,
      resolvedBy: "operator",
      dependsOn: ["comparison"],
      result: IdentityApprovalResultSchema,
      when: IDENTITY_GATE_CONDITION,
    },
    {
      kind: "task",
      id: "approval",
      dependsOn: ["comparison", IDENTITY_GATE_ID],
      uses: SeparationsVerifyIdentityApproval,
    },
    ...(withSideRead ? [{ kind: "task", id: "side-read", dependsOn: [], uses: { id: "fixture:side-read" } }] : []),
    {
      kind: "transaction",
      id: "terminate",
      dependsOn: withSideRead ? ["approval", "side-read"] : ["approval"],
    },
  ] as unknown as readonly RuntimeFlowNode[];
}

describe("identity authority before commit", () => {
  it("routes every separation-class commit through typed identity authority", () => {
    for (const descriptor of DESCRIPTORS) {
      if (!SEPARATION_CLASS_PATTERN.test(String(descriptor.id))) continue;
      assert.deepEqual(
        auditDescriptor(descriptor),
        [],
        `${descriptor.id}: a separation commit is reachable without verified identity authority`,
      );
    }
  });

  it("accepts a transaction dominated by the identity authority task", () => {
    assert.deepEqual(unauthorisedTransactionPaths(authorityFixtureNodes()), []);
  });

  it("flags transactions without the identity authority task", () => {
    for (const descriptor of [writeFixtureDescriptor, writeFixtureSaveDescriptor]) {
      assert.ok(!SEPARATION_CLASS_PATTERN.test(String(descriptor.id)), String(descriptor.id));
      const violations = auditDescriptor(descriptor);
      assert.equal(violations.length, 1, String(descriptor.id));
      assert.equal(violations[0]?.transactionId, "submit-write");
    }
  });

  it("catches a side read that bypasses identity authority", () => {
    const violations = unauthorisedTransactionPaths(authorityFixtureNodes(true));
    assert.equal(violations.length, 1);
    assert.deepEqual(violations[0]?.path, ["terminate", "side-read"]);
  });

  it("routes every identity-bearing separation terminal through typed authority", () => {
    let audited = 0;
    for (const descriptor of DESCRIPTORS) {
      if (!SEPARATION_CLASS_PATTERN.test(String(descriptor.id))) continue;
      const nodes = descriptorRuntimeNodes(descriptor);
      if (!nodes.some(isIdentityAuthorityNode)) continue;
      audited += 1;
      assert.deepEqual(
        unauthorisedTerminalPaths(nodes, terminalDependsOnOf(descriptor)),
        [],
        `${descriptor.id}: the terminal result is derivable without verified identity authority`,
      );
    }
    assert.ok(audited > 0, "no registered separation-class descriptor declares identity authority");
  });

  it("flags a terminal result that reads a fact the authority task never consumed", () => {
    const nodes = authorityFixtureNodes(true).filter((node) => node.kind !== "transaction");
    assert.deepEqual(unauthorisedTerminalPaths(nodes, ["approval"]), []);
    const violations = unauthorisedTerminalPaths(nodes, ["approval", "side-read"]);
    assert.equal(violations.length, 1);
    assert.deepEqual(violations[0]?.path, ["<terminal>", "side-read"]);
  });

  it("keeps name-resolved and operator-entered branches behind the exact typed operator gate", () => {
    const expectedSchemaHash = deriveSchemaHash(IdentityApprovalResultSchema, "output");
    let gates = 0;
    for (const descriptor of DESCRIPTORS) {
      if (!SEPARATION_CLASS_PATTERN.test(String(descriptor.id))) continue;
      const nodes = descriptorRuntimeNodes(descriptor);
      for (const node of nodes) {
        if (node.kind !== "gate" || String(node.id) !== IDENTITY_GATE_ID) continue;
        gates += 1;
        assert.equal(node.resolvedBy, "operator", String(descriptor.id));
        assert.deepEqual(node.when, IDENTITY_GATE_CONDITION, String(descriptor.id));
        assert.equal(deriveSchemaHash(node.result, "output"), expectedSchemaHash, String(descriptor.id));
        const authority = nodes.find(isIdentityAuthorityNode);
        assert.ok(authority, `${descriptor.id}: identity gate has no authority task`);
        assert.ok(
          authority.dependsOn.map(String).includes(IDENTITY_GATE_ID),
          `${descriptor.id}: authority task does not depend on the identity approval gate`,
        );
      }
    }
    assert.ok(gates > 0, "no separation-class identity gate is registered");
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
