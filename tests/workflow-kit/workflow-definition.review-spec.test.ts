import assert from "node:assert/strict";
import { it } from "vitest";
import { WorkflowStepReviewSchema, type WorkflowStepReview } from "../../src/models/workflow/review-spec.js";
import { compileWorkflow } from "../../src/workflow-kit/workflow-definition.js";
import { personLookupWorkflow } from "../../src/workflows/person-lookup/workflow.js";

const review = Object.freeze({ pages: Object.freeze([Object.freeze({
  id: "employee-search", title: "Employee search", mode: "Read only" as const, nodeIds: ["searching", "matching", "search-identity"],
  lines: [{ id: "search", kind: "action" as const, text: "Search for the requested person.", nodeIds: ["searching"] }],
  fields: [{ id: "employee-id", operatorField: "Employee ID", source: { origin: "UCPath", detail: "Read the returned employee ID.",
    read: { stepKey: "searching", page: "Employee search", field: "Employee ID" }, chain: [] } }],
})]), branchLabels: Object.freeze([]) }) satisfies WorkflowStepReview;

function compileReview(candidate: WorkflowStepReview) {
  return compileWorkflow({ ...personLookupWorkflow, steps: personLookupWorkflow.steps.map(([group, entries], index) =>
    [index === 0 ? { ...group, review: candidate } : group, entries] as const) });
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
  assert.throws(() => compileReview({ ...review, branchLabels: [{ nodeId: "searching", outcome: "missing", label: "Missing" }] }), /unknown branch outcome/u);
});

it("rejects unknown review metadata and preserves explicit local steps with no pages", () => {
  assert.equal(WorkflowStepReviewSchema.safeParse({ ...review, extra: true }).success, false);
  const page = review.pages[0]; assert.ok(page);
  assert.equal(WorkflowStepReviewSchema.safeParse({ ...review, pages: [{ ...page, mode: "guess" }] }).success, false);
  assert.equal(WorkflowStepReviewSchema.safeParse({ ...review, pages: [{ ...page, fields: [{ ...page.fields[0], extra: true }] }] }).success, false);
  assert.doesNotThrow(() => compileReview({ pages: [], branchLabels: [] }));
});
