import { describe, expect, it } from "vitest";
import { compileWorkflow, defineStepProof } from "../../src/workflow-kit/workflow-definition.js";
import { personLookupWorkflow } from "../../src/workflows/person-lookup/workflow.js";
import { personLookupSearchingDefinition } from "../../src/workflows/person-lookup/steps/searching/step.js";
import { separationsWorkflow } from "../../src/workflows/separations/workflow.js";
import { separationsIdentityCheckDefinition, SeparationsIdentityCheckCanonicalInput } from "../../src/workflows/separations/steps/identity-check/step.js";

describe("step proof derivation", () => {
  it("inherits the parent's input and presentation while retaining the step graph and result", () => {
    const { definition, order } = defineStepProof(personLookupWorkflow, personLookupSearchingDefinition);
    expect(order).toBe(5);
    expect(definition.id).toBe("person-lookup-searching");
    expect(definition.role).toEqual({ kind: "chunk-harness", of: "person-lookup", step: "searching" });
    for (const key of ["input", "canonicalInput", "identity", "presentation", "surfaces", "scenarios"] as const) {
      expect(definition[key]).toBe(personLookupWorkflow[key]);
    }
    expect(definition.steps.map(([group, entries]) => [group.key, entries.map(entry => entry.id)]))
      .toEqual([["searching", ["searching", "matching", "search-identity"]]]);
    expect(definition.result.references.map(entry => entry.id)).toEqual(["search-identity"]);
    expect(definition.nodePurposes?.map(purpose => purpose.nodeId)).toEqual(["searching", "matching", "search-identity"]);
    expect(compileWorkflow(definition).contracts).toEqual(compileWorkflow(personLookupWorkflow).contracts
      .filter(contract => definition.steps.flatMap(([, entries]) => entries.flatMap(entry => entry.contracts)).includes(contract)));
  });

  it("keeps specialized ingress and authority dependencies instead of substituting parent input", () => {
    const { definition } = defineStepProof(separationsWorkflow, separationsIdentityCheckDefinition);
    expect(definition.canonicalInput).toBe(SeparationsIdentityCheckCanonicalInput);
    expect(definition.input).not.toBe(separationsWorkflow.input);
    expect(definition.steps.map(([group, entries]) => [group.key, entries.map(entry => entry.id)]))
      .toEqual([["job-summary", ["job-summary"]], ["identity-check", ["name-search", "comparison", "identity-approval", "approval"]]]);
    expect(definition.result.references.map(entry => entry.id)).toEqual(["approval"]);
    const approval = definition.steps.flatMap(([, entries]) => entries).find(entry => entry.id === "approval");
    expect(approval?.references.map(entry => entry.id)).toEqual(["comparison", "identity-approval"]);
  });

  it("still refuses an invalid proof graph at the workflow boundary", () => {
    const invalid = {
      ...personLookupSearchingDefinition,
      proof: {
        ...personLookupSearchingDefinition.proof,
        build: (parent: typeof personLookupWorkflow) => {
          const spec = personLookupSearchingDefinition.proof.build(parent);
          return { ...spec, steps: (author: Parameters<typeof spec.steps>[0]) => ({ ...spec.steps(author), steps: [] }) };
        },
      },
    };
    expect(() => defineStepProof(personLookupWorkflow, invalid)).toThrow(/requires at least one timeline group/u);
  });
});
