// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { WorkbookLibraryEntrySchema, WorkbookLibraryVersionViewSchema, projectWorkbookCompatibility } from "../../../../src/models/dashboard/workbook-library.js";
import { StartPlanRequestSchema, StartPlanWireSchema, type StartPlanRequest } from "../../../../src/models/dashboard/start-plan.js";
import { RerunValuesRequestSchema, RerunValuesSnapshotSchema } from "../../../../src/models/dashboard/rerun-values.js";
import { RerunWarningRequestSchema, RerunWarningWireSchema } from "../../../../src/models/dashboard/rerun-warning.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";

const h = createRunStartDialogHarness();
afterEach(h.cleanup);
const descriptor = DESCRIPTORS.find(flow => flow.id === "onboarding"); assert.ok(descriptor?.surfaces.inputRun);
const descriptorId = descriptor.id;
const workflow: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: descriptor.id, label: descriptor.label, version: descriptor.version,
  requiredWorkbookFields: [...descriptor.requiredWorkbookFields], workbookReference: descriptor.workbookReference,
  referenceSources: [], steps: projectStartSteps(descriptor), inputRun: { state: "present", surface: descriptor.surfaces.inputRun } };
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
  return StartPlanWireSchema.parse({ ...h.planResponse("5a000000-0000-4000-8000-000000000001"), workflowId: descriptorId,
    ...(request.rerunSource ? { rerun: { source: request.rerunSource, warnings: [], warningDigest: h.HASH, acknowledgment: request.warningAcknowledgment } } : {}),
    planned: request.submissions.flatMap((_, index) => partial && index === 1 ? [] : [{ logicalKey: `entry-${index}`, title: `Row ${index + 1}`, matchKey: `row-${index}`,
      workbookReferences: (request.workbookReferences ?? []).filter(reference => reference.entry === index + 1).map(reference => ({ libraryId: reference.libraryId, version: 1, versionId: reference.versionId, versionName: "Reviewed", worksheets: entry.worksheets.filter(sheet => sheet.id === reference.sheetId).map(sheet => ({ sheetId: sheet.id, name: sheet.name })), type: entry.type,
        ...(reference.selectedRow ? { selectedRow: reference.selectedRow } : {}) })),
    }]), refused: partial ? [{ entry: 2, code: "active-run-exists", message: "Duplicate email refused" }] : [],
  });
}

it("uses saved rows only, requires a common explicit mode and preserves duplicate physical entry/refusal correspondence", async () => {
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...libraryReads, submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return proposal(planned, true); } }), { workflows: [workflow], panelWorkflowId: descriptor.id });
  await h.settle(); await chooseCurrent();
  assert.equal(document.querySelector("textarea"), null);
  assert.equal(document.querySelectorAll('input[type="radio"]:checked').length, 0);
  assert.equal(checkboxRows().length, 2); assert.equal(dialog.disabled("Continue"), true);
  await select(1); await select(0); assert.equal(dialog.disabled("Continue"), true);
  await mode("rehire"); await dialog.press("Continue");
  assert.equal(dialog.text().includes("Reference spreadsheet"), false, "row-source reference controls are only in Input");
  await dialog.press("Continue"); assert.ok(planned);
  assert.deepEqual(planned.submissions, [{ email: "duplicate@example.test", mode: "rehire" }, { email: "duplicate@example.test", mode: "rehire" }]);
  assert.deepEqual(planned.workbookReferences?.map(reference => [reference.entry, reference.libraryId, reference.versionId, reference.selectedRow]), [
    [1, "roster", "version", { sheetId: "first", rowId: "same-row" }], [2, "roster", "version", { sheetId: "first", rowId: "next-row" }],
  ]);
  assert.match(dialog.text(), /Entry 1 · Accepted/u); assert.match(dialog.text(), /Entry 2 · Refused/u);
  assert.match(dialog.text(), /First · Row 3: duplicate@example.test/u); assert.match(dialog.text(), /Duplicate email refused/u);
});

