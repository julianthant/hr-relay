import { expect } from "@playwright/test";
import { resolve } from "node:path";
import { test } from "./helpers/fixtures.js";
import { installFrozenMonotonic } from "./helpers/app-driver.js";
import { captureParityPair } from "./helpers/capture.js";
import { attachShellA11y } from "./helpers/shell-proof.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";

for (const theme of ["light", "dark"] as const) for (const scenario of ["opening", "open-failed", "open", "closed", "reopening", "stop-failed", "files-busy", "checking", "ready", "ready-closed"] as const) test(`onboarding window ${scenario} ${theme}`, {
  annotation: [{ type: "required-a11y-evidence", description: `onboarding-window-${scenario}-${theme}.a11y.yml` }],
}, async ({ page, hubServer }, info) => {
  const complete = { state: "complete", ceremonyObserved: true, portalAccepted: true, operatorConfirmed: true, exactCredentialRequestObserved: false };
  const idle = { state: "idle", ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
  const ready = scenario.startsWith("ready");
  const code = scenario === "open-failed" ? "DUO_SETUP_OPEN_FAILED" : scenario === "stop-failed" ? "DUO_SETUP_STOP_FAILED" : scenario === "files-busy" ? "DUO_SETUP_FILES_BUSY" : undefined;
  const browser = code ? { state: "failed", code, generation: 1 } : { state: scenario === "ready" ? "open" : scenario === "ready-closed" ? "closed" : scenario, generation: 1 };
  const draft = { state: "onboarding", operationId: "00000000-0000-4000-8000-000000000001", profileId: "00000000-0000-4000-8000-000000000002", step: ready ? "ready" : "duo", methods: { key: complete, touch: ready ? complete : idle }, browser };
  const writes: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
  await installFrozenMonotonic(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); Reflect.set(window, "relayParityMotion", false); }, theme);
  await page.route("**/api/v1/profile/state", route => route.fulfill({ json: draft }));
  await page.goto(`${hubServer.baseUrl}/?fixture=picked-onboarding`);
  await expect(page.locator(".duo-window-status")).toBeVisible();
  await expect(page.locator(".method-list > li")).toHaveCount(2);
  await expect(page.getByText("Sign-up on hold", { exact: true })).toHaveCount(0);
  if (["closed", "open-failed", "stop-failed", "files-busy", "checking", "ready-closed"].includes(scenario)) await expect(page.getByRole("button", { name: "Reopen", exact: true })).toBeEnabled();
  await captureParityPair(page, resolve("tests/parity/references"), { stateId: `onboarding-browser-status-${scenario}`, theme, viewport: "1280x720", adapter: "fixture", fixtureId: "picked-onboarding", descriptorHash: FIXTURE_DESCRIPTOR_HASH, appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default" });
  await attachShellA11y(page, info, `onboarding-window-${scenario}-${theme}.a11y.yml`);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});
