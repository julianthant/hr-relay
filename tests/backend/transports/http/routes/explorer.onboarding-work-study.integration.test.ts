import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { disposeHttpRouteHarness, harness } from "../../../../support/helpers/backend/http-route-harness.js";
import { WorkflowExplorerWireSchema } from "../../../../../src/models/dashboard/explorer.js";
import type { ExplorerReviewSpec, ExplorerSpecGate, ExplorerSpecValue } from "../../../../../src/models/dashboard/explorer-review-spec.js";
import { failureCodeFromTaskCode, operatorFailureSentence } from "../../../../../src/models/failures/error-catalog.js";
import { isUnlistedStorageFailure, operatorFailureLabel } from "../../../../../src/models/failures/failure-labels.js";

afterEach(disposeHttpRouteHarness);

async function served(id: string) {
  const h = await harness();
  const response = await h.app.request("http://localhost/api/v1/explorer");
  assert.equal(response.status, 200);
  const workflow = WorkflowExplorerWireSchema.parse(await response.json()).workflows.find(candidate => candidate.id === id);
  assert.ok(workflow, id);
  return workflow;
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
      assert.ok(outcome, `${block.id} has no applicable outcome`);
      values[block.id] = outcome.value;
      if (outcome.stops) return { values, steps, stop: outcome };
    }
  }
  return { values, steps };
}

it("serves Work Study's planned PayPath values, their origins and the live Save and Submit click", async () => {
  const { reviewSpec: spec } = await served("work-study");
  const skipChoices = [{ value: "run", label: "Runs" }, { value: "skip", label: "Skipped" }];
  assert.deepEqual(spec.options, [
    { id: "dry-run", label: "Dry run", choices: [{ value: "true", label: "On" }, { value: "false", label: "Off" }], initial: "false" },
    { id: "skip-ucpath-auth", label: "Sign in to UCPath", choices: skipChoices, initial: "run" },
    { id: "skip-transaction", label: "Submit work-study transaction", choices: skipChoices, initial: "run" },
  ]);
  assert.deepEqual(spec.sessions, [{ system: "ucpath", when: [{ "skip-ucpath-auth": ["run"] }, { "skip-transaction": ["run"] }] }]);
  assert.deepEqual(walk(spec).steps.map(entry => entry.id), ["reference-check", "ucpath-auth", "transaction"]);
  const [card] = blocks(spec, "transaction", "card"); assert.ok(card);
  assert.deepEqual([card.title, card.mode], ["PayPath Actions", "fill"]);
  assert.deepEqual(card.rows.map(row => [row.label, row.value]), [
    ["Effective date", "08/03/2026"], ["Position change reason", "JRL"], ["Position pool", "F"],
    ["Comments", "Updated pool id to F per work study award 08/03/2026"],
  ]);
  for (const row of card.rows) assert.ok(spec.sources[row.source]?.detail);
  assert.deepEqual(visible(blocks(spec, "transaction", "click"), walk(spec).values).map(click => click.target), ["Save and Submit"]);
  assert.deepEqual(visible(blocks(spec, "transaction", "click"), walk(spec, { "dry-run": "true" }).values), []);
  assert.deepEqual(walk(spec, { "skip-ucpath-auth": "skip" }).steps.map(entry => entry.id), ["reference-check", "transaction"]);
  assert.deepEqual(walk(spec, { "skip-transaction": "skip" }).steps.map(entry => entry.id), ["reference-check", "ucpath-auth"]);
});

it("offers Continue anyway or Cancel run for a field difference in either mode", async () => {
  const { reviewSpec: spec } = await served("work-study");
  const [check, approval] = blocks(spec, "reference-check", "decision"); assert.ok(check); assert.ok(approval);
  assert.deepEqual([check.id, approval.id], ["reference-result", "reference-check-review"]);
  assert.deepEqual(check.outcomes.slice(0, 2).map(outcome => outcome.value), ["null", "true"]);
  assert.deepEqual(approval.outcomes.map(outcome => [outcome.value, outcome.stops]), [["continue", false], ["cancelled", true]]);
  for (const dryRun of ["false", "true"]) {
    const stopped = walk(spec, { "dry-run": dryRun }, { "reference-result": "true", "reference-check-review": "cancelled" });
    assert.deepEqual(stopped.steps.map(entry => entry.id), ["reference-check"]);
    assert.equal(stopped.stop?.then, "Cancels the run at the reference review.");
    const continued = walk(spec, { "dry-run": dryRun }, { "reference-result": "true" });
    assert.equal(continued.values["reference-check-review"], "continue");
    assert.equal(continued.steps.at(-1)?.id, "transaction");
    if (dryRun === "true") assert.equal(continued.values["save-transaction"], "dry-run");
  }
});

