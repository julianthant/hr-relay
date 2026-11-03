import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { ProfileOnboardingStateSchema, type ProfileOnboardingState } from "../../src/models/profiles/public-profile.js";
import { captureParityPair } from "./helpers/capture.js";
import { attachShellA11y } from "./helpers/shell-proof.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";


const CommandSchema = z.strictObject({ type: z.enum(["STATE", "RELAY_RETURN", "RELAY_CONFIRM", "RELAY_START", "RELAY_CANCEL", "RELAY_OPEN_PORTAL"]),
  method: z.enum(["key", "touch"]).optional(), attemptId: z.uuid().optional() });
const idle = { state: "idle", ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
const complete = { state: "complete", ceremonyObserved: true, portalAccepted: true, operatorConfirmed: true, exactCredentialRequestObserved: false };

async function optionsFixture(page: Page, unavailable = false) {
  const commands: z.infer<typeof CommandSchema>[] = [], closed: number[] = [];
  const fixture: { profile: ProfileOnboardingState; confirmReply?: ProfileOnboardingState; returnRefused: boolean } = {
    profile: ProfileOnboardingStateSchema.parse({ state: "onboarding", operationId: "00000000-0000-4000-8000-000000000001",
      profileId: "00000000-0000-4000-8000-000000000002", step: "duo", methods: { key: idle, touch: idle } }), returnRefused: false,
  };
  const files = ["options.html", "options.js", "relay-options.js", "styles.css", "icons/autopilot.svg", "icons/shield-check.svg"];
  await page.route("https://extension-fixture.invalid/**", async route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (file === "bridge") {
      const raw: unknown = route.request().postDataJSON(), command = CommandSchema.parse(raw); commands.push(command);
      if (command.type === "RELAY_CONFIRM" && fixture.confirmReply) fixture.profile = fixture.confirmReply;
      await route.fulfill({ json: unavailable || command.type === "RELAY_RETURN" && fixture.returnRefused
        ? { success: false } : { success: true, result: { relaySetup: true, profile: fixture.profile } } });
      return;
    }
    if (file === "close") {
      const raw: unknown = route.request().postDataJSON(), request = z.strictObject({ id: z.literal(9) }).parse(raw);
      closed.push(request.id); await route.fulfill({ json: {} }); return;
    }
    if (!files.includes(file)) throw new Error("unexpected extension fixture asset");
    await route.fulfill({ body: readFileSync(resolve("fast-duo/src", file)), contentType:
      file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "text/html" });
  });
  await page.addInitScript(() => {
    async function send(path: string, body: unknown): Promise<unknown> {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result: unknown = await response.json(); return result;
    }
    Reflect.set(window, "chrome", { runtime: { sendMessage: (message: unknown) => send("/bridge", message) },
      tabs: { async getCurrent() { return { id: 9 }; }, async remove(id: number) { await send("/close", { id }); } } });
  });
  return { fixture, commands, closed };
}

for (const theme of ["light", "dark"] as const) test(`Fast Duo sign-in method picker ${theme}`, {
  annotation: [{ type: "required-a11y-evidence", description: `fast-duo-options-${theme}.a11y.yml` }],
}, async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: theme });
  await optionsFixture(page);
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


test("Fast Duo setup keeps completion order, pending fences and Return failures distinct", {
  annotation: [{ type: "required-a11y-evidence", description: "fast-duo-actions.a11y.yml" }],
}, async ({ page }, info) => {
  const { fixture, commands, closed } = await optionsFixture(page);
  await page.goto("https://extension-fixture.invalid/options.html");
  const start = page.locator("#startCapture"), returning = page.getByRole("button", { name: "Return to Relay", exact: true });
  await expect(start).toBeEnabled();
  fixture.returnRefused = true; await returning.click();
  await expect(page.getByRole("alert")).toHaveText("Could not bring Relay forward. Select its window to review setup; do not repeat an unconfirmed attempt.");
  await expect(start).toBeDisabled();
  fixture.returnRefused = false; await returning.click(); await expect(page.getByRole("alert")).toBeHidden(); await expect(start).toBeEnabled();
  await page.getByRole("group", { name: "Sign-in method", exact: true }).getByRole("button", { name: "Touch ID", exact: true }).click();
  fixture.profile = ProfileOnboardingStateSchema.parse({ ...fixture.profile, methods: { key: idle, touch: complete } });
  await expect(page.locator('#transport [data-method="key"]')).toHaveAttribute("aria-pressed", "true");
  await expect(start).toHaveText("Set up Security key"); await expect(page.locator("button.primary:visible")).toHaveCount(1);
  const attemptId = "00000000-0000-4000-8000-000000000003";
  fixture.profile = ProfileOnboardingStateSchema.parse({ ...fixture.profile, methods: { key: { ...idle, state: "pending", attemptId }, touch: complete } });
  await expect(start).toBeHidden(); await expect(page.locator("#transport button").nth(0)).toBeDisabled(); await expect(page.locator("#transport button").nth(1)).toBeDisabled();
  fixture.profile = ProfileOnboardingStateSchema.parse({ ...fixture.profile, methods: { key: { ...fixture.profile.methods.key, ceremonyObserved: true }, touch: complete } });
  const confirm = page.getByRole("button", { name: "Duo added this device", exact: true });
  await expect(confirm).toBeEnabled(); await expect(page.locator("button.primary:visible")).toHaveCount(1);
  fixture.confirmReply = ProfileOnboardingStateSchema.parse({ ...fixture.profile, step: "ready", methods: { key: complete, touch: complete } });
  await confirm.click(); await expect(returning).toHaveClass("primary"); await expect(start).toBeHidden();
  await page.getByRole("button", { name: "Close setup tab", exact: true }).click();
  await expect.poll(() => closed).toEqual([9]);
  expect(commands.filter(command => command.type === "RELAY_RETURN")).toEqual([{ type: "RELAY_RETURN" }, { type: "RELAY_RETURN" }]);
  expect(commands.filter(command => command.type === "RELAY_CONFIRM")).toEqual([{ type: "RELAY_CONFIRM", method: "key", attemptId }]);
  expect(commands.filter(command => command.type === "RELAY_START")).toEqual([]);
  await attachShellA11y(page, info, "fast-duo-actions.a11y.yml");
});

test("Fast Duo setup can close its own tab when initial state is unavailable", {
  annotation: [{ type: "required-a11y-evidence", description: "fast-duo-unavailable-close.a11y.yml" }],
}, async ({ page }, info) => {
  const { closed } = await optionsFixture(page, true);
  await page.goto("https://extension-fixture.invalid/options.html");
  await expect(page.locator("#globalStatus")).toHaveText("Setup unavailable");
  await expect(page.locator("#accountList")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByText("Setup details are unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to Relay", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Close setup tab", exact: true }).click();
  await expect.poll(() => closed).toEqual([9]);
  await attachShellA11y(page, info, "fast-duo-unavailable-close.a11y.yml");
});
