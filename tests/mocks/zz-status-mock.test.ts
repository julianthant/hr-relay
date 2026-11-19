import { expect, type Locator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Hono } from "hono";
import { WORKFLOW_MODULES } from "../../src/backend/app/registries/workflow-registry.js";
import type { DashboardApp } from "../../src/backend/transports/http/routes/api-types.js";
import { registerWorkbookRoutes } from "../../src/backend/transports/http/routes/workbooks.js";
import { createWorkbookLibraryService } from "../../src/backend/workbooks/workbook-library-service.js";
import { WorkflowBootstrapPrimitiveSchema } from "../../src/models/dashboard/bootstrap.js";
import { RowRevisionSchema } from "../../src/models/dashboard/primitives.js";
import { DashboardDayWireSchema, QueueSurfaceWireSchema } from "../../src/models/dashboard/projection.js";
import { RerunValuesResponseSchema } from "../../src/models/dashboard/rerun-values.js";
import { RerunWarningRequestSchema, RerunWarningWireSchema } from "../../src/models/dashboard/rerun-warning.js";
import { PreflightReadinessWireSchema, PreflightSelectionSchema } from "../../src/models/preflight/preflight-contract.js";
import { OcrSourceUploadSchema } from "../../src/models/ocr/review.js";
import { ACTIVITY_SAMPLE_TODAY } from "../support/fixtures/dashboard/activity-sample.js";
import { FIXTURE_IDS } from "../support/fixtures/dashboard/fixture-queue.js";
import { openAuthorityHarness } from "../support/helpers/phase1f-executor-harness.js";
import { test } from "./helpers/fixtures.js";
import { FIXTURE_DAY, FIXTURE_NOW, traceOf, uuidOf } from "./helpers/fixture-identity.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "../support/fixtures/dashboard/fixture-start.js";
import { fixturePreflightReport } from "./helpers/fixture-preflight-routes.js";
import { startSeparationsStartServer } from "./helpers/run-rerun-server.js";
import { serveSettings } from "./helpers/served-settings.js";
import { startOcrSweepServer, startSweepOverlay } from "./helpers/sweep-fixtures-server.js";
import { STATUS_MOCK_IDS, type StatusMockId } from "./helpers/status-mock/status-mock-model.js";
import { mockOutDir } from "./helpers/out-dir.js";

// Design mock renders for the status pages that leave Settings; output goes to the gitignored .work folder.
const OUT = mockOutDir(process.env.STATUS_MOCK_OUT, "settings-status-mock");
const THEMES = (process.env.STATUS_MOCK_THEMES ?? "light").split(",") as ("light" | "dark")[];
const WIDTH = Number(process.env.STATUS_MOCK_WIDTH ?? 1280);
const HEIGHT = 720;
const ONLY = process.env.STATUS_MOCK_ONLY?.split(",");
const SCAN = { name: "Scan_0412.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") };
const ROSTERS = { "Emergency Contact": "Onboarding hires", "I-9 Check": "Action History", Onboarding: "New hire roster" };
const START = /^Start (?:(?:dry|live) )?run$/u;
// 2 renders at the Codex references' scale for pixel comparison.
test.use({ deviceScaleFactor: Number(process.env.STATUS_MOCK_SCALE ?? 1) });

const SETTINGS_PAGE: Partial<Record<StatusMockId, string>> = {
  "general-a": "general", "general-a-browser": "general", "general-a-date": "general",
  "search-keyboard": "keyboard",
};

const baseDay = FIXTURE_START_PICKER_DAY_WIRE;
const failedRun = baseDay.queueSurfaces.find(row => row.runId === FIXTURE_IDS.failedRun);
if (failedRun === undefined || failedRun.surfaceKind !== "single") throw new Error("Status fixture needs a terminal queue row");
const rerunRows = [
  { runId: uuidOf(831), workflowId: "emergency-contact", title: "Earlier Emergency Contact run" },
  { runId: uuidOf(832), workflowId: "separations", title: "Earlier Separations run" },
].map(({ runId, workflowId, title }, index) => {
  const workflow = WorkflowBootstrapPrimitiveSchema.array().parse(FIXTURE_START_PICKER_BOOTSTRAP.workflows).find(item => item.id === workflowId);
  if (!workflow) throw new Error(`Status fixture is missing ${workflowId}`);
  const row = QueueSurfaceWireSchema.parse({
    ...failedRun, runId, workflowId, title, itemId: uuidOf(835 + index), traceId: traceOf(835 + index), descriptorVersion: workflow.start.version,
    descriptorHash: workflow.descriptorFingerprint, pipeline: [], subtitle: { state: "absent", reason: "No subtitle" },
  });
  const snapshot = RerunValuesResponseSchema.parse({
    state: "available", snapshot: {
      sourceInput: { state: "available", value: workflowId === "separations" ? { documentNumber: "48216" } : {} },
      source: { runId, workflow: workflowId, version: row.rowRevision, descriptorVersion: workflow.start.version,
        contractFingerprint: workflow.descriptorFingerprint, outcome: "failed" },
      steps: workflow.start.steps.map(step => ({ key: step.key, state: "unfinished",
        nodes: [{ nodeId: step.key, state: "unfinished", reason: "not-recorded" }] })),
      values: [], transactions: [],
    },
  });
  return { row, snapshot };
});
const profile = {
  bootstrap: FIXTURE_START_PICKER_BOOTSTRAP,
  day: DashboardDayWireSchema.parse({
    ...baseDay,
    queueSurfaces: [...baseDay.queueSurfaces, ...rerunRows.map(({ row }) => row)],
    workflowCounts: [...baseDay.workflowCounts, ...rerunRows.map(({ row }) => ({
      workflowId: row.workflowId, count: 1, statusCounts: [{ status: row.status, count: 1 }],
    }))],
    statusCounts: baseDay.statusCounts.map(group => group.status === "failed" ? { ...group, count: group.count + rerunRows.length } : group),
  }),
  descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
};

