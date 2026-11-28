/** The assistant's attribution line shows whole in the Queue row and the Logs header at the supported widths, and a dashboard-started row has none. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, STATE_FRAMES_DIR, test } from "../support/helpers/dashboard/smoke/gallery-fixtures.js";

const LINE = /^Started by the assistant for .+ · read only$/;

for (const width of [1280, 1600]) {
  test.describe(`at ${String(width)}px`, () => {
    test.use({ viewport: { width, height: 720 } });
    for (const story of ["queue/row/assistant-started", "run-panel/log-header/assistant-started"]) {
      test(`${story} shows the whole line`, async ({ mount, page }) => {
        await mount(story);
        const line = page.locator("[data-started-by]");
        await expect(line).toHaveCount(1);
        await expect(line).toHaveText(LINE);
        expect(await line.evaluate(element => element.scrollWidth <= element.clientWidth), "the line is not truncated").toBe(true);
        mkdirSync(STATE_FRAMES_DIR, { recursive: true });
        await page.screenshot({ path: join(STATE_FRAMES_DIR, `started-by-${story.replaceAll("/", "-")}-${String(width)}.png`), animations: "disabled" });
      });
    }
    test("a dashboard-started row has no line", async ({ mount, page }) => {
      await mount("queue/status/done");
      await expect(page.locator("[data-started-by]")).toHaveCount(0);
      mkdirSync(STATE_FRAMES_DIR, { recursive: true });
      await page.screenshot({ path: join(STATE_FRAMES_DIR, `started-by-queue-dashboard-started-${String(width)}.png`), animations: "disabled" });
    });
  });
}

for (const width of [1024, 1280]) {
  test.describe(`a long operator name with dry-run chips at ${String(width)}px`, () => {
    test.use({ viewport: { width, height: 720 } });
    test("the Logs header keeps the whole line on its own line under the run name", async ({ mount, page }) => {
      await mount("run-panel/log-header/assistant-started-long");
      const line = page.locator("[data-started-by]");
      await expect(line).toHaveText(/^Started by the assistant for Alexandria Montgomery-Rivera.+ · read only$/);
      await expect(page.getByText("Dry run", { exact: true })).toBeVisible();
      const header = line.locator("xpath=ancestor::header");
      const [text, title, box] = await Promise.all([line.boundingBox(), header.locator("h2").boundingBox(), header.boundingBox()]);
      expect(text && title && box, "boxes").toBeTruthy();
      if (text && title && box) {
        expect(text.y, "under the run name").toBeGreaterThanOrEqual(title.y + title.height - 1);
        expect(text.x + text.width, "inside the header").toBeLessThanOrEqual(box.x + box.width + 0.5);
      }
      expect(await line.evaluate(element => element.scrollWidth <= element.clientWidth), "the line is not clipped").toBe(true);
      mkdirSync(STATE_FRAMES_DIR, { recursive: true });
      await page.screenshot({ path: join(STATE_FRAMES_DIR, `started-by-log-header-long-${String(width)}.png`), animations: "disabled" });
    });
  });
}
