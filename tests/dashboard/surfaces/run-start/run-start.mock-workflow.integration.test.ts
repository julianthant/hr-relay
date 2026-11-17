// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import type { MockDraft } from "../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import type { MockWorkflowId } from "../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);

async function typeIds(text: string): Promise<void> {
  const box = document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="Employee IDs"]');
  assert.ok(box);
  const descriptor: { set?: (this: unknown, value: string) => void } | undefined = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  const set = descriptor?.set;
  assert.ok(set);
  await act(async () => { set.call(box, text); box.dispatchEvent(new Event("input", { bubbles: true })); });
}

async function openPreview(previewStartable: boolean) {
  const submitted: Array<[MockWorkflowId, MockDraft]> = [];
  const dialog = await h.openDialog(h.stubClient({}));
  await dialog.rerender({ previewRuns: [], onSubmitPreview: (id, draft) => { submitted.push([id, draft]); },
    previewLaunch: { workflowId: "kronos-pay-rule" }, previewStartable });
  return { dialog, submitted };
}

describe("a workflow that is not served yet opens for viewing and never pretends to start", () => {
  it("says it is not available yet, turns the final button off and starts nothing", async () => {
    const { dialog, submitted } = await openPreview(false);
    assert.match(dialog.text(), /Kronos Pay Rule · Not available yet/u);
    assert.doesNotMatch(dialog.text(), /Workflow preview/u);
    await typeIds("10000001");
    for (let guard = 0; guard < 4 && !dialog.text().includes("This workflow is not available yet."); guard += 1) await dialog.press("Continue");
    assert.match(dialog.text(), /This workflow is not available yet\./u);
    assert.equal(dialog.disabled("Start run"), true);
    const start = h.buttons().find(button => h.buttonName(button) === "Start run");
    assert.ok(start);
    assert.ok(start.getAttribute("aria-describedby"));
    assert.equal(document.getElementById(start.getAttribute("aria-describedby") ?? "")?.textContent, "This workflow is not available yet.");
    assert.doesNotMatch(dialog.text(), /Enter to start/u);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    start.click();
    assert.deepEqual(submitted, []);
    assert.doesNotMatch(dialog.text(), /Run started|runs? created/u);
  });

  it("keeps starting local preview runs where the mock harness allows it", async () => {
    const { dialog, submitted } = await openPreview(true);
    assert.match(dialog.text(), /Kronos Pay Rule · Workflow preview/u);
    await typeIds("10000001");
    await dialog.press("Continue");
    await dialog.press("Start run");
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0]?.[0], "kronos-pay-rule");
  });
});
