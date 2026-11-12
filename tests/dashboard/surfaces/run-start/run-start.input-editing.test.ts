// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { StartPlanRequestSchema } from "../../../../src/models/dashboard/start-plan.js";
import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);
const descriptor = DESCRIPTORS.find(flow => flow.id === "person-lookup");
assert.ok(descriptor?.surfaces.inputRun);
const workflow = { ...h.WORKFLOWS[0], workflowId: descriptor.id, version: descriptor.version,
  steps: projectStartSteps(descriptor), inputRun: { state: "present" as const, surface: descriptor.surfaces.inputRun } };

it("normalizes Search people, removes a duplicate identity from the textbox and plans only remaining entries", async () => {
  let request: unknown;
  const dialog = await h.openDialog(h.stubClient({ submitStartPlan: async input => {
    request = input;
    return h.planResponse("5a000000-0000-4000-8000-000000000001");
  } }), { workflows: [workflow], panelWorkflowId: descriptor.id });
  await dialog.type(" 10000001 ; Example,   Person\r\n10000002; example, person ; 10000001\n Other,\tPerson ");
  const box = dialog.typedInput();
  await act(async () => { box.focus(); box.blur(); });
  assert.equal(box.value, "10000001;Example, Person;10000002;Other, Person");
  const parsed = document.querySelector('[aria-label="Parsed input"]');
  assert.ok(parsed);
  assert.equal(parsed.querySelectorAll(".ds-run-row").length, 4);
  assert.match(parsed.textContent ?? "", /4 runs/u);
  await dialog.press("Remove Example, Person");
  assert.equal(box.value, "10000001;10000002;Other, Person");
  assert.equal(document.activeElement === box, true, "removing an entry restores focus to the textbox");
  assert.equal(parsed.querySelectorAll(".ds-run-row").length, 3);
  assert.match(parsed.textContent ?? "", /3 runs/u);
  await dialog.press("Continue");
  await dialog.press("Continue");
  const submissions = StartPlanRequestSchema.parse(request).submissions;
  const search = { mode: "search", crmCheck: true, keepNonHdh: false, includeCrmDates: false };
  assert.deepEqual(submissions, [{ ...search, emplId: "10000001" }, { ...search, emplId: "10000002" }, { ...search, name: "Other, Person" }]);
  for (const submission of submissions) assert.deepEqual(PersonLookupInput.parse(submission), submission);
});

it("clears the final Search entry and disables Continue", async () => {
  const dialog = await h.openDialog(h.stubClient({}), { workflows: [workflow], panelWorkflowId: descriptor.id });
  await dialog.type(" 10000001;10000001 ");
  await dialog.press("Remove 10000001");
  assert.equal(dialog.typedInput().value, "");
  assert.equal(document.querySelector('[aria-label="Parsed input"]'), null);
  assert.equal(dialog.disabled("Continue"), true);
  assert.match(dialog.text(), /Type at least one value/u);
});

it("keeps Match identifiers raw in the editor and masked in its preview", async () => {
  const dialog = await h.openDialog(h.stubClient({}), { workflows: [workflow], panelWorkflowId: descriptor.id });
  const match = document.querySelector<HTMLInputElement>('input[type="radio"][value="match"]');
  assert.ok(match);
  await act(async () => match.click());
  const raw = " Example, Person, x, 902481357 ";
  await dialog.type(raw);
  const box = dialog.typedInput();
  await act(async () => { box.focus(); box.blur(); });
  assert.equal(box.value, raw);
  assert.match(dialog.text(), /Example, Person, x, \[masked\]/u);
  assert.equal(document.querySelector('[aria-label="Parsed input"]')?.textContent?.includes("902481357"), false);
  assert.equal(document.querySelector('button[aria-label^="Remove "]'), null);
});

it.each([";", "|"])("preserves two Match tuples through Search blur before the mode click with %s", async delimiter => {
  const surface = structuredClone(workflow.inputRun.surface);
  assert.ok(surface.typedInput);
  for (const mode of surface.typedInput.modes) {
    if (mode.parser.kind === "entries") mode.parser.spec.split = { kind: "delimited", delimiters: ["\n", delimiter] };
    else mode.parser.delimiter = delimiter;
  }
  let request: unknown;
  const dialog = await h.openDialog(h.stubClient({ submitStartPlan: async input => {
    request = input;
    return h.planResponse("5a000000-0000-4000-8000-000000000001");
  } }), { workflows: [{ ...workflow, inputRun: { state: "present", surface } }], panelWorkflowId: descriptor.id });
  const box = dialog.typedInput();
  await act(async () => box.focus());
  await dialog.type(`Example, First, 01/15/2000, x${delimiter} Other, Second, x, 902481357`);
  const match = document.querySelector<HTMLInputElement>('input[type="radio"][value="match"]');
  assert.ok(match);
  const order: string[] = [];
  box.addEventListener("blur", () => order.push("blur"));
  match.addEventListener("click", () => order.push("click"));
  await act(async () => match.focus());
  assert.deepEqual(order, ["blur"]);
  await act(async () => match.click());
  assert.deepEqual(order, ["blur", "click"]);
  const editedText = box.value;
  await act(async () => { box.focus(); box.blur(); });
  assert.equal(box.value, editedText);
  const parsed = document.querySelector('[aria-label="Parsed input"]');
  assert.ok(parsed);
  assert.equal(parsed.textContent?.includes("902481357"), false);
  assert.match(parsed.textContent ?? "", /\[masked\]/u);
  await dialog.press("Continue");
  await dialog.press("Continue");
  assert.deepEqual(StartPlanRequestSchema.parse(request).submissions, [
    { mode: "match", lastName: "Example", firstName: "First", dob: "01/15/2000", crmCheck: false, includeCrmDates: false },
    { mode: "match", lastName: "Other", firstName: "Second", ssn: "902481357", crmCheck: false, includeCrmDates: false },
  ]);
});
