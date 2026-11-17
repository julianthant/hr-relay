import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { OPERATOR_JSON_HEADERS, disposeHttpRouteHarness, harness } from "../../../../support/helpers/backend/http-route-harness.js";
import { WorkflowExplorerWireSchema, type ExplorerWorkflowWire } from "../../../../../src/models/dashboard/explorer.js";
import type { ExplorerReviewSpec, ExplorerSpecGate, ExplorerSpecValue } from "../../../../../src/models/dashboard/explorer-review-spec.js";
import { operatorFailureSentence } from "../../../../../src/models/failures/error-catalog.js";
import { READABLE_WORKFLOW_MODULES } from "../../../../../src/backend/app/registries/workflow-registry.js";

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
  assert.deepEqual(spec.options, [
    { id: "mode", label: "Lookup mode", choices: [{ value: "search", label: "Search" }, { value: "match", label: "Match" }], initial: "search" },
    { id: "search-by", label: "Search by", choices: [{ value: "emplId", label: "Employee ID" }, { value: "name", label: "Name" }], initial: "name", when: [{ mode: ["search"] }] },
    { id: "crmCheck", label: "CRM check", choices: [{ value: "true", label: "On" }, { value: "false", label: "Off" }],
      initial: { by: "mode", values: { search: "true", match: "false" }, otherwise: "true" } },
    { id: "includeCrmDates", label: "Read CRM dates", choices: [{ value: "true", label: "On" }, { value: "false", label: "Off" }], initial: "false",
      when: [{ mode: ["search"], crmCheck: ["true"] }] },
  ]);
  assert.deepEqual(walk(spec).values, { mode: "search", "search-by": "name", crmCheck: "true", includeCrmDates: "false",
    "search-result": "resolved", "crm-result": "Found", "employment-status": "active", "reference-check-result": "succeeded" });
});

it("derives the steps and session chips of every option value", async () => {
  const spec = await personLookup();
  const ids = (chosen: Values) => walk(spec, chosen).steps.map(entry => entry.id);
  const systems = (chosen: Values) => walk(spec, chosen).sessions.map(session => session.system);
  assert.deepEqual(ids({}), ["searching", "cross-verify", "active-status", "reference-check"]);
  assert.deepEqual(systems({}), ["ucpath", "crm"]);
  assert.deepEqual(ids({ includeCrmDates: "true" }), ["searching", "cross-verify", "active-status", "crm-dates", "reference-check"]);
  assert.deepEqual(ids({ crmCheck: "false" }), ["searching", "active-status", "reference-check"]);
  assert.deepEqual(systems({ crmCheck: "false" }), ["ucpath"]);
  assert.deepEqual(ids({ crmCheck: "false", includeCrmDates: "true" }), ["searching", "active-status", "reference-check"]);
  assert.deepEqual(ids({ mode: "match" }), ["searching", "reference-check"]);
  assert.deepEqual(systems({ mode: "match" }), ["ucpath"]);
  assert.deepEqual(ids({ mode: "match", crmCheck: "true" }), ["searching", "cross-verify", "reference-check"]);
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
  assert.deepEqual(failed, { value: "PERSON_LOOKUP_UCPATH_SEARCH_FAILED", label: operatorFailureSentence("PERSON_LOOKUP_UCPATH_SEARCH_FAILED"),
    then: "The run stops with a failure card.", stops: true });
  assert.ok(search.outcomes.every(candidate => candidate.label !== "Anything else"));
  const stopped = walk(spec, {}, { "search-result": "PERSON_LOOKUP_UCPATH_SEARCH_FAILED" });
  assert.equal(stopped.stop?.value, "PERSON_LOOKUP_UCPATH_SEARCH_FAILED");
  assert.deepEqual(stopped.steps.map(entry => entry.id), ["searching"]);

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
  assert.deepEqual(ids({ includeCrmDates: "true" }, { "employment-status": "inactive" }), ["searching", "cross-verify", "active-status", "crm-dates", "reference-check"]);
  for (const outcome of ["not-found", "multiple-matches"]) {
    assert.deepEqual(ids({ includeCrmDates: "true" }, { "employment-status": outcome }), ["searching", "cross-verify", "active-status", "reference-check"], outcome);
    assert.deepEqual(ids({ mode: "match", crmCheck: "true" }, { "search-result": outcome }), ["searching", "reference-check"], outcome);
    assert.deepEqual(ids({}, { "search-result": outcome }), ["searching", "cross-verify", "active-status", "reference-check"], outcome);
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

it("removes the Explorer validation endpoint", async () => {
  const h = await harness();
  const response = await h.app.request("http://localhost/api/v1/explorer/validate", {
    method: "POST", headers: OPERATOR_JSON_HEADERS, body: JSON.stringify({ workflowId: "fixture-graph" }),
  });
  assert.equal(response.status, 404);
});
