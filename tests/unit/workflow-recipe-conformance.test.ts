import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { workflowRecipeFor } from "../../src/base/workflow-recipe.js";
import { workflowProjections } from "../../src/base/workflow.js";
import {
  WORKFLOW_MODULES,
  WORKFLOW_RECIPES,
  workflowRecipeRegistry,
} from "../../src/control/workflow-registry.js";
import { manualClock } from "../../src/domain/clock.js";
import { FingerprintSchema } from "../../src/domain/ids.js";
import { buildBootstrap } from "../../src/server/dashboard/queries/bootstrap.js";
import { buildWorkflowExplorer } from "../../src/server/dashboard/queries/explorer.js";
import { buildRunDetail } from "../../src/server/dashboard/queries/run-detail.js";
import { descriptorSetHash } from "../../src/server/dashboard/compose.js";
import { projectStartSteps } from "../../src/services/start/step-selection.js";
import { healthyDashboardPreflightReport } from "../fixtures/preflight-seams.js";
import { explorerQueryDeps } from "../fixtures/explorer-seams.js";
import {
  AT,
  makeWorld,
  queuedEventOf,
  taskEventsOf,
  uuidOf,
} from "./server/helpers/dashboard-harness.js";
import { separationsDescriptor } from "../../src/workflows/separations/descriptor.js";
import { personLookupRecipe } from "../../src/workflows/person-lookup/descriptor.js";

const EXPLORER_HASH = FingerprintSchema.parse("c".repeat(64));

function recipeTaskIds(recipe: typeof WORKFLOW_RECIPES[number]["recipe"]): readonly string[] {
  return recipe.steps.flatMap(([, tasks]) => tasks.map((task) => task.id));
}

