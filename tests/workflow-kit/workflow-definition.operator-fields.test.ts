import assert from "node:assert/strict";
import { it } from "vitest";
import { compileWorkflow } from "../../src/workflow-kit/workflow-definition.js";
import { WorkflowOperatorFieldSchema } from "../../src/models/workflow/presentation.js";
import { personLookupWorkflow } from "../../src/workflows/person-lookup/workflow.js";

it("validates exact operator paths through collection members and confines sources to their step", () => {
  const compiled = compileWorkflow(personLookupWorkflow);
  assert.equal(compiled.descriptor.timeline[0].system, "ucpath");
  assert.equal(compiled.descriptor.timeline[0].operatorFields?.[0].label, "Employee ID");
  const steps = personLookupWorkflow.steps;
  for (const source of [
    { nodeId: "searching", kind: "output" as const, fieldPath: "results.missing" },
    { nodeId: "searching", kind: "input" as const, fieldPath: "missing" },
    { nodeId: "active-status", kind: "output" as const, fieldPath: "state" },
  ]) {
    assert.throws(() => compileWorkflow({ ...personLookupWorkflow,
      steps: steps.map(([group, entries], index) =>
        [index === 0 ? { ...group, operatorFields: [{ label: "Invalid field", sources: [source] }] } : group, entries] as const),
    }), /operator field/u);
  }
});

it("keeps fictional display examples typed and rejects unknown example/source properties", () => {
  const source = { nodeId: "searching", kind: "output", fieldPath: "results.name" };
  for (const example of [42, false, null, {}, [], ""]) assert.equal(WorkflowOperatorFieldSchema.safeParse({ label: "Name", sources: [source], example }).success, false);
  assert.equal(WorkflowOperatorFieldSchema.safeParse({ label: "Name", sources: [{ ...source, extra: true }], example: "Quillan, Petra A." }).success, false);
  const descriptor = compileWorkflow(personLookupWorkflow).descriptor;
  assert.deepEqual(descriptor.timeline.map(group => group.operatorFields?.map(field => field.example)), personLookupWorkflow.steps.map(([group]) => group.operatorFields?.map(field => field.example)));
});


it("validates logs-only field visibility without creating a second source declaration", () => {
  const field = { label: "Drop reason", visibility: "logs", sources: [{ nodeId: "matching", kind: "output", fieldPath: "dropped.reason" }] };
  assert.equal(WorkflowOperatorFieldSchema.safeParse(field).success, true);
  assert.equal(WorkflowOperatorFieldSchema.safeParse({ ...field, visibility: "unknown" }).success, false);
  const group = compileWorkflow(personLookupWorkflow).descriptor.timeline[0];
  assert.deepEqual(group.operatorFields?.find(field => field.label === "Drop reason"), field);
});
