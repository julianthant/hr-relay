import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { OPERATOR_JSON_HEADERS, disposeHttpRouteHarness, harness } from "../../../../support/helpers/backend/http-route-harness.js";
import { WorkflowExplorerWireSchema, type ExplorerWorkflowWire } from "../../../../../src/models/dashboard/explorer.js";
import type { ExplorerReviewSpec, ExplorerSpecGate, ExplorerSpecValue } from "../../../../../src/models/dashboard/explorer-review-spec.js";
import { failureCodeFromTaskCode, operatorFailureSentence } from "../../../../../src/models/failures/error-catalog.js";
import { DASHBOARD_CATALOG_MODULES, READABLE_WORKFLOW_MODULES, descriptorSetHash } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { buildBootstrap } from "../../../../../src/backend/runs/queries/bootstrap.js";
import { projectWorkbookCompatibilityFromRepository } from "../../../../../src/backend/workbooks/workbook-library-service.js";
import { explorerPickerEntries } from "../../../../../src/dashboard/surfaces/explorer/explorer-picker-model.js";
import { launchWorkflows } from "../../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { parseWorkflows } from "../../../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog } from "../../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { healthyDashboardPreflightReport } from "../../../../support/fixtures/preflight-seams.js";
import { AT, makeWorld } from "../../../../support/helpers/backend/dashboard-harness.js";

afterEach(disposeHttpRouteHarness);

async function served(): Promise<readonly ExplorerWorkflowWire[]> {
  const h = await harness();
  const response = await h.app.request("http://localhost/api/v1/explorer");
  assert.equal(response.status, 200);
  return WorkflowExplorerWireSchema.parse(await response.json()).workflows;
}

async function review(id: string): Promise<ExplorerReviewSpec> {
  const workflow = (await served()).find(candidate => candidate.id === id); assert.ok(workflow, id);
  return workflow.reviewSpec;
}
const personLookup = () => review("person-lookup");

type Values = Readonly<Record<string, string>>;
/** A gate holds when any of its alternatives has every key at one of its values. */
const applies = (gate: ExplorerSpecGate, values: Values): boolean => gate.when === undefined
  || gate.when.some(alternative => Object.entries(alternative).every(([key, allowed]) => values[key] !== undefined && allowed.includes(values[key])));
const valueOf = (value: ExplorerSpecValue, values: Values): string =>
  typeof value === "string" ? value : value.values[values[value.by] ?? ""] ?? value.otherwise;

/** The reader's walk: chosen options, then each visible decision at its chosen or initial outcome, stopping at a stopping outcome. */
function walk(spec: ExplorerReviewSpec, chosen: Values = {}, decisions: Values = {}) {
  const values: Record<string, string> = {};
  for (const option of spec.options) if (applies(option, values)) values[option.id] = chosen[option.id] ?? valueOf(option.initial, values);
  const steps: ExplorerReviewSpec["steps"][number][] = [];
  for (const step of spec.steps) {
    if (!applies(step, values)) continue;
    steps.push(step);
    for (const block of step.blocks) {
      if (block.kind !== "decision" || !applies(block, values)) continue;
      const outcomes = block.outcomes.filter(outcome => applies(outcome, values));
      const initial = valueOf(block.initial, values);
      const outcome = outcomes.find(candidate => candidate.value === decisions[block.id]) ?? outcomes.find(candidate => candidate.value === initial);
      assert.ok(outcome, `${block.id} has no applicable outcome`);
      values[block.id] = outcome.value;
      if (outcome.stops) return { values, steps, sessions: spec.sessions.filter(session => applies(session, values)), stop: outcome };
    }
  }
  return { values, steps, sessions: spec.sessions.filter(session => applies(session, values)) };
}
const visible = <Item extends ExplorerSpecGate>(items: readonly Item[], values: Values): Item[] => items.filter(item => applies(item, values));
const step = (spec: ExplorerReviewSpec, id: string) => { const found = spec.steps.find(candidate => candidate.id === id); assert.ok(found, id); return found; };
const blocks = <Kind extends ExplorerReviewSpec["steps"][number]["blocks"][number]["kind"]>(spec: ExplorerReviewSpec, stepId: string, kind: Kind) =>
  step(spec, stepId).blocks.filter((block): block is Extract<typeof block, { kind: Kind }> => block.kind === kind);

