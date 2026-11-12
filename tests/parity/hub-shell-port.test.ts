import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertMonotonicFrozen, installFrozenMonotonic, installServedSurfaces } from "./helpers/app-driver.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { SettingsCommandRequestSchema, CommandResultSchema } from "../../src/rules/commands/commands.js";
import { mergeSettingsPatch } from "../../src/models/config/settings.js";
import { fixtureSettingsDocument } from "./helpers/fixture-settings.js";

async function assertCentered(page: Page, selector: string) {
  const position = await page.locator(selector).evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x - (innerWidth - box.width) / 2, y: box.y - (innerHeight - box.height) / 2 }; });
  expect(position.x).toBeCloseTo(0, 1); expect(position.y).toBeCloseTo(0, 1);
}

async function settle(page: Page, state: string) {
  if (["rename", "delete-confirm", "logout"].includes(state)) await assertCentered(page, ".hub-modal");
  await assertMonotonicFrozen(page);
}
for (const theme of ["light", "dark"] as const) {
  test(`HUB shell chat lifecycle, overlays and logout ${theme}`, async ({ page }) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    try {
      await installFrozenMonotonic(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); Reflect.set(window, "relayParityMotion", false); }, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      await expect(page.locator(".hub-assistant-slot")).toBeHidden();
      await page.getByRole("button", { name: "Assistant", exact: true }).click();
      await expect(page.locator(".hub-assistant-slot")).toBeVisible();
      await expect(page.getByRole("region", { name: "Relay assistant", exact: true })).toBeVisible();
      await expect(page.locator("#hub-panel-assistant")).toHaveCount(1);
      expect(await page.locator(".hub-assistant-slot").evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
      const underlying = page.locator(".dashboard-shell");
      const before = await underlying.boundingBox();
      await page.getByRole("button", { name: "History", exact: true }).click();
      await expect(page.locator(".hub-chat-row")).toHaveCount(4);
      await settle(page, "chats");
      await page.getByRole("button", { name: "Rename chat Update Alex Rivera work email", exact: true }).click();
      await settle(page, "rename");
      const title = page.getByRole("textbox", { name: "Chat title", exact: true });
      await title.fill(" "); await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await title.fill("Reviewed record"); await title.press("Enter");
      await expect(page.getByRole("button", { name: /^Reviewed record/ })).toBeVisible();
      await page.getByRole("button", { name: "Delete chat Reviewed record", exact: true }).click();
      await settle(page, "delete-confirm");
      await page.keyboard.press("Escape"); await expect(page.locator(".hub-chat-row")).toHaveCount(4);
      await page.getByRole("button", { name: "Delete chat Reviewed record", exact: true }).click();
      await page.getByRole("dialog", { name: "Delete chat?", exact: true }).getByRole("button", { name: "Delete", exact: true }).click();
      await expect(page.locator(".hub-chat-row")).toHaveCount(3);
      await page.getByRole("searchbox", { name: "Search chats", exact: true }).fill("no matching title");
      await expect(page.getByText("No matching chats.", { exact: true })).toBeVisible();
      await settle(page, "no-matches");
      expect(await underlying.boundingBox()).toEqual(before);
      await page.getByRole("button", { name: "Log out", exact: true }).click();
      await settle(page, "logout");
      await page.getByRole("dialog", { name: "Log out?", exact: true }).getByRole("button", { name: "Log out", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Log in to Relay", exact: true })).toBeVisible();
      expect(writes).toEqual([]); expect(errors).toEqual([]);
    } finally { await server.close(); }
  });

  test(`HUB onboarding mock handoff and readiness guards ${theme}`, async ({ page }) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const writes: string[] = [], errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    try {
      await installFrozenMonotonic(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); Reflect.set(window, "relayParityMotion", false); }, theme);
      await page.goto(`${server.baseUrl}/?onboarding=ready`);
      await expect(page.getByRole("heading", { name: "Start with your details", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Log in to Relay", exact: true })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      const brand = page.locator(".hub-onboarding .brand");
      await expect(brand).toContainText("Relay");
      await expect(brand.locator("svg")).toHaveCount(1);
      await settle(page, "login");
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Work email (required)", exact: true })).toBeFocused();
      await expect(page.locator(".hub-auth-error").first()).toBeVisible();
      await expect(page.locator(".hub-auth-error").first()).toHaveText("Enter your work email.");
      await settle(page, "login-fields");
      await page.getByRole("link", { name: "Sign up", exact: true }).click();
      await page.getByRole("button", { name: "Create profile", exact: true }).click();
      await expect(page.locator(".hub-onboarding .brand").locator("svg")).toHaveCount(1);
      await settle(page, "signup-fields");
      for (const [name, value] of [["firstName", "Alex"], ["lastName", "Rivera"], ["email", "alex.rivera@ucsd.edu"], ["password", "Relay-demo-42"]]) await page.locator(`input[name="${name}"]`).fill(value);
      await page.getByRole("button", { name: "Create profile", exact: true }).click();
      await settle(page, "duo-launching");
      await page.getByRole("button", { name: "Your details", exact: true }).click();
      for (const [name, value] of [["firstName", "Alex"], ["lastName", "Rivera"], ["email", "alex.rivera@ucsd.edu"], ["password", ""]]) await expect(page.locator(`input[name="${name}"]`)).toHaveValue(value);
      await page.getByRole("button", { name: "Duo setup", exact: true }).click();
      await page.goBack(); await expect(page.locator('input[name="firstName"]')).toHaveValue("Alex");
      await page.goForward();
      await page.evaluate(() => window.postMessage({ type: "hub-duo-mock", key: true, touch: true }, location.origin));
      await expect(page.getByRole("button", { name: "Finish setup", exact: true })).toHaveCount(0);
      const popup = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Show setup browser", exact: true }).click();
      const fast = await popup;
      await fast.setViewportSize({ width: 1440, height: 900 });
      await fast.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); Reflect.set(window, "relayParityMotion", false); }, theme);
      await installFrozenMonotonic(fast); await fast.reload();
      await expect(fast.locator("[data-app-root]")).toHaveAttribute("data-demo-theme", theme);
      await expect(fast.getByRole("button", { name: "Start capture", exact: true })).toBeEnabled();
      await settle(fast, "fast-idle");
      const touchCard = fast.locator(".method-card").filter({ hasText: "Touch ID" });
      await touchCard.focus(); await fast.keyboard.press("Enter");
      await expect(touchCard).toHaveAttribute("aria-pressed", "true");
      await expect(fast.getByLabel("Device type", { exact: true })).toHaveAttribute("data-value", "touch");
      await expect(fast.locator("select#device-type")).toHaveCount(0);
      await fast.getByLabel("Device type", { exact: true }).focus();
      await fast.keyboard.press("Enter");
      await expect(fast.getByRole("option", { name: "Security key", exact: true })).toBeVisible();
      await fast.keyboard.press("ArrowUp"); await fast.keyboard.press("Enter");
      await expect(fast.getByLabel("Device type", { exact: true })).toHaveAttribute("data-value", "key");
      await settle(page, "duo-waiting");
      const child = fast.waitForEvent("popup"); await fast.getByRole("button", { name: "Start capture", exact: true }).click();
      const duo = await child;
      for (const label of ["Add security key", "Add Touch ID"]) {
        await expect(duo.getByRole("button", { name: label, exact: true })).toBeEnabled();
        await duo.getByRole("button", { name: label, exact: true }).click();
        await assertCentered(duo, ".hub-duo-dialog");
        await duo.getByRole("button", { name: "Confirm device added", exact: true }).click();
        if (label === "Add security key") { await expect(page.getByText("Security key ready · Touch ID not added", { exact: true })).toBeVisible(); await settle(page, "duo-key"); await settle(fast, "fast-key"); }
      }
      await expect(page.getByRole("button", { name: "Finish setup", exact: true })).toBeVisible();
      await settle(page, "duo-both");
      await settle(fast, "fast-both");
      await page.getByRole("button", { name: "Finish setup", exact: true }).click();
      await settle(page, "ready");
      await page.getByRole("button", { name: "Go to dashboard", exact: true }).click();
      await expect(page.getByRole("button", { name: "Assistant", exact: true })).toBeVisible();
      expect(writes).toEqual([]); expect(errors).toEqual([]);
    } finally { await server.close(); }
  });

  test(`HUB appearance, served person preferences and motion ${theme}`, async ({ page }) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await installFrozenMonotonic(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); Reflect.set(window, "relayParityPersonPreferences", true); }, theme);
      let saved: Parameters<typeof mergeSettingsPatch>[0] = { preferences: { theme, animations: true } };
      let revision = 2, writes = 0, profileReads = 0;
      await page.route("**/api/v1/profile/state", route => { profileReads++; return route.fulfill({ json: {
        state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch: 1, duoState: "ready",
      } }); });
      await page.route("**/api/v1/settings/editable", route => route.fulfill({ json: fixtureSettingsDocument(saved, revision) }));
      await page.route("**/api/v1/commands", route => {
        const command = SettingsCommandRequestSchema.parse(route.request().postDataJSON());
        expect(command.source).toBe("person-preferences");
        expect(command.target.expectedRevision).toBe(revision);
        expect(Object.keys(command.payload.patch)).toEqual(["preferences.animations"]);
        saved = mergeSettingsPatch(saved, command.payload.patch); revision++; writes++;
        const document = fixtureSettingsDocument(saved, revision);
        return route.fulfill({ json: CommandResultSchema.parse({ state: "applied", commandId: command.commandId,
          affectedTargets: [{ family: "settings", revision }], settingsRevision: revision,
          settingsFingerprint: document.settingsFingerprint, restartRequired: false }) });
      });
      await installServedSurfaces(page);
      await page.goto(`${server.baseUrl}/?settings=general`);
      const animations = page.getByRole("switch", { name: "Animations", exact: true });
      await expect(animations).toBeEnabled();
      const appearance = page.getByRole("group", { name: "Appearance", exact: true });
      await expect(appearance).not.toContainText("Jordan Lee");
      await expect(appearance.getByRole("button", { name: /^Switch to (?:light|dark) theme$/u })).toBeVisible();
      await expect(animations).toBeChecked(); await page.locator('[data-settings-path="appearance.animations"] .ds-switch-control').click();
      await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
      await expect(animations).not.toBeChecked();
      await expect(appearance.locator(".ds-switch-copy .ds-text-meta,.ds-field-description")).toHaveCount(0);
      await expect(page.getByText("Settings save unconfirmed", { exact: true })).toHaveCount(0);
      const search = page.locator(".settings-nav-search input");
      const fill = await search.evaluate(element => getComputedStyle(element).backgroundColor);
      await page.keyboard.press("Tab");
      await search.focus();
      expect(await search.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(fill);
      await search.blur();
      await settle(page, "settings-general");
      await expect(page.getByRole("group", { name: "Assistant permission", exact: true })).toHaveCount(0);
      await expect(page.locator('[data-settings-path="assistant.permission"]')).toHaveCount(0);
      await search.fill("assistant permission");
      await expect(page.getByRole("button", { name: "Assistant permission", exact: true })).toHaveCount(0);
      await search.clear();
      await page.getByRole("link", { name: "Keyboard", exact: true }).click();
      await page.getByRole("link", { name: "General", exact: true }).click();
      await expect(page.getByRole("button", { name: "Ask before every action", exact: true })).toHaveCount(0);
      await expect(animations).not.toBeChecked();
      await page.reload(); await expect(animations).not.toBeChecked();
      await expect(animations).toBeEnabled(); expect(writes).toBe(1); expect(profileReads).toBe(2);
      await page.locator('[data-settings-path="appearance.animations"] .ds-switch-control').click(); await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(animations).toBeChecked(); expect(writes).toBe(2);
      await expect(page.getByText("Settings save unconfirmed", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Back to dashboard", exact: true }).click();
      expect(await page.locator(".hub-logout").evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
      const notifications = page.getByRole("button", { name: /^Notifications,/ });
      await notifications.hover(); await expect(notifications).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await page.mouse.move(0, 0);
      await page.keyboard.press("Tab"); await notifications.focus();
      await expect(notifications).toHaveCSS("background-color", theme === "light" ? "rgb(214, 214, 214)" : "rgb(74, 74, 74)");
      const keyboardFill = await notifications.evaluate(element => getComputedStyle(element).backgroundColor);
      await notifications.click();
      expect(await notifications.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(keyboardFill);
      expect(await notifications.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("none");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Choose date/ }).click();
      const year = page.getByRole("dialog", { name: "Choose date", exact: true }).getByRole("button", { name: /year selector/ });
      expect(await year.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
      await year.click(); await expect(year).toHaveAttribute("aria-expanded", "true");
    } finally { await server.close(); }
  });
}
