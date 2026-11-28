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
  return WorkflowExplorerWireSchema.parse(await response.json()).workflows;
}

async function review(id: string): Promise<ExplorerReviewSpec> {
  const workflow = (await served()).find(candidate => candidate.id === id);
  assert.ok(workflow, id);
  return workflow.reviewSpec;
}

type Values = Readonly<Record<string, string>>;
const applies = (gate: ExplorerSpecGate, values: Values): boolean => gate.when === undefined
  || gate.when.some(alternative => Object.entries(alternative).every(([key, allowed]) => values[key] !== undefined && allowed.includes(values[key])));
const valueOf = (value: ExplorerSpecValue, values: Values): string =>
  typeof value === "string" ? value : value.values[values[value.by] ?? ""] ?? value.otherwise;
const visible = <Item extends ExplorerSpecGate>(items: readonly Item[], values: Values): Item[] => items.filter(item => applies(item, values));
const step = (spec: ExplorerReviewSpec, id: string) => {
  const found = spec.steps.find(candidate => candidate.id === id); assert.ok(found, id); return found;
};
const blocks = <Kind extends ExplorerReviewSpec["steps"][number]["blocks"][number]["kind"]>(spec: ExplorerReviewSpec, stepId: string, kind: Kind) =>
  step(spec, stepId).blocks.filter((block): block is Extract<typeof block, { kind: Kind }> => block.kind === kind);

function walk(spec: ExplorerReviewSpec, chosen: Values = {}, decisions: Values = {}) {
  const values: Record<string, string> = {};
  for (const option of spec.options) if (applies(option, values)) values[option.id] = chosen[option.id] ?? valueOf(option.initial, values);
  const steps: ExplorerReviewSpec["steps"][number][] = [];
  for (const entry of spec.steps) {
    if (!applies(entry, values)) continue;
    steps.push(entry);
    for (const block of entry.blocks) {
      if (block.kind !== "decision" || !applies(block, values)) continue;
      const outcomes = visible(block.outcomes, values);
      const outcome = outcomes.find(candidate => candidate.value === decisions[block.id])
        ?? outcomes.find(candidate => candidate.value === valueOf(block.initial, values));
      assert.ok(outcome, `${block.id} has an applicable initial outcome`);
      values[block.id] = outcome.value;
      if (outcome.stops) return { values, steps, stop: outcome };
    }
  }
  return { values, steps };
}

it("serves the PDF parent's current Start run options, sessions and starts for each attached PDF and approved person", async () => {
  const spec = await review("i9-check-start");
  assert.deepEqual(spec.options, [{ id: "dry-run", label: "Dry run", initial: "false",
    choices: [{ value: "true", label: "On" }, { value: "false", label: "Off" }] },
  ...[
    ["documents", "Read and approve PDFs"], ["roster-reference", "Look up in roster"],
    ["retention", "Check retention and collect results"], ["publication", "Save results and append to the tracker"],
  ].map(([key, label]) => ({ id: `skip-${key}`, label, initial: "run", choices: [{ value: "run", label: "Runs" }, { value: "skip", label: "Skipped" }] }))]);
  assert.deepEqual(spec.sessions.map(session => session.system).sort(), ["crm", "i9", "ucpath"]);
  assert.deepEqual(spec.steps.map(step => step.title), ["Read and approve PDFs", "Look up in roster", "Check retention and collect results", "Save results and append to the tracker"]);
  const starts = spec.steps.flatMap(step => step.blocks).filter(block => block.kind === "starts");
  assert.deepEqual(starts, [
    { kind: "starts", workflowId: "ocr", title: "OCR", each: "Each attached PDF" },
    { kind: "starts", workflowId: "i9-check", title: "I-9 Check person", each: "Each approved person" },
  ]);
});

