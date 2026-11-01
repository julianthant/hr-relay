import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { workflowModuleOf } from "../../../../src/backend/app/registries/workflow-registry.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { RunStartDialog, type RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { TooltipProvider } from "../../../../src/dashboard/ds/ui.js";
import { FixtureCommandBinding } from "./command-binding.js";
import { createMountedRerunWorld } from "./mounted-rerun-world.js";
import { protectedSecretSource } from "../protected-secret-source.js";
import { launchHarness } from "../../fixtures/run-launch-fixtures.js";

export type ReadinessWorkflow = "person-lookup" | "separations";

export function createPlSeparationsReadinessWorld(profileFixture?: Parameters<typeof launchHarness>[3]) {
  const controls = createMountedRerunWorld(profileFixture);
  const fixtures: Awaited<ReturnType<typeof launchHarness>>[] = [];
  let root: Root | undefined;

  async function setup(workflowId: ReadinessWorkflow) {
    const module = workflowModuleOf(workflowId);
    const h = await launchHarness("reject-active", undefined, { descriptor: module.descriptor,
      protectedSecrets: protectedSecretSource({ timekeeperName: "Fixture Operator" }) }, profileFixture);
    fixtures.push(h);
    const workflow: RunStartWorkflow = { ...h.workflow, role: module.role };
    return { ...h, workflow,
      retained(run: RunRecord) {
        return {
          run: h.fresh(run), checkpoints: h.database.authority.runCheckpoints.listByItem(workflowId, run.envelope.itemId),
          intents: h.database.authority.writeIntents.listByRun(run.envelope.runId),
          gates: h.database.authority.gateResults.listByRun(run.envelope.runId),
        };
      },
      async failedSource(submission: unknown, dryRun: boolean) {
        const plan = await h.client.submitStartPlan({ workflowId, submissions: [submission], dryRun,
          browserMode: "headless", captureBrowserScreenshots: false });
        assert.deepEqual(plan.refused, []);
        const queued = h.start(plan);
        const outcome = await h.execute(queued);
        assert.ok(outcome.state === "failed");
        const failed = h.fresh(queued);
        const node = descriptorRuntimeNodes(module.descriptor).find(node => node.kind === "task");
        assert.ok(node?.kind === "task");
        const failure = h.database.authority.failures.get(outcome.failureId); assert.ok(failure);
        assert.equal(failure.nodeId, node.id);
        assert.equal(failure.taskId, node.uses.id);
        assert.equal(failure.summary, `no store implements ${node.uses.id}`);
        assert.equal(failure.writeState, "not-attempted");
        assert.equal(failed.lifecycle.state, "terminal");
        assert.ok(failed.lifecycle.state === "terminal" && failed.lifecycle.outcome === "failed");
        assert.deepEqual(h.database.authority.writeIntents.listByRun(failed.envelope.runId), []);
        return failed;
      },
      finalRequest() {
        const request = CommandRequestSchema.parse(h.finalCommands.at(-1));
        assert.ok(request.family === "start");
        return request;
      },
    };
  }

  type Harness = Awaited<ReturnType<typeof setup>>;
  async function mount(h: Harness, source?: RunRecord) {
    if (root !== undefined) { await act(async () => root?.unmount()); root = undefined; }
    const host = document.createElement("div"); document.body.replaceChildren(host);
    root = createRoot(host);
    const applied: string[] = [], closed: boolean[] = [];
    await act(async () => root?.render(createElement(TooltipProvider, {
      children: createElement(DashboardClientProvider, { client: h.client,
        children: createElement(FixtureCommandBinding, { actorId: "local-operator", nowIso: h.clock.now().toISOString(),
          children: createElement(RunStartDialog, { open: true, onOpenChange: next => closed.push(next),
            catalog: buildWorkflowCatalog([h.workflow], false, { [h.descriptor.id]: "served" }),
            panelWorkflowId: h.descriptor.id, actorId: "local-operator",
            ...(source === undefined ? {} : { rerunSource: { runId: source.envelope.runId, expectedVersion: source.version } }),
            onApplied: workflowId => applied.push(workflowId), onOpenIntake: () => assert.fail("typed launch cannot hand off to Intake") }) }) }) })));
    return { applied, closed };
  }

  async function cleanup() {
    const failures: unknown[] = [];
    try { await act(async () => root?.unmount()); root = undefined; await controls.cleanup(); }
    catch (error) { failures.push(error); }
    for (const fixture of fixtures.splice(0).reverse()) {
      try { await fixture.dispose(); } catch (error) { failures.push(error); }
    }
    if (failures.length !== 0) throw new AggregateError(failures, "readiness-fixture-closure-unproved");
  }
  return { setup, mount, cleanup, text: controls.text, button: controls.button,
    press: controls.press, checkbox: controls.checkbox, fill: controls.fill };
}
