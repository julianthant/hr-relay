import { installFrozenMonotonic } from "./helpers/app-driver.js";

import { expect, test } from "@playwright/test";
import { OCR_DOCUMENT_FIXTURES } from "../../src/dashboard/surfaces/workflows/mocks/workflow-document-model.js";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { chooseSelect } from "./helpers/select-choice.js";
import { attachShellA11y } from "./helpers/shell-proof.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const queueEvidence = `ocr-queue-${theme.attribute}-${width}.a11y.yml`;
  const inputEvidence = `run-pdf-inputs-${theme.attribute}-${width}.a11y.yml`;
  const documentEvidence = (name: string) => `ocr-${name}-${theme.attribute}-${width}.a11y.yml`;
  test(`document-complete OCR queue, viewer and actions @ ${theme.attribute}-${width}`, {
    annotation: [queueEvidence, inputEvidence, ...OCR_DOCUMENT_FIXTURES.map(doc => documentEvidence(doc.name))].map(description => ({ type: "required-a11y-evidence", description })),
  }, async ({ page }, info) => {
    ensureParityBundle(); const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installFrozenMonotonic(page); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      await rail.getByRole("button", { name: "OCR", exact: true }).click();
      const queue = page.getByRole("region", { name: "Queue", exact: true }), logs = page.getByRole("region", { name: "Selected run logs", exact: true });
      await expect(queue.getByRole("button", { name: "Retry", exact: true })).toHaveCount(5);
      await expect(queue.getByRole("button", { name: "Delete", exact: true })).toHaveCount(5);
      await expect(queue).not.toContainText("sick-hours.pdf");
      const queueBox = (await queue.boundingBox())!, logsBox = (await logs.boundingBox())!;
      expect(Math.abs(queueBox.y + queueBox.height - logsBox.y - logsBox.height)).toBeLessThan(1);
      const aliases = await queue.locator("span[title]").allTextContents();
      expect(aliases.filter(value => /^OCR\d{8}$/u.test(value))).toHaveLength(5);

      await attachShellA11y(page, info, queueEvidence);
      for (const doc of OCR_DOCUMENT_FIXTURES) {
        await queue.getByRole("button", { name: new RegExp(`^${doc.name.replaceAll("./", "\\.")} —`, "u") }).click();
        await logs.getByRole("button", { name: `Records ${doc.records.length}`, exact: true }).click();
        const editor = logs.getByRole("region", { name: "OCR records", exact: true });
        const body = editor.locator('[aria-label="Record review cards"]');
        await expect(editor.getByRole("combobox", { name: "Record", exact: true })).toHaveCount(0);
        await expect(editor.locator("[data-review-record-id]")).toHaveCount(doc.records.length);
        await expect(editor.getByRole("button", { name: "Approve records", exact: true })).toHaveCount(1);
        const scroll = await body.evaluate(node => ({ height: node.clientHeight, content: node.scrollHeight, overflow: getComputedStyle(node).overflowY }));
        expect(scroll.overflow).toBe("auto");
        if (doc.records.length > 1) expect(scroll.content).toBeGreaterThan(scroll.height);
        let bottom = -Infinity;
        for (const record of doc.records) {
          const card = editor.getByRole("region", { name: `Record ${record.id}`, exact: true });
          const cardBox = (await card.boundingBox())!;
          expect(cardBox.y).toBeGreaterThan(bottom); bottom = cardBox.y + cardBox.height;
        }
        for (const record of doc.records) {
          const fields = editor.getByRole("region", { name: `Record ${record.id}`, exact: true });
          const source = fields.getByRole("region", { name: "Source PDF", exact: true }), image = source.getByRole("img");
          await image.scrollIntoViewIfNeeded();
          await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(500);
          const sourceBox = (await source.boundingBox())!, cardBox = (await fields.boundingBox())!;
          expect(sourceBox.width / cardBox.width).toBeGreaterThan(.59); expect(sourceBox.width / cardBox.width).toBeLessThan(.61);
          const fieldsBox = (await fields.locator("[data-review-fields]").boundingBox())!;
          expect(sourceBox.x + sourceBox.width).toBeLessThanOrEqual(fieldsBox.x);
          expect(Math.abs(sourceBox.y - fieldsBox.y)).toBeLessThan(1);
          await expect(source.getByRole("banner")).toHaveCount(0); await expect(source).not.toContainText(doc.name);
          await expect(source.getByRole("toolbar", { name: "PDF controls", exact: true })).toBeVisible();
          await expect(image).toHaveAccessibleName(`Source page ${record.page} of ${doc.name}`);
          const keys = await fields.locator("input[name],textarea[name]").evaluateAll(nodes => nodes.map(node => node.getAttribute("name")));
          for (const field of record.fields.filter(field => !field.kind || field.kind === "date")) expect(keys).toContain(field.key);
          const pages = record.kind === "i9" ? [record.page, Number(record.fields.find(field => field.key === "section2")!.value)] : [record.page];
          if (pages.length > 1) for (const [index, number] of pages.entries()) {
            await chooseSelect(source.getByRole("combobox", { name: "Source page", exact: true }), String(index));
            await expect(source.getByRole("combobox", { name: "Source page", exact: true })).toContainText(`Section ${index + 1} · Page ${number}`);
            await expect(image).toHaveAccessibleName(`Source page ${number} of ${doc.name}`);
            await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(500);
          }
        }
        await expect(editor.getByRole("button", { name: "Approve records", exact: true })).toBeInViewport();
        await expect(page.locator('[data-slot="select-content"]:visible')).toHaveCount(0);

        await attachShellA11y(page, info, documentEvidence(doc.name));
        const overflow = await editor.evaluate(node => {
          const bounds = node.getBoundingClientRect();
          return [...node.querySelectorAll<HTMLElement>("input:not([aria-hidden=true]),textarea,button:not([aria-hidden=true]),section")].filter(element => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && (box.left < bounds.left - 1 || box.right > bounds.right + 1 || (!["INPUT", "TEXTAREA"].includes(element.tagName) && element.scrollWidth > element.clientWidth + 1));
          }).map(element => element.getAttribute("aria-label") ?? element.tagName);
        });
        expect(overflow).toEqual([]);
        await logs.getByRole("button", { name: `Records ${doc.records.length}`, exact: true }).click();
      }
      const single = queue.getByRole("button", { name: /^single-oath.pdf —/u });
      await single.getByRole("button", { name: "Retry", exact: true }).focus(); await page.keyboard.press("Enter");
      const rerun = page.getByRole("dialog", { name: "Rerun", exact: true });
      await expect(rerun).toBeVisible();
      await rerun.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(rerun.getByRole("list", { name: "Selected PDFs", exact: true })).toContainText("single-oath.pdf");
      await rerun.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(single.getByRole("button", { name: "Retry", exact: true })).toBeFocused();
      await single.getByRole("button", { name: "Delete", exact: true }).click();
      const deletion = page.getByRole("dialog", { name: "Delete single-oath.pdf?", exact: true });
      await deletion.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(single).toBeVisible();
      await expect(single.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
      await single.getByRole("button", { name: "Delete", exact: true }).click(); await deletion.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(single).toHaveCount(0); await expect(queue.getByRole("button", { name: "Retry", exact: true })).toHaveCount(4);
      await expect(queue.locator("[data-demo-row-id]").first()).toBeFocused();
      await rail.getByRole("button", { name: "I-9 Lookup", exact: true }).click();
      const lookupRetry = queue.getByRole("button", { name: "Retry", exact: true });
      await lookupRetry.click();
      await expect(rerun).toBeVisible();
      await expect(rerun).toContainText("OnBase · Workflow preview");
      await rerun.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(rerun.getByRole("list", { name: "Selected PDFs", exact: true })).toContainText("detect-test.pdf");
      await rerun.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(lookupRetry).toBeFocused();
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      const launcher = page.getByRole("dialog", { name: "Start a run", exact: true });
      await launcher.getByRole("navigation", { name: "Workflow", exact: true }).getByRole("button", { name: "Oath Upload", exact: true }).click();
      const pdf = launcher.getByRole("region", { name: "PDF documents", exact: true }), roster = launcher.getByRole("button", { name: "Existing Onboarding Roster Roster", exact: true });
      const pdfBox = (await pdf.boundingBox())!, rosterBox = (await roster.boundingBox())!;
      expect(rosterBox.y).toBeGreaterThanOrEqual(pdfBox.y + pdfBox.height);
      expect(Math.abs(pdfBox.x - rosterBox.x)).toBeLessThan(2);
      await expect(pdf.getByRole("button", { name: "Choose PDFs", exact: true })).toBeVisible();
      await expect(launcher).not.toContainText("The ticket waits for all signers");
      await expect(launcher).toHaveCSS("opacity", "1");

      await attachShellA11y(page, info, inputEvidence);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