it("explains PDF record approval before any person check and previews publication in a dry run", async () => {
  const spec = await review("i9-check-start");
  const docs = step(spec, "documents");
  assert.ok(docs.description.some(line => /review and approve/u.test(line.text)));
  assert.deepEqual(blocks(spec, "documents", "card").flatMap(card => card.rows).map(row => [row.label, row.value]), [
    ["PDF", "fictional-i9-packet.pdf"], ["Approved person", "Morrow, Bea"], ["Employee ID", "10000001"],
  ]);
  assert.ok(step(spec, "roster-reference").checks.some(line => /captured/u.test(line.text)));
  assert.deepEqual(blocks(spec, "roster-reference", "card")[0]?.rows.map(row => row.label), ["Reference version", "Employee ID", "PPS ID", "Separation date"]);
  const refused = walk(spec, {}, { "document-review": "refused" });
  assert.equal(refused.stop?.then, "Stops before the roster or person checks; resolve the PDF review in Logs.");
  assert.deepEqual(refused.steps.map(entry => entry.id), ["documents"]);
  const live = walk(spec);
  assert.equal(live.values["results-publication"], "saved");
  assert.ok(visible(step(spec, "publication").description, live.values).some(line => /Save one results workbook/u.test(line.text)));
  const dry = walk(spec, { "dry-run": "true" });
  assert.equal(dry.values["results-publication"], "dry-run");
  assert.ok(!visible(step(spec, "publication").description, dry.values).some(line => /Save one results workbook/u.test(line.text)));
  assert.ok(visible(step(spec, "publication").checks, dry.values).some(line => /without saving.*tracker/u.test(line.text)));
  assert.deepEqual(dry.steps.map(entry => entry.id), live.steps.map(entry => entry.id));
});

it("follows the person's identifier result through the conditional hire-date search and every retention outcome", async () => {
  const spec = await review("i9-check");
  assert.deepEqual(spec.options, [["skip-person-match", "Match person"], ["skip-person-lookup", "Check hire date"]].map(([id, label]) => ({
    id, label, initial: "run", choices: [{ value: "run", label: "Runs" }, { value: "skip", label: "Skipped" }],
  })));
  assert.deepEqual(spec.sessions, [{ system: "ucpath" }, { system: "crm" }]);
  assert.deepEqual(walk(spec).steps.map(entry => entry.id), ["reference-check", "person-match", "roster-match"]);
  for (const identity of ["ambiguous", "not-found"]) {
    const lookup = walk(spec, {}, { "identifier-result": identity, "hire-date-needed": "true" });
    assert.deepEqual(lookup.steps.map(entry => entry.id), ["reference-check", "person-match", "person-lookup", "roster-match"]);
  }
  assert.equal(walk(spec, {}, { "hire-date-needed": "true" }).values["hire-date-needed"], "false");
  assert.equal(walk(spec, {}, { "identifier-result": "ambiguous" }).values["hire-date-needed"], "true");
  assert.deepEqual(blocks(spec, "person-match", "card").map(card => [card.title, card.mode]), [
    ["Smart HR person search", "fill"], ["Person Organizational Summary search", "fill"], ["Person Organizational Summary results", "read"],
    ["Person Organizational Summary detail", "read"],
  ]);
  assert.deepEqual(blocks(spec, "person-lookup", "click").map(click => click.target), ["Search"]);
  const retention = blocks(spec, "roster-match", "decision");
  assert.deepEqual(retention.map(decision => [decision.id, decision.initial]), [["retention-identity", "found"],
    ["retention-action", { by: "retention-identity", values: { "not-found": "Shred", ambiguous: "" }, otherwise: "Keep" }]]);
  for (const value of ["found", "not-found", "ambiguous"]) {
    const selected = walk(spec, {}, { "retention-identity": value });
    assert.equal(selected.values["retention-identity"], value);
    assert.equal(selected.stop, undefined);
    assert.equal(selected.steps.at(-1)?.id, "roster-match");
  }
  for (const value of ["", "Keep", "Shred"]) {
    const outcome = retention.find(decision => decision.id === "retention-action")?.outcomes.find(candidate => candidate.value === value);
    assert.ok(outcome, value);
    assert.ok(outcome.then.trim(), value);
    assert.equal(outcome.stops, false);
  }
  const checks = blocks(spec, "reference-check", "decision")[0]; assert.ok(checks);
  assert.deepEqual(checks.outcomes.filter(outcome => ["null", "true"].includes(outcome.value)).map(outcome => [outcome.value, outcome.stops]),
    [["null", false], ["true", false]]);
});

