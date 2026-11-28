// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it } from "vitest";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartRows, projectStartSteps, startRowWire } from "../../../../src/backend/runs/start/step-selection.js";
import { RerunValuesSnapshotSchema, type RerunValuesSnapshot } from "../../../../src/models/dashboard/rerun-values.js";
import { RerunWarningRequestSchema, RerunWarningWireSchema } from "../../../../src/models/dashboard/rerun-warning.js";
import { StartPlanRequestSchema, StartPlanWireSchema } from "../../../../src/models/dashboard/start-plan.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { lastIncludedSwitch, startRowsOf, stepEntries, rowOpenFold, includedRowCount, rowFieldsOpen, type StepRow } from "../../../../src/dashboard/surfaces/run-start/run-steps-model.js";
import { initialStepOmissionDraft } from "../../../../src/dashboard/surfaces/run-start/run-start-model.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);

type Served = NonNullable<RunStartWorkflow["rows"]>;
function served(id: string, rows?: (served: Served) => Served): RunStartWorkflow {
  const descriptor = DESCRIPTORS.find(entry => entry.id === id); assert.ok(descriptor?.surfaces.inputRun);
  const projected = projectStartRows(descriptor).map(startRowWire);
  return { ...h.WORKFLOWS[0], workflowId: descriptor.id, label: descriptor.label, version: descriptor.version, steps: projectStartSteps(descriptor),
    rows: rows === undefined ? projected : rows(projected), inputRun: { state: "present", surface: descriptor.surfaces.inputRun } };
}
const planOmitting = (steps: readonly string[]) => StartPlanWireSchema.parse({ ...h.planResponse("5a000000-0000-4000-8000-000000000001"), ...(steps.length === 0 ? {} : { omittedSteps: steps }) });