async function startStatusServer() {
  const authority = await openAuthorityHarness();
  try {
    const library = createWorkbookLibraryService({ repository: authority.database.authority.workbooks, clock: authority.clock,
      sync: { async withDownload() { throw new Error("Status fixture does not serve workbook downloads"); } } });
    const workbook = (name: string, fields: readonly string[], sheetNames: readonly string[]) => library.create({
      name, themes: [], hasFormulas: false, sheets: sheetNames.map((sheetName, index) => ({
        id: `sheet-${String(index + 1)}`, name: sheetName, width: fields.length, hidden: [], headerRow: 1,
        columnBindings: fields.map((fieldId, sourceColumn) => ({ id: fieldId, sourceColumn, sourceHeader: fieldId, fieldId, basis: "manual" })),
        rows: [{ id: "header", cells: fields.map(value => ({ value })) },
          { id: "example", cells: fields.map(field => ({ value: field === "email" ? "hire@example.test" : field === "eid" ? "10000001" : "Example, Avery" })) }],
      })),
    });
    for (const [label, name] of Object.entries(ROSTERS)) {
      const descriptor = WORKFLOW_MODULES.find(module => module.descriptor.label === label)?.descriptor;
      const reference = descriptor?.workbookReference;
      if (descriptor === undefined || reference === undefined) throw new Error(`Missing workbook declaration for ${label}`);
      const sheets = label === "Emergency Contact" ? ["Aug 17 hires", "Aug 24 hires"] : ["Roster"];
      const book = workbook(name, descriptor.requiredWorkbookFields, sheets);
      library.putType({ id: reference.id, name, keyFieldId: reference.keyFieldId, fields: descriptor.requiredWorkbookFields, defaultWorkbookId: null });
      library.operatorOperation(book.libraryId, "fixture-reference", {
        kind: "metadata", expectedVersion: 1, metadata: { typeId: reference.id, sharePoint: null },
      });
    }
    workbook("Unmapped roster", ["fullName"], ["Aug 17 hires"]);
    const app: DashboardApp = new Hono();
    registerWorkbookRoutes(app, { workbooks: { library, workflows: WORKFLOW_MODULES.map(module => module.descriptor),
      intake: async () => { throw new Error("Status fixture does not serve workbook intake"); } } });
    app.get("/api/v1/runs/:runId/rerun-values", c => {
      const fixture = rerunRows.find(({ row }) => row.runId === c.req.param("runId"));
      if (fixture === undefined || String(fixture.row.rowRevision) !== c.req.query("expectedVersion")) {
        throw new Error("Unexpected Status rerun source");
      }
      return c.json(fixture.snapshot);
    });
    app.post("/api/v1/rerun-warnings", async c => {
      const { workflowId, source } = RerunWarningRequestSchema.parse(await c.req.json());
      const expectedRevision = RowRevisionSchema.parse(source.expectedVersion);
      if (!rerunRows.some(({ row }) => row.workflowId === workflowId && row.runId === source.runId && row.rowRevision === expectedRevision)) {
        throw new Error("Unexpected Status rerun warning source");
      }
      return c.json(RerunWarningWireSchema.parse({ workflowId, rerun: { source, warnings: [], warningDigest: "a".repeat(64) } }));
    });
    const overlay = await startSweepOverlay(app, profile);
    return { ...overlay, async close() { try { await overlay.close(); } finally { await authority.dispose(); } } };
  } catch (error) {
    await authority.dispose();
    throw error;
  }
}

let server: Awaited<ReturnType<typeof startStatusServer>>;
test.beforeAll(async () => { server = await startStatusServer(); });
test.afterAll(async () => { await server.close(); });
test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/v1\/preflight(?:\?|$)/u, async route => {
    const selection = new URL(route.request().url()).searchParams.get("selection");
    const workflowId = selection === null ? undefined : PreflightSelectionSchema.parse(JSON.parse(selection)).workflowId;
    await route.fulfill({ json: PreflightReadinessWireSchema.parse({ state: "present", report: fixturePreflightReport(profile, workflowId) }) });
  });
  await page.route("**/api/v1/ocr/files", async route => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    expect(request.headers()["x-relay-file-name"]).toBe(SCAN.name);
    expect(request.postDataBuffer()).toEqual(SCAN.buffer);
    await route.fulfill({ json: OcrSourceUploadSchema.parse({
      fileName: SCAN.name, uploadedAt: FIXTURE_NOW, uploadedBy: "local-operator",
      artifact: { id: uuidOf(830), sha256: createHash("sha256").update(SCAN.buffer).digest("hex"), bytes: SCAN.buffer.length, mediaType: SCAN.mimeType },
    }) });
  });
});

const currentLaunchStage = (dialog: Locator, name: string) =>
  dialog.getByRole("list", { name: "Run configuration path" }).locator('[aria-current="step"]').getByRole("button", { name, exact: true });
async function continueLaunch(dialog: Locator) {
  const button = dialog.getByRole("button", { name: "Continue", exact: true });
  await expect(button).toBeEnabled();
  await button.click();
}

async function chooseRoster(page: Page, dialog: Locator, name: string) {
  await dialog.getByRole("button", { name: "Add spreadsheet", exact: true }).click();
  await page.getByRole("searchbox", { name: "Find a spreadsheet" }).fill(name);
  await page.getByRole("menuitem", { name: new RegExp(`^${name}`, "u") }).click();
  await expect(dialog.getByRole("button", { name: `Remove ${name}`, exact: true })).toBeVisible();
}

async function openRerun(page: Page, workflow: "Emergency Contact" | "Separations") {
  await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: workflow, exact: true }).last().click();
  const row = page.locator(".dashboard-queue-column").getByText(`Earlier ${workflow} run`, { exact: true });
  await expect(row).toBeVisible();
  await row.click();
  const rerun = page.locator(".dashboard-log-column").getByRole("button", { name: "Rerun", exact: true });
  await expect(rerun).toBeEnabled();
  await rerun.click();
  const dialog = page.getByRole("dialog", { name: "Rerun", exact: true });
  await expect(currentLaunchStage(dialog, "1 Steps")).toBeVisible();
  return dialog;
}

async function useAnalyticsSampleClock(page: Page) {
  await page.route("**/api/v1/bootstrap", route => route.fulfill({ json: {
    ...profile.bootstrap,
    serverClock: { ...profile.bootstrap.serverClock, now: `${ACTIVITY_SAMPLE_TODAY}T17:00:00.000Z` },
  } }));
}

async function settle(page: Page) {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
}

