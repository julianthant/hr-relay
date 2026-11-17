// @vitest-environment jsdom
import { i9CheckStartModule } from "../../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { I9CheckStartInput, I9_CHECK_REFERENCE } from "../../../../src/models/workflows/i9-check/start.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { OcrSourceUploadSchema } from "../../../../src/models/ocr/review.js";
import { StartPlanRequestSchema } from "../../../../src/models/dashboard/start-plan.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { createHash } from "node:crypto";
import { WorkbookLibraryEntrySchema, WorkbookLibraryVersionViewSchema, projectWorkbookCompatibility } from "../../../../src/models/dashboard/workbook-library.js";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { emergencyContactWorkflow } from "../../../../src/workflows/emergency-contact/workflow.js";
import { EmergencyContactInputSchema } from "../../../../src/models/workflows/emergency-contact/input.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);
const descriptor = i9CheckStartModule.descriptor;
const plannedOutputs = descriptor.plannedOutputs; assert.ok(plannedOutputs);
const workflow: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: descriptor.id, label: descriptor.label, version: descriptor.version,
  steps: projectStartSteps(descriptor), inputRun: { state: "absent", reason: "PDF input" }, uploadRun: descriptor.surfaces.uploadRun,
  requiredWorkbookFields: descriptor.requiredWorkbookFields, workbookReference: descriptor.workbookReference, referenceSources: [] };
const reference = WorkbookLibraryEntrySchema.parse({ libraryId: "action-history-file", version: 3, name: "Action History.xlsx", updatedAt: "2026-11-01T00:00:00Z", rowCount: 2,
  worksheets: [{ id: "history", name: "Action History" }], metadata: { typeId: I9_CHECK_REFERENCE.typeId, sharePoint: null },
  type: { id: I9_CHECK_REFERENCE.typeId, name: "Action History", keyFieldId: "eid", fields: [...I9_CHECK_REFERENCE.fields], defaultWorkbookId: "action-history-file" },
  state: { libraryId: "action-history-file", revision: 4, selectedVersionId: "current", removed: false, pinned: false, tags: [], origin: { kind: "local" },
    versions: ["earlier", "current"].map((id, index) => ({ id, name: id === "earlier" ? "Fall review" : "Current", snapshotId: id,
      version: index + 1, savedAt: "2026-11-01T00:00:00Z", source: "operator" })) } });
const workbookFor = (fields: readonly string[]) => ({ name: reference.name, libraryId: reference.libraryId, themes: [], hasFormulas: false,
  sheets: [{ id: 'history', name: 'Action History', width: fields.length, hidden: [],
    columnBindings: fields.map((fieldId, column) => ({ id: `binding-${column}`, sourceColumn: column, sourceHeader: fieldId, fieldId, basis: 'manual' as const })),
    rows: [{ id: 'header', cells: fields.map(value => ({ value })) }, { id: 'person', cells: fields.map(value => ({ value: value === 'eid' ? '10800000' : '' })) }] }] });
const compatibilityFor = (workflow: Parameters<typeof projectWorkbookCompatibility>[0][number], fields: readonly string[]) => projectWorkbookCompatibility([workflow], [{ libraryId: reference.libraryId, versionId: 'current', origin: { kind: 'local' }, removed: false,
  sheets: [{ id: 'history', name: 'Action History', mappings: fields.map((fieldId, column) => ({ fieldId, column, basis: 'manual' as const })) }] }]);
