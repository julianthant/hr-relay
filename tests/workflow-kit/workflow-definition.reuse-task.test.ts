import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { taskStoreRegistry } from "../../src/backend/app/registries/task-registry.js";
import { SearchPersonOrg } from "../../src/models/systems/ucpath/search-person-org.js";
import { PersonLookupInput } from "../../src/models/workflows/person-lookup/input.js";
import { composeWorkflowModule, reuseTask } from "../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../src/workflow-kit/workflow.js";
import { compileFixtureWorkflow } from "../support/fixtures/workflow-definition-fixtures.js";
import { createSearchWorkflowDefinitionFixtures } from "../support/helpers/search-workflow-definition-fixtures.js";

const { fixtureWorkflow, lookupInput } = createSearchWorkflowDefinitionFixtures();

describe("reused workflow task calls", () => {
  it("keeps exact schemas, provenance and store binding with the workflow's identity and input binder", () => {
    const group = defineWorkflowStep({ key: "lookup", label: "Lookup" });
    const call = reuseTask(group, { id: "search", contract: SearchPersonOrg, replay: "checkpoint" },
      (input: z.output<typeof PersonLookupInput>) => lookupInput({ input }));
    expect(call.identity.step).toBe(group);
    expect(call.identity.contract).toBe(SearchPersonOrg);
    expect(call.identity.contract.input).toBe(SearchPersonOrg.input);
    expect(call.identity.contract.output).toBe(SearchPersonOrg.output);
    expect(call.identity.contract.provenance).toBe(SearchPersonOrg.provenance);
    expect(call.bind({ input: PersonLookupInput.parse({ emplId: "10000001" }) })).toEqual({ kind: "by-eid", emplId: "10000001" });
    const definition = fixtureWorkflow("reused-task-fixture", ({ task, result }) => {
      const read = task(call.identity, [], call.bind);
      return { steps: [[group, [read]]], result: result(SearchPersonOrg.output, [read], ({ outputs }) => outputs.search) };
    });
    const compiled = compileFixtureWorkflow(definition);
    expect(compiled.storeNamespaces).toEqual(["ucpath"]);
    expect(compiled.contracts).toEqual([SearchPersonOrg]);
    const module = composeWorkflowModule(compiled, taskStoreRegistry.stores);
    expect(module.stores).toEqual([taskStoreRegistry.stores.find(store => store.namespace === "ucpath")]);
  });

  it("preserves conditions and propagates binding failure before the driver can run", () => {
    const group = defineWorkflowStep({ key: "lookup", label: "Lookup" });
    const when = { kind: "is-true", of: { from: "input", path: "crmCheck" } } as const;
    const refusal = new Error("required identity missing");
    const call = reuseTask(group, { id: "search", contract: SearchPersonOrg, replay: "always-rerun", when },
      (_input: z.output<typeof PersonLookupInput>) => { throw refusal; });
    expect(call.identity.when).toBe(when);
    expect(call.identity.replay).toBe("always-rerun");
    expect(() => call.bind({ input: PersonLookupInput.parse({ emplId: "10000001" }) })).toThrow(refusal);
  });
});
