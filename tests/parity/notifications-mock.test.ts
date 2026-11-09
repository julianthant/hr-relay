import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

// Notification centre mock frames and scene checks; output goes to the gitignored .work folder.
const OUT = process.env.NOTIFICATIONS_MOCK_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/next-20261101/notifications-mock";
const THEMES = (process.env.NOTIFICATIONS_MOCK_THEMES ?? "light,dark").split(",") as ("light" | "dark")[];
test.use({ deviceScaleFactor: Number(process.env.NOTIFICATIONS_MOCK_SCALE ?? 1) });

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });

const bell = (page: Page) => page.getByRole("button", { name: /^Notifications/ });
const panel = (page: Page) => page.locator(".notification-panel");

async function open(page: Page, scenario: string, extra = "") {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&notificationsPreview=${scenario}${extra}`);
  await expect(page.getByRole("navigation", { name: "Workflows", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close assistant", exact: true }).evaluate(el => (el as HTMLElement).click(), undefined, { timeout: 3000 }).catch(() => undefined);
  await page.addStyleTag({ content: ".hub-assistant-launcher { display: none !important; }" });
}

async function shot(page: Page, name: string, theme: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}-${theme}-1280.png` });
}

for (const theme of THEMES) test(`notification centre @ ${theme}`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, theme);

  await open(page, "centre");
  await page.mouse.move(1, 1);
  await shot(page, "bell-unread", theme);
  await expect(bell(page).getByTestId("notification-unread-dot")).toBeVisible();
  await bell(page).click();
  await expect(panel(page)).toBeVisible();
  await page.waitForTimeout(400);
  expect((await panel(page).locator("xpath=ancestor::*[contains(@class,'ds-menu-surface')]").boundingBox())?.width).toBe(380);
  await expect(panel(page).getByText("Today", { exact: true })).toBeVisible();
  await expect(panel(page).getByText("Earlier", { exact: true })).toBeVisible();
  await page.mouse.move(1, 1);
  await shot(page, "panel-mixed", theme);
  await panel(page).getByRole("button", { name: /Run waiting for you/ }).hover();
  await shot(page, "panel-hover", theme);

  await panel(page).getByRole("button", { name: "Mark all read" }).click();
  await expect(panel(page).getByRole("button", { name: "Mark all read" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(bell(page).getByTestId("notification-unread-dot")).toHaveCount(0);

  await open(page, "centre");
  await bell(page).click();
  await panel(page).getByRole("button", { name: /Your disk is full/ }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page.locator(".ds-page-heading-title", { hasText: "General" })).toBeVisible();
  await page.getByRole("button", { name: /^(Back|Close settings)/ }).first().click();
  await expect(bell(page).getByTestId("notification-unread-dot")).toBeVisible();
  await bell(page).click();
  await expect(panel(page).getByRole("button", { name: /Your disk is full/ }).locator(".notification-unread-dot")).toHaveAttribute("data-read", "true");

  await open(page, "centre-earlier");
  await bell(page).click();
  await expect(panel(page).getByText("Today", { exact: true })).toHaveCount(0);
  await expect(bell(page).getByTestId("notification-unread-dot")).toHaveCount(0);
  await page.mouse.move(1, 1);
  await shot(page, "panel-earlier", theme);

  await open(page, "empty");
  await bell(page).click();
  await expect(panel(page).getByText("You're all caught up.")).toBeVisible();
  await shot(page, "panel-empty", theme);

  await open(page, "centre", "&statusMock=toasts-live");
  await page.evaluate(() => (Reflect.get(window, "relayFireToast") as (toast: object) => void)({ tone: "danger", title: "Your disk is full", description: "Free up space; Relay cannot save.", sticky: true }));
  await bell(page).click();
  await expect(panel(page)).toBeVisible();
  await page.mouse.move(1, 1);
  await shot(page, "toast-and-panel", theme);
  expect(errors).toEqual([]);
});
