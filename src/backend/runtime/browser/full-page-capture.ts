import { PNG } from "pngjs";
import type { Frame, Locator, Page } from "playwright";
import type { BrowserCaptureFailure } from "../../../workflow-kit/session.js";
import { overrideNativeViewport } from "./native-viewport.js";

const CAPTURE = { width: 1280, maxWidth: 6000, sliceHeight: 1200, sliceOverlap: 120, maxSlices: 30, maxPixels: 40_000_000, paintTimeoutMs: 1000 };

export class FullPageCaptureRestoreError extends AggregateError {
  constructor(errors: unknown[]) { super(errors, "Full-page capture state restoration failed"); this.name = "FullPageCaptureRestoreError"; }
}

export class FullPageCaptureRefusedError extends Error {
  constructor(readonly reason: "secret-controls-present" | "page-changed") { super(reason); this.name = "FullPageCaptureRefusedError"; }
}

/** A capture the page's geometry or safety observer could not complete, named for the operator. */
export class FullPageCaptureFailedError extends Error {
  constructor(readonly reason: BrowserCaptureFailure, readonly detail?: string) { super(reason); this.name = "FullPageCaptureFailedError"; }
}

interface CaptureBand { buffer: Buffer; offsetCss: number; offsetXCss: number; clipHeightCss: number }
const bandGeometryFields = ["x", "y", "width", "height", "offset", "offsetX", "contentWidth", "contentHeight"] as const;
type BandGeometry = Record<typeof bandGeometryFields[number], number>;
interface CaptureState {
  scroll: (left: number, top: number) => boolean;
  measure: () => BandGeometry;
  restore: () => void;
}
type CaptureWindow = Window & { __relayCapture?: CaptureState; __relayCaptureSecrets?: { observer: MutationObserver; seen: boolean; restore: () => void } };

function bandGeometryChange(before: BandGeometry, after: BandGeometry): string | undefined {
  const changes: string[] = [];
  for (const field of bandGeometryFields) {
    const from = before[field], to = after[field];
    if (from === to) continue;
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new FullPageCaptureFailedError("unpainted-gap", `invalid-band-geometry-${field}`);
    changes.push(`${field}=${from}->${to}`);
  }
  return changes.length ? `band-geometry-changed ${changes.join(" ")}` : undefined;
}

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
  throw new FullPageCaptureFailedError("band-limit");
}

function stitchCaptureBands(bands: CaptureBand[]): { bytes: Uint8Array; width: number; height: number } {
  const scale = bands[0].buffer.readUInt32BE(20) / bands[0].clipHeightCss;
  const tops = bands.map(band => Math.round(band.offsetCss * scale));
  const lefts = bands.map(band => Math.round(band.offsetXCss * scale));
  const width = Math.max(...bands.map((band, i) => lefts[i] + band.buffer.readUInt32BE(16)));
  const height = Math.max(...bands.map((band, i) => tops[i] + band.buffer.readUInt32BE(20)));
  if (width * height > CAPTURE.maxPixels) throw new FullPageCaptureFailedError("pixel-limit");
  const out = new PNG({ width, height });
  for (let i = 0; i < bands.length; i++) {
    const png = PNG.sync.read(bands[i].buffer);
    PNG.bitblt(png, out, 0, 0, png.width, png.height, lefts[i], tops[i]);
  }
  return { bytes: new Uint8Array(PNG.sync.write(out)), width, height };
}

async function observeSecrets(frame: Frame, selector: string): Promise<void> {
  await frame.evaluate(selector => {
    // Matches Playwright's visible filter: a never-painted control cannot reach the pixels.
    // An object method: tsx wraps a named inner function in a __name helper the page realm lacks.
    const controls = { painted(): boolean {
      return [...document.querySelectorAll<HTMLElement>(selector)].some(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && el.checkVisibility({ visibilityProperty: true });
      });
    } };
    const positions = [...document.querySelectorAll<HTMLElement>("*")].map(el => ({ el, x: el.scrollLeft, y: el.scrollTop }));
    const originalScroll = { x: window.scrollX, y: window.scrollY };
    const state = { restore() {
      const errors: unknown[] = [];
      for (const { el, x, y } of positions) { try { el.scrollTo({ left: x, top: y, behavior: "instant" }); } catch (error) { errors.push(error); } }
      try { window.scrollTo({ left: originalScroll.x, top: originalScroll.y, behavior: "instant" }); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, "Full-page capture scroll restoration failed");
    }, observer: new MutationObserver(records => {
      if (controls.painted()) state.seen = true;
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLInputElement && ((record.attributeName === "type" && record.oldValue?.toLowerCase() === "password")
          || (record.attributeName === "autocomplete" && record.oldValue !== null && ["one-time-code", "current-password", "new-password"].includes(record.oldValue)))) state.seen = true;
        // A secret control that left this document (removed, or moved into a shadow tree or another frame) is no longer watched.
        for (const node of record.removedNodes) if (node instanceof Element && [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)].some(el => !document.contains(el))) state.seen = true;
      }
    }), seen: controls.painted() };
    (window as CaptureWindow).__relayCaptureSecrets = state;
    state.observer.observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ["type", "autocomplete", "class", "style", "hidden", "open"] });
  }, selector);
}

