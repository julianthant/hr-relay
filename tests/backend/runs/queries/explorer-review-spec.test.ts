import assert from "node:assert/strict";
import { it } from "vitest";
import { buildWorkflowExplorer } from "../../../../src/backend/runs/queries/explorer.js";
import { buildExplorerReviewSpec } from "../../../../src/backend/runs/queries/explorer-review-spec.js";
import { READABLE_WORKFLOW_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import { ExplorerWorkflowWireSchema, type ExplorerNodeWire } from "../../../../src/models/dashboard/explorer.js";
import { failureCodeFromTaskCode, operatorFailureSentence } from "../../../../src/models/failures/error-catalog.js";
import type { WorkflowStepReview } from "../../../../src/models/workflow/review-spec.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { compileWorkflow, composeWorkflowModule } from "../../../../src/workflow-kit/workflow-definition.js";
import { personLookupWorkflow } from "../../../../src/workflows/person-lookup/workflow.js";
import { explorerQueryDeps } from "../../../support/fixtures/explorer-seams.js";

const clock = manualClock(new Date("2026-08-09T12:00:00.000Z"));
const hash = FingerprintSchema.parse("c".repeat(64));
function workflows() { return buildWorkflowExplorer(explorerQueryDeps(clock, hash)).workflows; }

it("serves every readable definition with exact ordered steps and declared failure outcomes", () => {
  const entries = workflows();
  assert.equal(entries.length, 12);
  assert.deepEqual(entries.map(entry => entry.id), READABLE_WORKFLOW_MODULES.map(module => module.descriptor.id));
  for (const entry of entries) {
    const review = entry.reviewSpec;
    assert.equal(review.unlistedFailure, "Anything not listed stops the run with a failure card");
    assert.deepEqual(review.steps.map(step => step.id), entry.timeline.map(group => group.key));
    for (const node of entry.nodes) for (const task of node.tasks) for (const code of task.errorCodes) {
      const decisions = review.steps.flatMap(step => step.decisions).filter(decision => decision.kind === "failure"
        && decision.nodeId === node.id && decision.taskId === task.taskId && decision.outcome === code);
      assert.equal(decisions.length, 1, `${entry.id}/${node.id}/${task.taskId}/${code}`);
      assert.equal(decisions[0]?.action, "stop");
      assert.equal(decisions[0]?.failureCode, failureCodeFromTaskCode(code));
      assert.deepEqual(decisions[0]?.label, { state: "authored", text: operatorFailureSentence(failureCodeFromTaskCode(code)) });
    }
  }
});

it("derives visible controls, mode defaults, upload facts and omission forms", () => {
  const entries = workflows();
  const lookup = entries.find(entry => entry.id === "person-lookup"); assert.ok(lookup);
  assert.deepEqual(lookup.reviewSpec.runOptions.controls.map(control => control.field), ["crmCheck", "includeCrmDates"]);
  assert.deepEqual(lookup.reviewSpec.runOptions.mode?.options.map(mode => mode.value), ["search", "match"]);
  assert.equal(lookup.reviewSpec.runOptions.mode?.options.some(mode => mode.defaults.some(field => field.field === "keepNonHdh")), false);
  const onboarding = entries.find(entry => entry.id === "onboarding"); assert.ok(onboarding);
  assert.equal(onboarding.reviewSpec.runOptions.mode?.initial, null);
  assert.deepEqual(onboarding.reviewSpec.runOptions.controls, []);
  const separations = entries.find(entry => entry.id === "separations"); assert.ok(separations);
  assert.deepEqual(separations.reviewSpec.runOptions.omittableSteps.map(step => step.stepKey), ["kronos-timecard", "ucpath-transaction", "kuali-finalization"]);
  assert.ok(separations.reviewSpec.runOptions.omittableSteps.every(step => step.form.fields.length > 0));
  const pdfs = entries.find(entry => entry.id === "i9-check-start"); assert.ok(pdfs);
  assert.ok(pdfs.reviewSpec.runOptions.upload?.accepts.some(accept => accept.mediaType === "application/pdf"));
  const page = entries.find(entry => entry.id === "ocr-page"); assert.ok(page);
  assert.deepEqual(page.reviewSpec.runOptions.start, { input: false, upload: false, emptyOpensUpload: false });
  assert.deepEqual(page.reviewSpec.runOptions.controls, []);
  assert.equal(page.reviewSpec.runOptions.mode, undefined);
});

it("reports declared session scope and preparation without claiming observed sessions or locks", () => {
  const entries = workflows();
  const lookup = entries.find(entry => entry.id === "person-lookup"); assert.ok(lookup);
  const direct = lookup.reviewSpec.sessionStep.requirements;
  assert.ok(direct.some(requirement => requirement.need.system === "ucpath"));
  assert.ok(direct.every(requirement => requirement.scope === "direct" && requirement.delegationPath.length === 0
    && requirement.preparation === "before-owning-workflow-claim" && requirement.useTiming === "when-step-runs"));
  const ocr = entries.find(entry => entry.id === "ocr"); assert.ok(ocr);
  const delegated = ocr.reviewSpec.sessionStep.requirements;
  assert.ok(delegated.some(requirement => requirement.workflowId === "person-lookup"));
  assert.ok(delegated.every(requirement => requirement.scope === "delegated" && requirement.delegationPath.length > 0
    && requirement.useTiming === "when-delegated-step-runs"));
  const onbase = entries.find(entry => entry.id === "onbase"); assert.ok(onbase);
  assert.ok(onbase.reviewSpec.sessionStep.requirements.length > 0);
  assert.ok(onbase.reviewSpec.sessionStep.requirements.every(requirement => requirement.need.exclusive === true && requirement.lock === "exclusive-required"));
  const page = entries.find(entry => entry.id === "ocr-page"); assert.ok(page);
  assert.deepEqual(page.reviewSpec.sessionStep.requirements, []);
  assert.ok(entries.every(entry => entry.reviewSpec.sessionStep.unavailableDelegations.length === 0));
  for (const requirement of [...direct, ...delegated]) {
    assert.equal("sessionId" in requirement, false);
    assert.equal("health" in requirement, false);
    assert.equal("acquired" in requirement, false);
  }
  const deps = explorerQueryDeps(clock, hash);
  const isolated = buildWorkflowExplorer({ ...deps, modules: deps.modules.filter(module => module.descriptor.id === "ocr") });
  assert.deepEqual(isolated.workflows[0]?.reviewSpec.sessionStep.unavailableDelegations.map(child => child.workflowId), ["ocr-page", "person-lookup", "i9-lookup"]);
});

it("preserves transaction, delegated failure and conditional review policies", () => {
  const entries = workflows();
  const ocr = entries.find(entry => entry.id === "ocr"); assert.ok(ocr);
  const approval = ocr.reviewSpec.steps.flatMap(step => step.decisions).filter(decision => decision.nodeId === "approve-records");
  assert.deepEqual(approval.map(decision => [decision.outcome, decision.action]), [["waiting", "ask"], ["resolved", "continue"], ["skipped", "continue"]]);
  const module = READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === "ocr"); assert.ok(module);
  const automatic = buildExplorerReviewSpec(module, READABLE_WORKFLOW_MODULES, ocr.nodes.map((node): ExplorerNodeWire => node.id === "approve-records"
    ? { ...node, shape: { kind: "gate", resolvedBy: "children-terminal" } } : node));
  assert.equal(automatic.steps.flatMap(step => step.decisions).find(decision => decision.nodeId === "approve-records" && decision.outcome === "waiting")?.action, "continue");
  const emergency = entries.find(entry => entry.id === "emergency-contact"); assert.ok(emergency);
  const decisions = emergency.reviewSpec.steps.flatMap(step => step.decisions);
  assert.equal(decisions.find(decision => decision.nodeId === "read-document" && decision.outcome === "child-failed")?.action, "stop");
  assert.equal(decisions.find(decision => decision.nodeId === "members" && decision.outcome === "child-failed")?.action, "continue");
  assert.equal(decisions.find(decision => decision.nodeId === "members" && decision.outcome === "child-retried")?.action, "ask");
  const onbase = entries.find(entry => entry.id === "onbase"); assert.ok(onbase);
  assert.deepEqual(onbase.reviewSpec.steps.flatMap(step => step.decisions).filter(decision => decision.nodeId === "import-document" && decision.kind === "transaction")
    .map(decision => [decision.outcome, decision.action]), [["committed", "continue"], ["already-present", "continue"], ["unknown", "ask"], ["dry-run", "continue"]]);
});

