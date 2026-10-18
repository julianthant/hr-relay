import { Hono } from "hono";
import { default as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeActivity } from "../../../../src/backend/app/composition/dashboard/activity.js";
import { descriptorSetHash as descriptorSetHash_m0 } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { composeQueueSummaries } from "../../../../src/backend/app/composition/dashboard/queue-summaries.js";
import { DESCRIPTORS, WORKFLOW_DEFINITIONS, WORKFLOW_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import { buildBootstrap } from "../../../../src/backend/runs/queries/bootstrap.js";
import { buildWorkflowExplorer } from "../../../../src/backend/runs/queries/explorer.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { registerActivityRoutes } from "../../../../src/backend/transports/http/routes/activity.js";
import { type DashboardApp } from "../../../../src/backend/transports/http/routes/api-types.js";
import { failureStatus } from "../../../../src/backend/transports/http/routes/failure-status.js";
import { ActivityReportSelectionSchema } from "../../../../src/models/dashboard/activity-selection.js";
import { WorkflowBootstrapPrimitiveSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { workflowDefinitionRegistry } from "../../../../src/workflow-kit/validation/workflow-module-audit.js";
import { workflowDefinitionOf } from "../../../../src/workflow-kit/workflow-definition.js";
import { workflowProjections } from "../../../../src/workflow-kit/workflow.js";
import { personLookupWorkflow } from "../../../../src/workflows/person-lookup/workflow.js";
import { explorerQueryDeps } from "../../../support/fixtures/explorer-seams.js";
import { healthyDashboardPreflightReport } from "../../../support/fixtures/preflight-seams.js";
import { AT, makeWorld, queuedEventOf, taskEventsOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { foundationFixture, id as id_m1, NOW } from "../../../support/helpers/database-foundation/fixtures.js";
import { separationsDescriptor } from "../../../support/helpers/registered-workflows.js";

{

const EXPLORER_HASH = FingerprintSchema.parse("c".repeat(64));

function definitionEntryIds(definition: typeof WORKFLOW_DEFINITIONS[number]["definition"]): readonly string[] {
  return definition.steps.flatMap(([, entries]) => entries.map((entry) => entry.id));
}

describe("workflow definition registry conformance", () => {
  it("derives the converted population from the one module tuple and refuses a mismatched compiler identity", () => {
    // Every definition-backed module in the one tuple, in tuple order — the
    // two acceptance workflows and each converted chunk harness.
    expect(WORKFLOW_DEFINITIONS.map(({ descriptor }) => String(descriptor.id)))
      .toEqual(WORKFLOW_MODULES.filter((module) => "definition" in module).map(({ descriptor }) => String(descriptor.id)));
    expect(WORKFLOW_DEFINITIONS.map(({ descriptor }) => String(descriptor.id)))
      .toEqual(expect.arrayContaining(["person-lookup", "separations"]));
    expect(WORKFLOW_DEFINITIONS.every(({ descriptor, definition }) => workflowDefinitionOf(descriptor) === definition))
      .toBe(true);
    expect(WORKFLOW_DEFINITIONS.length).toBeGreaterThanOrEqual(2);

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
        descriptorSetHash: descriptorSetHash_m0(WORKFLOW_MODULES.map(({ descriptor }) => descriptor.contractFingerprint)),
        settingsSchemaHash: descriptorSetHash_m0(["settings-schema"]),
        projection: world.projection,
        authorityMeta: () => ({ schemaVersion: 13, authorityGeneration: 4 }),
        backupSummary: () => "current",
        preflightReport: () => healthyDashboardPreflightReport(manualClock(AT)),
      });
      const bootstrapWorkflows = WorkflowBootstrapPrimitiveSchema.array().parse(bootstrap.workflows);
      const starts = new Map(bootstrapWorkflows.map((workflow) => [String(workflow.id), workflow.start]));
      const explorer = buildWorkflowExplorer(explorerQueryDeps(manualClock(AT), EXPLORER_HASH));
      const explorerWorkflows = new Map(explorer.workflows.map((workflow) => [String(workflow.id), workflow]));

      for (const [index, { descriptor, definition }] of WORKFLOW_DEFINITIONS.entries()) {
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
          details: descriptor.details.filter((detail) => "nodeId" in detail.source && detail.source.nodeId === String(nodeId)).map(({ key }) => key),
        })));

        const seed = 501 + index;
        queuedEventOf(world, { seed, workflow: id, descriptor });
        for (const nodeId of expectedTaskIds) taskEventsOf(world, seed, nodeId, "done");
        const detail = buildRunDetail({ runReader: world.runReader,
          stateRoot: world.stateRoot, timeline:world.timeline,
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
      "../../../../src/workflows/person-lookup/workflow.ts",
      "../../../../src/workflows/separations/workflow.ts",
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
      "../../../../src/workflows/person-lookup/descriptor.ts",
      "../../../../src/workflows/person-lookup/module.ts",
      "../../../../src/workflows/separations/descriptor.ts",
      "../../../../src/workflows/separations/module.ts",
    ]) {
      expect(existsSync(new URL(retired, import.meta.url)), retired).toBe(false);
    }
  });
});
}