function client(served: Partial<DashboardClient>, fields: readonly string[] = descriptor.requiredWorkbookFields, workflow: Parameters<typeof projectWorkbookCompatibility>[0][number] = descriptor) {
  return h.stubClient({ workbookCatalog: async () => [reference], workbookCompatibility: async () => compatibilityFor(workflow, fields),
    workbookTypes: async () => [reference.type], workbookLibraryVersion: async (_libraryId, versionId) => WorkbookLibraryVersionViewSchema.parse({
      libraryId: reference.libraryId, version: reference.state.versions.find(version => version.id === versionId), workbook: workbookFor(fields),
    }), ...served });
}
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
  const served = client({ uploadOcrSource: async request => {
    uploads.push(request.fileName);
    return OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
      artifact: { id: `00000000-0000-4000-8000-${String(uploads.length).padStart(12, "0")}`, mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } });
  }, submitStartPlan: async request => { plans.push(request); const plan = h.planResponse("5a000000-0000-4000-8000-000000000001");
    const plannedRequest = StartPlanRequestSchema.parse(request);
    return { ...plan, workflowId: descriptor.id, planned: plan.planned.map(entry => ({ ...entry,
      outputs: [...plannedOutputs(I9CheckStartInput.parse(plannedRequest.submissions[0]), [])],
      workbookReferences: [{ libraryId: reference.libraryId, version: reference.version, versionId: "earlier", versionName: "Fall review",
        worksheets: [{ sheetId: "history", name: "Action History" }], type: reference.type }],
    })) }; } });
  const dialog = await h.openDialog(served, { workflows: [workflow], panelWorkflowId: workflow.workflowId });
  expect(dialog.disabled("Continue")).toBe(true);
  expect(document.querySelector("textarea")).toBeNull();
  await attach([pdf("first.pdf", "%PDF first"), pdf("second.pdf", "%PDF second")]);
  expect(uploads).toEqual(["first.pdf", "second.pdf"]);
  expect(dialog.text()).toContain("2 PDFs selected");
  expect(dialog.disabled("Continue")).toBe(false);
  await h.chooseReference('Action History.xlsx', 'Fall review', 'Action History');
  await dialog.press("Continue");
  await dialog.press("Continue");
  expect(dialog.text()).toContain("Action History.xlsx · Fall review");
  await dialog.press("Start live run");
  expect(plans).toHaveLength(1);
  const request = StartPlanRequestSchema.parse(plans[0]);
  expect(request.submissions).toHaveLength(1);
  expect(request.workbookReferences).toEqual([{ entry: 1, libraryId: reference.libraryId, versionId: "earlier", sheetId: 'history', expectedVersion: 3 }]);
  const input = I9CheckStartInput.parse(request.submissions[0]);
  expect(input.documents.map(file => file.fileName)).toEqual(uploads);
  expect(new Set(input.documents.map(file => file.readingId)).size).toBe(2);
  expect(dialog.text()).not.toContain("I-9 Check results");
  expect(dialog.text()).not.toContain("One row per person after review");
  expect(request.dryRun).toBe(false);
});

it("offers the Dry run switch for the PDF workflow and plans and confirms a dry run", async () => {
  const plans: unknown[] = [];
  const dryWorkflow = { ...workflow, uploadRun: { ...workflow.uploadRun, supportsDryRun: true } } as RunStartWorkflow;
  const served = client({ uploadOcrSource: async request => OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
    artifact: { id: "00000000-0000-4000-8000-000000000001", mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } }),
  submitStartPlan: async request => { plans.push(request); const plan = h.planResponse("5a000000-0000-4000-8000-000000000001");
    return { ...plan, workflowId: descriptor.id, dryRun: true, planned: plan.planned.map(entry => ({ ...entry, outputs: [],
      workbookReferences: [{ libraryId: reference.libraryId, version: reference.version, versionId: "earlier", versionName: "Fall review",
        worksheets: [{ sheetId: "history", name: "Action History" }], type: reference.type }] })) }; } });
  const dialog = await h.openDialog(served, { workflows: [dryWorkflow], panelWorkflowId: dryWorkflow.workflowId });
  await attach([pdf("first.pdf", "%PDF first")]);
  await h.chooseReference('Action History.xlsx', 'Fall review', 'Action History');
  await dialog.press("Continue");
  const dryRunSwitch = [...document.querySelectorAll<HTMLElement>('[role="switch"]')].find(node => node.closest("label")?.textContent?.includes("Dry run"));
  assert.ok(dryRunSwitch, "Dry run switch is missing");
  expect(dryRunSwitch.closest(".ds-run-row")?.textContent).toContain("Dry run");
  expect(dryRunSwitch.closest(".ds-run-row")?.textContent).toContain("Fill and check every step without submitting or saving.");
  await act(async () => dryRunSwitch.click()); await h.settle();
  await dialog.press("Continue");
  expect(dialog.text()).toContain("Start dry run");
  await dialog.press("Start dry run");
  expect(StartPlanRequestSchema.parse(plans[0]).dryRun).toBe(true);
  expect(dialog.text()).not.toContain("I-9 Check results");
});

