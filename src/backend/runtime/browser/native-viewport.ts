import type { Page } from "playwright";
import { z } from "zod";

interface ViewportSize { readonly width: number; readonly height: number }

const WindowRectSchema = z.strictObject({ left: z.number().int(), top: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() });

export async function fitNativeWindow(page: Page): Promise<void> {
  const workArea = WindowRectSchema.parse(await page.evaluate(() => {
    const left: unknown = Reflect.get(screen, "availLeft"), top: unknown = Reflect.get(screen, "availTop");
    return { left, top, width: screen.availWidth, height: screen.availHeight };
  }));
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId, bounds } = await session.send("Browser.getWindowForTarget");
    const { windowState, ...rect } = bounds;
    const { left, top, width, height } = WindowRectSchema.parse(rect);
    const fittedWidth = Math.min(width, workArea.width), fittedHeight = Math.min(height, workArea.height);
    const fittedLeft = Math.max(workArea.left, Math.min(left, workArea.left + workArea.width - fittedWidth));
    const fittedTop = Math.max(workArea.top, Math.min(top, workArea.top + workArea.height - fittedHeight));
    if (left === fittedLeft && top === fittedTop && width === fittedWidth && height === fittedHeight && windowState !== "minimized") return;
    if (windowState !== "normal") await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    await session.send("Browser.setWindowBounds", { windowId,
      bounds: { left: fittedLeft, top: fittedTop, width: fittedWidth, height: fittedHeight } });
  } finally { await session.detach(); }
}

export async function overrideNativeViewport(page: Page) {
  const session = await page.context().newCDPSession(page);
  return {
    async resize(size: ViewportSize): Promise<void> {
      await session.send("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: 0, mobile: false });
    },
    restore: async (): Promise<void> => {
      // Clearing the protocol override restores the current native size, including any OS resize during the operation.
      try { await session.send("Emulation.clearDeviceMetricsOverride"); }
      finally { await session.detach(); }
    },
  };
}

export function holdNativeViewport<Args extends unknown[], Result>(
  page: Page, assertCurrent: () => void, operation: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    assertCurrent();
    if (page.viewportSize() !== null) return operation(...args);
    const viewport = await overrideNativeViewport(page);
    let outcome: { state: "completed"; result: Result } | { state: "failed"; cause: unknown };
    try {
      assertCurrent();
      const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      assertCurrent();
      await viewport.resize(size);
      assertCurrent();
      outcome = { state: "completed", result: await operation(...args) };
    } catch (cause) { outcome = { state: "failed", cause }; }
    try { await viewport.restore(); }
    catch (restoration) {
      if (outcome.state === "completed") throw restoration;
      throw new AggregateError([outcome.cause, restoration], "Native viewport restoration failed", { cause: restoration });
    }
    if (outcome.state === "failed") throw outcome.cause;
    return outcome.result;
  };
}
