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

async function review(id: string) {
  const workflow = (await served()).find(candidate => candidate.id === id); assert.ok(workflow, id);
  return workflow.reviewSpec;
}
type Values = Readonly<Record<string, string>>;
const applies = (gate: ExplorerSpecGate, values: Values) => gate.when === undefined
  || gate.when.some(alternative => Object.entries(alternative).every(([key, allowed]) => allowed.includes(values[key] ?? "")));
const valueOf = (value: ExplorerSpecValue, values: Values): string => typeof value === "string" ? value : value.values[values[value.by] ?? ""] ?? value.otherwise;
function walk(spec: ExplorerReviewSpec, chosen: Values = {}) {
  const values: Record<string, string> = {};
  for (const option of spec.options) if (applies(option, values)) values[option.id] = chosen[option.id] ?? valueOf(option.initial, values);
  const steps: string[] = [];
  for (const step of spec.steps) {
    if (!applies(step, values)) continue;
    steps.push(step.id);
    for (const block of step.blocks) {
      if (block.kind !== "decision" || !applies(block, values)) continue;
      const outcomes = block.outcomes.filter(outcome => applies(outcome, values));
      const outcome = outcomes.find(candidate => candidate.value === chosen[block.id]) ?? outcomes.find(candidate => candidate.value === valueOf(block.initial, values));
      assert.ok(outcome, block.id);
      values[block.id] = outcome.value;
      if (outcome.stops) return { steps, values, stop: outcome };
    }
  }
  return { steps, values, stop: undefined };
}
const blocks = <Kind extends ExplorerReviewSpec["steps"][number]["blocks"][number]["kind"]>(spec: ExplorerReviewSpec, stepId: string, kind: Kind) => {
  const step = spec.steps.find(step => step.id === stepId); assert.ok(step, stepId);
  return step.blocks.filter((block): block is Extract<typeof block, { kind: Kind }> => block.kind === kind);
};
const outcome = (spec: ExplorerReviewSpec, stepId: string, value: string) => {
  const found = blocks(spec, stepId, "decision").flatMap(decision => decision.outcomes).find(outcome => outcome.value === value);
  assert.ok(found, `${stepId}/${value}`);
  return found;
};

it("serves PDF-start choices with OCR enabled and the filing choice unset", async () => {
  const workflow = (await served()).find(candidate => candidate.id === "emergency-contact"); assert.ok(workflow);
  assert.deepEqual(workflow.reviewSpec.options, [
    { id: "onbaseFiling", label: "File to OnBase", initial: "unselected", choices: [
      { value: "unselected", label: "Choose…" }, { value: "file", label: "File" }, { value: "skip", label: "Do not file" },
    ] },
    { id: "extractWithOcr", label: "Extract with OCR", initial: "true", choices: [{ value: "true", label: "On" }, { value: "false", label: "Off" }] },
    { id: "dry-run", label: "Dry run", initial: "false", choices: [{ value: "true", label: "On" }, { value: "false", label: "Off" }] },
  ]);
});

it("retains failed pages and members for review, while a failed document stops before contacts start", async () => {
  const parent = await review("emergency-contact");
  assert.deepEqual(walk(parent, { "read-document": "child-failed" }).steps, ["read-document"]);
  assert.equal(walk(parent, { members: "child-failed" }).stop, undefined);
  assert.match(outcome(parent, "members", "child-failed").then, /failed person.*Logs/u);
  const ocr = await review("ocr");
  assert.equal(walk(ocr, { "read-pages": "child-failed" }).stop, undefined);
  assert.match(outcome(ocr, "page-readings", "child-failed").then, /failed page.*review/u);
  assert.match(outcome(ocr, "approval", "waits").then, /approve.*records/u);
  assert.equal(walk(ocr, { "approve-records": "cancelled" }).stop?.value, "cancelled");
});

