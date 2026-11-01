import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { createHash } from "node:crypto";
import { gotoAppState } from "./helpers/app-driver.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { failOnPageErrors, registerReferenceServers } from "./helpers/reference-harness.js";

const servers = registerReferenceServers(["server"]);
const viewports = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1024x720", width: 1024, height: 720 },
] as const;

for (const viewport of viewports) for (const theme of PARITY_THEMES) test(`Performance settings @ ${theme.name} @ ${viewport.name}`, {
  annotation: [{ type: "required-a11y-evidence", description: `performance-settings-${theme.name}-${viewport.name}.a11y.yml` }],
}, async ({ page }, info) => {
  const errors = failOnPageErrors(page);
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await installTheme(page, theme);
  await gotoAppState(page, servers.server.baseUrl, { day: FIXTURE_DAY, settings: "performance" });
  await assertThemeApplied(page, theme);
  await expect(page.getByRole("heading", { name: "Performance", exact: true })).toBeVisible();
  await expect(page.locator(".ds-body-section-heading")).toHaveText(["Navigation", "Work", "Sign-in & Duo", "Additional limits"]);
  await expect(page.locator('[data-settings-path^="timeouts."]')).toHaveCount(10);
  await expect(page.getByRole("textbox", { name: "Task", exact: true })).toHaveValue("180");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);

  const tree = await page.locator("body").ariaSnapshot();
  const a11yName = `performance-settings-${theme.name}-${viewport.name}.a11y.yml`;
  info.annotations.push({ type: `a11y-attachment-sha256:${a11yName}`, description: createHash("sha256").update(tree).digest("hex") });
  await info.attach(a11yName, { body: tree, contentType: "text/yaml" });
});