it("names Onboarding's delegated I-9 workflow and follows every retained lookup result", async () => {
  const { reviewSpec: spec } = await served("onboarding");
  const [starts] = blocks(spec, "i9-search", "starts");
  assert.deepEqual(starts, { kind: "starts", workflowId: "i9-lookup", title: "I-9 Lookup", each: "Each person",
    when: [{ mode: ["new-hire"], "hire-match": ["new-hire", "review-required"], "i9-lookup-result": ["checked"] }] });
  const [lookup] = blocks(spec, "i9-search", "decision"); assert.ok(lookup);
  assert.deepEqual(lookup.outcomes.slice(0, 2).map(outcome => [outcome.value, outcome.label]), [["checked", "Lookup completed"], ["not-required", "Lookup not required"]]);
  const status = blocks(spec, "i9-search", "decision").find(decision => decision.id === "i9-status"); assert.ok(status);
  assert.deepEqual(status.outcomes.slice(0, 5).map(outcome => outcome.value), ["not-found", "signed", "unsigned", "historical", "unable-to-access"]);
  for (const dryRun of ["false", "true"]) for (const value of ["not-found", "signed", "unsigned", "historical", "unable-to-access"]) {
    const result = walk(spec, { "dry-run": dryRun }, { "i9-status": value });
    if (value === "unable-to-access") {
      assert.equal(result.stop?.value, "ONBOARDING_WRITE_REVIEW_REFUSED");
      assert.equal(result.steps.at(-1)?.id, "i9-creation");
      for (const id of ["i9-profile-save", "i9-remote-create", "hire-create", "concurrent-hire-create"]) assert.equal(result.values[id], undefined);
      for (const kind of ["card", "click"] as const) assert.deepEqual(visible(blocks(spec, "i9-creation", kind), result.values), []);
    } else {
      assert.equal(result.stop, undefined, value);
      assert.equal(result.values["write-path"], "new-hire", value);
      assert.equal(result.values["hire-create"], dryRun === "true" ? "dry-run" : "saved", value);
    }
  }
  const fresh = walk(spec);
  assert.equal(visible(lookup.outcomes, fresh.values).some(outcome => outcome.value === "not-required"), false);
  assert.equal(walk(spec, {}, { "i9-lookup-result": "not-required" }).values["i9-lookup-result"], "checked");
  const existing = walk(spec, {}, { "hire-match": "review-required", "i9-lookup-result": "checked", "i9-status": "unable-to-access", "hire-approval": "existing-person" });
  assert.equal(existing.stop, undefined);
  assert.equal(existing.values["concurrent-hire-create"], "saved");
  assert.equal(existing.values["i9-profile-save"], undefined);
  const skipped = walk(spec, {}, { "hire-match": "review-required", "i9-lookup-result": "not-required" });
  const approval = blocks(spec, "hire-review", "decision").find(block => block.id === "hire-approval"); assert.ok(approval);
  assert.equal(visible(approval.outcomes, skipped.values).some(outcome => outcome.value === "new-hire"), false);
  assert.equal(skipped.values["i9-lookup-child"], undefined);
  assert.deepEqual(visible(blocks(spec, "i9-search", "starts"), skipped.values), []);
  const child = blocks(spec, "i9-search", "decision").find(block => block.id === "i9-lookup-child"); assert.ok(child);
  assert.equal(child.label, "I-9 Lookup result");
  const failedChild = walk(spec, {}, { "i9-lookup-child": "child-failed" });
  assert.equal(failedChild.stop?.value, "child-failed");
  assert.equal(failedChild.steps.at(-1)?.id, "i9-search");
  assert.equal(failedChild.values["hire-approval"], undefined);
  assert.equal(walk(spec, { mode: "rehire" }).values["i9-lookup-child"], undefined);
  assert.equal(visible(blocks(spec, "i9-search", "starts"), walk(spec, { mode: "rehire" }).values).length, 0);
});

