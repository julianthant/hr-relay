import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);

test("Run Pause and Resume distinguish requests from recorded pauses", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause`);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pausing…", exact: true })).toBeDisabled();
  await expect(page.getByText("Pause is not yet recorded.", { exact: false })).toBeVisible();
  await expect(page.getByText("Paused", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Show paused", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resuming…", exact: true })).toBeDisabled();
});
test("Quit asks explicitly and waits for pause and resource settlement", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause`);
  await page.getByRole("button", { name: "Quit Relay", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Pause all and quit?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep Relay open", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Quit Relay", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Quit Relay", exact: true }).click();
  await page.getByRole("button", { name: "Pause all and quit", exact: true }).click();
  await expect(page.getByText("Pausing active work", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause all", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Show closure unknown", exact: true }).click();
  await expect(page.getByText("Pause and quit not complete", { exact: true })).toBeVisible();
});

test("run-pause running presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause`);

  await captureParityPair(page, REFERENCES, {
    stateId: "run-pause-running", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "run-pause", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("run-pause pause-pending presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause`);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "run-pause-pause-pending", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "run-pause", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("run-pause paused presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause`);
  await page.getByRole("button", { name: "Show paused", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "run-pause-paused", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "run-pause", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("run-pause resume-pending presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause`);
  await page.getByRole("button", { name: "Show paused", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "run-pause-resume-pending", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "run-pause", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("run-pause quit-confirmation presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause`);
  await page.getByRole("button", { name: "Quit Relay", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "run-pause-quit-confirmation", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "run-pause", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("run-pause pausing presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause`);
  await page.getByRole("button", { name: "Pause all", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "run-pause-pausing", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "run-pause", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("run-pause closure-unknown presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause`);
  await page.getByRole("button", { name: "Show closure unknown", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "run-pause-closure-unknown", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "run-pause", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("run-pause unavailable presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause`);
  await page.getByRole("button", { name: "Show unavailable", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "run-pause-unavailable", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "run-pause", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});