it("keeps the accepted selection and refuses invalid PDFs before planning or uploading them", async () => {
  let uploads = 0;
  const dialog = await h.openDialog(client({ uploadOcrSource: async request => {
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

it("refuses the same PDF bytes under another filename without replacing the accepted draft", async () => {
  let calls = 0;
  const dialog = await h.openDialog(client({ uploadOcrSource: async request => {
    calls += 1;
    return OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
      artifact: { id: `00000000-0000-4000-8000-${String(calls).padStart(12, "0")}`, mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } });
  } }), { workflows: [workflow], panelWorkflowId: workflow.workflowId });
  await attach([pdf("original.pdf", "%PDF same content")]);
  await attach([pdf("renamed.pdf", "%PDF same content")]);
  expect(dialog.text()).toContain("PDF selection refused");
  expect(dialog.text()).toContain("original.pdf");
  expect(document.querySelector('[aria-label="Remove original.pdf"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Remove renamed.pdf"]')).toBeNull();
  expect(dialog.disabled("Continue")).toBe(true);
});

it("retires an upload when the selected workflow changes and ignores its late response", async () => {
  type Upload = ReturnType<typeof OcrSourceUploadSchema.parse>;
  const held: { resolve?: (upload: Upload) => void; signal: AbortSignal | undefined } = { signal: undefined };
  const pending = new Promise<Upload>(resolve => { held.resolve = resolve; });
  const other = h.WORKFLOWS.find(candidate => candidate.inputRun.state === "present"); assert.ok(other);
  const dialog = await h.openDialog(client({ uploadOcrSource: (_request, signal) => { held.signal = signal; return pending; } }),
    { workflows: [workflow, other], panelWorkflowId: workflow.workflowId });
  const file = pdf("retired.pdf", "%PDF retired");
  await attach([file]);
  expect(dialog.text()).toContain("Reading PDFs");
  await dialog.press(other.label);
  expect(held.signal?.aborted).toBe(true);
  const resolve = held.resolve; assert.ok(resolve);
  await act(async () => resolve(OcrSourceUploadSchema.parse({ fileName: file.name, uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
    artifact: { id: "00000000-0000-4000-8000-000000000001", mediaType: "application/pdf", bytes: file.size, sha256: createHash("sha256").update(new Uint8Array(await file.arrayBuffer())).digest("hex") } })));
  expect(dialog.text()).not.toContain(file.name);
  expect(document.querySelector('[aria-label="Selected PDFs"]')).toBeNull();
  expect(document.querySelector("textarea")).not.toBeNull();
});

it("plans one Emergency Contact run per uploaded PDF", async () => {
  const contact = compileWorkflow(emergencyContactWorkflow).descriptor, uploads: string[] = [], plans: unknown[] = [];
  const served = client({
    uploadOcrSource: async request => {
      uploads.push(request.fileName);
      return OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
        artifact: { id: `00000000-0000-4000-8000-${String(uploads.length).padStart(12, "0")}`, mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } });
    }, submitStartPlan: async request => { plans.push(request); const plan = h.planResponse("5a000000-0000-4000-8000-000000000002");
      return { ...plan, dryRun: true, workflowId: contact.id, planned: ["first.pdf", "second.pdf"].map(title => ({ ...plan.planned[0], title,
        workbookReferences: [{ libraryId: reference.libraryId, version: reference.version, versionId: "earlier", versionName: "Fall review", worksheets: [{ sheetId: "history", name: "Action History" }], type: reference.type }] })) }; } }, [...contact.requiredWorkbookFields], contact);
  const flow: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: contact.id, label: contact.label, version: contact.version, steps: projectStartSteps(contact),
    inputRun: { state: "absent", reason: "PDF input" }, uploadRun: contact.surfaces.uploadRun && { ...contact.surfaces.uploadRun, supportsDryRun: true }, requiredWorkbookFields: contact.requiredWorkbookFields, workbookReference: contact.workbookReference, referenceSources: [] };
  const dialog = await h.openDialog(served, { workflows: [flow], panelWorkflowId: flow.workflowId });
  await attach([pdf("first.pdf", "%PDF first"), pdf("second.pdf", "%PDF second")]);
  await h.chooseReference('Action History.xlsx', 'Fall review', 'Action History');
  await dialog.press("Continue");
  const dryRun = [...document.querySelectorAll<HTMLElement>('[role="checkbox"], [role="switch"]')].find(node => node.closest("label")?.textContent?.startsWith("Dry run"));
  assert.ok(dryRun); await act(async () => dryRun.click());
  // File to OnBase has no default: no choice is selected, and the plan cannot be asked for until one is.
  const picks = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"][name^="File to OnBase-"]')];
  expect(picks.map(radio => [radio.value, radio.checked])).toEqual([["file", false], ["skip", false]]);
  expect(picks[0]?.closest(".ds-run-row")?.textContent).toContain("File to OnBase");
  expect(dialog.disabled("Continue")).toBe(true);
  expect(dialog.text()).toContain("Pick File to OnBase.");
  expect(plans).toHaveLength(0);
  const skip = picks[1]; assert.ok(skip); await act(async () => skip.click());
  expect(dialog.disabled("Continue")).toBe(false);
  await dialog.press("Start dry run");
  const request = StartPlanRequestSchema.parse(plans[0]);
  expect(request.dryRun).toBe(true);
  expect(request.submissions).toHaveLength(2);
  expect(request.submissions.map(submission => EmergencyContactInputSchema.parse(submission).fileName)).toEqual(uploads);
  expect(request.submissions.map(submission => EmergencyContactInputSchema.parse(submission).onbaseFiling)).toEqual(["skip", "skip"]);
  // The last stage shows the pick before Start.
  expect(dialog.text()).toContain("File to OnBase");
  expect(dialog.text()).toContain("Do not file");
});

async function contactDialog(plans: unknown[], options: { withoutOcrFields?: boolean } = {}) {
  const contact = compileWorkflow(emergencyContactWorkflow).descriptor;
  const uploadRun = contact.surfaces.uploadRun; assert.ok(uploadRun);
  const served = client({
    uploadOcrSource: async request => OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
      artifact: { id: "00000000-0000-4000-8000-000000000001", mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } }),
    submitStartPlan: async request => { plans.push(request); const plan = h.planResponse("5a000000-0000-4000-8000-000000000002");
      return { ...plan, workflowId: contact.id, planned: plan.planned.map(entry => ({ ...entry, workbookReferences: [{ libraryId: reference.libraryId, version: reference.version, versionId: "earlier", versionName: "Fall review", worksheets: [{ sheetId: "history", name: "Action History" }], type: reference.type }] })) }; } }, [...contact.requiredWorkbookFields], contact);
  const flow: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: contact.id, label: contact.label, version: contact.version, steps: projectStartSteps(contact),
    inputRun: { state: "absent", reason: "PDF input" },
    uploadRun: options.withoutOcrFields ? { ...uploadRun, fields: uploadRun.fields.filter(field => field.kind !== "boolean") } : uploadRun,
    requiredWorkbookFields: contact.requiredWorkbookFields, workbookReference: contact.workbookReference, referenceSources: [] };
  const dialog = await h.openDialog(served, { workflows: [flow], panelWorkflowId: flow.workflowId });
  await attach([pdf("first.pdf", "%PDF first")]);
  await h.chooseReference("Action History.xlsx", "Fall review", "Action History");
  await dialog.press("Continue");
  const skip = document.querySelector<HTMLInputElement>('input[type="radio"][name^="File to OnBase-"][value="skip"]'); assert.ok(skip);
  await act(async () => skip.click());
  return dialog;
}
const ocrSwitch = () => [...document.querySelectorAll<HTMLElement>('[role="switch"]')].find(node => node.closest("label")?.textContent?.includes("Extract with OCR"));

