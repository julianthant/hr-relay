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

test("required-captures required presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=required-captures`);
  await page.getByRole("button", { name: "Show required", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "required-captures-required", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "required-captures", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("required-captures pre-submit-failed presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=required-captures`);
  await page.getByRole("button", { name: "Show pre-submit-failed", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "required-captures-pre-submit-failed", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "required-captures", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("required-captures post-submit-unknown presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=required-captures`);
  await page.getByRole("button", { name: "Show post-submit-unknown", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "required-captures-post-submit-unknown", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "required-captures", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("required-captures post-submit-proved presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=required-captures`);
  await page.getByRole("button", { name: "Show post-submit-proved", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "required-captures-post-submit-proved", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "required-captures", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});
