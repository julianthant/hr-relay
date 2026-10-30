import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);
test("Fixed app data cannot relocate and Restore requires confirmation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup`);
  await expect(page.getByRole("textbox", { name: "Runtime state folder", exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: /Change.*folder|relocat/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Backup", exact: true }).click();
  await expect(page.getByText("Backup in progress", { exact: true })).toBeVisible();
  await expect(page.getByText("Backup verified", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Show ready", exact: true }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("button", { name: "Keep current data", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Restore verified backup", exact: true }).click();
  await expect(page.getByText("Restore in progress", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show blocked", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore", exact: true })).toBeDisabled();
});

test("fixed-backup ready presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup`);

  await captureParityPair(page, REFERENCES, {
    stateId: "fixed-backup-ready", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "fixed-backup", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("fixed-backup backing-up presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup`);
  await page.getByRole("button", { name: "Backup", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "fixed-backup-backing-up", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "fixed-backup", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("fixed-backup backup-complete presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup`);
  await page.getByRole("button", { name: "Show backup-complete", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "fixed-backup-backup-complete", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "fixed-backup", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("fixed-backup restore-confirmation presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup`);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "fixed-backup-restore-confirmation", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "fixed-backup", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("fixed-backup restoring presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup`);
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("button", { name: "Restore verified backup", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "fixed-backup-restoring", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "fixed-backup", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("fixed-backup blocked presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup`);
  await page.getByRole("button", { name: "Show blocked", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "fixed-backup-blocked", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "fixed-backup", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});

test("fixed-backup unavailable presentation", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup`);
  await page.getByRole("button", { name: "Show unavailable", exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: "fixed-backup-unavailable", viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "fixed-backup", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});
