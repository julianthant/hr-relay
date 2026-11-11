import assert from "node:assert/strict";
import { it } from "vitest";
import { EMERGENCY_CONTACT_MEMBER_EXAMPLE } from "../../../src/models/workflows/emergency-contact-member/input.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { emergencyContactMemberWorkflow } from "../../../src/workflows/emergency-contact-member/workflow.js";

const descriptor = compileWorkflow(emergencyContactMemberWorkflow).descriptor;

it("imports to OnBase as a hidden one-child step after the contact preview without depending on it", () => {
  assert.deepEqual(descriptor.timeline.map(step => step.key), ["contact-plan", "contact-preview", "onbase-import"]);
  const nodes = descriptorRuntimeNodes(descriptor), ids = nodes.map(node => String(node.id));
  const onbase = nodes.find(node => node.id === "onbase-import");
  assert.ok(onbase?.kind === "child-run");
  assert.equal(onbase.target.id, "onbase");
  assert.equal(String(onbase.edgeId), "member-onbase");
  assert.deepEqual([onbase.cardinality, onbase.await, onbase.join], ["one", "terminal", "one"]);
  assert.deepEqual(onbase.policy, { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "hidden-unless-failed" });
  assert.deepEqual(onbase.dependsOn.map(String), ["map-contact"]);
  assert.ok(ids.indexOf("onbase-import") > ids.indexOf("contact-preview"));
});

it("binds exactly the approved employee, parent PDF and record page to the OnBase child", () => {
  const onbase = descriptorRuntimeNodes(descriptor).find(node => node.id === "onbase-import");
  assert.ok(onbase?.kind === "child-run" && onbase.cardinality === "one");
  const input = { ...EMERGENCY_CONTACT_MEMBER_EXAMPLE, sourcePage: 2 };
  assert.deepEqual(onbase.bind({ input, outputs: { "map-contact": { emplId: "10800007" } } }),
    { ucpathId: "10800007", document: input.document, sourcePage: 2 });
});
