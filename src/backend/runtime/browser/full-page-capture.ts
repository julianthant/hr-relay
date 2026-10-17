import { PNG } from "pngjs";
import type { Frame, Locator, Page } from "playwright";

const CAPTURE = { width: 1280, maxWidth: 6000, sliceHeight: 1200, sliceOverlap: 120, maxSlices: 30, maxPixels: 40_000_000 };

export class FullPageCaptureRestoreError extends AggregateError {
  constructor(errors: unknown[]) { super(errors, "Full-page capture state restoration failed"); this.name = "FullPageCaptureRestoreError"; }
}

export class FullPageCaptureRefusedError extends Error {
  constructor(readonly reason: "secret-controls-present" | "page-changed") { super(reason); this.name = "FullPageCaptureRefusedError"; }
}

interface CaptureBand { buffer: Buffer; offsetCss: number; clipHeightCss: number }
interface CapturePlan { mode: "window" | "element" | "iframe"; scrollHeight: number; clientHeight: number }
interface CaptureState {
  scroll: (offset: number) => { x: number; y: number; width: number; height: number; offset: number };
  restore: () => void;
}
type CaptureWindow = Window & { __relayCapture?: CaptureState; __relayCaptureSecrets?: { observer: MutationObserver; seen: boolean; restore: () => void } };

function computeSliceOffsets(fullHeight: number, sliceHeight: number): number[] {
  const maxY = Math.max(0, fullHeight - sliceHeight);
  const step = Math.max(1, sliceHeight - CAPTURE.sliceOverlap);
  const offsets: number[] = [];
  for (let y = 0; offsets.length < CAPTURE.maxSlices; y += step) {
    const clamped = Math.min(y, maxY);
    if (offsets.at(-1) === clamped) break;
    offsets.push(clamped);
    if (clamped >= maxY) return offsets;
  }
  throw new Error("Full-page capture exceeds the band limit");
}

function stitchCaptureBands(bands: CaptureBand[]): { bytes: Uint8Array; width: number; height: number } {
  const scale = bands[0].buffer.readUInt32BE(20) / bands[0].clipHeightCss;
  const tops = bands.map(band => Math.round(band.offsetCss * scale));
  const width = Math.max(...bands.map(band => band.buffer.readUInt32BE(16)));
  const height = Math.max(...bands.map((band, i) => tops[i] + band.buffer.readUInt32BE(20)));
  if (width * height > CAPTURE.maxPixels) throw new Error("Full-page capture exceeds the pixel limit");
  const out = new PNG({ width, height });
  for (let i = 0; i < bands.length; i++) {
    const png = PNG.sync.read(bands[i].buffer);
    PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, tops[i]);
  }
  return { bytes: new Uint8Array(PNG.sync.write(out)), width, height };
}

async function observeSecrets(frame: Frame, selector: string): Promise<void> {
  await frame.evaluate(selector => {
    const positions = [...document.querySelectorAll<HTMLElement>("*")].map(el => ({ el, x: el.scrollLeft, y: el.scrollTop }));
    const originalScroll = { x: window.scrollX, y: window.scrollY };
    const state = { restore() {
      const errors: unknown[] = [];
      for (const { el, x, y } of positions) { try { el.scrollTo({ left: x, top: y, behavior: "instant" }); } catch (error) { errors.push(error); } }
      try { window.scrollTo({ left: originalScroll.x, top: originalScroll.y, behavior: "instant" }); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, "Full-page capture scroll restoration failed");
    }, observer: new MutationObserver(records => {
      if (document.querySelector(selector)) state.seen = true;
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLInputElement && ((record.attributeName === "type" && record.oldValue?.toLowerCase() === "password")
          || (record.attributeName === "autocomplete" && record.oldValue !== null && ["one-time-code", "current-password", "new-password"].includes(record.oldValue)))) state.seen = true;
        for (const node of record.addedNodes) if (node instanceof Element && (node.matches(selector) || node.querySelector(selector))) state.seen = true;
      }
    }), seen: document.querySelector(selector) !== null };
    (window as CaptureWindow).__relayCaptureSecrets = state;
    state.observer.observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ["type", "autocomplete"] });
  }, selector);
}

async function setCaptureWidth(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight,
    docWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) }));
  let widest = metrics.docWidth;
  for (const frame of page.frames()) widest = Math.max(widest, await frame.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0)));
  await page.setViewportSize({ width: Math.min(Math.max(CAPTURE.width, widest + 24), CAPTURE.maxWidth), height: Math.min(metrics.height, CAPTURE.sliceHeight) });
}

