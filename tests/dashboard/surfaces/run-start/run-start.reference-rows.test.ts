// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { WorkbookLibraryEntrySchema, WorkbookLibraryVersionViewSchema, projectWorkbookCompatibility } from "../../../../src/models/dashboard/workbook-library.js";
import { StartPlanRequestSchema, StartPlanWireSchema, type StartPlanRequest } from "../../../../src/models/dashboard/start-plan.js";
import { CommandResultSchema, type CommandResult } from "../../../../src/rules/commands/commands.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";

const h = createRunStartDialogHarness();
afterEach(async () => { await h.cleanup(); });

const CHECK = { id: "reference-check", keyFieldId: "eid" } as const;
const lookup: RunStartWorkflow = { ...h.WORKFLOWS[0], workbookCheck: CHECK };
const onboarding = DESCRIPTORS.find(flow => flow.id === "onboarding"); assert.ok(onboarding?.surfaces.inputRun);
const onboardingFlow: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: onboarding.id, label: onboarding.label, version: onboarding.version,
  requiredWorkbookFields: [...onboarding.requiredWorkbookFields], workbookReference: onboarding.workbookReference, workbookCheck: CHECK,
  steps: projectStartSteps(onboarding), inputRun: { state: "present", surface: onboarding.surfaces.inputRun } };

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
async function start(dialog: Awaited<ReturnType<typeof h.openDialog>>) { await dialog.type(h.TYPED); await dialog.press("Next"); await dialog.press("Start run"); }

it("offers the library spreadsheets that fit in the picker and leaves out one without the key column; a picked row shows its version and update date", async () => {
  await h.openDialog(h.stubClient({ ...served }), { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle();
  assert.match(text(), /References/u);
  assert.equal(text().includes("Reference spreadsheets"), false);
  assert.ok(h.buttons().some(button => button.textContent?.trim() === "Add spreadsheet"));
  await click("Add spreadsheet");
  const items = () => [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(node => node.textContent ?? "");
  assert.match(items().join(" "), /Contact roster/u);
  assert.equal(items().join(" ").includes("First"), false, "the menu lists spreadsheets only");
  assert.equal(text().includes("Notes"), false);
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await add("References", "I-9 tracker");
  assert.match(text(), /I-9 tracker/u); assert.match(text(), /v6 · [A-Z][a-z]{2} \d/u);
  assert.equal(text().includes("Sheet1 · v6"), false, "the worksheet list lives in the picker, not the row");
});

it("picks and removes a row in place; the optional check starts with no pick and sends each pick with its declaration", async () => {
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...served, submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return h.planResponse("5a000000-0000-4000-8000-000000000001"); } }),
    { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle();
  await dialog.type(h.TYPED); assert.equal(dialog.disabled("Next"), false, "no pick is valid");
  await add("References", "Contact roster"); await add("References", "I-9 tracker");
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Remove Contact roster"));
  await click("Remove I-9 tracker");
  assert.equal(h.buttons().some(button => h.buttonName(button) === "Remove I-9 tracker"), false);
  await dialog.press("Next"); await dialog.press("Start run");
  assert.deepEqual(planned?.workbookReferences, [{ typeId: "reference-check", entry: 1, libraryId: "roster", versionId: "v", sheetId: "Second", expectedVersion: 2 }]);
});

it("plans again without a check removed after its expired plan was rebuilt", async () => {
  const planned: StartPlanRequest[] = [], commands: unknown[] = [];
  const dialog = await h.openDialog(h.stubClient({ ...served,
    submitStartPlan: async input => {
      const request = StartPlanRequestSchema.parse(input); planned.push(request);
      const plan = h.planResponse(`5a000000-0000-4000-8000-00000000000${String(planned.length)}`);
      const references = (request.workbookReferences ?? []).map(chosen => ({ libraryId: chosen.libraryId, version: chosen.expectedVersion, versionId: chosen.versionId, versionName: "v6",
        worksheets: [{ sheetId: chosen.sheetId, name: chosen.sheetId }], type: roster.type }));
      return StartPlanWireSchema.parse({ ...plan, planned: plan.planned.map(entry => references.length === 0 ? entry : { ...entry, workbookReferences: references }) });
    },
    executeCommand: async input => { commands.push(input); return commands.length > 1 ? new Promise<CommandResult>(() => undefined)
      : CommandResultSchema.parse({ state: "rejected", commandId: "3a000000-0000-4000-8000-000000000001", code: "RUN_START_PLAN_EXPIRED", message: "Expired." }); },
  }), { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle(); await dialog.type(h.TYPED); await add("References", "Contact roster");
  await dialog.press("Next"); await dialog.press("Start run");
  for (let wait = 0; wait < 10; wait += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  assert.equal(commands.length, 1); assert.equal(planned.length, 2, "the expired plan was rebuilt"); assert.ok(h.planIsDrawn());
  await dialog.press("1 Input"); await click("Remove Contact roster"); await dialog.press("Next");
  assert.equal(h.planIsDrawn(), false, "the rebuilt plan went with its spreadsheet");
  await dialog.press("Start run");
  assert.equal(planned.length, 3, "Start planned again");
  assert.equal(planned[1].workbookReferences?.length, 1);
  assert.equal(planned[2].workbookReferences, undefined);
});

it("offers the version select on a picked row and sends the named version's worksheet", async () => {
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...served, submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return h.planResponse("5a000000-0000-4000-8000-000000000001"); } }),
    { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle(); await add("References", "Contact roster");
  const trigger = h.buttons().find(button => h.buttonName(button) === "Contact roster version"); assert.ok(trigger);
  await act(async () => { trigger.click(); });
  const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent?.includes("v5")); assert.ok(option);
  await act(async () => { option.click(); }); await h.settle(); await h.settle();
  assert.match(text(), /Earlier/u);
  await dialog.type(h.TYPED); await dialog.press("Next"); await dialog.press("Start run");
  assert.deepEqual(planned?.workbookReferences, [{ typeId: "reference-check", entry: 1, libraryId: "roster", versionId: "old", sheetId: "Earlier", expectedVersion: 2 }]);
});

it("picks several worksheets of one spreadsheet as separate references", async () => {
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...served, submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return h.planResponse("5a000000-0000-4000-8000-000000000001"); } }),
    { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle(); await add("References", "Contact roster");
  await click("Contact roster worksheets, Second");
  const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(node => node.textContent?.includes("First")); assert.ok(item);
  await act(async () => { item.click(); }); await h.settle();
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Contact roster worksheets, 2 worksheets"));
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await dialog.type(h.TYPED); await dialog.press("Next"); await dialog.press("Start run");
  assert.deepEqual(planned?.workbookReferences?.map(reference => [reference.libraryId, reference.sheetId]), [["roster", "First"], ["roster", "Second"]]);
});

