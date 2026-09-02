import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolve } from "node:path";
import {
  compileWorkflowRecipeModule,
  defineWorkflowRecipe,
  workflowRecipeFor,
} from "../../src/base/workflow-recipe.js";
import type { AnyWorkflowRecipeTask } from "../../src/base/workflow-recipe.js";
import { descriptorRuntimeNodes } from "../../src/base/workflow.js";
import { declaredWorkflowId } from "../../src/infra/build/workflow-build-manifest.js";
import { SearchPersonOrg } from "../../src/domain/contracts/ucpath/search-person-org.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import {
  PersonLookupInput,
  personLookupDescriptor,
  personLookupRecipe,
} from "../../src/workflows/person-lookup/descriptor.js";

const lookupInput = ({ input }: { input: { emplId?: string; name?: string; keepNonHdh: boolean } }) =>
  input.emplId === undefined
    ? { kind: "by-name" as const, name: input.name ?? "Fixture Person", keepNonHdh: input.keepNonHdh }
    : { kind: "by-eid" as const, emplId: input.emplId };

describe("workflow recipe compiler", () => {
  it("derives execution order and edges from task references while preserving tuple presentation order", () => {
    const graph = descriptorRuntimeNodes(personLookupDescriptor);

    expect(graph.map((node) => ({ id: String(node.id), dependsOn: node.dependsOn.map(String) }))).toEqual([
      { id: "searching", dependsOn: [] },
      { id: "cross-verify", dependsOn: ["searching"] },
      { id: "active-status", dependsOn: ["searching", "cross-verify"] },
      { id: "crm-dates", dependsOn: ["searching"] },
    ]);
    expect(personLookupRecipe.steps.map(([group]) => group.key)).toEqual([
      "searching",
      "cross-verify",
      "active-status",
      "crm-dates",
    ]);
    expect(workflowRecipeFor(personLookupDescriptor)).toBe(personLookupRecipe);
  });

  it("refuses duplicate task membership and duplicate task ids by name", () => {
    expect(() => defineWorkflowRecipe(PersonLookupInput, ({ task, result }) => {
      const first = task({
        id: "first",
        contract: SearchPersonOrg,
        replay: "checkpoint",
      }, [], lookupInput);
      return {
        steps: [
          [{ key: "first", label: "First" }, [first]],
          [{ key: "second", label: "Second" }, [first]],
        ],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow recipe task "first" appears in more than one timeline tuple/u);

    expect(() => defineWorkflowRecipe(PersonLookupInput, ({ task, result }) => {
      const first = task({
        id: "same-id",
        contract: SearchPersonOrg,
        replay: "checkpoint",
      }, [], lookupInput);
      const second = task({
        id: "same-id",
        contract: SearchPersonOrg,
        replay: "checkpoint",
      }, [], lookupInput);
      return {
        steps: [[{ key: "group", label: "Group" }, [first, second]]],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow recipe declares task id "same-id" more than once/u);
  });

  it("refuses duplicate or unstable timeline groups", () => {
    expect(() => defineWorkflowRecipe(PersonLookupInput, ({ task, result }) => {
      const first = task({ id: "first", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      const second = task({ id: "second", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return {
        steps: [
          [{ key: "duplicate", label: "First" }, [first]],
          [{ key: "duplicate", label: "Second" }, [second]],
        ],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow recipe repeats timeline group key "duplicate"/u);

    expect(() => defineWorkflowRecipe(PersonLookupInput, ({ task, result }) => {
      const first = task({ id: "first", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      return {
        steps: [[{ key: "Not Stable", label: "First" }, [first]]],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/kebab-case slug/u);
  });

  it("refuses unresolved references and dependency cycles by task name", () => {
    expect(() => defineWorkflowRecipe(PersonLookupInput, ({ task, result }) => {
      const missing = task({ id: "missing", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
      const consumer = task({
        id: "consumer",
        contract: SearchPersonOrg,
        replay: "checkpoint",
      }, [missing], lookupInput);
      return {
        steps: [[{ key: "consumer", label: "Consumer" }, [consumer]]],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow recipe task "consumer" references unresolved task "missing"/u);

    expect(() => defineWorkflowRecipe(PersonLookupInput, ({ task, result }) => {
      const firstReferences: AnyWorkflowRecipeTask[] = [];
      const first = task({ id: "first", contract: SearchPersonOrg, replay: "checkpoint" }, firstReferences, lookupInput);
      const second = task({ id: "second", contract: SearchPersonOrg, replay: "checkpoint" }, [first], lookupInput);
      firstReferences.push(second);
      return {
        steps: [[{ key: "cycle", label: "Cycle" }, [first, second]]],
        result: result(z.string(), [], () => "done"),
      };
    })).toThrow(/workflow recipe dependency cycle: first -> second -> first/u);
  });

  it("derives exact module stores and refuses an incomplete inventory", () => {
    const withoutCrm = taskStoreRegistry.stores.filter(({ namespace }) => namespace !== "crm");

    expect(() => compileWorkflowRecipeModule(
      personLookupRecipe,
      personLookupDescriptor,
      withoutCrm,
      {},
    )).toThrow(/workflow person-lookup recipe requires missing store crm/u);
  });

  it("keeps recipe-authored descriptor ids visible to the build-manifest guard", () => {
    expect(declaredWorkflowId(resolve("src/workflows/person-lookup/descriptor.ts"))).toBe("person-lookup");
  });
});