for (const theme of THEMES) test(`status mock @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  for (const id of STATUS_MOCK_IDS.filter(item => ONLY === undefined || ONLY.includes(item))) {
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    const settings = SETTINGS_PAGE[id];
    const rerunOptions = id === "run-rerun-options";
    const signedOut = id === "run-b" || rerunOptions;
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}${settings ? `&settings=${settings}` : ""}&statusMock=${id}`);
    // The modal frames open with their dialog, which hides the page behind it from the accessibility tree.
    if (settings) await expect(page.locator("nav.settings-panel-nav")).toBeVisible();
    else if (!id.startsWith("signup")) await expect(page.getByRole("navigation", { name: "Workflows", exact: true })).toBeVisible();
    // A modal dialog blocks pointer clicks, so close the assistant panel through the DOM.
    await page.addStyleTag({ content: ".hub-assistant-launcher { display: none !important; }" });
    const firstToast = { toasts: "Relay is missing files", "toasts-open": "Relay is missing files", "toasts-storage": "Your disk is full", "toasts-restored": "Restored a file from the 6:30 PM backup" }[id as string];
    if (firstToast) await expect(page.getByText(firstToast)).toBeVisible();
    if (id.startsWith("rail")) {
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      await expect(rail.getByRole("button", { name: "Emergency Contact", exact: true })).toBeVisible();
      // The minimized state is remembered per browser, so each frame sets the one it needs.
      const want = id === "rail" ? "Collapse sidebar" : "Expand sidebar";
      const toggle = page.getByRole("button", { name: /^(Collapse|Expand) sidebar$/ });
      if (await toggle.getAttribute("aria-label") !== want) await toggle.click();
      await expect(page.getByRole("button", { name: want, exact: true })).toBeVisible();
      if (id === "rail-min-bell") { await page.getByRole("button", { name: /^Notifications/ }).click(); await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible(); }
    } else if (id === "queue-toolbar") {
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Emergency Contact", exact: true }).click();
      await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeVisible();
    } else if (id === "run-person-lookup" || id === "run-person-lookup-many") {
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Person Lookup", exact: true }).last().click();
      await page.getByRole("button", { name: "Start run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
      await expect(dialog.getByRole("list", { name: "Run configuration path" })).toBeVisible();
      await dialog.getByRole("textbox").first().fill(id === "run-person-lookup" ? "10000001" : "10000001; 10000002; Lee, Jordan");
      await expect(dialog.getByText("Parsed input")).toBeVisible();
    } else if (id === "run-options-many") {
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Separations", exact: true }).last().click();
      await page.getByRole("button", { name: "Start run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
      await dialog.getByRole("textbox").first().fill("48216; 48220");
      await continueLaunch(dialog);
      await expect(dialog.getByRole("switch", { name: "Priority", exact: true })).not.toBeChecked();
    } else if (id === "run-rerun-steps") {
      const dialog = await openRerun(page, "Separations");
      await expect(dialog.getByText(/\d+ of \d+ included/)).toBeVisible();
    } else if (id === "run-steps") {
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Separations", exact: true }).last().click();
      await page.getByRole("button", { name: "Start run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
      await dialog.getByRole("textbox").first().fill("10555001");
      await continueLaunch(dialog);
      await dialog.getByRole("switch", { name: "Customize steps", exact: true }).dispatchEvent("click");
      await continueLaunch(dialog);
      await expect(dialog.getByText(/\d+ of \d+ included/)).toBeVisible();
    } else if (id === "run-rerun" || id === "run-rerun-options") {
      const dialog = await openRerun(page, "Emergency Contact");
      await continueLaunch(dialog);
      await expect(currentLaunchStage(dialog, "2 Values")).toBeVisible();
      await expect(dialog.getByText("Reference spreadsheets")).toBeVisible();
      if (rerunOptions) {
        await dialog.locator('input[type="file"]').setInputFiles(SCAN);
        await expect(dialog.getByText(SCAN.name).first()).toBeVisible();
        await chooseRoster(page, dialog, ROSTERS["Emergency Contact"]);
        await continueLaunch(dialog);
        await expect(currentLaunchStage(dialog, "3 Options")).toBeVisible();
        await expect(dialog.getByText(/ChatGPT/iu)).toHaveCount(0);
        await expect(dialog.getByRole("button", { name: START })).toHaveCount(0);
      }
    } else if (id.startsWith("run")) {
      // The way the operator opens it: Emergency Contact in the rail, then Start a run, then choose the scan.
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Emergency Contact", exact: true }).click();
      await page.getByRole("button", { name: "Start run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
      await dialog.locator('input[type="file"]').setInputFiles(SCAN);
      await expect(dialog.getByText("Scan_0412.pdf").first()).toBeVisible();
      if (id === "run-sheets-open" || id === "run-sheets") {
        await chooseRoster(page, dialog, ROSTERS["Emergency Contact"]);
        const worksheets = dialog.getByRole("button", { name: "Onboarding hires worksheet, Aug 17 hires", exact: true });
        await expect(worksheets).toBeEnabled();
        if (id === "run-sheets-open") {
          await worksheets.click();
          await expect(page.getByRole("menuitemradio", { name: "Aug 17 hires", exact: true })).toHaveAttribute("aria-checked", "true");
          await expect(page.getByRole("menuitemradio", { name: "Aug 24 hires", exact: true })).toHaveAttribute("aria-checked", "false");
        }
      }
      if (id === "run-sheets-add" || id === "run-sheets-search" || id === "run-sheets-nopins" || id === "run-sheets-fix") {
        await dialog.getByRole("button", { name: "Add spreadsheet", exact: true }).click();
        const search = page.getByRole("searchbox", { name: "Find a spreadsheet", exact: true });
        await expect(search).toBeVisible();
        if (id === "run-sheets-search") {
          await search.fill("Onboarding");
          await expect(page.getByRole("menuitem", { name: /^Onboarding hires/u })).toBeEnabled();
          await expect(page.getByRole("menuitem", { name: /^Unmapped roster/u })).toHaveCount(0);
        }
        if (id === "run-sheets-nopins") await expect(page.getByText("Pin spreadsheets in Spreadsheets to list them here.")).toBeVisible();
        if (id === "run-sheets-fix") {
          await search.fill("Unmapped roster");
          const unmapped = page.getByRole("menuitem", { name: /^Unmapped roster/u });
          await expect(unmapped).toBeDisabled();
          await expect(unmapped).toContainText("No worksheet has Employee ID and Legal name");
        }
      }
      if (id === "run-b" || id === "run-options") {
        await chooseRoster(page, dialog, ROSTERS["Emergency Contact"]);
        await continueLaunch(dialog);
        await expect(currentLaunchStage(dialog, "2 Options")).toBeVisible();
        await expect(dialog.getByRole("button", { name: START })).toHaveCount(0);
        if (signedOut) await expect(dialog.getByText(/ChatGPT/iu)).toHaveCount(0);
      }
    }
    if (id === "general-a-browser") await page.getByRole("combobox", { name: "Browser window" }).or(page.getByRole("button", { name: "Browser window" })).first().click();
    if (id === "general-a-date") await page.getByRole("button", { name: /Choose job end date/i }).first().click();
    if (settings === "keyboard") await expect(page.getByRole("searchbox", { name: "Search shortcuts" })).toBeVisible();
    if (settings === "activity") await expect(page.getByRole("heading", { name: "Runs", exact: true })).toBeVisible();
    await settle(page);
    // Toasts stack collapsed at the top centre; only the "-open" frame hovers the stack.
    if (id === "rail-min-tooltip") { await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Emergency Contact", exact: true }).hover(); await expect(page.getByRole("tooltip")).toBeVisible(); }
    if (id === "toasts-open") { await page.mouse.move(WIDTH / 2, 40); await page.waitForTimeout(800); }
    const capture = async (frame: string) => {
      await page.screenshot({ path: join(OUT, `${frame}-${theme}-${WIDTH}.png`) });
      const body = page.locator(".launch-content");
      if (id.startsWith("run") && await body.count() && await body.evaluate(node => node.scrollHeight - node.clientHeight > 8)) {
        await body.evaluate(node => { node.scrollTop = node.scrollHeight; });
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(OUT, `${frame}-${theme}-${WIDTH}-more.png`) });
      }
    };
    await capture(id);
    // Settings pages scroll inside the window; a second full-window frame shows what sits below the fold.
    const scroller = page.locator("#dashboard-settings-content");
    if (settings && await scroller.evaluate(node => node.scrollHeight - node.clientHeight > 8)) {
      await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `${id}-${theme}-${WIDTH}-more.png`) });
    }
    if (id === "run-options" || signedOut) {
      const dialog = page.getByRole("dialog", { name: rerunOptions ? "Rerun" : "Start run", exact: true });
      await dialog.getByText("Do not file", { exact: true }).click();
      await continueLaunch(dialog);
      await expect(currentLaunchStage(dialog, rerunOptions ? "4 Checks" : "3 Checks")).toBeVisible();
      await expect(dialog.getByRole("button", { name: START })).toBeEnabled();
      if (signedOut) await expect(dialog.getByText(/ChatGPT/iu)).toHaveCount(0);
      await settle(page);
      await capture(`${id}-checks`);
    }
    if (signedOut) {
      await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const account = page.locator('[data-settings-path="chatgpt.account"]');
      await expect(account.getByText("Not connected", { exact: true })).toBeVisible();
      await expect(account.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});

// Every button variant on the kit page.
test(`kit buttons ${WIDTH}`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl.replace(/\/$/u, "")}/kit.html`, { waitUntil: "domcontentloaded" });
  const actions = page.locator("#actions");
  await expect(actions).toBeVisible();
  await page.mouse.move(1, 1);
  await actions.screenshot({ path: join(OUT, `kit-buttons-${WIDTH}.png`) });
  expect(errors).toEqual([]);
});

// The shared confirm dialog on the kit page: destructive (soft red) and non-destructive (blue), no close ×, Cancel focused and ringed, Escape closes.
for (const [trigger, title, button, destructive] of [["Open destructive dialog", "Delete this spreadsheet?", "Delete spreadsheet", true], ["Open confirm dialog", "Start a live run?", "Start live run", false]] as const) {
  test(`kit confirm dialog ${destructive ? "destructive" : "primary"} ${WIDTH}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await page.goto(`${server.baseUrl.replace(/\/$/u, "")}/kit.html`, { waitUntil: "domcontentloaded" });
    for (const theme of ["dark", "light"] as const) {
      await page.evaluate(value => { for (const el of [document.documentElement, document.body]) { el.setAttribute("data-demo-theme", value); el.classList.toggle("dark", value === "dark"); } }, theme);
      await page.getByRole("button", { name: trigger, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: title });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
      expect(await dialog.getByRole("button", { name: "Cancel", exact: true }).evaluate(node => getComputedStyle(node).outlineStyle)).toBe("solid");
      await expect(dialog.getByRole("button", { name: button, exact: true })).toBeVisible();
      await page.mouse.move(1, 1);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, `kit-confirm-${destructive ? "destructive" : "primary"}-${theme}-${WIDTH}.png`) });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    expect(errors).toEqual([]);
  });
}

