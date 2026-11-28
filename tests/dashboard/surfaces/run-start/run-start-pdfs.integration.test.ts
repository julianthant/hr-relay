// @vitest-environment jsdom
import { emergencyContactModule, i9CheckStartModule } from "../../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { FIXTURE_CHATGPT_OCR_SIGNED_OUT } from "../../../support/fixtures/dashboard/fixture-chatgpt-account.js";
import { I9CheckStartInput, I9_CHECK_REFERENCE } from "../../../../src/models/workflows/i9-check/start.js";
import { projectStartRows, projectStartSteps, startRowWire } from "../../../../src/backend/runs/start/step-selection.js";
import { OcrSourceUploadSchema } from "../../../../src/models/ocr/review.js";
import { StartPlanRequestSchema } from "../../../../src/models/dashboard/start-plan.js";
import { StartCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { createHash } from "node:crypto";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { DashboardClientError } from "../../../../src/dashboard/client/errors.js";
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
  requiredWorkbookFields: descriptor.requiredWorkbookFields, workbookReference: descriptor.workbookReference };
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

it.each([
  { parent: descriptor, row: "Read I-9 forms", start: "Start live run" },
  { parent: emergencyContactModule.descriptor, row: "Read emergency contact", start: "Start run" },
])("starts $parent.label with manual OCR values from the picker while subscription OCR is unavailable", async ({ parent, row, start }) => {
  const plans: unknown[] = [], commands: unknown[] = [];
  const flow: RunStartWorkflow = { ...workflow, workflowId: parent.id, label: parent.label, version: parent.version,
    steps: projectStartSteps(parent), rows: projectStartRows(parent).map(startRowWire), uploadRun: parent.surfaces.uploadRun,
    requiredWorkbookFields: parent.requiredWorkbookFields, workbookReference: parent.workbookReference };
  const dialog = await h.openDialog(client({
    checkChatGptAccount: async () => FIXTURE_CHATGPT_OCR_SIGNED_OUT,
    uploadOcrSource: async request => OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
      artifact: { id: "00000000-0000-4000-8000-000000000001", mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } }),
    submitStartPlan: async request => {
      plans.push(request);
      return { ...h.planResponse("5a000000-0000-4000-8000-000000000001"), workflowId: parent.id,
        omittedSteps: StartPlanRequestSchema.parse(request).stepOmissions?.map(({ step }) => step) };
    },
    executeCommand: async request => { commands.push(request); return h.APPLIED; },
  }, parent.requiredWorkbookFields, parent), { workflows: [h.WORKFLOWS[0], flow], panelWorkflowId: h.WORKFLOW_ID });
  await dialog.press(flow.label);
  await attach([pdf("first.pdf", "%PDF first")]);
  await h.chooseReference("Action History.xlsx", "Fall review", "Action History");
  await dialog.press("Next");
  if (parent.id === "emergency-contact") {
    const skip = document.querySelector<HTMLInputElement>('input[type="radio"][name^="File to OnBase-"][value="skip"]');
    assert.ok(skip);
    await act(async () => skip.click());
  }
  await dialog.press("Customize steps");
  await dialog.press("Next");
  expect(dialog.stage()).toBe("Steps");
  expect(dialog.disabled(start)).toBe(true);
  await dialog.press(`Include ${row}`);
  await dialog.fill("Original page readings", "x");
  expect(dialog.disabled(start)).toBe(true);
  expect(dialog.text()).toContain("enter one valid JSON reading per original page");
  expect(plans).toEqual([]);
  const reading = JSON.stringify({ sourcePage: 1, pageKind: "blank", readAt: "2026-11-01T00:00:00Z", record: null });
  await dialog.fill("Original page readings", reading);
  await dialog.press("Include Group records for review");
  expect(dialog.disabled("Include Review extracted records")).toBe(true);
  expect(dialog.disabled(start)).toBe(true);
  await dialog.press("Include Group records for review");
  expect(dialog.disabled("Include Review extracted records")).toBe(false);
  assert.equal(dialog.disabled(start), false, dialog.text());
  await dialog.press(start);
  expect(StartPlanRequestSchema.parse(plans.at(-1)).stepOmissions).toEqual([
    { workflow: "ocr", step: "page-readings", facts: { readings: [reading] } },
  ]);
  expect(StartCommandRequestSchema.parse(commands.at(-1))).toMatchObject({ requestedBy: h.ACTOR_ID, target: { workflowId: parent.id } });
});

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
  expect(dialog.disabled("Next")).toBe(true);
  expect(document.querySelector("textarea")).toBeNull();
  await attach([pdf("first.pdf", "%PDF first"), pdf("second.pdf", "%PDF second")]);
  expect(uploads).toEqual(["first.pdf", "second.pdf"]);
  expect(dialog.text()).toContain("2 PDFs selected");
  expect(dialog.disabled("Next")).toBe(true);
  await h.chooseReference('Action History.xlsx', 'Fall review', 'Action History');
  expect(dialog.disabled("Next")).toBe(false);
  await dialog.press("Next");
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
  await dialog.press("Next");
  const dryRunSwitch = [...document.querySelectorAll<HTMLElement>('[role="switch"]')].find(node => node.closest("label")?.textContent?.includes("Dry run"));
  assert.ok(dryRunSwitch, "Dry run switch is missing");
  expect(dryRunSwitch.closest(".ds-run-row")?.textContent).toContain("Dry run");
  expect(dryRunSwitch.closest(".ds-run-row")?.textContent).toContain("Fill and check every step without submitting or saving.");
  await act(async () => dryRunSwitch.click()); await h.settle();
  expect(dialog.text()).toContain("Start dry run");
  await dialog.press("Start dry run");
  expect(StartPlanRequestSchema.parse(plans[0]).dryRun).toBe(true);
  expect(dialog.text()).not.toContain("I-9 Check results");
});

