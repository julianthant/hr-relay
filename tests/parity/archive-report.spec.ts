import { ensureParityBundle,PARITY_DIST_DIR } from "./helpers/bundle.js";
/** H's isolated saved-document browser proof; never uses live database state. */
import { expect,test,type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { SavedArchiveReportWireSchema } from "../../src/domain/dashboard/archive.js";
import { archiveCsvFields,archiveFieldRows } from "../../src/domain/dashboard/archive-export.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { assertThemeApplied,captureParityPair,installTheme,PARITY_THEMES } from "./helpers/capture.js";
import { H_REPORT } from "./helpers/fixture-archive-report.js";
import { startFixtureServer,type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
let server: FixtureServer;
const second = { ...H_REPORT, runId: "00000000-0000-4000-8000-000000000083", title: "Second saved report" };
const digest = H_REPORT.files[0].digest;
const download = `/artifacts/v1/archive/${H_REPORT.runId}/files/${digest}`;
const longEmployeeDocumentName = `Employee and document ${"Longname".repeat(12)}.pdf`;
const exportReport = SavedArchiveReportWireSchema.parse({
  ...H_REPORT,
  runId: "00000000-0000-4000-8000-000000000084",
  title: `Failed saved run for ${longEmployeeDocumentName}`,
  outcome: "failed",
  transferId: "00000000-0000-4000-8000-000000000085",
  itemId: `item-${"identity".repeat(8)}`,
  attempt: 2,
  runNumber: null,
  reportIntegrity: "verified",
  runtimeVersion: { state: "adopted", dashboard: { major: 4, minor: 1 }, workflow: { major: 6, minor: 2 } },
  sections: [
    { kind: "values", title: "Failure details", values: [
      { label: "Employee and document", value: longEmployeeDocumentName }, { label: "Empty string", value: "" },
      { label: "Zero count", value: 0 }, { label: "Submitted", value: false }, { label: "Missing value", value: null },
    ] },
    { kind: "table", title: "Retained results", columns: ["Document", "Result"], rows: [[longEmployeeDocumentName, "Failed"]] },
    { kind: "text", title: "Saved failure log", text: `Failure recorded for ${longEmployeeDocumentName}.` },
    { kind: "unavailable", title: "Old evidence", reason: "These bytes were not retained." },
  ],
  files: [{ ...H_REPORT.files[0], name: longEmployeeDocumentName, artifactIds: ["00000000-0000-4000-8000-000000000086"] }],
  versionChange: { ...H_REPORT.versionChange, changeId: "00000000-0000-4000-8000-000000000087" },
});
test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" },
    savedArchiveFileResponse:(runId,requestedDigest)=>runId===H_REPORT.runId&&requestedDigest===digest
      ?new Response("synthetic receipt",{headers:{"content-type":"text/plain","content-disposition":'attachment; filename="synthetic.txt"'}})
      :new Response("unknown fixture member",{status:404}) });
});
test.afterAll(async () => { await server?.close(); });
async function routes(page: Page, reports = [H_REPORT, second]) {
  const first = reports[0] ?? H_REPORT;
  await page.route("**/api/v1/archive/groups*", route => {
    const query = new URL(route.request().url()).searchParams;
    const matches = (!query.has("workflow") || query.get("workflow") === first.workflow)
      && (!query.has("search") || reports.some(report => report.title.toLowerCase().includes(query.get("search")?.toLowerCase() ?? "")));
    return route.fulfill({ json: { groups: matches ? [{ dashboardVersion: first.runtimeVersion?.dashboard ?? null, workflow: first.workflow,
      workflowVersion: first.runtimeVersion?.workflow ?? null, reportCount: reports.length, latestCompletedAt: first.completedAt }] : [] } });
  });
  await page.route("**/api/v1/archive/reports?*", route => route.fulfill({ json: { items: reports, next: null } }));
  await page.route("**/api/v1/archive/reports/*/files/*", route => {
    const pathname = new URL(route.request().url()).pathname;
    const runId = pathname.split("/").at(-3) ?? "";
    const fileDigest = pathname.split("/").at(-1) ?? "";
    const report = reports.find(item => item.runId === runId);
    const file = report?.files.find(item => item.digest === fileDigest);
    return route.fulfill({ json: report === H_REPORT && file?.digest === digest
      ? { runId, digest: fileDigest, resource: { state: "available", downloadUrl: download } }
      : { runId, digest: fileDigest, resource: { state: "missing", reason: "Synthetic bytes not retained for this report." } } });
  });
  await page.route("**/api/v1/archive/reports/*", route => {
    const runId = new URL(route.request().url()).pathname.split("/").at(-1);
    const report = reports.find(item => item.runId === runId);
    return report === undefined ? route.fulfill({ json: { state: "missing", runId, reason: "No fixture report for this run." } }) : route.fulfill({ json: report });
  });
}
for (const viewport of [{ width: 1024, height: 720 }, { width: 1440, height: 900 }]) for (const theme of PARITY_THEMES) {
  test(`saved report ${viewport.width} ${theme.attribute}`, async ({ page }) => {
    await page.setViewportSize(viewport); await installTheme(page, theme); await routes(page);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: H_REPORT.runId });
    await assertThemeApplied(page, theme);
    await page.getByRole("button", { name: "Retained files" }).click();
    await expect(page.getByRole("link", { name: "Download Synthetic receipt.txt" })).toHaveAttribute("href", download);
    await page.getByRole("button", { name: "Retained work" }).click();
    await expect(page.getByRole("article")).toContainText("Captured approval");
    await expect(page.getByRole("button", { name: /Relaunch|Restart|Retry/ })).toHaveCount(0);
    await captureParityPair(page, join(import.meta.dirname, "references"), { stateId: "archive-report-saved", viewport: `${viewport.width}x${viewport.height}`, theme: theme.name, adapter: "fixture", fixtureId: "H retained document without live workflow", descriptorHash: FIXTURE_DESCRIPTOR_HASH, appVersion: FIXTURE_APP_VERSION, capturedAt: "2026-09-10T00:00:00.000Z", variant: "default" });
    await expect(page.getByRole("heading", { name: H_REPORT.title, level: 1 })).toBeVisible();
    await page.getByRole("navigation", { name: "Archive path" }).getByRole("button", { name: H_REPORT.workflow }).click();
    await expect(page.getByRole("table", { name: `${H_REPORT.workflow} saved runs` })).toBeVisible();
    await page.getByRole("button", { name: /Second saved report/u }).click();
    await expect(page.getByRole("heading", { name: second.title, level: 1 })).toBeVisible();
    await page.getByRole("navigation", { name: "Archive path" }).getByRole("button", { name: "Archive" }).click();
    await page.getByRole("button", { name: H_REPORT.workflow }).click();
    await page.getByRole("textbox", { name: "Search all public archive fields" }).fill("does-not-match");
    await expect(page).toHaveURL(/does-not-match/u);
    await page.getByRole("button", { name: /Clear filters/ }).first().click();
    await expect(page.getByRole("textbox", { name: "Search all public archive fields" })).toHaveValue("");
    await page.getByRole("button", { name: new RegExp(H_REPORT.title,"u") }).click();
    await page.getByRole("button", { name: "Record details" }).click();
    await page.evaluate(() => { document.documentElement.style.zoom = "1.25"; });
    await expect(page.getByRole("button", { name: "Delete saved report", exact: true })).toBeVisible();
    await captureParityPair(page, join(import.meta.dirname, "references"), { stateId: "archive-report-zoom", viewport: `${viewport.width}x${viewport.height}`, theme: theme.name, adapter: "fixture", fixtureId: "H retained document without live workflow", descriptorHash: FIXTURE_DESCRIPTOR_HASH, appVersion: FIXTURE_APP_VERSION, capturedAt: "2026-09-10T00:00:00.000Z", variant: "125-percent" });
  });
}
for (const viewport of [{ width: 1024, height: 720 }, { width: 1440, height: 900 }]) for (const theme of PARITY_THEMES) {
  test(`workflow saved runs ${viewport.width} ${theme.attribute}`, async ({ page }) => {
    await page.setViewportSize(viewport); await installTheme(page, theme); await routes(page);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: "" });
    await page.getByRole("button", { name: H_REPORT.workflow }).click();
    await expect(page.getByRole("table", { name: `${H_REPORT.workflow} saved runs` })).toBeVisible();
    const exportButton = page.getByRole("button", { name: "Export workflow", exact: true });
    await expect(exportButton).toBeVisible();
    await exportButton.click();
    await expect(page.getByRole("button", { name: "JSON", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "CSV", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Done", { exact: true })).toHaveCount(0);
    await captureParityPair(page, join(import.meta.dirname, "references"), { stateId: "archive-workflow-runs", viewport: `${viewport.width}x${viewport.height}`, theme: theme.name, adapter: "fixture", fixtureId: "H retained document without live workflow", descriptorHash: FIXTURE_DESCRIPTOR_HASH, appVersion: FIXTURE_APP_VERSION, capturedAt: "2026-09-10T00:00:00.000Z", variant: "default" });
  });
}
test("workflow downloads include every served public field across the selection", {
  annotation: [{ type: "required-a11y-evidence", description: "archive-workflow-export.a11y.yml" }],
}, async ({ page }) => {
  await routes(page);
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: "" });
  await page.getByRole("button", { name: H_REPORT.workflow }).click();
  const jsonEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workflow", exact: true }).click();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const jsonDownload = await jsonEvent;
  const jsonPath = await jsonDownload.path(); expect(jsonPath).not.toBeNull();
  const records = JSON.parse(await readFile(jsonPath, "utf8")) as unknown[];
  expect(records).toHaveLength(2);
  expect(records[0]).toEqual(H_REPORT);
  const csvEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export workflow", exact: true }).click();
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  const csvDownload = await csvEvent;
  const csvPath = await csvDownload.path(); expect(csvPath).not.toBeNull();
  const csv = await readFile(csvPath, "utf8");
  expect(csv).toContain("sections[0].values[0].value");
  expect(csv).toContain("archiveFingerprint");
  expect(csv).not.toContain("sourceDigest");
  const a11yName = "archive-workflow-export.a11y.yml";
  const bodyTree = await page.locator("body").ariaSnapshot();
  expect(bodyTree).toContain("Version archives");
  test.info().annotations.push({ type: `a11y-attachment-sha256:${a11yName}`, description: createHash("sha256").update(bodyTree).digest("hex") });
  await test.info().attach(a11yName, { body: bodyTree, contentType: "text/yaml" });
});