// The two-way switch's thumb slides to the chosen side, and does not under reduced motion.
for (const motion of ["no-preference", "reduce"] as const) test(`kit switch slide ${motion}`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: motion });
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl.replace(/\/$/u, "")}/kit.html`, { waitUntil: "domcontentloaded" });
  const group = page.getByRole("group", { name: "Theme" });
  const thumb = group.locator("span[aria-hidden]").first();
  await group.scrollIntoViewIfNeeded();
  const offset = () => thumb.evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).m41);
  expect(await offset()).toBe(0);
  await group.getByText("Dark", { exact: true }).click();
  await page.waitForTimeout(70);
  const middle = await offset();
  await page.screenshot({ path: join(OUT, `kit-switch-${motion}-mid-${WIDTH}.png`), clip: await group.boundingBox() ?? undefined });
  await page.waitForTimeout(400);
  const end = await offset();
  expect(end).toBeGreaterThan(20);
  if (motion === "reduce") expect(middle).toBe(end);
  else { expect(middle).toBeGreaterThan(0); expect(middle).toBeLessThan(end); }
  await page.screenshot({ path: join(OUT, `kit-switch-${motion}-end-${WIDTH}.png`), clip: await group.boundingBox() ?? undefined });
  expect(errors).toEqual([]);
});

// Enter continues in the Run dialog (starts on the last step unless disabled); Shift+Enter keeps its newline in a textbox.
test("run dialog keys", async ({ page }) => {
  const launchServer = await startSeparationsStartServer();
  try {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    await page.goto(`${launchServer.baseUrl}/?day=${launchServer.day}&statusMock=run-options`);
    await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Separations", exact: true }).last().click();
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
    const box = dialog.getByRole("textbox").first();
    await expect(dialog.getByText("Enter to continue")).toHaveCount(0);
    // Disabled (nothing typed yet): Enter does nothing and the textbox keeps its content.
    await box.press("Enter");
    await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
    await box.fill("10555001");
    await box.press("Shift+Enter");
    await box.pressSequentially("10000002");
    await expect(box).toHaveValue("10555001\n10000002");
    await expect(dialog.getByText("Enter to continue")).toBeVisible();
    await box.press("Enter");
    await expect(currentLaunchStage(dialog, "2 Options")).toBeVisible();
    await expect(dialog.getByRole("button", { name: START })).toHaveCount(0);
    await expect(dialog.getByText("Enter to continue")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(currentLaunchStage(dialog, "3 Checks")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    await expect(dialog.getByText("Enter to start")).toBeVisible();
    await expect(dialog.getByRole("button", { name: START })).toBeEnabled();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await launchServer.close();
  }
});

// Priority follows the run's size (ticked for one person, unticked for several) until the operator changes it; the footer names it only when ticked.
test("run dialog priority", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  for (const [workflow, text, ticked] of [["Separations", "48216", true], ["Separations", "48216; 48220", false], ["Person Lookup", "10000001", true], ["Person Lookup", "10000001; 10000002", false]] as const) {
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&statusMock=run-options`);
    await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: workflow, exact: true }).last().click();
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
    await dialog.getByRole("textbox").first().fill(text);
    await continueLaunch(dialog);
    const box = dialog.getByRole("switch", { name: "Priority", exact: true });
    const footer = dialog.locator("footer");
    await expect(box).toBeChecked({ checked: ticked });
    await expect(footer).not.toContainText(/Interactive|Bulk/);
    if (ticked) await expect(footer).toContainText("Priority"); else await expect(footer).not.toContainText("Priority");
    await box.dispatchEvent("click");
    await expect(box).toBeChecked({ checked: !ticked });
    if (ticked) await expect(footer).not.toContainText("Priority"); else await expect(footer).toContainText("Priority");
  }
  expect(errors).toEqual([]);
});

