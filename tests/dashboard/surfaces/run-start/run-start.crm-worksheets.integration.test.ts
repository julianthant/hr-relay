// @vitest-environment jsdom
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { act } from "react";
import { afterAll, afterEach, it } from "vitest";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { projectStartRows, projectStartSteps, startRowWire } from "../../../../src/backend/runs/start/step-selection.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { StartPlanRequestSchema, StartPlanWireSchema } from "../../../../src/models/dashboard/start-plan.js";
import { parseRunWorkbookReference } from "../../../../src/models/dashboard/workbooks.js";
import { CRM_DOCUMENT_ROSTER_FIELDS } from "../../../../src/models/workflows/crm-doc-download/documents.js";
import { CommandResultSchema, StartCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import { unexpectedWorkbookSync } from "../../../support/helpers/backend/workbook-sync.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";

const h = createRunStartDialogHarness();
const profiles = createProfileFixtureSet();
const world = createCommandKernelTestWorld(profiles.create);
afterAll(() => profiles.close());
afterEach(async () => {
  await h.cleanup();
  while (world.openDatabases.length) world.openDatabases.pop()!.close();
  while (world.profiles.length) await world.profiles.pop()!.close();
  while (world.roots.length) rmSync(world.roots.pop()!, { recursive: true, force: true });
});

const crm = DESCRIPTORS.find(flow => flow.id === "crm-doc-download"); assert.ok(crm?.surfaces.inputRun);
const crmFlow: RunStartWorkflow = { ...h.WORKFLOWS[0], workflowId: crm.id, label: crm.label, version: crm.version,
  requiredWorkbookFields: [...crm.requiredWorkbookFields], workbookReference: crm.workbookReference,
  steps: projectStartSteps(crm), rows: projectStartRows(crm).map(startRowWire), inputRun: { state: "present", surface: crm.surfaces.inputRun } };
const EMAIL = "hire@example.test";
const SECOND_EMAIL = "second@example.test";

it.each([false, true])("captures each chosen worksheet when starting CRM Document Download with manual records %s", async manual => {
  const f = await world.createHarness(undefined, { descriptors: [crm] });
  const repository = f.database.authority.workbooks;
  const library = createWorkbookLibraryService({ repository, clock: f.clock, sync: unexpectedWorkbookSync });
  const sheet = (id: string) => ({ id, name: id, width: CRM_DOCUMENT_ROSTER_FIELDS.length, hidden: [], headerRow: 1,
    columnBindings: CRM_DOCUMENT_ROSTER_FIELDS.map((fieldId, index) => ({ id: `${id}-${index}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" as const })),
    rows: [{ id: `${id}-header`, cells: CRM_DOCUMENT_ROSTER_FIELDS.map(value => ({ value })) },
      { id: `${id}-person`, cells: [EMAIL, "Ada", "Lovelace", null, "Ada", "Lovelace", null].map(value => ({ value })) },
      { id: `${id}-second-person`, cells: [SECOND_EMAIL, "Grace", "Hopper", null, "Grace", "Hopper", null].map(value => ({ value })) }] });
  const saved = library.create({ name: "Contact roster.xlsx", themes: [], hasFormulas: false, sheets: ["Nov 2", "Nov 9", "Nov 16"].map(sheet) });
  repository.putType({ id: crm.workbookReference!.id, name: "Onboarding roster", keyFieldId: crm.workbookReference!.keyFieldId, fields: [...CRM_DOCUMENT_ROSTER_FIELDS], defaultWorkbookId: null });
  assert.equal(library.operatorOperation(saved.libraryId, "declare", { kind: "metadata", expectedVersion: saved.version,
    metadata: { typeId: crm.workbookReference!.id, sharePoint: null } }).state, "applied");
  const config = f.database.authority.runtimeConfig.get(); assert.ok(config);
  const planner = createStartPlanService({ authority: f.database, authorityRead: f.database, clock: f.clock, ids: f.plannerIds,
    descriptors: { resolve: id => id === crm.id ? crm : undefined }, planTtlMs: 600_000, workbooks: library,
    configFingerprint: config.configFingerprint, configSnapshotId: config.configSnapshotId, plannedBy: "local-operator" });
  let planned: unknown;
  const dialog = await h.openDialog(h.stubClient({
    workbookList: async () => [], workbookCatalog: async () => repository.catalog(), workbookTypes: async () => repository.types(),
    workbookLibraryVersion: async (libraryId: string, versionId?: string) => repository.libraryVersion(libraryId, versionId),
    workbookCompatibility: async () => library.compatibility([{ id: crm.id, label: crm.label, requiredWorkbookFields: crm.requiredWorkbookFields, workbookReference: crm.workbookReference }]),
    submitStartPlan: async input => { planned = StartPlanRequestSchema.parse(input); return StartPlanWireSchema.parse(planner.plan(planned)); },
    executeCommand: async input => CommandResultSchema.parse(f.kernel.execute(StartCommandRequestSchema.parse(input))),
  }), { workflows: [crmFlow], panelWorkflowId: crm.id });
  await h.settle();
  const open = (label: string) => [...document.body.querySelectorAll("button")].find(button => h.buttonName(button) === label);
  const pickSpreadsheet = open("Add spreadsheet"); assert.ok(pickSpreadsheet);
  await act(async () => { pickSpreadsheet.click(); });
  const search = document.body.querySelector<HTMLInputElement>('input[aria-label="Find a spreadsheet"]'); assert.ok(search);
  const setValue: { set?: (this: unknown, value: string) => void } | undefined = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  await act(async () => { setValue?.set?.call(search, "Contact"); search.dispatchEvent(new Event("input", { bubbles: true })); });
  const row = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent?.includes("Contact roster")); assert.ok(row);
  await act(async () => { row.click(); }); await h.settle();
  const menu = open("Contact roster.xlsx worksheets, Nov 16"); assert.ok(menu, h.buttons().map(button => h.buttonName(button)).join(" / "));
  await act(async () => { menu.click(); });
  const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(node => node.textContent === "Nov 2"); assert.ok(item);
  await act(async () => { item.click(); }); await h.settle();
  await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await dialog.type(manual ? `${EMAIL}; ${SECOND_EMAIL}` : EMAIL); await dialog.press("Next");
  const firstRecord = `fixture | | ${EMAIL} |`;
  const typedRecords = `${firstRecord}; second | | ${SECOND_EMAIL} |`;
  if (manual) {
    await dialog.press("Customize steps"); await dialog.press("Next");
    for (const label of ["Find latest CRM records", "Resolve worksheet rows", "Download CRM documents", "Package worksheet archives"]) {
      assert.equal(dialog.disabled(`Include ${label}`), false, label);
    }
    assert.ok(dialog.text().includes("Also omits: Download CRM documents"), dialog.text());
    await dialog.press("Resolve worksheet rows");
    assert.equal(dialog.disabled("Include Download CRM documents"), true);
    assert.ok(dialog.text().includes("Omitted with Resolve worksheet rows."), dialog.text());
    assert.equal(dialog.disabled("Include Package worksheet archives"), false);
    assert.ok(dialog.text().includes("Turn off Package worksheet archives if done by hand."), dialog.text());
    await dialog.press("Package worksheet archives");
    assert.ok(dialog.text().includes("Done outside Relay."), dialog.text());
    await dialog.press("Resolve worksheet rows");
    assert.equal(dialog.disabled("Include Download CRM documents"), false);
    await dialog.press("Package worksheet archives");
    await dialog.press("Download CRM documents");
    assert.ok(dialog.text().includes("Needs Download CRM documents. Turn off if done by hand."), dialog.text());
    assert.equal(dialog.disabled("Start run"), true);
    await dialog.press("Download CRM documents");
    await dialog.press("Find latest CRM records");
    assert.equal(dialog.disabled("Start run"), true);
    for (const [description, records] of [
      ["malformed email", "fixture | | malformed |"],
      ["duplicate record ID", `${firstRecord}; fixture | | ${SECOND_EMAIL} |`],
      ["incomplete batch", firstRecord],
      ["mismatched identity", `${firstRecord}; second | | other@example.test |`],
    ]) {
      await dialog.fill("CRM records", records);
      assert.equal(dialog.disabled("Start run"), true, description);
      assert.equal(planned, undefined, description);
      assert.deepEqual(f.database.authority.runs.listByWorkflow(crm.id), [], description);
    }
    assert.ok(dialog.text().includes("CRM records: match the requested people in input order."), dialog.text());
    await dialog.fill("CRM records", typedRecords);
    assert.equal(dialog.disabled("Start run"), false);
  }
  await dialog.press("Start run");
  assert.deepEqual(StartPlanRequestSchema.parse(planned).stepOmissions, manual ? [{ step: "search-records", facts: { records: typedRecords } }] : undefined);
  const runs = f.database.authority.runs.listByWorkflow(crm.id);
  assert.equal(runs.length, 1);
  const references = (runs[0].input.workbookReferences ?? []).map(bound => parseRunWorkbookReference(bound));
  assert.deepEqual(references.map(reference => reference.snapshot.worksheets.map(worksheet => worksheet.sheetId)), [["Nov 2"], ["Nov 16"]]);
  assert.deepEqual(references.map(reference => reference.snapshot.rows[0]?.matches.length), [1, 1]);
});
