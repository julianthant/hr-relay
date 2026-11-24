// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { WorkbookLibraryEntrySchema, WorkbookLibraryVersionViewSchema, projectWorkbookCompatibility } from "../../../../src/models/dashboard/workbook-library.js";
import { StartPlanRequestSchema, type StartPlanRequest } from "../../../../src/models/dashboard/start-plan.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";

const h = createRunStartDialogHarness();
afterEach(async () => { await h.cleanup(); });

const CHECK = { id: "reference-check", keyFieldId: "eid" } as const;
const lookup: RunStartWorkflow = { ...h.WORKFLOWS[0], workbookCheck: CHECK };
const onboarding = DESCRIPTORS.find(flow => flow.id === "onboarding"); assert.ok(onboarding?.surfaces.inputRun);
const onboardingFlow: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: onboarding.id, label: onboarding.label, version: onboarding.version,
  requiredWorkbookFields: [...onboarding.requiredWorkbookFields], workbookReference: onboarding.workbookReference, workbookCheck: CHECK,
  referenceSources: [], steps: projectStartSteps(onboarding), inputRun: { state: "present", surface: onboarding.surfaces.inputRun } };

const libraryEntry = (libraryId: string, name: string, worksheets: readonly string[], pinned = false) => WorkbookLibraryEntrySchema.parse({ libraryId, name, version: 2, updatedAt: "2026-11-01T00:00:00Z", rowCount: 1,
  worksheets: worksheets.map(id => ({ id, name: id })), metadata: { typeId: "any", sharePoint: null },
  type: { id: "any", name: "Any", keyFieldId: "eid", fields: ["eid"], defaultWorkbookId: libraryId },
  state: { libraryId, revision: 1, selectedVersionId: "v", removed: false, pinned, tags: [], origin: { kind: "local" },
    versions: [{ id: "v", name: "v6", snapshotId: "s", version: 2, savedAt: "2026-11-01T00:00:00Z", source: "operator" }, { id: "old", name: "v5", snapshotId: "o", version: 1, savedAt: "2026-10-01T00:00:00Z", source: "operator" }] } });
const oldView = (libraryId: string, sheets: readonly string[]) => WorkbookLibraryVersionViewSchema.parse({ libraryId, version: { id: "old", name: "v5", snapshotId: "o", version: 1, savedAt: "2026-10-01T00:00:00Z", source: "operator" },
  workbook: { name: libraryId, libraryId, themes: [], hasFormulas: false, sheets: sheets.map(id => ({ id, name: id, width: 1, hidden: [],
    columnBindings: [{ id: "c", sourceColumn: 0, sourceHeader: "EID", fieldId: "eid", basis: "manual" }], rows: [{ id: "header", cells: [{ value: "EID" }] }] })) } });
const source = (libraryId: string, sheets: Readonly<Record<string, readonly string[]>>) => ({ libraryId, versionId: "v", origin: { kind: "local" as const }, removed: false,
  sheets: Object.entries(sheets).map(([id, fields]) => ({ id, name: id, mappings: fields.map((fieldId, column) => ({ fieldId, column, basis: "manual" as const })) })) });
function reads(entries: readonly ReturnType<typeof libraryEntry>[], sources: ReturnType<typeof source>[], workflows: Parameters<typeof projectWorkbookCompatibility>[0] = []) {
  const compatibility = projectWorkbookCompatibility(workflows, sources);
  return { workbookList: async () => [], workbookCatalog: async () => entries, workbookCompatibility: async () => compatibility, workbookTypes: async () => [], workbookLibraryVersion: async (libraryId: string, versionId: string) => { assert.equal(versionId, "old"); return oldView(libraryId, libraryId === "roster" ? ["Earlier"] : ["Sheet1"]); } };
}
const roster = libraryEntry("roster", "Contact roster", ["First", "Second"], true);
const tracker = libraryEntry("tracker", "I-9 tracker", ["Sheet1"]);
const plain = libraryEntry("plain", "Notes", ["Notes"]);
const served = reads([roster, tracker, plain], [source("roster", { First: ["eid", "fullName"], Second: ["eid"] }), source("tracker", { Sheet1: ["eid"] }), source("plain", { Notes: ["fullName"] })]);
const text = () => document.body.textContent ?? "";
async function click(name: string) {
  const button = h.buttons().find(candidate => h.buttonName(candidate) === name); assert.ok(button, `no button ${name}`);
  await act(async () => { button.click(); }); await h.settle();
}
async function add(region: string, name: string) {
  const root = document.body.querySelector(`[role="region"][aria-label="${region}"]`); assert.ok(root, `no section ${region}`);
  const open = [...root.querySelectorAll("button")].find(candidate => ["Add spreadsheet", "Change spreadsheet"].includes(candidate.textContent?.trim() ?? "")); assert.ok(open, `no Add spreadsheet in ${region}`);
  await act(async () => { open.click(); });
  const search = document.body.querySelector<HTMLInputElement>('input[aria-label="Find a spreadsheet"]'); assert.ok(search);
  const descriptor: { set?: (this: unknown, value: string) => void } | undefined = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  await act(async () => { descriptor?.set?.call(search, name); search.dispatchEvent(new Event("input", { bubbles: true })); });
  const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent?.includes(name)); assert.ok(item, `no spreadsheet ${name}`);
  await act(async () => { item.click(); }); await h.settle();
}
async function start(dialog: Awaited<ReturnType<typeof h.openDialog>>) { await dialog.type(h.TYPED); await dialog.press("Continue"); await dialog.press("Start run"); }

