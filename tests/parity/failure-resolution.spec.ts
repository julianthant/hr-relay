import { expect,test } from "@playwright/test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { gotoAppState } from "./helpers/app-driver.js";
import { ensureParityBundle,PARITY_DIST_DIR,PARITY_REPO_ROOT } from "./helpers/bundle.js";
import { assertThemeApplied,captureParityPair,installTheme,PARITY_THEMES } from "./helpers/capture.js";
import { startFailureResolutionServer } from "./helpers/fixture-failure-resolution.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";

for (const theme of PARITY_THEMES) test(`failure-resolution desktop ${theme.name}`, { annotation: [{ type: "required-a11y-evidence", description: `failure-resolution-${theme.name}.a11y.yml` }] }, async ({ page }) => {
  ensureParityBundle();
  const server = await startFailureResolutionServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  try {
    await page.setViewportSize({ width: 1024, height: 720 }); await installTheme(page, theme);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, run: server.runId, section: "logs" });
    await assertThemeApplied(page, theme);
    const mark = page.getByRole("button", { name: "Mark resolved", exact: true });
    await expect(mark).toBeVisible();
    const note = page.getByRole("textbox", { name: "Resolution note (optional)" });
    await note.fill("SYNTHETIC_PROTECTED_NOTE " + "long-follow-up-text ".repeat(20));
    await note.press("Tab"); await expect(mark).toBeFocused();
    expect(await mark.evaluate(node => node.matches(":focus-visible"))).toBe(true);
    server.pauseCommands(); await mark.press("Enter");
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect(page.getByRole("status").filter({ hasText: /^Unresolved$/u })).toBeVisible();
    server.releaseCommands();
    const reopen = page.getByRole("button", { name: "Reopen", exact: true });
    await expect(reopen).toBeVisible();
    await expect(page.getByText("Protected resolution note withheld.", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("SYNTHETIC_PROTECTED_NOTE");
    expect(server.exchanges().some(row => row.method === "POST" && row.status === 200)).toBe(true);
    await reopen.scrollIntoViewIfNeeded();
    await captureParityPair(page, join(PARITY_REPO_ROOT, "tests/parity/references"), {
      stateId: "failure-resolution-live", viewport: "1024x720", theme: theme.name, adapter: "actual-resolution-fixture-shell",
      fixtureId: "diagnostic-resolution", descriptorHash: FIXTURE_DESCRIPTOR_HASH, appVersion: FIXTURE_APP_VERSION,
      capturedAt: "2026-09-09T12:00:00.000Z", variant: "default",
    });
    const a11y = await page.locator("body").ariaSnapshot();
    expect(a11y).toContain("Problem follow-up");
    const a11yName = `failure-resolution-${theme.name}.a11y.yml`;
    test.info().annotations.push({ type: `a11y-attachment-sha256:${a11yName}`, description: createHash("sha256").update(a11y).digest("hex") });
    await test.info().attach(a11yName, { body: a11y, contentType: "text/yaml" });
    const png = test.info().outputPath("failure-resolution.png");
    await page.screenshot({ path: png, animations: "disabled" });
    await test.info().attach("failure-resolution.png", { path: png, contentType: "image/png" });
    const archiveId = server.captureArchive();
    expect((await server.externalAction("reopen")).state).toBe("applied");
    await expect(mark).toBeVisible({ timeout: 10000 });
    // Stale action: authority changes after the last read but before this command.
    server.pauseCommands(); await mark.click();
    expect((await server.externalAction("resolve", "external")).state).toBe("applied"); server.releaseCommands();
    await expect(page.getByText("The failure resolution changed. Refresh before trying again.", { exact: true })).toBeVisible();
    await expect(reopen).toBeVisible();
    server.failReads(true);
    await expect(page.getByText("Resolution could not be refreshed", { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(reopen).toBeDisabled(); server.failReads(false);
    await expect(reopen).toBeEnabled({ timeout: 10000 });
    // Desktop zoom retains the minimum canvas and wrapping instead of hiding controls.
    await page.evaluate(() => { document.documentElement.style.zoom = "1.25"; });
    await reopen.scrollIntoViewIfNeeded(); await expect(reopen).toBeVisible();
    const rect = await reopen.boundingBox(); expect(rect?.width).toBeGreaterThan(30);
    await page.screenshot({ path: test.info().outputPath(`failure-resolution-zoom-${theme.name}.png`) });
    await page.evaluate(() => { document.documentElement.style.zoom = ""; });
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: archiveId });
    await expect(page.getByText("Protected resolution note withheld.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Mark resolved|Reopen)$/u })).toHaveCount(0);
    const reads = server.reads(); await page.waitForTimeout(3300); expect(server.reads()).toBe(reads);
    await page.getByText("Problem follow-up", { exact: true }).scrollIntoViewIfNeeded();
    await captureParityPair(page, join(PARITY_REPO_ROOT, "tests/parity/references"), {
      stateId: "failure-resolution-archive", viewport: "1024x720", theme: theme.name, adapter: "captured-presentation-fixture",
      fixtureId: "diagnostic-resolution", descriptorHash: FIXTURE_DESCRIPTOR_HASH, appVersion: FIXTURE_APP_VERSION,
      capturedAt: "2026-09-09T12:00:00.000Z", variant: "default",
    });
  } finally { await server.close(); }
});