it("serves Person Lookup's Start run options with their labelled choices and defaults", async () => {
  const spec = await personLookup();
  const stepChoices = [{ value: "run", label: "Runs" }, { value: "skip", label: "Skipped" }];
  assert.deepEqual(spec.options, [
    { id: "mode", label: "Lookup mode", choices: [{ value: "search", label: "Search" }, { value: "match", label: "Match" }], initial: "search" },
    { id: "search-by", label: "Search by", choices: [{ value: "emplId", label: "Employee ID" }, { value: "name", label: "Name" }], initial: "name", when: [{ mode: ["search"] }] },
    { id: "crmCheck", label: "CRM check", choices: [{ value: "true", label: "On" }, { value: "false", label: "Off" }],
      initial: { by: "mode", values: { search: "true", match: "false" }, otherwise: "true" } },
    { id: "includeCrmDates", label: "Read CRM dates", choices: [{ value: "true", label: "On" }, { value: "false", label: "Off" }], initial: "true",
      when: [{ mode: ["search"], crmCheck: ["true"] }] },
    { id: "skip-searching", label: "Search for person", choices: stepChoices, initial: "run" },
    { id: "skip-cross-verify", label: "Cross-check identity", choices: stepChoices, initial: "run" },
    { id: "skip-active-status", label: "Read employment status", choices: stepChoices, initial: "run" },
    { id: "skip-crm-dates", label: "Read CRM dates", choices: stepChoices, initial: "run" },
  ]);
  assert.deepEqual(walk(spec).values, { mode: "search", "search-by": "name", crmCheck: "true", includeCrmDates: "true",
    "skip-searching": "run", "skip-cross-verify": "run", "skip-active-status": "run", "skip-crm-dates": "run",
    "reference-result": "null", "search-result": "resolved", "crm-result": "Found", "employment-status": "active", "crm-dates-result": "succeeded" });
});

it("derives the steps and session chips of every option value", async () => {
  const spec = await personLookup();
  const ids = (chosen: Values) => walk(spec, chosen).steps.map(entry => entry.id);
  const systems = (chosen: Values) => walk(spec, chosen).sessions.map(session => session.system);
  assert.deepEqual(ids({}), ["reference-check", "searching", "cross-verify", "active-status", "crm-dates"]);
  assert.deepEqual(systems({}), ["ucpath", "crm"]);
  assert.deepEqual(ids({ includeCrmDates: "true" }), ["reference-check", "searching", "cross-verify", "active-status", "crm-dates"]);
  assert.deepEqual(ids({ includeCrmDates: "false" }), ["reference-check", "searching", "cross-verify", "active-status"]);
  assert.deepEqual(ids({ "skip-crm-dates": "skip" }), ["reference-check", "searching", "cross-verify", "active-status"]);
  assert.deepEqual(ids({ crmCheck: "false" }), ["reference-check", "searching", "active-status"]);
  assert.deepEqual(systems({ crmCheck: "false" }), ["ucpath"]);
  assert.deepEqual(ids({ crmCheck: "false", includeCrmDates: "true" }), ["reference-check", "searching", "active-status"]);
  assert.deepEqual(ids({ mode: "match" }), ["reference-check", "searching"]);
  assert.deepEqual(systems({ mode: "match" }), ["ucpath"]);
  assert.deepEqual(ids({ mode: "match", crmCheck: "true" }), ["reference-check", "searching", "cross-verify"]);
  assert.deepEqual(walk(spec, { mode: "match" }).values["search-by"], undefined);
});

