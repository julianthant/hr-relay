import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { MOCK_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

// Sweep slice frames and text inventories (run detail, Logs panel, Explorer); output goes to the gitignored .work folder.
const OUT = `${process.env.NOTIFICATIONS_MOCK_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/next-20261101/notifications-mock"}/sweep`;
const THEMES = (process.env.NOTIFICATIONS_MOCK_THEMES ?? "light,dark").split(",") as ("light" | "dark")[];
test.use({ deviceScaleFactor: Number(process.env.NOTIFICATIONS_MOCK_SCALE ?? 1) });

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: MOCK_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });

async function open(page: Page, query: string) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}${query}`);
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
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);

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

  const card = page.locator("form[aria-label=\"Search CRM employee record\"]").first();
  await card.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  await shot(page, "failure-card", theme);
  await inventory(page, "failure-card", theme, "form[aria-label=\"Search CRM employee record\"]");
  await buttons(page, "failure-card", theme, "form[aria-label=\"Search CRM employee record\"]");

  await open(page, "");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.locator(".notification-panel").getByRole("button", { name: /Records ready for approval.*Emergency Contact/ }).click();
  await expect(page.getByRole("region", { name: "OCR records", exact: true })).toBeVisible();
  await page.mouse.move(1, 1);
  await shot(page, "review", theme);
  await inventory(page, "review", theme, "[aria-label='OCR records']");
  await buttons(page, "review", theme, "[aria-label='OCR records']");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /^Review records/ })).toHaveCount(0);
  // A truncated timeline label shows its full step name in the shared tooltip on hover and on focus.
  const labels = page.getByRole("navigation", { name: "Run timeline" }).locator("button");
  const cut = await labels.evaluateAll(buttons => buttons.map(button => { const text = button.querySelector("span.truncate"); return text !== null && text.scrollWidth > text.clientWidth ? button.getAttribute("aria-label")?.split(" · ")[0] ?? "" : ""; }));
  console.log(`TRUNCATED ${theme} ${JSON.stringify(cut)}`);
  const index = cut.findIndex(Boolean);
  expect(index).toBeGreaterThanOrEqual(0);
  await labels.nth(index).hover();
  await expect(page.getByText(cut[index], { exact: true }).and(page.locator(".log-step-card-title")).first()).toBeVisible();
  await shot(page, "timeline-tooltip", theme);
  await page.mouse.move(1, 1);
  await labels.nth(index).focus();
  await expect(page.getByText(cut[index], { exact: true }).and(page.locator(".log-step-card-title")).first()).toBeVisible();
  await page.mouse.move(1, 1);

  // The step strip fits the log column at 1280 and 1024: no clipped or scrolling last column.
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 720 });
    await page.waitForTimeout(300);
    const fit = await page.getByRole("navigation", { name: "Run timeline" }).evaluate(nav => {
      const box = nav.getBoundingClientRect(); const last = [...nav.querySelectorAll("button")].at(-1)?.getBoundingClientRect();
      return { overflow: nav.scrollWidth - nav.clientWidth, lastRight: last ? Math.round(last.right) : 0, navRight: Math.round(box.right) };
    });
    console.log(`STRIP ${theme} ${width} ${JSON.stringify(fit)}`);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.lastRight).toBeLessThanOrEqual(fit.navRight);
    // Header and footer stay on one row (a 28px control row) at both widths.
    const rows = await page.getByRole("region", { name: "Selected run logs" }).evaluate(root => ({ header: Math.round(root.querySelector("header")!.getBoundingClientRect().height), footer: Math.round(root.querySelector("footer")!.getBoundingClientRect().height) }));
    console.log(`ROWS ${theme} ${width} ${JSON.stringify(rows)}`);
    expect(rows).toEqual({ header: 53, footer: 49 });
    // Row values keep their width: at 1024 they truncate and the tooltip shows the whole value.
    const value = page.locator("[data-log-field] dd", { hasText: "emergency-contacts.pdf" }).first();
    const metrics = await value.evaluate(node => ({ width: Math.round(node.getBoundingClientRect().width), cut: node.scrollWidth > node.clientWidth, card: Math.round(node.closest("[data-log-field]")!.getBoundingClientRect().width) }));
    console.log(`VALUE ${theme} ${width} ${JSON.stringify(metrics)}`);
    expect(metrics.width).toBeGreaterThan(60);
    if (width === 1024) {
      expect(metrics.cut).toBe(true);
      await value.hover();
      await expect(page.getByRole("tooltip").getByText("emergency-contacts.pdf", { exact: true })).toBeVisible();
    }
    // The single-action pill wraps to at most two lines at 1024 (no own timestamp).
    const pill = await page.getByLabel("Selected run logs").getByText("Split pages and recognize the form blocks", { exact: true }).evaluate(node => Math.round(node.closest("span")!.getBoundingClientRect().height));
    console.log(`PILL ${theme} ${width} ${pill}`);
    if (width === 1024) expect(pill).toBeLessThan(60);
    await page.screenshot({ path: `${OUT}/timeline-strip-${theme}-${width}.png` });
    await page.mouse.move(1, 1);
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  await open(page, "&explore=fixture-ui-explorer");
  await page.mouse.move(1, 1);
  await shot(page, "explorer", theme);
  await inventory(page, "explorer", theme, "main");
  await buttons(page, "explorer", theme, "main");
  expect(errors).toEqual([]);
});
