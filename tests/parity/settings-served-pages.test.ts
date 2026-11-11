import { expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installServedSurfaces } from "./helpers/app-driver.js";
import { fixtureSettingsDocument } from "./helpers/fixture-settings.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { chatGptStatusFixture } from "../support/helpers/chatgpt-status-fixture.js";

for (const theme of ["dark", "light"] as const) {
  test(`Settings General, Account and Subscription render the approved pages on served data ${theme}`, async ({ page }) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); Reflect.set(window, "relayParityPersonPreferences", true); Reflect.set(window, "relayParityMotion", false); }, theme);
      await page.route("**/api/v1/profile/state", route => route.fulfill({ json: {
        state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch: 1, duoState: "ready",
        account: { name: "Jordan Lee", initials: "JL", timekeeper: "Jordan Lee", lastSignedInAt: "2026-11-10T08:30:00-08:00" },
      } }));
      await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: fixtureSettingsDocument({ preferences: { theme, animations: false } }, 2) }));
      await page.route("**/api/v1/settings/chatgpt-account", route => route.fulfill({ json: chatGptStatusFixture({
        state: "connected", name: "Fixture Operator", email: "operator@example.edu", expiresAt: "2099-10-19T00:00:00Z", planUsage: "enabled",
      }) }));
      await installServedSurfaces(page);
      const shot = async (name: string) => { mkdirSync("tests/parity/.output/settings-served-preview", { recursive: true }); await page.screenshot({ path: `tests/parity/.output/settings-served-preview/${name}-${theme}.png` }); };

      await page.goto(`${server.baseUrl}/?settings=general`);
      await expect(page.getByRole("heading", { name: "General", exact: true, level: 1 })).toBeVisible();
      await expect(page.getByText("Default permissions")).toHaveCount(0);
      await shot("settings-general");

      await page.getByRole("link", { name: "Account", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Account", exact: true, level: 1 })).toBeVisible();
      await expect(page.getByText("Jordan Lee").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /Delete/u }).first()).toBeVisible();
      await shot("settings-account");
      await page.setViewportSize({ width: 1280, height: 1300 });
      await shot("settings-account-full");
      await page.setViewportSize({ width: 1280, height: 720 });

      await page.getByRole("link", { name: "Subscription", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Subscription", exact: true, level: 1 })).toBeVisible();
      await expect(page.getByText("operator@example.edu")).toBeVisible();
      await shot("settings-subscription");
    } finally { await server.close(); }
  });
}