it("offers the library spreadsheets that fit in the picker and leaves out one without the key column; a picked row shows its version and update date", async () => {
  await h.openDialog(h.stubClient({ ...served }), { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle();
  assert.match(text(), /Spreadsheets/u);
  assert.equal(text().includes("Reference spreadsheets"), false);
  assert.ok(h.buttons().some(button => button.textContent?.trim() === "Add spreadsheet"));
  await click("Add spreadsheet");
  const items = () => [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(node => node.textContent ?? "");
  assert.match(items().join(" "), /Contact roster.*First, Second/u);
  assert.equal(text().includes("Notes"), false);
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await add("Spreadsheets", "I-9 tracker");
  assert.match(text(), /I-9 tracker/u); assert.match(text(), /v6 · Updated /u);
  assert.equal(text().includes("Sheet1 · v6"), false, "the worksheet list lives in the picker, not the row");
});

it("picks and removes a row in place; the optional check starts with no pick and sends each pick with its declaration", async () => {
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...served, submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return h.planResponse("5a000000-0000-4000-8000-000000000001"); } }),
    { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle();
  await dialog.type(h.TYPED); assert.equal(dialog.disabled("Continue"), false, "no pick is valid");
  await add("Spreadsheets", "Contact roster"); await add("Spreadsheets", "I-9 tracker");
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Remove Contact roster"));
  await click("Remove I-9 tracker");
  assert.equal(h.buttons().some(button => h.buttonName(button) === "Remove I-9 tracker"), false);
  await dialog.press("Continue"); await dialog.press("Start run");
  assert.deepEqual(planned?.workbookReferences, [{ typeId: "reference-check", entry: 1, libraryId: "roster", versionId: "v", sheetId: "First", expectedVersion: 2 }]);
});

it("offers the version select on a picked row and sends the named version's worksheet", async () => {
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...served, submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return h.planResponse("5a000000-0000-4000-8000-000000000001"); } }),
    { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle(); await add("Spreadsheets", "Contact roster");
  const trigger = h.buttons().find(button => h.buttonName(button) === "Contact roster version"); assert.ok(trigger);
  await act(async () => { trigger.click(); });
  const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent?.includes("v5")); assert.ok(option);
  await act(async () => { option.click(); }); await h.settle(); await h.settle();
  assert.match(text(), /Earlier/u);
  await dialog.type(h.TYPED); await dialog.press("Continue"); await dialog.press("Start run");
  assert.deepEqual(planned?.workbookReferences, [{ typeId: "reference-check", entry: 1, libraryId: "roster", versionId: "old", sheetId: "Earlier", expectedVersion: 2 }]);
});

it("picks several worksheets of one spreadsheet as separate references", async () => {
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...served, submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return h.planResponse("5a000000-0000-4000-8000-000000000001"); } }),
    { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle(); await add("Spreadsheets", "Contact roster");
  await click("Contact roster worksheets, First");
  const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(node => node.textContent?.includes("Second")); assert.ok(item);
  await act(async () => { item.click(); }); await h.settle();
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Contact roster worksheets, 2 worksheets"));
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await dialog.type(h.TYPED); await dialog.press("Continue"); await dialog.press("Start run");
  assert.deepEqual(planned?.workbookReferences?.map(reference => [reference.libraryId, reference.sheetId]), [["roster", "First"], ["roster", "Second"]]);
});

