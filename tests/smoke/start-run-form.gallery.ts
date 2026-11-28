/** The Start run Input form: one section gap between sections, one-line picker rows at the shared 28px, and the full name revealed on hover and on keyboard focus. */
import { expect, test } from "../support/helpers/dashboard/smoke/gallery-fixtures.js";
import { storyOf } from "../support/helpers/dashboard/smoke/story-catalogue.js";
import { LONG_NAME } from "../support/helpers/dashboard/smoke/stories/run-dialog-stories.js";
import { CATALOGUE } from "../support/helpers/dashboard/smoke/stories/catalogue.js";

async function open(mount: (id: string) => Promise<unknown>, page: import("@playwright/test").Page, name: string): Promise<void> {
  const id = `run-dialog/reference/${name}`;
  await page.setViewportSize({ width: 1280, height: 900 });
  await mount(id);
  await storyOf(CATALOGUE, id).play?.(page);
}

test("the Input form's sections sit one section gap apart", async ({ mount, page }) => {
  await open(mount, page, "pdfs-none-added");
  const gap = await page.evaluate(() => {
    const pdf = document.querySelector('section[aria-label="PDF documents"]')?.getBoundingClientRect();
    const refs = document.querySelector('[role="region"][aria-label="References"]')?.getBoundingClientRect();
    if (pdf === undefined || refs === undefined) throw new Error("the form sections are missing");
    const token = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ds-space-body-section-gap"));
    return { between: refs.top - pdf.bottom, token };
  });
  expect(gap.token).toBeGreaterThan(0);
  expect(gap.between).toBeGreaterThanOrEqual(gap.token);
});

test("a one-line picker row is 28px and shows a very long name whole on hover and keyboard focus", async ({ mount, page }) => {
  await open(mount, page, "long-name-menu");
  const row = page.getByRole("menuitem").filter({ hasText: "Roster" }).first();
  expect((await row.boundingBox())?.height).toBe(28);
  const whole = async (): Promise<void> => {
    const tip = page.getByRole("tooltip").filter({ hasText: LONG_NAME });
    await expect(tip).toBeVisible();
    const box = await tip.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, "the tooltip sits inside the viewport").toBe(true);
    expect(await tip.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight), "the whole name fits the tooltip").toBe(true);
  };
  await row.hover();
  await whole();
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toBeHidden();
  await page.getByRole("searchbox", { name: "Find a spreadsheet" }).press("ArrowDown");
  await whole();
});
