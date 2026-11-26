/** Log search in real Chromium: the count is what is painted, one match is current, and moving to a match shows it. jsdom has no CSS.highlights. */
import { expect, test } from "../support/helpers/dashboard/smoke/gallery-fixtures.js";
import type { Page } from "@playwright/test";

/** How many ranges are painted, and whether the current one is inside the log's visible box. */
const painted = (page: Page) => page.evaluate(() => {
  const current = [...(CSS.highlights.get("log-match-current") ?? [])] as Range[];
  const box = current[0]?.getBoundingClientRect();
  const view = document.querySelector('[role="region"][aria-label="Run logs"]')?.getBoundingClientRect();
  return {
    current: current.length,
    total: current.length + (CSS.highlights.get("log-match")?.size ?? 0),
    inView: box !== undefined && view !== undefined && box.top >= view.top && box.bottom <= view.bottom,
  };
});

for (const [query, presses] of [["employ", 8], ["09/01", 1], ["UCPath", 6]] as const) {
  test(`log search for "${query}" counts, paints and shows each match`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await mount("run-panel/log-header/default");
    await page.getByRole("button", { name: "Search logs" }).click();
    const input = page.getByRole("textbox", { name: "Search logs" });
    await input.fill(query);
    const status = page.getByRole("search").getByRole("status");
    await expect(status).toHaveText(/^1 of \d+$/u);
    const total = Number((await status.textContent())?.split(" of ")[1]);
    for (let press = 0; press <= presses; press += 1) {
      await expect(status).toHaveText(`${String((press % total) + 1)} of ${String(total)}`);
      await expect.poll(() => painted(page)).toEqual({ current: 1, total, inView: true });
      await input.press("Enter");
    }
  });
}

for (const width of [1024, 1280, 1600]) {
  test(`search on a running dry-run child run keeps every header control inside the panel at ${width}`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 720 });
    await mount("run-panel/log-header/search-child");
    await page.getByRole("button", { name: "Search logs" }).click();
    const panel = page.getByRole("region", { name: "Selected run logs" });
    const edge = await panel.boundingBox();
    for (const control of [panel.getByRole("button", { name: "Close search" }), panel.getByRole("button", { name: "More actions" })]) {
      const box = await control.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(edge!.x + edge!.width);
    }
    expect((await panel.getByRole("heading", { level: 2 }).boundingBox())!.width).toBeGreaterThanOrEqual(96);
  });
}

for (const width of [1100, 1280, 1600]) {
  test(`with search closed the run title is not truncated at ${width}`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 720 });
    await mount("run-panel/log-header/search-child");
    const title = page.getByRole("region", { name: "Selected run logs" }).getByRole("heading", { level: 2 });
    await expect(title).toBeVisible();
    expect(await title.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  });
}

test("with search open at 1024 Tab runs from Back to More actions in drawn order", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await mount("run-panel/log-header/search-child");
  await page.getByRole("button", { name: "Search logs" }).click();
  const panel = page.getByRole("region", { name: "Selected run logs" });
  await panel.getByRole("button", { name: "Back to Emergency Contact batch" }).focus();
  const stops: { name: string; row: number; x: number }[] = [];
  for (let step = 0; step < 14; step++) {
    const stop = await page.evaluate(() => {
      const node = document.activeElement as HTMLElement;
      const box = node.getBoundingClientRect();
      return { name: node.getAttribute("aria-label") ?? node.textContent ?? "", row: Math.round(box.top / 20), x: box.left };
    });
    stops.push(stop);
    if (stop.name === "More actions") break;
    await page.keyboard.press("Tab");
  }
  expect(stops[0]!.name).toBe("Back to Emergency Contact batch");
  expect(stops.at(-1)!.name).toBe("More actions");
  expect(stops.some(stop => stop.name === "Search logs")).toBe(true);
  const drawn = [...stops].sort((a, b) => a.row - b.row || a.x - b.x);
  expect(stops.map(stop => stop.name)).toEqual(drawn.map(stop => stop.name));
});

test("a focused header button keeps focus while the header re-measures", async ({ mount, page }) => {
  await page.setViewportSize({ width: 1600, height: 720 });
  await mount("run-panel/log-header/search-child");
  const back = page.getByRole("button", { name: "Back to Emergency Contact batch" });
  await back.focus();
  for (const width of [1280, 1100, 900, 1280, 1600]) {
    await page.setViewportSize({ width, height: 720 });
    await expect(back).toBeFocused();
  }
});

test("the run menu closes on Escape and returns focus to its button", async ({ mount, page }) => {
  await mount("run-panel/log-header/default");
  const more = page.getByRole("button", { name: "More actions" });
  await more.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(more).toBeFocused();
});
