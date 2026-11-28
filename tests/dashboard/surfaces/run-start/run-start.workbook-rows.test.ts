// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { WorkbookLibraryEntrySchema, WorkbookLibraryVersionViewSchema, projectWorkbookCompatibility } from "../../../../src/models/dashboard/workbook-library.js";
import { StartPlanRequestSchema, StartPlanWireSchema, type StartPlanRequest } from "../../../../src/models/dashboard/start-plan.js";
import { RerunValuesRequestSchema, RerunValuesSnapshotSchema } from "../../../../src/models/dashboard/rerun-values.js";
import { RerunWarningRequestSchema, RerunWarningWireSchema } from "../../../../src/models/dashboard/rerun-warning.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { RunStartDialog, type RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";

import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { ToastProvider } from "../../../../src/dashboard/ds/ui.js";
import { ViewNavigationProvider } from "../../../../src/dashboard/app/navigation/view-navigation.js";
import type { AppRouteState } from "../../../../src/dashboard/app/navigation/url-state.js";
import { FixtureCommandBinding } from "../../../support/helpers/dashboard/command-binding.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { servedFixtureSources } from "../../../support/helpers/dashboard/mock-world/workflow-composition.js";

const h = createRunStartDialogHarness();
let routedRoot: Root | undefined;
let reopenRoot: Root | undefined;
afterEach(async () => {
  await act(async () => { routedRoot?.unmount(); reopenRoot?.unmount(); });
  routedRoot = undefined; reopenRoot = undefined;
  await h.cleanup();
});
const descriptor = DESCRIPTORS.find(flow => flow.id === "onboarding"); assert.ok(descriptor?.surfaces.inputRun);
const descriptorId = descriptor.id;
const rerunDescriptor = descriptor;
const workflow: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: descriptor.id, label: descriptor.label, version: descriptor.version,
  requiredWorkbookFields: [...descriptor.requiredWorkbookFields], workbookReference: descriptor.workbookReference,
  steps: projectStartSteps(descriptor), inputRun: { state: "present", surface: descriptor.surfaces.inputRun } };
const entry = WorkbookLibraryEntrySchema.parse({ libraryId: "roster", name: "Roster", version: 1, updatedAt: "2026-11-01T00:00:00Z", rowCount: 2,
  worksheets: [{ id: "first", name: "First" }, { id: "second", name: "Second" }], metadata: { typeId: "onboarding-roster", sharePoint: null },
  type: { id: "onboarding-roster", name: "Roster", keyFieldId: "email", fields: ["email"], defaultWorkbookId: "roster" },
  state: { libraryId: "roster", revision: 1, selectedVersionId: "version", removed: false, pinned: false, tags: [], origin: { kind: "local" }, versions: [{ id: "version", name: "Reviewed", snapshotId: "snapshot", version: 1, savedAt: "2026-11-01T00:00:00Z", source: "operator" }] } });
