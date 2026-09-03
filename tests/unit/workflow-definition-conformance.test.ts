import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { workflowDefinitionOf } from "../../src/base/workflow-definition.js";
import { workflowProjections } from "../../src/base/workflow.js";
import {
  WORKFLOW_MODULES,
  WORKFLOW_DEFINITIONS,
  workflowDefinitionRegistry,
} from "../../src/control/workflow-registry.js";
import { manualClock } from "../../src/domain/clock.js";
import { FingerprintSchema } from "../../src/domain/ids.js";
import { buildBootstrap } from "../../src/server/dashboard/queries/bootstrap.js";
import { buildWorkflowExplorer } from "../../src/server/dashboard/queries/explorer.js";
import { buildRunDetail } from "../../src/server/dashboard/queries/run-detail.js";
import { descriptorSetHash } from "../../src/server/dashboard/compose.js";
import { projectStartSteps } from "../../src/services/start/step-selection.js";
import { WorkflowBootstrapPrimitiveSchema } from "../../src/domain/dashboard/bootstrap.js";
import { healthyDashboardPreflightReport } from "../fixtures/preflight-seams.js";
import { explorerQueryDeps } from "../fixtures/explorer-seams.js";
import {
  AT,
  makeWorld,
  queuedEventOf,
  taskEventsOf,
  uuidOf,
} from "./server/helpers/dashboard-harness.js";
import { personLookupWorkflow } from "../../src/workflows/person-lookup/workflow.js";
import { separationsDescriptor } from "../helpers/registered-workflows.js";

const EXPLORER_HASH = FingerprintSchema.parse("c".repeat(64));

function definitionEntryIds(definition: typeof WORKFLOW_DEFINITIONS[number]["definition"]): readonly string[] {
  return definition.steps.flatMap(([, entries]) => entries.map((entry) => entry.id));
}

describe("workflow definition registry conformance", () => {
  it("derives the converted population from the one module tuple and refuses a mismatched compiler identity", () => {
    expect(WORKFLOW_DEFINITIONS.map(({ descriptor }) => String(descriptor.id)))
      .toEqual(["person-lookup", "separations"]);
    expect(WORKFLOW_DEFINITIONS.map(({ descriptor, definition }) => workflowDefinitionOf(descriptor) === definition))
      .toEqual([true, true]);

    expect(() => workflowDefinitionRegistry([{
      descriptor: separationsDescriptor,
      stores: [],
      definition: personLookupWorkflow,
    }])).toThrow("workflow separations registers a definition that did not compile its own descriptor");
  });

  it("keeps every registered definition's tuple groups and entries equal to its compiled descriptor and generic projections", () => {
    for (const { descriptor, definition } of WORKFLOW_DEFINITIONS) {
      const expectedGroups = definition.steps.map(([group, entries]) => ({
        key: group.key,
        label: group.label,
        nodes: entries.map(({ id }) => id),
      }));
      const expectedTaskIds = definitionEntryIds(definition);

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
      // membership stays one workflow entry per graph node.
      expect([...new Set(workflowProjections(descriptor).steps.map(({ nodeId }) => String(nodeId)))]
        .toSorted(), String(descriptor.id)).toEqual(expectedTaskIds.toSorted());
    }
  });

  it("serves every definition-backed workflow through the existing bootstrap/start, detail timeline, and Explorer projections", () => {
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
      const bootstrapWorkflows = WorkflowBootstrapPrimitiveSchema.array().parse(bootstrap.workflows);
      const starts = new Map(bootstrapWorkflows.map((workflow) => [String(workflow.id), workflow.start]));
      const explorer = buildWorkflowExplorer(explorerQueryDeps(manualClock(AT), EXPLORER_HASH));
      const explorerWorkflows = new Map(explorer.workflows.map((workflow) => [String(workflow.id), workflow]));

      for (const { descriptor, definition } of WORKFLOW_DEFINITIONS) {
        const id = String(descriptor.id);
        const expectedGroups = definition.steps.map(([group, entries]) => ({
          key: group.key,
          label: group.label,
          nodes: entries.map(({ id: nodeId }) => nodeId),
        }));
        const expectedTaskIds = definitionEntryIds(definition);

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
          members: nodes.map((nodeId) => descriptor.timeline
            .flatMap((group) => group.nodes)
            .find((node) => String(node.id) === nodeId)?.label),
        })));
      }
    } finally {
      world.dispose();
    }
  });

  it("leaves person lookup and separations definition-backed, with no authored descriptor, module, timeline or flow declaration", () => {
    const sources = [
      "../../src/workflows/person-lookup/workflow.ts",
      "../../src/workflows/separations/workflow.ts",
    ];
    for (const sourcePath of sources) {
      const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");
      expect(source, sourcePath).toMatch(/= defineWorkflow\(\{/u);
      expect(source, sourcePath).not.toMatch(/defineWorkflowDescriptor\(/u);
      expect(source, sourcePath).not.toMatch(/compileWorkflow\(/u);
      expect(source, sourcePath).not.toMatch(/\bflow\(/u);
      expect(source, sourcePath).not.toMatch(/\btimeline\s*:/u);
      expect(source, sourcePath).not.toMatch(/recipe/iu);
    }
    for (const retired of [
      "../../src/workflows/person-lookup/descriptor.ts",
      "../../src/workflows/person-lookup/module.ts",
      "../../src/workflows/separations/descriptor.ts",
      "../../src/workflows/separations/module.ts",
    ]) {
      expect(existsSync(new URL(retired, import.meta.url)), retired).toBe(false);
    }
  });
});
