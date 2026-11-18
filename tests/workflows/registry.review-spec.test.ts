import assert from "node:assert/strict";
import { it } from "vitest";
import { buildWorkflowExplorer } from "../../src/backend/runs/queries/explorer.js";
import { READABLE_WORKFLOW_MODULES } from "../../src/backend/app/registries/workflow-registry.js";
import type { ExplorerReviewSpec } from "../../src/models/dashboard/explorer-review-spec.js";
import { WorkflowStepReviewSchema, type WorkflowStepReview } from "../../src/models/workflow/review-spec.js";
import { FingerprintSchema } from "../../src/rules/identity/ids.js";
import { manualClock } from "../../src/rules/time/clock.js";
import { compileWorkflow, composeWorkflowModule } from "../../src/workflow-kit/workflow-definition.js";
import { personLookupWorkflow } from "../../src/workflows/person-lookup/workflow.js";
import { explorerQueryDeps } from "../support/fixtures/explorer-seams.js";

function assertFrozenRecursively(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertFrozenRecursively);
}

it("authors every registered step and retains every visible operator field exactly once", () => {
  for (const { definition, descriptor } of READABLE_WORKFLOW_MODULES) {
    for (const [group] of definition.steps) {
      assert.ok(group.review, `${definition.id}/${group.key} has no review metadata`);
      const review = WorkflowStepReviewSchema.parse(group.review);
      const fields = review.pages.flatMap(page => page.fields.flatMap(field => "operatorField" in field ? [field.operatorField] : []));
      const visible = descriptor.timeline.find(step => step.key === group.key)?.operatorFields?.filter(field => field.visibility !== "logs") ?? [];
      assert.deepEqual([...fields].sort(), visible.map(field => field.label).sort(), `${definition.id}/${group.key}`);
      assert.equal(Object.isFrozen(group.review), true);
      assert.equal(Object.isFrozen(group.review.pages), true);
      assertFrozenRecursively(group.review);
    }
  }
});

const deps = () => explorerQueryDeps(manualClock(new Date("2026-08-09T12:00:00.000Z")), FingerprintSchema.parse("d".repeat(64)));
const explorer = () => buildWorkflowExplorer(deps());
const rowsWithoutSample = (spec: ExplorerReviewSpec) => spec.steps.flatMap(step => step.blocks.flatMap(block =>
  block.kind === "card" ? block.rows.filter(row => row.value === undefined).map(row => `${step.id}/${block.id}/${row.id}`) : []));

it("serves a sample value for every row of every workflow", () => {
  for (const workflow of explorer().workflows) assert.deepEqual(rowsWithoutSample(workflow.reviewSpec), [], workflow.id);
});

it("fails the completeness check on a broken Person Lookup example or an outcome with no words", () => {
  const original = deps().modules.find(module => module.descriptor.id === "person-lookup"); assert.ok(original);
  const rebuild = (edit: (review: WorkflowStepReview) => WorkflowStepReview) => {
    const definition = { ...personLookupWorkflow, steps: personLookupWorkflow.steps.map(([group, entries]) =>
      [group.key !== "searching" || group.review === undefined ? group : { ...group, review: edit(group.review) }, entries] as const) };
    return buildWorkflowExplorer({ ...deps(), modules: [composeWorkflowModule(compileWorkflow(definition), original.stores)] }).workflows[0]?.reviewSpec;
  };
  const broken = rebuild(review => ({ ...review, pages: review.pages.map(page => ({ ...page, fields: page.fields.map(field => {
    if (!("inputField" in field) || field.inputField !== "name") return field;
    const { example: _example, ...rest } = field;
    return rest;
  }) })) }));
  assert.ok(broken);
  assert.deepEqual(rowsWithoutSample(broken), ["searching/person-search/search-name"]);
  assert.throws(() => rebuild(review => ({ ...review, decisions: review.decisions?.map(decision => ({ ...decision,
    outcomes: decision.outcomes.map(outcome => outcome.value === "resolved" ? { value: outcome.value } : outcome) })) })), /outcome resolved has no label/u);
  assert.throws(() => rebuild(review => ({ ...review, decisions: review.decisions?.map(decision => ({ ...decision,
    outcomes: decision.outcomes.map(outcome => outcome.value === "not-found" ? { value: outcome.value, label: "Nobody found", stops: true } : outcome) })) })), /without saying what the run does/u);
});

it("titles each Explorer step from the one timeline label that Logs shows for its nodes", () => {
  for (const workflow of explorer().workflows) {
    assert.deepEqual(workflow.reviewSpec.steps.map(step => step.title), workflow.timeline.map(group => group.label), workflow.id);
  }
  const [group] = personLookupWorkflow.steps[0] ?? []; assert.ok(group?.review);
  assert.equal(WorkflowStepReviewSchema.safeParse({ ...group.review, title: "Another title" }).success, false);
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