describe("workflow recipe registry conformance", () => {
  it("derives the converted population from the one module tuple and refuses a mismatched compiler identity", () => {
    expect(WORKFLOW_RECIPES.map(({ descriptor }) => String(descriptor.id)))
      .toEqual(["person-lookup", "separations"]);
    expect(WORKFLOW_RECIPES.map(({ descriptor, recipe }) => workflowRecipeFor(descriptor) === recipe))
      .toEqual([true, true]);

    expect(() => workflowRecipeRegistry([{
      descriptor: separationsDescriptor,
      stores: [],
      recipe: personLookupRecipe,
    }])).toThrow("workflow separations registers a recipe that did not compile its own descriptor");
  });

  it("keeps every registered recipe's tuple groups and tasks equal to its compiled descriptor and generic projections", () => {
    for (const { descriptor, recipe } of WORKFLOW_RECIPES) {
      const expectedGroups = recipe.steps.map(([group, tasks]) => ({
        key: group.key,
        label: group.label,
        nodes: tasks.map(({ id }) => id),
      }));
      const expectedTaskIds = recipeTaskIds(recipe);

      expect(descriptor.timeline.map((group) => ({
        key: group.key,
        label: group.label,
        nodes: group.nodes.map(({ id }) => String(id)),
      })), String(descriptor.id)).toEqual(expectedGroups);
      // Tuple order is presentation authority; the compiled graph is
      // dependency-topological. Both must contain the exact same tasks.
      expect(descriptor.nodes.map(({ id }) => String(id)).toSorted(), String(descriptor.id))
        .toEqual(expectedTaskIds.toSorted());
      // Transaction nodes deliberately project a beat for each task contract;
      // membership stays one recipe task per graph node.
      expect([...new Set(workflowProjections(descriptor).steps.map(({ nodeId }) => String(nodeId)))]
        .toSorted(), String(descriptor.id)).toEqual(expectedTaskIds.toSorted());
    }
  });

  it("serves every converted recipe through the existing bootstrap/start, detail timeline, and Explorer projections", () => {
    const world = makeWorld();
    try {
      const bootstrap = buildBootstrap({
        appVersion: "0.1.0",
        clock: manualClock(AT),
        modules: WORKFLOW_MODULES,
        descriptorSetHash: descriptorSetHash(WORKFLOW_MODULES.map(({ descriptor }) => descriptor.contractFingerprint)),
        settingsSchemaHash: descriptorSetHash(["settings-schema"]),
        projection: world.projection,
        authorityMeta: () => ({ schemaVersion: 13, authorityGeneration: 4 }),
        backupSummary: () => "current",
        preflightReport: () => healthyDashboardPreflightReport(manualClock(AT)),
        advisoryAvailability: () => ({
          state: "unavailable",
          code: "not-configured",
          reason: "no ai.advisory provider is composed in this test",
        }),
      });
      const starts = new Map(bootstrap.workflows.map((workflow) => [String(workflow.id), workflow.start]));
      const explorer = buildWorkflowExplorer(explorerQueryDeps(manualClock(AT), EXPLORER_HASH));
      const explorerWorkflows = new Map(explorer.workflows.map((workflow) => [String(workflow.id), workflow]));

      for (const { descriptor, recipe } of WORKFLOW_RECIPES) {
        const id = String(descriptor.id);
        const expectedGroups = recipe.steps.map(([group, tasks]) => ({
          key: group.key,
          label: group.label,
          nodes: tasks.map(({ id: nodeId }) => nodeId),
        }));
        const expectedTaskIds = recipeTaskIds(recipe);

        const start = starts.get(id);
        assert.ok(start !== undefined, `${id} is absent from the bootstrap start surface`);
        expect(start.steps.map(({ key, label }) => ({ key, label })), id)
          .toEqual(expectedGroups.map(({ key, label }) => ({ key, label })));
        expect(start.steps.map(({ key }) => key), id)
          .toEqual(projectStartSteps(descriptor).map(({ key }) => key));

        const explorerWorkflow = explorerWorkflows.get(id);
        assert.ok(explorerWorkflow !== undefined, `${id} is absent from Explorer`);
        expect(explorerWorkflow.nodes.map(({ id: nodeId }) => String(nodeId)).toSorted(), id)
          .toEqual(expectedTaskIds.toSorted());
        expect(explorerWorkflow.nodes.map(({ id: nodeId, details }) => ({
          id: String(nodeId),
          details: details.map(({ key }) => key),
        })), id).toEqual(descriptor.nodes.map(({ id: nodeId }) => ({
          id: String(nodeId),
          details: descriptor.details.filter((detail) => detail.source.nodeId === String(nodeId)).map(({ key }) => key),
        })));

        const seed = id === "person-lookup" ? 501 : 502;
        queuedEventOf(world, { seed, workflow: id });
        for (const nodeId of expectedTaskIds) taskEventsOf(world, seed, nodeId, "done");
        const detail = buildRunDetail({
          stateRoot: world.stateRoot,
          projection: world.projection,
          authority: world.authority,
          descriptors: { resolve: (workflowId) => workflowId === id ? descriptor : undefined },
        }, uuidOf(seed));
        expect(detail.timeline.steps?.map((step) => ({
          label: step.label,
          members: step.members.map((member) => member.label),
        })), id).toEqual(expectedGroups.map(({ label, nodes }) => ({
          label,
          members: nodes.map((nodeId) => descriptor.nodes.find((node) => String(node.id) === nodeId)?.label),
        })));
      }
    } finally {
      world.dispose();
    }
  });

  it("leaves person lookup and separations recipe-backed, with no descriptor-local timeline or flow declaration", () => {
    const sources = [
      "../../src/workflows/person-lookup/descriptor.ts",
      "../../src/workflows/separations/descriptor.ts",
    ];
    for (const sourcePath of sources) {
      const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");
      expect(source, sourcePath).toMatch(/compileWorkflowRecipe\([^,]+Recipe,/u);
      expect(source, sourcePath).not.toMatch(/defineWorkflowDescriptor\(/u);
      expect(source, sourcePath).not.toMatch(/\bflow\(/u);
      expect(source, sourcePath).not.toMatch(/\btimeline\s*:/u);
    }
  });
});