it("holds Continue until the required reference spreadsheet is chosen and shows it on the last stage", async () => {
  const plans: unknown[] = [];
  const dialog = await h.openDialog(client({ uploadOcrSource: async request => OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
    artifact: { id: "00000000-0000-4000-8000-000000000001", mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } }),
  submitStartPlan: async request => { plans.push(request); throw new Error("a missing reference must not reach planning"); } }), { workflows: [workflow], panelWorkflowId: workflow.workflowId });
  await attach([pdf("first.pdf", "%PDF first")]);
  expect(dialog.disabled("Next")).toBe(true);
  expect(dialog.text()).toContain("Add a reference spreadsheet first.");
  expect(dialog.text()).not.toContain("malformed");
  await h.chooseReference('Action History.xlsx', 'Fall review', 'Action History');
  expect(dialog.disabled("Next")).toBe(false);
  expect(dialog.text()).not.toContain("Add a reference spreadsheet first.");
  await dialog.press("Next");
  expect(dialog.text()).toContain("Reference spreadsheet");
  expect(dialog.text()).toContain("Action History.xlsx");
  expect(plans).toEqual([]);
});

it("offers one References field whose Add spreadsheet fills the required reference first and holds Continue until it is chosen", async () => {
  const checkWorkflow = { ...workflow, workbookCheck: { id: "reference-check", keyFieldId: "eid" } } as RunStartWorkflow;
  const dialog = await h.openDialog(client({ uploadOcrSource: async request => OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
    artifact: { id: "00000000-0000-4000-8000-000000000001", mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } }) }),
  { workflows: [checkWorkflow], panelWorkflowId: checkWorkflow.workflowId });
  await attach([pdf("first.pdf", "%PDF first")]);
  const field = document.querySelector('[role="region"][aria-label="References"]'); assert.ok(field, "the References field");
  expect(document.querySelectorAll('[role="region"][aria-label="References"]')).toHaveLength(1);
  expect(dialog.text()).not.toContain("Also check");
  expect(dialog.text()).not.toContain("Reference spreadsheets");
  expect(dialog.disabled("Next")).toBe(true);
  expect(dialog.text()).toContain("Add a reference spreadsheet first.");
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
  expect(uploads).toBe(1); expect(dialog.text()).not.toContain("PDF selection refused"); expect(dialog.text()).toContain("Choose valid PDF files.");
  expect(dialog.text()).toContain("accepted.pdf"); expect(dialog.disabled("Next")).toBe(true);
  await dialog.press("Remove accepted.pdf");
  expect(dialog.text()).toContain("No PDFs selected"); expect(dialog.disabled("Next")).toBe(true);
});

/** The failure strip (8580181254) shows the first sentence on one line and keeps the full catalog text as its title. */
function expectFailureStrip(full: string): void {
  const strip = document.querySelector<HTMLElement>('[role="alert"]');
  expect(strip).not.toBeNull();
  expect(strip?.querySelector("span[title]")?.getAttribute("title")).toBe(full);
  expect(strip?.textContent).toContain(full.split(/(?<=[.!?])\s/u)[0]);
}

