import assert from "node:assert/strict";
import type { Page } from "playwright";
import { PNG } from "pngjs";
import { captureFullPage } from "../../../../src/backend/runtime/browser/full-page-capture.js";

export async function assertChildFrameCaptureMasks(page: Page): Promise<void> {
  assert.equal(page.viewportSize(), null);
  const mainOrigin = "https://capture.invalid";
  const frames = [
    { name: "same-origin", origin: mainOrigin, left: 80 },
    { name: "cross-origin", origin: "https://frame.invalid", left: 260 },
  ];
  const frameHtml = '<!doctype html><body style="margin:0;background:#abcdef">'
    + '<div data-mask style="margin:20px;width:60px;height:40px;background:#123456"></div>';
  for (const { origin } of frames) {
    await page.route(`${origin}/child`, route => route.fulfill({ contentType: "text/html", body: frameHtml }));
  }
  await page.route(`${mainOrigin}/`, route => route.fulfill({ contentType: "text/html", body:
    '<!doctype html><body style="margin:0"><main style="position:relative;height:240px">'
    + frames.map(({ name, origin, left }) => `<iframe name="${name}" src="${origin}/child"`
      + ` style="position:absolute;top:60px;left:${left}px;border:0;width:120px;height:120px"></iframe>`).join("")
    + '</main>',
  }));
  await page.goto(`${mainOrigin}/`);
  for (const { name, origin } of frames) {
    const frame = page.frame({ name });
    assert.ok(frame, name);
    assert.equal(await frame.evaluate(() => window.origin), origin);
  }

  const capture = async (masked: boolean) => PNG.sync.read(Buffer.from((await captureFullPage(page, {
    assertCurrent: () => {}, assertSafe: async () => {}, afterCapture: async () => {},
    secretControls: 'input[type="password"]', mask: frame => masked ? [frame.locator("[data-mask]")] : [],
  })).bytes));
  const masked = await capture(true);
  const restored = await capture(false);
  const pixel = (png: PNG, x: number, y: number) => {
    const scale = png.width / 1280;
    const offset = (Math.round(y * scale) * png.width + Math.round(x * scale)) * 4;
    return [...png.data.subarray(offset, offset + 3)];
  };
  for (const { name, left } of frames) {
    assert.deepEqual(pixel(masked, left + 40, 100), [255, 0, 255], `${name} mask`);
    assert.deepEqual(pixel(masked, left + 100, 100), [171, 205, 239], `${name} neighboring pixel`);
    assert.deepEqual(pixel(restored, left + 40, 100), [18, 52, 86], `${name} restored pixel`);
  }
}
