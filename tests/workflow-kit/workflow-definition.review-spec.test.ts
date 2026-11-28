import assert from "node:assert/strict";
import { it } from "vitest";
import { z } from "zod";
import { SearchPersonOrg } from "../../src/models/systems/ucpath/search-person-org.js";
import { WorkflowStepReviewSchema, type WorkflowStepReview } from "../../src/models/workflow/review-spec.js";
import { compileWorkflow } from "../../src/workflow-kit/workflow-definition.js";
import { personLookupWorkflow } from "../../src/workflows/person-lookup/workflow.js";
import { onboardingWorkflow } from "../../src/workflows/onboarding/workflow.js";
import { separationsWorkflow } from "../../src/workflows/separations/workflow.js";
import { i9CheckStartWorkflow } from "../../src/workflows/i9-check-start/workflow.js";
import { i9CheckWorkflow } from "../../src/workflows/i9-check/workflow.js";
import { createSearchWorkflowDefinitionFixtures } from "../support/helpers/search-workflow-definition-fixtures.js";

const review = Object.freeze({ pages: Object.freeze([Object.freeze({
  id: "employee-search", title: "Employee search", mode: "Read only" as const, nodeIds: ["searching", "matching", "search-identity"],
  lines: [{ id: "search", kind: "action" as const, text: "Search for the requested person.", nodeIds: ["searching"] }],
  fields: [{ id: "employee-id", operatorField: "Employee ID", source: { origin: "UCPath", detail: "Read the returned employee ID.",
    read: { stepKey: "searching", page: "Employee search", field: "Employee ID" }, chain: [] } }],
})]), branchLabels: Object.freeze([]) }) satisfies WorkflowStepReview;

function compileReview(candidate: WorkflowStepReview) {
  return compileWorkflow({ ...personLookupWorkflow, steps: personLookupWorkflow.steps.map(([group, entries]) =>
    [{ ...group, review: group.key === "searching" ? candidate : undefined }, entries] as const) });
}

it("validates starts against a real delegate in its own step and requires one scope phrase", () => {
  const compile = (starts: WorkflowStepReview["starts"]) => compileWorkflow({ ...i9CheckStartWorkflow,
    steps: i9CheckStartWorkflow.steps.map(([group, entries]) => {
      assert.ok(group.review);
      return [{ ...group, review: group.key === "documents" ? { ...group.review, starts } : group.review }, entries] as const;
    }) });
  const start = { nodeId: "read-documents", each: "Each attached PDF" };
  assert.doesNotThrow(() => compile([start]));
  assert.throws(() => compile([{ ...start, nodeId: "read-people" }]), /requires a child-run source/u);
  assert.throws(() => compile([{ ...start, nodeId: "check-people" }]), /unknown or outside node/u);
  assert.throws(() => compile([start, start]), /repeats started workflow/u);
  assert.equal(WorkflowStepReviewSchema.safeParse({ pages: [], branchLabels: [], starts: [{ ...start, each: "" }] }).success, false);
});

it("accepts a declared blank retention action with words and conditional continuing initials, and rejects invented values", () => {
  const compile = (edit: (review: WorkflowStepReview) => WorkflowStepReview) => compileWorkflow({ ...i9CheckWorkflow,
    steps: i9CheckWorkflow.steps.map(([group, entries]) => {
      assert.ok(group.review);
      return [{ ...group, review: group.key === "roster-match" ? edit(group.review) : group.review }, entries] as const;
    }) });
  assert.doesNotThrow(() => compile(candidate => candidate));
  assert.throws(() => compile(candidate => ({ ...candidate, decisions: candidate.decisions?.map(decision =>
    decision.id === "retention-action" ? { ...decision, initial: { by: "retention-identity", values: { ambiguous: "invented" }, otherwise: "Keep" } } : decision) })), /not one of its continuing outcomes/u);
  assert.throws(() => compile(candidate => ({ ...candidate, decisions: candidate.decisions?.map(decision =>
    decision.id === "retention-action" ? { ...decision, outcomes: [...decision.outcomes, { value: "invented", label: "Invented" }] } : decision) })), /never holds/u);
});

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
    steps: onboardingWorkflow.steps.map(([group, entries]) => {
      if (group.key !== "i9-creation") return [group, entries] as const;
      assert.ok(group.review);
      return [{ ...group, review: { ...group.review, branchLabels } }, entries] as const;
    }) });
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
    constant: { nodeIds: ["receipt"], value: true }, source: input.source }] }] }), /outside page/u);
  assert.equal(WorkflowStepReviewSchema.safeParse({ ...candidate, pages: [{ ...page, fields: [{ ...input, transactionFields: [{ nodeId: "file-termination", kind: "input", fieldPath: "template", extra: true }] }] }] }).success, false);
});