{

/** Real SQLite summary consumers through their independently composed HTTP/read ports. */
describe("composed Activity and Queue boundaries", () => {
  it("serves JSON and CSV from the same bounded Activity query and pages Queue independently", async () => {
    const f = foundationFixture();
    try {
      f.db.withAuthorityTransaction(() => {
        for (let n = 0; n < 7; n += 1) f.db.authority.runs.enqueue(RunRecordSchema.parse({ ...f.run,
          envelope: { ...f.run.envelope, runId: id_m1(4100 + n), itemId: id_m1(4100 + n), enqueuedAt: NOW },
          lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: NOW,
        }));
      });
      f.db.readRunSummaries = () => { throw new Error("surface boundary cannot read the whole summary corpus"); };
      const { activity, activityPopulation } = composeActivity({ database: f.db, clock: f.clock,
        descriptors: { resolve: workflowId => DESCRIPTORS.find(row => row.id === workflowId) },
        ledger: createTransactionHistory(f.db.authority),
      });
      const queue = composeQueueSummaries(f.db);
      const app: DashboardApp = new Hono();
      app.onError((error, context) => { const result = failureStatus(error); return context.json(result.body, result.status); });
      registerActivityRoutes(app, { activity, activityPopulation });
      const from = "2026-09-09", to = from;
      const expected = activity.read(from, to);
      assert.equal(expected.totalRuns, 7);
      const response = await app.request(`/api/v1/reports/activity?from=${from}&to=${to}`);
      assert.equal(response.status, 200);
      assert.deepEqual(ActivityReportSelectionSchema.parse(await response.json()), expected);
      const csv = await app.request(`/api/v1/reports/activity.csv?${new URLSearchParams({ from, to, snapshot: expected.snapshot.token })}`);
      assert.equal(csv.status, 200);
      assert.equal(csv.headers.get("cache-control"), "no-store");
      assert.match(csv.headers.get("content-disposition") ?? "", /attachment; filename="activity-/u);
      assert.match(await csv.text(), /2026-09-09/u);
      const seen: string[] = [];
      let after: { localDay: string; runId: string } | undefined;
      do {
        const page = queue.withSnapshot(() => queue.queue({ fromDay: from, toDay: to, limit: 2, topLevel: true, ...(after === undefined ? {} : { after }) }));
        assert.ok(page.items.length <= 2);
        seen.push(...page.items.map(row => row.runId));
        after = page.next ?? undefined;
      } while (after !== undefined);
      assert.deepEqual(seen, Array.from({ length: 7 }, (_, n) => id_m1(4100 + n)));
      assert.deepEqual(activity.read(from, to), expected, "Queue reads cannot alter Activity authority or totals");
      for (const path of ["/api/v1/reports/activity", "/api/v1/reports/activity.csv?from=2026-09-09", "/api/v1/reports/activity?from=2026-09-10&to=2026-09-09"]) {
        assert.notEqual((await app.request(path)).status, 200, "a missing or reversed range cannot become a default report");
      }
      assert.throws(() => queue.queue({ fromDay: to, toDay: "2026-09-08", limit: 2, topLevel: true }), /range-invalid/u);
    } finally { f.dispose(); }
  });
});
}
