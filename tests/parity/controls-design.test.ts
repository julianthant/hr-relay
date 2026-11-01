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
  if (fixture === "ucpath-found") {
    const card = page.getByRole("region", { name: "UCPath found transactions", exact: true });
    expect(await card.getByRole("heading", { name: "Did this submit reach UCPath?", exact: true }).evaluate(node => getComputedStyle(node).fontSize)).toBe("16px");
    const heights = await card.locator("footer button").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    expect(new Set(heights).size).toBe(1);
  }
  if (fixture === "fixed-backup") {
    const path = page.getByRole("textbox", { name: "Data path", exact: true });
    const style = await path.evaluate(node => ({ size: getComputedStyle(node).fontSize, overflow: getComputedStyle(node).textOverflow }));
    expect(style).toEqual({ size: "12px", overflow: "ellipsis" });
    await expect(path).toHaveAttribute("title", await path.inputValue());
  }
  if (["run-pause", "dry-run", "required-captures", "ucpath-found"].includes(fixture)) {
    const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
    await expect(logs.getByRole("region", { name: "Run logs", exact: true })).toBeVisible();
    const step = logs.getByRole("heading", { level: 3 }).first();
    expect(await step.evaluate(node => getComputedStyle(node).fontSize)).toBe("14px");
    const event = logs.locator("[aria-label='Run logs'] .text-body").first();
    expect(await event.evaluate(node => getComputedStyle(node).fontSize)).toBe("13px");
  }
  if (fixture === "required-captures") {
    const layout = await page.locator(".log-control-content").evaluate(node => {
      const column = node.previousElementSibling;
      if (!column) throw new Error("capture-step-content-column-missing");
      return { width: node.getBoundingClientRect().width, columnWidth: column.getBoundingClientRect().width, heights: [...node.querySelectorAll(".log-capture--submit")].map(card => card.getBoundingClientRect().height) };
    });
    expect(Math.abs(layout.width - layout.columnWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.heights[0] - layout.heights[1])).toBeLessThanOrEqual(1);
  }
  if (fixture === "duo-signup") expect(await page.getByRole("button", { name: "Back to login", exact: true }).evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  await attachShellA11y(page, info, `${fixture}-${theme}-desktop.a11y.yml`);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});