it("shows confirmed identity rows only for an identifier match and the name search's own results on the name-only path", async () => {
  const spec = await review("i9-check");
  const shownCards = (values: Values) => visible(blocks(spec, "person-match", "card"), values).map(card => [card.title, visible(card.rows, values).map(row => row.label)]);
  const found = walk(spec);
  assert.equal(found.values["identifier-result"], "found");
  assert.deepEqual(shownCards(found.values).at(-1), ["Person Organizational Summary detail", ["Employee ID", "Confirmed name"]]);
  const nameOnly = walk(spec, {}, { "identifier-result": "not-found" });
  assert.equal(nameOnly.values["hire-date-needed"], "false");
  assert.deepEqual(nameOnly.steps.map(entry => entry.id), ["reference-check", "person-match", "roster-match"]);
  assert.deepEqual(shownCards(nameOnly.values).at(-1), ["Person Organizational Summary results", ["Hire date", "Employee ID"]]);
  assert.ok(!shownCards(nameOnly.values).some(([title]) => title === "Person Organizational Summary detail"));
  const ambiguous = walk(spec, {}, { "identifier-result": "ambiguous" });
  assert.ok(!shownCards(ambiguous.values).some(([title]) => title === "Person Organizational Summary detail" || title === "Person Organizational Summary results"));
  const decision = blocks(spec, "person-match", "decision").find(candidate => candidate.id === "hire-date-needed"); assert.ok(decision);
  const continuing = (values: Values) => visible(decision.outcomes, values).filter(outcome => !outcome.stops).map(outcome => outcome.value);
  assert.deepEqual(continuing(found.values), ["false"]);
  assert.deepEqual(continuing(ambiguous.values), ["true"]);
  assert.deepEqual(continuing(nameOnly.values), ["false", "true"]);
});

it("only offers a reference review when a resolved field differs", async () => {
  const spec = await review("i9-check");
  const [comparison, approval] = blocks(spec, "reference-check", "decision"); assert.ok(comparison); assert.ok(approval);
  for (const identity of ["not-found", "ambiguous", "found"]) {
    const selected = walk(spec, {}, { "retention-identity": identity });
    assert.equal(selected.values["reference-result"], "null");
    assert.equal(selected.values["reference-check-review"], undefined);
  }
  const mismatch = walk(spec, {}, { "reference-result": "true", "reference-check-review": "cancelled" });
  assert.equal(mismatch.values["reference-check-review"], "cancelled");
  assert.equal(mismatch.stop?.value, "cancelled");
});

it("defaults the retention recommendation to Shred for nobody found and manual review for an ambiguous identity", async () => {
  const spec = await review("i9-check");
  for (const [identity, action, label] of [["found", "Keep", "Keep"], ["not-found", "Shred", "Shred"], ["ambiguous", "", "Manual review"]] as const) {
    const selected = walk(spec, {}, { "retention-identity": identity });
    assert.equal(selected.values["retention-action"], action);
    const card = blocks(spec, "roster-match", "card")[0]; assert.ok(card);
    const row = card.rows.find(candidate => candidate.label === "Retention action"); assert.ok(row?.value);
    assert.equal(valueOf(row.value, selected.values), label);
    assert.equal(visible(card.rows, selected.values).some(candidate => candidate.label === "Employee ID"), identity === "found");
    const decision = blocks(spec, "roster-match", "decision").find(candidate => candidate.id === "retention-action"); assert.ok(decision);
    assert.deepEqual(visible(decision.outcomes, selected.values).filter(outcome => !outcome.stops).map(outcome => outcome.value), identity === "found" ? ["Keep", "Shred", ""] : [action]);
  }
});

