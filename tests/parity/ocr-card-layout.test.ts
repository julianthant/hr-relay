import { attachPresentationReference } from "./helpers/presentation-reference.js";
import { installFrozenMonotonic } from "./helpers/app-driver.js";

import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { createHash } from "node:crypto";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { chooseSelect } from "./helpers/select-choice.js";

for (const theme of PARITY_THEMES) for (const width of [1280]) {
  const a11yName = `oath-card-${theme.attribute}-${width}.a11y.yml`;
  test(`OCR card fields and unobstructed source controls @ ${theme.attribute}-${width}`, { annotation: [{ type: "required-a11y-evidence", description: a11yName }] }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    try {
      await page.setViewportSize({ width, height: 720 }); await installFrozenMonotonic(page); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
      await rail.getByRole("button", { name: "Oath Upload", exact: true }).click();
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await expect(page.getByRole("region", { name: "Queue", exact: true }).getByRole("heading", { name: "OCR", exact: true })).toHaveCount(0);
      await expect(rail.getByRole("button", { name: "OCR", exact: true })).toHaveAttribute("aria-current", "page");
      const logsUrl = page.url();
      await logs.locator("header").first().getByRole("button", { name: "Review", exact: true }).click();
      await expect(logs.getByRole("button", { name: /^Records \d+$/u })).toHaveAttribute("aria-pressed", "true");
      await expect(logs.getByRole("region", { name: "OCR records", exact: true })).toBeVisible();
      const recordsUrl = page.url();
      expect(recordsUrl).not.toBe(logsUrl);
      await page.goBack();
      await expect(page).toHaveURL(logsUrl);
      await expect(logs.getByRole("region", { name: "OCR records", exact: true })).toHaveCount(0);
      await expect(logs.locator("header").first().getByRole("button", { name: "Review", exact: true })).toBeVisible();
      await page.goForward();
      await expect(page).toHaveURL(recordsUrl);
      await expect(logs.getByRole("button", { name: /^Records \d+$/u })).toHaveAttribute("aria-pressed", "true");
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
      expect(before.controls.y + before.controls.height).toBeLessThanOrEqual(before.preview.y);
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
      const selection = fields.getByRole("group", { name: "Record selection", exact: true });
      const employee = fields.getByRole("group", { name: "Employee", exact: true });
      const oath = fields.getByRole("group", { name: "Oath", exact: true });
      await expect(fields.getByRole("group")).toHaveCount(3);
      for (const [card, title] of [[employee, "Employee"], [oath, "Oath"]] as const) {
        await expect(card.getByRole("heading")).toHaveCount(0);
        const heading = fields.getByRole("heading", { name: title, exact: true });
        const headingBounds = (await heading.boundingBox())!, cardBounds = (await card.boundingBox())!;
        expect(headingBounds.y + headingBounds.height).toBeLessThan(cardBounds.y);
        expect(headingBounds.x).toBe(cardBounds.x);
      }
      await expect(selection.getByRole("heading", { name: "Jordan Lee", exact: true })).toBeVisible();
      const include = selection.getByRole("checkbox", { name: "Include Jordan Lee", exact: true });
      const name = selection.getByRole("heading", { name: "Jordan Lee", exact: true });
      const includeBounds = (await include.boundingBox())!, nameBounds = (await name.boundingBox())!;
      expect(includeBounds.x + includeBounds.width).toBeLessThan(nameBounds.x);
      expect(Math.abs(includeBounds.y + includeBounds.height / 2 - nameBounds.y - nameBounds.height / 2)).toBeLessThanOrEqual(2);
      const groups = [selection, employee, oath];
      const bounds = await Promise.all(groups.map(group => group.boundingBox()));
      for (let index = 0; index < groups.length; index++) {
        expect(bounds[index]!.x).toBe(bounds[0]!.x);
        expect(bounds[index]!.width).toBe(bounds[0]!.width);
        expect(await groups[index].evaluate(node => getComputedStyle(node).borderTopStyle)).toBe("solid");
        if (index > 0) expect(bounds[index]!.y).toBeGreaterThan(bounds[index - 1]!.y + bounds[index - 1]!.height);
      }
      await expect(employee.getByRole("textbox", { name: "Employee ID", exact: true })).toHaveValue("10000001");
      await include.focus(); await page.keyboard.press("Space");
      await expect(drawer).toContainText("3 selected for approval");
      await page.keyboard.press("Space");
      await expect(drawer).toContainText("4 selected for approval");
      await expect(record.getByRole("textbox", { name: "Notes", exact: true })).toHaveCount(0);
      const employeeSigned = record.getByRole("checkbox", { name: "Employee signed", exact: true });
      const officerSigned = record.getByRole("checkbox", { name: "Officer signed", exact: true });
      if (width >= 1440) expect((await employeeSigned.boundingBox())!.y).toBe((await officerSigned.boundingBox())!.y);
      const originalSource = await image.getAttribute("src");
      await record.getByRole("textbox", { name: "Date signed", exact: true }).fill("4-24-26");
      await expect(image).toHaveAttribute("src", originalSource!);
      await cards.evaluate(node => node.scrollTo({ top: 0 }));
      const toolbarAtTop = (await controls.boundingBox())!, cardAtTop = (await record.boundingBox())!;
      await cards.evaluate(node => node.scrollTo({ top: 100 }));
      const scrolledControls = (await controls.boundingBox())!, scrolledCard = (await record.boundingBox())!;
      expect(scrolledControls.y - scrolledCard.y).toBeCloseTo(toolbarAtTop.y - cardAtTop.y, 5);
      await cards.evaluate(node => node.scrollTo({ top: 0 }));

      const a11y = await drawer.ariaSnapshot();
      await info.attach(a11yName, { body: a11y, contentType: "text/yaml" });
      info.annotations.push({ type: `a11y-attachment-sha256:${a11yName}`, description: createHash("sha256").update(a11y).digest("hex") });
      await rail.getByRole("button", { name: "I-9 Check", exact: true }).click();
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      const i9 = drawer.getByRole("region", { name: "Record person-1", exact: true });
      const pager = i9.getByRole("combobox", { name: "Source page", exact: true });
      await pager.click();
      await expect(page.getByRole("listbox")).toBeVisible();
      await attachPresentationReference(page, test.info(), "ocr-source-page-menu.png");
      await page.keyboard.press("Escape");
      await expect(pager).toContainText("Section 1 · Page 2");
      await expect(i9.getByRole("toolbar", { name: "PDF controls", exact: true }).getByRole("combobox")).toHaveCount(0);
      await i9.getByRole("button", { name: "Zoom in", exact: true }).click();
      await chooseSelect(pager, "1");
      await expect(i9.getByRole("img")).toHaveAccessibleName("Source page 1 of i9.pdf");
      await expect(i9.getByRole("button", { name: "Fit page", exact: true })).toBeDisabled();
      await expect(pager).toContainText("Section 2 · Page 1");
      const i9Controls = (await i9.getByRole("toolbar", { name: "PDF controls", exact: true }).boundingBox())!;
      const i9Preview = (await i9.locator("[data-review-preview]").boundingBox())!;
      expect(i9Controls.y + i9Controls.height).toBeLessThanOrEqual(i9Preview.y);
      await expect.poll(() => i9.getByRole("img").evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
      await i9.getByRole("button", { name: "Zoom in", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(i9.getByRole("button", { name: "Fit page", exact: true })).toBeEnabled();
      await i9.getByRole("button", { name: "Fit page", exact: true }).click();
      await expect(page.locator('[data-slot="select-content"]')).toBeHidden();

      await rail.getByRole("button", { name: "Emergency Contact", exact: true }).click();
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      const contact = drawer.getByRole("region", { name: "Record person-1", exact: true });
      await expect(contact.getByRole("textbox", { name: "Notes", exact: true })).toHaveCount(0);
      const street = contact.getByRole("textbox", { name: "Street", exact: true });
      const contactBody = street.locator('xpath=ancestor::*[@data-slot="card-content"]');
      const fieldContentWidth = await contactBody.evaluate(node => node.clientWidth - parseFloat(getComputedStyle(node).paddingLeft) - parseFloat(getComputedStyle(node).paddingRight));
      expect((await street.boundingBox())!.width).toBeCloseTo(fieldContentWidth, 0);
      const contactImage = contact.getByRole("img"), originalContactSource = await contactImage.getAttribute("src");
      await street.fill("200 Example Road");
      await expect(street).toHaveValue("200 Example Road");
      await expect(contactImage).toHaveAttribute("src", originalContactSource!);
      const contactSources = drawer.getByRole("region", { name: "Source PDF", exact: true });
      expect(await contactSources.count()).toBeGreaterThan(1);
      for (const contactSource of await contactSources.all()) {
        const contactControls = (await contactSource.getByRole("toolbar", { name: "PDF controls", exact: true }).boundingBox())!;
        const contactPreview = (await contactSource.locator("[data-review-preview]").boundingBox())!;
        expect(contactControls.y + contactControls.height).toBeLessThanOrEqual(contactPreview.y);
      }

      const queue = page.getByRole("region", { name: "Queue", exact: true });
      const deletes = queue.getByRole("button", { name: "Delete", exact: true });
      const initialCount = await deletes.count();
      expect(initialCount).toBeGreaterThan(0);
      for (let remaining = initialCount; remaining > 0; remaining--) {
        await deletes.first().click();
        await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
        await expect(deletes).toHaveCount(remaining - 1);
      }
      await expect(queue).toContainText("No OCR runs");
      await expect(queue).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
