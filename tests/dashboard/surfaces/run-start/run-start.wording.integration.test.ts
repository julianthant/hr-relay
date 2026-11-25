// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

const h = createRunStartDialogHarness();
const priority = () => [...document.body.querySelectorAll<HTMLInputElement>('[role="switch"], [role="checkbox"]')]
  .find(node => node.getAttribute("aria-label") === "Priority" || node.closest("label")?.textContent?.includes("Priority") === true);
afterEach(h.cleanup);

describe("Start run wording and defaults match the approved mock", () => {
  it("heads the Steps stage \"Steps\" with the mock's count and description, and names no node rule", async () => {
    const dialog = await h.openDialog(h.stubClient({}));
    await dialog.type(h.TYPED);
    await dialog.press("Continue");
    await dialog.press("Customize steps");
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Steps");
    const text = dialog.text();
    assert.match(text, /Steps\d+ of \d+ included/u);
    assert.match(text, /Replace reading steps with manual values\. Form actions stay included\./u);
    assert.doesNotMatch(text, /Workflow steps|\d+ \/ \d+ included|requires every node|UCPATH/u);
  });

  it("ends on \"Start run\" with no Enter hint", async () => {
    const dialog = await h.openDialog(h.stubClient({}));
    await dialog.type(h.TYPED);
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Start");
    assert.match(dialog.text(), /Start run/u);
    assert.doesNotMatch(dialog.text(), /Enter to start/u);
    assert.doesNotMatch(dialog.text(), /Preview plan/u);
  });

  it("starts Priority on for one person and off for several", async () => {
    const one = await h.openDialog(h.stubClient({}));
    await one.type(h.TYPED);
    await one.press("Continue");
    assert.equal(priority()?.checked, true);
    await h.cleanup();
    const several = await h.openDialog(h.stubClient({}));
    await several.type(`${h.TYPED}; 10000001`);
    await several.press("Continue");
    assert.equal(priority()?.checked, false);
    await several.choosePriority("interactive");
    assert.equal(priority()?.checked, true);
  });
});
