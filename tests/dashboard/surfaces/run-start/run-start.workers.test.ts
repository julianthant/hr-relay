// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it } from "vitest";
import { StartPlanRequestSchema } from "../../../../src/models/dashboard/start-plan.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);
async function chooseWorkers(value: string) {
  const picker = document.querySelector<HTMLButtonElement>('button[aria-label$=" Workers"]'); assert.ok(picker);
  await act(async () => picker.click());
  const option = document.querySelector<HTMLElement>(`[role="menuitemradio"][aria-label="${value}"]`); assert.ok(option);
  await act(async () => option.click());
}

describe("served Run worker choice", () => {
  it.each(["auto", 3] as const)("submits %s explicitly and confirms the accepted choice", async workers => {
    let submitted: unknown;
    const dialog = await h.openDialog(h.stubClient({ submitStartPlan: async input => {
      submitted = input;
      const request = StartPlanRequestSchema.parse(input);
      return { ...h.planResponse("5a000000-0000-4000-8000-000000000001"), workers: request.workers ?? "auto" };
    } }));
    await dialog.type(h.TYPED); await dialog.press("Continue");
    assert.ok(document.querySelector('button[aria-label="Auto Workers"]'));
    if (workers !== "auto") await chooseWorkers(String(workers));
    await dialog.press("Continue");
    assert.equal(StartPlanRequestSchema.parse(submitted).workers, workers);
    assert.equal(dialog.stage(), "Confirm");
    const term = [...document.querySelectorAll("dt")].find(node => node.textContent === "Workers"); assert.ok(term);
    assert.equal(term.nextElementSibling?.textContent, workers === "auto" ? "Auto" : String(workers));
  });

  it("invalidates a settled plan when the Workers choice changes", async () => {
    const requests: unknown[] = [];
    const dialog = await h.openDialog(h.stubClient({ submitStartPlan: async input => {
      requests.push(input); const request = StartPlanRequestSchema.parse(input);
      return { ...h.planResponse(`5a000000-0000-4000-8000-00000000000${requests.length}`), workers: request.workers ?? "auto" };
    } }));
    await dialog.type(h.TYPED); await dialog.press("Continue"); await dialog.press("Continue");
    assert.equal(dialog.stage(), "Confirm"); await dialog.press("Back");
    await chooseWorkers("4");
    assert.equal(document.querySelector('[aria-label="Confirm"]'), null);
    await dialog.press("Continue");
    assert.equal(requests.length, 2); assert.equal(StartPlanRequestSchema.parse(requests[1]).workers, 4);
    assert.equal(dialog.stage(), "Confirm");
  });

  it("ignores a plan that settles after the Workers choice changes", async () => {
    let settle: ((plan: ReturnType<typeof h.planResponse>) => void) | undefined;
    let submitted: unknown;
    const dialog = await h.openDialog(h.stubClient({ submitStartPlan: async input => {
      submitted = input; return new Promise(resolve => { settle = resolve; });
    } }));
    await dialog.type(h.TYPED); await dialog.press("Continue"); await dialog.press("Continue");
    assert.equal(StartPlanRequestSchema.parse(submitted).workers, "auto");
    await chooseWorkers("2"); assert.ok(settle);
    await act(async () => settle?.(h.planResponse("5a000000-0000-4000-8000-000000000001")));
    assert.equal(dialog.stage(), "Options");
    assert.equal(document.querySelector('[aria-label="Confirm"]'), null);
    assert.ok(document.querySelector('button[aria-label="2 Workers"]'));
  });

  it("refuses a response carrying a different Workers choice", async () => {
    const dialog = await h.openDialog(h.stubClient({ submitStartPlan: async () => h.planResponse("5a000000-0000-4000-8000-000000000001") }));
    await dialog.type(h.TYPED); await dialog.press("Continue"); await chooseWorkers("8"); await dialog.press("Continue");
    assert.equal(dialog.stage(), "Options");
    assert.match(dialog.text(), /supplied data does not match/u);
    assert.equal(document.querySelector('[aria-label="Confirm"]'), null);
  });
});
