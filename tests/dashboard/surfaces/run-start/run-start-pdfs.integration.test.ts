// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { I9CheckStartInput } from "../../../../src/models/workflows/i9-check/start.js";
import { i9CheckStartModule } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { OcrSourceUploadSchema } from "../../../../src/models/ocr/review.js";
import { StartPlanRequestSchema } from "../../../../src/models/dashboard/start-plan.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { createHash } from "node:crypto";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);
const descriptor = i9CheckStartModule.descriptor;
const workflow: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: descriptor.id, label: descriptor.label, version: descriptor.version,
  steps: projectStartSteps(descriptor), inputRun: { state: "absent", reason: "PDF input" }, uploadRun: descriptor.surfaces.uploadRun };
function pdf(name: string, contents: string) {
  const bytes = new TextEncoder().encode(contents), file = new File([bytes], name, { type: "application/pdf" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  return file;
}
async function attach(files: readonly File[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]'); assert.ok(input);
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await h.settle();
}

it("uploads both original PDFs through the typed client and plans one parent with stable reading IDs", async () => {
  const uploads: string[] = [], plans: unknown[] = [];
  const client = h.stubClient({ uploadOcrSource: async request => {
    uploads.push(request.fileName);
    return OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
      artifact: { id: `00000000-0000-4000-8000-${String(uploads.length).padStart(12, "0")}`, mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } });
  }, submitStartPlan: async request => { plans.push(request); return { ...h.planResponse("5a000000-0000-4000-8000-000000000001"), workflowId: descriptor.id }; } });
  const dialog = await h.openDialog(client, { workflows: [workflow], panelWorkflowId: workflow.workflowId });
  expect(dialog.disabled("Continue")).toBe(true);
  expect(document.querySelector("textarea")).toBeNull();
  await attach([pdf("first.pdf", "%PDF first"), pdf("second.pdf", "%PDF second")]);
  expect(uploads).toEqual(["first.pdf", "second.pdf"]);
  expect(dialog.text()).toContain("2 PDFs selected");
  expect(dialog.disabled("Continue")).toBe(false);
  await dialog.press("Continue"); await dialog.press("Continue");
  expect(plans).toHaveLength(1);
  const request = StartPlanRequestSchema.parse(plans[0]);
  expect(request.submissions).toHaveLength(1);
  const input = I9CheckStartInput.parse(request.submissions[0]);
  expect(input.documents.map(file => file.fileName)).toEqual(uploads);
  expect(new Set(input.documents.map(file => file.readingId)).size).toBe(2);
  expect(dialog.text()).toContain("first.pdf"); expect(dialog.text()).toContain("second.pdf");
  expect(request.dryRun).toBe(false);
});

it("keeps the accepted selection and refuses invalid PDFs before planning or uploading them", async () => {
  let uploads = 0;
  const dialog = await h.openDialog(h.stubClient({ uploadOcrSource: async request => {
    uploads += 1;
    return OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
      artifact: { id: "00000000-0000-4000-8000-000000000001", mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } });
  } }), { workflows: [workflow], panelWorkflowId: workflow.workflowId });
  await attach([pdf("accepted.pdf", "%PDF accepted")]);
  await attach([new File(["wrong"], "wrong.txt", { type: "text/plain" })]);
  expect(uploads).toBe(1); expect(dialog.text()).toContain("PDF selection refused");
  expect(dialog.text()).toContain("accepted.pdf"); expect(dialog.disabled("Continue")).toBe(true);
  await dialog.press("Remove accepted.pdf");
  expect(dialog.text()).toContain("No PDFs selected"); expect(dialog.disabled("Continue")).toBe(true);
});