it("titles each step from the one timeline declaration and serves its system, description, checks, cards, rows and click lines", async () => {
  const workflow = (await served()).find(candidate => candidate.id === "person-lookup"); assert.ok(workflow);
  const spec = workflow.reviewSpec;
  assert.deepEqual(spec.steps.map(entry => [entry.id, entry.title, entry.system]), workflow.timeline.map(group => [group.key, group.label, group.system]));
  const search = step(spec, "searching");
  assert.deepEqual(search.description[0], { text: "Search UCPath by employee ID or name and read the matching person records." });
  const byName = { mode: "search", "search-by": "name" }, byEid = { mode: "search", "search-by": "emplId" };
  assert.deepEqual(visible(search.checks, byName).map(check => check.text), ["Keeps HDH departments only"]);
  assert.deepEqual(visible(search.checks, byEid), []);
  const cards = blocks(spec, "searching", "card");
  const fill = visible(cards, byName).find(card => card.mode === "fill"); assert.ok(fill);
  assert.equal(fill.title, "Person Organizational Summary");
  assert.deepEqual(visible(fill.rows, byName).map(row => [row.label, row.value]), [["Name", "Morrow, Bea"]]);
  assert.deepEqual(visible(fill.rows, byEid).map(row => [row.label, row.value]), [["Employee ID", "10000001"]]);
  const nameRow = visible(fill.rows, byName)[0]; assert.ok(nameRow);
  assert.deepEqual(spec.sources[nameRow.source], { origin: "Run input", detail: "The name entered when the run starts.", reads: [] });
  assert.deepEqual(visible(blocks(spec, "searching", "click"), byName).map(click => click.target), ["Search"]);
  const match = visible(cards, { mode: "match" }).find(card => card.mode === "fill"); assert.ok(match);
  assert.deepEqual(visible(match.rows, { mode: "match" }).map(row => row.label), ["Last name", "First name", "Date of birth"]);
  const read = visible(cards, { ...byName, "search-result": "resolved" }).find(card => card.mode === "read"); assert.ok(read);
  assert.deepEqual(read.rows.map(row => [row.label, row.value]), [["Employee ID", "10000001"], ["Name", "Quillan, Petra A."],
    ["Department", "CAMPUS DINING OPERATIONS"], ["Job title", "Fictional analyst"], ["HR status", "Active"]]);
  const crm = blocks(spec, "cross-verify", "card");
  assert.deepEqual(crm.map(card => [card.title, card.mode]), [["CRM onboarding search", "fill"], ["CRM onboarding record", "read"]]);
  const query = crm[0]?.rows[0]; assert.ok(query);
  assert.deepEqual([query.label, query.value], ["Name", "Quillan, Petra A."]);
  assert.deepEqual(spec.sources[query.source]?.reads, [{ system: "ucpath", step: "searching", page: "Person Organizational Summary detail", field: "Name" }]);
  assert.deepEqual(blocks(spec, "cross-verify", "click").map(click => click.target), ["Search"]);
  for (const entry of spec.steps) for (const card of entry.blocks) if (card.kind === "card") for (const row of card.rows) {
    assert.ok(row.value !== undefined, `${entry.id}/${card.id}/${row.id} has a sample value`);
    assert.ok(spec.sources[row.source], `${entry.id}/${card.id}/${row.id} has a source`);
  }
});

