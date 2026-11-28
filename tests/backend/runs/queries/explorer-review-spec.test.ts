import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "vitest";
import ts from "typescript";
import { READABLE_WORKFLOW_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import { ExplorerWorkflowWireSchema, type ExplorerWorkflowWire } from "../../../../src/models/dashboard/explorer.js";
import { ExplorerReviewSpecSchema, type ExplorerReviewSpec } from "../../../../src/models/dashboard/explorer-review-spec.js";
import { failureCodeFromTaskCode, operatorFailureSentence } from "../../../../src/models/failures/error-catalog.js";
import { isUnlistedStorageFailure, operatorFailureLabel } from "../../../../src/models/failures/failure-labels.js";
import { contractSchemaLeaves } from "../../../../src/models/validation/contract-boundary.js";
import { WorkflowStepReviewSchema } from "../../../../src/models/workflow/review-spec.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { compileWorkflow, composeWorkflowModule } from "../../../../src/workflow-kit/workflow-definition.js";
import { personLookupWorkflow } from "../../../../src/workflows/person-lookup/workflow.js";
import { onboardingWorkflow } from "../../../../src/workflows/onboarding/workflow.js";
import { explorerQueryDeps, readFixtureExplorer } from "../../../support/fixtures/explorer-seams.js";

const clock = manualClock(new Date("2026-08-09T12:00:00.000Z"));
const hash = FingerprintSchema.parse("c".repeat(64));
function workflows() { return readFixtureExplorer(explorerQueryDeps(clock, hash)).workflows; }
function workflow(id: string): ExplorerWorkflowWire { const found = workflows().find(entry => entry.id === id); assert.ok(found, id); return found; }
const decisions = (spec: ExplorerReviewSpec) => spec.steps.flatMap(step => step.blocks.flatMap(block => block.kind === "decision" ? [block] : []));
type Decision = ReturnType<typeof decisions>[number];
const decision = (spec: ExplorerReviewSpec, id: string): Decision => { const found = decisions(spec).find(block => block.id === id); assert.ok(found, id); return found; };

it("serves every readable definition with its ordered steps and every declared task failure as a stopping outcome", () => {
  const entries = workflows();
  assert.deepEqual(entries.map(entry => entry.id), READABLE_WORKFLOW_MODULES.map(module => module.descriptor.id));
  for (const entry of entries) {
    const review = entry.reviewSpec;
    assert.equal(review.unlistedFailure, "Anything not listed stops the run with a failure card.");
    assert.deepEqual(review.steps.map(step => [step.id, step.title]), entry.timeline.map(group => [group.key, group.label]));
    for (const [index, group] of entry.timeline.entries()) for (const node of entry.nodes.filter(candidate => group.nodes.includes(candidate.id))) {
      const declaration = READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === entry.id)?.definition.steps.find(([step]) => step.key === group.key)?.[0];
      for (const task of node.tasks) for (const code of task.errorCodes) {
        if (isUnlistedStorageFailure(failureCodeFromTaskCode(code))) continue;
        const outcomes = review.steps[index]?.blocks.flatMap(block => block.kind === "decision" ? block.outcomes : []).filter(outcome => outcome.value === code) ?? [];
        assert.ok(outcomes.length > 0, `${entry.id}/${node.id}/${code}`);
        for (const outcome of outcomes) assert.deepEqual([outcome.label, outcome.then, outcome.stops],
          [operatorFailureLabel(failureCodeFromTaskCode(code)), `${operatorFailureSentence(failureCodeFromTaskCode(code))} ${declaration?.review?.outcomes?.find(outcome => outcome.value === code)?.then ?? "The run stops with a failure card."}`, true], `${entry.id}/${node.id}/${code}`);
      }
    }
    assert.ok(decisions(review).every(block => block.outcomes.every(outcome => outcome.label !== "Anything else")), entry.id);
  }
});

