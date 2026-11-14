import type { Page } from "@playwright/test";
import { installServedSurfaces } from "./app-driver.js";
import { fixtureSettingsDocument } from "./fixture-settings.js";
import { chatGptStatusFixture } from "../../support/helpers/chatgpt-status-fixture.js";

/** Serves the active profile, editable settings and a connected ChatGPT account so Settings renders its served pages. */
export async function serveSettings(page: Page, theme: "dark" | "light"): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); Reflect.set(window, "relayMockPersonPreferences", true); Reflect.set(window, "relayMockMotion", false); }, theme);
  await page.route("**/api/v1/profile/state", route => route.fulfill({ json: {
    state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch: 1, duoState: "ready",
    account: { name: "Jordan Lee", initials: "JL", timekeeper: "Jordan Lee", lastSignedInAt: "2026-11-10T08:30:00-08:00" },
  } }));
  await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: fixtureSettingsDocument({ preferences: { theme, animations: false } }, 2) }));
  await page.route("**/api/v1/settings/chatgpt-account", route => route.fulfill({ json: chatGptStatusFixture({
    state: "connected", name: "Fixture Operator", email: "operator@example.edu", expiresAt: "2099-10-19T00:00:00Z", planUsage: "enabled",
  }) }));
  await installServedSurfaces(page);
}
