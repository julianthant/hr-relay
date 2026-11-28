import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { disposeHttpRouteHarness, harness } from "../../../../support/helpers/backend/http-route-harness.js";
import { WorkflowExplorerWireSchema } from "../../../../../src/models/dashboard/explorer.js";
import type { ExplorerReviewSpec, ExplorerSpecGate, ExplorerSpecValue } from "../../../../../src/models/dashboard/explorer-review-spec.js";
import { failureCodeFromTaskCode, operatorFailureSentence } from "../../../../../src/models/failures/error-catalog.js";
import { isUnlistedStorageFailure, operatorFailureLabel } from "../../../../../src/models/failures/failure-labels.js";

afterEach(disposeHttpRouteHarness);

async function served() {
  const h = await harness();
  const response = await h.app.request("http://localhost/api/v1/explorer");
  assert.equal(response.status, 200);
  const workflow = WorkflowExplorerWireSchema.parse(await response.json()).workflows.find(candidate => candidate.id === "separations");
  assert.ok(workflow);
  return workflow;
}

type Values = Readonly<Record<string, string>>;
const applies = (gate: ExplorerSpecGate, values: Values): boolean => gate.when === undefined
  || gate.when.some(alternative => Object.entries(alternative).every(([key, allowed]) => values[key] !== undefined && allowed.includes(values[key])));
const valueOf = (value: ExplorerSpecValue, values: Values): string =>
  typeof value === "string" ? value : value.values[values[value.by] ?? ""] ?? value.otherwise;
const sampleValues = (value: ExplorerSpecValue | undefined): readonly string[] => value === undefined ? []
  : typeof value === "string" ? [value] : [...Object.values(value.values), value.otherwise];

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
      const outcome = outcomes.find(candidate => candidate.value === decisions[block.id])
        ?? outcomes.find(candidate => candidate.value === valueOf(block.initial, values));
      assert.ok(outcome, `${block.id} has an applicable initial outcome`);
      values[block.id] = outcome.value;
      if (outcome.stops) return { values, steps, stop: outcome };
    }
  }
  return { values, steps };
}

const visible = <Item extends ExplorerSpecGate>(items: readonly Item[], values: Values): Item[] => items.filter(item => applies(item, values));
const step = (spec: ExplorerReviewSpec, id: string) => {
  const found = spec.steps.find(candidate => candidate.id === id); assert.ok(found, id); return found;
};
const blocks = <Kind extends ExplorerReviewSpec["steps"][number]["blocks"][number]["kind"]>(spec: ExplorerReviewSpec, stepId: string, kind: Kind) =>
  step(spec, stepId).blocks.filter((block): block is Extract<typeof block, { kind: Kind }> => block.kind === kind);

it("serves a fictional sample and traceable source for every Separations page row", async () => {
  const { reviewSpec: spec } = await served();
  for (const entry of spec.steps) for (const card of entry.blocks) if (card.kind === "card") for (const row of card.rows) {
    assert.ok(row.value !== undefined, `${entry.title} / ${card.title} / ${row.label} needs a sample`);
    assert.notEqual(valueOf(row.value, walk(spec).values).trim(), "");
    const source = spec.sources[row.source]; assert.ok(source, row.label);
    assert.ok(source.origin.trim()); assert.ok(source.detail.trim());
    for (const read of source.reads) assert.ok(spec.steps.some(candidate => candidate.id === read.step), read.step);
  }
});

it("serves the Employee ID search and traces the searched ID to Kuali", async () => {
  const { reviewSpec: spec } = await served();
  const identity = step(spec, "identity-check");
  assert.ok(identity.description.some(line =>
    line.text === "Search UCPath for the employee by the Employee ID on the Kuali document."));
  const search = blocks(spec, identity.id, "card").find(card => card.title === "Person Organizational Summary search");
  assert.ok(search);
  assert.ok(!search.rows.some(row => row.label === "Searched name"));
  const searched = search.rows.find(row => row.label === "Searched Employee ID");
  assert.ok(searched);
  assert.ok(spec.sources[searched.source]?.reads.some(read => read.step === "kuali-extraction" && read.field === "Employee ID"));
});