it("follows Onboarding's hire approval, rejection and existing-person path without presenting new-person writes", async () => {
  const { reviewSpec: spec } = await served("onboarding");
  assert.deepEqual(spec.options, [
    { id: "mode", label: "Hire mode", choices: [{ value: "new-hire", label: "New hire" }, { value: "rehire", label: "Rehire" }], initial: "new-hire" },
    { id: "dry-run", label: "Dry run", choices: [{ value: "true", label: "On" }, { value: "false", label: "Off" }], initial: "false" },
    ...[
      ["reference-check", "Reference spreadsheets"],
      ["crm-data", "Read and validate hire data"], ["ucpath-search", "Check UCPath duplicates"], ["i9-search", "Search I-9 profiles"],
      ["hire-review", "Review UCPath hire findings"], ["i9-creation", "Create or reuse the I-9 record"],
      ["ucpath-hire", "File and verify the UCPath hire"], ["master-results", "Fill verified master results"],
    ].map(([id, label]) => ({ id: `skip-${id}`, label, choices: [{ value: "run", label: "Runs" }, { value: "skip", label: "Skipped" }], initial: "run" })),
  ]);
  assert.deepEqual(spec.sessions.map(session => session.system).sort(), ["crm", "i9", "ucpath"]);
  const approval = blocks(spec, "hire-review", "decision").find(block => block.id === "hire-approval"); assert.ok(approval);
  assert.deepEqual(approval.outcomes.map(outcome => [outcome.value, outcome.stops]), [["new-hire", false], ["existing-person", false], ["cancelled", true]]);
  const rejected = walk(spec, {}, { "hire-approval": "cancelled" });
  assert.equal(rejected.steps.at(-1)?.id, "hire-review");
  assert.equal(rejected.stop?.then, "Cancels the run before any I-9 or UCPath change is saved.");
  const existing = walk(spec, { mode: "rehire" });
  assert.equal(existing.values["hire-approval"], "existing-person");
  assert.equal(existing.values["i9-route"], "existing");
  assert.deepEqual(visible(blocks(spec, "i9-creation", "card"), existing.values), []);
  assert.equal(existing.values["i9-profile-save"], undefined);
  assert.equal(existing.values["i9-remote-create"], undefined);
  assert.equal(existing.values["hire-create"], undefined);
  assert.equal(existing.values["concurrent-hire-create"], "saved");
  const switched = walk(spec, {}, { "hire-match": "existing-person", "hire-approval": "existing-person" });
  assert.equal(switched.values["i9-lookup-result"], "not-required");
  assert.equal(switched.values["i9-route"], "existing");
});

it("serves complete page cards with fictional examples and traceable sources on every Onboarding and Work Study step", async () => {
  for (const id of ["onboarding", "work-study"]) {
    const workflow = await served(id), spec = workflow.reviewSpec;
    assert.deepEqual(spec.steps.map(entry => [entry.id, entry.title]), workflow.timeline.map(group => [group.key, group.label]));
    for (const entry of spec.steps) {
      assert.ok(entry.description.length > 0, `${id}/${entry.id} needs a description`);
      for (const card of entry.blocks) if (card.kind === "card") {
        assert.ok(card.rows.length > 0, `${id}/${entry.id}/${card.id} is empty`);
        for (const row of card.rows) {
          assert.ok(row.value !== undefined, `${id}/${entry.id}/${card.id}/${row.id} needs an example`);
          assert.ok(spec.sources[row.source]?.origin, row.source);
          assert.ok(spec.sources[row.source]?.detail, row.source);
        }
      }
    }
    const visibleText = spec.steps.flatMap(entry => [entry.title, ...entry.description.map(line => line.text), ...entry.checks.map(line => line.text),
      ...entry.blocks.flatMap(block => block.kind === "card" ? [block.title, ...block.rows.map(row => row.label)]
        : block.kind === "decision" ? [block.label, ...block.outcomes.flatMap(outcome => [outcome.label, outcome.then])]
        : block.kind === "click" ? [block.target]
        : block.kind === "starts" ? [block.title, block.each]
        : [block.title, ...block.columns, ...block.rows.flatMap(row => row.cells), block.question.title, block.question.context,
          ...(block.other === undefined ? [] : [block.other.label, block.other.placeholder])])]).join(" ");
    assert.doesNotMatch(visibleText, /(?:workflow:|[A-Z]{2,}_[A-Z_]{2,}|Fixture|nodeId|taskId|write-plan)/u);
  }
});