it("refuses the same PDF bytes under another filename without replacing the accepted draft", async () => {
  let calls = 0;
  const dialog = await h.openDialog(client({ uploadOcrSource: async request => {
    calls += 1;
    return OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
      artifact: { id: `00000000-0000-4000-8000-${String(calls).padStart(12, "0")}`, mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } });
  } }), { workflows: [workflow], panelWorkflowId: workflow.workflowId });
  await attach([pdf("original.pdf", "%PDF same content")]);
  await attach([pdf("renamed.pdf", "%PDF same content")]);
  expect(dialog.text()).not.toContain("PDF selection refused");
  expectFailureStrip(ERROR_CATALOG.OCR_SOURCE_REFUSED.text);
  expect(dialog.text()).toContain("original.pdf");
  expect(document.querySelector('[aria-label="Remove original.pdf"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Remove renamed.pdf"]')).toBeNull();
  expect(dialog.disabled("Next")).toBe(true);
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

it("says a draft was kept only when it reopens on the workflow it was typed in", async () => {
  const other = h.WORKFLOWS.find(candidate => candidate.inputRun.state === "present" && candidate.workflowId !== workflow.workflowId); assert.ok(other);
  const text = h.WORKFLOWS.find(candidate => candidate.inputRun.state === "present" && candidate.uploadRun === undefined); assert.ok(text);
  const next = other.workflowId === text.workflowId ? workflow : other;
  const dialog = await h.openDialog(client({}), { workflows: [text, next], panelWorkflowId: text.workflowId });
  const reopen = async (panelWorkflowId: string) => {
    await dialog.press("Close"); await dialog.rerender({ open: false }); await dialog.rerender({ open: true, panelWorkflowId });
  };
  await dialog.type("10812345");
  await reopen(text.workflowId);
  expect(dialog.text()).toContain("Draft kept");
  await reopen(next.workflowId);
  expect(dialog.text()).not.toContain("Draft kept");
});

it("keeps what was typed after picking a workflow in the list, and says so on reopening on it", async () => {
  const other = h.WORKFLOWS.find(candidate => candidate.inputRun.state === "present" && candidate.workflowId !== workflow.workflowId); assert.ok(other);
  const text = h.WORKFLOWS.find(candidate => candidate.inputRun.state === "present" && candidate.uploadRun === undefined); assert.ok(text);
  const first = other.workflowId === text.workflowId ? workflow : other;
  const dialog = await h.openDialog(client({}), { workflows: [first, text], panelWorkflowId: first.workflowId });
  await dialog.press(text.label);
  await dialog.type("10812345");
  await dialog.press("Close"); await dialog.rerender({ open: false }); await dialog.rerender({ open: true, panelWorkflowId: text.workflowId });
  expect(dialog.text()).toContain("Draft kept");
  expect(document.querySelector("textarea")?.value).toBe("10812345");
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
    inputRun: { state: "absent", reason: "PDF input" }, uploadRun: contact.surfaces.uploadRun && { ...contact.surfaces.uploadRun, supportsDryRun: true }, requiredWorkbookFields: contact.requiredWorkbookFields, workbookReference: contact.workbookReference };
  const dialog = await h.openDialog(served, { workflows: [flow], panelWorkflowId: flow.workflowId });
  await attach([pdf("first.pdf", "%PDF first"), pdf("second.pdf", "%PDF second")]);
  await h.chooseReference('Action History.xlsx', 'Fall review', 'Action History');
  await dialog.press("Next");
  const dryRun = [...document.querySelectorAll<HTMLElement>('[role="checkbox"], [role="switch"]')].find(node => node.closest("label")?.textContent?.startsWith("Dry run"));
  assert.ok(dryRun); await act(async () => dryRun.click());
  // File to OnBase has no default: no choice is selected, and the plan cannot be asked for until one is.
  const picks = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"][name^="File to OnBase-"]')];
  expect(picks.map(radio => [radio.value, radio.checked])).toEqual([["file", false], ["skip", false]]);
  expect(picks[0]?.closest(".ds-run-row")?.textContent).toContain("File to OnBase");
  expect(dialog.disabled("Start dry run")).toBe(true);
  expect(dialog.text()).toContain("Pick File to OnBase.");
  expect(plans).toHaveLength(0);
  const skip = picks[1]; assert.ok(skip); await act(async () => skip.click());
  expect(dialog.disabled("Start dry run")).toBe(false);
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

async function contactDialog(plans: unknown[], options: { withoutOcrFields?: boolean; ocrUnavailable?: boolean } = {}) {
  const contact = compileWorkflow(emergencyContactWorkflow).descriptor;
  const uploadRun = contact.surfaces.uploadRun; assert.ok(uploadRun);
  const served = client({
    ...(options.ocrUnavailable === true ? { checkChatGptAccount: async (_signal, check) => {
      assert.equal(check?.fresh, true);
      return FIXTURE_CHATGPT_OCR_SIGNED_OUT;
    } } : {}),
    uploadOcrSource: async request => OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
      artifact: { id: "00000000-0000-4000-8000-000000000001", mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } }),
    submitStartPlan: async request => { plans.push(request); const plan = h.planResponse("5a000000-0000-4000-8000-000000000002");
      return { ...plan, workflowId: contact.id, planned: plan.planned.map(entry => ({ ...entry, workbookReferences: [{ libraryId: reference.libraryId, version: reference.version, versionId: "earlier", versionName: "Fall review", worksheets: [{ sheetId: "history", name: "Action History" }], type: reference.type }] })) }; } }, [...contact.requiredWorkbookFields], contact);
  const flow: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: contact.id, label: contact.label, version: contact.version, steps: projectStartSteps(contact),
    inputRun: { state: "absent", reason: "PDF input" },
    uploadRun: options.withoutOcrFields ? { ...uploadRun, fields: uploadRun.fields.filter(field => field.kind !== "boolean") } : uploadRun,
    requiredWorkbookFields: contact.requiredWorkbookFields, workbookReference: contact.workbookReference };
  const dialog = await h.openDialog(served, { workflows: [flow], panelWorkflowId: flow.workflowId });
  await attach([pdf("first.pdf", "%PDF first")]);
  await h.chooseReference("Action History.xlsx", "Fall review", "Action History");
  await dialog.press("Next");
  const skip = document.querySelector<HTMLInputElement>('input[type="radio"][name^="File to OnBase-"][value="skip"]'); assert.ok(skip);
  await act(async () => skip.click());
  return dialog;
}
const ocrSwitch = () => [...document.querySelectorAll<HTMLElement>('[role="switch"]')].find(node => node.closest("label")?.textContent?.includes("Extract with OCR"));