// Customize steps adds an enabled Steps stage before Checks for every workflow in the rail.
test("customize steps every workflow", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
  const reached: string[] = [];
  for (const name of ["Person Lookup", "Separations", "I-9 Check", "Onboarding", "Emergency Contact", "Work-Study"]) {
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&statusMock=run-options`);
    await rail.getByRole("button", { name, exact: true }).last().click();
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
    await expect(dialog.getByRole("list", { name: "Run configuration path" }), `${name}: redesigned dialog`).toBeVisible();
    const file = dialog.locator('input[type="file"]');
    if (await file.count()) await file.setInputFiles(SCAN);
    else if (name === "Work-Study") {
      await dialog.getByRole("textbox", { name: "Effective date", exact: true }).fill("08/03/2026");
      await dialog.getByRole("textbox", { name: "Employee IDs", exact: true }).fill("10000001");
    } else if (name !== "Onboarding") await dialog.getByRole("textbox").first().fill(name === "Separations" ? "48216" : "10000001");
    if (name === "Onboarding" || name === "Emergency Contact" || name === "I-9 Check") await chooseRoster(page, dialog, ROSTERS[name]);
    if (name === "Onboarding") {
      await dialog.getByText("New hire", { exact: true }).click();
      await dialog.getByRole("checkbox", { name: /hire@example\.test/u }).check();
    }
    await continueLaunch(dialog);
    if (name === "Emergency Contact") await dialog.getByText("Do not file", { exact: true }).click();
    const customize = dialog.getByRole("switch", { name: "Customize steps", exact: true });
    await expect(customize, `${name}: Customize steps`).toBeVisible();
    await customize.dispatchEvent("click");
    const stepsTab = dialog.getByRole("button", { name: "3 Steps", exact: true });
    await expect(stepsTab, `${name}: Steps is ahead of Options`).toBeDisabled();
    await expect(dialog.getByRole("button", { name: START }), `${name}: Options only continues`).toHaveCount(0);
    await continueLaunch(dialog);
    await expect(currentLaunchStage(dialog, "3 Steps")).toBeVisible();
    await expect(stepsTab, `${name}: selected Steps tab`).toBeEnabled();
    await expect(dialog.getByText(/\d+ of \d+ included/), `${name}: Steps step`).toBeVisible();
    await expect(dialog.getByRole("button", { name: START }), `${name}: Steps only continues`).toHaveCount(0);
    await continueLaunch(dialog);
    await expect(currentLaunchStage(dialog, "4 Checks")).toBeVisible();
    await expect(dialog.getByRole("button", { name: START }), `${name}: start on Checks`).toBeEnabled();
    reached.push(name);
  }
  expect(reached).toEqual(["Person Lookup", "Separations", "I-9 Check", "Onboarding", "Emergency Contact", "Work-Study"]);
  expect(errors).toEqual([]);
});

// The Input step of every workflow's Run dialog, light and dark.
for (const theme of THEMES) test(`run input every workflow @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
  for (const name of ["Person Lookup", "Separations", "I-9 Check", "Onboarding", "Emergency Contact", "Work-Study"]) {
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&statusMock=run-options`);
    await page.addStyleTag({ content: ".hub-assistant-launcher { display: none !important; }" });
    await rail.getByRole("button", { name, exact: true }).last().click();
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
    await expect(dialog.getByRole("list", { name: "Run configuration path" })).toBeVisible();
    await settle(page);
    await page.screenshot({ path: join(OUT, `run-input-${name.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}-${theme}-${WIDTH}.png`) });
  }
  expect(errors).toEqual([]);
});

// The shared search field on the kit page: a 34px pill, and the 28px size inside a dropdown menu.
test(`kit search ${WIDTH}`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl.replace(/\/$/u, "")}/kit.html`, { waitUntil: "domcontentloaded" });
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate(value => { for (const el of [document.documentElement, document.body]) { el.setAttribute("data-demo-theme", value); el.classList.toggle("dark", value === "dark"); } }, theme);
    const field = page.getByRole("searchbox", { name: "Search the specimen" });
    await field.scrollIntoViewIfNeeded();
    expect(await field.evaluate(node => Math.round(node.closest('[data-slot="search-field-group"]')?.getBoundingClientRect().height ?? 0))).toBe(32);
    expect(await page.getByRole("button", { name: "Tags", exact: true }).evaluate(node => Math.round(node.getBoundingClientRect().height))).toBe(28);
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    const menuField = page.getByRole("searchbox", { name: "Find a tag" });
    await expect(menuField).toBeVisible();
    await page.waitForTimeout(500);
    expect(Math.abs(await menuField.evaluate(node => node.closest('[data-slot="search-field-group"]')?.getBoundingClientRect().height ?? 0) - 28)).toBeLessThanOrEqual(1);
    await page.mouse.move(1, 1);
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `kit-search-${theme}-${WIDTH}.png`) });
    await page.keyboard.press("Escape");
  }
  expect(errors).toEqual([]);
});

