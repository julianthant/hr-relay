import { z } from "zod";
import assert from "node:assert/strict";
import { it } from "vitest";
import { OnbaseInputSchema } from "../../../src/models/systems/onbase/import-document.js";
import { EMERGENCY_CONTACT_MEMBER_EXAMPLE } from "../../../src/models/workflows/emergency-contact-member/input.js";
import { approvedEmergencyContact } from "../../../src/rules/ucpath/emergency-contact.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { emergencyContactMemberWorkflow } from "../../../src/workflows/emergency-contact-member/workflow.js";

const descriptor = compileWorkflow(emergencyContactMemberWorkflow).descriptor;
const nodes = descriptorRuntimeNodes(descriptor);

it("files to OnBase as the member's third step, declared after the Save without depending on it", () => {
  assert.deepEqual(descriptor.timeline.map(step => step.key), ["contact-plan", "contact-preview", "onbase-filing"]);
  const save = nodes.findIndex(node => node.id === "contact-preview"), filing = nodes.findIndex(node => node.id === "onbase-filing");
  assert.ok(save >= 0 && filing > save);
  const node = nodes[filing];
  assert.ok(node?.kind === "child-run");
  assert.equal(node.target.id, "onbase");
  assert.equal(node.cardinality, "many");
  // "all" applies fail-parent to a failed filing; "all-settled" would ignore it. An empty group still satisfies "all".
  assert.equal(node.join, "all");
  assert.equal(node.policy.onChildFailed, "fail-parent");
  assert.equal(node.await, "terminal");
  // A 0 ms derived read would expire between the Save and admission, so the child binds from input alone.
  assert.deepEqual(node.dependsOn, []);
});

it("starts the child with exactly the mapped Employee ID, the run's document and the record's first source page", () => {
  const node = nodes.find(candidate => candidate.id === "onbase-filing");
  assert.ok(node?.kind === "child-run");
  const bound = node.bind({ input: EMERGENCY_CONTACT_MEMBER_EXAMPLE, outputs: {} });
  assert.deepEqual(z.array(OnbaseInputSchema).parse(bound), [{ ucpathId: approvedEmergencyContact(EMERGENCY_CONTACT_MEMBER_EXAMPLE.record).emplId,
    document: EMERGENCY_CONTACT_MEMBER_EXAMPLE.document,
    sourcePage: EMERGENCY_CONTACT_MEMBER_EXAMPLE.sourcePage }]);
});

it("binds no filing child when another record of the person already files the page", () => {
  const node = nodes.find(candidate => candidate.id === "onbase-filing");
  assert.ok(node?.kind === "child-run");
  assert.deepEqual(node.bind({ input: { ...EMERGENCY_CONTACT_MEMBER_EXAMPLE, sourcePage: null }, outputs: {} }), []);
});
