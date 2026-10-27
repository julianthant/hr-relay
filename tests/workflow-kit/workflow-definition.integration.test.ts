import assert from "node:assert/strict";
import { describe,expect,it } from "vitest";
import { descriptorSetHash } from "../../src/backend/app/registries/workflow-registry.js";
import { taskStoreRegistry } from "../../src/backend/app/registries/task-registry.js";
import { WORKFLOW_MODULES } from "../../src/backend/app/registries/workflow-registry.js";
import { buildBootstrap } from "../../src/backend/runs/queries/bootstrap.js";
import { buildWorkflowExplorer } from "../../src/backend/runs/queries/explorer.js";
import { buildRunDetail } from "../../src/backend/runs/queries/run-detail.js";
import { projectStartSteps } from "../../src/backend/runs/start/step-selection.js";
import { WorkflowBootstrapPrimitiveSchema } from "../../src/models/dashboard/bootstrap.js";
import { FingerprintSchema } from "../../src/rules/identity/ids.js";
import { manualClock } from "../../src/rules/time/clock.js";
import { composeWorkflowModule,workflowEntryKinds } from "../../src/workflow-kit/workflow-definition.js";
import { explorerQueryDeps } from "../support/fixtures/explorer-seams.js";
import { healthyDashboardPreflightReport } from "../support/fixtures/preflight-seams.js";
import { compileFixtureWorkflow,everyEntryKindWorkflow,fixtureBuildManifest } from "../support/fixtures/workflow-definition-fixtures.js";
import { AT,makeWorld,queuedEventOf,taskEventsOf,uuidOf } from "../support/helpers/backend/dashboard-harness.js";

const EXPLORER_HASH = FingerprintSchema.parse("c".repeat(64));

describe("registry-wide conformance covers every explicit entry kind", () => {
  it("projects a definition using task, parallel, delegate, gate and transaction entries through bootstrap/start, Explorer and the detail timeline", async () => {
    const compiled = compileFixtureWorkflow(everyEntryKindWorkflow);
    const fixtureModule = composeWorkflowModule(compiled, taskStoreRegistry.stores);
    expect(workflowEntryKinds(everyEntryKindWorkflow).toSorted())
      .toEqual(["delegate", "gate", "parallel", "task", "transaction"]);
    const modules = [...WORKFLOW_MODULES, fixtureModule];
    const { descriptor, definition } = fixtureModule;
    const id = String(descriptor.id);
    const expectedGroups = definition.steps.map(([group, entries]) => ({
      key: group.key,
      label: group.label,
      nodes: entries.flatMap((entry) => (entry.kind === "parallel"
        ? [entry.id, ...descriptor.timeline.find((category) => category.key === group.key)?.nodes
          .map(({ id: nodeId }) => String(nodeId))
          .filter((nodeId) => nodeId !== entry.id && !entries.some((other) => other.id === nodeId)) ?? []]
        : [entry.id])),
    }));
    expect(descriptor.timeline.map((group) => ({
      key: group.key,
      label: group.label,
      nodes: group.nodes.map(({ id: nodeId }) => String(nodeId)),
    }))).toEqual(expectedGroups);

    const world = await makeWorld();
    try {
      const bootstrap = buildBootstrap({
        appVersion: "0.1.0",
        clock: manualClock(AT),
        modules,
        descriptorSetHash: descriptorSetHash(modules.map((module) => module.descriptor.contractFingerprint)),
        settingsSchemaHash: descriptorSetHash(["settings-schema"]),
        projection: world.projection,
        authorityMeta: () => ({ schemaVersion: 13, authorityGeneration: 4 }),
        backupSummary: () => "current",
        preflightReport: () => healthyDashboardPreflightReport(manualClock(AT)),
      });
      const start = WorkflowBootstrapPrimitiveSchema.array().parse(bootstrap.workflows)
        .find((workflow) => String(workflow.id) === id)?.start;
      assert.ok(start !== undefined, `${id} is absent from the bootstrap start surface`);
      expect(start.steps.map(({ key, label }) => ({ key, label })))
        .toEqual(expectedGroups.map(({ key, label }) => ({ key, label })));
      expect(start.steps.map(({ key }) => key)).toEqual(projectStartSteps(descriptor).map(({ key }) => key));

      const explorer = buildWorkflowExplorer({
        ...explorerQueryDeps(manualClock(AT), EXPLORER_HASH),
        modules,
        buildManifest: fixtureBuildManifest([id]),
      });
      const explorerWorkflow = explorer.workflows.find((workflow) => String(workflow.id) === id);
      assert.ok(explorerWorkflow !== undefined, `${id} is absent from Explorer`);
      expect(explorerWorkflow.nodes.map(({ id: nodeId, shape }) => `${String(nodeId)}:${shape.kind}`).toSorted()).toEqual([
        "child:child-run",
        "crm-dates:task",
        "crm-record:task",
        "fan:parallel",
        "pending-set:task",
        "review:gate",
        "search:task",
        "sweep:transaction",
      ]);

      const seed = 503;
      queuedEventOf(world, { seed, workflow: id, descriptor });
      for (const node of descriptor.nodes) {
        if (node.kind === "task") taskEventsOf(world, seed, String(node.id), "done");
      }
      const detail = buildRunDetail({ runReader: world.runReader,
        stateRoot: world.stateRoot, timeline:world.timeline,
        projection: world.projection,
        authority: world.authority,
        descriptors: { resolve: (workflowId) => workflowId === id ? descriptor : undefined },
      }, uuidOf(seed));
      expect(detail.timeline.steps?.map((step) => ({
        label: step.label,
        members: step.members.map((member) => member.label),
      }))).toEqual(expectedGroups.map(({ label, nodes }) => ({
        label,
        members: nodes.map((nodeId) => descriptor.timeline
          .flatMap((group) => group.nodes)
          .find((node) => String(node.id) === nodeId)?.label),
      })));
    } finally {
      await world.dispose();
    }
  });
});