it("explains the roster-row and existing-person picks with fictional rows and the questions Logs asks", async () => {
  const { reviewSpec: spec } = await served("onboarding");
  const [roster] = blocks(spec, "crm-data", "pick"); assert.ok(roster);
  assert.deepEqual(roster.columns, ["Email", "Legal name", "Preferred name"]);
  assert.deepEqual(roster.rows[0]?.cells, ["bea.morrow@example.test", "Morrow, Bea Avery", "Morrow, Bea Avery"]);
  assert.match(roster.question.context, /missing or has several/u);
  const [person] = visible(blocks(spec, "hire-review", "pick"), walk(spec, { mode: "rehire" }).values); assert.ok(person);
  assert.equal(person.title, "UCPath matches");
  assert.deepEqual(person.columns, ["Name", "Employee ID", "UCPath check"]);
  assert.deepEqual(person.rows[0], { cells: ["Morrow, Bea", "10000001", "Name needs your confirmation"], warning: true });
  assert.match(person.question.context, /confirm/u);
  assert.equal(person.other, undefined);
  assert.equal(visible(blocks(spec, "hire-review", "pick"), walk(spec).values).length, 0);
});

it("shows each step's system and only the personal fields and sample template of the chosen hire path", async () => {
  const { reviewSpec: spec } = await served("onboarding");
  assert.equal(blocks(spec, "i9-creation", "decision").find(block => block.id === "i9-route")?.label, "I-9 record path");
  assert.deepEqual(spec.steps.map(entry => entry.system), ["local", "crm", "ucpath", "i9", "ucpath", "i9", "ucpath", "local"]);
  assert.deepEqual(blocks(spec, "ucpath-search", "card").map(card => [card.title, card.mode]),
    [["Smart HR person search", "fill"], ["Smart HR person search results", "read"]]);
  const existing = walk(spec, { mode: "rehire" }).values, fresh = walk(spec).values;
  const personal = blocks(spec, "ucpath-hire", "card").find(card => card.id === "personal-data"); assert.ok(personal);
  assert.equal(visible(personal.rows, existing).length, 0);
  assert.ok(visible(personal.rows, fresh).some(row => row.label === "Legal first name"));
  const setup = blocks(spec, "ucpath-hire", "card").find(card => card.id === "hire-setup"); assert.ok(setup);
  const template = setup.rows.find(row => row.label === "Template"); assert.ok(template?.value);
  assert.equal(valueOf(template.value, existing), "UC_CONC_HIRE");
  assert.equal(valueOf(template.value, fresh), "UC_FULL_HIRE");
  const reason = setup.rows.find(row => row.label === "Action reason"); assert.ok(reason?.value);
  assert.equal(valueOf(reason.value, existing), "Concurrent Hire - Non Dual Emp");
  assert.equal(visible(setup.rows, fresh).some(row => row.label === "Employee ID"), false);
  for (const id of ["first-name", "last-name"]) {
    const source = spec.sources[`ucpath-search/person-match/${id}`]; assert.ok(source);
    assert.deepEqual(source.reads, [
      { system: "crm", step: "crm-data", page: "Onboarding roster", field: "Legal name" },
      { system: "crm", step: "crm-data", page: "CRM onboarding record", field: "First name" },
      { system: "crm", step: "crm-data", page: "CRM onboarding record", field: "Middle name" },
      { system: "crm", step: "crm-data", page: "CRM onboarding record", field: "Last name" },
    ]);
    assert.match(source.detail, /roster Legal name.*CRM.*anchors/u);
  }
  assert.deepEqual(spec.sources["ucpath-search/person-match/date-of-birth"]?.reads,
    [{ system: "crm", step: "crm-data", page: "CRM onboarding record", field: "Date of birth" }]);
  assert.deepEqual(spec.sources["i9-creation/new-employee/new-employee-first-name"]?.reads,
    [{ system: "crm", step: "crm-data", page: "Onboarding roster", field: "Legal name" }]);
});

