// @vitest-environment jsdom
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { act, createElement, useRef, type ReactElement } from "react";
import { afterEach, describe, it } from "vitest";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartRows, projectStartSteps, startRowWire } from "../../../../src/backend/runs/start/step-selection.js";
import { useRoute, type PopstateRouteHandler } from "../../../../src/dashboard/app/navigation/route-history-model.js";
import { ViewNavigationProvider } from "../../../../src/dashboard/app/navigation/view-navigation.js";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { RerunValuesSnapshotSchema } from "../../../../src/models/dashboard/rerun-values.js";
import { RerunWarningRequestSchema, RerunWarningWireSchema } from "../../../../src/models/dashboard/rerun-warning.js";
import { StartPlanRequestSchema, StartPlanWireSchema, type StartPlanRequest } from "../../../../src/models/dashboard/start-plan.js";
import { projectWorkbookCompatibility } from "../../../../src/models/dashboard/workbook-library.js";
import { OcrSourceUploadSchema } from "../../../../src/models/ocr/review.js";
import { CommandResultSchema, type CommandResult } from "../../../../src/rules/commands/commands.js";
import { RUN_DIALOG_REFERENCE_READS } from "../../../support/fixtures/dashboard/run-dialog-reference-fixtures.js";
import { RUN_DIALOG_DRY_RUN_CATALOG, RUN_DIALOG_PDF_CATALOG, RUN_DIALOG_REFERENCE_CATALOG, RUN_DIALOG_RERUN_SOURCE, RUN_DIALOG_WORKFLOW, runDialogRerunSnapshot } from "../../../support/fixtures/dashboard/run-dialog-story-fixtures.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);

const descriptor = DESCRIPTORS.find(entry => entry.id === "person-lookup");
assert.ok(descriptor?.surfaces.inputRun);
/** Person Lookup with its Lookup mode, CRM switch and step rows, as a workflow that can also dry run. */
const typed: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: descriptor.id, label: descriptor.label, version: descriptor.version,
  steps: projectStartSteps(descriptor), rows: projectStartRows(descriptor).map(startRowWire),
  inputRun: { state: "present", surface: { ...descriptor.surfaces.inputRun, supportsDryRun: true } } };
const CASES = ["typed", "pdf", "spreadsheet", "failed spreadsheets", "rerun", "rerun values"] as const;
type Case = typeof CASES[number];
const isRerun = (kind: Case) => kind === "rerun" || kind === "rerun values";
const servedIn = (catalog: typeof RUN_DIALOG_PDF_CATALOG): RunStartWorkflow => {
  const found = catalog.find(entry => entry.id === RUN_DIALOG_WORKFLOW)?.served; assert.ok(found); return found;
};
/** Every dialog whose controls differ: typed input, PDFs, a spreadsheet, an optional spreadsheet list that failed to load, a rerun's input and a rerun's copied values. */
const WORKFLOW: Readonly<Record<Case, RunStartWorkflow>> = { typed, pdf: servedIn(RUN_DIALOG_PDF_CATALOG),
  spreadsheet: servedIn(RUN_DIALOG_REFERENCE_CATALOG), "failed spreadsheets": { ...typed, workbookCheck: { id: "reference-check", keyFieldId: "eid" } }, rerun: typed, "rerun values": servedIn(RUN_DIALOG_DRY_RUN_CATALOG) };

const snapshot = RerunValuesSnapshotSchema.parse({
  sourceInput: { state: "available", value: { mode: "search", emplId: "10873698", crmCheck: true, keepNonHdh: false, includeCrmDates: true } },
  source: { runId: RUN_DIALOG_RERUN_SOURCE.runId, version: RUN_DIALOG_RERUN_SOURCE.expectedVersion, workflow: typed.workflowId,
    descriptorVersion: typed.version, contractFingerprint: h.HASH, outcome: "failed" },
  steps: typed.steps.map(step => ({ key: step.key, state: "completed", nodes: [{ nodeId: step.key, state: "completed", reason: "checkpoint" }] })),
  values: [], transactions: [],
});


const FAILED_READS: Partial<DashboardClient> = { workbookList: async () => [], workbookTypes: async () => [], workbookCompatibility: async () => projectWorkbookCompatibility([], []),
  workbookCatalog: async () => { throw new Error("unreachable"); } };

