import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);

test("UCPath decisions require verified rows or complete authoritative absence", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found`);
  const submitted = page.getByRole("button", { name: "Submitted", exact: true });
  const absent = page.getByRole("button", { name: "Not submitted", exact: true });
  await expect(submitted).toBeDisabled();
  await expect(absent).toBeDisabled();
  await page.getByRole("button", { name: "Select transaction EXAMPLE-1024" }).click();
  await expect(submitted).toBeEnabled();
  for (const state of ["ambiguous", "incomplete", "unverified", "unauthoritative", "unavailable"]) {
    await page.getByRole("button", { name: `Show ${state}`, exact: true }).click();
    await expect(submitted).toBeDisabled(); await expect(absent).toBeDisabled();
  }
  await page.getByRole("button", { name: "Show absent", exact: true }).click();
  await expect(absent).toBeEnabled();
  await page.getByRole("textbox", { name: "Exact transaction number" }).fill("TYPED-IS-NOT-PROOF");
  await expect(submitted).toBeDisabled();
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(page.getByText("Checking confirmation again", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check again", exact: true })).toBeDisabled();
});

for (const [state, actions] of [
  ["exact", []],
  ["ambiguous", ["Show ambiguous"]],
  ["absent", ["Show absent"]],
  ["incomplete", ["Show incomplete"]],
  ["unverified", ["Show unverified"]],
  ["unauthoritative", ["Show unauthoritative"]],
  ["loading", ["Show loading"]],
  ["unavailable", ["Show unavailable"]],
  ["checking", ["Check again"]],
] as const) test(`ucpath-found ${state} presentation`, { annotation: [{ type: "required-a11y-evidence", description: `ucpath-found-${state}.a11y.yml` }] }, async ({ page }, info) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found`);
  await expect(page.getByRole("heading", { name: "Logs", exact: true, level: 1 })).toBeVisible();
  for (const name of actions) await page.getByRole("button", { name, exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: `ucpath-found-${state}`, viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "ucpath-found", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
  await attachShellA11y(page, info, `ucpath-found-${state}.a11y.yml`);
});