async function openSteps(workflow: RunStartWorkflow, typed: string, client = h.stubClient({})) {
  const dialog = await h.openDialog(client, { workflows: [workflow], panelWorkflowId: workflow.workflowId });
  await dialog.type(typed);
  await dialog.press("Next");
  await dialog.press("Customize steps");
  await dialog.press("Next");
  assert.equal(dialog.stage(), "Steps");
  return dialog;
}
const alerts = () => [...document.body.querySelectorAll('[role="alert"]')].map(node => (node.textContent ?? "").trim());
const rowNamed = (title: string): HTMLElement => {
  const row = [...document.querySelectorAll<HTMLElement>(".ds-run-row")].find(node => (node.textContent ?? "").startsWith(title));
  assert.ok(row, `no row ${title}`); return row;
};
const control = (label: string): HTMLInputElement => {
  const node = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  assert.ok(node, `no field ${label}`); return node;
};
async function typeDate(label: string, text: string) {
  const node = control(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(node, text);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const submitted = (requests: unknown[]) => StartPlanRequestSchema.parse(requests.at(-1));

describe("the Steps stage draws the served rows", () => {
  it("shows each row's label and locks nothing", async () => {
    const dialog = await openSteps(served("separations"), "4502");
    const text = dialog.text();
    assert.match(text, /7 of 7 included/u);
    for (const label of ["Read Kuali document", "Verify employee identity", "Read timecard", "Approve identity", "Check pending termination", "Submit termination", "Finalize Kuali document"]) assert.ok(text.includes(label), label);
    for (const label of ["Submit termination", "Approve identity", "Verify employee identity", "Read timecard"]) assert.equal(dialog.disabled(`Include ${label}`), false, label);
    assert.doesNotMatch(text, /required/u);
    assert.doesNotMatch(text, /requires every node/u);
  });

  it("opens the fields of a switch under its row when it is off, closes them when it is on, and keeps what was typed", async () => {
    const dialog = await openSteps(served("person-lookup"), h.TYPED);
    assert.match(dialog.text(), /4 of 4 included/u);
    assert.equal(document.querySelector('[aria-label="Employment date"]') === null, true);
    await dialog.press("Read CRM dates");
    assert.match(dialog.text(), /3 of 4 included/u);
    assert.ok(rowNamed("Read CRM dates").querySelector('input[aria-label="Employment date"]'), "the fields are not under their row");
    await typeDate("Employment date", "01/15/2020");
    await dialog.press("Read CRM dates");
    assert.equal(document.querySelector('[aria-label="Employment date"]') === null, true);
    assert.match(dialog.text(), /4 of 4 included/u);
    await dialog.press("Read CRM dates");
    assert.equal(control("Employment date").value, "01/15/2020");
  });

  it("toggles from a click on the switch itself, not only its label, and a locked row's Enter manually the same", async () => {
    const dialog = await openSteps(served("person-lookup"), h.TYPED);
    const track = (name: string) => {
      const input = [...document.querySelectorAll<HTMLInputElement>('[role="switch"]')].find(node => node.closest("label")?.textContent?.includes(name));
      const found = input?.closest("label")?.querySelector<HTMLElement>(".ds-switch-control");
      assert.ok(found, `no switch track for ${name}`); return found;
    };
    await act(async () => track("Include Read CRM dates").click());
    assert.match(dialog.text(), /3 of 4 included/u);
    await act(async () => track("Include Read CRM dates").click());
    assert.match(dialog.text(), /4 of 4 included/u);
  });

  it("shows one alert, the first failure, and keeps Start off until every field is valid", async () => {
    const requests: unknown[] = [];
    const dialog = await openSteps(served("person-lookup"), h.TYPED, h.stubClient({ submitStartPlan: async input => { requests.push(input); return planOmitting(["crm-dates"]); } }));
    await dialog.press("Read CRM dates");
    assert.deepEqual(alerts(), ["Enter employment date for read CRM dates."]);
    assert.equal(dialog.disabled("Start run"), true);
    await typeDate("Employment date", "2020-01-15");
    assert.deepEqual(alerts(), ["Employment date must be a valid date in MM/DD/YYYY format."]);
    await typeDate("Employment date", "01/15/2020");
    assert.deepEqual(alerts(), ["Enter oath date for read CRM dates."]);
    assert.equal(dialog.disabled("Start run"), true);
    assert.equal(requests.length, 0);
    await typeDate("Oath date", "02/20/2020");
    assert.deepEqual(alerts(), []);
    assert.equal(dialog.disabled("Start run"), false);
    await dialog.press("Start run");
    const request = submitted(requests);
    assert.equal(request.selectedStepKeys?.includes("crm-dates"), false);
    assert.deepEqual(request.stepOmissions, [{ step: "crm-dates", facts: { employmentDate: "2020-01-15", oathDate: "2020-02-20" } }]);
  });

  it.each([
    ["Review hire findings", "Hire review decision", "Existing person", "Reviewed employee ID"],
    ["Match existing person", "UCPath match result", "Found", "Matched employee ID"],
  ])("keeps Onboarding Start off when %s needs an employee ID", async (row, choice, value, idField) => {
    const dialog = await openSteps({ ...served("onboarding"), inputRun: h.WORKFLOWS[0].inputRun }, h.TYPED);
    await dialog.press(row);
    for (const action of ["Reference spreadsheets", "Create I-9 profile", "Submit hire", "Fill master results"]) await dialog.press(action);
    if (value === "Found") {
      await dialog.fill("I-9 lookup result", "Unresolved");
      await dialog.fill("Hire review decision", "Undecided");
    }
    await dialog.fill("Reference spreadsheet result", "Not checked");
    await dialog.fill(choice, value);
    assert.equal(dialog.disabled("Start run"), true);
    assert.equal(alerts().length, 1);
    assert.match(alerts()[0], /employee ID/u);
    await dialog.fill(idField, "10800001");
    assert.deepEqual(alerts(), []);
    assert.equal(dialog.disabled("Start run"), false);
  });

  it("ties the failing field to its alert for assistive technology", async () => {
    const dialog = await openSteps(served("person-lookup"), h.TYPED);
    await dialog.press("Read CRM dates");
    const alert = document.querySelector('[role="alert"]');
    assert.ok(alert?.id);
    const field = control("Employment date");
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.ok((field.getAttribute("aria-describedby") ?? "").split(" ").includes(alert.id));
    assert.ok(rowNamed("Read CRM dates").querySelector("fieldset legend")?.textContent?.includes("Manual values for Read CRM dates"));
  });

  it("keeps the last included switch on", async () => {
    const dialog = await openSteps(served("person-lookup"), h.TYPED);
    await dialog.press("Search for person"); await dialog.press("Read employment status");
    assert.match(dialog.text(), /2 of 4 included/u);
    assert.equal(lastIncludedSwitch(startRowsOf(served("person-lookup")).find(row => row.key === "crm-dates") as StepRow, startRowsOf(served("person-lookup")), ["crm-dates"], []), true);
  });

  it("refuses typed values for more than one person with a plain sentence", async () => {
    const dialog = await openSteps(served("person-lookup"), h.TYPED);
    await dialog.press("Read CRM dates");
    await typeDate("Employment date", "01/15/2020");
    await typeDate("Oath date", "02/20/2020");
    await dialog.press("1 Input");
    await dialog.type(`${h.TYPED}; 10000001`);
    await dialog.press("Next");
    await dialog.press("Next");
    assert.equal(dialog.stage(), "Steps");
    assert.deepEqual(alerts(), ["Typed values fit one person; 2 are entered."]);
    assert.equal(dialog.disabled("Start run"), true);
  });

  it("offers Enter manually on a locked row, and sends the typed facts for a step that still runs", async () => {
    const workflow = served("separations", rows => rows.map(row => row.key === "kronos-timecard" ? { ...row, kind: "locked-manual" as const, lockReason: "form-action" as const } : row));
    const requests: unknown[] = [];
    const dialog = await openSteps({ ...workflow, steps: workflow.steps.map(step => step.key === "kronos-timecard" ? { ...step, control: { state: "required" as const, reason: "runs" } } : step) }, "4502",
      h.stubClient({ submitStartPlan: async input => { requests.push(input); return planOmitting(["kronos-timecard"]); } }));
    assert.match(rowNamed("Read timecard").textContent ?? "", /Form action · required/u);
    assert.match(dialog.text(), /7 of 7 included/u);
    assert.equal(document.querySelector('[aria-label="Last day worked"]') === null, true);
    await dialog.press("Enter manually for Read timecard");
    assert.match(dialog.text(), /7 of 7 included/u);
    assert.deepEqual(alerts(), ["Enter last day worked for read timecard."]);
    await typeDate("Last day worked", "06/30/2026");
    await typeDate("Separation date", "07/01/2026");
    await dialog.press("Start live run");
    const request = submitted(requests);
    assert.equal(request.selectedStepKeys?.includes("kronos-timecard"), true);
    assert.deepEqual(request.stepOmissions?.map(({ step }) => step), ["kronos-timecard"]);
  });
});

describe("the row model", () => {
  const person = served("person-lookup");
  const rows = startRowsOf(person);
  const crm = rows.find(row => row.key === "crm-dates") as StepRow;

  it("builds the rows from the served row list and falls back to one row per step", () => {
    assert.deepEqual(rows.map(row => row.key), ["searching", "cross-verify", "active-status", "crm-dates"]);
    assert.equal(startRowsOf({ steps: person.steps }).length, person.steps.length);
  });

  it("counts a switch that is off out, and a locked row in", () => {
    const keys = person.steps.map(step => step.key);
    assert.equal(includedRowCount(rows, keys, []), 4);
    assert.equal(includedRowCount(rows, keys.filter(key => key !== "crm-dates"), []), 3);
    assert.equal(rowFieldsOpen(crm, keys.filter(key => key !== "crm-dates"), []), true);
  });

  it("files a child row's typed values under its workflow", () => {
    const child: StepRow = { ...crm, key: "ucpath-dates", stepKey: undefined, child: { workflow: "i9-check", step: "person-lookup" } };
    assert.equal(rowFieldsOpen(child, [], []), false);
    assert.equal(rowFieldsOpen(child, [], ["ucpath-dates"]), true);
    assert.ok(crm.form);
    const draft = { ...initialStepOmissionDraft(crm.form), employmentDate: "01/15/2020", oathDate: "02/20/2020" };
    assert.deepEqual(stepEntries([rowOpenFold(child, crm.form, draft)]), [{ workflow: "i9-check", step: "person-lookup", facts: { employmentDate: "2020-01-15", oathDate: "2020-02-20" } }]);
  });
});

describe("Rerun draws the same rows", () => {
  const person = served("person-lookup");
  const written = "2026-11-17T00:00:00.000Z";
  const node = (nodeId: string, reason: "checkpoint" | "step-omitted" = "checkpoint", state: "completed" | "unfinished" = "completed") => ({ nodeId, state, reason });
  const candidate = (field: "employmentDate" | "oathDate", value: string) => ({ state: "available" as const, nodeId: "crm-dates", fieldPath: field, label: field, targetFieldPath: field, targetStepKey: "crm-dates",
    sourceStepKey: "crm-dates", value, checkpoint: { attempt: 1, writtenAt: written }, provenance: { path: field, source: "live" as const, observedAt: written, originalObservedAt: written } });
  const snapshot = (extra: Partial<RerunValuesSnapshot> = {}): RerunValuesSnapshot => RerunValuesSnapshotSchema.parse({
    sourceInput: { state: "available", value: { mode: "search", emplId: h.TYPED, crmCheck: true, keepNonHdh: false, includeCrmDates: true } },
    source: { runId: "5a000000-0000-4000-8000-000000000009", version: 3, workflow: "person-lookup", descriptorVersion: person.version, contractFingerprint: h.HASH, outcome: "done", dryRun: false, priority: "interactive", browserMode: "headless" },
    steps: [{ key: "searching", state: "completed", nodes: [node("searching")] }, { key: "cross-verify", state: "unfinished", nodes: [node("cross-verify", "step-omitted", "unfinished")] },
      { key: "active-status", state: "completed", nodes: [node("active-status")] }, { key: "crm-dates", state: "completed", nodes: [node("crm-dates")] }],
    values: [candidate("employmentDate", "2020-01-15"), candidate("oathDate", "2020-02-20")], transactions: [], ...extra });

  async function openRerun(source: RerunValuesSnapshot, requests: unknown[]) {
    const dialog = await h.openDialog(h.stubClient({
      rerunValues: async () => ({ state: "available", snapshot: source }),
      previewRerunWarnings: async options => RerunWarningWireSchema.parse({ workflowId: "person-lookup", rerun: { source: RerunWarningRequestSchema.parse(options).source, warnings: [], warningDigest: h.HASH } }),
      submitStartPlan: async input => { requests.push(input); return StartPlanWireSchema.parse({ ...planOmitting(["crm-dates"]), rerun: { source: StartPlanRequestSchema.parse(input).rerunSource, warnings: [], warningDigest: h.HASH } }); },
    }), { workflows: [person], panelWorkflowId: "person-lookup", rerunSource: { runId: source.source.runId, expectedVersion: source.source.version } });
    for (let wait = 0; wait < 6; wait += 1) await h.settle();
    return dialog;
  }
  const finish = async (dialog: Awaited<ReturnType<typeof openRerun>>) => { await dialog.press("Next"); await dialog.press("Start run"); };

  it("starts with every row included and a badge from the source run", async () => {
    const dialog = await openRerun(snapshot(), []);
    assert.equal(dialog.stage(), "Steps");
    assert.match(dialog.text(), /4 of 4 included/u);
    assert.equal(rowNamed("Search for person").querySelector("[data-status]")?.getAttribute("data-status"), "completed");
    assert.equal(rowNamed("Cross-check identity").querySelector("[data-status]")?.getAttribute("data-status"), "skipped");
    assert.match(rowNamed("Cross-check identity").textContent ?? "", /Skipped/u);
  });

  it("fills a completed step's fields from the source run when it is switched off, marked as from the earlier run", async () => {
    const requests: unknown[] = [];
    const dialog = await openRerun(snapshot(), requests);
    await dialog.press("Read CRM dates");
    assert.equal(control("Employment date").value, "01/15/2020");
    assert.equal(control("Oath date").value, "02/20/2020");
    assert.equal((rowNamed("Read CRM dates").textContent?.match(/From the earlier run/gu) ?? []).length, 2);
    assert.deepEqual(alerts(), []);
    await finish(dialog);
    const request = submitted(requests);
    assert.deepEqual(request.rerunSource?.copiedFrom?.map(({ targetFieldPath, targetStepKey }) => [targetFieldPath, targetStepKey]), [["employmentDate", "crm-dates"], ["oathDate", "crm-dates"]]);
    assert.deepEqual(request.stepOmissions, [{ step: "crm-dates", facts: { employmentDate: "2020-01-15", oathDate: "2020-02-20" } }]);
  });

  it("sends an edited value as typed and a copied one as copied", async () => {
    const requests: unknown[] = [];
    const dialog = await openRerun(snapshot(), requests);
    await dialog.press("Read CRM dates");
    await typeDate("Oath date", "03/01/2020");
    assert.equal((rowNamed("Read CRM dates").textContent?.match(/From the earlier run/gu) ?? []).length, 1);
    await finish(dialog);
    const request = submitted(requests);
    assert.deepEqual(request.rerunSource?.copiedFrom?.map(({ targetFieldPath }) => targetFieldPath), ["employmentDate"]);
    assert.deepEqual(request.stepOmissions, [{ step: "crm-dates", facts: { employmentDate: "2020-01-15", oathDate: "2020-03-01" } }]);
  });

  it("offers the facts a step was typed with as typed, not as copied", async () => {
    const requests: unknown[] = [];
    const typed = snapshot({ values: [], typed: [{ step: "crm-dates", facts: { employmentDate: "2019-05-06", oathDate: "2019-06-07" } }] });
    const dialog = await openRerun(typed, requests);
    await dialog.press("Read CRM dates");
    assert.equal(control("Employment date").value, "05/06/2019");
    assert.doesNotMatch(rowNamed("Read CRM dates").textContent ?? "", /From the earlier run/u);
    await finish(dialog);
    assert.equal(submitted(requests).rerunSource?.copiedFrom?.length ?? 0, 0);
  });
});