it("shows unavailable OCR in Checks and keeps manual entry available", async () => {
  const plans: unknown[] = [];
  const dialog = await contactDialog(plans, { ocrUnavailable: true });
  expect(dialog.text()).toContain(ERROR_CATALOG.PROVIDER_UNAVAILABLE.text);
  expect(dialog.disabled("Start run")).toBe(true);
  expect(plans).toHaveLength(0);
  const control = ocrSwitch(); assert.ok(control);
  await act(async () => control.click()); await h.settle();
  expect(dialog.text()).not.toContain(ERROR_CATALOG.PROVIDER_UNAVAILABLE.text);
  expect(dialog.disabled("Start run")).toBe(false);
});

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
  await dialog.press("Start run");
  expect(EmergencyContactInputSchema.parse(StartPlanRequestSchema.parse(plans[0]).submissions[0]).extractWithOcr).toBe(false);
});

it("sends extractWithOcr true when the switch is left on", async () => {
  const plans: unknown[] = [];
  const dialog = await contactDialog(plans);
  await dialog.press("Start run");
  expect(EmergencyContactInputSchema.parse(StartPlanRequestSchema.parse(plans[0]).submissions[0]).extractWithOcr).toBe(true);
});

it("shows no OCR switch for a PDF workflow that does not declare the field", async () => {
  await contactDialog([], { withoutOcrFields: true });
  expect(ocrSwitch()).toBeUndefined();
});

it("shows a plain upload failure in the notice slot with one Retry that sends the same file again", async () => {
  let calls = 0;
  const dialog = await h.openDialog(client({ uploadOcrSource: async request => {
    calls += 1;
    if (calls === 1) throw new DashboardClientError({ kind: "http", message: "ENOSPC: no space left on device, write '/var/relay/tmp/ocr/6f1c.pdf'", status: 500 });
    return OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
      artifact: { id: "00000000-0000-4000-8000-000000000001", mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } });
  } }), { workflows: [workflow], panelWorkflowId: workflow.workflowId });
  await attach([pdf("report.pdf", "%PDF report")]);
  expectFailureStrip(ERROR_CATALOG.OCR_UPLOAD_FAILED.text);
  for (const raw of ["ENOSPC", "/var/relay", "PDF selection refused"]) expect(dialog.text()).not.toContain(raw);
  await dialog.press("Retry");
  expect(calls).toBe(2);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(dialog.text()).toContain("report.pdf");
});

it("reads dropped PDFs and ignores a drop while it is still reading", async () => {
  const uploads: string[] = [];
  await h.openDialog(client({ uploadOcrSource: async request => { uploads.push(request.fileName); return new Promise<never>(() => undefined); } }),
    { workflows: [workflow], panelWorkflowId: workflow.workflowId });
  const drop = async (file: File) => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]'); assert.ok(input?.parentElement);
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    await act(async () => { input.parentElement?.dispatchEvent(event); });
    await h.settle();
    return event;
  };
  expect((await drop(pdf("first.pdf", "%PDF first"))).defaultPrevented).toBe(true);
  expect(uploads).toEqual(["first.pdf"]);
  await drop(pdf("second.pdf", "%PDF second"));
  expect(uploads).toEqual(["first.pdf"]);
});
