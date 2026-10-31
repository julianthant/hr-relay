import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);

test("Required captures preserve pre-submit refusal and separate post-submit proof from unknown", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=required-captures`);
  await expect(page.getByRole("img", { name: "UCPath before submit", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "UCPath after submit", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Capture screenshots", exact: true })).toHaveCount(0);
  await page.goto(`${servers.server.baseUrl}/?fixture=required-captures&state=pre-submit-failed`);
  await expect(page.getByText("Stopped before submit. No submit was clicked.", { exact: true })).toBeVisible();
  await page.goto(`${servers.server.baseUrl}/?fixture=required-captures&state=post-submit-unknown`);
  await expect(page.getByText(/write outcome is unknown/)).toBeVisible();
  await expect(page.getByText("Proved", { exact: true })).toHaveCount(0);
  await page.goto(`${servers.server.baseUrl}/?fixture=required-captures&state=post-submit-proved`);
  await expect(page.getByText(/separately proved write outcome is preserved/)).toBeVisible();
  await expect(page.getByText("Proved", { exact: true })).toBeVisible();
  await expect(page.getByText(/write outcome is unknown/)).toHaveCount(0);
});

for (const state of ["required", "pre-submit-failed", "post-submit-proved", "post-submit-unknown"] as const) test(`required-captures ${state} presentation`, { annotation: [{ type: "required-a11y-evidence", description: `required-captures-${state}.a11y.yml` }] }, async ({ page }, info) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=required-captures&state=${state}`);
  await expect(page.getByRole("heading", { name: "EID 10777012", exact: true, level: 2 })).toBeVisible();

  await expect(page.getByText("UI mock", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Show (ready|blocked|unavailable|exact|paused)/ })).toHaveCount(0);
  await captureParityPair(page, REFERENCES, {
    stateId: `required-captures-${state}`, viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "required-captures", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
  await attachShellA11y(page, info, `required-captures-${state}.a11y.yml`);
});
