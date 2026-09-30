import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { ensureParityBundle } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startOperationAuthorityServer } from "./helpers/fixture-operation-authority.js";

test.use({ viewport: { width: 1440, height: 1000 } });

for (const theme of PARITY_THEMES) {
  const evidenceName = `shared-operation-${theme.name}.a11y.yml`;
  test(`shared separation forms, confirmation sources and template preview @ ${theme.name}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidenceName }],
  }, async ({ page }) => {
    ensureParityBundle();
    const server = await startOperationAuthorityServer("separation");
    try {
      await installTheme(page, theme);
      await gotoAppState(page, server.baseUrl, { day: server.day, run: server.runId, section: "logs" });
      const more = page.getByRole("button", { name: "Load more lines", exact: true });
      while (await more.count() > 0) await more.click();
      await expect(page.locator(".operation-observed-row")).toHaveCount(37);
      await expect(page.getByRole("tab", { name: "Receipt", exact: true })).toHaveCount(0);
      const computation = page.locator(".operation-observed-group").filter({ has: page.getByRole("heading", { name: "Reconcile dates", exact: true }) });
      await expect(computation.locator(".lucide-cpu")).toHaveCount(5);
      await expect(computation.locator(".operation-form-header, .operation-read-footer")).toHaveCount(0);
      expect(await computation.locator(".operation-observed-body").evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
      const origin = page.getByRole("button", { name: "Step ucpath · fictional.comments", exact: true }).first();
      const response = page.waitForResponse((item) => item.url().includes("/operation-source?") && item.status() === 200);
      await origin.click();
      await response;
      await page.getByRole("button", { name: "Go to field in logs", exact: true }).click();
      const source = page.locator('[data-operation-highlight="true"]');
      await expect(source).toHaveCount(1);
      await expect(source).toBeFocused();
      expect(await source.getAttribute("id")).toContain("read-staged-comments");
      await page.keyboard.press("Escape");
      await expect(origin).toBeFocused();
      await expect(source).toHaveCount(0);
      await page.getByRole("button", { name: "Explorer", exact: true }).click();
      await page.getByRole("button", { name: "Collapse all", exact: true }).click();
      const outcome = page.getByRole("combobox", { name: "Transactions in Progress declared result", exact: true });
      await expect(outcome).toBeVisible();
      await outcome.selectOption("unknown");
      await expect(page.getByText("Preview stops here", { exact: true })).toBeVisible();
      expect(await page.locator('[data-operation-muted="true"]').count()).toBeGreaterThan(0);
      await outcome.selectOption("none");
      await expect(page.getByRole("button", { name: "Continue at termination", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Expand all", exact: true }).click();
      await page.locator(".operation-template").first().locator("summary").click();
      for (const [variable, value] of Object.entries({ effective: "09/26/2026", "last-day": "09/25/2026", holiday: "09/25/2026", document: "SIM-48216" })) {
        await page.getByRole("textbox", { name: `Comments preview ${variable}`, exact: true }).fill(value);
      }
      const preview = page.locator(".operation-template-preview").first();
      await expect(preview).toContainText("Termination eff 09/26/2026. Last Day Worked 09/25/2026. Holiday Pay on 09/25/2026. Kuali form #SIM-48216.");
      await page.getByRole("textbox", { name: "Comments preview holiday", exact: true }).fill("");
      await expect(preview).toContainText("Termination eff 09/26/2026. Last Day Worked 09/25/2026. Kuali form #SIM-48216.");
      await expect(preview).not.toContainText("Holiday Pay");
      const tree = await page.locator("body").ariaSnapshot();
      test.info().annotations.push({ type: `a11y-attachment-sha256:${evidenceName}`, description: createHash("sha256").update(tree).digest("hex") });
      await test.info().attach(evidenceName, { body: tree, contentType: "text/yaml" });
    } finally { await server.close(); }
  });
}

test("nested child source stays in its exact retained context and returns focus", async ({ page }) => {
  ensureParityBundle();
  const server = await startOperationAuthorityServer();
  try {
    await gotoAppState(page, server.baseUrl, { day: server.day, run: server.runId, section: "logs" });
    const origin = page.getByRole("button", { name: "Transform child-summary · text", exact: true });
    await origin.click();
    await expect(page.getByText(/Source run · .* · child evidence/u)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Input [123]$/u })).toHaveCount(3);
    await page.getByRole("button", { name: "Go to field in source", exact: true }).click();
    const source = page.getByRole("dialog").locator('[data-operation-highlight="true"]');
    await expect(source).toBeFocused();
    const identity = await source.evaluate((element) => JSON.parse(decodeURIComponent(element.id.slice("operation-".length))) as { runId: string; childInvocation: { edgeId: string } });
    expect(identity.runId).not.toBe(server.runId);
    expect(identity.childInvocation.edgeId).toBe("plan1-nested");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(origin).toBeFocused();
  } finally { await server.close(); }
});

test("ambiguous separation remains held before staging without an invented approval", async ({ page }) => {
  ensureParityBundle();
  const server = await startOperationAuthorityServer("separation-ambiguous");
  try {
    await gotoAppState(page, server.baseUrl, { day: server.day, run: server.runId, section: "logs" });
    const decision = page.getByRole("group", { name: "Decision — Resolve conflicting separation dates", exact: true });
    await expect(decision).toContainText("The run is held here");
    await expect(decision).toContainText("Resolution evidence");
    await expect(decision).toContainText("Unavailable");
    await expect(page.getByText(/Explicit operator confirmation is required before staging/u)).toBeVisible();
    await expect(page.locator(".operation-fill-row")).toHaveCount(0);
    await expect(decision.getByRole("button", { name: /approve|confirm/iu })).toHaveCount(0);
  } finally { await server.close(); }
});

test("failed reload exposes its stored effect and safe replay evidence", async ({ page }) => {
  ensureParityBundle();
  const server = await startOperationAuthorityServer("separation-failed");
  try {
    await gotoAppState(page, server.baseUrl, { day: server.day, run: server.runId, section: "logs" });
    const failure = page.getByRole("group", { name: /^Failure record — /u });
    await expect(failure).toContainText("DOCUMENT_READ_TIMEOUT");
    await expect(failure).toContainText("This run wrote nothing — no write was attempted.");
    await expect(failure).toContainText("What is safe to retry");
    await expect(failure).toContainText("Retry once the underlying condition clears");
    await expect(failure).toContainText("attempt 1");
    await expect(page.getByRole("heading", { name: /failed/iu })).toHaveCount(0);
  } finally { await server.close(); }
});
