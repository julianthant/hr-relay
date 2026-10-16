// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it } from "vitest";
import { RerunValuesRequestSchema, RerunValuesSnapshotSchema } from "../../../../src/models/dashboard/rerun-values.js";
import { RerunWarningRequestSchema, RerunWarningWireSchema } from "../../../../src/models/dashboard/rerun-warning.js";
import { StartPlanRequestSchema, StartPlanWireSchema } from "../../../../src/models/dashboard/start-plan.js";
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
  it.each(["auto", 3] as const)("submits %s explicitly without a Workers confirmation row", async workers => {
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
    assert.equal([...document.querySelectorAll("dt")].some(node => node.textContent === "Workers"), false);
  });

  it("shows Workers for a plain typed surface without typed mode controls", async () => {
    const base = h.WORKFLOWS.find(workflow => workflow.workflowId === h.WORKFLOW_ID); assert.ok(base);
    assert.ok(base.inputRun.state === "present");
    const { typedInput: _typedInput, ...surface } = base.inputRun.surface;
    const workflow = { ...base, inputRun: { state: "present" as const, surface } };
    const dialog = await h.openDialog(h.stubClient({}), { workflows: [workflow], panelWorkflowId: workflow.workflowId });
    await dialog.type(h.TYPED); await dialog.press("Continue");
    const picker = document.querySelector('button[aria-label="Auto Workers"]'); assert.ok(picker);
    const grid = picker.closest(".grid.gap-4"); assert.ok(grid);
    assert.ok(grid.nextElementSibling?.querySelector('button[aria-label$="Workbook · Optional"]'));
  });

  it("hides Workers and submits auto for a rerun whose source choice is numeric when typed input is absent", async () => {
    const base = h.WORKFLOWS.find(workflow => workflow.workflowId === h.WORKFLOW_ID); assert.ok(base);
    const workflow = { ...base, inputRun: { state: "absent" as const, reason: "No typed entry" } };
    const source = RerunValuesRequestSchema.parse({ runId: "22222222-2222-4222-8222-222222222222", expectedVersion: 3 });
    const snapshot = RerunValuesSnapshotSchema.parse({ workers: 5,
      source: { runId: source.runId, version: source.expectedVersion, workflow: workflow.workflowId,
        descriptorVersion: workflow.version, contractFingerprint: h.HASH, outcome: "done" },
      sourceInput: { state: "available", value: {} },
      steps: workflow.steps.map(step => ({ key: step.key, state: "completed", nodes: [{ nodeId: step.key, state: "completed", reason: "checkpoint" }] })),
      values: [], transactions: [] });
    let submitted: unknown;
    const dialog = await h.openDialog(h.stubClient({
      rerunValues: async () => ({ state: "available", snapshot }),
      previewRerunWarnings: async input => RerunWarningWireSchema.parse({ workflowId: workflow.workflowId,
        rerun: { source: RerunWarningRequestSchema.parse(input).source, warnings: [], warningDigest: h.HASH } }),
      submitStartPlan: async input => {
        submitted = input;
        const request = StartPlanRequestSchema.parse(input);
        return StartPlanWireSchema.parse({ ...h.planResponse("5a000000-0000-4000-8000-000000000001"), workers: request.workers ?? "auto",
          rerun: { source: request.rerunSource, warnings: [], warningDigest: h.HASH, acknowledgment: request.warningAcknowledgment } });
      },
    }), { workflows: [workflow], panelWorkflowId: workflow.workflowId, rerunSource: source });
    await dialog.press("Continue"); await dialog.press("Continue");
    assert.equal(dialog.stage(), "Options");
    assert.equal(document.querySelector('button[aria-label$=" Workers"]'), null);
    await dialog.press("Continue");
    assert.equal(StartPlanRequestSchema.parse(submitted).workers, "auto");
    assert.equal(dialog.stage(), "Confirm");
    assert.equal([...document.querySelectorAll("dt")].some(node => node.textContent === "Workers"), false);
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