const crm = DESCRIPTORS.find(flow => flow.id === "crm-doc-download"); assert.ok(crm?.surfaces.inputRun);
const crmFlow: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: crm.id, label: crm.label, version: crm.version,
  requiredWorkbookFields: [...crm.requiredWorkbookFields], workbookReference: crm.workbookReference,
  steps: projectStartSteps(crm), inputRun: { state: "present", surface: crm.surfaces.inputRun } };
const worksheetItems = (role: string) => [...document.body.querySelectorAll<HTMLElement>(`[role="${role}"]`)];
async function toggle(name: string) {
  const item = worksheetItems("menuitemcheckbox").find(node => node.textContent === name); assert.ok(item, `no worksheet ${name}`);
  await act(async () => { item.click(); }); await h.settle();
}

it("lets CRM Doc Download choose several reference worksheets, keeps at least one and sends each", async () => {
  let planned: StartPlanRequest | undefined;
  const fields = [...crm.requiredWorkbookFields];
  const dialog = await h.openDialog(h.stubClient({ ...reads([roster], [source("roster", { First: fields, Second: fields })], [crm]),
    submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return h.planResponse("5a000000-0000-4000-8000-000000000001"); } }),
  { workflows: [crmFlow], panelWorkflowId: crm.id });
  await h.settle(); await add("References", "Contact roster");
  await click("Contact roster worksheets, Second");
  await toggle("Second");
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Contact roster worksheets, Second"), "the last worksheet stays chosen");
  await toggle("First");
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Contact roster worksheets, 2 worksheets"));
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await dialog.type("hire@example.test"); await dialog.press("Next"); await dialog.press("Start run");
  assert.deepEqual(planned?.workbookReferences?.map(reference => [reference.entry, reference.libraryId, reference.sheetId]), [[1, "roster", "First"], [1, "roster", "Second"]]);
});