it("serves each decision's outcomes with the sentence of what the run does and which ones stop", async () => {
  const spec = await personLookup();
  const [search] = blocks(spec, "searching", "decision"); assert.ok(search);
  assert.equal(search.label, "Search result");
  assert.equal(search.initial, "resolved");
  const outcome = (decision: typeof search, value: string) => { const found = decision.outcomes.find(candidate => candidate.value === value); assert.ok(found, value); return found; };
  assert.deepEqual(outcome(search, "resolved"), { value: "resolved", label: "One person found", then: "Continues to the next step.", stops: false });
  assert.deepEqual(outcome(search, "multiple-matches"), { value: "multiple-matches", label: "Several people match", stops: false,
    then: "Continues; unless the CRM cross-check narrows it to one person, the run ends as Multiple matches." });
  assert.equal(outcome(search, "not-found").stops, false);
  const failed = outcome(search, "PERSON_LOOKUP_UCPATH_SEARCH_FAILED");
  assert.deepEqual(failed, { value: "PERSON_LOOKUP_UCPATH_SEARCH_FAILED", label: "UCPath search failed",
    then: "UCPath search failed. The run stops with a failure card.", stops: true });
  assert.ok(search.outcomes.every(candidate => candidate.label !== "Anything else"));
  const stopped = walk(spec, {}, { "search-result": "PERSON_LOOKUP_UCPATH_SEARCH_FAILED" });
  assert.equal(stopped.stop?.value, "PERSON_LOOKUP_UCPATH_SEARCH_FAILED");
  assert.deepEqual(stopped.steps.map(entry => entry.id), ["reference-check", "searching"]);

  const [crm] = blocks(spec, "cross-verify", "decision"); assert.ok(crm);
  assert.deepEqual([crm.label, crm.initial], ["CRM cross-check result", "Found"]);
  assert.deepEqual(outcome(crm, "Found"), { value: "Found", label: "Records agree", then: "Continues to the next step.", stops: false });
  assert.deepEqual(outcome(crm, "Not found").then, "Continues without a CRM record.");

  const [status] = blocks(spec, "active-status", "decision"); assert.ok(status);
  assert.deepEqual([status.label, status.initial], ["Employment status", "active"]);
  assert.deepEqual(outcome(status, "active"), { value: "active", label: "Active", then: "The run's outcome is Active.", stops: false });
  assert.equal(outcome(status, "INCONSISTENT_INPUTS").stops, true);
  const statusRow = blocks(spec, "active-status", "card").flatMap(card => card.rows).find(row => row.label === "Employment status"); assert.ok(statusRow);
  assert.equal(valueOf(statusRow.value ?? "", walk(spec, {}, { "employment-status": "inactive" }).values), "Inactive");
  assert.equal(valueOf(statusRow.value ?? "", walk(spec).values), "Active");
  assert.equal(spec.unlistedFailure, "Anything not listed stops the run with a failure card.");
});

it("derives the steps, cards and rows that follow each decision outcome", async () => {
  const spec = await personLookup();
  const ids = (chosen: Values, decisions: Values) => walk(spec, chosen, decisions).steps.map(entry => entry.id);
  assert.deepEqual(ids({ includeCrmDates: "true" }, { "employment-status": "inactive" }), ["reference-check", "searching", "cross-verify", "active-status", "crm-dates"]);
  for (const outcome of ["not-found", "multiple-matches"]) {
    assert.deepEqual(ids({ includeCrmDates: "true" }, { "employment-status": outcome }), ["reference-check", "searching", "cross-verify", "active-status"], outcome);
    assert.deepEqual(ids({ mode: "match", crmCheck: "true" }, { "search-result": outcome }), ["reference-check", "searching"], outcome);
    assert.deepEqual(ids({}, { "search-result": outcome }), ["reference-check", "searching", "cross-verify", "active-status", "crm-dates"], outcome);
    assert.deepEqual(ids({ includeCrmDates: "false" }, { "search-result": outcome }), ["reference-check", "searching", "cross-verify", "active-status"], outcome);
  }
  const cards = (stepId: string, decisions: Values) => {
    const { values } = walk(spec, {}, decisions);
    return visible(blocks(spec, stepId, "card"), values).map(card => [card.title, visible(card.rows, values).map(row => row.label)]);
  };
  assert.deepEqual(cards("searching", {}).map(([title]) => title), ["Person Organizational Summary", "Person Organizational Summary detail"]);
  assert.deepEqual(cards("searching", { "search-result": "not-found" }).map(([title]) => title), ["Person Organizational Summary"]);
  assert.deepEqual(cards("cross-verify", { "crm-result": "Not found" }).map(([title]) => title), ["CRM onboarding search"]);
  assert.deepEqual(cards("active-status", { "employment-status": "not-found" }), [["Person Organizational Summary detail", ["Employment status"]]]);
  assert.deepEqual(cards("active-status", { "employment-status": "inactive" }), [["Person Organizational Summary detail",
    ["Employment status", "HDH department", "Department", "End date", "Termination reason"]]]);
  assert.deepEqual(cards("active-status", {}), [["Person Organizational Summary detail", ["Employment status", "HDH department", "Department"]]]);
});