async function planScrollCapture(page: Page): Promise<CapturePlan> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const docH = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
    const winOverflow = Math.max(0, docH - vh);
    const all = [...document.querySelectorAll<HTMLElement>("*")].slice(0, 25_000);
    const visibility = { visible(el: HTMLElement): boolean {
      const r = el.getBoundingClientRect();
      if (r.height < vh * 0.35 || r.width < vw * 0.3) return false;
      for (let sx = 0; sx < 3; sx++) for (let sy = 0; sy < 3; sy++) {
        const top = document.elementFromPoint(Math.min(vw - 1, Math.max(0, r.left + r.width * (0.25 + sx * 0.25))), Math.min(vh - 1, Math.max(0, r.top + r.height * (0.3 + sy * 0.2))));
        if (top && (top === el || el.contains(top))) return true;
      }
      return false;
    } };
    let bestEl: HTMLElement | null = null;
    let bestElOverflow = 0;
    for (const el of all) {
      const overflow = el.scrollHeight - el.clientHeight;
      if (!["auto", "scroll"].includes(getComputedStyle(el).overflowY) || overflow <= bestElOverflow || !visibility.visible(el)) continue;
      bestEl = el;
      bestElOverflow = overflow;
    }
    let bestFrame: HTMLIFrameElement | null = null;
    let bestFrameOverflow = 0;
    for (const frame of document.querySelectorAll("iframe")) {
      const doc = frame.contentDocument;
      if (!doc) continue;
      const scroller = doc.scrollingElement ?? doc.documentElement;
      const overflow = scroller.scrollHeight - scroller.clientHeight;
      if (overflow <= bestFrameOverflow || !visibility.visible(frame)) continue;
      bestFrame = frame;
      bestFrameOverflow = overflow;
    }
    let mode: CapturePlan["mode"] = "window";
    let target: HTMLElement | null = null;
    let targetWindow: Window = window;
    let scrollHeight = docH;
    let clientHeight = vh;
    if (bestFrame && bestFrameOverflow > winOverflow && bestFrameOverflow >= bestElOverflow) {
      mode = "iframe";
      target = bestFrame;
      targetWindow = bestFrame.contentWindow!;
      const doc = bestFrame.contentDocument!;
      scrollHeight = (doc.scrollingElement ?? doc.documentElement).scrollHeight;
    } else if (bestEl && bestElOverflow > winOverflow) {
      mode = "element";
      target = bestEl;
      scrollHeight = bestEl.scrollHeight;
    }
    const scrolls = new Map<HTMLElement, { x: number; y: number }>();
    for (const el of all) if (el.scrollTop || el.scrollLeft) scrolls.set(el, { x: el.scrollLeft, y: el.scrollTop });
    if (mode === "element" && target) scrolls.set(target, { x: target.scrollLeft, y: target.scrollTop });
    const windowScroll = { x: window.scrollX, y: window.scrollY };
    const targetScroll = { x: targetWindow.scrollX, y: targetWindow.scrollY };
    const targetStyle = target?.getAttribute("style") ?? null;
    const hidden: Array<{ el: HTMLElement; display: string; priority: string }> = [];
    const overlays = { hide(elements: Iterable<HTMLElement>): void {
      for (const el of elements) {
        if (!["fixed", "sticky"].includes(el.ownerDocument.defaultView!.getComputedStyle(el).position) || el === target || (target && el.contains(target))) continue;
        hidden.push({ el, display: el.style.getPropertyValue("display"), priority: el.style.getPropertyPriority("display") });
        el.style.setProperty("display", "none", "important");
      }
    } };
    (window as CaptureWindow).__relayCapture = {
      restore() {
        const errors: unknown[] = [];
        for (const { el, display, priority } of hidden) {
          try { if (display) el.style.setProperty("display", display, priority); else el.style.removeProperty("display"); }
          catch (error) { errors.push(error); }
        }
        try { if (target) { if (targetStyle === null) target.removeAttribute("style"); else target.setAttribute("style", targetStyle); } }
        catch (error) { errors.push(error); }
        for (const [el, position] of scrolls) { try { el.scrollTo({ left: position.x, top: position.y, behavior: "instant" }); } catch (error) { errors.push(error); } }
        try { targetWindow.scrollTo({ left: targetScroll.x, top: targetScroll.y, behavior: "instant" }); } catch (error) { errors.push(error); }
        try { window.scrollTo({ left: windowScroll.x, top: windowScroll.y, behavior: "instant" }); } catch (error) { errors.push(error); }
        delete (window as CaptureWindow).__relayCapture;
        if (errors.length) throw new AggregateError(errors, "Full-page capture plan restoration failed");
      },
      scroll(offset) {
        if (mode === "element") target!.scrollTo({ left: 0, top: offset, behavior: "instant" });
        else targetWindow.scrollTo({ left: 0, top: offset, behavior: "instant" });
        const r = target?.getBoundingClientRect() ?? { left: 0, top: 0, width: vw, height: Math.min(vh, scrollHeight) };
        const x = Math.max(0, r.left + (target?.clientLeft ?? 0));
        const y = Math.max(0, r.top + (target?.clientTop ?? 0));
        const width = Math.min(target?.clientWidth ?? r.width, vw - x);
        const height = Math.min(clientHeight, vh - y);
        const contentDocument = mode === "iframe" ? bestFrame!.contentDocument! : document;
        const requiredWidth = mode === "element" ? target!.scrollWidth : Math.max(contentDocument.documentElement.scrollWidth, contentDocument.body?.scrollWidth ?? 0);
        if (requiredWidth > width) throw new Error("Full-page capture has uncaptured horizontal overflow");
        return { x, y, width, height, offset: mode === "element" ? target!.scrollTop : targetWindow.scrollY };
      },
    };
    if (target) {
      target.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
      const rect = target.getBoundingClientRect();
      const availableHeight = vh - Math.max(0, rect.top);
      if (rect.height > availableHeight) {
        target.style.setProperty("box-sizing", "border-box", "important");
        target.style.setProperty("min-height", "0", "important");
        target.style.setProperty("max-height", `${availableHeight}px`, "important");
        target.style.setProperty("height", `${availableHeight}px`, "important");
      }
    }
    overlays.hide(all);
    if (bestFrame && mode === "iframe") overlays.hide(bestFrame.contentDocument!.querySelectorAll<HTMLElement>("*"));
    if (target) {
      clientHeight = target.clientHeight;
      scrollHeight = mode === "iframe" ? (bestFrame!.contentDocument!.scrollingElement ?? bestFrame!.contentDocument!.documentElement).scrollHeight : target.scrollHeight;
    } else {
      scrollHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
      clientHeight = vh;
      if (scrollHeight <= vh) {
        const range = document.createRange();
        range.selectNodeContents(document.body);
        scrollHeight = Math.max(1, Math.ceil(range.getBoundingClientRect().bottom + window.scrollY));
        clientHeight = scrollHeight;
      }
    }
    return { mode, scrollHeight, clientHeight };
  });
}