it("stops CRM Doc Download at the 32 worksheet cap a run can start with", async () => {
  const fields = [...crm.requiredWorkbookFields];
  const names = Array.from({ length: 33 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`);
  await h.openDialog(h.stubClient({ ...reads([roster], [source("roster", Object.fromEntries(names.map(name => [name, fields])))], [crm]) }),
    { workflows: [crmFlow], panelWorkflowId: crm.id });
  await h.settle(); await add("References", "Contact roster");
  await click("Contact roster worksheets, S33");
  for (const name of names.slice(1, 32)) await toggle(name);
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Contact roster worksheets, 32 worksheets"));
  const item = (name: string) => worksheetItems("menuitemcheckbox").find(node => node.textContent === name);
  assert.equal(item("S01")?.getAttribute("aria-disabled"), "true");
  assert.match(text(), /32 worksheets is the most for one run/u);
  await toggle("S03");
  assert.equal(item("S01")?.getAttribute("aria-disabled"), null);
});

it("gives each workflow in the list one title with its full name", async () => {
  await h.openDialog(h.stubClient({ ...served }), { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle();
  const entry = document.body.querySelector<HTMLElement>(`nav[aria-label="Workflow"] button[aria-label="${lookup.label}"]`); assert.ok(entry);
  assert.equal(entry.getAttribute("title"), lookup.label);
  assert.ok(entry.querySelector("[title]") === null);
});

it("offers only the worksheet that maps the required reference fields", async () => {
  await h.openDialog(h.stubClient({ ...rosterLookupReads() }), { workflows: [rosterLookup], panelWorkflowId: rosterLookup.workflowId });
  await h.settle(); await add("References", "Contact roster");
  await click("Contact roster worksheets, First");
  assert.deepEqual(worksheetItems("menuitemcheckbox").map(option => [option.textContent, option.getAttribute("aria-checked")]), [["First", "true"]]);
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
  assert.equal(dialog.disabled("Next"), true, "the required reference keeps Continue off until picked");
});

it("merges the required roster and the optional check picks into one References field with one Add spreadsheet button", async () => {
  await h.openDialog(h.stubClient({ ...reads([roster, tracker], [source("roster", { First: ["eid", "email"] }), source("tracker", { Sheet1: ["eid"] })], [onboarding]) }),
    { workflows: [onboardingFlow], panelWorkflowId: onboarding.id });
  await h.settle();
  const lists = [...document.querySelectorAll<HTMLElement>('[role="region"][aria-label="References"]')];
  assert.equal(lists.length, 1, "one list");
  assert.equal(text().includes("Also check"), false);
  assert.equal(text().includes("Reference spreadsheets"), false);
  assert.equal([...lists[0].querySelectorAll("button")].filter(button => button.textContent?.trim() === "Add spreadsheet").length, 1);
});

const rosterLookupReference = { id: "roster-type", keyFieldId: "eid", mode: "keys", writableFields: [] } as const;
const rosterLookup: RunStartWorkflow = { ...h.WORKFLOWS[0], requiredWorkbookFields: ["eid"], workbookReference: rosterLookupReference, workbookCheck: CHECK };
const rosterLookupReads = () => reads([roster, tracker], [source("roster", { First: ["eid"] }), source("tracker", { Sheet1: ["eid"] })],
  [{ id: rosterLookup.workflowId, label: rosterLookup.label, requiredWorkbookFields: ["eid"], workbookReference: rosterLookupReference }]);

it("sends the lookup roster and the extra check picks the two old fields sent, from the one References field", async () => {
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...rosterLookupReads(), submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return h.planResponse("5a000000-0000-4000-8000-000000000001"); } }),
    { workflows: [rosterLookup], panelWorkflowId: rosterLookup.workflowId });
  await h.settle();
  await dialog.type(h.TYPED);
  assert.equal(dialog.disabled("Next"), true, "the required roster keeps Continue off until picked");
  await add("References", "Contact roster");
  assert.equal(dialog.disabled("Next"), false);
  await add("References", "I-9 tracker");
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Remove Contact roster"));
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Remove I-9 tracker"));
  await dialog.press("Next"); await dialog.press("Start run");
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
  await add("References", "Contact roster");
  await add("References", "I-9 tracker");
  assert.equal(dialog.disabled("Next"), false);
  await click("Remove Contact roster");
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Remove I-9 tracker"), "the check stays selected");
  assert.equal(dialog.disabled("Next"), true);
  assert.ok(text().includes("Add a reference spreadsheet first."));
});

it("lists worksheets newest first and narrows them by search", async () => {
  await h.openDialog(h.stubClient({ ...served }), { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle(); await add("References", "Contact roster");
  await click("Contact roster worksheets, Second");
  const items = () => [...document.body.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].map(node => node.textContent);
  assert.deepEqual(items(), ["Second", "First"]);
  const search = document.body.querySelector<HTMLInputElement>('input[aria-label="Find a worksheet"]'); assert.ok(search);
  const descriptor: { set?: (this: unknown, value: string) => void } | undefined = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const find = async (value: string) => act(async () => { descriptor?.set?.call(search, value); search.dispatchEvent(new Event("input", { bubbles: true })); });
  await find("fir");
  assert.deepEqual(items(), ["First"]);
  await find("zzz");
  assert.deepEqual(items(), []);
  assert.match(text(), /No worksheets match\./u);
});

it("says None added in the References card until a spreadsheet is picked, and again after it is removed", async () => {
  await h.openDialog(h.stubClient({ ...served }), { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle();
  const card = () => document.body.querySelector('[role="region"][aria-label="References"]')?.textContent ?? "";
  assert.match(card(), /None added/u);
  await add("References", "Contact roster");
  assert.doesNotMatch(card(), /None added/u);
  await click("Remove Contact roster");
  assert.match(card(), /None added/u);
});