it("walks a dry run through the prepared change without a saved one", async () => {
  const spec = await review("onbase");
  const save = blocks(spec, "import-document", "decision").find(block => block.id === "import-document"); assert.ok(save);
  const live = walk(spec);
  assert.equal(live.values["import-document"], "saved");
  const dry = walk(spec, { "dry-run": "true" });
  assert.equal(dry.values["import-document"], "dry-run");
  const outcomes = visible(save.outcomes, dry.values).map(outcome => outcome.value);
  assert.equal(outcomes.includes("saved"), false);
  assert.equal(outcomes.includes("unconfirmed"), false);
  assert.ok(outcomes.includes("dry-run"));
});

it("serves a valid review spec for every readable workflow", async () => {
  const workflows = await served();
  assert.deepEqual(workflows.map(workflow => workflow.id), READABLE_WORKFLOW_MODULES.map(module => module.descriptor.id));
  for (const workflow of workflows) {
    assert.deepEqual(workflow.reviewSpec.steps.map(entry => entry.id), workflow.timeline.map(group => group.key));
    assert.deepEqual(workflow.reviewSpec.steps.map(entry => entry.title), workflow.timeline.map(group => group.label));
    assert.ok(walk(workflow.reviewSpec).steps.length > 0, workflow.id);
  }
});

it("serves operator-only recovery when a Kuali finalization cannot be confirmed", async () => {
  const separations = (await served()).find(workflow => workflow.id === "separations");
  assert.ok(separations);
  const save = separations.nodes.flatMap(node => node.tasks).find(task => task.taskId === "kuali/save-separation-finalization");
  assert.equal(save?.writeSafety?.recoveryAbsence.kind, "operator-only");
});

it("lists main workflows in the picker and serves delegated workflows on the steps that start them", async () => {
  const workflows = await served();
  const pairs = workflows.flatMap(workflow => workflow.reviewSpec.steps.flatMap(entry => entry.blocks.flatMap(block =>
    block.kind === "starts" ? [`${workflow.id} > ${block.workflowId}`] : [])));
  assert.deepEqual([...new Set(pairs)].sort(), [
    "emergency-contact > emergency-contact-member", "emergency-contact > ocr", "emergency-contact-member > onbase",
    "i9-check > person-lookup", "i9-check-start > i9-check", "i9-check-start > ocr", "ocr > i9-lookup", "ocr > ocr-page", "ocr > person-lookup", "onboarding > i9-lookup",
  ]);
  const titles = workflows.map(workflow => workflow.label);
  assert.deepEqual(titles.filter((title, index) => titles.indexOf(title) !== index), []);

  const world = await makeWorld();
  try {
    const boot = await buildBootstrap({ appVersion: "0.1.0", clock: manualClock(AT), modules: DASHBOARD_CATALOG_MODULES,
      descriptorSetHash: descriptorSetHash(DASHBOARD_CATALOG_MODULES.map(({ descriptor }) => descriptor.contractFingerprint)),
      settingsSchemaHash: descriptorSetHash(["settings-schema"]), projection: world.projection, actorLabel: () => "Fixture Operator",
      authorityMeta: () => world.database.getMeta(), preflightReport: () => healthyDashboardPreflightReport(manualClock(AT)),
      workbookCompatibility: modules => projectWorkbookCompatibilityFromRepository(world.database.authority.workbooks, modules) });
    const catalog = buildWorkflowCatalog(launchWorkflows(parseWorkflows(boot.workflows)));
    assert.deepEqual(explorerPickerEntries(catalog), [
      { id: "person-lookup", title: "Person Lookup", depth: 0 },
      { id: "separations", title: "Separations", depth: 0 },
      { id: "i9-check-start", title: "I-9 Check", depth: 0 },
      { id: "onboarding", title: "Onboarding", depth: 0 },
      { id: "work-study", title: "Work-Study", depth: 0 },
      { id: "emergency-contact", title: "Emergency Contact", depth: 0 },
    ]);
  } finally {
    await world.dispose();
  }
});