it("serves the I-9 Lookup search and every Section 2 status without inventing a person-pick gate", async () => {
  const spec = await review("i9-lookup");
  assert.deepEqual(spec.options, [{ id: "skip-lookup", label: "Look up Section 2 signer", initial: "run",
    choices: [{ value: "run", label: "Runs" }, { value: "skip", label: "Skipped" }] }]);
  assert.deepEqual(spec.sessions, [{ system: "i9", when: [{ "skip-lookup": ["run"] }] }]);
  assert.deepEqual(visible(spec.sessions, { "skip-lookup": "skip" }), []);
  assert.deepEqual(blocks(spec, "lookup", "click").map(click => click.target), ["Search Options", "Clear Search Filters & Results", "Search"]);
  const cards = blocks(spec, "lookup", "card");
  assert.deepEqual(cards[0]?.rows.map(row => [row.label, row.value]), [["Last name", "Morrow"], ["First name", "Bea"]]);
  const decision = blocks(spec, "lookup", "decision")[0]; assert.ok(decision);
  assert.deepEqual([decision.id, decision.label, decision.initial], ["signer-status", "Section 2 result", "signed"]);
  assert.deepEqual(decision.outcomes.filter(outcome => !outcome.stops).map(outcome => [outcome.value, outcome.label]), [
    ["signed", "Signed"], ["unsigned", "Unsigned"], ["historical", "Historical"], ["not-found", "Not found"], ["unable-to-access", "Unable to access"],
  ]);
  for (const status of ["signed", "unsigned", "historical", "not-found", "unable-to-access"]) {
    const selected = walk(spec, {}, { "signer-status": status });
    assert.equal(selected.stop, undefined);
    const shown = visible(cards, selected.values);
    const signer = shown.flatMap(card => visible(card.rows, selected.values)).find(row => row.label === "Authorized official signer");
    assert.equal(signer !== undefined, status === "signed");
    const row = shown.flatMap(card => card.rows).find(candidate => candidate.label === "I-9 status"); assert.ok(row?.value);
    assert.equal(valueOf(row.value, selected.values), decision.outcomes.find(outcome => outcome.value === status)?.label);
    assert.ok(decision.outcomes.find(outcome => outcome.value === status)?.then.trim());
  }
  const ambiguous = walk(spec, {}, { "signer-status": "I9_LOOKUP_AMBIGUOUS" });
  assert.equal(ambiguous.stop?.stops, true);
  assert.equal(ambiguous.stop?.then, `${operatorFailureSentence("I9_LOOKUP_AMBIGUOUS")} The run stops with a failure card.`);
  assert.equal(ambiguous.stop?.label, operatorFailureLabel("I9_LOOKUP_AMBIGUOUS"));
  assert.ok(spec.steps.every(entry => entry.blocks.every(block => ["card", "click", "decision"].includes(block.kind))));
});

it("shows the extra name as Fill and hire-date evidence as Read, hiding identifier confirmation when another lookup is needed", async () => {
  const spec = await review("i9-check");
  const selected = walk(spec, {}, { "identifier-result": "ambiguous", "hire-date-needed": "true" });
  assert.deepEqual(blocks(spec, "person-lookup", "card").map(card => [card.title, card.mode, card.rows.map(row => row.label)]), [
    ["Person Organizational Summary search", "fill", ["Name"]],
    ["Person Organizational Summary detail", "read", ["Hire date", "Employee ID"]],
  ]);
  assert.ok(!visible(blocks(spec, "person-match", "card"), selected.values).some(card => card.title === "Person Organizational Summary detail"));
});

const STEP_SYSTEMS: Readonly<Record<string, readonly (string | undefined)[]>> = {
  "i9-check-start": [undefined, undefined, "ucpath", undefined], "i9-check": ["local", "ucpath", "ucpath", undefined], "i9-lookup": ["i9"],
};