const versionView = WorkbookLibraryVersionViewSchema.parse({ libraryId: entry.libraryId, version: entry.state.versions[0], workbook: {
  name: "Roster", libraryId: entry.libraryId, themes: [], hasFormulas: false,
  sheets: entry.worksheets.map(sheet => ({ ...sheet, width: descriptor.requiredWorkbookFields.length, hidden: [],
    columnBindings: descriptor.requiredWorkbookFields.map((fieldId, index) => ({ id: `column-${index}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" })),
    rows: [{ id: "header", cells: descriptor.requiredWorkbookFields.map(value => ({ value })) },
      ...["same-row", "next-row"].map(id => ({ id, cells: descriptor.requiredWorkbookFields.map(fieldId => ({ value: fieldId === 'email' ? 'duplicate@example.test' : '' })) }))],
  })),
} });
const compatibility = projectWorkbookCompatibility([descriptor], [{ libraryId: entry.libraryId, versionId: 'version', origin: { kind: 'local' }, removed: false,
  sheets: versionView.workbook.sheets.map(sheet => ({ id: sheet.id, name: sheet.name,
    mappings: (sheet.columnBindings ?? []).map((binding, column) => ({ fieldId: binding.fieldId!, column, basis: 'manual' as const })) })) }]);
const libraryReads = { workbookList: async () => [], workbookCatalog: async () => [entry], workbookCompatibility: async () => compatibility,
  workbookTypes: async () => [entry.type], workbookLibraryVersion: async () => versionView };
const checkboxRows = () => [...document.querySelectorAll<HTMLButtonElement>('table[aria-label="Saved spreadsheet rows"] button[role="checkbox"]')];
async function mode(value: string) { const radio = document.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`); assert.ok(radio); await act(async () => radio.click()); }
async function select(index: number) { const checkbox = checkboxRows()[index]; assert.ok(checkbox); await act(async () => checkbox.click()); }
async function chooseCurrent() { await h.chooseReference('Roster', 'Reviewed', 'First'); }
function proposal(request: StartPlanRequest, partial = false) {
  return StartPlanWireSchema.parse({ ...h.planResponse("5a000000-0000-4000-8000-000000000001"), workflowId: descriptorId, priority: request.priority,
    ...(request.rerunSource ? { rerun: { source: request.rerunSource, warnings: [], warningDigest: h.HASH, acknowledgment: request.warningAcknowledgment } } : {}),
    planned: request.submissions.flatMap((_, index) => partial && index === 1 ? [] : [{ logicalKey: `entry-${index}`, title: `Row ${index + 1}`, matchKey: `row-${index}`,
      workbookReferences: (request.workbookReferences ?? []).filter(reference => reference.entry === index + 1).map(reference => ({ libraryId: reference.libraryId, version: 1, versionId: reference.versionId, versionName: "Reviewed", worksheets: entry.worksheets.filter(sheet => sheet.id === reference.sheetId).map(sheet => ({ sheetId: sheet.id, name: sheet.name })), type: entry.type,
        ...(reference.selectedRow ? { selectedRow: reference.selectedRow } : {}) })),
    }]), refused: partial ? [{ entry: 2, code: "active-run-exists", message: "Duplicate email refused" }] : [],
  });
}

it.each(["late catalog", "sidebar workflow", "restored route"])("shows and previews the same default Onboarding steps after %s opens the mounted launcher", async path => {
  let planned: StartPlanRequest | undefined;
  const client = h.stubClient({ ...libraryReads, submitStartPlan: async input => {
    planned = StartPlanRequestSchema.parse(input);
    return proposal(planned);
  } });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  routedRoot = root;
  let openOnboarding = () => {};
  function Harness() {
    const [loaded, setLoaded] = useState(path !== "late catalog");
    const [route, setRoute] = useState<AppRouteState>(path === "restored route"
      ? { start: true, view: { launchServed: descriptorId, launchCustomize: false } } : { start: false });
    openOnboarding = () => {
      setLoaded(true);
      setRoute({ start: true, view: { launchServed: descriptorId, launchStage: "Input", launchCustomize: false } });
    };
    const workflows = loaded ? [h.WORKFLOWS[0], workflow] : [];
    return createElement(ViewNavigationProvider, { route, setRoute,
      children: createElement(DashboardClientProvider, { client,
        children: createElement(ToastProvider, { children: createElement(FixtureCommandBinding, { actorId: h.ACTOR_ID,
          children: createElement(RunStartDialog, { open: route.start === true, onOpenChange() {},
            catalog: buildWorkflowCatalog(workflows, servedFixtureSources(workflows)),
            panelWorkflowId: h.WORKFLOWS[0].workflowId, actorId: h.ACTOR_ID, onOpenIntake() {} }) }) }) }) });
  }
  await act(async () => root.render(createElement(Harness)));
  if (path !== "restored route") await act(async () => openOnboarding());
  await h.settle(); await chooseCurrent(); await select(0);
  assert.equal(document.querySelector<HTMLInputElement>('input[value="new-hire"]')?.checked, true, `New hire is selected on the ${path} without a click`);
  await mode("new-hire");
  const press = async (name: string) => {
    const button = h.buttons().find(button => h.buttonName(button) === name); assert.ok(button, name);
    await act(async () => button.click());
  };
  await press("Next"); for (let wait = 0; wait < 6; wait += 1) await h.settle();
  await press(h.buttons().some(button => h.buttonName(button) === "Start live run") ? "Start live run" : "Start run");
  assert.ok(planned, document.body.textContent ?? "Planner was not called");
  assert.deepEqual(planned.selectedStepKeys, workflow.steps.filter(step => step.includedByDefault).map(step => step.key));
  assert.equal(planned.selectedStepKeys.length, 8, "Onboarding defaults include all eight steps, with the reference check");
});

it("reads catalog and compatibility without the workbook list while the launcher moves between stages", async () => {
  const reads = { workbookList: 0, workbookCatalog: 0, workbookCompatibility: 0 };
  const counted = { ...libraryReads,
    workbookList: async () => { reads.workbookList += 1; return []; },
    workbookCatalog: async () => { reads.workbookCatalog += 1; return libraryReads.workbookCatalog(); },
    workbookCompatibility: async () => { reads.workbookCompatibility += 1; return libraryReads.workbookCompatibility(); } };
  const dialog = await h.openDialog(h.stubClient({ ...counted }), { workflows: [workflow], panelWorkflowId: descriptor.id });
  await h.settle(); await chooseCurrent(); await select(0); await mode("rehire");
  await dialog.press("Next"); await h.settle();
  assert.equal(reads.workbookList, 0, "Start run never lists whole workbooks");
  assert.deepEqual([reads.workbookCatalog, reads.workbookCompatibility], [1, 1], "the opening loads the reference catalog once");
});

it("uses saved rows only, requires a common explicit mode and preserves duplicate physical entry/refusal correspondence", async () => {
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...libraryReads, submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return proposal(planned, true); } }), { workflows: [workflow], panelWorkflowId: descriptor.id });
  await h.settle(); await chooseCurrent();
  assert.equal(document.querySelector("textarea") === null, true);
  assert.equal(document.querySelectorAll('input[type="radio"]:checked').length, 1, "the first mode is preselected");
  assert.equal(checkboxRows().length, 2); assert.equal(dialog.disabled("Next"), true);
  await select(1); await select(0); assert.equal(dialog.disabled("Next"), false, "the preselected first mode applies to both rows");
  await mode("rehire"); await dialog.press("Next");
  assert.equal(dialog.text().includes("Reference spreadsheet"), false, "row-source reference controls are only in Input");
  await dialog.press("Start live run"); assert.ok(planned);
  assert.deepEqual(planned.submissions, [{ email: "duplicate@example.test", mode: "rehire" }, { email: "duplicate@example.test", mode: "rehire" }]);
  assert.deepEqual(planned.workbookReferences?.map(reference => [reference.entry, reference.libraryId, reference.versionId, reference.selectedRow]), [
    [1, "roster", "version", { sheetId: "first", rowId: "same-row" }], [2, "roster", "version", { sheetId: "first", rowId: "next-row" }],
  ]);
  assert.match(dialog.text(), /First · Row 3: duplicate@example\.test already has a run in progress\./u);
  assert.doesNotMatch(dialog.text(), /Duplicate email refused/u, "the refusal notice is one plain sentence, never the server text");
});

it("retains the original issued envelope after an unknown result and later mode edits", async () => {
  const commands: unknown[] = [];
  const dialog = await h.openDialog(h.stubClient({ ...libraryReads, submitStartPlan: async input => proposal(StartPlanRequestSchema.parse(input)),
    executeCommand: async input => { commands.push(input); throw new Error("Reply lost after dispatch"); },
  }), { workflows: [workflow], panelWorkflowId: descriptor.id });
  await h.settle(); await chooseCurrent(); await select(0); await mode("new-hire"); await dialog.press("Next"); await dialog.press("Start live run");
  const retained = window.sessionStorage.getItem(window.sessionStorage.key(0) ?? ""); assert.ok(retained);
  await dialog.press("1 Input"); await mode("rehire");
  assert.equal(window.sessionStorage.getItem(window.sessionStorage.key(0) ?? ""), retained);
  assert.equal(commands.length, 1); assert.equal(dialog.disabled("Next"), true);
});

it("lists both selected sheets' saved rows and pins the picked row only on its own sheet", async () => {
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...libraryReads, submitStartPlan: async input => {
    planned = StartPlanRequestSchema.parse(input); return proposal(planned);
  } }), { workflows: [workflow], panelWorkflowId: descriptor.id });
  await h.settle(); await chooseCurrent();
  await h.chooseWorksheets(["First", "Second"]);
  const second = checkboxRows().findIndex(checkbox => checkbox.closest("tr")?.textContent?.includes("Second · Row 2"));
  assert.equal(checkboxRows().length, 4);
  await select(second); await dialog.press("Next"); await dialog.press("Start live run");
  assert.deepEqual(planned?.workbookReferences?.map(({ sheetId, selectedRow }) => [sheetId, selectedRow]),
    [["first", undefined], ["second", { sheetId: "second", rowId: "same-row" }]]);
});