/** The dialog on its Input stage, filled in so that Start is available as soon as it is reached. */
async function openFilled(kind: Case, served: Partial<DashboardClient>, wrap?: (dialog: ReactElement) => ReactElement) {
  const workflow = WORKFLOW[kind];
  const dialog = await h.openDialog(h.stubClient({ ...(kind === "spreadsheet" ? RUN_DIALOG_REFERENCE_READS : {}), ...(kind === "failed spreadsheets" ? FAILED_READS : {}),
    uploadOcrSource: async request => OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: h.ACTOR_ID, uploadedAt: "2026-08-03T00:00:00.000Z",
      artifact: { id: "00000000-0000-4000-8000-000000000001", mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } }),
    ...served,
    rerunValues: async () => kind === "rerun values" ? runDialogRerunSnapshot() : { state: "available", snapshot },
    previewRerunWarnings: async request => RerunWarningWireSchema.parse({ workflowId: workflow.workflowId,
      rerun: { source: RerunWarningRequestSchema.parse(request).source, warnings: [], warningDigest: h.HASH } }),
  }), { workflows: [workflow], panelWorkflowId: workflow.workflowId, ...(isRerun(kind) ? { rerunSource: RUN_DIALOG_RERUN_SOURCE } : {}) }, undefined, wrap);
  await settleAll();
  if (kind === "typed" || kind === "spreadsheet" || kind === "failed spreadsheets") await dialog.type(h.TYPED);
  if (kind === "spreadsheet") { await h.chooseReference("Roster"); await settleAll(); }
  if (kind === "pdf") await attachPdf("one");
  return dialog;
}
async function attachPdf(name: string) {
  const bytes = new TextEncoder().encode(`%PDF ${name}`), file = new File([bytes], `${name}.pdf`, { type: "application/pdf" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]'); assert.ok(input);
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await settleAll();
}
type Opened = Awaited<ReturnType<typeof openFilled>>;

async function settleAll() { for (let wait = 0; wait < 6; wait += 1) await h.settle(); }
async function settleLong() { for (let wait = 0; wait < 6; wait += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function toStart(dialog: Opened, kind: Case) {
  await dialog.press("Continue");
  assert.equal(dialog.stage(), "Start");
  if (kind === "pdf") {
    const form = document.querySelector<HTMLInputElement>('input[type="radio"][value="w4"]'); assert.ok(form, "the Form choice");
    await act(async () => form.click());
  }
  if (kind === "typed" || kind === "failed spreadsheets") await dialog.press("Customize steps");
  await settleAll();
}
const startLabel = (kind: Case) => kind === "spreadsheet" ? "Start run" : "Start live run";

const PRIMARY = /^(Continue|Confirm|Start (live |dry )?run)$/u;
const FOCUSABLE = 'a[href], button, input:not([type="hidden"]):not([hidden]), textarea, select, [tabindex]';
/** Every control focus can rest on, except the primary button. The dialog's own surface and anything switched off are not controls. */
function controls(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`.launch-dialog :is(${FOCUSABLE})`)]
    .filter(node => !node.matches(":disabled") && !(node instanceof HTMLButtonElement && PRIMARY.test(node.textContent?.trim() ?? "")));
}
const nameOf = (node: Element) => `${node.tagName.toLowerCase()} ${node.getAttribute("role") ?? node.getAttribute("type") ?? ""} ${node.getAttribute("aria-label") ?? node.getAttribute("value") ?? node.textContent ?? ""}`.trim();

describe("Enter on a focused control", () => {
  it.each(CASES)("never plans or starts a run in the %s dialog", async kind => {
    const calls: string[] = [];
    const dialog = await openFilled(kind, {
      submitStartPlan: async () => { calls.push("plan"); return new Promise(() => undefined); },
      executeCommand: async () => { calls.push("command"); return h.APPLIED; },
    });
    const walked: string[] = [];
    for (const stage of ["Input", "Start"] as const) {
      if (stage === "Start") await toStart(dialog, kind);
      assert.equal(dialog.disabled(stage === "Input" ? "Continue" : startLabel(kind)), false, `${stage} is ready to go on, so Enter could act`);
      for (let index = 0; index < controls().length; index += 1) {
        const node = controls()[index];
        const name = nameOf(node);
        node.focus();
        await dialog.enter({ on: node });
        walked.push(name);
        assert.deepEqual(calls, [], `Enter on ${stage}: ${name} asked for a run`);
        // A text field's Enter continues, which starts nothing; go back and take the next control.
        if (dialog.stage() !== stage) {
          assert.equal(stage, "Input");
          assert.match(name, /^(textarea|input)/u, `${name} continued`);
          assert.doesNotMatch(name, /radio|switch|checkbox/u);
          await dialog.press("Back");
        }
      }
    }
    for (const expected of [/headless/u, /Priority|switch|checkbox/u, ...(kind === "pdf" ? [/i9/u, /w4/u] : [])]) {
      assert.ok(walked.some(name => expected.test(name)), `${String(expected)} was walked: ${walked.join(" | ")}`);
    }
    // The shortcut itself still works once no control has focus, so the walk could have started a run.
    await dialog.enter({ on: document.body });
    await settleAll();
    assert.deepEqual(calls, ["plan"]);
  });

  it("ignores a held Enter that carries over from Continue onto Start", async () => {
    const calls: string[] = [];
    const dialog = await openFilled("typed", { submitStartPlan: async () => { calls.push("plan"); return new Promise(() => undefined); } });
    await dialog.enter();
    await settleAll();
    assert.equal(dialog.stage(), "Start");
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true })); });
    await settleAll();
    assert.deepEqual(calls, []);
  });
});