it("serves a value for every Read row of every readable workflow", async () => {
  const missing = (await served()).flatMap(workflow => workflow.reviewSpec.steps.flatMap(entry => entry.blocks.flatMap(block =>
    block.kind === "card" && block.mode === "read" ? block.rows.filter(row => row.value === undefined).map(row => `${workflow.id}/${entry.id}/${block.id}/${row.id}`) : [])));
  assert.deepEqual(missing, []);
});

/** The longest label that stays on one line in the Explorer's w-80 outcome select at 1280 px. */
const LABEL_LIMIT = 38;
const decisionsOf = (spec: ExplorerReviewSpec) => spec.steps.flatMap(entry => entry.blocks.flatMap(block => block.kind === "decision" ? [block] : []));

it("labels every outcome with a short operator choice, never a sentence", async () => {
  for (const workflow of await served()) for (const decision of decisionsOf(workflow.reviewSpec)) for (const outcome of decision.outcomes) {
    const where = `${workflow.id}/${decision.id}/${outcome.value}: ${outcome.label}`;
    assert.equal(decision.outcomes.filter(candidate => candidate.label === outcome.label).length, 1, where);
    assert.ok(outcome.label.length <= LABEL_LIMIT, where);
    assert.doesNotMatch(outcome.label, /\.$|Delegated work/u, where);
  }
});

it("keeps each listed failure's catalog sentence before what the run does", async () => {
  for (const workflow of await served()) for (const node of workflow.nodes) for (const task of node.tasks) for (const code of task.errorCodes) {
    const catalog = failureCodeFromTaskCode(code);
    for (const decision of decisionsOf(workflow.reviewSpec)) for (const outcome of decision.outcomes.filter(candidate => candidate.value === code)) {
      assert.ok(outcome.then.startsWith(`${operatorFailureSentence(catalog)} `), `${workflow.id}/${decision.id}/${code}`);
    }
  }
});

it("names the delegated workflow on each child-run outcome", async () => {
  const outcomes = async (workflowId: string, decisionId: string) => {
    const found = decisionsOf(await review(workflowId)).find(decision => decision.id === decisionId); assert.ok(found, decisionId);
    return found.outcomes.map(outcome => [outcome.value, outcome.label]);
  };
  assert.deepEqual(await outcomes("emergency-contact", "read-document"), [["succeeded", "OCR finished"], ["child-failed", "OCR failed"]]);
  assert.deepEqual(await outcomes("ocr", "lookup-identities"), [["succeeded", "Person Lookup: all finished"], ["child-failed", "Person Lookup: some failed"]]);
});

const WORKBOOK_STORAGE_FAULTS = ["WORKBOOK_OPERATION_CONFLICT", "WORKBOOK_METADATA_UNSUPPORTED", "WORKBOOK_REVISION_UNAVAILABLE",
  "WORKBOOK_OUTPUT_SOURCE_UNAVAILABLE", "WORKBOOK_STORAGE_FAILED", "WORKBOOK_STORAGE_CORRUPT", "WORKBOOK_NOT_FOUND", "WORKBOOK_INVALID",
  "WORKBOOK_VERSION_CONFLICT", "WORKBOOK_PROVIDER_UNAVAILABLE"];

it("leaves workbook storage faults to the unlisted-failure rule because the operator cannot act on them in a review", async () => {
  let declared = 0;
  for (const workflow of await served()) for (const node of workflow.nodes) for (const task of node.tasks) for (const code of task.errorCodes) {
    const listed = decisionsOf(workflow.reviewSpec).some(decision => decision.outcomes.some(outcome => outcome.value === code));
    const storage = WORKBOOK_STORAGE_FAULTS.includes(failureCodeFromTaskCode(code));
    if (storage) declared += 1;
    assert.equal(listed, !storage, `${workflow.id}/${node.id}/${code}`);
  }
  assert.ok(declared > 0);
});

it("removes the Explorer validation endpoint", async () => {
  const h = await harness();
  const response = await h.app.request("http://localhost/api/v1/explorer/validate", {
    method: "POST", headers: OPERATOR_JSON_HEADERS, body: JSON.stringify({ workflowId: "fixture-graph" }),
  });
  assert.equal(response.status, 404);
});
