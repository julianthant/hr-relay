import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { startOcrSweepServer } from "./helpers/sweep-fixtures-server.js";

const out = process.env.SWEEP_FIXTURES_OUT ?? "tests/mocks/.output/sweep-fixtures";
test.beforeAll(async () => { await mkdir(out, { recursive: true }); });

for (const width of [1280, 1024]) for (const mode of ["review", "member-retry"] as const) {
  test(`served OCR ${mode} at ${width}`, async ({ page, request }) => {
    const server = await startOcrSweepServer(mode);
    try {
      const detail = await request.get(`${server.baseUrl}/api/v1/runs/${server.runId}`);
      expect(detail.status()).toBe(200);
      if (mode === "member-retry") expect(await detail.json()).toMatchObject({ runId: server.runId,
        childRetry: { label: "Retry" }, decision: { type: "member-failed" } });
      else expect(await detail.json()).toMatchObject({ panelKind: "review" });
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`${server.baseUrl}/?fixture=product-workflows&day=${server.day}&run=${server.runId}`);
      const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
      await expect(logs).toBeVisible();
      if (mode === "member-retry") await expect(logs.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
      else {
        const review = await request.get(`${server.baseUrl}/api/v1/runs/${server.runId}/review`);
        expect(review.status()).toBe(200);
        expect(await review.json()).toMatchObject({ section: "review", payload: { runId: server.ocrRunId } });
        await page.goto(`${server.baseUrl}/?fixture=product-workflows&day=${server.day}&run=${server.ocrRunId}`);
        await page.getByRole("button", { name: "Records 1", exact: true }).click();
        await expect(page.getByRole("region", { name: "OCR records", exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Approve records", exact: true })).toBeVisible();
      }
      await page.screenshot({ path: `${out}/ocr-${mode}-${width}.png` });
      await writeFile(`${out}/ocr-${mode}-${width}.yaml`, await page.locator("body").ariaSnapshot());
    } finally { await page.goto("about:blank"); await server.close(); }
  });
}