/** What stays usable while a command is out: leaving the dialog, searching the workflow list and reading the checks again. Every other control must be off. */
const USABLE = (node: HTMLElement) => ["Close", "Cancel", "Clear search"].includes(node.getAttribute("aria-label") ?? node.textContent?.trim() ?? "")
  || node.matches('input[type="search"], input[aria-label*="workflow" i]') || node.closest('section[aria-label="Checks"]') !== null;
function openControls(): string[] {
  return [...document.querySelectorAll<HTMLElement>(`.launch-dialog :is(${FOCUSABLE}, [role="combobox"], [role="spinbutton"])`)]
    .filter(node => !USABLE(node) && !node.matches(':disabled, [aria-disabled="true"], [data-disabled], [tabindex="-1"]')).map(nameOf);
}
const chosen = (label: string) => document.querySelector(`[data-run-choice="${label}"]`)?.textContent;

/** The plan the backend gives back for a request, with the references and rerun source it asked for. */
function planFor(request: unknown) {
  const asked = StartPlanRequestSchema.parse(request);
  const plan = h.planResponse("5a000000-0000-4000-8000-000000000001");
  const references = (asked.workbookReferences ?? []).map(chosen => ({ libraryId: chosen.libraryId, version: chosen.expectedVersion, versionId: chosen.versionId, versionName: "Reviewed",
    worksheets: [{ sheetId: chosen.sheetId, name: "First" }], type: { id: "roster-type", name: "Roster", keyFieldId: "eid", fields: ["eid"], defaultWorkbookId: "roster" } }));
  return StartPlanWireSchema.parse({ ...plan, workflowId: asked.workflowId, dryRun: asked.dryRun, ...(asked.priority === undefined ? {} : { priority: asked.priority }),
    planned: plan.planned.map(entry => references.length === 0 ? entry : { ...entry, workbookReferences: references }),
    ...(asked.rerunSource === undefined ? {} : { rerun: { source: asked.rerunSource, warnings: [], warningDigest: h.HASH,
      ...(asked.warningAcknowledgment === undefined ? {} : { acknowledgment: asked.warningAcknowledgment }) } }) });
}

describe("a start whose command is held", () => {
  it.each(CASES)("locks every control that could move the request, on Start and on Input, in the %s dialog, then settles", async kind => {
    const sent: unknown[] = [];
    const replies: PromiseWithResolvers<CommandResult>[] = [];
    const dialog = await openFilled(kind, {
      submitStartPlan: async request => { sent.push(request); return planFor(request); },
      executeCommand: () => { const reply = Promise.withResolvers<CommandResult>(); replies.push(reply); return reply.promise; },
    });
    assert.ok(openControls().length > 0, "Input is open before the start");
    if (kind === "failed spreadsheets") assert.ok(openControls().some(name => /Retry/u.test(name)), "the failed read offers Retry before the start");
    await toStart(dialog, kind);
    assert.ok(openControls().some(name => /Back/u.test(name)) && openControls().some(name => /headless/u.test(name)), "Start is open before the start");
    await dialog.chooseBrowserMode("headless");
    await dialog.press(startLabel(kind));
    await settleAll();
    assert.equal(replies.length, 1, `the command is out: ${dialog.text()}`);

    assert.deepEqual(openControls(), [], "Start");
    assert.equal(document.querySelectorAll('.launch-content input[type="radio"]').length, 0, "no choice is offered while its changes are refused");
    assert.equal(chosen("Browser mode"), "Hidden");
    if (kind === "pdf") assert.equal(chosen("Form"), "W-4");

    // An unknown outcome gives the dialog back; its replay is a command held on Input.
    await act(async () => { replies[0].reject(new Error("connection lost")); });
    await settleLong();
    await dialog.press("Back");
    assert.equal(dialog.stage(), "Input");
    await dialog.press("Replay exact submission");
    await settleAll();
    assert.equal(replies.length, 2, `the replay is out: ${dialog.text()}`);
    assert.deepEqual(openControls(), [], "Input");
    if (kind === "typed" || kind === "rerun") assert.ok(document.querySelector("[data-run-choice]"), "the Lookup mode shows its chosen value");

    assert.equal(sent.length, 1);
    await act(async () => { replies[1].resolve(h.APPLIED); await Promise.resolve(); });
    await settleLong();
    assert.deepEqual(h.closed, [false], "the applied reply closed the dialog");
  });

  it.each(["answers", "fails"] as const)("lands its reply when a spreadsheet read that was out %s under it", async outcome => {
    const catalog = Promise.withResolvers<never[]>();
    const reply = Promise.withResolvers<CommandResult>();
    let sent = 0;
    const dialog = await openFilled("failed spreadsheets", {
      workbookCatalog: () => catalog.promise,
      submitStartPlan: async request => planFor(request),
      executeCommand: () => { sent += 1; return reply.promise; },
    });
    await toStart(dialog, "failed spreadsheets");
    await dialog.press(startLabel("failed spreadsheets"));
    await settleAll();
    assert.equal(sent, 1);
    await act(async () => { if (outcome === "answers") catalog.resolve([]); else catalog.reject(new Error("unreachable")); });
    await settleLong();
    assert.deepEqual(h.closed, [], "the command is still out");
    await act(async () => { reply.resolve(h.APPLIED); await Promise.resolve(); });
    await settleLong();
    assert.deepEqual(h.closed, [false], "the applied reply closed the dialog");
  });
});