export async function captureFullPage(page: Page, options: Readonly<{
  assertSafe: () => Promise<void>;
  mask: () => Locator[];
  secretControls: string;
  afterCapture: () => Promise<void>;
}>): Promise<Readonly<{ bytes: Uint8Array; width: number; height: number }>> {
  const viewport = page.viewportSize();
  const originalViewport = viewport ?? await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const frames: Frame[] = [];
  let failure: { cause: unknown } | undefined;
  const assertSafe = async (): Promise<void> => {
    await options.assertSafe();
    for (const frame of frames) if (await frame.evaluate(() => {
      const state = (window as CaptureWindow).__relayCaptureSecrets;
      if (state === undefined || typeof state.seen !== "boolean" || !(state.observer instanceof MutationObserver)) throw new Error("Full-page capture safety observer is unavailable");
      return state.seen;
    })) throw new FullPageCaptureRefusedError("secret-controls-present");
  };
  try {
    for (const frame of page.frames()) { frames.push(frame); await observeSecrets(frame, options.secretControls); }
    await assertSafe();
    await setCaptureWidth(page);
    const plan = await planScrollCapture(page);
    const bandHeight = Math.max(1, Math.min(plan.clientHeight, CAPTURE.sliceHeight));
    const bands: CaptureBand[] = [];
    let coveredTo = 0;
    for (const offset of computeSliceOffsets(plan.scrollHeight, bandHeight)) {
      const clip = await page.evaluate(offset => (window as CaptureWindow).__relayCapture!.scroll(offset), offset);
      await page.waitForTimeout(250);
      await assertSafe();
      const { offset: actualOffset, ...rect } = clip;
      rect.height = Math.min(rect.height, bandHeight);
      if (actualOffset > coveredTo) throw new Error("Full-page capture has an unpainted gap");
      coveredTo = Math.max(coveredTo, actualOffset + rect.height);
      const buffer = await page.screenshot({ type: "png", clip: rect, mask: options.mask() });
      await assertSafe();
      bands.push({ buffer, offsetCss: actualOffset, clipHeightCss: rect.height });
    }
    if (coveredTo < plan.scrollHeight) throw new Error("Full-page capture did not reach the content bottom");
    return stitchCaptureBands(bands);
  } catch (error) { failure = { cause: error }; throw error; }
  finally { await restoreCaptureState(); }

  async function restoreCaptureState(): Promise<void> {
    const errors: unknown[] = [];
    const restore = async (action: () => Promise<unknown>): Promise<void> => { try { await action(); } catch (error) { errors.push(error); } };
    await restore(() => page.evaluate(() => (window as CaptureWindow).__relayCapture?.restore()));
    await restore(() => page.setViewportSize(originalViewport));
    for (const frame of frames) if (!frame.isDetached()) await restore(() => frame.evaluate(() => (window as CaptureWindow).__relayCaptureSecrets?.restore()));
    let afterFailure: Error | undefined;
    if (failure === undefined) {
      try { await options.afterCapture(); await assertSafe(); }
      catch (error) { afterFailure = error instanceof Error ? error : new Error("Full-page capture verification failed", { cause: error }); }
    }
    for (const frame of frames) if (!frame.isDetached()) await restore(() => frame.evaluate(() => {
      (window as CaptureWindow).__relayCaptureSecrets?.observer.disconnect();
      delete (window as CaptureWindow).__relayCaptureSecrets;
    }));
    if (errors.length) throw new FullPageCaptureRestoreError([...(failure === undefined ? [] : [failure.cause]), ...(afterFailure === undefined ? [] : [afterFailure]), ...errors]);
    if (afterFailure !== undefined) throw afterFailure;
  }
}
