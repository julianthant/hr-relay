import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "./helpers/fixture-start.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { attachShellA11y } from "./helpers/shell-proof.js";

for (const composition of ["product", "parity"] as const) {
  const evidence = `mock-workflow-queues-${composition}.a11y.yml`;
  test(`mock workflow queues use ${composition} data`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence }],
  }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" },
      ...(composition === "product" ? { profile: {
        bootstrap: FIXTURE_START_PICKER_BOOTSTRAP,
        day: { ...FIXTURE_START_PICKER_DAY_WIRE, queueSurfaces: [], workflowCounts: [], statusCounts: [] },
        descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
      } } : {}),
    });
    try {
      await page.addInitScript(product => Reflect.set(window, "relayParityProductWorkflows", product), composition === "product");
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      const queue = page.getByRole("region", { name: "Queue", exact: true });
      for (const label of ["Onboarding", "Work-Study", "Kronos Pay Rule", "Oath Signature", "Oath Upload", "Emergency Contact", "OnBase", "I-9 Check", "Onboarding Documents", "Old Kronos Reports"]) {
        await rail.getByRole("button", { name: label, exact: true }).click();
        for (const reload of [false, true]) {
          if (reload) await page.reload();
          await expect(page.getByRole("heading", { name: `${label} queue`, exact: true })).toBeAttached();
          if (composition === "product") {
            await expect(queue.locator("[data-demo-row-id]")).toHaveCount(0);
            await expect(queue.getByText(`No ${label} runs`, { exact: true })).toBeVisible();
            await expect(page.getByText("No run open", { exact: true })).toBeVisible();
          } else {
            await expect(queue.locator("[data-demo-row-id]").first()).toBeVisible();
          }
        }
      }
      await attachShellA11y(page, info, evidence);
    } finally { await page.close(); await server.close(); }
  });
}

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const evidence = `dashboard-e2e-${theme.attribute}-${width}.a11y.yml`;
  test(`product workflow previews retain the shell through clicks and reloads ${theme.attribute} ${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence }],
  }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: {
      bootstrap: FIXTURE_START_PICKER_BOOTSTRAP, day: FIXTURE_START_PICKER_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
    } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 });
      await installTheme(page, theme);
      await page.addInitScript(() => Reflect.set(window, "relayParityProductWorkflows", true));
      await page.goto(`${server.baseUrl}/?fixture=product-workflows&day=${FIXTURE_DAY}`);
      const assistant = page.getByRole("button", { name: "Assistant", exact: true });
      await expect(assistant).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator("#hub-shell-assistant")).toBeHidden();
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      const queue = page.getByRole("region", { name: "Queue", exact: true });
      for (const label of ["Onboarding Documents"]) {
        await rail.getByRole("button", { name: label, exact: true }).click();
        for (const reload of [false, true]) {
          if (reload) await page.reload();
          await expect(rail).toBeVisible();
          await expect(queue).toBeVisible();
          await expect(queue.locator("[data-demo-row-id]")).toHaveCount(0);
          await expect(queue.getByText(`No ${label} runs`, { exact: true })).toBeVisible();
          await expect(page.getByText("No run open", { exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: /^Sessions\b/ })).toBeVisible();
          await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeVisible();
          await expect(page.getByText("Page unavailable", { exact: true })).toHaveCount(0);
          expect(errors).toEqual([]);
        }
      }
      await assistant.click();
      await expect(page.locator("#hub-shell-assistant")).toBeVisible();
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
      await expect(page.locator("#hub-shell-assistant")).toBeHidden();
      await expect(assistant).toBeFocused();
      await attachShellA11y(page, info, evidence);
    } finally { await page.close(); await server.close(); }
  });
}