it("validates run input rows, task input rows, click lines and declared decisions against the definition", () => {
  const page = review.pages[0]; assert.ok(page);
  const source = { origin: "Run input", detail: "The name entered when the run starts.", chain: [] };
  const candidate = (fields: WorkflowStepReview["pages"][number]["fields"], decisions?: WorkflowStepReview["decisions"]) => ({ ...review,
    pages: [{ ...page, lines: [{ id: "search", kind: "click" as const, target: "Search", nodeIds: ["searching"] }], fields }], ...(decisions === undefined ? {} : { decisions }) });
  assert.doesNotThrow(() => compileReview(candidate([{ id: "name", label: "Name", example: "Morrow, Bea", inputField: "name", source },
    { id: "query", label: "Query", taskFields: [{ nodeId: "searching", kind: "input", fieldPath: "kind" }], source }])));
  assert.throws(() => compileReview(candidate([{ id: "name", label: "Name", inputField: "missingField", source }])), /schema field missingField/u);
  assert.throws(() => compileReview(candidate([{ id: "query", label: "Query", taskFields: [{ nodeId: "active-status", kind: "input", fieldPath: "input" }], source }])), /unknown or outside node/u);
  assert.throws(() => compileReview(candidate([{ id: "query", label: "Query", taskFields: [{ nodeId: "searching", kind: "output", fieldPath: "missingField" }], source }])), /schema field missingField/u);
  const found = { value: "resolved", label: "One person found" }, missing = { value: "not-found", label: "Nobody found", then: "The run ends as Not found." };
  const decision = { id: "search-result", label: "Search result", reads: { nodeId: "search-identity", fieldPath: "state" }, nodeIds: ["searching"], initial: "resolved",
    outcomes: [found, missing] };
  assert.doesNotThrow(() => compileReview(candidate([], [decision])));
  assert.throws(() => compileReview(candidate([], [{ ...decision, reads: { nodeId: "search-identity", fieldPath: "candidateEids" } }])), /no closed set of values/u);
  assert.throws(() => compileReview(candidate([], [{ ...decision, outcomes: [...decision.outcomes, { value: "sideways", label: "Sideways" }] }])), /never holds/u);
  assert.throws(() => compileReview(candidate([], [{ ...decision, initial: "not-found", outcomes: [found, { ...missing, stops: true as const }] }])), /not one of its continuing outcomes/u);
  const failure = "PERSON_LOOKUP_UCPATH_SEARCH_FAILED";
  assert.doesNotThrow(() => compileReview(candidate([], [{ ...decision,
    initial: { by: "mode", values: { match: failure }, otherwise: "resolved" } }])));
  assert.throws(() => compileReview(candidate([], [{ ...decision, initial: failure }])), /not one of its continuing outcomes/u);
  assert.throws(() => compileReview(candidate([], [{ ...decision,
    initial: { by: "mode", values: { match: "ONBOARDING_WRITE_REVIEW_REFUSED" }, otherwise: "resolved" } }])), /not one of its continuing outcomes/u);
  assert.throws(() => compileReview(candidate([], [{ ...decision,
    initial: { by: "mode", values: { match: failure }, otherwise: failure } }])), /not one of its continuing outcomes/u);
  assert.throws(() => compileReview(candidate([], [{ ...decision, outcomes: [found, { value: "not-found", label: "Nobody found", stops: true as const }] }])), /without saying what the run does/u);
  assert.throws(() => compileReview(candidate([], [{ ...decision, nodeIds: ["active-status"] }])), /unknown or outside node/u);
});