// The one menu style on the kit page (plain, icons, sections, two-line) and the one row size, light and dark.
test(`kit menus and rows ${WIDTH}`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl.replace(/\/$/u, "")}/kit.html`, { waitUntil: "domcontentloaded" });
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate(value => { for (const el of [document.documentElement, document.body]) { el.setAttribute("data-demo-theme", value); el.classList.toggle("dark", value === "dark"); } }, theme);
    for (const name of ["Plain list", "With icons", "With sections", "Two-line items"]) {
      const trigger = page.getByRole("button", { name, exact: true });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      await expect(page.getByRole("menu")).toBeVisible();
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(OUT, `kit-menu-${name.toLowerCase().replace(/\W+/gu, "-")}-${theme}-${WIDTH}.png`) });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toBeHidden();
    }
    const rows = page.getByRole("region", { name: "One-line and two-line rows" });
    await rows.scrollIntoViewIfNeeded();
    await page.mouse.move(1, 1);
    await page.screenshot({ path: join(OUT, `kit-rows-${theme}-${WIDTH}.png`) });
  }
  expect(errors).toEqual([]);
});

// Every Settings page, to audit that they share the row tokens.
for (const theme of THEMES) test(`settings pages @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  for (const id of ["general", "activity", "keyboard"]) {
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=${id}${id === "general" ? "&statusMock=general-a" : id === "activity" ? "" : "&statusMock=general-a"}`);
    await expect(page.getByRole("navigation", { name: "Settings sections", exact: true })).toBeVisible();
    await page.addStyleTag({ content: ".hub-assistant-launcher { display: none !important; }" });
    await settle(page);
    await page.screenshot({ path: join(OUT, `settings-${id}-${theme}-${WIDTH}.png`) });
    const scroller = page.locator("#dashboard-settings-content");
    if (await scroller.evaluate(node => node.scrollHeight - node.clientHeight > 8)) {
      await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `settings-${id}-${theme}-${WIDTH}-more.png`) });
    }
  }
  expect(errors).toEqual([]);
});

// Analytics states: the open Workflows row, both toolbar menus, and the hover card on every chart (the Assistant charts after scrolling to each).
for (const theme of THEMES) test(`analytics states @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await useAnalyticsSampleClock(page);
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=activity`);
  await expect(page.getByRole("heading", { name: "Runs", exact: true })).toBeVisible();
  const shot = async (name: string) => { await page.waitForTimeout(300); await page.screenshot({ path: join(OUT, `analytics-${name}-${theme}-${WIDTH}.png`) }); };
  const scroller = page.locator("#dashboard-settings-content");
  const scrollTo = (top: number) => scroller.evaluate((node, value) => { node.scrollTop = value; }, top);
  await shot("top");
  for (let top = 640, n = 1; n < 8; top += 640, n++) {
    await scrollTo(top);
    await shot(`page-${n}`);
    if (await scroller.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 2)) break;
  }
  await scrollTo(0);
  await page.getByRole("button", { name: /By workflow/ }).click();
  await shot("menu-workflow");
  await page.getByRole("menuitemradio", { name: "Separations" }).dispatchEvent("click");
  await expect(page.getByRole("button", { name: "Separations" }).first()).toBeVisible();
  await shot("filtered");
  await page.getByRole("button", { name: "Separations" }).first().click();
  await page.getByRole("menuitemradio", { name: "All workflows" }).dispatchEvent("click");
  const tip = page.locator(".ds-chart-tip");
  await page.getByRole("img", { name: /^Wed 23: Done/ }).hover();
  await expect(tip).toBeVisible();
  await shot("hover-runs");
  await page.mouse.move(1, 1);
  await expect(tip).toHaveCount(0);
  await page.getByRole("button", { name: "Show Separations details" }).click();
  await scrollTo(420);
  await shot("workflows-open");
  // Every chart: scroll it fully into view, hover a day and check the card stays inside its chart.
  const hoverChart = async (name: string, figure: string, day: RegExp) => {
    await page.getByRole("figure", { name: figure }).evaluate(node => node.scrollIntoView({ block: "center" }));
    await page.getByRole("img", { name: day }).hover();
    await expect(tip).toBeVisible();
    const inside = await tip.evaluate(node => { const box = node.getBoundingClientRect(), card = node.closest("figure")!.getBoundingClientRect(); return box.left >= card.left && box.right <= card.right && box.top >= card.top && box.bottom <= card.bottom; });
    expect(inside, `${name} card inside its chart`).toBe(true);
    await shot(`hover-${name}`);
    await page.mouse.move(1, 1);
  };
  // One period control drives every chart: 30d turns each into month days.
  await scrollTo(0);
  await page.getByRole("group", { name: "Report period" }).getByText("30d").click();
  await hoverChart("runs-30d", "Runs per day", /^Sep 23: Done/);
  await expect(tip).toHaveCount(0);
  await page.getByRole("group", { name: "Report period" }).getByText("7d").click();
  // Keyboard focus on a day shows the same card; arrow keys move on, Escape hides it.
  await page.getByRole("img", { name: /^Mon 21: Done/ }).focus();
  await expect(tip).toContainText("Sep 21, 2026");
  await page.keyboard.press("ArrowRight");
  await expect(tip).toContainText("Sep 22, 2026");
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Analytics frames: a period with no runs, and a workflow's runs opened from its row.
for (const theme of THEMES) test(`analytics empty and drilldown @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await useAnalyticsSampleClock(page);
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=activity`);
  await expect(page.getByRole("heading", { name: "Runs", exact: true })).toBeVisible();
  const shot = async (name: string) => { await page.waitForTimeout(300); await page.screenshot({ path: join(OUT, `analytics-${name}-${theme}-${WIDTH}.png`) }); };
  await page.getByRole("button", { name: "Previous period" }).click();
  await shot("empty");
  await page.getByRole("group", { name: "Report period" }).getByText("7d").click();
  await page.getByRole("button", { name: "Show Separations details" }).click();
  await page.getByRole("link", { name: "Open runs" }).click();
  await expect(page.getByRole("region", { name: "Analytics runs" })).toBeVisible();
  await shot("drilldown");
  expect(errors).toEqual([]);
});

// General's toggles and pickers on the mock fixtures; served Account controls are covered in settings-served-pages.test.ts.
test("general interactions", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=general&statusMock=general-a`);
  await expect(page.getByRole("group", { name: "General", exact: true })).toBeVisible();
  for (const name of ["Downloads", "Job end date", "Theme", "Animations", "Browser window"]) await expect(page.getByRole("group", { name: "General", exact: true }).getByText(name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Run without a browser window")).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Full access" })).toBeVisible();
  await expect(page.getByText("Default permissions")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change Downloads", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

// Under any statusMock, every sidebar page shows its mock design; old and new links resolve.
test("sidebar click-through shows the mock pages", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await serveSettings(page, "dark");
  await useAnalyticsSampleClock(page);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&statusMock=general-a`);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const nav = page.locator("nav.settings-panel-nav");
  const marks: Record<string, () => Promise<void>> = {
    General: () => expect(page.getByRole("group", { name: "General", exact: true }).getByText("Browser window", { exact: true })).toBeVisible(),
    Account: () => expect(page.getByRole("group", { name: "Relay account", exact: true })).toBeVisible(),
    Spreadsheets: () => expect(page.getByRole("region", { name: "Spreadsheets", exact: true })).toBeVisible(),
    Explorer: () => expect(page.locator("#dashboard-settings-content")).toBeVisible(),
    Analytics: () => expect(page.getByRole("heading", { name: "Runs", exact: true })).toBeVisible(),
    Keyboard: () => expect(page.getByRole("searchbox", { name: "Search shortcuts" })).toBeVisible(),
  };
  for (const [name, check] of Object.entries(marks)) {
    await nav.getByRole("link", { name, exact: true }).click();
    await check();
    await expect(page.getByText("No such settings section")).toHaveCount(0);
  }
  for (const id of ["account", "credentials", "subscription", "spreadsheets", "activity"]) {
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=${id}&statusMock=general-a`);
    await expect(nav).toBeVisible();
    await expect(page.getByText("No such settings section")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

// Logs footer states: waiting for review (Records) and failed (Rerun), with the footer tooltips; the old assistant launcher is hidden so the footer's right group shows.
for (const theme of THEMES) test(`logs footer states @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  const logs = page.locator(".dashboard-log-column");
  const shot = async (name: string) => { await settle(page); await page.screenshot({ path: join(OUT, `${name}-${theme}-${WIDTH}.png`) }); };
  const review = await startOcrSweepServer("review");
  try {
    await page.goto(`${review.baseUrl}/?fixture=product-workflows&day=${review.day}&run=${review.ocrRunId}&assistantOpen=0`);
    const records = logs.getByRole("button", { name: "Records 1", exact: true });
    await expect(records).toBeVisible();
    await shot("logs-waiting");
    await records.hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, `logs-waiting-tooltip-${theme}-${WIDTH}.png`) });
  } finally {
    await page.goto("about:blank");
    await review.close();
  }
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&notificationsPreview=centre&assistantOpen=0`);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.locator(".notification-panel").getByRole("button", { name: /Run failed/ }).click();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(logs.getByRole("button", { name: "Rerun", exact: true })).toBeVisible();
  await shot("logs-failed");
  await logs.getByRole("button", { name: "Rerun", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `logs-failed-tooltip-${theme}-${WIDTH}.png`) });
  expect(errors).toEqual([]);
});

