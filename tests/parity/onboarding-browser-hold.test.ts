import { expect } from "@playwright/test";
import { resolve } from "node:path";
import { test } from "./helpers/fixtures.js";
import { installFrozenMonotonic } from "./helpers/app-driver.js";
import { captureParityPair } from "./helpers/capture.js";
import { attachShellA11y } from "./helpers/shell-proof.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";

for (const theme of ["light", "dark"] as const) test(`onboarding browser closure hold ${theme}`, {
  annotation: [{ type: "required-a11y-evidence", description: `onboarding-browser-hold-${theme}.a11y.yml` }],
}, async ({ page, hubServer }, info) => {
  const idle = { state: "idle", ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
  const draft = { state: "onboarding", operationId: "00000000-0000-4000-8000-000000000001",
    profileId: "00000000-0000-4000-8000-000000000002", step: "duo", methods: { key: idle, touch: idle } };
  const writes: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
  await installFrozenMonotonic(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); Reflect.set(window, "relayParityMotion", false); }, theme);
  await page.route("**/api/v1/profile/state", route => route.fulfill({ json: draft }));
  await page.route("**/api/v1/profile/onboarding/duo/browser", route => route.fulfill({ status: 409,
    json: { state: "refused", code: "BROWSER_CLOSURE_UNPROVED" } }));
  await page.goto(`${hubServer.baseUrl}/?fixture=picked-onboarding`);
  await page.getByRole("button", { name: "Show setup browser", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign-up on hold", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("Relay could not confirm the Duo setup browser closed. Sign-up is on hold. Close and reopen Relay to continue.");
  await expect(page.getByRole("button", { name: "Reopen browser", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel sign-up", exact: true })).toBeDisabled();
  await expect(page.locator(".method-list > li")).toHaveCount(2);
  await captureParityPair(page, resolve("tests/parity/references"), { stateId: "onboarding-browser-hold", theme,
    viewport: "1280x720", adapter: "fixture", fixtureId: "picked-onboarding", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default" });
  await attachShellA11y(page, info, `onboarding-browser-hold-${theme}.a11y.yml`);
  expect(writes).toEqual(["/api/v1/profile/onboarding/duo/browser"]); expect(errors).toEqual([]);
});
