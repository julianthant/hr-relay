import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

// Sweep slice frames and text inventories (run detail, Logs panel, Explorer); output goes to the gitignored .work folder.
const OUT = `${process.env.NOTIFICATIONS_MOCK_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/next-20261101/notifications-mock"}/sweep`;
const THEMES = (process.env.NOTIFICATIONS_MOCK_THEMES ?? "light,dark").split(",") as ("light" | "dark")[];
test.use({ deviceScaleFactor: Number(process.env.NOTIFICATIONS_MOCK_SCALE ?? 1) });

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });

async function open(page: Page, query: string) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}${query}`);
  await page.getByRole("button", { name: "Close assistant", exact: true }).evaluate(el => (el as HTMLElement).click(), undefined, { timeout: 3000 }).catch(() => undefined);
  await page.addStyleTag({ content: ".hub-assistant-launcher { display: none !important; }" });
}

/** Distinct text styles inside a region: colour, size, weight, with a sample and a count. */
async function inventory(page: Page, name: string, theme: string, selector: string) {
  const rows = await page.locator(selector).first().evaluate(root => {
    const seen = new Map<string, { sample: string; count: number }>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const el = node.parentElement;
      if (!text || !el) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const css = getComputedStyle(el);
      const small = parseFloat(css.fontSize) < 12 ? ` <${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").slice(0, 60)}${css.textTransform === "uppercase" ? " CAPS" : ""}>` : "";
      const key = `${css.color} ${css.fontSize} ${css.fontWeight} ${css.fontFamily.split(",")[0]}${small}`;
      const entry = seen.get(key) ?? { sample: text.slice(0, 28), count: 0 };
      entry.count += 1; seen.set(key, entry);
    }
    return [...seen].map(([key, value]) => `${key} | ${value.count} | ${value.sample}`);
  });
  console.log(`INVENTORY ${name} ${theme}\n${rows.join("\n")}`);
}

/** Height, icon size and corner of every visible button in a region. */
async function buttons(page: Page, name: string, theme: string, selector: string) {
  const rows = await page.locator(selector).first().evaluate(root => [...root.querySelectorAll("button, a[role=button]")].filter(b => b.getBoundingClientRect().width > 0).map(b => {
    const box = b.getBoundingClientRect(); const svg = b.querySelector("svg")?.getBoundingClientRect(); const css = getComputedStyle(b);
    return `${(b.getAttribute("aria-label") ?? b.textContent ?? "").trim().slice(0, 28)} | ${Math.round(box.width)}x${Math.round(box.height)} | icon ${svg ? `${Math.round(svg.width)}` : "-"} | r ${css.borderRadius} | ${css.fontSize}/${css.fontWeight}`;
  }));
  console.log(`BUTTONS ${name} ${theme}\n${rows.join("\n")}`);
}

async function shot(page: Page, name: string, theme: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}-${theme}-1280.png` });
}

for (const theme of THEMES) test(`sweep @ ${theme}`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, theme);

  await open(page, "&notificationsPreview=centre");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.locator(".notification-panel").getByRole("button", { name: /Run waiting for you/ }).click();
  await expect(page.getByRole("heading", { name: /Morrow, Bea/ }).first()).toBeVisible();
  await page.mouse.move(1, 1);
  await shot(page, "logs-waiting", theme);
  await inventory(page, "logs-waiting", theme, ".dashboard-log-column");
  await buttons(page, "logs-waiting", theme, ".dashboard-log-column");

  await page.locator(".notification-panel").getByRole("button", { name: /Run failed/ }).click();
  await page.mouse.move(1, 1);
  await shot(page, "logs-failed", theme);
  await inventory(page, "logs-failed", theme, ".dashboard-log-column");
  await buttons(page, "logs-failed", theme, ".dashboard-log-column");

  await open(page, "&explore=fixture-ui-explorer");
  await page.mouse.move(1, 1);
  await shot(page, "explorer", theme);
  await inventory(page, "explorer", theme, "main");
  expect(errors).toEqual([]);
});
