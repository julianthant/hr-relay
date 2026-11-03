import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { I9StageProfile } from "../../src/models/systems/i9/stage-profile.js";
import { I9CreateProfile } from "../../src/models/systems/i9/create-profile.js";
import { I9_PROFILE_EXAMPLE } from "../../src/models/ui/i9-creation.js";
import { SearchPersonOrg } from "../../src/models/systems/ucpath/search-person-org.js";
import { descriptorRuntimeNodes } from "../../src/workflow-kit/workflow.js";
import { workflowEntryKinds, workflowExplorerDeclaration } from "../../src/workflow-kit/workflow-definition.js";
import { createSearchWorkflowDefinitionFixtures } from "../support/helpers/search-workflow-definition-fixtures.js";
import { compileFixtureWorkflow } from "../support/fixtures/workflow-definition-fixtures.js";
import { PersonLookupInput, PersonLookupCanonicalInput } from "../../src/workflows/person-lookup/workflow.js";

const { fixtureWorkflow, lookupInput } = createSearchWorkflowDefinitionFixtures();
function definition(id: string, cases = { create: ["save-profile"], reuse: ["read-person"] }) {
  return fixtureWorkflow(id, author => {
    const route = author.branch({ id: "route", label: "Choose hire path", cases }, [],
      ({ input }) => input.mode === "match" ? "create" : "reuse");
    const save = author.transaction({ id: "save-profile", prepare: I9StageProfile, commit: I9CreateProfile,
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 120_000 }, [route], {
      prepareBind: () => I9_PROFILE_EXAMPLE, commitBind: () => I9_PROFILE_EXAMPLE,
    });
    const read = author.task({ id: "read-person", contract: SearchPersonOrg, replay: "checkpoint" }, [route], lookupInput);
    return { steps: [[{ key: "hire", label: "Hire" }, [route, save, read]]],
      result: author.result(z.strictObject({ done: z.literal(true) }), [], () => ({ done: true as const })) };
  });
}

describe("authored branches", () => {
  it("compiles the exact branch policies, transaction targets and typed selected output", () => {
    const workflow = definition("fixture-authored-branch");
    const compiled = compileFixtureWorkflow(workflow);
    const nodes = descriptorRuntimeNodes(compiled.descriptor);
    const route = nodes.find(node => node.id === "route"); assert.ok(route?.kind === "branch");
    assert.ok("label" in route); assert.equal(route.label, "Choose hire path");
    assert.deepEqual(route.cases, { create: ["save-profile"], reuse: ["read-person"] });
    assert.deepEqual(route.dependsOn, []);
    const input = PersonLookupCanonicalInput.parse(PersonLookupInput.parse({ emplId: "10800000" }));
    assert.equal(route.choose({ input, outputs: {} }), "reuse");
    assert.equal(route.choose({ input: PersonLookupCanonicalInput.parse(PersonLookupInput.parse({ mode: "match", firstName: "Fixture", lastName: "Hire", dob: "2000-01-14" })), outputs: {} }), "create");
    assert.deepEqual(nodes.find(node => node.id === "save-profile")?.dependsOn, ["route"]);
    assert.deepEqual(workflowEntryKinds(workflow), ["branch", "transaction", "task"]);
    assert.equal(workflowExplorerDeclaration(workflow)[0]?.entries[0]?.kind, "branch");
  });

  it("retains the graph's refusal of empty, missing and multiply-owned targets", () => {
    assert.throws(() => compileFixtureWorkflow(definition("fixture-empty-branch", { create: [], reuse: ["read-person"] })), /joins no node/u);
    assert.throws(() => compileFixtureWorkflow(definition("fixture-missing-branch", { create: ["missing"], reuse: ["read-person"] })), /missing/u);
    assert.throws(() => compileFixtureWorkflow(definition("fixture-duplicate-branch", { create: ["read-person"], reuse: ["read-person"] })), /case/u);
  });
});
