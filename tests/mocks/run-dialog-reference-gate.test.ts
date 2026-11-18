import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { Hono } from "hono";
import type { DashboardApp } from "../../src/backend/transports/http/routes/api-types.js";
import { registerWorkbookRoutes } from "../../src/backend/transports/http/routes/workbooks.js";
import { createWorkbookLibraryService } from "../../src/backend/workbooks/workbook-library-service.js";
import { WORKFLOW_MODULES } from "../../src/backend/app/registries/workflow-registry.js";
import { FrontendBootstrapWireSchema, WorkflowBootstrapPrimitiveSchema } from "../../src/models/dashboard/bootstrap.js";
import { DashboardDayWireSchema } from "../../src/models/dashboard/projection.js";
import { openAuthorityHarness } from "../support/helpers/phase1f-executor-harness.js";
import { startSweepOverlay } from "./helpers/sweep-fixtures-server.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE } from "./helpers/fixture-start.js";

const out = process.env.REFERENCE_GATE_OUT ?? "tests/mocks/.output/run-dialog-reference-gate";
test.beforeAll(async () => { await mkdir(out, { recursive: true }); });
const day = DashboardDayWireSchema.parse({ ...FIXTURE_START_PICKER_DAY_WIRE, queueSurfaces: [], attemptHistory: [], monthCounts: [], workflowCounts: [], statusCounts: [], notifications: [] });
const bootstrap = FrontendBootstrapWireSchema.parse({ ...FIXTURE_START_PICKER_BOOTSTRAP, workflows: WorkflowBootstrapPrimitiveSchema.array().parse(FIXTURE_START_PICKER_BOOTSTRAP.workflows).map(flow =>
  flow.id === "emergency-contact" ? { ...flow, start: { ...flow.start, workbookCheck: { id: "reference-check", keyFieldId: "eid" } } } : flow) });
const MISSING = "Add a reference spreadsheet first.";

/** The real workbook routes over a synthetic library holding a roster and a check-only tracker, with a stub PDF upload. */
async function startServer() {
  const h = await openAuthorityHarness();
  try {
    const library = createWorkbookLibraryService({ repository: h.database.authority.workbooks, clock: h.clock, sync: { async withDownload() { throw new Error("no sync in this scene"); } } });
    const book = (name: string, fields: readonly string[]) => library.create({ name, themes: [], hasFormulas: false,
      sheets: [{ id: "people", name: "People", width: fields.length, hidden: [], headerRow: 1,
        columnBindings: fields.map((fieldId, index) => ({ id: fieldId, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" as const })),
        rows: [{ id: "header", cells: fields.map(value => ({ value })) }, { id: "sample", cells: fields.map(value => ({ value: value === "eid" ? "10800000" : "Example, Avery" })) }] }] });
    const roster = book("Contact roster.xlsx", ["eid", "fullName"]);
    library.putType({ id: "ocr-roster", name: "OCR roster", keyFieldId: "eid", fields: ["eid", "fullName"], defaultWorkbookId: null });
    library.operatorOperation(roster.libraryId, "fixture-type", { kind: "metadata", expectedVersion: 1, metadata: { typeId: "ocr-roster", sharePoint: null } });
    book("I-9 tracker.xlsx", ["eid"]);
    const app: DashboardApp = new Hono();
    registerWorkbookRoutes(app, { workbooks: { library, workflows: WORKFLOW_MODULES.map(module => module.descriptor), intake: async () => { throw new Error("no intake in this scene"); } } });
    app.post("/api/v1/ocr/files", async c => {
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      return c.json({ fileName: decodeURIComponent(c.req.header("x-relay-file-name") ?? "scan.pdf"), uploadedBy: "local-operator", uploadedAt: "2026-08-03T00:00:00.000Z",
        artifact: { id: "00000000-0000-4000-8000-000000000001", mediaType: "application/pdf", bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") } });
    });
    const server = await startSweepOverlay(app, { bootstrap, descriptorHash: day.descriptorHash, day });
    return { ...server, async close() { try { await server.close(); } finally { await h.dispose(); } } };
  } catch (error) { await h.dispose(); throw error; }
}

for (const width of [1280, 1024]) {
  test(`Emergency Contact holds Continue until the roster is added, at ${width}`, async ({ page }) => {
    const server = await startServer();
    try {
      await page.setViewportSize({ width, height: 1000 });
      const view = { workflow: "emergency-contact", launchServed: "emergency-contact", launchStage: "Input" };
      await page.goto(`${server.baseUrl}/?fixture=product-workflows&day=${day.day}&start=1&view=${encodeURIComponent(JSON.stringify(view))}`);
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.locator('input[type="file"]').setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF scan") });
      await expect(dialog.getByText("scan.pdf").first()).toBeVisible();
      await dialog.getByRole("button", { name: "Use I-9 tracker.xlsx" }).click();
      await expect(dialog.getByRole("button", { name: "Remove I-9 tracker.xlsx" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
      await expect(dialog.getByText(MISSING).first()).toBeVisible();
      await page.screenshot({ path: `${out}/check-only-${width}.png` });
      await dialog.getByRole("button", { name: "Add spreadsheet" }).click();
      await page.getByRole("textbox", { name: "Find a spreadsheet" }).fill("Contact");
      await page.getByRole("menuitem", { name: /Contact roster/u }).click();
      await expect(page.getByRole("menuitem", { name: /Contact roster/u })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
      await expect(dialog.getByText(MISSING)).toHaveCount(0);
      await page.screenshot({ path: `${out}/roster-chosen-${width}.png` });
      await dialog.getByRole("button", { name: "Continue", exact: true }).click();
      await dialog.getByText("Do not file", { exact: true }).click();
      await dialog.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(dialog.getByText("Reference spreadsheet", { exact: true })).toBeVisible();
      await page.screenshot({ path: `${out}/last-stage-${width}.png` });
    } finally { await server.close(); }
  });
}
