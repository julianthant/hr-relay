import assert from "node:assert/strict";
import { it } from "vitest";
import { z } from "zod";
import { SearchPersonOrg } from "../../src/models/systems/ucpath/search-person-org.js";
import { WorkflowStepReviewSchema, type WorkflowStepReview } from "../../src/models/workflow/review-spec.js";
import { compileWorkflow } from "../../src/workflow-kit/workflow-definition.js";
import { personLookupWorkflow } from "../../src/workflows/person-lookup/workflow.js";
import { onboardingWorkflow } from "../../src/workflows/onboarding/workflow.js";
import { separationsWorkflow } from "../../src/workflows/separations/workflow.js";
import { createSearchWorkflowDefinitionFixtures } from "../support/helpers/search-workflow-definition-fixtures.js";

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

it("freezes nested review data when the authored review is already shallow-frozen", () => {
  const authoredReview = Object.freeze({ pages: [{ id: "search", title: "Employee search", mode: "Read only", nodeIds: ["search"],
    lines: [{ id: "read", kind: "read", text: "Read the requested search kind.", nodeIds: ["search"] }],
    fields: [{ id: "kind", operatorField: "Search kind", source: { origin: "Run input", detail: "The requested search kind.",
      chain: [{ label: "Requested kind", detail: "Use the admitted input.", read: { stepKey: "search", page: "Employee search", field: "Search kind" } }] } }],
  }], branchLabels: [] } satisfies WorkflowStepReview);
  assert.equal(Object.isFrozen(authoredReview), true);
  assert.equal(Object.isFrozen(authoredReview.pages), false);
  const { fixtureWorkflow, lookupInput } = createSearchWorkflowDefinitionFixtures();
  const definition = fixtureWorkflow("review-freeze", author => {
    const search = author.task({ id: "search", contract: SearchPersonOrg, replay: "checkpoint" }, [], lookupInput);
    return { steps: [[{ key: "search", label: "Search", review: authoredReview, operatorFields: [
      { label: "Search kind", sources: [{ nodeId: "search", kind: "input", fieldPath: "kind" }] },
    ] }, [search]]], result: author.result(z.strictObject({ state: z.literal("done") }), [], () => ({ state: "done" as const })) };
  });
  assert.doesNotThrow(() => compileWorkflow(definition));
  const frozen = definition.steps[0]?.[0].review; assert.ok(frozen);
  const page = frozen.pages[0]; assert.ok(page);
  const field = page.fields[0]; assert.ok(field);
  const link = field.source.chain[0]; assert.ok(link?.read);
  for (const value of [definition, definition.steps[0]?.[0], frozen, frozen.pages, page, page.nodeIds, page.lines,
    page.fields, field, field.source, field.source.chain, link, link.read, frozen.branchLabels]) assert.equal(Object.isFrozen(value), true);
  assert.equal(Reflect.set(page.nodeIds, "0", "changed"), false);
  assert.equal(Reflect.set(field.source, "detail", "changed"), false);
  assert.equal(Reflect.set(link.read, "field", "changed"), false);
  assert.equal(page.nodeIds[0], "search");
  assert.equal(field.source.detail, "The requested search kind.");
  assert.equal(link.read.field, "Search kind");
});

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

it("validates transaction input, staged-output, constant and clickable source references", () => {
  const candidate = { pages: [{ id: "wizard", title: "Wizard", mode: "Fill form", nodeIds: ["file-termination"], lines: [], fields: [
    { id: "template", label: "Template", transactionFields: [{ nodeId: "file-termination", kind: "input", fieldPath: "template" }],
      source: { origin: "Termination type", detail: "The resolved template.", chain: [], read: { stepKey: "ucpath-transaction", page: "Wizard", field: "Template" } } },
    { id: "override", label: "Override", transactionFields: [{ nodeId: "file-termination", kind: "output", fieldPath: "lastDateWorkedOverridden" }],
      source: { origin: "Workflow rule", detail: "The staged checkbox state.", chain: [] } },
    { id: "fixed", label: "Fixed choice", constant: { nodeIds: ["file-termination"], value: true },
      source: { origin: "Workflow rule", detail: "The declared fixed choice.", chain: [] } },
  ] }], branchLabels: [] } satisfies WorkflowStepReview;
  const compile = (review: WorkflowStepReview) => compileWorkflow({ ...separationsWorkflow,
    steps: separationsWorkflow.steps.map(([group, entries]) => [{ ...group, review: group.key === "ucpath-transaction" ? review : undefined }, entries] as const) });
  assert.doesNotThrow(() => compile(candidate));
  const page = candidate.pages[0], input = page.fields[0];
  for (const transactionFields of [
    [{ nodeId: "receipt", kind: "input" as const, fieldPath: "proof" }],
    [{ nodeId: "file-termination", kind: "input" as const, fieldPath: "missingField" }],
    [{ nodeId: "clear-pending", kind: "input" as const, fieldPath: "emplId" }],
  ]) assert.throws(() => compile({ ...candidate, pages: [{ ...page, fields: [{ ...input, transactionFields }] }] }), /transaction|schema field|outside page/u);
  assert.throws(() => compile({ ...candidate, pages: [{ ...page, nodeIds: ["receipt"], fields: [{ ...input,
    transactionFields: [{ nodeId: "receipt", kind: "input", fieldPath: "proof" }] }] }] }), /requires a transaction source/u);
  assert.throws(() => compile({ ...candidate, pages: [{ ...page, fields: [{ id: "fixed", label: "Fixed choice",
    constant: { nodeIds: ["clear-pending"], value: true }, source: input.source }] }] }), /outside page/u);
  assert.equal(WorkflowStepReviewSchema.safeParse({ ...candidate, pages: [{ ...page, fields: [{ ...input, transactionFields: [{ nodeId: "file-termination", kind: "input", fieldPath: "template", extra: true }] }] }] }).success, false);
});
