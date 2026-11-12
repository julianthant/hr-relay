import { expect, test } from "@playwright/test";
import { registerReferenceServers } from "./helpers/reference-harness.js";
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

for (const state of ["exact", "ambiguous", "absent", "incomplete", "unverified", "unauthoritative", "checking", "loading", "unavailable"] as const) test(`ucpath-found ${state} presentation`, async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found&state=${state}`);
  await expect(page.getByRole("heading", { name: "EID 10777012", exact: true, level: 2 })).toBeVisible();
  if (state === "exact") await page.getByRole("radio", { name: "Select transaction 00481024", exact: true }).check();
  await expect(page.getByText("UI mock", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Show (ready|blocked|unavailable|exact|paused)/ })).toHaveCount(0);
});
