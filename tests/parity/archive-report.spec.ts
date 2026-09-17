import { ensureParityBundle,PARITY_DIST_DIR } from "./helpers/bundle.js";
/** H's isolated saved-document browser proof; never uses live database state. */
import { expect,test,type Page } from "@playwright/test";
import { join } from "node:path";
import { gotoAppState } from "./helpers/app-driver.js";
import { assertThemeApplied,captureParityPair,installTheme,PARITY_THEMES } from "./helpers/capture.js";
import { H_REPORT } from "./helpers/fixture-archive-report.js";
import { startFixtureServer,type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
let server: FixtureServer;
const second = { ...H_REPORT, runId: "00000000-0000-4000-8000-000000000083", title: "Second saved report" };
const digest = H_REPORT.files[0].digest;
const download = `/artifacts/v1/archive/${H_REPORT.runId}/files/${digest}`;
test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" },
    savedArchiveFileResponse:(runId,requestedDigest)=>runId===H_REPORT.runId&&requestedDigest===digest
      ?new Response("synthetic receipt",{headers:{"content-type":"text/plain","content-disposition":'attachment; filename="synthetic.txt"'}})
      :new Response("unknown fixture member",{status:404}) });
});
test.afterAll(async () => { await server?.close(); });
async function routes(page: Page) {
  await page.route("**/api/v1/archive/reports?*", route => route.fulfill({ json: { items: [H_REPORT, second], next: null } }));
  await page.route("**/api/v1/archive/reports/*", route => route.fulfill({ json: route.request().url().endsWith(second.runId) ? second : H_REPORT }));
  await page.route("**/api/v1/archive/reports/*/files/*", route => route.fulfill({ json: { runId: H_REPORT.runId, digest, resource: { state: "available", downloadUrl: download } } }));
}
for (const viewport of [{ width: 1024, height: 720 }, { width: 1440, height: 900 }]) for (const theme of PARITY_THEMES) {
  test(`saved report ${viewport.width} ${theme.attribute}`, async ({ page }) => {
    await page.setViewportSize(viewport); await installTheme(page, theme); await routes(page);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: H_REPORT.runId });
    await assertThemeApplied(page, theme);
    await expect(page.getByRole("link", { name: "Synthetic receipt.txt" })).toHaveAttribute("href", download);
    await expect(page.getByRole("article")).toContainText("Captured approval");
    await expect(page.getByRole("button", { name: /Relaunch|Restart|Retry/ })).toHaveCount(0);
    await captureParityPair(page, join(import.meta.dirname, "references"), { stateId: "archive-report-saved", viewport: `${viewport.width}x${viewport.height}`, theme: theme.name, adapter: "fixture", fixtureId: "H retained document without live workflow", descriptorHash: FIXTURE_DESCRIPTOR_HASH, appVersion: FIXTURE_APP_VERSION, capturedAt: "2026-09-10T00:00:00.000Z", variant: "default" });
    const panels = await page.locator('[aria-label="Saved reports"], [aria-label="Selected saved report"]').evaluateAll(nodes => nodes.filter(n => n.tagName !== "TABLE").map(n => { const r = n.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width }; }));
    expect(panels).toHaveLength(2); expect(panels[0].right).toBeLessThanOrEqual(panels[1].x); expect(panels.every(p => p.width > 0)).toBe(true);
    await page.getByRole("button", { name: "Second saved report", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("article")).toContainText("Second saved report");
    await page.getByRole("textbox", { name: "Workflow", exact: true }).focus(); await page.keyboard.type("removed-workflow");
    await expect(page.getByRole("article")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters" }).focus(); await page.keyboard.press("Enter");
    await page.getByRole("button", { name: H_REPORT.title, exact: true }).click();
    await expect(page.getByRole("article")).toContainText(H_REPORT.title);
    await page.evaluate(() => { document.documentElement.style.zoom = "1.25"; });
    await expect(page.getByRole("button", { name: "Delete saved report", exact: true })).toBeVisible();
    await captureParityPair(page, join(import.meta.dirname, "references"), { stateId: "archive-report-zoom", viewport: `${viewport.width}x${viewport.height}`, theme: theme.name, adapter: "fixture", fixtureId: "H retained document without live workflow", descriptorHash: FIXTURE_DESCRIPTOR_HASH, appVersion: FIXTURE_APP_VERSION, capturedAt: "2026-09-10T00:00:00.000Z", variant: "125-percent" });
  });
}
test("honest loading, empty, error, missing, deleted, unavailable and attachment refusal", async ({ page }) => {
  await routes(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/archive/reports?*", async route => { await waiting; await route.fulfill({ json: { items: [], next: null } }); });
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: H_REPORT.runId });
  await expect(page.getByText("Loading saved reports…", { exact: true })).toBeVisible(); release();
  await expect(page.getByText("No saved reports match this query.")).toBeVisible();
  await page.route("**/api/v1/archive/reports?*", route => route.abort("failed"));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator('[role="alert"]')).toBeVisible();
  for (const state of ["missing", "unavailable"]) {
    await page.route("**/api/v1/archive/reports/*", route => route.fulfill({ json: { state, runId: H_REPORT.runId, reason: "Served retained-state reason" } }));
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText(`Report ${state}: Served retained-state reason`)).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
  }
  await page.route("**/api/v1/archive/reports/*", route => route.fulfill({ json: {
    state: "deleted", runId: H_REPORT.runId, reason: "Served retained-state reason",
    deletion: { state: "deleted", runId: H_REPORT.runId, deletedAt: "2026-09-10T00:00:00.000Z",
      removed: [{ table: "workflow_runs", rows: 1 }], cleanup: { state: "pending", fileCount: 1 },
      command: { state: "unavailable", reason: "Historical request metadata absent." } },
  } }));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("region", { name: "Saved report deletion status" })).toContainText("Historical request metadata absent.");
  await expect(page.getByRole("article")).toHaveCount(0);
  await routes(page);
  await page.route("**/api/v1/archive/reports/*/files/*", route => route.fulfill({ json: { runId: H_REPORT.runId, digest, resource: { state: "available", downloadUrl: "https://example.invalid/foreign" } } }));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("article").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("link", { name: "Synthetic receipt.txt" })).toHaveCount(0);
});
test("late old detail cannot replace the selected report; valid file downloads", async ({ page }) => {
  await routes(page);
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/v1/archive/reports/${H_REPORT.runId}`, async route => { await waiting; await route.fulfill({ json: H_REPORT }); });
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: H_REPORT.runId });
  await expect(page.getByText("Loading saved report…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: second.title, exact: true }).click(); await expect(page.getByRole("article")).toContainText(second.title);
  const oldResponse = page.waitForResponse(response => response.url().endsWith(`/reports/${H_REPORT.runId}`));
  release(); await oldResponse; await expect(page.getByRole("article")).toContainText(second.title);
  await page.getByRole("button", { name: H_REPORT.title, exact: true }).click();
  await expect(page.getByRole("article")).toContainText(H_REPORT.title);
  const downloaded = page.waitForEvent("download"); await page.getByRole("link", { name: "Synthetic receipt.txt" }).click();
  expect((await downloaded).suggestedFilename()).toBe("synthetic.txt");
});
