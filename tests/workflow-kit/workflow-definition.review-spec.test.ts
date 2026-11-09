import assert from "node:assert/strict";
import { it } from "vitest";
import { WorkflowStepReviewSchema, type WorkflowStepReview } from "../../src/models/workflow/review-spec.js";
import { compileWorkflow } from "../../src/workflow-kit/workflow-definition.js";
import { personLookupWorkflow } from "../../src/workflows/person-lookup/workflow.js";
import { onboardingWorkflow } from "../../src/workflows/onboarding/workflow.js";

const review = Object.freeze({ pages: Object.freeze([Object.freeze({
  id: "employee-search", title: "Employee search", mode: "Read only" as const, nodeIds: ["searching", "matching", "search-identity"],
  lines: [{ id: "search", kind: "action" as const, text: "Search for the requested person.", nodeIds: ["searching"] }],
  fields: [{ id: "employee-id", operatorField: "Employee ID", source: { origin: "UCPath", detail: "Read the returned employee ID.",
    read: { stepKey: "searching", page: "Employee search", field: "Employee ID" }, chain: [] } }],
})]), branchLabels: Object.freeze([]) }) satisfies WorkflowStepReview;

function compileReview(candidate: WorkflowStepReview) {
  return compileWorkflow({ ...personLookupWorkflow, steps: personLookupWorkflow.steps.map(([group, entries], index) =>
    [{ ...group, review: index === 0 ? candidate : undefined }, entries] as const) });
}

it("accepts frozen review declarations and validates page, node, field and source references", () => {
  assert.doesNotThrow(() => compileReview(review));
  const page = review.pages[0]; assert.ok(page);
  const field = page.fields[0]; assert.ok(field);
  for (const nodeId of ["missing-node", "active-status"]) {
    assert.throws(() => compileReview({ ...review, pages: [{ ...page, nodeIds: [nodeId] }] }), /unknown or outside node/u);
  }
  assert.throws(() => compileReview({ ...review, pages: [{ ...page, fields: [{ ...field, operatorField: "Missing" }] }] }), /visible operator field/u);
  assert.throws(() => compileReview({ ...review, pages: [{ ...page, fields: [{ ...field, operatorField: "Drop reason" }] }] }), /visible operator field/u);
  for (const read of [
    { stepKey: "missing-step", page: "Employee search", field: "Employee ID" },
    { stepKey: "searching", page: "Ghost page", field: "Employee ID" },
    { stepKey: "searching", page: "Employee search", field: "Ghost field" },
  ]) {
    const source = { ...field.source, read };
    assert.throws(() => compileReview({ ...review, pages: [{ ...page, fields: [{ ...field, source }] }] }), /review source names unknown/u);
    assert.throws(() => compileReview({ ...review, pages: [{ ...page, fields: [{ ...field, source: { ...field.source, chain: [{ label: "Earlier read", detail: "Read earlier.", read }] } }] }] }), /review source names unknown/u);
  }
  assert.throws(() => compileReview({ ...review, pages: [page, page] }), /repeats page id/u);
  assert.throws(() => compileReview({ ...review, pages: [{ ...page, fields: [field, field] }] }), /repeats field id/u);
  assert.throws(() => compileReview({ ...review, pages: [{ ...page, lines: [page.lines[0], page.lines[0]] }] }), /repeats line id/u);
  assert.throws(() => compileReview({ ...review, pages: [{ ...page, lines: [{ ...page.lines[0], nodeIds: ["active-status"] }] }] }), /unknown or outside node/u);
  assert.throws(() => compileReview({ ...review, pages: [{ ...page, nodeIds: ["searching", "matching"] }] }), /reads outside page/u);
  assert.throws(() => compileReview({ ...review, branchLabels: [{ nodeId: "searching", outcome: "missing", label: "Missing" }] }), /unknown branch outcome/u);
});

it("rejects unknown review metadata and preserves explicit local steps with no pages", () => {
  assert.equal(WorkflowStepReviewSchema.safeParse({ ...review, extra: true }).success, false);
  const page = review.pages[0]; assert.ok(page);
  assert.equal(WorkflowStepReviewSchema.safeParse({ ...review, pages: [{ ...page, mode: "guess" }] }).success, false);
  assert.equal(WorkflowStepReviewSchema.safeParse({ ...review, pages: [{ ...page, fields: [{ ...page.fields[0], extra: true }] }] }).success, false);
  assert.doesNotThrow(() => compileReview({ pages: [], branchLabels: [] }));
});

it("requires every declared case when a branch step supplies review metadata", () => {
  const compile = (branchLabels: WorkflowStepReview["branchLabels"]) => compileWorkflow({ ...onboardingWorkflow,
    steps: onboardingWorkflow.steps.map(([group, entries]) => [group.key === "i9-creation"
      ? { ...group, review: { pages: [], branchLabels } } : group, entries] as const) });
  assert.throws(() => compile([]), /omits branch outcome i9-route\//u);
  assert.throws(() => compile([{ nodeId: "i9-route", outcome: "create", label: "Create the I-9 record." }]), /omits branch outcome i9-route\/existing/u);
  assert.doesNotThrow(() => compile([
    { nodeId: "i9-route", outcome: "create", label: "Create the I-9 record." },
    { nodeId: "i9-route", outcome: "existing", label: "Reuse the existing I-9 record." },
  ]));
});