it("continues an agreed identity and waits before filing when identity approval is required", async () => {
  const { reviewSpec: spec } = await served();
  const identity = blocks(spec, "identity-review", "decision");
  assert.equal(identity.length, 1, "one decision explains the comparison and its approval");
  const decision = identity[0]; assert.ok(decision);
  assert.equal(decision.id, "identity-result");
  assert.equal(decision.initial, "false");
  assert.deepEqual(decision.outcomes.filter(outcome => ["false", "true"].includes(outcome.value)), [
    { value: "false", label: "Identity agrees", then: "Continues with the verified identity.", stops: false },
    { value: "true", label: "Identity needs approval", then: "Waits for you to approve or correct the identity in Logs before anything is filed.", stops: true },
  ]);
  assert.ok(walk(spec).steps.some(entry => entry.id === "kuali-finalization"));
  const waiting = walk(spec, {}, { "identity-result": "true" });
  assert.equal(waiting.stop?.value, "true");
  assert.deepEqual(waiting.steps.map(entry => entry.id), ["reference-check", "kuali-extraction", "identity-check", "kronos-timecard", "identity-review"]);
});

it("continues without a difference and lets the operator cancel a mismatch in either mode", async () => {
  const { reviewSpec: spec } = await served();
  const [comparison, review] = blocks(spec, "reference-check", "decision"); assert.ok(comparison); assert.ok(review);
  assert.deepEqual([comparison.id, comparison.initial], ["reference-result", "null"]);
  assert.deepEqual([review.id, review.initial], ["reference-check-review", "continue"]);
  assert.ok(walk(spec).steps.some(entry => entry.id === "ucpath-transaction"));
  for (const dryRun of ["false", "true"]) {
    const stopped = walk(spec, { "dry-run": dryRun }, { "reference-result": "true", "reference-check-review": "cancelled" });
    assert.equal(stopped.stop?.value, "cancelled");
    assert.equal(stopped.steps.at(-1)?.id, "reference-check");
    assert.ok(!stopped.steps.some(entry => entry.id === "ucpath-transaction"));
    assert.equal(walk(spec, { "dry-run": dryRun }, { "reference-result": "true" }).values["reference-check-review"], "continue");
  }
});

it("continues an already filed termination without saving twice and stops at every unconfirmed write", async () => {
  const { reviewSpec: spec } = await served();
  for (const [stepId, id] of [["pending-termination", "clear-pending"], ["ucpath-transaction", "file-termination"], ["kuali-finalization", "finalize-kuali"]] as const) {
    const decision = blocks(spec, stepId, "decision").find(candidate => candidate.id === id); assert.ok(decision, id);
    assert.deepEqual(decision.outcomes.find(outcome => outcome.value === "already-present"), {
      value: "already-present", label: "Already present", then: "Uses the verified existing change without saving it again, then continues.", stops: false,
    });
    const present = walk(spec, {}, { [id]: "already-present" });
    assert.equal(present.values[id], "already-present");
    assert.equal(present.stop, undefined);
    assert.equal(present.steps.at(-1)?.id, "kuali-finalization");
    const parked = walk(spec, {}, { [id]: "unconfirmed" });
    assert.equal(parked.stop?.value, "unconfirmed");
    assert.equal(parked.stop?.then, "Parks the write for your review in Logs and does not retry it.");
    assert.equal(parked.steps.at(-1)?.id, stepId);
    const dry = walk(spec, { "dry-run": "true" });
    assert.equal(dry.values[id], "dry-run");
    assert.ok(visible(decision.outcomes, dry.values).every(outcome => !["saved", "unconfirmed"].includes(outcome.value)));
    assert.equal(dry.stop, undefined);
    assert.equal(walk(spec, { "dry-run": "true" }, { [id]: "already-present" }).values[id], "already-present");
  }
});

