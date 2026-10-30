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
  for (const state of ["ambiguous", "incomplete", "unverified", "unavailable"]) {
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

test("ucpath-found exact presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found`);

  await captureParityPair(page, REFERENCES, {
    stateId: "ucpath-found-exact", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "ucpath-found", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("ucpath-found ambiguous presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found`);
  await page.getByRole("button", { name: "Show ambiguous", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "ucpath-found-ambiguous", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "ucpath-found", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("ucpath-found absent presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found`);
  await page.getByRole("button", { name: "Show absent", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "ucpath-found-absent", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "ucpath-found", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("ucpath-found incomplete presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found`);
  await page.getByRole("button", { name: "Show incomplete", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "ucpath-found-incomplete", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "ucpath-found", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("ucpath-found unverified presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found`);
  await page.getByRole("button", { name: "Show unverified", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "ucpath-found-unverified", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "ucpath-found", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("ucpath-found loading presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found`);
  await page.getByRole("button", { name: "Show loading", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "ucpath-found-loading", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "ucpath-found", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("ucpath-found unavailable presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found`);
  await page.getByRole("button", { name: "Show unavailable", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "ucpath-found-unavailable", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "ucpath-found", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("ucpath-found checking presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=ucpath-found`);
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "ucpath-found-checking", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "ucpath-found", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});