it("projects ordered source drawers and field vocabularies from compiled declarations", () => {
  const review = { pages: [{ id: "search", title: "Employee search", mode: "Read only", nodeIds: ["searching", "matching", "search-identity"],
    lines: [{ id: "read", kind: "read", text: "Read the selected employee ID.", nodeIds: ["search-identity"] }],
    fields: [{ id: "employee-id", operatorField: "Employee ID", source: { origin: "UCPath", detail: "Read the returned ID.",
      read: { stepKey: "searching", page: "Employee search", field: "Employee ID" },
      chain: [{ label: "Requested person", detail: "The operator supplies the search input." }] } }],
  }], branchLabels: [] } satisfies WorkflowStepReview;
  const definition = { ...personLookupWorkflow, steps: personLookupWorkflow.steps.map(([group, entries], index) =>
    [index === 0 ? { ...group, review } : group.key === "active-status" ? { ...group, review: { pages: [{
      id: "status", title: "Computed status", mode: "Read only" as const, nodeIds: ["active-status"], lines: [],
      fields: [{ id: "employment", operatorField: "Employment status", source: { origin: "Person Lookup", detail: "Derived from the verified reads.", chain: [] } }],
    }], branchLabels: [] } } : group, entries] as const) };
  const deps = explorerQueryDeps(clock, hash);
  const original = deps.modules.find(module => module.descriptor.id === "person-lookup"); assert.ok(original);
  const module = composeWorkflowModule(compileWorkflow(definition), original.stores);
  const wire = buildWorkflowExplorer({ ...deps, modules: [module] }).workflows[0]; assert.ok(wire);
  const pages = wire.reviewSpec.steps[0]?.pages; assert.ok(pages?.state === "authored");
  assert.deepEqual(pages.items.map(page => page.title), ["Employee search"]);
  assert.deepEqual(pages.items[0]?.lines, review.pages[0].lines);
  assert.deepEqual(pages.items[0]?.fields[0]?.source, review.pages[0].fields[0].source);
  assert.deepEqual(pages.items[0]?.fields[0]?.sources, definition.steps[0]?.[0].operatorFields?.find(field => field.label === "Employee ID")?.sources);
  const status = wire.reviewSpec.steps.find(step => step.id === "active-status")?.pages; assert.ok(status?.state === "authored");
  assert.deepEqual(status.items[0]?.fields[0]?.options, ["Active", "Inactive", "CRM only", "Multiple matches", "Not found", "Undetermined", "Found", "Not found in UCPath"]);
  const unavailable = buildWorkflowExplorer({ ...deps, modules: [{ ...original, definition: undefined }] }).workflows[0]; assert.ok(unavailable);
  assert.ok(unavailable.reviewSpec.steps.every(step => step.pages.state === "unavailable"));
});

