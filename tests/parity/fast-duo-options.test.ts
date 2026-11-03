import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { attachShellA11y } from "./helpers/shell-proof.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";

for (const theme of ["light", "dark"] as const) test(`Fast Duo sign-in method picker ${theme}`, {
  annotation: [{ type: "required-a11y-evidence", description: `fast-duo-options-${theme}.a11y.yml` }],
}, async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: theme });
  const files = ["options.html", "options.js", "relay-options.js", "styles.css", "icons/autopilot.svg", "icons/shield-check.svg"];
  await page.route("https://extension-fixture.invalid/**", route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (!files.includes(file)) throw new Error("unexpected extension fixture asset");
    return route.fulfill({ body: readFileSync(resolve("fast-duo/src", file)), contentType:
      file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "text/html" });
  });
  await page.addInitScript(() => {
    const idle = { state: "idle" };
    const profile = { operationId: "00000000-0000-4000-8000-000000000001", profileId: "00000000-0000-4000-8000-000000000002", methods: { key: idle, touch: idle } };
    Reflect.set(window, "chrome", { runtime: { async sendMessage(message: { type: string }) {
      if (message.type !== "STATE") throw new Error("unexpected extension fixture command");
      return { success: true, result: { relaySetup: true, profile } };
    } } });
  });
  await page.goto("https://extension-fixture.invalid/options.html");
  const picker = page.getByRole("group", { name: "Sign-in method", exact: true });
  const key = picker.getByRole("button", { name: "Security key", exact: true });
  const touch = picker.getByRole("button", { name: "Touch ID", exact: true });
  await expect(key).toBeEnabled(); await expect(key).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("select")).toHaveCount(0);
  await touch.focus(); await page.keyboard.press("Enter");
  await expect(touch).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.relay-method-card[data-method="touch"]')).toHaveAttribute("aria-pressed", "true");
  await key.focus(); await page.keyboard.press("Space");
  await expect(key).toHaveAttribute("aria-pressed", "true");
  await key.blur();
  await captureParityPair(page, resolve("tests/parity/references"), { stateId: "fast-duo-options", theme, viewport: "1440x900",
    adapter: "fixture", fixtureId: "fast-duo-options", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default" });
  await attachShellA11y(page, info, `fast-duo-options-${theme}.a11y.yml`);
  expect(errors).toEqual([]);
});
