// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, it } from "vitest";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { projectStartSteps } from "../../../../src/backend/runs/start/step-selection.js";
import { WorkbookLibraryEntrySchema, projectWorkbookCompatibility } from "../../../../src/models/dashboard/workbook-library.js";
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

const libraryEntry = (libraryId: string, name: string, worksheets: readonly string[]) => WorkbookLibraryEntrySchema.parse({ libraryId, name, version: 2, updatedAt: "2026-11-01T00:00:00Z", rowCount: 1,
  worksheets: worksheets.map(id => ({ id, name: id })), metadata: { typeId: "any", sharePoint: null },
  type: { id: "any", name: "Any", keyFieldId: "eid", fields: ["eid"], defaultWorkbookId: libraryId },
  state: { libraryId, revision: 1, selectedVersionId: "v", removed: false, pinned: false, tags: [], origin: { kind: "local" },
    versions: [{ id: "v", name: "v6", snapshotId: "s", version: 1, savedAt: "2026-11-01T00:00:00Z", source: "operator" }] } });
const source = (libraryId: string, sheets: Readonly<Record<string, readonly string[]>>) => ({ libraryId, versionId: "v", origin: { kind: "local" as const }, removed: false,
  sheets: Object.entries(sheets).map(([id, fields]) => ({ id, name: id, mappings: fields.map((fieldId, column) => ({ fieldId, column, basis: "manual" as const })) })) });
function reads(entries: readonly ReturnType<typeof libraryEntry>[], sources: ReturnType<typeof source>[], workflows: Parameters<typeof projectWorkbookCompatibility>[0] = []) {
  const compatibility = projectWorkbookCompatibility(workflows, sources);
  return { workbookList: async () => [], workbookCatalog: async () => entries, workbookCompatibility: async () => compatibility, workbookTypes: async () => [], workbookLibraryVersion: async () => { throw new Error("unused"); } };
}
const roster = libraryEntry("roster", "Contact roster", ["First", "Second"]);
const tracker = libraryEntry("tracker", "I-9 tracker", ["Sheet1"]);
const plain = libraryEntry("plain", "Notes", ["Notes"]);
const served = reads([roster, tracker, plain], [source("roster", { First: ["eid", "fullName"], Second: ["eid"] }), source("tracker", { Sheet1: ["eid"] }), source("plain", { Notes: ["fullName"] })]);
const text = () => document.body.textContent ?? "";
async function click(name: string) {
  const button = h.buttons().find(candidate => h.buttonName(candidate) === name); assert.ok(button, `no button ${name}`);
  await act(async () => { button.click(); }); await h.settle();
}
async function start(dialog: Awaited<ReturnType<typeof h.openDialog>>) { await dialog.type(h.TYPED); await dialog.press("Continue"); await dialog.press("Start run"); }

it("lists the library spreadsheets that fit as rows with their worksheet and version, and leaves out one without the key column", async () => {
  await h.openDialog(h.stubClient({ ...served }), { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle();
  assert.match(text(), /Reference spreadsheets/u);
  assert.match(text(), /Contact roster/u); assert.match(text(), /First, Second · v6/u);
  assert.match(text(), /I-9 tracker/u); assert.match(text(), /Sheet1 · v6/u);
  assert.equal(text().includes("Notes"), false);
  assert.ok(h.buttons().some(button => button.textContent?.trim() === "Add spreadsheet"));
});

it("picks and removes a row in place; the optional check starts with no pick and sends each pick with its declaration", async () => {
  let planned: StartPlanRequest | undefined;
  const dialog = await h.openDialog(h.stubClient({ ...served, submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return h.planResponse("5a000000-0000-4000-8000-000000000001"); } }),
    { workflows: [lookup], panelWorkflowId: lookup.workflowId });
  await h.settle();
  await dialog.type(h.TYPED); assert.equal(dialog.disabled("Continue"), false, "no pick is valid");
  await click("Use Contact roster"); await click("Use I-9 tracker");
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Remove Contact roster"));
  assert.equal(h.buttons().some(button => h.buttonName(button) === "Use Contact roster"), false);
  await click("Remove I-9 tracker");
  assert.ok(h.buttons().some(button => h.buttonName(button) === "Use I-9 tracker"));
  await dialog.press("Continue"); await dialog.press("Start run");
  assert.deepEqual(planned?.workbookReferences, [{ typeId: "reference-check", entry: 1, libraryId: "roster", versionId: "v", sheetId: "First", expectedVersion: 2 }]);
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
  assert.equal(h.buttons().some(button => h.buttonName(button).startsWith("Use ")), false);
  assert.ok(h.buttons().some(button => button.textContent?.trim() === "Add spreadsheet"));
});

it("opens Onboarding with its required reference unpicked, the check rows beside it and no attention notice", async () => {
  const dialog = await h.openDialog(h.stubClient({ ...reads([roster, tracker], [source("roster", { First: ["eid", "email"] }), source("tracker", { Sheet1: ["eid"] })], [onboarding]) }),
    { workflows: [onboardingFlow], panelWorkflowId: onboarding.id });
  await h.settle();
  assert.equal(text().includes("Selected rows need attention"), false);
  assert.equal(text().includes("Fix the refused entry first."), false);
  assert.match(text(), /I-9 tracker/u);
  assert.equal(dialog.disabled("Continue"), true, "the required reference keeps Continue off until picked");
});
