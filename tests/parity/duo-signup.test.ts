import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);

test("Duo sign-up needs both verified methods and keeps virtual Touch ID separate", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=duo-signup`);
  const finish = page.getByRole("button", { name: "Finish", exact: true });
  await expect(finish).toBeDisabled();
  await page.getByRole("button", { name: "Add Touch ID", exact: true }).click();
  await expect(finish).toBeDisabled();
  await expect(page.getByText("Waiting for Duo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show setup browser", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-setup-browser-shown", "true");
  await page.goto(`${servers.server.baseUrl}/?fixture=duo-signup&state=virtual`);
  await expect(page.getByText("Chromium supplies a virtual platform authenticator.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Security key", exact: true })).toBeEnabled();
  await page.goto(`${servers.server.baseUrl}/?fixture=duo-signup&state=touch-complete&platform=virtual`);
  await expect(page.getByText("Verified · Chromium virtual authenticator.", { exact: true })).toBeVisible();
  await expect(finish).toBeDisabled();
  await page.goto(`${servers.server.baseUrl}/?fixture=duo-signup&state=both-complete`);
  await expect(finish).toBeEnabled(); await finish.click();
  await expect(page.getByText("Finishing sign-up; your account is not published yet.", { exact: true })).toBeVisible();
  await expect(finish).toBeDisabled();
  await page.goto(`${servers.server.baseUrl}/?fixture=duo-signup&state=unknown`);
  await expect(finish).toBeDisabled();
  await expect(page.getByText("Enrollment is unverified. Review your Duo devices.", { exact: true })).toBeVisible();
  await page.goto(`${servers.server.baseUrl}/?fixture=duo-signup&state=unavailable`);
  await expect(finish).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add Security key", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to login", exact: true }).click();
  await expect(page.getByText("Cancelling sign-up; resource closure is not complete.", { exact: true })).toBeVisible();
});

for (const state of ["idle", "pending", "touch-complete", "both-complete", "finishing", "cancelling", "unknown", "unavailable", "virtual"] as const) test(`duo-signup ${state} presentation`, { annotation: [{ type: "required-a11y-evidence", description: `duo-signup-${state}.a11y.yml` }] }, async ({ page }, info) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=duo-signup&state=${state}`);
  await expect(page.getByRole("heading", { name: "Add your sign-in methods", exact: true, level: 1 })).toBeVisible();

  await expect(page.getByText("UI mock", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Show (ready|blocked|unavailable|exact|paused)/ })).toHaveCount(0);
  await captureParityPair(page, REFERENCES, {
    stateId: `duo-signup-${state}`, viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "duo-signup", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
  await attachShellA11y(page, info, `duo-signup-${state}.a11y.yml`);
});
