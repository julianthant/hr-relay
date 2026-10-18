import { createHash } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { fixtureSettingsDocument } from "./helpers/fixture-settings.js";

async function sectionWarning(page: Page, title: string, groupName: string) {
  const warning = page.getByText(title, { exact: true });
  await expect(warning).toBeVisible();
  const layout = await warning.evaluate(node => {
    const banner = node.closest<HTMLElement>('[role="alert"],[role="status"]');
    if (!banner) throw new Error("settings-warning-banner-missing");
    const section = banner.closest(".ds-body-section");
    const rect = banner.getBoundingClientRect();
    const style = getComputedStyle(banner);
    return { nested: banner.closest(".ds-form-group") !== null, inSection: section !== null,
      x: rect.x, y: rect.y, width: rect.width, bottom: rect.bottom, padding: Number.parseFloat(style.paddingLeft),
      cozy: Number.parseFloat(style.getPropertyValue("--ds-space-cozy")),
      gap: Number.parseFloat(style.getPropertyValue("--ds-space-heading-content")) };
  });
  expect(layout.nested).toBe(false); expect(layout.inSection).toBe(true);
  expect(layout.padding).toBe(layout.cozy);
  const group = page.getByRole("group", { name: groupName, exact: true });
  const box = await group.boundingBox(); expect(box).not.toBeNull();
  expect(Math.abs(box!.x - layout.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.width - layout.width)).toBeLessThanOrEqual(1);
  expect(box!.y - layout.bottom).toBeGreaterThanOrEqual(layout.gap - 1);
}
async function attach(page: Page, info: TestInfo, name: string) {
  const body = await page.locator("body").ariaSnapshot();
  info.annotations.push({ type: `a11y-attachment-sha256:${name}`, description: createHash("sha256").update(body).digest("hex") });
  await info.attach(name, { body, contentType: "text/yaml" });
}
for (const entry of [
  { section: "general", path: "**/api/v1/settings/chatgpt-account", title: "ChatGPT account unavailable", group: "ChatGPT account" },
  { section: "paths", path: "**/api/v1/settings/storage-relocation", title: "Runtime locations unavailable", group: "Runtime locations" },
  { section: "routes", path: "editable", title: "Onboarding roster URL unavailable", group: "SharePoint" },
]) test(`Settings warning slot and spacing for ${entry.section}`, { annotation: [{ type: "required-a11y-evidence", description: `settings-warning-${entry.section}.a11y.yml` }] }, async ({ page }, info) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  await page.setViewportSize({ width: 1280, height: 720 }); await installTheme(page, PARITY_THEMES[0]);
  if (entry.path === "editable") {
    const document = fixtureSettingsDocument();
    await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: { ...document, protectedSettings: { state: "unknown", rows: document.protectedSettings.rows, reason: "credential-store-unavailable" } } }));
  } else await page.route(entry.path, route => route.fulfill({ status: 503, json: { state: "error", code: "DASHBOARD_READ_FAILED", message: "Synthetic unavailable", retryable: true } }));
  try {
    await page.goto(`${server.baseUrl}/?settings=${entry.section}`);
    await sectionWarning(page, entry.title, entry.group);
    await attach(page, info, `settings-warning-${entry.section}.a11y.yml`);
  } finally { await server.close(); }
});

test("Settings relocation uncertainty keeps its action in the spaced section slot", { annotation: [{ type: "required-a11y-evidence", description: "settings-warning-relocation-uncertain.a11y.yml" }] }, async ({ page }, info) => {
  ensureParityBundle(); const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  await page.setViewportSize({ width: 1280, height: 720 }); await installTheme(page, PARITY_THEMES[0]);
  await page.route("**/api/v1/settings/path-picker", route => route.fulfill({ json: { state: "selected", field: "paths.stateRoot", path: "/tmp/set1-synthetic-state" } }));
  await page.route("**/api/v1/commands", route => route.abort("failed"));
  try {
    await page.goto(`${server.baseUrl}/?settings=paths`);
    await page.getByRole("button", { name: "Change Runtime state folder", exact: true }).click();
    await sectionWarning(page, "Plan write unconfirmed", "Runtime locations");
    await expect(page.getByRole("button", { name: "Retry exact attempt", exact: true })).toBeVisible();
    await attach(page, info, "settings-warning-relocation-uncertain.a11y.yml");
  } finally { await server.close(); }
});

test("Settings account command uncertainty uses the section slot", { annotation: [{ type: "required-a11y-evidence", description: "settings-warning-account-action.a11y.yml" }] }, async ({ page }, info) => {
  ensureParityBundle(); const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  await page.setViewportSize({ width: 1280, height: 720 }); await installTheme(page, PARITY_THEMES[0]);
  await page.route("**/api/v1/settings/chatgpt-account/sign-in", route => route.abort("failed"));
  try {
    await page.goto(`${server.baseUrl}/?settings=general`);
    await page.getByRole("button", { name: "Continue with ChatGPT", exact: true }).click();
    await sectionWarning(page, "ChatGPT account unavailable", "ChatGPT account");
    await attach(page, info, "settings-warning-account-action.a11y.yml");
  } finally { await server.close(); }
});