it("serves each step's Logs title, description, checks and complete fictional page rows with traceable sources", async () => {
  for (const workflow of (await served()).filter(candidate => ["i9-check-start", "i9-check", "i9-lookup"].includes(candidate.id))) {
    const spec = workflow.reviewSpec;
    assert.deepEqual(spec.steps.map(entry => [entry.id, entry.title]), workflow.timeline.map(group => [group.key, group.label]));
    // A step without its own system shows the one system its tasks or the workflow it starts sign in to.
    assert.deepEqual(spec.steps.map(entry => entry.system), STEP_SYSTEMS[workflow.id]);
    for (const entry of spec.steps) {
      assert.ok(entry.description.some(line => line.text.trim()), entry.title);
      assert.ok(entry.checks.length > 0, entry.title);
      const cards = blocks(spec, entry.id, "card");
      assert.ok(cards.length > 0, entry.title);
      assert.ok(blocks(spec, entry.id, "decision").length > 0, entry.title);
      for (const card of cards) {
        assert.ok(card.rows.length > 0, card.title);
        for (const row of card.rows) {
          assert.ok(row.value !== undefined, `${entry.title}/${card.title}/${row.label}`);
          const values = typeof row.value === "string" ? [row.value] : [...Object.values(row.value.values), row.value.otherwise];
          assert.ok(values.every(value => value.trim()), row.label);
          const source = spec.sources[row.source]; assert.ok(source, row.source);
          assert.ok(source.origin?.trim(), row.label); assert.ok(source.detail?.trim(), row.label);
          for (const read of source.reads) assert.ok(spec.steps.some(candidate => candidate.id === read.step));
        }
      }
    }
  }
});

it("lists every declared task failure explicitly; only undeclared failures deliberately use the unlisted-failure rule", async () => {
  for (const workflow of (await served()).filter(candidate => ["i9-check-start", "i9-check", "i9-lookup"].includes(candidate.id))) {
    const spec = workflow.reviewSpec;
    assert.equal(spec.unlistedFailure, "Anything not listed stops the run with a failure card.");
    for (const group of workflow.timeline) {
      const decisions = blocks(spec, group.key, "decision");
      for (const node of workflow.nodes.filter(candidate => group.nodes.includes(candidate.id))) for (const task of node.tasks) for (const code of task.errorCodes) {
        if (isUnlistedStorageFailure(failureCodeFromTaskCode(code))) continue;
        const decision = decisions.find(candidate => candidate.outcomes.some(outcome => outcome.value === code)); assert.ok(decision, `${group.label}: ${code}`);
        const outcome = decision.outcomes.find(candidate => candidate.value === code); assert.ok(outcome);
        assert.deepEqual([outcome.label, outcome.then, outcome.stops], [operatorFailureLabel(failureCodeFromTaskCode(code)), `${operatorFailureSentence(failureCodeFromTaskCode(code))} The run stops with a failure card.`, true]);
        const stopped = walk(spec, {}, { "identifier-result": "ambiguous", "hire-date-needed": "true", [decision.id]: code });
        assert.equal(stopped.stop?.value, code); assert.equal(stopped.steps.at(-1)?.id, group.key);
      }
      for (const decision of decisions) for (const outcome of decision.outcomes) {
        assert.ok(outcome.label.trim()); assert.ok(outcome.then.trim()); assert.notEqual(outcome.label, "Anything else");
      }
    }
  }
});

it("keeps operator prose and samples free of task names, failure codes and Social Security numbers", async () => {
  for (const workflow of (await served()).filter(candidate => ["i9-check-start", "i9-check", "i9-lookup"].includes(candidate.id))) {
    const spec = workflow.reviewSpec;
    const text = JSON.stringify([
      spec.unlistedFailure, spec.options.map(option => [option.label, option.choices.map(choice => choice.label)]),
      spec.steps.map(entry => [entry.title, entry.description.map(line => line.text), entry.checks.map(line => line.text), entry.blocks.map(block =>
        block.kind === "card" ? [block.title, block.rows.map(row => [row.label, row.value])]
          : block.kind === "decision" ? [block.label, block.outcomes.map(outcome => [outcome.label, outcome.then])]
            : block.kind === "starts" ? [block.title, block.each]
              : block.kind === "pick" ? [block.title, block.columns, block.rows.map(row => row.cells), block.other?.label, block.other?.placeholder,
                block.question.title, block.question.context]
                : block.target)]),
      Object.values(spec.sources).map(source => [source.origin, source.detail, source.reads.map(read => [read.page, read.field])]),
    ]);
    assert.doesNotMatch(text, /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b|Battistessa|Johnnie|workflow:|read-people|read-requests|match-outcome|lookup-source/u);
    for (const node of workflow.nodes) for (const task of node.tasks) {
      assert.ok(!text.includes(task.taskId), task.taskId);
      for (const code of task.errorCodes) assert.ok(!text.includes(code), code);
    }
  }
});
