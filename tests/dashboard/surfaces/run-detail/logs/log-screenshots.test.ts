// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it,vi } from "vitest";
import type { LogScreenshot } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { LogScreenshots } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-screenshots.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(HTMLElement.prototype, "scrollTo", () => {});
Reflect.set(globalThis, "ResizeObserver", class { observe() {} disconnect() {} });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
const captures: readonly LogScreenshot[] = [
  { src: "/first.svg", alt: "First form", time: "09:32:38", width: 850, height: 1050, kind: "form", system: "UCPath", label: "Termination" },
  { src: "/second.svg", alt: "Second form", time: "09:33:29", width: 850, height: 1150, kind: "form", system: "Kuali", label: "Separation" },
];
async function mount(screenshots = captures) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(LogScreenshots, { screenshots })));
}
function button(name: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === name || node.textContent === name);
  assert.ok(match, `missing button: ${name}`);
  return match;
}
async function click(name: string) { await act(async () => button(name).click()); }

describe("classified log screenshot viewer", () => {
  it("switches captures in order, bounds navigation and resets zoom for the selected form", async () => {
    await mount();
    await click("Enlarge screenshot captured at 09:32:38");
    assert.equal(button("Previous screenshot").disabled, true);
    assert.equal(button("Next screenshot").disabled, false);
    assert.equal(document.querySelector('[role="dialog"] .log-viewer-image')?.getAttribute("alt"), "First form");
    await click("100%");
    assert.equal((document.querySelector('[role="dialog"] .log-viewer-image') as HTMLImageElement).style.width, "850px");
    await click("Next screenshot");
    assert.equal(document.querySelector('[role="dialog"] .log-viewer-image')?.getAttribute("alt"), "Second form");
    assert.equal(button("Fit width").getAttribute("aria-pressed"), "true");
    assert.equal(button("Next screenshot").disabled, true);
    await click("Previous screenshot");
    assert.equal(document.querySelector('[role="dialog"] .log-viewer-image')?.getAttribute("alt"), "First form");
    await click("Whole image");
    assert.equal(button("Whole image").getAttribute("aria-pressed"), "true");
  });
  it("shows a distinct missing-image alert without treating it as an empty group", async () => {
    await mount([captures[0]]);
    const image = document.querySelector("img");
    assert.ok(image);
    await act(async () => image.dispatchEvent(new Event("error")));
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /Screenshot could not be loaded/);
    assert.equal(document.querySelector(".log-capture-header")?.textContent, "UCPathFull form");
    assert.match(document.querySelector("figcaption")?.textContent ?? "", /Termination/u);
    assert.equal(document.querySelector("img"), null);
    await click("Retry screenshot");
    assert.ok(document.querySelector("img"));
    assert.equal(document.querySelector('[role="alert"]') === null, true);
  });
  it("rejects declared-dimension mismatches and leaves other captures intact", async () => {
    vi.stubGlobal("Image", class { src = ""; naturalWidth = 400; naturalHeight = 400; decode() { return Promise.resolve(); } });
    await mount();
    const image = document.querySelector("img");
    assert.ok(image);
    Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 400 } });
    await act(async () => image.dispatchEvent(new Event("load")));
    assert.equal(document.querySelectorAll('[role="alert"]').length, 1);
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /expected 850 × 1050, received 400 × 400/u);
    assert.equal(document.querySelectorAll("img").length, 1);
  });
  it("validates source dimensions independently of a scaled SVG's displayed metrics", async () => {
    vi.stubGlobal("Image", class { src = ""; naturalWidth = 850; naturalHeight = 1050; decode() { return Promise.resolve(); } });
    await mount([captures[0]]);
    const image = document.querySelector("img");
    assert.ok(image);
    Object.defineProperties(image, { naturalWidth: { value: 487 }, naturalHeight: { value: 602 } });
    await act(async () => image.dispatchEvent(new Event("load")));
    assert.equal(document.querySelector('[role="alert"]') === null, true);
    assert.ok(document.querySelector("img"));
  });
  it("refuses a source decode failure even when displayed dimensions match", async () => {
    vi.stubGlobal("Image", class { src = ""; decode() { return Promise.reject(new Error("decode-failed")); } });
    await mount();
    const image = document.querySelector("img");
    assert.ok(image);
    Object.defineProperties(image, { naturalWidth: { value: 850 }, naturalHeight: { value: 1050 } });
    await act(async () => image.dispatchEvent(new Event("load")));
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /Screenshot could not be loaded/u);
    assert.equal(document.querySelectorAll("img").length, 1);
  });
  it("has no capture controls for an empty group", async () => {
    await mount([]);
    assert.equal(document.querySelector("button"), null);
    assert.equal(document.querySelector("figure"), null);
  });
});