it("reuses an already-filed transaction in live and dry runs, and stops at an unconfirmed save without presenting later writes or a retry", async () => {
  const { reviewSpec: study } = await served("work-study");
  const already = walk(study, {}, { "save-transaction": "already-present" });
  assert.equal(already.values["save-transaction"], "already-present");
  assert.equal(visible(blocks(study, "transaction", "click"), already.values).length, 0);
  const { reviewSpec: hire } = await served("onboarding");
  const reused = walk(hire, {}, { "hire-create": "already-present" });
  assert.equal(reused.values["hire-create"], "already-present");
  assert.equal(visible(blocks(hire, "ucpath-hire", "click"), reused.values).length, 0);
  assert.equal(reused.steps.at(-1)?.id, "master-results");
  const unknown = walk(hire, {}, { "i9-profile-save": "unconfirmed" });
  assert.equal(unknown.steps.at(-1)?.id, "i9-creation");
  assert.equal(unknown.stop?.value, "unconfirmed");
  assert.match(unknown.stop.then, /does not retry/u);
  assert.equal(unknown.values["i9-remote-create"], undefined);
  for (const id of ["onboarding", "work-study"]) {
    const { reviewSpec: spec } = await served(id);
    const dry = walk(spec, { "dry-run": "true" });
    for (const entry of dry.steps) for (const decision of blocks(spec, entry.id, "decision")) {
      if (!applies(decision, dry.values) || !decision.outcomes.some(outcome => outcome.value === "dry-run")) continue;
      assert.equal(dry.values[decision.id], "dry-run");
      assert.equal(visible(decision.outcomes, dry.values).some(outcome => ["saved", "unconfirmed"].includes(outcome.value)), false);
      assert.ok(visible(decision.outcomes, dry.values).some(outcome => outcome.value === "already-present"));
      assert.equal(walk(spec, { "dry-run": "true" }, { [decision.id]: "already-present" }).values[decision.id], "already-present");
    }
  }
});

it("finishes Onboarding with the master receipt's review outcome, and never presents a filed receipt or roster update in a dry run", async () => {
  const { reviewSpec: spec } = await served("onboarding");
  const result = blocks(spec, "master-results", "decision").find(block => block.id === "master-result-new"); assert.ok(result);
  assert.deepEqual(result.outcomes.slice(0, 3).map(outcome => outcome.value), ["applied", "resolve-required", "refused"]);
  for (const value of ["resolve-required", "refused"]) {
    const reviewed = walk(spec, {}, { "master-result-new": value });
    assert.equal(reviewed.values["master-result-new"], value);
    assert.match(result.outcomes.find(outcome => outcome.value === value)?.then ?? "", /Master needs review/u);
  }
  const existing = walk(spec, { mode: "rehire" }, { "master-result-existing": "resolve-required" });
  assert.equal(existing.values["master-result-existing"], "resolve-required");
  const dry = walk(spec, { "dry-run": "true" });
  assert.equal(dry.steps.some(entry => entry.id === "master-results"), false);
  assert.equal(visible(blocks(spec, "ucpath-hire", "card"), dry.values).some(card => card.id === "hire-receipt"), false);
  const unconfirmed = walk(spec, { mode: "rehire" }, { "reference-result": "true", "reference-check-review": "cancelled" });
  assert.equal(unconfirmed.steps.at(-1)?.id, "reference-check");
});

it("lists every declared task failure deliberately; only undeclared failures use the unlisted-failure rule", async () => {
  for (const id of ["onboarding", "work-study"]) {
    const workflow = await served(id), spec = workflow.reviewSpec;
    for (const group of workflow.timeline) {
      const outcomes = blocks(spec, group.key, "decision").flatMap(block => block.outcomes);
      for (const node of workflow.nodes.filter(node => group.nodes.includes(node.id))) for (const task of node.tasks) for (const code of task.errorCodes) {
        if (isUnlistedStorageFailure(failureCodeFromTaskCode(code))) continue;
        const outcome = outcomes.find(outcome => outcome.value === code); assert.ok(outcome, `${id}/${group.key}/${code}`);
        assert.equal(outcome.stops, true);
        assert.equal(outcome.then, `${operatorFailureSentence(failureCodeFromTaskCode(code))} The run stops with a failure card.`);
        assert.equal(outcome.label, operatorFailureLabel(failureCodeFromTaskCode(code)));
      }
    }
    assert.equal(spec.unlistedFailure, "Anything not listed stops the run with a failure card.");
    for (const mode of id === "onboarding" ? ["new-hire", "rehire"] : [""]) for (const dryRun of ["true", "false"]) {
      assert.ok(walk(spec, { mode, "dry-run": dryRun }).steps.length > 0);
    }
  }
});
