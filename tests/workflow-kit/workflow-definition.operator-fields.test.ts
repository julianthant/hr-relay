import assert from "node:assert/strict";
import { it } from "vitest";
import { compileWorkflow } from "../../src/workflow-kit/workflow-definition.js";
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
