import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);

test("Full preview labels samples and never calls unavailable stages exercised", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=dry-run`);
  await expect(page.getByText("dry-run sample", { exact: true })).toBeVisible();
  await expect(page.getByText("DRY-RUN-SAMPLE-0001", { exact: false })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Dependent transaction" })).toContainText("Exercised");
  await page.getByRole("button", { name: "Show unavailable stage", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "Dependent transaction" });
  await expect(row).toContainText("Unavailable");
  await expect(row).not.toContainText("Exercised");
  await expect(page.getByText("dry-run sample", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Skipped", { exact: true })).toBeVisible();
});

for (const [state, actions] of [
  ["complete", []],
  ["unavailable", ["Show unavailable stage"]],
] as const) test(`dry-run ${state} presentation`, { annotation: [{ type: "required-a11y-evidence", description: `dry-run-${state}.a11y.yml` }] }, async ({ page }, info) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=dry-run`);
  await expect(page.getByRole("heading", { name: "Logs", exact: true, level: 1 })).toBeVisible();
  for (const name of actions) await page.getByRole("button", { name, exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: `dry-run-${state}`, viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "dry-run", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
  await attachShellA11y(page, info, `dry-run-${state}.a11y.yml`);
});
