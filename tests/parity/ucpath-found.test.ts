import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);

test("UCPath decisions need an exact verified row or authoritative complete absence", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found`);
  await expect(page.getByRole("button", { name: "Submitted", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Not submitted", exact: true })).toBeDisabled();
  await page.getByRole("radio", { name: "Select transaction 00481024", exact: true }).check();
  await expect(page.getByRole("button", { name: "Submitted as 00481024", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Submitted as 00481024", exact: true }).click();
  await expect.poll(() => page.locator("html").getAttribute("data-requested-decision")).toBe(JSON.stringify({ kind: "submitted", transactionNumber: "00481024" }));
  for (const state of ["ambiguous", "incomplete", "unverified", "unauthoritative", "unavailable"]) {
    await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found&state=${state}`);
    await expect(page.getByRole("button", { name: "Submitted", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Not submitted", exact: true })).toBeDisabled();
  }
  await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found&state=absent`);
  await expect(page.getByRole("button", { name: "Not submitted", exact: true })).toBeEnabled();
  await page.getByRole("textbox", { name: "Exact transaction number", exact: true }).fill("TYPED-IS-NOT-PROOF");
  await expect(page.getByRole("button", { name: "Submitted", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Look up", exact: true }).click();
  await expect.poll(() => page.locator("html").getAttribute("data-requested-decision")).toBe(JSON.stringify({ kind: "check-again", transactionNumber: "TYPED-IS-NOT-PROOF" }));
  await expect(page.getByText("Checking confirmation again…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check again", exact: true })).toBeDisabled();
});

for (const state of ["exact", "ambiguous", "absent", "incomplete", "unverified", "unauthoritative", "checking", "loading", "unavailable"] as const) test(`ucpath-found ${state} presentation`, { annotation: [{ type: "required-a11y-evidence", description: `ucpath-found-${state}.a11y.yml` }] }, async ({ page }, info) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found&state=${state}`);
  await expect(page.getByRole("heading", { name: "EID 10777012", exact: true, level: 2 })).toBeVisible();
  if (state === "exact") await page.getByRole("radio", { name: "Select transaction 00481024", exact: true }).check();
  await expect(page.getByText("UI mock", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Show (ready|blocked|unavailable|exact|paused)/ })).toHaveCount(0);
  await captureParityPair(page, REFERENCES, {
    stateId: `ucpath-found-${state}`, viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "ucpath-found", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
  await attachShellA11y(page, info, `ucpath-found-${state}.a11y.yml`);
});