function rerunSnapshot(several = false) {
  const source = RerunValuesRequestSchema.parse({ runId: "22222222-2222-4222-8222-222222222222", expectedVersion: 3 });
  const snapshot = RerunValuesSnapshotSchema.parse({ source: { runId: source.runId, version: source.expectedVersion, workflow: rerunDescriptor.id,
    descriptorVersion: rerunDescriptor.version, contractFingerprint: rerunDescriptor.contractFingerprint, outcome: "failed", dryRun: false, priority: "interactive", browserMode: "headless" }, sourceInput: { state: "available", value: { email: "source@example.test", mode: "rehire" } },
    spreadsheets: (several ? ["first", "second"] : ["first"]).map(sheetId => ({ typeId: workflow.workbookReference?.id, libraryId: entry.libraryId, versionId: "version", sheetId,
      ...(sheetId === (several ? "second" : "first") ? { selectedRow: { sheetId, rowId: "row-2" } } : {}) })),
    steps: rerunDescriptor.timeline.map(step => ({ key: step.key, state: "unfinished", nodes: step.nodes.map(node => ({ nodeId: node.id, state: "unfinished", reason: "not-recorded" })) })), values: [], transactions: [] });
  return { source, snapshot };
}

it("reruns the original person and mode with both saved worksheets and the picked row on its own sheet", async () => {
  const { source, snapshot } = rerunSnapshot(true);
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...libraryReads, rerunValues: async () => ({ state: "available", snapshot }),
    previewRerunWarnings: async input => RerunWarningWireSchema.parse({ workflowId: descriptor.id, rerun: { source: RerunWarningRequestSchema.parse(input).source, warnings: [], warningDigest: h.HASH } }),
    submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return proposal(planned); },
  }), { workflows: [workflow], panelWorkflowId: descriptor.id, rerunSource: source });
  await h.settle();
  assert.equal(checkboxRows().length, 0); assert.equal(document.querySelector(".launch-dialog textarea") === null, true);
  const picker = h.buttons().find(button => h.buttonName(button) === "Roster worksheets, 2 worksheets"); assert.ok(picker);
  await act(async () => picker.click());
  assert.deepEqual([...document.body.querySelectorAll('[role="menuitemcheckbox"]')].map(item =>
    [item.textContent, item.getAttribute("aria-checked"), item.getAttribute("aria-disabled")]), [["Second", "true", "true"], ["First", "true", "true"]]);
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await dialog.press("2 Start"); await dialog.press("Start live run"); assert.ok(planned);
  assert.deepEqual(planned.submissions, [{ email: "source@example.test", mode: "rehire" }]);
  assert.deepEqual(planned.workbookReferences, [
    { entry: 1, libraryId: entry.libraryId, versionId: "version", sheetId: "first", expectedVersion: 1 },
    { entry: 1, libraryId: entry.libraryId, versionId: "version", sheetId: "second", expectedVersion: 1, selectedRow: { sheetId: "second", rowId: "row-2" } },
  ]);
});