it("derives run options from Start run declarations only", () => {
  assert.deepEqual(workflow("onboarding").reviewSpec.options.map(option => [option.id, option.label, option.initial]),
    [["mode", "Hire mode", "new-hire"], ["dry-run", "Dry run", "false"],
      ["skip-reference-check", "Reference spreadsheets", "run"],
      ["skip-crm-data", "Read and validate hire data", "run"], ["skip-ucpath-search", "Check UCPath duplicates", "run"],
      ["skip-i9-search", "Search I-9 profiles", "run"], ["skip-hire-review", "Review UCPath hire findings", "run"],
      ["skip-i9-creation", "Create or reuse the I-9 record", "run"],
      ["skip-ucpath-hire", "File and verify the UCPath hire", "run"], ["skip-master-results", "Fill verified master results", "run"]]);
  assert.deepEqual(workflow("work-study").reviewSpec.options.map(option => option.id), ["dry-run", "skip-ucpath-auth", "skip-transaction"]);
  assert.deepEqual(workflow("ocr-page").reviewSpec.options, []);
  const separations = workflow("separations").reviewSpec;
  assert.deepEqual(separations.options.filter(option => option.id.startsWith("skip-")).map(option => [option.id, option.label, option.initial]),
    [["skip-kuali-extraction", "Kuali extraction", "run"], ["skip-identity-check", "Identity check", "run"],
      ["skip-kronos-timecard", "Kronos timecard", "run"], ["skip-identity-review", "Identity approval", "run"],
      ["skip-pending-termination", "Pending terminations", "run"], ["skip-ucpath-transaction", "UCPath transaction", "run"],
      ["skip-kuali-finalization", "Kuali finalization", "run"]]);
  assert.deepEqual(separations.steps.find(step => step.id === "kronos-timecard")?.when, [{ "skip-kronos-timecard": ["run"] }]);
  assert.deepEqual(separations.sessions.find(session => session.system === "new-kronos")?.when, [{ "skip-kronos-timecard": ["run"] }]);
  const lookup = workflow("person-lookup").reviewSpec;
  assert.equal(lookup.options.some(option => option.id === "keepNonHdh"), false);
});

it("serves session chips for delegated runs from the delegating step", () => {
  assert.deepEqual(workflow("ocr").reviewSpec.sessions.map(session => session.system), ["ucpath", "crm", "i9"]);
  assert.deepEqual(workflow("ocr-page").reviewSpec.sessions, []);
  assert.deepEqual(workflow("onbase").reviewSpec.sessions, [{
    system: "onbase", when: [{ "skip-source-page": ["run"] }, { "skip-import-document": ["run"] }],
  }]);
  const deps = explorerQueryDeps(clock, hash);
  assert.throws(() => readFixtureExplorer({ ...deps, modules: deps.modules.filter(module => module.descriptor.id === "ocr") }), /absent from the catalog/u);
});

it("lists only outcomes that change the flow, ask the operator or stop the run", () => {
  const ocr = workflow("ocr").reviewSpec;
  assert.deepEqual(decision(ocr, "approve-records").outcomes.map(outcome => [outcome.value, outcome.stops]), [["waits", false], ["cancelled", true]]);
  const emergency = workflow("emergency-contact").reviewSpec;
  assert.deepEqual(decision(emergency, "read-document").outcomes.map(outcome => [outcome.value, outcome.stops]), [["succeeded", false], ["child-failed", true]]);
  assert.deepEqual(decision(emergency, "members").outcomes.map(outcome => [outcome.value, outcome.stops]), [["succeeded", false], ["child-failed", false]]);
  const onbase = workflow("onbase").reviewSpec;
  const save = decision(onbase, "import-document");
  assert.deepEqual(save.initial, { by: "dry-run", values: { true: "dry-run" }, otherwise: "saved" });
  assert.deepEqual(save.outcomes.slice(0, 4).map(outcome => [outcome.value, outcome.stops, outcome.when]),
    [["saved", false, [{ "dry-run": ["false"] }]], ["already-present", false, undefined],
      ["unconfirmed", true, [{ "dry-run": ["false"] }]], ["dry-run", false, [{ "dry-run": ["true"] }]]]);
  const onboarding = workflow("onboarding").reviewSpec;
  assert.deepEqual(decision(onboarding, "i9-route").outcomes.map(outcome => outcome.value), ["create", "existing"]);
});

it("derives sample values from contract examples and follows a decision's outcome where a row reads the same output", () => {
  const lookup = workflow("person-lookup").reviewSpec;
  const rows = lookup.steps.flatMap(step => step.blocks.flatMap(block => block.kind === "card" ? block.rows : []));
  assert.ok(rows.every(row => row.value !== undefined));
  const status = rows.find(row => row.label === "Employment status"); assert.ok(status);
  assert.deepEqual(status.value, { by: "employment-status", otherwise: "Active", values: { active: "Active", inactive: "Inactive", "crm-only": "CRM only",
    "multiple-matches": "Multiple matches", "not-found": "Not found", undetermined: "Undetermined" } });
});

