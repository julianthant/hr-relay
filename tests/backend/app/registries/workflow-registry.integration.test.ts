import { Hono as Hono_m1 } from "hono";
import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { existsSync as existsSync_m0,readFileSync as readFileSync_m0 } from "node:fs";
import { describe as describe_m0,describe as describe_m1,expect as expect_m0,it as it_m0,it as it_m1 } from "vitest";
import { composeActivity as composeActivity_m1 } from "../../../../src/backend/app/composition/dashboard/activity.js";
import { descriptorSetHash as descriptorSetHash_m0 } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { composeQueueSummaries as composeQueueSummaries_m1 } from "../../../../src/backend/app/composition/dashboard/queue-summaries.js";
import { DESCRIPTORS as DESCRIPTORS_m1,WORKFLOW_DEFINITIONS as WORKFLOW_DEFINITIONS_m0,WORKFLOW_MODULES as WORKFLOW_MODULES_m0 } from "../../../../src/backend/app/registries/workflow-registry.js";
import { buildBootstrap as buildBootstrap_m0 } from "../../../../src/backend/runs/queries/bootstrap.js";
import { buildWorkflowExplorer as buildWorkflowExplorer_m0 } from "../../../../src/backend/runs/queries/explorer.js";
import { buildRunDetail as buildRunDetail_m0 } from "../../../../src/backend/runs/queries/run-detail.js";
import { projectStartSteps as projectStartSteps_m0 } from "../../../../src/backend/runs/start/step-selection.js";
import { createTransactionHistory as createTransactionHistory_m1 } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { registerActivityRoutes as registerActivityRoutes_m1 } from "../../../../src/backend/transports/http/routes/activity.js";
import type { DashboardApp as DashboardApp_m1 } from "../../../../src/backend/transports/http/routes/api-types.js";
import { failureStatus as failureStatus_m1 } from "../../../../src/backend/transports/http/routes/failure-status.js";
import { ActivityReportSelectionSchema as ActivityReportSelectionSchema_m1 } from "../../../../src/models/dashboard/activity-selection.js";
import { WorkflowBootstrapPrimitiveSchema as WorkflowBootstrapPrimitiveSchema_m0 } from "../../../../src/models/dashboard/bootstrap.js";
import { RunRecordSchema as RunRecordSchema_m1 } from "../../../../src/models/run/record.js";
import { FingerprintSchema as FingerprintSchema_m0 } from "../../../../src/rules/identity/ids.js";
import { manualClock as manualClock_m0 } from "../../../../src/rules/time/clock.js";
import { workflowDefinitionRegistry as workflowDefinitionRegistry_m0 } from "../../../../src/workflow-kit/validation/workflow-module-audit.js";
import { workflowDefinitionOf as workflowDefinitionOf_m0 } from "../../../../src/workflow-kit/workflow-definition.js";
import { workflowProjections as workflowProjections_m0 } from "../../../../src/workflow-kit/workflow.js";
import { personLookupWorkflow as personLookupWorkflow_m0 } from "../../../../src/workflows/person-lookup/workflow.js";
import { explorerQueryDeps as explorerQueryDeps_m0 } from "../../../support/fixtures/explorer-seams.js";
import { healthyDashboardPreflightReport as healthyDashboardPreflightReport_m0 } from "../../../support/fixtures/preflight-seams.js";
import { AT as AT_m0,makeWorld as makeWorld_m0,queuedEventOf as queuedEventOf_m0,taskEventsOf as taskEventsOf_m0,uuidOf as uuidOf_m0 } from "../../../support/helpers/backend/dashboard-harness.js";
import { foundationFixture as foundationFixture_m1,id as id_m1,NOW as NOW_m1 } from "../../../support/helpers/database-foundation/fixtures.js";
import { separationsDescriptor as separationsDescriptor_m0 } from "../../../support/helpers/registered-workflows.js";


