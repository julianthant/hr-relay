import { expect, test } from "@playwright/test";
import { OCR_DOCUMENT_FIXTURES } from "../../src/dashboard/surfaces/workflow-document-model.js";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { chooseSelect } from "./helpers/select-choice.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`document-complete OCR queue, viewer and actions @ ${theme.attribute}-${width}`, async ({ page }, info) => {
    ensureParityBundle(); const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      await rail.getByRole("button", { name: "OCR", exact: true }).click();
      const queue = page.getByRole("region", { name: "Queue", exact: true }), logs = page.getByRole("region", { name: "Selected run logs", exact: true });
      await expect(queue.getByRole("button", { name: "Retry", exact: true })).toHaveCount(6);
      await expect(queue.getByRole("button", { name: "Delete", exact: true })).toHaveCount(6);
      const queueBox = (await queue.boundingBox())!, logsBox = (await logs.boundingBox())!;
      expect(Math.abs(queueBox.y + queueBox.height - logsBox.y - logsBox.height)).toBeLessThan(1);
      const aliases = await queue.locator("span[title]").allTextContents();
      expect(aliases.filter(value => /^OCR\d{8}$/u.test(value))).toHaveLength(6);
      await info.attach(`ocr-queue-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
      for (const doc of OCR_DOCUMENT_FIXTURES) {
        await queue.getByRole("button", { name: new RegExp(`^${doc.name.replaceAll(".", "\\.")} —`, "u") }).click();
        await logs.getByRole("button", { name: `Records ${doc.records.length}`, exact: true }).click();
        const editor = logs.getByRole("region", { name: "OCR records", exact: true }), source = editor.getByRole("region", { name: "Source PDF", exact: true });
        const image = source.getByRole("img");
        await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(500);
        const sourceBox = (await source.boundingBox())!, editorBox = (await editor.boundingBox())!;
        expect(sourceBox.width / editorBox.width).toBeGreaterThan(.59); expect(sourceBox.width / editorBox.width).toBeLessThan(.61);
        await expect(source.getByRole("banner")).toHaveCount(0); await expect(source).not.toContainText(doc.name);
        await expect(source.getByRole("toolbar", { name: "PDF controls", exact: true })).toBeVisible();
        for (const record of doc.records) {
          if (doc.records.length > 1) await chooseSelect(editor.getByRole("combobox", { name: "Record", exact: true }), record.id);
          await expect(image).toHaveAccessibleName(`Source page ${record.page} of ${doc.name}`);
          const fields = editor.getByRole("region", { name: `Record ${record.id}`, exact: true });
          const keys = await fields.locator("input[name]").evaluateAll(nodes => nodes.map(node => node.getAttribute("name")));
          for (const field of record.fields.filter(field => !field.kind || field.kind === "date")) expect(keys).toContain(field.key);
          const pages = record.kind === "i9" ? [record.page, Number(record.fields.find(field => field.key === "section2")!.value)] : record.kind === "separation" ? [1, 2, 3] : [record.page];
          if (pages.length > 1) for (const [index, number] of pages.entries()) {
            await chooseSelect(source.getByRole("combobox", { name: "Source page", exact: true }), String(index));
            await expect(image).toHaveAccessibleName(`Source page ${number} of ${doc.name}`);
            await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(500);
          }
        }
        await expect(page.locator('[data-slot="select-content"]:visible')).toHaveCount(0);
        await info.attach(`ocr-${doc.name}-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
        const overflow = await editor.evaluate(node => {
          const bounds = node.getBoundingClientRect();
          return [...node.querySelectorAll<HTMLElement>("input:not([aria-hidden=true]),button:not([aria-hidden=true]),section")].filter(element => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && (box.left < bounds.left - 1 || box.right > bounds.right + 1 || (element.tagName !== "INPUT" && element.scrollWidth > element.clientWidth + 1));
          }).map(element => element.getAttribute("aria-label") ?? element.tagName);
        });
        expect(overflow).toEqual([]);
        await logs.getByRole("button", { name: `Records ${doc.records.length}`, exact: true }).click();
      }
      const single = queue.getByRole("button", { name: /^single-oath.pdf —/u });
      await single.getByRole("button", { name: "Retry", exact: true }).focus(); await page.keyboard.press("Enter");
      const rerun = page.getByRole("dialog", { name: "Rerun", exact: true });
      await expect(rerun).toBeVisible(); await expect(rerun).toContainText("single-oath.pdf");
      await rerun.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(single.getByRole("button", { name: "Retry", exact: true })).toBeFocused();
      await single.getByRole("button", { name: "Delete", exact: true }).click();
      const deletion = page.getByRole("dialog", { name: "Delete single-oath.pdf?", exact: true });
      await deletion.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(single).toBeVisible();
      await expect(single.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
      await single.getByRole("button", { name: "Delete", exact: true }).click(); await deletion.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(single).toHaveCount(0); await expect(queue.getByRole("button", { name: "Retry", exact: true })).toHaveCount(5);
      await expect(queue.locator("[data-demo-row-id]").first()).toBeFocused();
      await rail.getByRole("button", { name: "I-9 Lookup", exact: true }).click();
      const lookupRetry = queue.getByRole("button", { name: "Retry", exact: true });
      await lookupRetry.click();
      await expect(rerun).toBeVisible();
      await expect(rerun.getByRole("complementary", { name: "Source run", exact: true })).toContainText("OnBase");
      await expect(rerun).toContainText("detect-test.pdf");
      await rerun.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(lookupRetry).toBeFocused();
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      const launcher = page.getByRole("dialog", { name: "Start a run", exact: true });
      await launcher.getByRole("navigation", { name: "Workflow", exact: true }).getByRole("button", { name: "Oath Upload", exact: true }).click();
      const pdf = launcher.getByLabel("PDFs", { exact: true }), roster = launcher.getByRole("button", { name: "Existing Onboarding Roster Roster", exact: true });
      const pdfBox = (await pdf.boundingBox())!, rosterBox = (await roster.boundingBox())!;
      expect(Math.abs(pdfBox.y - rosterBox.y)).toBeLessThan(2); expect(pdfBox.x + pdfBox.width).toBeLessThan(rosterBox.x);
      await expect(launcher).not.toContainText("The ticket waits for all signers");
      await expect(launcher).toHaveCSS("opacity", "1");
      await info.attach(`run-pdf-inputs-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
