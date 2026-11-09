import assert from "node:assert/strict";
import { it } from "vitest";
import { buildWorkflowExplorer } from "../../src/backend/runs/queries/explorer.js";
import { READABLE_WORKFLOW_MODULES } from "../../src/backend/app/registries/workflow-registry.js";
import { ErrorCatalogCodeSchema, failureCodeFromTaskCode, operatorFailureSentence } from "../../src/models/failures/error-catalog.js";
import { WorkflowStepReviewSchema } from "../../src/models/workflow/review-spec.js";
import { FingerprintSchema } from "../../src/rules/identity/ids.js";
import { manualClock } from "../../src/rules/time/clock.js";
import { compileWorkflow } from "../../src/workflow-kit/workflow-definition.js";
import { explorerQueryDeps } from "../support/fixtures/explorer-seams.js";

it("authors every registered step and retains every visible operator field exactly once", () => {
  for (const { definition, descriptor } of READABLE_WORKFLOW_MODULES) {
    for (const [group] of definition.steps) {
      assert.ok(group.review, `${definition.id}/${group.key} has no review metadata`);
      const review = WorkflowStepReviewSchema.parse(group.review);
      const fields = review.pages.flatMap(page => page.fields.map(field => field.operatorField));
      const visible = descriptor.timeline.find(step => step.key === group.key)?.operatorFields?.filter(field => field.visibility !== "logs") ?? [];
      assert.deepEqual([...fields].sort(), visible.map(field => field.label).sort(), `${definition.id}/${group.key}`);
      assert.equal(Object.isFrozen(group.review), true);
      assert.equal(Object.isFrozen(group.review.pages), true);
    }
  }
});

it("serves complete pages, branch labels and catalog sentences for every declared task failure", () => {
  const wire = buildWorkflowExplorer(explorerQueryDeps(manualClock(new Date("2026-08-09T12:00:00.000Z")), FingerprintSchema.parse("d".repeat(64))));
  for (const workflow of wire.workflows) {
    for (const step of workflow.reviewSpec.steps) {
      assert.equal(step.pages.state, "authored", `${workflow.id}/${step.id}`);
      for (const decision of step.decisions) {
        assert.equal(decision.label.state, "authored", `${workflow.id}/${decision.id}`);
        if (decision.kind !== "failure") continue;
        const code = failureCodeFromTaskCode(decision.outcome);
        assert.equal(ErrorCatalogCodeSchema.safeParse(code).success, true, `${workflow.id}/${decision.taskId}/${decision.outcome}`);
        assert.deepEqual(decision.label, { state: "authored", text: operatorFailureSentence(code) });
        assert.equal(decision.action, "stop");
      }
    }
  }
  const lookup = wire.workflows.find(workflow => workflow.id === "i9-lookup"); assert.ok(lookup);
  const fields = lookup.reviewSpec.steps.flatMap(step => step.pages.state === "authored" ? step.pages.items.flatMap(page => page.fields) : []);
  assert.equal(fields.find(field => field.label === "Authorized official signer")?.options, undefined);
  assert.deepEqual(fields.find(field => field.label === "I-9 status")?.options, ["Signed", "Unsigned", "Historical", "Not found", "Unable to access"]);
});

it("keeps review presentation out of execution fingerprints, task identities and existing timelines", () => {
  for (const { definition, descriptor } of READABLE_WORKFLOW_MODULES) {
    const strippedDefinition: typeof definition = { ...definition, steps: definition.steps.map(([group, entries]) => {
      const { review, ...presentation } = group;
      assert.ok(review);
      return [presentation, entries] as const;
    }) };
    const stripped = compileWorkflow(strippedDefinition);
    assert.equal(stripped.descriptor.contractFingerprint, descriptor.contractFingerprint, definition.id);
    assert.deepEqual(stripped.descriptor.timeline, descriptor.timeline, definition.id);
    const original = compileWorkflow(definition);
    assert.deepEqual(stripped.contracts, original.contracts, definition.id);
  }
});