// Sidebar collapse: the queue column keeps --ds-w-queue-column and the Logs column takes every freed pixel.
for (const theme of THEMES) test(`sidebar collapse widens logs @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&notificationsPreview=centre&assistantOpen=0`);
  await page.getByRole("button", { name: "Emergency Contact" }).first().click();
  await page.locator(".dashboard-queue-column").getByText("Earlier Emergency Contact run", { exact: true }).click();
  const width = (selector: string) => page.locator(selector).evaluate(node => Math.round(node.getBoundingClientRect().width));
  await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible();
  await settle(page);
  const expanded = { queue: await width(".dashboard-queue-column"), logs: await width(".dashboard-log-column") };
  await page.screenshot({ path: join(OUT, `sidebar-expanded-${theme}-${WIDTH}.png`) });
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  await settle(page);
  const collapsed = { queue: await width(".dashboard-queue-column"), logs: await width(".dashboard-log-column") };
  await page.screenshot({ path: join(OUT, `sidebar-collapsed-${theme}-${WIDTH}.png`) });
  expect(collapsed.queue).toBe(expanded.queue);
  expect(collapsed.logs - expanded.logs).toBe(312 - 56);
  expect(errors).toEqual([]);
});

// Banner audit: command results that used to be inline strips above the columns are sticky toasts; the bulk result opens in a dialog.
for (const theme of THEMES) test(`command result toasts @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&statusMock=command-results&assistantOpen=0`);
  const queueTop = () => page.locator(".dashboard-log-column").evaluate(node => Math.round(node.getBoundingClientRect().top));
  const toasts = page.locator("[data-slot=toast]");
  await expect(toasts).toHaveCount(3);
  // Toasts float over the shell: the log column keeps its 12px gutter.
  expect(await queueTop()).toBe(12);
  await settle(page);
  await page.screenshot({ path: join(OUT, `command-results-toasts-${theme}-${WIDTH}.png`) });
  await expect(toasts.locator("button")).toHaveCount(0);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.locator(".notification-panel");
  await expect(panel.getByText("Retry: partial result")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: join(OUT, `command-results-notifications-${theme}-${WIDTH}.png`) });
  await panel.getByRole("button", { name: /Retry: partial result/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await settle(page);
  const gap = await page.getByRole("dialog").evaluate(node => Math.round(node.querySelector("[data-queue-bulk-result] button")!.getBoundingClientRect().top - document.getElementById(node.getAttribute("aria-describedby")!)!.getBoundingClientRect().bottom));
  expect(gap).toBe(16);
  await page.screenshot({ path: join(OUT, `command-results-review-${theme}-${WIDTH}.png`) });
  expect(errors).toEqual([]);
});