async function sizeCaptureViewport(page: Page, assertCurrent: () => void, native: Awaited<ReturnType<typeof overrideNativeViewport>> | undefined): Promise<void> {
  assertCurrent();
  const height = native === undefined ? Math.min(await page.evaluate(() => window.innerHeight), CAPTURE.sliceHeight) : CAPTURE.sliceHeight;
  if (native !== undefined) {
    assertCurrent();
    // Measure responsive content at the same size regardless of the presentation window.
    await native.resize({ width: CAPTURE.width, height });
  }
  let widest = 0;
  for (const frame of page.frames()) {
    assertCurrent();
    widest = Math.max(widest, await frame.evaluate(overflowOnly => {
      const root = document.documentElement;
      const width = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0);
      return overflowOnly && width <= root.clientWidth ? 0 : width;
    }, native !== undefined));
  }
  const width = Math.min(Math.max(CAPTURE.width, widest + 24), CAPTURE.maxWidth);
  assertCurrent();
  if (native === undefined) await page.setViewportSize({ width, height });
  else if (width > CAPTURE.width) await native.resize({ width, height });
}

async function prepareScrollCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // The viewport scrolls only its scrolling element; a body that scrolls under a clipped root is an element target.
    const viewportScroller = document.scrollingElement ?? document.documentElement;
    const docH = viewportScroller.scrollHeight;
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
    let mode: "window" | "element" | "iframe" = "window";
    let target: HTMLElement | null = null;
    let targetWindow: Window = window;
    if (bestFrame && bestFrameOverflow > winOverflow && bestFrameOverflow >= bestElOverflow) {
      mode = "iframe";
      target = bestFrame;
      targetWindow = bestFrame.contentWindow!;
    } else if (bestEl && bestElOverflow > winOverflow) {
      mode = "element";
      target = bestEl;
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
      scroll(left, top) {
        if (mode === "element") {
          const { scrollLeft, scrollTop } = target!;
          target!.scrollTo({ left, top, behavior: "instant" });
          return scrollLeft !== target!.scrollLeft || scrollTop !== target!.scrollTop;
        }
        const { scrollX, scrollY } = targetWindow;
        targetWindow.scrollTo({ left, top, behavior: "instant" });
        return scrollX !== targetWindow.scrollX || scrollY !== targetWindow.scrollY;
      },
      measure() {
        const { innerWidth, innerHeight } = window;
        const contentDocument = mode === "iframe" ? bestFrame!.contentDocument! : document;
        const scroller = contentDocument.scrollingElement ?? contentDocument.documentElement;
        const contentWidth = mode === "element" ? target!.scrollWidth : Math.max(contentDocument.documentElement.scrollWidth, contentDocument.body?.scrollWidth ?? 0);
        let contentHeight = mode === "element" ? target!.scrollHeight : scroller.scrollHeight;
        if (mode === "window" && contentHeight <= innerHeight) {
          const range = document.createRange();
          range.selectNodeContents(document.body);
          contentHeight = Math.max(1, Math.ceil(range.getBoundingClientRect().bottom + window.scrollY));
        }
        const r = target?.getBoundingClientRect();
        const clientWidth = target?.clientWidth ?? innerWidth;
        const clientHeight = target?.clientHeight ?? Math.min(innerHeight, contentHeight);
        // Chromium paints a box at its pixel-snapped edges, scrolled content with it; a sub-pixel clip loses a band row.
        const dpr = window.devicePixelRatio || 1;
        const left0 = (r?.left ?? 0) + (target?.clientLeft ?? 0);
        const top0 = (r?.top ?? 0) + (target?.clientTop ?? 0);
        const clientX = Math.round(left0 * dpr) / dpr;
        const clientY = Math.round(top0 * dpr) / dpr;
        const x = Math.max(0, clientX);
        const y = Math.max(0, clientY);
        const width = Math.round(Math.min(left0 + clientWidth, innerWidth) * dpr) / dpr - x;
        const height = Math.round(Math.min(top0 + clientHeight, innerHeight) * dpr) / dpr - y;
        return { x, y, width, height, contentWidth, contentHeight,
          offset: (mode === "element" ? target!.scrollTop : targetWindow.scrollY) + (y - clientY),
          offsetX: (mode === "element" ? target!.scrollLeft : targetWindow.scrollX) + (x - clientX) };
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
  });
}

