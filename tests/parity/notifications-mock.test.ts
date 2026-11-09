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
const rowDot = (page: Page, name: RegExp) => panel(page).locator("li").filter({ has: page.getByRole("button", { name }) }).locator(".notification-unread-dot");
const hoverRow2 = (page: Page, name: RegExp) => panel(page).locator("li").filter({ has: page.getByRole("button", { name }) });
const dot = (page: Page) => bell(page).getByTestId("notification-unread-dot");

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

  // Workflows with the bell's unread dot; the bell swaps the sidebar body to the list.
  // Any statusMock URL shows the mock Settings pages, so Subscription exists.
  await open(page, "centre", "&statusMock=toasts-live");
  await page.mouse.move(1, 1);
  await shot(page, "bell-unread", theme);
  await expect(dot(page)).toBeVisible();
  await expect(bell(page)).toHaveAttribute("aria-pressed", "false");
  await bell(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(bell(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("navigation", { name: "Workflows", exact: true })).toHaveCount(0);
  for (const label of ["Priority", "Today", "Yesterday", "Friday", "November 3"]) await expect(panel(page).getByRole("heading", { name: label, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to workflows" })).toHaveCount(0);
  const m = await page.locator(".workspace-rail").evaluate(rail => {
    const box = rail.getBoundingClientRect();
    const rect = (q: string, n = 0) => rail.querySelectorAll(q)[n].getBoundingClientRect();
    const rows = [...rail.querySelectorAll(".notification-item")].map(row => row.getBoundingClientRect());
    const labels = [...rail.querySelectorAll(".notification-group-label")].map(label => label.getBoundingClientRect());
    return { width: box.width, header: rect("h2").left - box.left, label: labels[0].left - box.left, text: rect(".notification-item-title").left - box.left,
      dotCentre: rect(".notification-unread-dot").left + 3 - box.left, dotMiddle: rect(".notification-unread-dot").top + 3 - (rect(".notification-item-title").top + 12.5),
      readTagRight: box.right - 1 - rect(".notification-item-tag", 3).right, menuCentre: box.right - 1 - (rect(".notification-group-head button").left + rect(".notification-group-head button").width / 2),
      pitch: rows[1].top - rows[0].top, rowHeight: rows[0].height, labelToTitle: rect(".notification-item-title", 4).top + 10 - (labels[1].top + 10), icons: rail.querySelectorAll(".notification-item svg").length, bellHeader: rect(".workspace-rail-header").height,
      titleToPreview: rect(".notification-item-line").top - rect(".notification-item-title").top, previewLine: parseFloat(getComputedStyle(rail.querySelector(".notification-item-line")!).lineHeight),
      size: [".notification-item-title", ".notification-group-label", ".notification-item-line", ".notification-item-tag"].map(q => getComputedStyle(rail.querySelector(q)!).fontSize + "/" + getComputedStyle(rail.querySelector(q)!).fontWeight),
      buttons: [rect(".rail-notification-toggle"), rect(".workspace-rail-header button:not(.rail-notification-toggle)"), rect(".notification-group-head button")].map(r => `${r.width}x${r.height}`),
      headerCentres: [rect(".rail-notification-toggle"), rect(".workspace-rail-header button:not(.rail-notification-toggle)"), rect(".notification-group-head button")].map(r => box.right - 1 - (r.left + r.width / 2)) };
  });
  console.log(`MEASURE ${theme} ${JSON.stringify(m)}`);
  expect(m.width).toBe(312);
  await expect(page.locator(".workspace-rail-header h2")).toHaveCSS("font-size", "18px");
  await expect(page.locator(".workspace-rail-header h2")).toHaveCSS("font-weight", "600");
  expect(m.icons).toBe(0);
  expect(m.dotCentre).toBe(8);
  await expect(page.locator(".notification-unread-dot").first()).toBeVisible();
  expect(Math.abs(m.dotMiddle)).toBeLessThanOrEqual(1);
  // Row hover: the tag gives way to Mark as read / Dismiss (Priority rows only get the read toggle); header icons fill on hover.
  const hoverRow = (name: RegExp) => panel(page).locator("li").filter({ has: page.getByRole("button", { name }) });
  await hoverRow(/Relay is open in another window/).hover();
  await expect(hoverRow(/Relay is open in another window/).getByRole("button", { name: "Mark as unread" })).toBeVisible();
  await expect(hoverRow(/Relay is open in another window/).getByRole("button", { name: "Dismiss" })).toBeVisible();
  await expect(hoverRow(/Relay is open in another window/).locator(".notification-item-tag")).toHaveCSS("visibility", "hidden");
  await shot(page, "row-hover", theme);
  await hoverRow(/Your disk is full/).hover();
  await expect(hoverRow(/Your disk is full/).getByRole("button", { name: "Dismiss" })).toBeHidden();
  await page.getByRole("button", { name: "Search runs" }).hover();
  await expect(page.getByRole("tooltip")).toContainText("Search");
  await shot(page, "search-hover", theme);
  await panel(page).getByRole("button", { name: "Notification actions" }).hover();
  await shot(page, "menu-button-hover", theme);
  await page.mouse.move(1, 1);
  await shot(page, "panel-mixed", theme);
  await panel(page).getByRole("button", { name: /Run waiting for you/ }).hover();
  await shot(page, "panel-hover", theme);

  // A storage item just marks read: no navigation, the list stays.
  await panel(page).getByRole("button", { name: /Your disk is full/ }).click();
  await expect(rowDot(page, /Your disk is full/)).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
  await expect(page.locator(".ds-page-heading-title")).toHaveCount(0);

  // A run item opens its Logs in the main area; the sidebar stays on Notifications.
  await panel(page).getByRole("button", { name: /Run waiting for you/ }).click();
  await expect(panel(page)).toBeVisible();
  await expect(rowDot(page, /Run waiting for you/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Morrow, Bea/ }).first()).toBeVisible();
  await page.mouse.move(1, 1);
  await expect(panel(page).getByRole("button", { name: /Run waiting for you/ })).toHaveAttribute("aria-current", "true");
  await shot(page, "run-clicked", theme);

  // A ChatGPT item opens Settings > Subscription; the read marks survive the visit.
  await panel(page).getByRole("button", { name: /ChatGPT usage limit reached/ }).click();
  await expect(page.locator(".ds-page-heading-title", { hasText: "Subscription" })).toBeVisible();
  await shot(page, "settings-sidebar", theme);
  await page.getByRole("button", { name: /^(Back|Close settings)/ }).first().click();
  await expect(panel(page).getByRole("button", { name: /ChatGPT usage limit reached/ })).toHaveAttribute("aria-current", "true");
  await expect(panel(page).getByRole("button", { name: /Run waiting for you/ })).not.toHaveAttribute("aria-current", "true");
  await expect(rowDot(page, /ChatGPT usage limit reached/)).toHaveCount(0);

  // The ··· menu: unread variant, then Mark all as read, then Escape returns to workflows.
  await open(page, "centre");
  await bell(page).click();
  await panel(page).getByRole("button", { name: "Notification actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Mark all as read" })).toBeEnabled();
  await page.mouse.move(1, 1);
  await shot(page, "menu-open", theme);
  const menuBox = await page.getByRole("menu").evaluate(menu => { const r = menu.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const buttonBox = await panel(page).getByRole("button", { name: "Notification actions" }).evaluate(b => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  console.log(`MENU ${theme} ${JSON.stringify({ width: menuBox.width, leftOfButtonCentre: buttonBox.x + buttonBox.width / 2 - menuBox.x, below: menuBox.y - (buttonBox.y + buttonBox.height) })}`);
  await page.getByRole("menuitem", { name: "Mark all as read" }).click();
  await expect(dot(page)).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Workflows", exact: true })).toBeVisible();

  // Bell tooltip: shared tooltip, no shortcut chip.
  await bell(page).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Notifications");
  await shot(page, "bell-tooltip", theme);

  await open(page, "centre-resolved");
  await bell(page).click();
  await expect(panel(page).getByText("Nothing needs attention")).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(dot(page)).toHaveCount(0);
  await page.mouse.move(1, 1);
  await shot(page, "panel-priority-empty", theme);
  // All read: Mark all as read is disabled; the Priority section check hides and shows the section.
  await panel(page).getByRole("button", { name: "Notification actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Mark all as read" })).toBeDisabled();
  await expect(page.getByRole("menuitemcheckbox", { name: "Priority section" })).toHaveAttribute("aria-checked", "true");
  await page.mouse.move(1, 1);
  await shot(page, "menu-open-all-read", theme);
  await page.getByRole("menuitemcheckbox", { name: "Priority section" }).click();
  await expect(panel(page).getByRole("heading", { name: "Priority", exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Notification actions" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Notification actions" }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Priority section" })).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");

  // Dismiss removes a day-group row and marks it read.
  await open(page, "centre");
  await bell(page).click();
  await hoverRow2(page, /Relay repaired a saved file/).hover();
  await hoverRow2(page, /Relay repaired a saved file/).getByRole("button", { name: "Dismiss" }).click();
  await expect(panel(page).getByRole("button", { name: /Relay repaired a saved file/ })).toHaveCount(0);

  await open(page, "empty");
  await bell(page).click();
  await expect(panel(page).getByText("Nothing needs attention")).toBeVisible();
  await expect(panel(page).locator(".notification-group")).toHaveCount(1);
  await shot(page, "panel-empty", theme);

  await open(page, "centre", "&statusMock=toasts-live");
  await page.evaluate(() => (Reflect.get(window, "relayFireToast") as (toast: object) => void)({ tone: "danger", title: "Your disk is full", description: "Free up space; Relay cannot save.", sticky: true }));
  await bell(page).click();
  await expect(panel(page)).toBeVisible();
  await page.mouse.move(1, 1);
  await shot(page, "toast-and-panel", theme);
  expect(errors).toEqual([]);
});