// A lost command response is a sticky toast that only notifies; its Priority notification opens the recovery review.
for (const theme of THEMES) test(`command unknown toast @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&statusMock=command-unknown&assistantOpen=0`);
  const toast = page.locator("[data-slot=toast]");
  await expect(toast).toHaveCount(1);
  await expect(toast.locator("button")).toHaveCount(0);
  await settle(page);
  await page.screenshot({ path: join(OUT, `command-unknown-toast-${theme}-${WIDTH}.png`) });
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.locator(".notification-panel");
  await expect(panel.getByText("Pause all: outcome unknown")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: join(OUT, `command-unknown-notification-${theme}-${WIDTH}.png`) });
  await panel.getByRole("button", { name: /Pause all: outcome unknown/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(errors).toEqual([]);
});

// Logs cards: identity review, held and failure cards, image viewer, batch member Logs.
const LOGS_OUT = process.env.LOGS_CARDS_OUT ?? OUT;
const LOGS_ONLY = process.env.LOGS_CARDS_ONLY?.split(",");
const LOGS_HEIGHT = Number(process.env.LOGS_CARDS_HEIGHT ?? 1100);
for (const theme of THEMES) test(`logs cards @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: LOGS_HEIGHT });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&notificationsPreview=centre&assistantOpen=0`);
  const logs = page.locator(".dashboard-log-column");
  const shot = async (name: string) => { await settle(page); await page.screenshot({ path: join(LOGS_OUT, `${name}-${theme}-${WIDTH}.png`) }); };
  const wanted = (name: string) => LOGS_ONLY === undefined || LOGS_ONLY.includes(name);
  await page.getByRole("button", { name: "Person Lookup" }).first().click();
  const queue = page.locator(".dashboard-queue-column");
  const open = async (name: string | RegExp) => { await queue.getByText(name).first().click(); await page.waitForTimeout(400); };
  if (wanted("identity")) { await open("Waiting on identity review"); await shot("logs-identity"); }
  if (wanted("held")) { await open("EID 10333015"); await shot("logs-held"); }
  if (wanted("viewer")) {
    await open("EID 10333015");
    await logs.getByRole("button", { name: /Enlarge screenshot/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await shot("logs-viewer");
    await page.keyboard.press("Escape");
  }
  if (wanted("member")) {
    await open("EID 10480021");
    await expect(logs.getByRole("button", { name: "Pause EID 10480021" })).toBeVisible();
    await expect(logs.getByRole("button", { name: "Stop EID 10480021" })).toBeVisible();
    await shot("logs-member-running");
    await logs.getByRole("button", { name: "Stop EID 10480021" }).click();
    await expect(page.getByRole("alertdialog").or(page.getByRole("dialog"))).toBeVisible();
    await shot("logs-member-stop");
    await page.keyboard.press("Escape");
  }
  if (wanted("timeline")) {
    const stepButton = (state: string) => logs.locator(`nav[aria-label="Run timeline"] button[aria-label*="${state}"]`).first();
    const hoverFrame = async (name: string, state: string, run: string) => {
      await open(run);
      await stepButton(state).hover();
      await expect(page.getByRole("tooltip").first()).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(LOGS_OUT, `logs-step-${name}-${theme}-${WIDTH}.png`) });
      await page.mouse.move(1, 1);
    };
    await hoverFrame("done", "Completed", "EID 10333015");
    await hoverFrame("waiting", "Waiting", "EID 10333015");
    await hoverFrame("pending", "Upcoming", "EID 10480021");
    await logs.locator('nav[aria-label="Run timeline"] button').first().focus();
    await expect(page.getByRole("tooltip").first()).toBeVisible();
  }
  if (wanted("failed")) { await open("EID 10555001"); await shot("logs-failed"); }
  if (wanted("parked")) { await open("EID 10777012"); await shot("logs-parked"); }
  // Answered cards keep their content; the actions become one outcome line.
  const fresh = async (row: string) => {
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&notificationsPreview=centre&assistantOpen=0`);
    await page.getByRole("button", { name: "Person Lookup" }).first().click();
    await open(row);
  };
  const outcome = logs.locator("p[data-answered]");
  if (wanted("identity-approved")) {
    await fresh("Waiting on identity review");
    await logs.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(outcome).toContainText(/^Match approved · \d{1,2}:\d\d [AP]M · Alex Rivera$/u);
    await expect(logs.locator(".log-failed-field")).toContainText("Approved");
    await shot("logs-identity-approved");
  }
  if (wanted("identity-rejected")) {
    await fresh("Waiting on identity review");
    await logs.getByRole("button", { name: /Next step/ }).click();
    await page.getByRole("menuitemradio", { name: "Reject match" }).click();
    await logs.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(outcome).toContainText(/^Match rejected · /u);
    await expect(logs.locator(".log-failed-field")).toContainText("Rejected");
    await shot("logs-identity-rejected");
  }
  if (wanted("identity-cancelled")) {
    await fresh("Waiting on identity review");
    await logs.getByRole("button", { name: "Cancel run" }).click();
    await expect(outcome).toContainText(/^Run cancelled · /u);
    await shot("logs-identity-cancelled");
  }
  if (wanted("failed-retried")) {
    await fresh("EID 10555001");
    await logs.getByRole("button", { name: "Retry search" }).click();
    await expect(outcome).toContainText(/^Retried · /u);
    await shot("logs-failed-retried");
  }
  if (wanted("failed-cancelled")) {
    await fresh("EID 10555001");
    await logs.getByRole("button", { name: "Cancel run" }).click();
    await expect(outcome).toContainText(/^Run cancelled · /u);
    await shot("logs-failed-cancelled");
  }
  if (wanted("parked-confirmed")) {
    await fresh("EID 10777012");
    await logs.getByRole("button", { name: /Answer$/ }).click();
    await page.getByRole("menuitemradio", { name: "Saved in UCPath" }).click();
    await logs.getByLabel("Transaction number").fill("T00000417");
    await logs.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(outcome).toContainText(/^Transaction confirmed · T00000417 · /u);
    await shot("logs-parked-confirmed");
  }
  expect(errors).toEqual([]);
});