it("shows the real clicks and filling pages only for the work the chosen transaction outcome performs", async () => {
  const { reviewSpec: spec } = await served();
  const clicks = (stepId: string, values: Values) => visible(blocks(spec, stepId, "click"), values).map(block => block.target);
  const live = walk(spec).values;
  assert.deepEqual(clicks("identity-check", live), ["Search"]);
  assert.deepEqual(clicks("kronos-timecard", live), ["Search"]);
  assert.deepEqual(clicks("pending-termination", live), ["Search", "Delete Selected Transactions"]);
  assert.deepEqual(clicks("ucpath-transaction", live), ["Create Transaction", "Continue", "Save and Submit"]);
  assert.deepEqual(clicks("kuali-finalization", live), ["Save"]);
  const dry = walk(spec, { "dry-run": "true" }).values;
  assert.deepEqual(clicks("pending-termination", dry), ["Search"]);
  assert.deepEqual(clicks("ucpath-transaction", dry), ["Create Transaction", "Continue"]);
  assert.deepEqual(clicks("kuali-finalization", dry), []);
  const present = walk(spec, {}, { "clear-pending": "already-present", "file-termination": "already-present", "finalize-kuali": "already-present" }).values;
  assert.deepEqual(clicks("pending-termination", present), ["Search"]);
  assert.deepEqual(clicks("ucpath-transaction", present), []);
  assert.deepEqual(clicks("kuali-finalization", present), []);
  assert.deepEqual(visible(blocks(spec, "pending-termination", "card"), present).map(card => card.title), ["SS Smart HR transaction search"]);
  assert.deepEqual(visible(blocks(spec, "ucpath-transaction", "card"), present).map(card => card.title), ["SS Smart HR transaction detail"]);
  assert.deepEqual(visible(blocks(spec, "kuali-finalization", "card"), present).map(card => [card.title, card.mode]), [["SS Smart HR transaction detail", "read"]]);
  assert.deepEqual(visible(blocks(spec, "pending-termination", "card"), live).map(card => [card.title, card.mode]), [["SS Smart HR transaction search", "fill"]]);
  assert.deepEqual(visible(blocks(spec, "ucpath-transaction", "card"), live).map(card => [card.title, card.mode]), [
    ["Smart HR transaction setup", "fill"], ["Smart HR transaction details", "fill"],
    ["Smart HR transaction information", "fill"], ["SS Smart HR transaction detail", "read"],
  ]);
});

it("serves the default run and every Start run step choice with matching labels and session chips", async () => {
  const workflow = await served();
  const spec = workflow.reviewSpec;
  // Every step but the reference check can be turned off in Start run.
  const skippable = [["kuali-extraction", "Kuali extraction"], ["identity-check", "Identity check"], ["kronos-timecard", "Kronos timecard"], ["identity-review", "Identity approval"],
    ["pending-termination", "Pending terminations"], ["ucpath-transaction", "UCPath transaction"], ["kuali-finalization", "Kuali finalization"]] as const;
  assert.deepEqual(spec.options, [
    { id: "dry-run", label: "Dry run", choices: [{ value: "true", label: "On" }, { value: "false", label: "Off" }], initial: "false" },
    ...skippable.map(([id, label]) => ({ id: `skip-${id}`, label, choices: [{ value: "run", label: "Runs" }, { value: "skip", label: "Skipped" }], initial: "run" })),
  ]);
  const all = ["reference-check", "kuali-extraction", "identity-check", "kronos-timecard", "identity-review", "pending-termination", "ucpath-transaction", "kuali-finalization"];
  const ordinary = walk(spec);
  assert.deepEqual(ordinary.steps.map(entry => entry.id), all);
  assert.equal(ordinary.stop, undefined);
  const systems = (values: Values) => visible(spec.sessions, values).map(session => session.system);
  assert.deepEqual(systems(ordinary.values), ["kuali", "ucpath", "new-kronos"]);
  for (const dry of ["false", "true"]) for (const [id] of skippable) {
    const skipped = walk(spec, { [`skip-${id}`]: "skip", "dry-run": dry });
    assert.deepEqual(skipped.steps.map(entry => entry.id), all.filter(candidate => candidate !== id));
    // Kronos is the only system a single step owns; Kuali and UCPath each serve other steps too.
    assert.deepEqual(systems(skipped.values), id === "kronos-timecard" ? ["kuali", "ucpath"] : ["kuali", "ucpath", "new-kronos"]);
  }
  const byHand = walk(spec, { "skip-identity-check": "skip", "skip-pending-termination": "skip", "skip-ucpath-transaction": "skip", "skip-kuali-finalization": "skip" });
  assert.deepEqual(systems(byHand.values), ["kuali", "new-kronos"]);
  assert.deepEqual(spec.steps.map(entry => [entry.id, entry.title, entry.system]), workflow.timeline.map(group => [group.key, group.label, group.system]));
  assert.deepEqual(spec.steps.map(entry => entry.title), ["Reference spreadsheets", "Kuali extraction", "Identity check", "Kronos timecard", "Identity approval", "Pending terminations", "UCPath transaction", "Kuali finalization"]);
  for (const entry of spec.steps) {
    assert.ok(entry.description.some(line => line.text.trim().length > 0), entry.title);
    assert.ok(entry.checks.length > 0, entry.title);
    assert.ok(entry.blocks.some(block => block.kind === "card"), entry.title);
    assert.ok(entry.blocks.some(block => block.kind === "decision"), entry.title);
  }
});

