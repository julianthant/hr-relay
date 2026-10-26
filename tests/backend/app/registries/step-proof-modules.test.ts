import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { STEP_PROOF_MODULES, stepProofModuleOf } from "../../../../src/backend/app/registries/step-proof-modules.js";
import { WORKFLOW_MODULES, personLookupModule, workflowModuleOf } from "../../../../src/backend/app/registries/workflow-registry.js";
import { canonicalInputSamples } from "../../../../src/models/workflow/canonical-input.js";
import { classifyEvidenceLeaf, evidenceLeaves } from "../../../../src/models/trust/evidence-classification.js";
import { auditWorkflowModuleRoles } from "../../../../src/workflow-kit/validation/workflow-module-audit.js";
import { JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import { descriptorRuntimeNodes, workflowProjections } from "../../../../src/workflow-kit/workflow.js";
import { personLookupWorkflow } from "../../../../src/workflows/person-lookup/workflow.js";

function observeBind(bind: () => unknown) {
  try {
    return { state: "value", value: bind() };
  } catch (error) {
    assert.ok(error instanceof Error);
    return { state: "refused", message: error.message };
  }
}

describe("Person Lookup step proofs", () => {
  const proofs = STEP_PROOF_MODULES.filter(module => module.role.kind === "chunk-harness" && module.role.of === "person-lookup");

  it("registers all four proofs under the composition without adding operator workflows", () => {
    assert.deepEqual(personLookupModule.role, { kind: "composition" });
    assert.deepEqual(proofs.map(module => String(module.descriptor.id)), [
      "person-lookup-searching", "person-lookup-cross-verify", "person-lookup-active-status", "person-lookup-crm-dates",
    ]);
    assert.deepEqual(auditWorkflowModuleRoles([...WORKFLOW_MODULES, ...STEP_PROOF_MODULES]), []);
    for (const proof of proofs) {
      assert.equal(stepProofModuleOf(proof.descriptor.id), proof);
      assert.throws(() => workflowModuleOf(proof.descriptor.id), /not registered/u);
    }
  });

  it("retains exact step objects, task contracts, order, conditions and binds with prerequisite groups", () => {
    const originalNodes = descriptorRuntimeNodes(personLookupModule.descriptor);
    const outputs = Object.fromEntries(originalNodes.map(node => {
      assert.ok(node.kind === "task");
      return [node.id, JsonValueSchema.parse(node.uses.example)];
    }));
    for (const [index, proof] of proofs.entries()) {
      assert.equal(proof.definition.input, personLookupWorkflow.input);
      assert.equal(proof.definition.canonicalInput, personLookupWorkflow.canonicalInput);
      assert.deepEqual(workflowProjections(proof.descriptor).dryRun, workflowProjections(personLookupModule.descriptor).dryRun);
      const expectedGroups = personLookupWorkflow.steps.slice(0, index + 1);
      assert.deepEqual(proof.definition.steps.map(([group]) => group.key), expectedGroups.map(([group]) => group.key));
      for (const [groupIndex, [group, entries]] of proof.definition.steps.entries()) {
        const [originalGroup, originals] = expectedGroups[groupIndex];
        assert.deepEqual(group, originalGroup);
        assert.deepEqual(entries.map(entry => entry.id), originals.map(entry => entry.id));
        for (const [entryIndex, entry] of entries.entries()) {
          const original = originals[entryIndex];
          assert.equal(entry.step, original.step);
          assert.deepEqual(entry.contracts, original.contracts);
          assert.deepEqual(entry.references.map(ref => ref.id), original.references.map(ref => ref.id));
          const node = descriptorRuntimeNodes(proof.descriptor).find(candidate => candidate.id === entry.id);
          const originalNode = originalNodes.find(candidate => candidate.id === entry.id);
          assert.ok(node?.kind === "task" && originalNode?.kind === "task");
          assert.equal(node.uses, originalNode.uses);
          assert.equal(node.label, originalNode.label);
          assert.equal(node.replay, originalNode.replay);
          assert.deepEqual(node.when, originalNode.when);
          for (const input of canonicalInputSamples(personLookupWorkflow.canonicalInput)) {
            const scope = { input: JsonValueSchema.parse(input), outputs };
            assert.deepEqual(observeBind(() => node.bind(scope)), observeBind(() => originalNode.bind(scope)));
          }
        }
      }
    }
  });

  it("classifies each proof's complete schema-valid result", () => {
    const outputs = Object.fromEntries(descriptorRuntimeNodes(personLookupModule.descriptor).map(node => {
      assert.ok(node.kind === "task");
      return [node.id, node.uses.example];
    }));
    for (const proof of proofs) {
      const input = personLookupWorkflow.input.parse({ emplId: "10000001" });
      const result = proof.definition.result.schema.parse(proof.definition.result.derive({ input, outputs }));
      for (const leaf of evidenceLeaves(result)) {
        classifyEvidenceLeaf({ kind: "workflow-result", workflowId: proof.descriptor.id }, leaf.path);
      }
    }
  });

  it("omits skipped CRM reads from the cross-verify result", () => {
    const proof = stepProofModuleOf("person-lookup-cross-verify");
    assert.ok(proof !== undefined);
    const identityContract = personLookupWorkflow.steps[0][1][2].contracts[0];
    const identity = identityContract.example;
    const input = personLookupWorkflow.input.parse({ emplId: "10000001", crmCheck: false });
    const result = proof.definition.result.derive({ input, outputs: { "search-identity": identity } });
    assert.deepEqual(proof.definition.result.schema.parse(result), { identity });
    assert.deepEqual(result, JSON.parse(JSON.stringify(result)));
  });
});
