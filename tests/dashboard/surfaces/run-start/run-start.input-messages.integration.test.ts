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

  it("shows the semicolon separator by example in Person Lookup", async () => {
    const dialog = await open("person-lookup");
    const box = dialog.typedInput();
    assert.doesNotMatch(dialog.text(), /commas|new lines/u);
    assert.match(box.placeholder, /\d; /u);
    assert.doesNotMatch(box.placeholder, /,\s?\d{5,}/u);
  });

  it.each([
    ["separations", "Separate Kuali IDs with semicolons"],
    ["work-study", "Separate Employee IDs with semicolons"],
  ])("uses entry guidance without a sample ID in %s", async (id, placeholder) => {
    const dialog = await open(id);
    const box = dialog.typedInput();
    assert.equal(box.placeholder, placeholder);
    assert.equal(box.value, "");
    assert.doesNotMatch(dialog.text(), /commas|new lines/u, id);
  });

  it("labels each list by what it takes and accepts both separators", async () => {
    const hints: Array<[string, boolean, RegExp, string]> = [
      ["person-lookup", false, /Employee IDs or names\./u, "10000001"],
      ["person-lookup", true, /Name, DOB and SSN\./u, "Lee, Jordan, x, 123-45-6789"],
      ["separations", false, /Kuali ID\./u, "4502"],
      ["work-study", false, /Employee IDs\./u, "10000001"],
    ];
    for (const [id, match, hint, one] of hints) {
      for (const separator of ["; ", "\n"]) {
        const dialog = await open(id);
        if (match) await pickMatch();
        assert.match(dialog.text(), hint, `${id} label`);
        const second = one === "4502" ? "4510" : one === "10000001" ? "10000002" : "Kim, Alex, 01/01/2000, x";
        await dialog.type(`${one}${separator}${second}`);
        assert.match(dialog.text(), /Parsed input2 runs/u, `${id} ${JSON.stringify(separator)}`);
        await h.cleanup();
      }
    }
  });
});

describe("Separations and Work-Study entries", () => {
  const parsedRows = () => [...document.querySelectorAll('[aria-label="Parsed input"] .font-mono')];

  it("drops a repeated Separations ID as Person Lookup does", async () => {
    const dialog = await open("separations");
    await dialog.type("1234567; 1234567; 7654321");
    assert.match(dialog.text(), /Parsed input2 runs/u);
    assert.deepEqual(parsedRows().map(row => row.textContent), ["1234567", "7654321"]);
  });

  it("marks only the invalid Separations entry", async () => {
    const dialog = await open("separations");
    await dialog.type("1234567; abc; 7654321");
    assert.deepEqual(parsedRows().map(row => row.classList.contains("text-ui-danger")), [false, true, false]);
    const rows = [...document.querySelectorAll('[aria-label="Parsed input"] .ds-run-row')];
    assert.deepEqual(rows.map(row => (row.textContent ?? "").includes("Not valid")), [false, true, false], "the refused row says so in words, not colour alone");
  });

  it("puts an invalid Work-Study effective date on the date field", async () => {
    const dialog = await open("work-study");
    await dialog.type("10812345");
    const date = document.body.querySelector<HTMLInputElement>('input[aria-label="Effective date"]');
    assert.ok(date);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(date, "13/45/2026"); date.dispatchEvent(new Event("input", { bubbles: true })); });
    const alert = [...document.querySelectorAll('[role="alert"]')].find(node => node.closest(".ds-run-row")?.contains(date));
    assert.ok(alert, "the date row holds the error");
    assert.equal(alert.textContent, "Choose a valid effective date.");
    assert.equal(date.getAttribute("aria-describedby"), alert.id);
    assert.equal(date.getAttribute("aria-invalid"), "true");
    assert.doesNotMatch(dialog.text(), /Fix the refused entry first/u);
    assert.deepEqual(parsedRows().map(row => row.classList.contains("text-ui-danger")), [false]);
  });

  it("shows an invalid Work-Study date on its field before any ID is typed", async () => {
    await open("work-study");
    const date = document.body.querySelector<HTMLInputElement>('input[aria-label="Effective date"]');
    assert.ok(date);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(date, "13/45/2026"); date.dispatchEvent(new Event("input", { bubbles: true })); });
    const describedBy = date.getAttribute("aria-describedby");
    assert.ok(describedBy);
    assert.equal(document.getElementById(describedBy)?.textContent, "Choose a valid effective date.");
  });
});