it("explains locked approved contacts, an unconfirmed Save and filing-only retry without saving the contact twice", async () => {
  const member = await review("emergency-contact-member");
  const invalid = outcome(member, "contact-plan", "CONTACT_APPROVED_FIELDS_INVALID");
  assert.equal(invalid.stops, true);
  for (const value of ["CONTACT_APPROVED_FIELDS_INVALID", "relationship-unmapped", "address-choice-unresolved"]) {
    const rejected = outcome(member, "contact-plan", value);
    assert.equal(rejected.stops, true);
    assert.match(rejected.then, /before Save.*locked for this run.*operator.*retrying this person cannot change the approved record/u);
  }
  assert.deepEqual(walk(member, { "contact-plan-result": "CONTACT_APPROVED_FIELDS_INVALID", onbaseFiling: "file" }).steps, ["contact-plan"]);
  const mismatch = outcome(member, "contact-preview", "saved-effect-mismatch");
  assert.equal(mismatch.stops, true);
  assert.match(mismatch.then, /does not retry.*Save/u);
  assert.deepEqual(walk(member, { "contact-preview": "unconfirmed", onbaseFiling: "file" }).steps, ["contact-plan", "reference-check", "contact-preview"]);
  const held = outcome(member, "onbase-filing", "child-failed");
  assert.equal(held.stops, true);
  assert.match(held.then, /Retry.*filing alone.*without another Save/u);
  assert.equal(walk(member, { "onbase-filing": "child-failed", onbaseFiling: "file" }).stop?.value, "child-failed");
  assert.equal(walk(member, { "contact-preview": "already-present", onbaseFiling: "file" }).stop, undefined);
  const onbase = await review("onbase");
  assert.match(outcome(onbase, "import-document", "ONBASE_IMPORT_UNPROVED").then, /uncertain.*not retried/u);
  assert.equal(walk(onbase, { "import-document": "unconfirmed" }).stop?.value, "unconfirmed");
  assert.equal(walk(onbase, { "dry-run": "true" }).values["import-document"], "dry-run");
});

it("asks for unconfirmed reference spreadsheets only before a live Save, with Continue anyway and Cancel run", async () => {
  const member = await review("emergency-contact-member");
  const gate = blocks(member, "reference-check", "decision").find(decision => decision.id === "reference-review"); assert.ok(gate);
  assert.equal(applies(gate, { "dry-run": "false", "reference-result": "unconfirmed" }), true);
  assert.equal(applies(gate, { "dry-run": "true", "reference-result": "unconfirmed" }), false);
  assert.equal(applies(gate, { "dry-run": "false", "reference-result": "confirmed" }), false);
  assert.deepEqual(gate.outcomes.filter(outcome => ["continue", "cancelled"].includes(outcome.value)).map(outcome => [outcome.label, outcome.stops]), [["Continue anyway", false], ["Cancel run", true]]);
  const cancelled = walk(member, { "reference-result": "unconfirmed", "reference-review": "cancelled", onbaseFiling: "file" });
  assert.deepEqual(cancelled.steps, ["contact-plan", "reference-check"]);
  assert.equal(walk(member, { "reference-result": "unconfirmed", "reference-review": "continue", onbaseFiling: "file" }).stop, undefined);
});

it("serves all four member skip choices and prevents either write on the skipped-plan path", async () => {
  const member = await review("emergency-contact-member");
  assert.deepEqual(member.options.filter(({ id }) => id.startsWith("skip-")).map(({ id, initial }) => [id, initial]), [
    ["skip-contact-plan", "run"], ["skip-reference-check", "run"], ["skip-contact-preview", "run"], ["skip-onbase-filing", "run"],
  ]);
  assert.deepEqual(walk(member, { onbaseFiling: "file", "skip-contact-plan": "skip" }).steps, ["reference-check"]);
  assert.deepEqual(walk(member, { onbaseFiling: "file", "skip-contact-preview": "skip" }).steps, ["contact-plan", "reference-check", "onbase-filing"]);
  assert.deepEqual(walk(member, { onbaseFiling: "file", "skip-onbase-filing": "skip" }).steps, ["contact-plan", "reference-check", "contact-preview"]);
});

