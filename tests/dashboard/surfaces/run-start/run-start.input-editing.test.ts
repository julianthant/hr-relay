// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { WORKFLOW_DESCRIPTORS } from "../../../../src/workflows/descriptor-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { StartPlanRequestSchema } from "../../../../src/models/dashboard/start-plan.js";
import { PersonLookupInput, parsePersonLookupRequest } from "../../../../src/models/workflows/person-lookup/input.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);
const descriptor = WORKFLOW_DESCRIPTORS.find(flow => flow.id === "person-lookup");
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
  assert.equal(box.value, "10000001\nExample, Person\n10000002\nOther, Person");
  const parsed = document.querySelector('[aria-label="Parsed input"]');
  assert.ok(parsed);
  assert.equal(parsed.querySelectorAll("li").length, 4);
  assert.match(parsed.textContent ?? "", /4 runs/u);
  await dialog.press("Remove Example, Person");
  assert.equal(box.value, "10000001\n10000002\nOther, Person");
  assert.equal(document.activeElement, box);
  assert.equal(parsed.querySelectorAll("li").length, 3);
  assert.match(parsed.textContent ?? "", /3 runs/u);
  await dialog.press("Continue");
  await dialog.press("Continue");
  const submissions = StartPlanRequestSchema.parse(request).submissions;
  assert.deepEqual(submissions, parsePersonLookupRequest(box.value));
  for (const submission of submissions) assert.deepEqual(PersonLookupInput.parse(submission), submission);
});

it("clears the final Search entry and disables Continue", async () => {
  const dialog = await h.openDialog(h.stubClient({}), { workflows: [workflow], panelWorkflowId: descriptor.id });
  await dialog.type(" 10000001;10000001 ");
  await dialog.press("Remove 10000001");
  assert.equal(dialog.typedInput().value, "");
  assert.equal(document.querySelector('[aria-label="Parsed input"]'), null);
  assert.equal(dialog.disabled("Continue"), true);
  assert.match(dialog.text(), /0 runs/u);
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