it("rejects forged gates, values, initial outcomes and missing failures without throwing", () => {
  const entry = workflow("person-lookup");
  const spec = entry.reviewSpec;
  const first = spec.steps.find(step => step.id === "searching"); assert.ok(first);
  const withFirst = (step: typeof first) => ({ ...spec, steps: spec.steps.map(candidate => candidate === first ? step : candidate) });
  assert.equal(ExplorerReviewSpecSchema.safeParse(spec).success, true);
  assert.equal(ExplorerReviewSpecSchema.safeParse(withFirst({ ...first, when: [{ unknown: ["x"] }] })).success, false);
  assert.equal(ExplorerReviewSpecSchema.safeParse(withFirst({ ...first, when: [{ mode: ["sideways"] }] })).success, false);
  assert.equal(ExplorerReviewSpecSchema.safeParse(withFirst({ ...first, when: [{ "search-result": ["resolved"] }] })).success, false);
  const withBlocks = (blocks: typeof first.blocks) => withFirst({ ...first, blocks });
  // A step's cards may follow its own decision; a decision may not follow itself.
  assert.equal(ExplorerReviewSpecSchema.safeParse(withBlocks(first.blocks.map(block => block.kind === "card" ? { ...block, when: [{ "search-result": ["not-found"] }] } : block))).success, true);
  assert.equal(ExplorerReviewSpecSchema.safeParse(withBlocks(first.blocks.map(block => block.kind === "decision" ? { ...block, when: [{ "search-result": ["not-found"] }] } : block))).success, false);
  assert.equal(ExplorerReviewSpecSchema.safeParse(withBlocks(first.blocks.map(block => block.kind === "decision" ? { ...block, initial: "PERSON_LOOKUP_UCPATH_SEARCH_FAILED" } : block))).success, false);
  assert.equal(ExplorerReviewSpecSchema.safeParse(withBlocks(first.blocks.map(block => block.kind === "decision" ? { ...block,
    initial: { by: "mode", values: { match: "PERSON_LOOKUP_UCPATH_SEARCH_FAILED" }, otherwise: "resolved" } } : block))).success, true);
  assert.equal(ExplorerReviewSpecSchema.safeParse(withBlocks(first.blocks.map(block => block.kind === "decision" ? { ...block,
    initial: { by: "mode", values: { match: "FORGED_FAILURE" }, otherwise: "resolved" } } : block))).success, false);
  assert.equal(ExplorerReviewSpecSchema.safeParse(withBlocks(first.blocks.map(block => block.kind === "decision" ? { ...block,
    initial: { by: "mode", values: { match: "PERSON_LOOKUP_UCPATH_SEARCH_FAILED" }, otherwise: "PERSON_LOOKUP_UCPATH_SEARCH_FAILED" } } : block))).success, false);
  assert.equal(ExplorerReviewSpecSchema.safeParse(withBlocks(first.blocks.map(block => block.kind === "card" ? { ...block, rows: block.rows.map(row => ({ ...row, source: "missing" })) } : block))).success, false);
  assert.equal(ExplorerReviewSpecSchema.safeParse({ ...spec, sessions: [{ system: "ucpath", acquired: true }] }).success, false);
  const dropped = withBlocks(first.blocks.map(block => block.kind === "decision" ? { ...block, outcomes: block.outcomes.filter(outcome => outcome.value !== "PERSON_LOOKUP_UCPATH_SEARCH_FAILED") } : block));
  assert.equal(ExplorerReviewSpecSchema.safeParse(dropped).success, true);
  assert.equal(ExplorerWorkflowWireSchema.safeParse({ ...entry, reviewSpec: dropped }).success, false);
  assert.equal(ExplorerWorkflowWireSchema.safeParse({ ...entry, reviewSpec: { ...spec, steps: spec.steps.filter(step => step !== first) } }).success, false);
});

it("refuses a Search by option whose choice no review row reads", () => {
  const definition = { ...personLookupWorkflow, steps: personLookupWorkflow.steps.map(([group, entries]) => [group.review === undefined ? group : { ...group, review: { ...group.review,
    pages: group.review.pages.map(page => ({ ...page, fields: page.fields.filter(field => !("inputField" in field) || field.inputField !== "emplId") })) } }, entries] as const) };
  const deps = explorerQueryDeps(clock, hash);
  const original = deps.modules.find(module => module.descriptor.id === "person-lookup"); assert.ok(original);
  const module = composeWorkflowModule(compileWorkflow(definition), original.stores);
  assert.throws(() => readFixtureExplorer({ ...deps, modules: [module] }), /option search-by has no review row that reads input field emplId/u);
});