test("selected saved run downloads the exact composed report as JSON and typed CSV", async ({ page }) => {
  await routes(page, [exportReport]);
  await page.setViewportSize({ width: 1024, height: 720 });
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: "" });
  await page.getByRole("button", { name: new RegExp(exportReport.workflow, "u") }).click();
  await page.getByRole("button", { name: exportReport.title, exact: true }).click();
  await expect(page.getByRole("heading", { name: exportReport.title, exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export run", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export workflow", exact: true })).toHaveCount(0);
  const jsonEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export run", exact: true }).click();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const jsonDownload = await jsonEvent;
  expect(jsonDownload.suggestedFilename()).toBe(`archive-${exportReport.runId}.json`);
  const jsonPath = await jsonDownload.path(); expect(jsonPath).not.toBeNull();
  expect(JSON.parse(await readFile(jsonPath, "utf8"))).toEqual(exportReport);

  const csvEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export run", exact: true }).click();
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  const csvDownload = await csvEvent;
  expect(csvDownload.suggestedFilename()).toBe(`archive-${exportReport.runId}.csv`);
  const csvPath = await csvDownload.path(); expect(csvPath).not.toBeNull();
  const csv = await readFile(csvPath, "utf8");
  const typedRows = archiveFieldRows([exportReport]);
  expect(csv).toBe(archiveCsvFields([exportReport]));
  expect(typedRows).toContainEqual([exportReport.runId, "sections[0].values[1].value", "string", ""]);
  expect(typedRows).toContainEqual([exportReport.runId, "sections[0].values[2].value", "number", "0"]);
  expect(typedRows).toContainEqual([exportReport.runId, "sections[0].values[3].value", "boolean", "false"]);
  expect(typedRows).toContainEqual([exportReport.runId, "sections[0].values[4].value", "null", "null"]);
  expect(typedRows.some(([, fieldPath]) => fieldPath === "publicationState")).toBe(false);
  expect(csv).not.toContain("sourceDigest");

  await page.getByRole("button", { name: "Retained results", exact: true }).click();
  const tableRegion = page.getByRole("region", { name: "Retained results" });
  await expect(tableRegion.getByRole("table", { name: "Retained results" })).toContainText(longEmployeeDocumentName);
  const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1);
});
test("honest loading, empty, error, missing, deleted, unavailable and attachment refusal", async ({ page }) => {
  await routes(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/archive/reports?*", async route => { await waiting; await route.fulfill({ json: { items: [], next: null } }); });
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: "" });
  await page.getByRole("button", { name: H_REPORT.workflow }).click();
  await expect(page.getByText("Loading saved reports…", { exact: true })).toBeVisible(); release();
  await expect(page.getByRole("cell").filter({ hasText: "No saved reports match this scope." })).toBeVisible();
  await page.route("**/api/v1/archive/reports?*", route => route.abort("failed"));
  await page.reload();
  await expect(page.locator('[role="alert"]')).toBeVisible();
  for (const state of ["missing", "unavailable"]) {
    await page.route("**/api/v1/archive/reports/*", route => route.fulfill({ json: { state, runId: H_REPORT.runId, reason: "Served retained-state reason" } }));
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: H_REPORT.runId });
    await expect(page.getByText(`Report ${state}: Served retained-state reason`)).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
  }
  await page.route("**/api/v1/archive/reports/*", route => route.fulfill({ json: {
    state: "deleted", runId: H_REPORT.runId, reason: "Served retained-state reason",
    deletion: { state: "deleted", runId: H_REPORT.runId, deletedAt: "2026-09-10T00:00:00.000Z",
      removed: [{ table: "workflow_runs", rows: 1 }], cleanup: { state: "pending", fileCount: 1 },
      command: { state: "unavailable", reason: "Historical request metadata absent." } },
  } }));
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: H_REPORT.runId });
  await expect(page.getByRole("region", { name: "Saved report deletion status" })).toContainText("Historical request metadata absent.");
  await expect(page.getByRole("article")).toHaveCount(0);
  await routes(page);
  await page.route("**/api/v1/archive/reports/*/files/*", route => route.fulfill({ json: { runId: H_REPORT.runId, digest, resource: { state: "available", downloadUrl: "https://example.invalid/foreign" } } }));
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: H_REPORT.runId });
  await page.getByRole("button", { name: "Retained files", exact: true }).click();
  await expect(page.getByRole("article").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download Synthetic receipt.txt" })).toHaveCount(0);
});
test("late old detail cannot replace the selected report; valid file downloads", async ({ page }) => {
  await routes(page);
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/v1/archive/reports/${H_REPORT.runId}`, async route => { await waiting; await route.fulfill({ json: H_REPORT }); });
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: "" });
  await page.getByRole("button", { name: new RegExp(H_REPORT.workflow, "u") }).click();
  await expect(page.getByRole("table", { name: `${H_REPORT.workflow} saved runs` })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(H_REPORT.title, "u") }).click();
  await expect(page.getByText("Loading saved report…", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Archive path" }).getByRole("button", { name: H_REPORT.workflow, exact: true }).click();
  await expect(page.getByRole("table", { name: `${H_REPORT.workflow} saved runs` })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(second.title,"u") }).click();
  await expect(page.getByRole("heading", { name: second.title, exact: true, level: 1 })).toBeVisible();
  const oldResponse = page.waitForResponse(response => response.url().endsWith(`/reports/${H_REPORT.runId}`));
  release(); await oldResponse; await expect(page.getByRole("heading", { name: second.title, exact: true, level: 1 })).toBeVisible();
  await page.getByRole("navigation", { name: "Archive path" }).getByRole("button", { name: H_REPORT.workflow }).click();
  await page.getByRole("button", { name: new RegExp(H_REPORT.title,"u") }).click();
  await page.getByRole("button", { name: "Retained files" }).click();
  await expect(page.getByRole("heading", { name: H_REPORT.title, exact: true, level: 1 })).toBeVisible();
  const downloaded = page.waitForEvent("download"); await page.getByRole("link", { name: "Download Synthetic receipt.txt" }).click();
  expect((await downloaded).suggestedFilename()).toBe("synthetic.txt");
});