it("draws the Add spreadsheet menu as the mock does: Pinned first, the mock's empty text, search finds the rest", async () => {
  await h.openDialog(h.stubClient({ ...served }), { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle(); await click("Add spreadsheet");
  assert.match(text(), /Pinned/u);
  const items = () => [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(node => node.textContent ?? "");
  assert.equal(items().length, 1); assert.match(items()[0], /Contact roster/u);
  const search = document.body.querySelector<HTMLInputElement>('input[aria-label="Find a spreadsheet"]'); assert.ok(search);
  const descriptor: { set?: (this: unknown, value: string) => void } | undefined = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  await act(async () => { descriptor?.set?.call(search, "tracker"); search.dispatchEvent(new Event("input", { bubbles: true })); });
  assert.match(items().join(" "), /I-9 tracker/u);
});

it("shows the mock's guidance when nothing is pinned", async () => {
  await h.openDialog(h.stubClient({ ...reads([tracker], [source("tracker", { Sheet1: ["eid"] })]) }), { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle(); await click("Add spreadsheet");
  assert.match(text(), /Pin spreadsheets in Spreadsheets to list them here\. Search finds the rest\./u);
});

it("sends no reference when nothing is picked", async () => {
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...served, submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return h.planResponse("5a000000-0000-4000-8000-000000000001"); } }),
    { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle(); await start(dialog);
  assert.ok(planned); assert.equal(planned.workbookReferences, undefined);
});

it("shows only Add spreadsheet when the library holds no spreadsheet that fits", async () => {
  await h.openDialog(h.stubClient({ ...reads([plain], [source("plain", { Notes: ["fullName"] })]) }), { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle();
  assert.equal(h.buttons().some(button => h.buttonName(button).startsWith("Remove ")), false);
  assert.ok(h.buttons().some(button => button.textContent?.trim() === "Add spreadsheet"));
});

it("opens Onboarding with its required reference unpicked, the check rows beside it and no attention notice", async () => {
  const dialog = await h.openDialog(h.stubClient({ ...reads([roster, tracker], [source("roster", { First: ["eid", "email"] }), source("tracker", { Sheet1: ["eid"] })], [onboarding]) }),
    { workflows: [onboardingFlow], panelWorkflowId: onboarding.id });
  await h.settle();
  assert.equal(text().includes("Selected rows need attention"), false);
  assert.equal(text().includes("Fix the refused entry first."), false);
  assert.equal(text().includes("Also check"), false);
  assert.equal(dialog.disabled("Continue"), true, "the required reference keeps Continue off until picked");
});

it("merges the required roster and the optional check picks into one Spreadsheets field with one Add spreadsheet button", async () => {
  await h.openDialog(h.stubClient({ ...reads([roster, tracker], [source("roster", { First: ["eid", "email"] }), source("tracker", { Sheet1: ["eid"] })], [onboarding]) }),
    { workflows: [onboardingFlow], panelWorkflowId: onboarding.id });
  await h.settle();
  const lists = [...document.querySelectorAll<HTMLElement>('[role="region"][aria-label="Spreadsheets"]')];
  assert.equal(lists.length, 1, "one list");
  assert.equal(text().includes("Also check"), false);
  assert.equal(text().includes("Reference spreadsheets"), false);
  assert.equal([...lists[0].querySelectorAll("button")].filter(button => button.textContent?.trim() === "Add spreadsheet").length, 1);
});

const rosterLookupReference = { id: "roster-type", keyFieldId: "eid", mode: "keys", writableFields: [] } as const;
const rosterLookup: RunStartWorkflow = { ...h.WORKFLOWS[0], requiredWorkbookFields: ["eid"], workbookReference: rosterLookupReference, workbookCheck: CHECK, referenceSources: [] };
const rosterLookupReads = () => reads([roster, tracker], [source("roster", { First: ["eid"] }), source("tracker", { Sheet1: ["eid"] })],
  [{ id: rosterLookup.workflowId, label: rosterLookup.label, requiredWorkbookFields: ["eid"], workbookReference: rosterLookupReference }]);

it("sends the lookup roster and the extra check picks the two old fields sent, from the one Spreadsheets field", async () => {
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...rosterLookupReads(), submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return h.planResponse("5a000000-0000-4000-8000-000000000001"); } }),
    { workflows: [rosterLookup], panelWorkflowId: rosterLookup.workflowId });
  await h.settle();
  await dialog.type(h.TYPED);
  assert.equal(dialog.disabled("Continue"), true, "the required roster keeps Continue off until picked");
  await add("Spreadsheets", "Contact roster");
  assert.equal(dialog.disabled("Continue"), false);
  await add("Spreadsheets", "I-9 tracker");
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Remove Contact roster"));
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Remove I-9 tracker"));
  await dialog.press("Continue"); await dialog.press("Start run");
  assert.deepEqual(planned?.workbookReferences, [
    { entry: 1, libraryId: "roster", versionId: "v", sheetId: "First", expectedVersion: 2 },
    { typeId: "reference-check", entry: 1, libraryId: "tracker", versionId: "v", sheetId: "Sheet1", expectedVersion: 2 },
  ]);
});

it("keeps the extra check and holds Continue when the required lookup sheet is removed", async () => {
  const dialog = await h.openDialog(h.stubClient({ ...rosterLookupReads(), submitStartPlan: async () => { throw new Error("a missing reference must not reach planning"); } }),
    { workflows: [rosterLookup], panelWorkflowId: rosterLookup.workflowId });
  await h.settle();
  await dialog.type(h.TYPED);
  await add("Spreadsheets", "Contact roster");
  await add("Spreadsheets", "I-9 tracker");
  assert.equal(dialog.disabled("Continue"), false);
  await click("Remove Contact roster");
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Remove I-9 tracker"), "the check stays selected");
  assert.equal(dialog.disabled("Continue"), true);
  assert.ok(text().includes("Add a reference spreadsheet first."));
});
