
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { EXPLORER_SOURCE_ROOT } from "../../../src/backend/runs/queries/explorer.js";
import { buildUiTaskLinks } from "../../../src/backend/systems/ui-task-links.js";
import { type ExplorerNodeWire } from "../../../src/models/dashboard/explorer.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { buildWorkflowExplorer } from "../../../src/backend/runs/queries/explorer.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { explorerQueryDeps } from "../../support/fixtures/explorer-seams.js";


describe("Explorer registered graph and service acceptance", () => {
  it("matches each runtime dependency, condition and dry-run boundary and resolves all printed sources", async () => {

      const query = explorerQueryDeps(manualClock(new Date("2026-09-13T10:00:00Z")), FingerprintSchema.parse("b".repeat(64)));
      const wire = buildWorkflowExplorer(query);
      const uiTaskLinks = buildUiTaskLinks();
      assert.deepEqual(wire.workflows.map(w => w.id), query.modules.map(m => m.descriptor.id));
      let conditional = 0;
      let transactions = 0;
      for (const module of query.modules) {
        const served = wire.workflows.find(w => w.id === module.descriptor.id);
        assert.ok(served);
        const nodes = descriptorRuntimeNodes(module.descriptor);
        assert.deepEqual(served.nodes.map(n => n.id), nodes.map(n => n.id));
        assert.deepEqual(served.edges.filter(e => e.kind === "depends-on"), nodes.flatMap(n => n.dependsOn.map(from => ({ from, to: n.id, kind: "depends-on" }))));
        for (const node of nodes) {
          const view: ExplorerNodeWire | undefined = served.nodes.find(n => n.id === node.id);
          assert.ok(view);
          if (node.kind === "task") {
            assert.equal(view.shape.kind, "task");
            if (view.shape.kind !== "task") throw new Error("task view mismatch");
            assert.deepEqual(view.shape.condition, node.when);
            assert.equal(view.shape.replay, node.replay);
            if (node.when !== undefined) conditional += 1;
          }
          if (node.kind === "transaction") {
            transactions += 1;
            assert.equal(view.shape.kind, "transaction");
            if (view.shape.kind !== "transaction") throw new Error("transaction view mismatch");
            assert.equal(view.shape.dryRun, node.dryRun);
          }
        }
        for (const source of [served.sources.descriptor, served.sources.module, ...served.nodes.flatMap(n => n.tasks.flatMap(t => [t.contractSource, t.implSource]))]) {
          assert.equal(source.state, "resolved");
          if (source.state === "resolved") assert.ok(existsSync(join(EXPLORER_SOURCE_ROOT, source.path)), source.path);
        }
        for (const scenario of served.scenarios) {
          assert.equal(scenario.source.state, "unresolved");
          if (scenario.source.state !== "unresolved") throw new Error("scenario source must remain absent");
          assert.ok(scenario.source.reason.length > 0);
        }
        for (const task of served.nodes.flatMap(n => n.tasks)) {
          assert.deepEqual(task.ui.map(link => link.catalogId).sort(), uiTaskLinks
            .filter(link => link.taskUses.includes(task.taskId)).map(link => link.id).sort());
        }
      }
      assert.ok(conditional > 0 && transactions > 0, "must exercise actual conditional and transaction nodes");
  });
});
