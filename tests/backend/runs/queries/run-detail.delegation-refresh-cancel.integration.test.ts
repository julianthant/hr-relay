import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { compileWorkflow, composeWorkflowModule, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { availableSections } from "../../../../src/backend/runs/queries/run-detail/availability.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { Plan1Input, Plan1CanonicalInput, Plan1Output, plan1Leaf, plan1Stores, plan1ControlledFailureStores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { createDelegationExecutionWorld } from "../../../support/helpers/backend/delegation-execution-world.js";

const root = compileWorkflow(defineWorkflow({ id: "fixture-child-settled-observation", code: "fso", version: 1,
  label: "Synthetic review", icon: "Search", category: "operations", input: Plan1Input, canonicalInput: Plan1CanonicalInput,
  inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], identity: { matchKey: input => input.emplId }, presentation: { title: () => "Synthetic review" },
  scenarios: ["fixture-plan1/happy"], role: defineWorkflowRole({ kind: "standalone" }),
  steps: ({ delegate, result }) => {
    const member = delegate({ id: "members", target: { id: plan1Leaf.descriptor.id, input: Plan1Input, result: Plan1Output },
      edgeId: "members", cardinality: "many", await: "terminal", join: "all-settled",
      policy: { onChildFailed: "allow-partial", cascadeCancel: "independent", afterChildRetry: "resume-parent", visibility: "inline" } },
      [], { bind: ({ input }) => [input], deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    return { steps: [[{ key: "members", label: "Members" }, [member]]], result: result(Plan1Input, [], ({ input }) => input) };
  },
}));
const modules = { root, modules: [composeWorkflowModule(plan1Leaf, plan1Stores.stores), composeWorkflowModule(root, plan1Stores.stores)] };
const world = createDelegationExecutionWorld(modules);
afterEach(world.cleanup);

it("keeps the receipt of a reopened parent cancelled while its refresh waits", async () => {
  const f = await world.fixture(plan1ControlledFailureStores(() => true), "fail", modules);
  await f.execution.execute(f.run, world.SIGNAL);
  await f.execution.step(f.run, world.SIGNAL);
  const parent = f.database.authority.runs.get(f.run.envelope.runId);
  assert.equal(parent?.completion?.kind, "done");
  const child = f.database.authority.runs.listChildren(parent.envelope.runId)[0];
  assert.ok(child?.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed");
  const command = (type: "retry" | "cancel", run: RunRecord) => ({ commandId: randomUUID(), family: "run" as const, type, source: "dashboard" as const,
    requestedBy: "local-operator" as const, requestedAt: f.clock.now().toISOString(), target: { runId: run.envelope.runId, expectedVersion: run.version } });
  assert.equal(f.execution.kernel.execute(command("retry", child)).state, "applied");
  const waiting = f.database.authority.runs.get(parent.envelope.runId);
  assert.ok(waiting?.delegationRefresh?.phase === "waiting");
  const trust = createReceiptService({ database: f.database, runReader: f.execution.lifecycle, descriptors: modules.modules.map(module => module.descriptor) });
  assert.equal(availableSections(undefined, waiting, trust).includes("receipt"), false);
  assert.equal(f.execution.kernel.execute(command("cancel", waiting)).state, "applied");
  const cancelled = f.database.authority.runs.get(parent.envelope.runId);
  assert.ok(cancelled?.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled");
  assert.equal(cancelled.delegationRefresh?.phase, "waiting");
  assert.ok(f.database.authority.runResults.get(cancelled.envelope.runId));
  assert.equal(availableSections(undefined, cancelled, trust).includes("receipt"), true);
});