it("lists every declared task failure explicitly; the unlisted rule is reserved for failures outside those declarations", async () => {
  const workflow = await served();
  const spec = workflow.reviewSpec;
  assert.equal(spec.unlistedFailure, "Anything not listed stops the run with a failure card.");
  const dry = walk(spec, { "dry-run": "true" }).values;
  for (const group of workflow.timeline) {
    const decisions = blocks(spec, group.key, "decision");
    for (const node of workflow.nodes.filter(candidate => group.nodes.includes(candidate.id))) {
      for (const task of node.tasks) for (const code of task.errorCodes) {
        if (isUnlistedStorageFailure(failureCodeFromTaskCode(code))) continue;
        const decision = decisions.find(candidate => candidate.outcomes.some(outcome => outcome.value === code)); assert.ok(decision, `${group.label}: ${code}`);
        const outcome = decision.outcomes.find(candidate => candidate.value === code); assert.ok(outcome);
        assert.deepEqual([outcome.label, outcome.then, outcome.stops], [operatorFailureLabel(failureCodeFromTaskCode(code)), `${operatorFailureSentence(failureCodeFromTaskCode(code))} The run stops with a failure card.`, true]);
        const stopped = walk(spec, {}, { [decision.id]: code });
        assert.equal(stopped.stop?.value, code);
        assert.equal(stopped.steps.at(-1)?.id, group.key);
        if (task.arm !== "commit") assert.ok(applies(outcome, dry), `${task.taskId}: preparation/read failure still applies in a dry run`);
      }
      const commitOnly = node.tasks.flatMap(task => task.arm === "commit" ? task.errorCodes : [])
        .filter(code => !node.tasks.some(task => task.arm !== "commit" && task.errorCodes.includes(code)));
      for (const code of commitOnly) for (const decision of decisions) for (const outcome of decision.outcomes.filter(candidate => candidate.value === code)) {
        assert.equal(applies(outcome, dry), false, `${code}: a dry run never commits`);
      }
    }
    for (const decision of decisions) for (const outcome of decision.outcomes) {
      assert.ok(outcome.label.trim()); assert.ok(outcome.then.trim());
      assert.notEqual(outcome.label, "Anything else");
    }
  }
  const extraction = blocks(spec, "kuali-extraction", "decision")[0]; assert.ok(extraction);
  const missing = walk(spec, {}, { [extraction.id]: "document-not-in-action-list" });
  assert.equal(missing.stop?.value, "document-not-in-action-list");
  assert.deepEqual(missing.steps.map(entry => entry.id), ["reference-check", "kuali-extraction"]);
});

it("serves fictional examples and operator wording without task identifiers or failure-code text", async () => {
  const workflow = await served();
  const spec = workflow.reviewSpec;
  const text = [spec.unlistedFailure, ...spec.options.flatMap(option => [option.label, ...option.choices.map(choice => choice.label)]),
    ...spec.steps.flatMap(entry => [entry.title, ...entry.description.map(line => line.text), ...entry.checks.map(line => line.text),
      ...entry.blocks.flatMap(block => block.kind === "decision" ? [block.label, ...block.outcomes.flatMap(outcome => [outcome.label, outcome.then])]
        : block.kind === "click" ? [block.target] : block.kind === "starts" ? [block.title, block.each]
        : block.kind === "pick" ? [block.title, ...block.columns, ...block.rows.flatMap(row => row.cells)]
        : [block.title, ...block.rows.flatMap(row => [row.label, ...sampleValues(row.value)])])]),
    ...Object.values(spec.sources).flatMap(source => [source.origin, source.detail, ...source.reads.flatMap(read => [read.page, read.field])])].join("\n");
  assert.doesNotMatch(text, /nodeId|taskId|fieldPath|workflow:|INCONSISTENT_INPUTS/u);
  for (const node of workflow.nodes) for (const task of node.tasks) {
    assert.ok(!text.includes(task.taskId), task.taskId);
    for (const code of task.errorCodes) assert.ok(!text.includes(code), code);
  }
  const name = blocks(spec, "kuali-extraction", "card").flatMap(card => card.rows).find(row => row.label === "Employee"); assert.ok(name);
  assert.equal(name.value, "Quillan, Petra A.");
  const employeeId = blocks(spec, "ucpath-transaction", "card").flatMap(card => card.rows).find(row => row.label === "Employee ID"); assert.ok(employeeId);
  assert.equal(employeeId.value, "10000001");
  const dateRows = blocks(spec, "kronos-timecard", "card").flatMap(card => card.rows);
  assert.deepEqual(dateRows.filter(row => ["Last day worked", "Separation date", "Termination effective date"].includes(row.label)).map(row => row.value),
    ["4/25/2031", "4/26/2031", "4/27/2031"]);
});
