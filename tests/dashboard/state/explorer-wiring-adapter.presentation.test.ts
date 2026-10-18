import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildWorkflowExplorer } from "../../../src/backend/runs/queries/explorer.js";
import { projectExplorerDefinition } from "../../../src/dashboard/state/explorer-wiring-adapter.js";
import { allFields, type FlowPart } from "../../../src/dashboard/surfaces/explorer/explorer-flow-model.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { explorerQueryDeps } from "../../support/fixtures/explorer-seams.js";

function workflowWire() {
  const wire = buildWorkflowExplorer(explorerQueryDeps(manualClock(new Date("2026-08-03T17:00:00.000Z")), FingerprintSchema.parse("d".repeat(64))));
  const workflow = wire.workflows.find(workflow => workflow.id === "person-lookup"); assert.ok(workflow);
  return workflow;
}
function projected() {
  const result = projectExplorerDefinition(workflowWire());
  assert.equal(result.state, "ready");
  assert.ok(result.state === "ready");
  return result.projection;
}
function textOf(parts: readonly FlowPart[]): string[] {
  return parts.flatMap(part => part.kind === "form" || part.kind === "detail" ? [part.title, ...textOf(part.parts)] : part.kind === "note" || part.kind === "action" ? [part.text] : []);
}
describe("served Person Lookup Explorer operator presentation", () => {
  it("generates the four walkthrough steps in declaration order without exposing internal task steps", () => {
    assert.deepEqual(projected().steps.map(step => [step.title, step.system]), [
      ["Search for person", "UCPath"], ["Cross-check identity", "CRM"],
      ["Read employment status", "Local"], ["Read CRM dates", "CRM"],
    ]);
  });
  it("keeps node, dependency, condition and task diagnostics out of operator text", () => {
    const projection = projected();
    const text = projection.steps.flatMap(step => [step.title, ...textOf(step.parts)]).join("\n");
    assert.doesNotMatch(text, /\bNode\b|Dependencies:|Condition:|\bTask\b|ucpath\/search-person-org|workflow:person-lookup|active-status|search-identity/u);
    assert.match(text, /Search for person/u);
    assert.match(text, /UCPath/u);
  });
  it("uses only declared fictional examples and safe visible provenance without a run", () => {
    const wire = workflowWire();
    const projection = projected();
    for (const [index, group] of wire.timeline.entries()) {
      assert.ok(group.operatorFields);
      const fields = allFields(projection.steps[index].parts);
      assert.deepEqual(fields.map(field => [field.label, field.value]), group.operatorFields.map(field => [field.label, field.example]));
      for (const field of fields) {
        assert.ok(field.source);
        const source = projection.sources.get(field.source); assert.ok(source);
        assert.doesNotMatch(JSON.stringify(source), /nodeId|taskId|searching|search-identity|active-status|ucpath\/|input ·|output ·|selection\./u);
        assert.match(source.detail ?? "", /Fictional example/u);
      }
    }
    assert.ok(projection.steps.every(step => textOf(step.parts).some(text => text.includes("No run values are shown"))));
  });
  it("keeps missing examples explicit without inventing a run value", () => {
    const wire = workflowWire();
    assert.ok(wire.definitionPreview.state === "compiled");
    assert.ok(wire.definitionPreview.groups[0].operatorFields && wire.timeline[0].operatorFields);
    delete wire.definitionPreview.groups[0].operatorFields[0].example;
    delete wire.timeline[0].operatorFields[0].example;
    const result = projectExplorerDefinition(wire); assert.ok(result.state === "ready");
    assert.equal(allFields(result.projection.steps[0].parts).some(field => field.label === "Employee ID"), false);
    assert.match(textOf(result.projection.steps[0].parts).join(" "), /Some example values are not declared/u);
  });
  it.each([
    ["Search for person", ["Employee ID", "Name", "Department", "Job title", "HR status"]],
    ["Cross-check identity", ["Name", "Department", "Employee ID", "Start date"]],
    ["Read employment status", ["Employment status", "HDH department", "Department", "End date", "Termination reason"]],
    ["Read CRM dates", ["Employment date", "Oath date"]],
  ] as const)("lists only the walkthrough fields with fictional examples for %s", (title, labels) => {
    const step = projected().steps.find(step => step.title === title); assert.ok(step);
    const fields = allFields(step.parts);
    assert.deepEqual(fields.map(field => field.label), labels);
    assert.ok(fields.every(field => field.value.length > 0 && !field.value.includes("Unavailable")));
    for (const field of fields) {
      if (field.label === "Employee ID") assert.equal(field.value, "10000001");
      if (field.label === "Name") assert.equal(field.value, "Quillan, Petra A.");
      if (field.label === "Department") assert.match(field.value, /^[A-Z ]+$/u);
      if (/date/iu.test(field.label)) assert.match(field.value, /^\d{1,2}\/\d{1,2}\/\d{4}$/u);
    }
    assert.doesNotMatch(fields.map(field => field.label).join(" "), /input ·|output ·|candidateEids|selection\.|ssn|dob/iu);
  });
});