it("rejects missing or forged declared outcomes and unknown nested wire fields without throwing", () => {
  const entry = workflows().find(workflow => workflow.id === "person-lookup"); assert.ok(entry);
  const [step, ...rest] = entry.reviewSpec.steps; assert.ok(step);
  const failure = step.decisions.find(decision => decision.kind === "failure"); assert.ok(failure);
  const candidate = (decisions: typeof step.decisions) => ({ ...entry, reviewSpec: { ...entry.reviewSpec, steps: [{ ...step, decisions }, ...rest] } });
  assert.equal(ExplorerWorkflowWireSchema.safeParse(candidate(step.decisions.filter(decision => decision.id !== failure.id))).success, false);
  assert.equal(ExplorerWorkflowWireSchema.safeParse(candidate(step.decisions.map(decision => decision.id === failure.id ? { ...decision, action: "continue" } : decision))).success, false);
  assert.equal(ExplorerWorkflowWireSchema.safeParse(candidate(step.decisions.map(decision => decision.id === failure.id ? { ...decision, outcome: "invalid failure !" } : decision))).success, false);
  assert.equal(ExplorerWorkflowWireSchema.safeParse({ ...entry, reviewSpec: { ...entry.reviewSpec, sessionStep: { ...entry.reviewSpec.sessionStep, acquired: true } } }).success, false);
  assert.equal(ExplorerWorkflowWireSchema.safeParse({ ...entry, reviewSpec: { ...entry.reviewSpec, steps: rest } }).success, false);
});