export async function captureFullPage(page: Page, options: Readonly<{
  assertCurrent: () => void;
  assertSafe: () => Promise<void>;
  sampleLabels?: readonly string[];
  mask: () => Locator[];
  secretControls: string;
  afterCapture: () => Promise<void>;
  onBandRetry?: (detail: string) => void;
}>): Promise<Readonly<{ bytes: Uint8Array; width: number; height: number }>> {
  const { assertCurrent } = options;
  assertCurrent();
  const originalViewport = page.viewportSize();
  const frames: Frame[] = [];
  let nativeViewport: Awaited<ReturnType<typeof overrideNativeViewport>> | undefined;
  let failure: { cause: unknown } | undefined;
  let sampleBannerOwned = false;
  const assertSafe = async (): Promise<void> => {
    assertCurrent();
    await options.assertSafe();
    for (const frame of frames) {
      assertCurrent();
      const seen = await frame.evaluate(() => {
        const state = (window as CaptureWindow).__relayCaptureSecrets;
        return state === undefined || typeof state.seen !== "boolean" || !(state.observer instanceof MutationObserver) ? "unavailable" : state.seen;
      });
      if (seen === "unavailable") throw new FullPageCaptureFailedError("observer-unavailable");
      if (seen) throw new FullPageCaptureRefusedError("secret-controls-present");
    }
    assertCurrent();
  };
  try {
    assertCurrent();
    for (const frame of page.frames()) { assertCurrent(); frames.push(frame); await observeSecrets(frame, options.secretControls); }
    await assertSafe();
    if (originalViewport === null) nativeViewport = await overrideNativeViewport(page);
    await sizeCaptureViewport(page, assertCurrent, nativeViewport);
    assertCurrent();
    await prepareScrollCapture(page);
    const bands = await captureBands(CAPTURE.maxSlices, true);
    const image = stitchCaptureBands(bands);
    if ((options.sampleLabels?.length ?? 0) === 0) return image;
    await page.evaluate(({ labels, width }) => {
      if (document.getElementById("relay-dry-run-sample-banner")) throw new Error("Sample banner identity is already in use");
      const banner = document.createElement("div");
      banner.id = "relay-dry-run-sample-banner";
      banner.textContent = labels.join("\n");
      banner.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;box-sizing:border-box;width:${width / window.devicePixelRatio}px;padding:16px;background:#fff0b3;color:#161616;font:700 18px monospace;white-space:pre-wrap;overflow-wrap:anywhere;`;
      document.documentElement.append(banner);
    }, { labels: options.sampleLabels ?? [], width: image.width });
    sampleBannerOwned = true;
    await assertSafe();
    assertCurrent();
    const banner = PNG.sync.read(await page.locator("#relay-dry-run-sample-banner").screenshot({ type: "png" }));
    await assertSafe();
    const source = PNG.sync.read(Buffer.from(image.bytes));
    const width = Math.max(source.width, banner.width), height = source.height + banner.height;
    if (width * height > CAPTURE.maxPixels) throw new FullPageCaptureFailedError("pixel-limit");
    const labelled = new PNG({ width, height });
    labelled.data.fill(255);
    PNG.bitblt(banner, labelled, 0, 0, banner.width, banner.height, 0, 0);
    PNG.bitblt(source, labelled, 0, 0, source.width, source.height, 0, banner.height);
    return { bytes: new Uint8Array(PNG.sync.write(labelled)), width, height };
  } catch (error) { failure = { cause: error }; throw error; }
  finally { await restoreCaptureState(); }

  async function captureBands(sliceBudget: number, mayRestart: boolean): Promise<CaptureBand[]> {
    const scrollTo = async (left: number, top: number): Promise<void> => {
      assertCurrent();
      const moved = await page.evaluate(([left, top]) => (window as CaptureWindow).__relayCapture!.scroll(left, top), [left, top] as const);
      assertCurrent();
      if (moved) {
        // Instant scrolling updates offsets before scroll listeners and paint have run.
        const painted = await page.waitForFunction(() => new Promise<boolean>(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
        }), undefined, { timeout: CAPTURE.paintTimeoutMs });
        await painted.dispose();
      }
    };
    const readGeometry = async (): Promise<BandGeometry> => {
      assertCurrent();
      const geometry = await page.evaluate(() => (window as CaptureWindow).__relayCapture!.measure());
      assertCurrent();
      return geometry;
    };
    // A target wider than its box, such as a timecard grid, is captured in columns as well as bands.
    await scrollTo(0, 0);
    const first = await readGeometry();
    if (first.contentWidth > CAPTURE.maxWidth) throw new FullPageCaptureFailedError("horizontal-overflow");
    if (first.width <= 0 || first.height <= 0 || first.offset > 0 || first.offsetX > 0) throw new FullPageCaptureFailedError("unpainted-gap");
    const bandWidth = first.width;
    const bandHeight = Math.min(first.height, CAPTURE.sliceHeight);
    const rows = computeSliceOffsets(first.contentHeight, bandHeight);
    const columns = computeSliceOffsets(first.contentWidth, bandWidth);
    if (rows.length * columns.length > sliceBudget) throw new FullPageCaptureFailedError("band-limit");
    const bands: CaptureBand[] = [];
    let coveredTo = 0;
    for (const top of rows) {
      let rowOffset: number | undefined;
      let coveredX = 0;
      let rowHeight = bandHeight;
      for (const left of columns) {
        await scrollTo(left, top);
        await assertSafe();
        const before = await readGeometry();
        const { x, y, width, height, offset, offsetX, contentWidth, contentHeight } = before;
        if (contentWidth !== first.contentWidth || contentHeight !== first.contentHeight) {
          throw new FullPageCaptureFailedError("unpainted-gap", "capture-content-size-changed");
        }
        const clip = { x, y, width: Math.min(width, bandWidth), height: Math.min(height, bandHeight) };
        if (clip.width <= 0 || clip.height <= 0 || (rowOffset ?? offset) !== offset || offset > coveredTo || offsetX > coveredX) {
          throw new FullPageCaptureFailedError("unpainted-gap");
        }
        assertCurrent();
        const mask = options.mask();
        let buffer: Buffer;
        if (nativeViewport === undefined) {
          buffer = await page.screenshot({ type: "png", clip, mask });
        } else {
          const origin = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
          buffer = await page.screenshot({ type: "png", fullPage: true, mask,
            clip: { ...clip, x: clip.x + origin.x, y: clip.y + origin.y } });
        }
        await assertSafe();
        const detail = bandGeometryChange(before, await readGeometry());
        if (detail !== undefined) {
          // A reflow can invalidate even the bands already painted. Replan once from the origin.
          const remaining = sliceBudget - bands.length - 1;
          if (mayRestart && remaining > 0) {
            options.onBandRetry?.(detail);
            return captureBands(remaining, false);
          }
          throw new FullPageCaptureFailedError("unpainted-gap", detail);
        }
        rowOffset = offset;
        coveredX = Math.max(coveredX, offsetX + clip.width);
        rowHeight = Math.min(rowHeight, clip.height);
        bands.push({ buffer, offsetCss: offset, offsetXCss: offsetX, clipHeightCss: clip.height });
      }
      if (coveredX < first.contentWidth) throw new FullPageCaptureFailedError("horizontal-overflow");
      coveredTo = Math.max(coveredTo, (rowOffset ?? 0) + rowHeight);
    }
    if (coveredTo < first.contentHeight) {
      throw new FullPageCaptureFailedError("content-bottom-unreached", `page-capture-covered-${String(Math.floor(coveredTo))}-of-${String(first.contentHeight)}px`);
    }
    assertCurrent();
    return bands;
  }

  async function restoreCaptureState(): Promise<void> {
    const errors: unknown[] = [];
    const restore = async (action: () => Promise<unknown>): Promise<void> => { try { await action(); } catch (error) { errors.push(error); } };
    if (sampleBannerOwned) await restore(() => page.locator("#relay-dry-run-sample-banner").evaluate(element => element.remove()));
    await restore(() => page.evaluate(() => (window as CaptureWindow).__relayCapture?.restore()));
    if (originalViewport !== null) await restore(() => page.setViewportSize(originalViewport));
    else if (nativeViewport !== undefined) await restore(nativeViewport.restore);
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
