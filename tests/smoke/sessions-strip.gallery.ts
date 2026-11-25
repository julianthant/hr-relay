/** The open Sessions panel is one row of equal cards that scrolls sideways and is as tall as one card, however many workers there are. */
import { expect, test } from "../support/helpers/dashboard/smoke/gallery-fixtures.js";
import type { Page } from "@playwright/test";
import { STATE_RULES } from "../support/helpers/dashboard/smoke/state-rules.js";
import { CATALOGUE } from "../support/helpers/dashboard/smoke/stories/catalogue.js";

const measure = (page: Page) => page.evaluate(() => {
  const strip = document.querySelector<HTMLElement>("[data-session-strip]");
  const body = document.querySelector(".session-body");
  if (strip === null || body === null) throw new Error("the Sessions panel is not open on its cards");
  const edge = strip.getBoundingClientRect();
  const cards = [...strip.querySelectorAll("article, li[aria-busy]")].map(card => card.getBoundingClientRect());
  return {
    tops: new Set(cards.map(card => Math.round(card.top))).size, heights: new Set(cards.map(card => Math.round(card.height))).size, cardHeight: Math.round(cards[0]?.height ?? 0),
    bodyHeight: Math.round(body.getBoundingClientRect().height), overflow: strip.scrollWidth - strip.clientWidth, scrolled: strip.scrollLeft,
    peeking: cards.some(card => card.left < edge.right - 1 && card.right > edge.right + 1),
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

for (const width of [1280, 1024]) {
  test(`eight workers keep one row and one card's height at ${String(width)}x720`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 720 });
    await mount("sessions/combination/mixed");
    const some = await measure(page);
    await mount("sessions/combination/all-states");
    const all = await measure(page);
    for (const seen of [some, all]) {
      expect(seen).toMatchObject({ tops: 1, heights: 1, page: 0 });
      expect(seen.overflow, "the row scrolls sideways").toBeGreaterThan(0);
      expect(seen.bodyHeight - seen.cardHeight, "the panel is its one card and the panel's padding").toBe(29);
    }
    // Two cards exactly fill the row at 1024, so there the third starts past its edge.
    if (width === 1280) expect(all.peeking, "the next card shows at the right edge").toBe(true);

    const strip = page.getByRole("group", { name: "Workers", exact: true });
    await strip.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await measure(page)).scrolled, { message: "the arrow keys scroll the row" }).toBeGreaterThan(0);
    const retry = strip.getByRole("article").filter({ hasText: "Failed" }).getByRole("button", { name: "Retry" });
    for (let presses = 0; presses < 40 && !(await retry.evaluate(button => button === document.activeElement)); presses += 1) await page.keyboard.press("Tab");
    await expect(retry, "Tab reaches a card past the edge").toBeFocused();
    await expect(retry).toBeInViewport({ ratio: 1 });
  });
}

test("the Starting card is first and the row's own shape", async ({ mount, page }) => {
  await mount("sessions/combination/adding");
  await expect(page.locator("[data-session-strip] > :first-child li[aria-busy]")).toContainText("Starting");
  expect(await measure(page)).toMatchObject({ tops: 1, heights: 1 });
});

test("a 340px-high window (680px at 200% zoom) keeps the open panel's worker controls reachable", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1280, height: 340 });
  await mount("sessions/combination/all-states");
  expect((await measure(page)).bodyHeight, "the open panel shows its cards").toBeGreaterThan(100);
  const retry = page.getByRole("group", { name: "Workers", exact: true }).getByRole("article").filter({ hasText: "Failed" }).getByRole("button", { name: "Retry" });
  await retry.focus();
  await expect(retry).toBeInViewport({ ratio: 1 });
});

// Title only, title and one line, and a line that wraps: the panel's top follows whatever the expanded stack's bottom is.
for (const [id, retry] of [["sessions/toast/stack", false], ["sessions/toast/stack-described", true], ["sessions/toast/stack-wrapped", true]] as const) {
  test(`at 340px high the expanded three-toast stack and the open panel do not cover each other: ${id}`, async ({ mount, page, diagnostics }) => {
    await page.setViewportSize({ width: 1280, height: 340 });
    const entry = CATALOGUE.find(item => item.id === id);
    if (entry === undefined) throw new Error(`the catalogue has no story ${id}`);
    await mount(id);
    await expect(page.locator('[data-slot="toast"]')).toHaveCount(3);
    await page.locator('[data-slot="toast"]').first().focus();
    await expect(page.locator('[data-slot="toast"][data-expanded]').first()).toBeVisible();
    await page.waitForTimeout(600);
    expect(await STATE_RULES["toast-placement"].check({ page, storyId: id, story: entry.story, diagnostics, dialogShapes: new Map() })).toEqual([]);
    if (!retry) return;
    const button = page.getByRole("group", { name: "Workers", exact: true }).getByRole("article").filter({ hasText: "Failed" }).getByRole("button", { name: "Retry" });
    await button.focus();
    await expect(button, "Retry stays reachable beneath the stack").toBeInViewport({ ratio: 1 });
  });
}