it("refuses a rerun whose saved spreadsheet version is no longer the active one, never moving its row to another version", async () => {
  const { source, snapshot } = rerunSnapshot();
  const moved = WorkbookLibraryEntrySchema.parse({ ...entry, version: 2, state: { ...entry.state, selectedVersionId: "edited", versions: [...entry.state.versions, { ...entry.state.versions[0], id: "edited", name: "Edited", snapshotId: "edited-snapshot", version: 2 }] } });
  const reads: string[] = [];
  const dialog = await h.openDialog(h.stubClient({ ...libraryReads, workbookCatalog: async () => [moved],
    workbookCompatibility: async () => projectWorkbookCompatibility([descriptor], [{ libraryId: entry.libraryId, versionId: "edited", origin: { kind: "local" }, removed: false,
      sheets: versionView.workbook.sheets.map(sheet => ({ id: sheet.id, name: sheet.name, mappings: (sheet.columnBindings ?? []).map((binding, column) => ({ fieldId: binding.fieldId!, column, basis: "manual" as const })) })) }]),
    workbookLibraryVersion: async (_libraryId, versionId) => { reads.push(versionId); return versionView; },
    rerunValues: async () => ({ state: "available", snapshot }),
    previewRerunWarnings: async input => RerunWarningWireSchema.parse({ workflowId: descriptor.id, rerun: { source: RerunWarningRequestSchema.parse(input).source, warnings: [], warningDigest: h.HASH } }),
    submitStartPlan: async () => { throw new Error("a stale spreadsheet version must not reach planning"); },
  }), { workflows: [workflow], panelWorkflowId: descriptor.id, rerunSource: source });
  await h.settle();
  await dialog.press("Next"); await dialog.press("Start live run");
  assert.deepEqual([...new Set(reads)], ["version"], "the original version is the one read");
  assert.ok(dialog.text().includes(ERROR_CATALOG.WORKBOOK_INVALID.text), dialog.text());
});

