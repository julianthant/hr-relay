import { createHash } from "node:crypto";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { installServedSurfaces } from "./helpers/app-driver.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

async function sectionWarning(page: Page, title: string, groupName: string) {
  const warning = page.getByText(title, { exact: true });
  await expect(warning).toBeVisible();
  // Warnings are toasts, not section banners.
  await expect(page.getByRole("status").or(page.getByRole("alert")).filter({ hasText: title })).toHaveCount(1);
  await expect(page.getByRole("group", { name: groupName, exact: true })).toBeVisible();
}
async function attach(page: Page, info: TestInfo, name: string) {
  const body = await page.locator("body").ariaSnapshot();
  info.annotations.push({ type: `a11y-attachment-sha256:${name}`, description: createHash("sha256").update(body).digest("hex") });
  await info.attach(name, { body, contentType: "text/yaml" });
}
for (const entry of [
  { section: "general", path: "**/api/v1/settings/chatgpt-account", title: "ChatGPT account unavailable", group: "ChatGPT account" },
]) test(`Settings warning toast for ${entry.section}`, { annotation: [{ type: "required-a11y-evidence", description: `settings-warning-${entry.section}.a11y.yml` }] }, async ({ page }, info) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  await installServedSurfaces(page);
  await page.setViewportSize({ width: 1280, height: 720 }); await installTheme(page, PARITY_THEMES[0]);
  await page.route(entry.path, route => route.fulfill({ status: 503, json: { state: "error", code: "DASHBOARD_READ_FAILED", message: "Synthetic unavailable", retryable: true } }));
  try {
    await page.goto(`${server.baseUrl}/?settings=${entry.section}`);
    await sectionWarning(page, entry.title, entry.group);
    await attach(page, info, `settings-warning-${entry.section}.a11y.yml`);
  } finally { await server.close(); }
});

test("Settings account command uncertainty shows a toast", { annotation: [{ type: "required-a11y-evidence", description: "settings-warning-account-action.a11y.yml" }] }, async ({ page }, info) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  await installServedSurfaces(page);
  await page.setViewportSize({ width: 1280, height: 720 }); await installTheme(page, PARITY_THEMES[0]);
  await page.route("**/api/v1/settings/chatgpt-account/sign-in", route => route.abort("failed"));
  try {
    await page.goto(`${server.baseUrl}/?settings=general`);
    await page.getByRole("button", { name: "Connect ChatGPT", exact: true }).click();
    await sectionWarning(page, "ChatGPT account unavailable", "ChatGPT account");
    await attach(page, info, "settings-warning-account-action.a11y.yml");
  } finally { await server.close(); }
});
