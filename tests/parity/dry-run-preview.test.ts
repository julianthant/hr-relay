import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);

test("Dry run labels every sample and excludes unavailable steps from completion", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=dry-run`);
  await expect(page.getByText("Dry-run sample", { exact: true })).toHaveCount(2);
  await expect(page.getByText("SIM-48216", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Not clicked", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Finalize in Kuali", exact: true })).toContainText("Exercised");
  await expect(page.getByText("4 of 4 steps exercised", { exact: true })).toBeVisible();
  await page.goto(`${servers.server.baseUrl}/?fixture=dry-run&state=unavailable`);
  const row = page.getByRole("group", { name: "Finalize in Kuali", exact: true });
  await expect(row).toContainText("Unavailable");
  await expect(row).not.toContainText("Exercised");
  await expect(page.getByText("Dry-run sample", { exact: true })).toHaveCount(0);
  await expect(page.getByText("3 of 4 steps exercised", { exact: true })).toBeVisible();
  await expect(page.getByText("Skipped", { exact: true })).toBeVisible();
});

for (const state of ["complete", "unavailable"] as const) test(`dry-run ${state} presentation`, { annotation: [{ type: "required-a11y-evidence", description: `dry-run-${state}.a11y.yml` }] }, async ({ page }, info) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=dry-run&state=${state}`);
  await expect(page.getByRole("heading", { name: "EID 10777012", exact: true, level: 2 })).toBeVisible();

  await expect(page.getByText("UI mock", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Show (ready|blocked|unavailable|exact|paused)/ })).toHaveCount(0);
  await captureParityPair(page, REFERENCES, {
    stateId: `dry-run-${state}`, viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "dry-run", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
  await attachShellA11y(page, info, `dry-run-${state}.a11y.yml`);
});
