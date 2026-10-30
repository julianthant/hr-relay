import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);
test("Required captures distinguish pre-submit refusal from post-submit proof and uncertainty", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=required-captures`);
  await expect(page.getByText("Screenshots required", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Capture screenshots", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Show pre-submit-failed", exact: true }).click();
  await expect(page.getByText("Stopped before submit.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Show post-submit-unknown", exact: true }).click();
  await expect(page.getByText("original write outcome stays unknown", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Show post-submit-proved", exact: true }).click();
  await expect(page.getByText("separately proved write outcome is preserved", { exact: false })).toBeVisible();
  await expect(page.getByText("original write outcome stays unknown", { exact: false })).toHaveCount(0);
});

for (const [state, actions] of [
  ["required", ["Show required"]],
  ["pre-submit-failed", ["Show pre-submit-failed"]],
  ["post-submit-unknown", ["Show post-submit-unknown"]],
  ["post-submit-proved", ["Show post-submit-proved"]],
] as const) test(`required-captures ${state} presentation`, { annotation: [{ type: "required-a11y-evidence", description: `required-captures-${state}.a11y.yml` }] }, async ({ page }, info) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=required-captures`);
  await expect(page.getByRole("heading", { name: "Screenshots", exact: true, level: 1 })).toBeVisible();
  for (const name of actions) await page.getByRole("button", { name, exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: `required-captures-${state}`, viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "required-captures", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
  await attachShellA11y(page, info, `required-captures-${state}.a11y.yml`);
});
