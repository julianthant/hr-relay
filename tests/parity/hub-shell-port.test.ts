import { expect, type Page, type TestInfo } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { resolve } from "node:path";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { captureParityPair } from "./helpers/capture.js";
import { assertMonotonicFrozen, installFrozenMonotonic } from "./helpers/app-driver.js";
import { attachShellA11y } from "./helpers/shell-proof.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";

async function assertCentered(page: Page, selector: string) {
  const position = await page.locator(selector).evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x - (innerWidth - box.width) / 2, y: box.y - (innerHeight - box.height) / 2 }; });
  expect(position.x).toBeCloseTo(0, 1); expect(position.y).toBeCloseTo(0, 1);
}

async function capture(page: Page, info: TestInfo, state: string, theme: string) {
  if (["rename", "delete-confirm", "logout"].includes(state)) await assertCentered(page, ".hub-modal");
  await assertMonotonicFrozen(page);
  const name = `hub-shell-${state}-${theme}.a11y.yml`;
  info.annotations.push({ type: "required-a11y-evidence", description: name });
  await attachShellA11y(page, info, name);
  await captureParityPair(page, resolve("tests/parity/references"), {
    stateId: `hub-shell-${state}`, viewport: "1440x900", theme, adapter: "fixture", fixtureId: "hub-mock-ports-served-shell",
    descriptorHash: FIXTURE_DESCRIPTOR_HASH, appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
}
for (const theme of ["light", "dark"]) {
  test(`HUB shell chat lifecycle, overlays and logout ${theme}`, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    try {
      await installFrozenMonotonic(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(value => { localStorage.setItem("rebuild-demo.theme", value); localStorage.setItem("relay.animations", "off"); }, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      await expect(page.locator(".hub-assistant-slot")).toBeVisible();
      await expect(page.getByRole("region", { name: "Relay assistant", exact: true })).toBeVisible();
      await expect(page.locator("#hub-panel-assistant")).toHaveCount(1);
      expect(await page.locator(".hub-assistant-slot").evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
      const underlying = page.locator(".dashboard-shell");
      const before = await underlying.boundingBox();
      await page.getByRole("button", { name: "Chats", exact: true }).click();
      await expect(page.locator(".hub-chat-row")).toHaveCount(4);
      await capture(page, info, "chats", theme);
      await page.getByRole("button", { name: "Rename chat Update Alex Rivera work email", exact: true }).click();
      await capture(page, info, "rename", theme);
      const title = page.getByRole("textbox", { name: "Chat title", exact: true });
      await title.fill(" "); await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await title.fill("Reviewed record"); await title.press("Enter");
      await expect(page.getByRole("button", { name: /^Reviewed record/ })).toBeVisible();
      await page.getByRole("button", { name: "Delete chat Reviewed record", exact: true }).click();
      await capture(page, info, "delete-confirm", theme);
      await page.keyboard.press("Escape"); await expect(page.locator(".hub-chat-row")).toHaveCount(4);
      await page.getByRole("button", { name: "Delete chat Reviewed record", exact: true }).click();
      await page.getByRole("dialog", { name: "Delete chat?", exact: true }).getByRole("button", { name: "Delete", exact: true }).click();
      await expect(page.locator(".hub-chat-row")).toHaveCount(3);
      await page.getByRole("textbox", { name: "Search chats", exact: true }).fill("no matching title");
      await expect(page.getByText("No matching chats.", { exact: true })).toBeVisible();
      await capture(page, info, "no-matches", theme);
      expect(await underlying.boundingBox()).toEqual(before);
      await page.getByRole("button", { name: "Log out", exact: true }).click();
      await capture(page, info, "logout", theme);
      await page.getByRole("dialog", { name: "Log out?", exact: true }).getByRole("button", { name: "Log out", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Log in to Relay", exact: true })).toBeVisible();
      expect(writes).toEqual([]); expect(errors).toEqual([]);
    } finally { await server.close(); }
  });

  test(`HUB onboarding mock handoff and readiness guards ${theme}`, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const writes: string[] = [], errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    try {
      await installFrozenMonotonic(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(value => { localStorage.setItem("rebuild-demo.theme", value); localStorage.setItem("relay.animations", "off"); }, theme);
      await page.goto(`${server.baseUrl}/?onboarding=ready`);
      await expect(page.getByRole("heading", { name: "Start with your details", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Log in to Relay", exact: true })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await capture(page, info, "login", theme);
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "Work email (required)", exact: true })).toBeFocused();
      await expect(page.locator(".hub-auth-error").first()).toBeVisible();
      await expect(page.locator(".hub-auth-error").first()).toHaveText("Enter your work email.");
      await capture(page, info, "login-fields", theme);
      await page.getByRole("link", { name: "Sign up", exact: true }).click();
      await page.getByRole("button", { name: "Create profile", exact: true }).click();
      await capture(page, info, "signup-fields", theme);
      for (const [name, value] of [["firstName", "Alex"], ["lastName", "Rivera"], ["email", "alex.rivera@ucsd.edu"], ["password", "Relay-demo-42"]]) await page.locator(`input[name="${name}"]`).fill(value);
      await page.getByRole("button", { name: "Create profile", exact: true }).click();
      await capture(page, info, "duo-launching", theme);
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
      await installFrozenMonotonic(fast); await fast.reload();
      await expect(fast.getByRole("button", { name: "Start capture", exact: true })).toBeEnabled();
      await capture(fast, info, "fast-idle", theme);
      const touchCard = fast.locator(".method-card").filter({ hasText: "Touch ID" });
      await touchCard.focus(); await fast.keyboard.press("Enter");
      await expect(touchCard).toHaveAttribute("aria-pressed", "true");
      await expect(fast.getByLabel("Device type", { exact: true })).toHaveValue("touch");
      await fast.getByLabel("Device type", { exact: true }).selectOption("key");
      await capture(page, info, "duo-waiting", theme);
      const child = fast.waitForEvent("popup"); await fast.getByRole("button", { name: "Start capture", exact: true }).click();
      const duo = await child;
      for (const label of ["Add security key", "Add Touch ID"]) {
        await expect(duo.getByRole("button", { name: label, exact: true })).toBeEnabled();
        await duo.getByRole("button", { name: label, exact: true }).click();
        await assertCentered(duo, ".hub-duo-dialog");
        await duo.getByRole("button", { name: "Confirm device added", exact: true }).click();
        if (label === "Add security key") { await expect(page.getByText("Security key ready · Touch ID not added", { exact: true })).toBeVisible(); await capture(page, info, "duo-key", theme); await capture(fast, info, "fast-key", theme); }
      }
      await expect(page.getByRole("button", { name: "Finish setup", exact: true })).toBeVisible();
      await capture(page, info, "duo-both", theme);
      await capture(fast, info, "fast-both", theme);
      await page.getByRole("button", { name: "Finish setup", exact: true }).click();
      await capture(page, info, "ready", theme);
      await page.getByRole("button", { name: "Go to dashboard", exact: true }).click();
      await expect(page.locator(".hub-assistant-slot")).toBeVisible();
      expect(writes).toEqual([]); expect(errors).toEqual([]);
    } finally { await server.close(); }
  });

  test(`HUB appearance, session mock preferences and motion ${theme}`, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await installFrozenMonotonic(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(value => localStorage.setItem("rebuild-demo.theme", value), theme);
      await page.goto(`${server.baseUrl}/?settings=general`);
      const animations = page.getByRole("switch", { name: /^Animations / });
      await expect(animations).toBeChecked(); await page.locator('[data-settings-path="appearance.animations"] .ds-switch-control').click();
      await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
      const search = page.locator(".settings-nav-search input");
      const fill = await search.evaluate(element => getComputedStyle(element).backgroundColor);
      await page.keyboard.press("Tab");
      await search.focus();
      expect(await search.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(fill);
      await search.blur();
      await capture(page, info, "settings-general", theme);
      const before = await page.locator(".settings-compact-page").boundingBox();
      await page.getByRole("button", { name: "Ask before every action", exact: true }).click();
      const firstMode = page.getByRole("menuitemradio", { name: /^Ask before every action/ });
      await firstMode.hover(); await expect(firstMode).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await capture(page, info, "settings-permission", theme);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Ask before every action", exact: true })).toBeFocused();
      await page.getByRole("button", { name: "Ask before every action", exact: true }).click();
      await page.keyboard.press("End"); await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Ask before every action", exact: true })).toBeFocused();
      expect(await page.locator(".settings-compact-page").boundingBox()).toEqual(before);
      await page.getByRole("link", { name: "Keyboard", exact: true }).click();
      await page.getByRole("link", { name: "General", exact: true }).click();
      await expect(page.getByRole("button", { name: "Ask before every action", exact: true })).toBeVisible();
      await expect(animations).not.toBeChecked();
      await page.reload(); await expect(animations).not.toBeChecked();
      await page.locator('[data-settings-path="appearance.animations"] .ds-switch-control').click(); await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await page.locator(".hub-logout").evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
      await page.getByRole("link", { name: "Storage", exact: true }).click();
      for (const selector of [".ds-form-group > .ds-result-row", ".diagnostic-check-entry > .ds-result-row"]) {
        const row = page.locator(`.settings-tab-body ${selector}`).first();
        await expect(row).toHaveCSS("padding-left", "18px"); await expect(row).toHaveCSS("padding-right", "18px");
      }
      await page.getByRole("button", { name: "Back to dashboard", exact: true }).click();
      const notifications = page.getByRole("button", { name: /^Notifications,/ });
      await notifications.hover(); await expect(notifications).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await page.mouse.move(0, 0);
      await page.keyboard.press("Tab"); await notifications.focus();
      await expect(notifications).toHaveCSS("background-color", theme === "light" ? "rgb(148, 148, 148)" : "rgb(176, 176, 176)");
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