{


const EXPLORER_HASH = FingerprintSchema_m0.parse("c".repeat(64));

function definitionEntryIds(definition: typeof WORKFLOW_DEFINITIONS_m0[number]["definition"]): readonly string[] {
  return definition.steps.flatMap(([, entries]) => entries.map((entry) => entry.id));
}

describe_m0("workflow definition registry conformance", () => {
  it_m0("derives the converted population from the one module tuple and refuses a mismatched compiler identity", () => {
    // Every definition-backed module in the one tuple, in tuple order — the
    // two acceptance workflows and each converted chunk harness.
    expect_m0(WORKFLOW_DEFINITIONS_m0.map(({ descriptor }) => String(descriptor.id)))
      .toEqual(WORKFLOW_MODULES_m0.filter((module) => "definition" in module).map(({ descriptor }) => String(descriptor.id)));
    expect_m0(WORKFLOW_DEFINITIONS_m0.map(({ descriptor }) => String(descriptor.id)))
      .toEqual(expect_m0.arrayContaining(["person-lookup", "separations"]));
    expect_m0(WORKFLOW_DEFINITIONS_m0.every(({ descriptor, definition }) => workflowDefinitionOf_m0(descriptor) === definition))
      .toBe(true);
    expect_m0(WORKFLOW_DEFINITIONS_m0.length).toBeGreaterThanOrEqual(2);

    expect_m0(() => workflowDefinitionRegistry_m0([{
      descriptor: separationsDescriptor_m0,
      stores: [],
      definition: personLookupWorkflow_m0,
    }])).toThrow("workflow separations registers a definition that did not compile its own descriptor");
  });

  it_m0("keeps every registered definition's tuple groups and entries equal to its compiled descriptor and generic projections", () => {
    for (const { descriptor, definition } of WORKFLOW_DEFINITIONS_m0) {
      const expectedGroups = definition.steps.map(([group, entries]) => ({
        key: group.key,
        label: group.label,
        nodes: entries.map(({ id }) => id),
      }));
      const expectedTaskIds = definitionEntryIds(definition);

      expect_m0(descriptor.timeline.map((group) => ({
        key: group.key,
        label: group.label,
        nodes: group.nodes.map(({ id }) => String(id)),
      })), String(descriptor.id)).toEqual(expectedGroups);
      // Tuple order is presentation authority; the compiled graph is
      // dependency-topological. Both must contain the exact same tasks.
      expect_m0(descriptor.nodes.map(({ id }) => String(id)).toSorted(), String(descriptor.id))
        .toEqual(expectedTaskIds.toSorted());
      // Transaction nodes deliberately project a beat for each task contract;
      // membership stays one workflow entry per graph node.
      expect_m0([...new Set(workflowProjections_m0(descriptor).steps.map(({ nodeId }) => String(nodeId)))]
        .toSorted(), String(descriptor.id)).toEqual(expectedTaskIds.toSorted());
    }
  });

  it_m0("serves every definition-backed workflow through the existing bootstrap/start, detail timeline, and Explorer projections", () => {
    const world = makeWorld_m0();
    try {
      const bootstrap = buildBootstrap_m0({
        appVersion: "0.1.0",
        clock: manualClock_m0(AT_m0),
        modules: WORKFLOW_MODULES_m0,
        descriptorSetHash: descriptorSetHash_m0(WORKFLOW_MODULES_m0.map(({ descriptor }) => descriptor.contractFingerprint)),
        settingsSchemaHash: descriptorSetHash_m0(["settings-schema"]),
        projection: world.projection,
        authorityMeta: () => ({ schemaVersion: 13, authorityGeneration: 4 }),
        backupSummary: () => "current",
        preflightReport: () => healthyDashboardPreflightReport_m0(manualClock_m0(AT_m0)),
      });
      const bootstrapWorkflows = WorkflowBootstrapPrimitiveSchema_m0.array().parse(bootstrap.workflows);
      const starts = new Map(bootstrapWorkflows.map((workflow) => [String(workflow.id), workflow.start]));
      const explorer = buildWorkflowExplorer_m0(explorerQueryDeps_m0(manualClock_m0(AT_m0), EXPLORER_HASH));
      const explorerWorkflows = new Map(explorer.workflows.map((workflow) => [String(workflow.id), workflow]));

      for (const [index, { descriptor, definition }] of WORKFLOW_DEFINITIONS_m0.entries()) {
        const id = String(descriptor.id);
        const expectedGroups = definition.steps.map(([group, entries]) => ({
          key: group.key,
          label: group.label,
          nodes: entries.map(({ id: nodeId }) => nodeId),
        }));
        const expectedTaskIds = definitionEntryIds(definition);

        const start = starts.get(id);
        assert_m0.ok(start !== undefined, `${id} is absent from the bootstrap start surface`);
        expect_m0(start.steps.map(({ key, label }) => ({ key, label })), id)
          .toEqual(expectedGroups.map(({ key, label }) => ({ key, label })));
        expect_m0(start.steps.map(({ key }) => key), id)
          .toEqual(projectStartSteps_m0(descriptor).map(({ key }) => key));

        const explorerWorkflow = explorerWorkflows.get(id);
        assert_m0.ok(explorerWorkflow !== undefined, `${id} is absent from Explorer`);
        expect_m0(explorerWorkflow.nodes.map(({ id: nodeId }) => String(nodeId)).toSorted(), id)
          .toEqual(expectedTaskIds.toSorted());
        expect_m0(explorerWorkflow.nodes.map(({ id: nodeId, details }) => ({
          id: String(nodeId),
          details: details.map(({ key }) => key),
        })), id).toEqual(descriptor.nodes.map(({ id: nodeId }) => ({
          id: String(nodeId),
          details: descriptor.details.filter((detail) => detail.source.nodeId === String(nodeId)).map(({ key }) => key),
        })));

        const seed = 501 + index;
        queuedEventOf_m0(world, { seed, workflow: id });
        for (const nodeId of expectedTaskIds) taskEventsOf_m0(world, seed, nodeId, "done");
        const detail = buildRunDetail_m0({ runReader: world.runReader,
          stateRoot: world.stateRoot, timeline:world.timeline,
          projection: world.projection,
          authority: world.authority,
          descriptors: { resolve: (workflowId) => workflowId === id ? descriptor : undefined },
        }, uuidOf_m0(seed));
        expect_m0(detail.timeline.steps?.map((step) => ({
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

  it_m0("leaves person lookup and separations definition-backed, with no authored descriptor, module, timeline or flow declaration", () => {
    const sources = [
      "../../../../src/workflows/person-lookup/workflow.ts",
      "../../../../src/workflows/separations/workflow.ts",
    ];
    for (const sourcePath of sources) {
      const source = readFileSync_m0(new URL(sourcePath, import.meta.url), "utf8");
      expect_m0(source, sourcePath).toMatch(/= defineWorkflow\(\{/u);
      expect_m0(source, sourcePath).not.toMatch(/defineWorkflowDescriptor\(/u);
      expect_m0(source, sourcePath).not.toMatch(/compileWorkflow\(/u);
      expect_m0(source, sourcePath).not.toMatch(/\bflow\(/u);
      expect_m0(source, sourcePath).not.toMatch(/\btimeline\s*:/u);
      expect_m0(source, sourcePath).not.toMatch(/recipe/iu);
    }
    for (const retired of [
      "../../../../src/workflows/person-lookup/descriptor.ts",
      "../../../../src/workflows/person-lookup/module.ts",
      "../../../../src/workflows/separations/descriptor.ts",
      "../../../../src/workflows/separations/module.ts",
    ]) {
      expect_m0(existsSync_m0(new URL(retired, import.meta.url)), retired).toBe(false);
    }
  });
});
}

{


/** Real SQLite summary consumers through their independently composed HTTP/read ports. */
describe_m1("composed Activity and Queue boundaries", () => {
  it_m1("serves JSON and CSV from the same bounded Activity query and pages Queue independently", async () => {
    const f = foundationFixture_m1();
    try {
      f.db.withAuthorityTransaction(() => {
        for (let n = 0; n < 7; n += 1) f.db.authority.runs.enqueue(RunRecordSchema_m1.parse({ ...f.run,
          envelope: { ...f.run.envelope, runId: id_m1(4100 + n), itemId: id_m1(4100 + n), enqueuedAt: NOW_m1 },
          lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: NOW_m1,
        }));
      });
      f.db.readRunSummaries = () => { throw new Error("surface boundary cannot read the whole summary corpus"); };
      const activity = composeActivity_m1({ database: f.db, clock: f.clock,
        descriptors: { resolve: workflowId => DESCRIPTORS_m1.find(row => row.id === workflowId) },
        ledger: createTransactionHistory_m1(f.db.authority),
      });
      const queue = composeQueueSummaries_m1(f.db);
      const app: DashboardApp_m1 = new Hono_m1();
      app.onError((error, context) => { const result = failureStatus_m1(error); return context.json(result.body, result.status); });
      registerActivityRoutes_m1(app, { activity });
      const from = "2026-09-09", to = from;
      const expected = activity.read(from, to);
      assert_m1.equal(expected.totalRuns, 7);
      const response = await app.request(`/api/v1/reports/activity?from=${from}&to=${to}`);
      assert_m1.equal(response.status, 200);
      assert_m1.deepEqual(ActivityReportSelectionSchema_m1.parse(await response.json()), expected);
      const csv = await app.request(`/api/v1/reports/activity.csv?${new URLSearchParams({ from, to, snapshot: expected.snapshot.token })}`);
      assert_m1.equal(csv.status, 200);
      assert_m1.equal(csv.headers.get("cache-control"), "no-store");
      assert_m1.match(csv.headers.get("content-disposition") ?? "", /attachment; filename="activity-/u);
      assert_m1.match(await csv.text(), /2026-09-09/u);
      const seen: string[] = [];
      let after: { localDay: string; runId: string } | undefined;
      do {
        const page = queue.withSnapshot(() => queue.queue({ fromDay: from, toDay: to, limit: 2, topLevel: true, ...(after === undefined ? {} : { after }) }));
        assert_m1.ok(page.items.length <= 2);
        seen.push(...page.items.map(row => row.runId));
        after = page.next ?? undefined;
      } while (after !== undefined);
      assert_m1.deepEqual(seen, Array.from({ length: 7 }, (_, n) => id_m1(4100 + n)));
      assert_m1.deepEqual(activity.read(from, to), expected, "Queue reads cannot alter Activity authority or totals");
      for (const path of ["/api/v1/reports/activity", "/api/v1/reports/activity.csv?from=2026-09-09", "/api/v1/reports/activity?from=2026-09-10&to=2026-09-09"]) {
        assert_m1.notEqual((await app.request(path)).status, 200, "a missing or reversed range cannot become a default report");
      }
      assert_m1.throws(() => queue.queue({ fromDay: to, toDay: "2026-09-08", limit: 2, topLevel: true }), /range-invalid/u);
    } finally { f.dispose(); }
  });
});
}
