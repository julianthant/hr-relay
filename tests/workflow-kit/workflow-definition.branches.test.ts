import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { I9StageProfile } from "../../src/models/systems/i9/stage-profile.js";
import { I9CreateProfile } from "../../src/models/systems/i9/create-profile.js";
import { I9_PROFILE_EXAMPLE } from "../../src/models/ui/i9-creation.js";
import { SearchPersonOrg } from "../../src/models/systems/ucpath/search-person-org.js";
import { ItemIdSchema, WorkflowIdSchema } from "../../src/rules/identity/ids.js";
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

  it("refuses a step omission that skips a branch, even one that may skip gates and transactions", () => {
    assert.throws(() => compileFixtureWorkflow(fixtureWorkflow("fixture-skipped-branch", author => {
      const route = author.branch({ id: "route", label: "Choose hire path", cases: { create: ["save-profile"], reuse: ["read-person"] } }, [],
        ({ input }) => input.mode === "match" ? "create" : "reuse");
      const save = author.transaction({ id: "save-profile", prepare: I9StageProfile, commit: I9CreateProfile,
        dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 120_000 }, [route], {
        prepareBind: () => I9_PROFILE_EXAMPLE, commitBind: () => I9_PROFILE_EXAMPLE,
      });
      const read = author.task({ id: "read-person", contract: SearchPersonOrg, replay: "checkpoint" }, [route], lookupInput);
      const manual = { form: { fields: [] }, produces: {}, skips: ["route", "save-profile", "read-person"], skipsGatesAndTransactions: true as const };
      return { steps: [[author.group({ key: "hire", label: "Hire" }, { manual }), [route, save, read]]],
        result: author.result(z.strictObject({ done: z.literal(true) }), [], () => ({ done: true as const })) };
    })), /skips branch node "route"; only a task, gate or transaction is ever skipped/u);
  });

  it("refuses a step omission that skips a parallel or child-run node, each valid without the omission", () => {
    const done = z.strictObject({ done: z.literal(true) });
    const opted = (skips: readonly string[]) => ({ manual: { form: { fields: [] }, produces: {}, skips, skipsGatesAndTransactions: true as const } });
    const parallel = (id: string, omit: boolean) => fixtureWorkflow(id, author => {
      const leaf = (leafId: string) => author.task({ id: leafId, contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      const fan = author.parallel({ id: "fan", join: "all", failure: "fail-fast" }, [{ id: "a", leaves: [leaf("a")] }, { id: "b", leaves: [leaf("b")] }]);
      const step = { key: "fan", label: "Fan" };
      return { steps: [[omit ? author.group(step, opted(["fan"])) : step, [fan]]], result: author.result(done, [], () => ({ done: true as const })) };
    });
    const childRun = (id: string, omit: boolean) => fixtureWorkflow(id, author => {
      const child = author.delegate({ id: "child", target: { id: WorkflowIdSchema.parse("person-lookup"), input: PersonLookupInput, result: z.strictObject({ value: z.string() }) },
        edgeId: "child", cardinality: "one", await: "terminal", join: "one",
        policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      }, [], { bind: ({ input }) => input, deriveChildItemId: () => ItemIdSchema.parse("00000000-0000-4000-8000-000000000fe3") });
      const step = { key: "child", label: "Child" };
      return { steps: [[omit ? author.group(step, opted(["child"])) : step, [child]]], result: author.result(done, [], () => ({ done: true as const })) };
    });
    assert.equal(descriptorRuntimeNodes(compileFixtureWorkflow(parallel("fixture-kept-parallel", false)).descriptor).find(node => node.id === "fan")?.kind, "parallel");
    assert.throws(() => compileFixtureWorkflow(parallel("fixture-skipped-parallel", true)),
      /skips parallel node "fan"; only a task, gate or transaction is ever skipped/u);
    assert.equal(descriptorRuntimeNodes(compileFixtureWorkflow(childRun("fixture-kept-child", false)).descriptor).find(node => node.id === "child")?.kind, "child-run");
    assert.throws(() => compileFixtureWorkflow(childRun("fixture-skipped-child", true)),
      /skips child-run node "child"; only a task, gate or transaction is ever skipped/u);
  });

  it("retains the graph's refusal of empty, missing and multiply-owned targets", () => {
    assert.throws(() => compileFixtureWorkflow(definition("fixture-empty-branch", { create: [], reuse: ["read-person"] })), /joins no node/u);
    assert.throws(() => compileFixtureWorkflow(definition("fixture-missing-branch", { create: ["missing"], reuse: ["read-person"] })), /missing/u);
    assert.throws(() => compileFixtureWorkflow(definition("fixture-duplicate-branch", { create: ["read-person"], reuse: ["read-person"] })), /case/u);
  });
});