it("names every delegated workflow and its document, person or page scope, with filing sessions following the parent's declared choice", async () => {
  const parent = await review("emergency-contact");
  assert.deepEqual(blocks(parent, "read-document", "starts"), [{ kind: "starts", workflowId: "ocr", title: "OCR", each: "This PDF" }]);
  assert.deepEqual(blocks(parent, "members", "starts"), [{ kind: "starts", workflowId: "emergency-contact-member", title: "Emergency Contact member", each: "Each approved person" }]);
  assert.deepEqual(parent.sessions.filter(session => applies(session, { onbaseFiling: "skip" })).map(session => session.system), ["ucpath", "crm", "i9"]);
  assert.deepEqual(parent.sessions.filter(session => applies(session, { onbaseFiling: "file" })).map(session => session.system), ["ucpath", "crm", "i9", "onbase"]);
  const member = await review("emergency-contact-member");
  assert.deepEqual(member.options.find(option => option.id === "onbaseFiling"), parent.options.find(option => option.id === "onbaseFiling"));
  assert.deepEqual(walk(member, { onbaseFiling: "skip" }).steps, ["contact-plan", "reference-check", "contact-preview"]);
  assert.deepEqual(walk(member, { onbaseFiling: "file" }).steps, ["contact-plan", "reference-check", "contact-preview", "onbase-filing"]);
  assert.deepEqual(blocks(member, "onbase-filing", "starts").map(block => [block.workflowId, block.title, block.each]), [["onbase", "OnBase Emergency Contact", "This person's first source page, unless already filed"]]);
  const ocr = await review("ocr");
  assert.deepEqual(blocks(ocr, "page-readings", "starts").map(block => [block.workflowId, block.title, block.each]), [["ocr-page", "OCR Page", "Each original page"]]);
  assert.deepEqual(blocks(ocr, "identity-lookups", "starts").map(block => [block.workflowId, block.each]), [["person-lookup", "Each proposed person"]]);
  assert.deepEqual(blocks(ocr, "signer-lookups", "starts").map(block => [block.workflowId, block.each]), [["i9-lookup", "Each proposed official signer"]]);
});

it("serves all five workflows with Logs titles, descriptions, complete fictional page rows, sources and live-only Save or Import clicks", async () => {
  const workflows = (await served()).filter(workflow => ["emergency-contact", "emergency-contact-member", "ocr", "ocr-page", "onbase"].includes(workflow.id));
  assert.equal(workflows.length, 5);
  for (const workflow of workflows) {
    assert.deepEqual(workflow.reviewSpec.steps.map(step => [step.id, step.title, step.system]), workflow.timeline.map(step => [step.key, step.label, step.system]));
    for (const step of workflow.reviewSpec.steps) {
      assert.ok(step.description.length > 0, `${workflow.id}/${step.id} description`);
      for (const block of step.blocks) if (block.kind === "card") for (const row of block.rows) {
        assert.ok(row.value !== undefined, `${workflow.id}/${step.id}/${row.id} sample`);
        const source = workflow.reviewSpec.sources[row.source]; assert.ok(source, row.source);
        assert.ok(source.origin.length > 0 && source.detail.length > 0);
      }
    }
  }
  const member = workflows.find(workflow => workflow.id === "emergency-contact-member"); assert.ok(member);
  const fill = blocks(member.reviewSpec, "contact-preview", "card")[0]; assert.ok(fill);
  assert.equal(fill.mode, "fill");
  assert.deepEqual(fill.rows.slice(0, 4).map(row => [row.label, row.value]), [["Contact name", "Example Contact"], ["Relationship", "Parent"], ["Phone", "202-555-0148"], ["Primary contact", "Yes"]]);
  const save = blocks(member.reviewSpec, "contact-preview", "click");
  assert.deepEqual(save.filter(block => applies(block, { "dry-run": "false", "contact-preview": "saved" })).map(block => block.target), ["Save"]);
  assert.deepEqual(save.filter(block => applies(block, { "dry-run": "true", "contact-preview": "dry-run" })), []);
  const onbase = workflows.find(workflow => workflow.id === "onbase"); assert.ok(onbase);
  const importClicks = blocks(onbase.reviewSpec, "import-document", "click");
  assert.deepEqual(importClicks.filter(block => applies(block, { "dry-run": "false", "import-document": "saved" })).map(block => block.target), ["Import"]);
  assert.deepEqual(importClicks.filter(block => applies(block, { "dry-run": "true", "import-document": "dry-run" })), []);
});

it("serves no staging or Save/Import click when the change is already present, since nothing is saved again", async () => {
  const member = await review("emergency-contact-member");
  const present = { "dry-run": "false", "contact-preview": "already-present" };
  assert.deepEqual(blocks(member, "contact-preview", "click").filter(block => applies(block, present)), []);
  const preview = member.steps.find(step => step.id === "contact-preview"); assert.ok(preview);
  const shown = [...preview.description, ...preview.checks].filter(line => applies(line, present)).map(line => line.text);
  assert.equal(shown.some(text => /Fill the ordered primary contact changes|prepared changes/u.test(text)), false);
  assert.ok(shown.includes("Confirm the saved contact set still matches the approved plan."));
  const onbase = await review("onbase");
  const filed = { "dry-run": "false", "import-document": "already-present" };
  assert.deepEqual(blocks(onbase, "import-document", "click").filter(block => applies(block, filed)), []);
  const importing = onbase.steps.find(step => step.id === "import-document"); assert.ok(importing);
  assert.equal([...importing.description, ...importing.checks].some(line => applies(line, filed) && /Stage the selected PDF page|keywords before importing/u.test(line.text)), false);
});