it("offers Extract with OCR on by default as a switch row, and the footer says OCR on", async () => {
  const dialog = await contactDialog([]);
  const control = ocrSwitch(); assert.ok(control);
  expect((control as HTMLInputElement).checked).toBe(true);
  const row = control.closest(".ds-run-row")?.textContent ?? "";
  expect(row).toContain("Extract with OCR");
  expect(row).toContain("Turn off to enter records manually in OCR review.");
  expect(dialog.text()).toContain("· OCR on");
});

it("turning the switch off changes the footer and the start request carries extractWithOcr false", async () => {
  const plans: unknown[] = [];
  const dialog = await contactDialog(plans);
  const control = ocrSwitch(); assert.ok(control);
  await act(async () => control.click()); await h.settle();
  expect((ocrSwitch() as HTMLInputElement).checked).toBe(false);
  expect(dialog.text()).toContain("· OCR off");
  expect(dialog.text()).not.toContain("· OCR on");
  await dialog.press("Continue");
  await dialog.press("Start run");
  expect(EmergencyContactInputSchema.parse(StartPlanRequestSchema.parse(plans[0]).submissions[0]).extractWithOcr).toBe(false);
});

it("sends extractWithOcr true when the switch is left on", async () => {
  const plans: unknown[] = [];
  const dialog = await contactDialog(plans);
  await dialog.press("Continue");
  await dialog.press("Start run");
  expect(EmergencyContactInputSchema.parse(StartPlanRequestSchema.parse(plans[0]).submissions[0]).extractWithOcr).toBe(true);
});

it("shows no OCR switch for a PDF workflow that does not declare the field", async () => {
  await contactDialog([], { withoutOcrFields: true });
  expect(ocrSwitch()).toBeUndefined();
});