it("retains the original issued envelope after an unknown result and later mode edits", async () => {
  const commands: unknown[] = [];
  const dialog = await h.openDialog(h.stubClient({ ...libraryReads, submitStartPlan: async input => proposal(StartPlanRequestSchema.parse(input)),
    executeCommand: async input => { commands.push(input); throw new Error("Reply lost after dispatch"); },
  }), { workflows: [workflow], panelWorkflowId: descriptor.id });
  await h.settle(); await chooseCurrent(); await select(0); await mode("new-hire"); await dialog.press("Continue"); await dialog.press("Continue"); await dialog.press("Start 1 run");
  const retained = window.sessionStorage.getItem(window.sessionStorage.key(0) ?? ""); assert.ok(retained);
  await dialog.press("Back"); await dialog.press("Back"); await mode("rehire");
  assert.equal(window.sessionStorage.getItem(window.sessionStorage.key(0) ?? ""), retained);
  assert.equal(commands.length, 1); assert.equal(dialog.disabled("Continue"), true);
});

it("keeps Rerun single-source with its restored mode and a fresh explicit reference, without roster leakage", async () => {
  const source = RerunValuesRequestSchema.parse({ runId: "22222222-2222-4222-8222-222222222222", expectedVersion: 3 });
  const snapshot = RerunValuesSnapshotSchema.parse({ source: { runId: source.runId, version: source.expectedVersion, workflow: descriptor.id,
    descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint, outcome: "failed" }, sourceInput: { state: "available", value: { email: "source@example.test", mode: "rehire" } },
    steps: descriptor.timeline.map(step => ({ key: step.key, state: "unfinished", nodes: step.nodes.map(node => ({ nodeId: node.id, state: "unfinished", reason: "not-recorded" })) })), values: [], transactions: [] });
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...libraryReads, rerunValues: async () => ({ state: "available", snapshot }),
    previewRerunWarnings: async input => RerunWarningWireSchema.parse({ workflowId: descriptor.id, rerun: { source: RerunWarningRequestSchema.parse(input).source, warnings: [], warningDigest: h.HASH } }),
    submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return proposal(planned); },
  }), { workflows: [workflow], panelWorkflowId: descriptor.id, rerunSource: source });
  await dialog.press("Continue"); assert.equal(checkboxRows().length, 0); assert.equal(dialog.typedInput().value, "source@example.test");
  await chooseCurrent();
  assert.equal(document.querySelector<HTMLInputElement>('input[value="rehire"]')?.checked, true);
  await dialog.press("Continue"); await dialog.press("Continue"); assert.ok(planned);
  assert.deepEqual(planned.submissions, [{ email: "source@example.test", mode: "rehire" }]);
  assert.deepEqual(planned.workbookReferences, [{ entry: 1, libraryId: entry.libraryId, versionId: "version", sheetId: "first", expectedVersion: 1 }]);
});

it("keeps earlier selected rows visible and disabled after a named-version change until explicitly cleared", async () => {
  const alternate = WorkbookLibraryEntrySchema.parse({ ...entry, state: { ...entry.state, versions: [...entry.state.versions, { ...entry.state.versions[0], id: "alternate", name: "Alternate", snapshotId: "alternate-snapshot" }] } });
  const dialog = await h.openDialog(h.stubClient({ ...libraryReads, workbookCatalog: async () => [alternate], workbookLibraryVersion: async (_libraryId, versionId) => WorkbookLibraryVersionViewSchema.parse({ ...versionView, version: alternate.state.versions.find(version => version.id === versionId),
    workbook: versionId === 'alternate' ? { ...versionView.workbook, sheets: [{ ...versionView.workbook.sheets[0], id: 'former-sheet', name: 'Earlier People' }] } : versionView.workbook }) }),
    { workflows: [workflow], panelWorkflowId: descriptor.id });
  await h.settle(); await chooseCurrent(); await select(0); await mode("new-hire");
  await h.chooseVersion('Alternate');
  assert.match(dialog.text(), /Previous row selection/u); assert.match(dialog.text(), /First · Row 2/u);
  assert.equal(checkboxRows().every(checkbox => checkbox.disabled), true); assert.equal(dialog.disabled("Continue"), true);
  await dialog.press("Clear previous row selection");
  assert.equal(checkboxRows().some(checkbox => checkbox.getAttribute("aria-checked") === "true"), false);
  await select(0); assert.equal(dialog.disabled("Continue"), false);
});