it("shows the original source page and proposed person before OCR approval, and the independently retrieved filing only after a live import", async () => {
  const ocr = await review("ocr");
  assert.deepEqual(blocks(ocr, "source-pages", "card").flatMap(card => card.rows).map(row => [row.label, row.value]), [["PDF", "Fictional emergency-contact.pdf"], ["Pages", "1"]]);
  assert.deepEqual(blocks(ocr, "review-records", "card").flatMap(card => card.rows).map(row => [row.label, row.value]), [["Proposed person", "Example, Alex"], ["Original page", "1"]]);
  const page = await review("ocr-page");
  assert.deepEqual(blocks(page, "read-page", "card").flatMap(card => card.rows).map(row => [row.label, row.value]), [["PDF page", "1"], ["Form", "Emergency Contact"]]);
  const onbase = await review("onbase");
  const retrieval = blocks(onbase, "import-document", "card").find(card => card.title === "Document Retrieval"); assert.ok(retrieval);
  assert.ok(retrieval.rows.some(row => row.label === "Employee ID" && row.value === "10000001"));
  assert.equal(applies(retrieval, { "dry-run": "true", "import-document": "dry-run" }), false);
  assert.equal(applies(retrieval, { "dry-run": "false", "import-document": "saved" }), true);
  assert.equal(applies(retrieval, { "dry-run": "false", "import-document": "already-present" }), true);
});

it("lists every task's declared failure intentionally, leaving only undeclared failures to the unlisted-failure rule, with no internal names or Social Security numbers in prose", async () => {
  for (const workflow of (await served()).filter(workflow => ["emergency-contact", "emergency-contact-member", "ocr", "ocr-page", "onbase"].includes(workflow.id))) {
    const prose: string[] = [workflow.reviewSpec.unlistedFailure];
    for (const [index, group] of workflow.timeline.entries()) {
      const step = workflow.reviewSpec.steps[index]; assert.ok(step);
      const outcomes = step.blocks.flatMap(block => block.kind === "decision" ? block.outcomes : []);
      for (const node of workflow.nodes.filter(node => group.nodes.includes(node.id))) for (const task of node.tasks) for (const code of task.errorCodes) {
        if (isUnlistedStorageFailure(failureCodeFromTaskCode(code))) continue;
        assert.ok(outcomes.some(outcome => outcome.value === code && outcome.stops && outcome.label === operatorFailureLabel(failureCodeFromTaskCode(code))
          && outcome.then.startsWith(operatorFailureSentence(failureCodeFromTaskCode(code)))), `${workflow.id}/${node.id}/${code}`);
      }
      prose.push(step.title, ...step.description.map(line => line.text), ...step.checks.map(line => line.text));
      for (const block of step.blocks) {
        if (block.kind === "click") prose.push(block.target);
        if (block.kind === "starts") prose.push(block.title, block.each);
        if (block.kind === "decision") prose.push(block.label, ...block.outcomes.flatMap(outcome => [outcome.label, outcome.then]));
        if (block.kind === "card") {
          prose.push(block.title);
          for (const row of block.rows) {
            assert.ok(row.value !== undefined, row.id);
            prose.push(row.label, typeof row.value === "string" ? row.value : row.value.otherwise);
            const source = workflow.reviewSpec.sources[row.source]; assert.ok(source);
            prose.push(source.origin, source.detail, ...source.reads.flatMap(read => [read.page, read.field]));
          }
        }
      }
    }
    const text = prose.join("\n");
    assert.doesNotMatch(text, /\b\d{3}-\d{2}-\d{4}\b|Social Security|X_HR_|ucpath\/|workflow:|onbase\//iu);
    for (const node of workflow.nodes) for (const task of node.tasks) for (const code of task.errorCodes) assert.equal(text.includes(code), false, code);
  }
});
