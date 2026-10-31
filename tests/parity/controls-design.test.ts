import { expect, test } from "@playwright/test";
import { attachShellA11y } from "./helpers/shell-proof.js";
import { registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);

for (const fixture of ["delete-account", "fixed-backup", "run-pause", "ucpath-found", "required-captures", "dry-run", "duo-signup"]) for (const theme of ["light", "dark"]) test(`${fixture} desktop and theme ${theme}`, { annotation: [{ type: "required-a11y-evidence", description: `${fixture}-${theme}-desktop.a11y.yml` }] }, async ({ page }, info) => {
  const writes: string[] = [], errors: string[] = [];
  page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => localStorage.setItem("rebuild-demo.theme", value), theme);
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto(`${servers.server.baseUrl}/?fixture=${fixture}`);
  await expect(page.locator("[data-app-root]")).toHaveAttribute("data-demo-theme", theme);
  await expect(page.locator("h1,h2").first()).toBeVisible();
  await expect(page.getByText("UI mock", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
  await attachShellA11y(page, info, `${fixture}-${theme}-desktop.a11y.yml`);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});