it("keeps earlier selected rows visible and disabled after a named-version change until explicitly cleared", async () => {
  const alternate = WorkbookLibraryEntrySchema.parse({ ...entry, state: { ...entry.state, versions: [...entry.state.versions, { ...entry.state.versions[0], id: "alternate", name: "Alternate", snapshotId: "alternate-snapshot" }] } });
  const dialog = await h.openDialog(h.stubClient({ ...libraryReads, workbookCatalog: async () => [alternate], workbookLibraryVersion: async (_libraryId, versionId) => WorkbookLibraryVersionViewSchema.parse({ ...versionView, version: alternate.state.versions.find(version => version.id === versionId),
    workbook: versionId === 'alternate' ? { ...versionView.workbook, sheets: [{ ...versionView.workbook.sheets[0], id: 'former-sheet', name: 'Earlier People' }] } : versionView.workbook }) }),
    { workflows: [workflow], panelWorkflowId: descriptor.id });
  await h.settle(); await chooseCurrent(); await select(0); await mode("new-hire");
  await h.chooseVersion('Alternate');
  assert.match(dialog.text(), /Previous row selection/u); assert.match(dialog.text(), /First · Row 2/u);
  assert.equal(checkboxRows().every(checkbox => checkbox.disabled), true); assert.equal(dialog.disabled("Next"), true);
  await dialog.press("Clear previous row selection");
  assert.equal(checkboxRows().some(checkbox => checkbox.getAttribute("aria-checked") === "true"), false);
  await select(0); assert.equal(dialog.disabled("Next"), false);
});

it("keeps the row selection silently when the dialog is reopened for the same spreadsheet and version", async () => {
  const host = document.createElement("div"); document.body.append(host); reopenRoot = createRoot(host);
  const client = h.stubClient({ ...libraryReads });
  const render = (open: boolean) => act(async () => reopenRoot?.render(createElement(ToastProvider, { children: createElement(DashboardClientProvider, { client,
    children: createElement(FixtureCommandBinding, { actorId: h.ACTOR_ID, children: createElement(RunStartDialog, { open, onOpenChange() {}, panelWorkflowId: descriptor.id, actorId: h.ACTOR_ID, onApplied() {}, onOpenIntake() {},
      catalog: buildWorkflowCatalog([workflow], servedFixtureSources([workflow])) }) }) }) })));
  await render(true); await h.settle(); await chooseCurrent(); await select(0);
  await render(false); await h.settle(); await render(true); await h.settle();
  assert.equal(document.body.textContent?.includes("Previous row selection"), false);
  assert.equal(checkboxRows().filter(checkbox => checkbox.getAttribute("aria-checked") === "true").length, 1);
});