it("refuses a Read row with no example value", () => {
  const definition = { ...personLookupWorkflow, steps: personLookupWorkflow.steps.map(([group, entries]) => [group.review === undefined ? group : { ...group, review: { ...group.review,
    pages: group.review.pages.map(page => ({ ...page, mode: "Read only" as const, fields: page.fields.map(field => "inputField" in field && field.id === "search-name" ? { ...field, example: undefined } : field) })) } }, entries] as const) };
  const deps = explorerQueryDeps(clock, hash);
  const original = deps.modules.find(module => module.descriptor.id === "person-lookup"); assert.ok(original);
  const module = composeWorkflowModule(compileWorkflow(definition), original.stores);
  assert.throws(() => readFixtureExplorer({ ...deps, modules: [module] }), /review field search-name on read page \S+ has no example value/u);
});

it("applies a task's outcome explanation to every decision that owns it", () => {
  const then = "Stops before using unverified hire findings.";
  const definition = { ...onboardingWorkflow, steps: onboardingWorkflow.steps.map(([group, entries]) =>
    [group.key !== "i9-creation" || group.review === undefined ? group : { ...group, review: { ...group.review,
      outcomes: [{ nodeId: "write-plan", value: "ONBOARDING_WRITE_REVIEW_REFUSED", then }],
    } }, entries] as const) };
  const deps = explorerQueryDeps(clock, hash);
  const original = deps.modules.find(module => module.descriptor.id === "onboarding"); assert.ok(original);
  const module = composeWorkflowModule(compileWorkflow(definition), original.stores);
  const entry = readFixtureExplorer({ ...deps, modules: deps.modules.map(candidate => candidate === original ? module : candidate) })
    .workflows.find(workflow => workflow.id === "onboarding"); assert.ok(entry);
  for (const id of ["write-path", "existing-write-path"]) {
    const outcome: Decision["outcomes"][number] | undefined = decision(entry.reviewSpec, id).outcomes.find(item => item.value === "ONBOARDING_WRITE_REVIEW_REFUSED");
    assert.ok(outcome);
    assert.deepEqual([outcome.then, outcome.stops], [`${operatorFailureSentence("ONBOARDING_WRITE_REVIEW_REFUSED")} ${then}`, true]);
  }
});

const GENERATOR = "src/backend/runs/queries/explorer-review-spec.ts";

/** Every string the generator spells, template literal text included. */
function generatorStrings(): readonly string[] {
  const source = ts.createSourceFile(GENERATOR, readFileSync(GENERATOR, "utf8"), ts.ScriptTarget.Latest, true);
  const strings: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) strings.push(node.text);
    if (ts.isTemplateExpression(node)) strings.push(node.head.text, ...node.templateSpans.map(span => span.literal.text));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return strings.filter(text => text.trim().length > 0);
}

/** The names workflows declare: ids, step keys, node ids, input fields, operator fields and review decisions. */
function declaredNames(): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const { definition, descriptor } of READABLE_WORKFLOW_MODULES) {
    const add = (name: string, what: string) => { if (!names.has(name)) names.set(name, `${descriptor.id} ${what}`); };
    add(descriptor.id, "workflow id");
    for (const group of descriptor.timeline) {
      add(group.key, "step key");
      for (const field of group.operatorFields ?? []) add(field.label, "operator field");
    }
    for (const node of descriptorRuntimeNodes(descriptor)) add(node.id, "node id");
    for (const leaf of contractSchemaLeaves(descriptor.input)) add(leaf.path, "input field");
    for (const [group] of definition.steps) {
      if (group.review === undefined) continue;
      const review = WorkflowStepReviewSchema.parse(group.review);
      for (const decision of review.decisions ?? []) add(decision.id, "review decision");
    }
  }
  return names;
}

it("keeps the Explorer generator free of any workflow id, step key, node id or field name", () => {
  const names = declaredNames();
  const named = generatorStrings().flatMap(text => names.has(text) ? [`"${text}" (${names.get(text) ?? ""})`] : []);
  assert.deepEqual(named, []);
});
