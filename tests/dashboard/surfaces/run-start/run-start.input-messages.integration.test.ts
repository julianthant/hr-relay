// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { act } from "react";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);

const open = (id: string) => {
  const descriptor = DESCRIPTORS.find(flow => flow.id === id);
  assert.ok(descriptor?.surfaces.inputRun);
  const workflow = { ...h.WORKFLOWS[0], workflowId: descriptor.id, label: descriptor.label, version: descriptor.version,
    steps: projectStartSteps(descriptor), inputRun: { state: "present" as const, surface: descriptor.surfaces.inputRun } };
  return h.openDialog(h.stubClient({}), { workflows: [workflow], panelWorkflowId: id });
};
const pickMatch = async () => {
  const match = document.querySelector<HTMLInputElement>('input[type="radio"][value="match"]');
  assert.ok(match);
  await act(async () => match.click());
};
const RAW = /invalid_format|"origin"|input-run|parser rule|\[\s*\{/u;

describe("typed input refusals read as one plain sentence and keep their parsed row", () => {
  it("accepts the mock's Match sample with a dashed SSN as one run", async () => {
    const dialog = await open("person-lookup");
    await pickMatch();
    await dialog.type("Lee, Jordan, x, 123-45-6789");
    assert.match(dialog.text(), /Parsed input1 run/u);
    assert.match(dialog.text(), /Lee, Jordan, x, \[masked\]/u);
    assert.doesNotMatch(dialog.text(), /Fix the refused entry first/u);
    assert.doesNotMatch(dialog.text(), RAW);
  });

  it("refuses \"Lee, Jordan, x, x\" with the mock's sentence and still shows its row", async () => {
    const dialog = await open("person-lookup");
    await pickMatch();
    await dialog.type("Lee, Jordan, x, x");
    assert.match(dialog.text(), /Match needs DOB or SSN; both cannot be x\./u);
    assert.match(dialog.text(), /Parsed input/u);
    assert.match(dialog.text(), /Lee, Jordan, x, x/u);
    assert.doesNotMatch(dialog.text(), RAW);
  });

  it("says what Match expects when an entry has too few parts", async () => {
    const dialog = await open("person-lookup");
    await pickMatch();
    await dialog.type("Lee");
    assert.match(dialog.text(), /Use Last, First, DOB, SSN; separate people with semicolons\./u);
  });

  it("reads \"abc\" in Separations as \"Kuali ID must contain digits.\" with its row", async () => {
    const dialog = await open("separations");
    await dialog.type("abc");
    assert.match(dialog.text(), /Kuali ID must contain digits\./u);
    assert.match(dialog.text(), /Parsed input/u);
    assert.doesNotMatch(dialog.text(), RAW);
  });

  it("starts Work-Study's Effective date on the dashboard day and reads \"abc\" as the approved sentence", async () => {
    const dialog = await open("work-study");
    const date = document.body.querySelector<HTMLInputElement>('input[aria-label="Effective date"]');
    assert.ok(date);
    assert.match(date.value, /^\d{2}\/\d{2}\/\d{4}$/u);
    assert.doesNotMatch(dialog.text(), /Choose a valid effective date/u);
    await dialog.type("abc");
    assert.match(dialog.text(), /Employee IDs must contain at least five digits\./u);
    assert.doesNotMatch(dialog.text(), RAW);
  });

  it("names the same separators in every workflow's help text and placeholder", async () => {
    for (const id of ["person-lookup", "separations", "work-study"]) {
      const dialog = await open(id);
      const box = dialog.typedInput();
      assert.doesNotMatch(dialog.text(), /commas|new lines/u, id);
      assert.match(`${dialog.text()} ${box.placeholder}`, /semicolon or Shift\+Enter/u, id);
      assert.doesNotMatch(box.placeholder, /,\s?\d{5,}/u, id);
      await h.cleanup();
    }
  });
});