/** The dialog over the real address bar, so its stages are browser history entries. */
function Routed({ children }: { readonly children?: ReactElement }) {
  const handler = useRef<PopstateRouteHandler | undefined>(undefined);
  const [route, setRoute] = useRoute(handler);
  return createElement(ViewNavigationProvider, { route, setRoute, children });
}
async function browserBack() {
  await act(async () => {
    const popped = new Promise<void>(resolve => window.addEventListener("popstate", () => resolve(), { once: true }));
    window.history.back();
    await popped;
  });
  await settleAll();
}

describe("a rebuilt plan whose PDFs changed on Input", () => {
  afterEach(() => { window.history.replaceState(null, "", "/"); });

  it.each(["is pending", "failed"] as const)("is gone when browser Back returns to Start while the added upload %s", async outcome => {
    window.history.replaceState(null, "", "/");
    const planned: StartPlanRequest[] = [], uploads: string[] = [];
    let commands = 0;
    const upload = Promise.withResolvers<void>();
    const dialog = await openFilled("pdf", {
      uploadOcrSource: async request => {
        uploads.push(request.fileName);
        if (uploads.length > 1) await upload.promise;
        return OcrSourceUploadSchema.parse({ fileName: request.fileName, uploadedBy: h.ACTOR_ID, uploadedAt: "2026-08-03T00:00:00.000Z",
          artifact: { id: `00000000-0000-4000-8000-00000000000${String(uploads.length)}`, mediaType: "application/pdf", bytes: request.bytes.length, sha256: createHash("sha256").update(request.bytes).digest("hex") } });
      },
      submitStartPlan: async request => { planned.push(StartPlanRequestSchema.parse(request)); return planFor(request); },
      executeCommand: () => {
        commands += 1;
        return commands > 1 ? new Promise<CommandResult>(() => undefined) : Promise.resolve(CommandResultSchema.parse({ state: "rejected",
          commandId: "3a000000-0000-4000-8000-000000000001", code: "RUN_START_PLAN_EXPIRED", message: "Expired." }));
      },
    }, dialog => createElement(Routed, null, dialog));
    await toStart(dialog, "pdf");
    await dialog.press(startLabel("pdf"));
    await settleLong();
    assert.equal(planned.length, 2, "the expired plan was rebuilt");
    assert.ok(h.planIsDrawn());

    await dialog.press("Back");
    assert.equal(dialog.stage(), "Input");
    await attachPdf("two");
    if (outcome === "failed") { await act(async () => { upload.reject(new Error("refused")); }); await settleLong(); }
    assert.deepEqual(uploads, ["one.pdf", "two.pdf"]);
    await browserBack();
    assert.equal(dialog.stage(), "Start", "browser Back revisited Start");
    assert.equal(h.planIsDrawn(), false, "the plan for the old PDFs is gone");
    assert.equal(dialog.disabled(startLabel("pdf")), true);
    await dialog.enter({ on: document.body });
    await settleLong();
    assert.equal(commands, 1, "the old plan was not submitted");
    assert.equal(planned.length, 2, "no plan was asked for without the added PDF");
    if (outcome === "failed") return;

    await act(async () => { upload.resolve(); });
    await settleLong();
    await dialog.press(startLabel("pdf"));
    await settleLong();
    assert.equal(planned.length, 3, "Start planned again");
    assert.match(JSON.stringify(planned[2].submissions), /one\.pdf.*two\.pdf/u);
  });
});
