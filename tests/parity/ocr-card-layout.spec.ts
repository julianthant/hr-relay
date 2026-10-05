import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { chooseSelect } from "./helpers/select-choice.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440, 1920]) {
  test(`OCR card fields and anchored source controls @ ${theme.attribute}-${width}`, async ({ page }, info) => {
    ensureParityBundle(); const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
      await rail.getByRole("button", { name: "Oath Upload", exact: true }).click();
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      const drawer = logs.getByRole("region", { name: "OCR records", exact: true });
      const cards = drawer.locator('[aria-label="Record review cards"]');
      const record = drawer.getByRole("region", { name: "Record person-1", exact: true });
      const source = record.getByRole("region", { name: "Source PDF", exact: true });
      const image = source.getByRole("img");
      await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      const controls = source.getByRole("toolbar", { name: "PDF controls", exact: true });
      await expect(controls.getByRole("button")).toHaveCount(3);
      await expect(controls.getByRole("combobox")).toHaveCount(0);
      await expect(controls).not.toContainText("Page");
      await expect(source.getByText("Page 1", { exact: true })).toBeVisible();
      await expect(record.getByRole("checkbox", { name: "Include Jordan Lee", exact: true })).toBeChecked();
      await controls.scrollIntoViewIfNeeded();
      const before = {
        card: (await record.boundingBox())!, preview: (await source.locator("[data-review-preview]").boundingBox())!,
        controls: (await controls.boundingBox())!, image: (await image.boundingBox())!,
      };
      await source.getByRole("button", { name: "Zoom in", exact: true }).click();
      expect((await image.boundingBox())!.width).toBeGreaterThan(before.image.width);
      expect(await record.boundingBox()).toEqual(before.card);
      expect(await source.locator("[data-review-preview]").boundingBox()).toEqual(before.preview);
      expect(await controls.boundingBox()).toEqual(before.controls);
      const pan = source.locator('[aria-label="PDF page image"]');
      const offset = await pan.evaluate(node => { node.scrollTo({ left: 60, top: 80 }); return { x: node.scrollLeft, y: node.scrollTop }; });
      expect(offset.x).toBeGreaterThan(0); expect(offset.y).toBeGreaterThan(0);
      expect(await controls.boundingBox()).toEqual(before.controls);
      expect((await image.boundingBox())!.y).toBeLessThan(before.image.y);
      await source.getByRole("button", { name: "Fit page", exact: true }).click();
      expect((await image.boundingBox())!.width).toBe(before.image.width);
      expect(await pan.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }))).toEqual({ x: 0, y: 0 });
      const fields = record.locator("[data-review-fields]");
      const notes = record.getByRole("textbox", { name: "Notes", exact: true });
      await expect(notes).toHaveJSProperty("tagName", "TEXTAREA");
      const fieldContentWidth = await fields.evaluate(node => node.clientWidth - parseFloat(getComputedStyle(node).paddingLeft) - parseFloat(getComputedStyle(node).paddingRight));
      expect((await notes.boundingBox())!.width).toBeCloseTo(fieldContentWidth, 0);
      const employeeSigned = record.getByRole("checkbox", { name: "Employee signed", exact: true });
      const officerSigned = record.getByRole("checkbox", { name: "Officer signed", exact: true });
      if (width >= 1440) expect((await employeeSigned.boundingBox())!.y).toBe((await officerSigned.boundingBox())!.y);
      await notes.fill("Reviewed manually\nKeep the printed date.");
      await expect(notes).toHaveValue("Reviewed manually\nKeep the printed date.");
      const originalSource = await image.getAttribute("src");
      await record.getByRole("textbox", { name: "Date signed", exact: true }).fill("4-24-26");
      await expect(image).toHaveAttribute("src", originalSource!);
      await cards.evaluate(node => node.scrollTo({ top: 0 }));
      const toolbarAtTop = (await controls.boundingBox())!, cardAtTop = (await record.boundingBox())!;
      await cards.evaluate(node => node.scrollTo({ top: 100 }));
      const scrolledControls = (await controls.boundingBox())!, scrolledCard = (await record.boundingBox())!;
      expect(scrolledControls.y - scrolledCard.y).toBeCloseTo(toolbarAtTop.y - cardAtTop.y, 5);
      await cards.evaluate(node => node.scrollTo({ top: 0 }));
      await info.attach(`oath-card-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
      await info.attach(`oath-card-${theme.attribute}-${width}.yml`, { body: await drawer.ariaSnapshot(), contentType: "text/yaml" });
      await rail.getByRole("button", { name: "I-9 Check", exact: true }).click();
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      const i9 = drawer.getByRole("region", { name: "Record person-1", exact: true });
      const pager = i9.getByRole("combobox", { name: "Source page", exact: true });
      await expect(pager).toContainText("Section 1 · Page 2");
      await expect(i9.getByRole("toolbar", { name: "PDF controls", exact: true }).getByRole("combobox")).toHaveCount(0);
      await i9.getByRole("button", { name: "Zoom in", exact: true }).click();
      await chooseSelect(pager, "1");
      await expect(i9.getByRole("img")).toHaveAccessibleName("Source page 1 of i9.pdf");
      await expect(i9.getByRole("button", { name: "Fit page", exact: true })).toBeDisabled();
      await expect(pager).toContainText("Section 2 · Page 1");
      await expect(page.locator('[data-slot="select-content"]')).toBeHidden();
      await info.attach(`i9-card-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
